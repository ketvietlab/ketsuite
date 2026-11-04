import { invalid, n, InventoryRefused } from '../inventory-validation.ts'
import { lotKey, quantId, trackingOf, isStorable, mutateQuant } from '../stock-ledger.ts'
import { primeValuation, VALUATION_EFFECTS, valueOperation } from '../valuation.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compareQty } from '../../uom/convert.ts'
import { nextPickingName, PICKING_NAME_EFFECTS } from '../picking-names.ts'
import { ours } from '../scope.ts'
import { toProductUnit } from '../units.ts'

export async function listQuantsHandler(ctx: Ctx, args: Row) {
  return ours(ctx, 'stock.Quant', {
    ...(args.productId ? { productId: args.productId } : {}),
    ...(args.locationId ? { locationId: args.locationId } : {}),
  })
}

export async function adjustInventoryHandler(ctx: Ctx, args: Row) {
  if (!(await isStorable(ctx, args.productId)))
    return invalid('productId', 'chỉ sản phẩm lưu kho mới kiểm kê')
  if (Number(args.countedQuantity) < 0) return invalid('countedQuantity', 'số lượng kiểm kê không được âm')
  const tracking = await trackingOf(ctx, args.productId)
  if (tracking !== 'none' && !args.lotId)
    return invalid('lotId', `${tracking} tracked product cần lot/serial`)
  if (tracking === 'serial' && compareQty(Number(args.countedQuantity), 1, 0.000001) > 0)
    return invalid('countedQuantity', 'mỗi serial chỉ có thể có số lượng 0 hoặc 1')
  if (args.lotId) {
    const lot = (await ours(ctx, 'stock.Lot', { id: args.lotId }))[0]
    if (!lot || lot.productId !== args.productId) return invalid('lotId', 'lot/serial không thuộc sản phẩm')
  }
  // The count may be spoken in boxes; the quant it corrects is not.
  // Comparing them unconverted turned "counted two boxes" into a shortfall
  // of twenty-two pieces.
  const counted = await toProductUnit(ctx, args.productId, args.productUomId, Number(args.countedQuantity))
  if (counted === null) return invalid('productUomId', 'đơn vị không cùng hệ đo với đơn vị gốc của sản phẩm')
  const current = (
    await ours(ctx, 'stock.Quant', {
      productId: args.productId,
      locationId: args.locationId,
      lotKey: lotKey(args.lotId),
    })
  )[0]
  const currentRevision = current ? n(current.version) : -1
  if (args.expectedQuantRevision !== undefined && currentRevision !== n(args.expectedQuantRevision))
    return invalid('expectedQuantRevision', 'stock position changed')
  const difference = counted.quantity - Number(current?.quantity ?? 0)
  if (Math.abs(difference) < 1e-12) return { ok: true, moveId: args.id, difference: '0' }
  // Counting below what is reserved is a real thing to want to say — the shelf
  // is short and a transfer is holding stock that is not there — but it is not
  // something this function can carry out. mutateQuant would refuse it by
  // throwing, which reached the operator as a server error naming neither the
  // reservation nor the transfer holding it. Say so as a field error instead.
  const reserved = Number(current?.reservedQuantity ?? 0)
  if (reserved - counted.quantity > 1e-12)
    return invalid(
      'countedQuantity',
      `không thể kiểm kê xuống dưới ${String(reserved)} đang được reserve; hủy hoặc hoàn tất transfer giữ số này trước`,
    )
  const incoming = difference > 0
  const source = incoming ? args.inventoryLocationId : args.locationId
  const destination = incoming ? args.locationId : args.inventoryLocationId
  const pickingTypeId = `${String(args.inventoryLocationId)}:adjustment`
  const pickingId = `${String(args.id)}:picking`
  try {
    await ctx.tx(async (tx) => {
      if (args.expectedQuantRevision !== undefined) {
        const live = (
          await ours(tx, 'stock.Quant', {
            productId: args.productId,
            locationId: args.locationId,
            lotKey: lotKey(args.lotId),
          })
        )[0]
        if (currentRevision === -1) {
          if (live) throw new InventoryRefused(invalid('expectedQuantRevision', 'stock position changed'))
          const inserted = await tx.db.insertIfAbsent('stock.Quant', {
            id: quantId(tx, args.productId, args.locationId, args.lotId),
            productId: args.productId,
            locationId: args.locationId,
            lotId: args.lotId ?? null,
            lotKey: lotKey(args.lotId),
            quantity: '0',
            reservedQuantity: '0',
            inDate: new Date().toISOString(),
            version: 0,
          })
          if (!('dryRun' in inserted) && !inserted.inserted)
            throw new InventoryRefused(invalid('expectedQuantRevision', 'stock position changed'))
        } else {
          if (!live) throw new InventoryRefused(invalid('expectedQuantRevision', 'stock position changed'))
          const claimed = await tx.db.compareAndSet(
            'stock.Quant',
            { id: live.id },
            { version: currentRevision },
            { version: currentRevision + 1 },
          )
          if (!('dryRun' in claimed) && !claimed.matched)
            throw new InventoryRefused(invalid('expectedQuantRevision', 'stock position changed'))
        }
      }
      await primeValuation(tx, [args.productId])
      await mutateQuant(tx, {
        productId: args.productId,
        locationId: source,
        lotId: args.lotId,
        quantity: -Math.abs(difference),
        reserved: 0,
      })
      await mutateQuant(tx, {
        productId: args.productId,
        locationId: destination,
        lotId: args.lotId,
        quantity: Math.abs(difference),
        reserved: 0,
      })
      // It comes in or goes out of the counted location's warehouse, numbered as that warehouse's
      // receipts or deliveries are (K17); a location of no warehouse keeps the adjustment's own name.
      const place = (await ours(tx, 'stock.Location', { id: args.locationId }))[0]
      // A replay keeps the number it took.
      const name =
        ((await ours(tx, 'stock.Picking', { id: pickingId }))[0]?.name as string | undefined) ??
        (await nextPickingName(tx, place?.warehouseId, incoming ? 'incoming' : 'outgoing')) ??
        `Inventory ${String(args.id)}`
      await tx.db.insertIfAbsent('stock.PickingType', {
        id: pickingTypeId,
        name: 'Inventory Adjustments',
        code: 'internal',
        warehouseId: null,
        defaultLocationSrcId: args.inventoryLocationId,
        defaultLocationDestId: args.locationId,
        createBackorder: 'never',
        active: true,
      })
      await tx.db.insertIfAbsent('stock.Picking', {
        id: pickingId,
        name,
        pickingTypeId,
        locationId: source,
        locationDestId: destination,
        moveType: 'direct',
        state: 'done',
        backorderId: null,
        scheduledDate: new Date().toISOString(),
        dateDone: new Date().toISOString(),
      })
      await tx.db.insertIfAbsent('stock.Move', {
        id: args.id,
        name: String(args.reason ?? 'Inventory adjustment'),
        pickingId,
        productId: args.productId,
        productUomId: counted.uomId,
        productUomQty: String(Math.abs(difference)),
        quantity: String(Math.abs(difference)),
        locationId: source,
        locationDestId: destination,
        state: 'done',
        picked: true,
        procureMethod: 'make_to_stock',
        ruleId: null,
        origin: 'inventory',
      })
      await tx.db.insertIfAbsent('stock.MoveLine', {
        id: `${args.id}:line`,
        moveId: args.id,
        pickingId,
        productId: args.productId,
        productUomId: counted.uomId,
        quantity: String(Math.abs(difference)),
        quantityProductUom: String(Math.abs(difference)),
        locationId: source,
        locationDestId: destination,
        lotId: args.lotId ?? null,
        picked: true,
      })
      const usage = async (id: unknown) => (await ours(tx, 'stock.Location', { id }))[0]?.usage
      const [valued] = await valueOperation(tx, { id: pickingId, name, date: new Date().toISOString() }, [
        {
          key: `${String(args.id)}:line`,
          productId: args.productId,
          productUomId: counted.uomId,
          moveId: args.id,
          moveLineId: `${String(args.id)}:line`,
          quantity: Math.abs(difference),
          sourceUsage: await usage(source),
          destinationUsage: await usage(destination),
        },
      ])
      if (valued)
        await tx.db.update(
          'stock.MoveLine',
          { id: valued.key },
          { value: valued.value, unitCost: valued.unitCost },
        )
    })
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    throw error
  }
  return { ok: true, pickingId, moveId: args.id, difference: String(difference) }
}

export const inventoryFunctions: Record<string, FnSpec> = {
  listQuants: defineFn({
    input: { productId: 'id?', locationId: 'id?' },
    effects: ['read:stock.Quant'],
    agent: true,
    handler: listQuantsHandler,
  }),

  adjustInventory: defineFn({
    input: {
      id: 'id',
      productId: 'id',
      locationId: 'id',
      inventoryLocationId: 'id',
      countedQuantity: 'decimal',
      lotId: 'id?',
      productUomId: 'id',
      expectedQuantRevision: 'int?',
      reason: 'text?',
    },
    output: { ok: 'bool', pickingId: 'id?', moveId: 'id?', difference: 'decimal?', errors: 'json?' },
    effects: [
      ...new Set([
        'read:stock.Quant',
        'write:stock.Quant',
        'read:product.Product',
        'read:product.Template',
        'write:product.Template',
        'read:stock.Location',
        'read:stock.Lot',
        'read:stock.PickingType',
        'write:stock.PickingType',
        'read:stock.Picking',
        'write:stock.Picking',
        ...PICKING_NAME_EFFECTS,
        'write:stock.Move',
        'write:stock.MoveLine',
        'read:uom.Unit',
        ...VALUATION_EFFECTS,
      ]),
    ],
    idempotent: true,
    agent: true,
    handler: adjustInventoryHandler,
  }),
}
