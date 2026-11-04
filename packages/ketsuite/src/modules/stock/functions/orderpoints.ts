import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import { defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { nextPickingNameOfType, PICKING_NAME_EFFECTS } from '../picking-names.ts'
import { procure } from '../routing.ts'
import { ours } from '../scope.ts'
import {
  pointProduct,
  fixedPlan,
  planOrderpoint,
  replenishmentReads,
  ReplenishmentRefused,
  refuseReplenishment,
  type SupplierReplenishment,
} from '../replenishment-policy.ts'

export const orderpointFormSchema = defineFormSchema({
  fields: {
    productId: { type: 'id', required: true },
    warehouseId: { type: 'id', required: true },
    locationId: { type: 'id', required: true },
    trigger: { type: 'text', oneOf: ['auto', 'manual'] },
    minQuantity: { type: 'decimal', required: true, min: 0 },
    maxQuantity: { type: 'decimal', required: true, min: 0 },
    source: { type: 'text', nullable: true, oneOf: ['route', 'supplier', 'manufacture'] },
    replenishmentUomId: { type: 'id', nullable: true },
    routeId: { type: 'id', nullable: true },
    vendorId: { type: 'id', nullable: true },
    leadDays: { type: 'int', nullable: true, min: 0, max: 365 },
  },
  unknown: 'drop',
})

const routeReads = [
  'read:product.Category',
  'read:stock.Route',
  'read:stock.ProductRoute',
  'read:stock.CategoryRoute',
  'read:stock.WarehouseRoute',
  'read:stock.Rule',
]
const catchRefusal = async (body: () => Promise<Row>): Promise<Row> => {
  try {
    return await body()
  } catch (error) {
    if (error instanceof ReplenishmentRefused) return error.result
    throw error
  }
}
async function lockWarehouse(ctx: Ctx, id: unknown) {
  const warehouse = (await ours(ctx, 'stock.Warehouse', { id }))[0]
  if (!warehouse || warehouse.active === false) throw new ReplenishmentRefused('warehouseId', 'warehouse')
  const lock = await ctx.db.compareAndSet(
    'stock.Warehouse',
    { id },
    { active: warehouse.active },
    { active: warehouse.active },
  )
  if (!('dryRun' in lock) && !lock.matched) throw new ReplenishmentRefused('warehouseId', 'conflict')
  return warehouse
}
async function lockProduct(ctx: Ctx, point: Row) {
  const { template } = await pointProduct(ctx, point)
  const lock = await ctx.db.compareAndSet(
    'product.Template',
    { id: template.id },
    { revisionId: template.revisionId ?? null },
    { revisionId: template.revisionId ?? null },
  )
  if (!('dryRun' in lock) && !lock.matched) throw new ReplenishmentRefused('productId', 'conflict')
  return template
}

/**
 * Runs one reorder rule. `quantity`, in the product's own unit, orders exactly that much instead of what the
 * rule's minimum and maximum ask for: a validated scrap order replaces what it scrapped (K59).
 */
export function orderpointRunner(provider?: SupplierReplenishment) {
  return async function runPoint(ctx: Ctx, args: Row & { quantity?: number }) {
    return catchRefusal(() =>
      ctx.tx(async (tx) => {
        let point = (await ours(tx, 'stock.Orderpoint', { id: args.id }))[0]
        if (!point || point.active === false) return refuseReplenishment('id', 'point')
        await lockWarehouse(tx, point.warehouseId)
        point = (await ours(tx, 'stock.Orderpoint', { id: args.id }))[0]
        if (!point || point.active === false) return refuseReplenishment('id', 'point')
        const destination = (await ours(tx, 'stock.Location', { id: point.locationId }))[0]
        if (
          !destination ||
          destination.active === false ||
          destination.warehouseId !== point.warehouseId ||
          !['internal', 'transit'].includes(String(destination.usage))
        )
          return refuseReplenishment('locationId', 'location')
        const template = await lockProduct(tx, point)
        const current = (await ours(tx, 'stock.Orderpoint', { id: args.id }))[0]
        if (
          !current ||
          current.active === false ||
          current.productId !== point.productId ||
          current.warehouseId !== point.warehouseId
        )
          return refuseReplenishment('id', 'conflict')
        point = current
        const previous = (await ours(tx, 'stock.Move', { id: args.moveId }))[0]
        if (previous) {
          if (previous.origin !== `orderpoint:${String(point.id)}` || previous.productId !== point.productId)
            return refuseReplenishment('moveId', 'conflict')
          return {
            ok: true,
            quantity: String(previous.replenishmentQuantity ?? previous.productUomQty),
            moveIds: [previous.id],
            pickingId: previous.pickingId,
            method: 'existing',
          }
        }
        const at = new Date().toISOString()
        // The same run of a rule that makes answers the order it already drafted.
        if (point.source === 'manufacture' && provider?.make) {
          const drafted = (await provider.make.planned(tx, { productId: point.productId })).find(
            (row) => row.id === `orderpoint:${String(args.moveId)}`,
          )
          if (drafted)
            return {
              ok: true,
              quantity: String(drafted.quantity),
              moveIds: [],
              productionId: drafted.id,
              href: drafted.href,
              method: 'existing',
            }
        }
        const planned = await planOrderpoint(tx, point, provider, at)
        const plan = args.quantity == null ? planned : await fixedPlan(tx, planned, args.quantity)
        if (!(plan.quantity > 0)) return { ok: true, quantity: '0', moveIds: [], method: 'none' }
        if (point.source === 'manufacture') {
          if (!provider?.make) return refuseReplenishment('source', 'make')
          const made = await provider.make.make(tx, {
            id: `orderpoint:${String(args.moveId)}`,
            productId: point.productId,
            quantity: plan.baseQuantity,
            locationId: point.locationId,
            warehouseId: point.warehouseId,
            orderpointId: String(point.id),
            origin: `orderpoint:${String(point.id)}`,
            at,
            leadDays: plan.leadDays,
          })
          if (!made) return refuseReplenishment('source', 'make')
          return {
            ok: true,
            quantity: String(plan.quantity),
            moveIds: [],
            productionId: made.id,
            href: made.href,
            method: 'manufacture',
          }
        }
        if (point.source !== 'supplier') {
          const result = await procure(tx, {
            moveId: String(args.moveId),
            productId: point.productId,
            productUomId: plan.uomId,
            quantity: plan.quantity,
            locationId: point.locationId,
            routeId: point.routeId,
            origin: `orderpoint:${String(point.id)}`,
          })
          if (!result.ok) throw new ReplenishmentRefused('routeId', 'route')
          await tx.db.update(
            'stock.Move',
            { id: args.moveId },
            { replenishmentQuantity: String(plan.quantity), replenishmentUomId: plan.uomId },
          )
          return { ...result, quantity: String(plan.quantity) }
        }
        if (template.purchaseOk !== true) return refuseReplenishment('productId', 'purchase')
        const vendor = await provider?.select(tx, {
          productId: point.productId,
          quantity: plan.quantity,
          uomId: plan.uomId,
          at,
          partnerId: point.vendorId,
        })
        if (!vendor) return refuseReplenishment('vendorId', 'vendor')
        const types = (
          await ours(tx, 'stock.PickingType', { warehouseId: point.warehouseId, code: 'incoming' })
        )
          .filter((row) => row.active !== false)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        const type = types[0]
        const source = type && (await ours(tx, 'stock.Location', { id: type.defaultLocationSrcId }))[0]
        if (!type || !source || source.usage !== 'supplier' || source.active === false)
          return refuseReplenishment('warehouseId', 'receipt')
        const group = JSON.stringify([
          tx.scope.company,
          point.warehouseId,
          point.locationId,
          type.id,
          vendor.partnerId,
        ])
        const held = (await ours(tx, 'stock.Picking', { state: 'draft', replenishmentGroup: group })).sort(
          (a, b) => String(a.id).localeCompare(String(b.id)),
        )[0]
        let pickingId: unknown = held?.id
        if (held) {
          const lock = await tx.db.compareAndSet(
            'stock.Picking',
            { id: held.id },
            { state: 'draft' },
            { state: 'draft' },
          )
          if (!('dryRun' in lock) && !lock.matched) throw new ReplenishmentRefused('id', 'conflict')
        } else {
          pickingId = randomUUID()
          const days = point.leadDays == null ? vendor.delay : Number(point.leadDays)
          await tx.db.insert('stock.Picking', {
            id: pickingId,
            name: (await nextPickingNameOfType(tx, type.id)) ?? `REPL/${String(pickingId).slice(0, 8)}`,
            pickingTypeId: type.id,
            locationId: source.id,
            locationDestId: point.locationId,
            partnerId: vendor.partnerId,
            replenishmentGroup: group,
            moveType: 'direct',
            state: 'draft',
            backorderId: null,
            scheduledDate: new Date(new Date(at).getTime() + days * 86_400_000).toISOString(),
            dateDone: null,
          })
        }
        const inserted = await tx.db.insertIfAbsent('stock.Move', {
          id: args.moveId,
          name: template.name,
          pickingId,
          productId: point.productId,
          productUomId: plan.baseUomId,
          productUomQty: String(plan.baseQuantity),
          quantity: '0',
          replenishmentQuantity: String(plan.quantity),
          replenishmentUomId: plan.uomId,
          locationId: source.id,
          locationDestId: point.locationId,
          state: 'draft',
          picked: false,
          procureMethod: 'make_to_stock',
          ruleId: null,
          origin: `orderpoint:${String(point.id)}`,
        })
        if (!('dryRun' in inserted) && !inserted.inserted)
          throw new ReplenishmentRefused('moveId', 'conflict')
        return {
          ok: true,
          quantity: String(plan.quantity),
          moveIds: [args.moveId],
          pickingId,
          method: 'supplier',
        }
      }),
    )
  }
}

/** What running a reorder rule reads and writes, with the supplier provider's own reads. */
export const orderpointWriteEffects = (provider?: SupplierReplenishment) => [
  ...replenishmentReads,
  ...(provider?.effects ?? []),
  ...(provider?.make?.effects ?? []),
  ...routeReads,
  'write:stock.Warehouse',
  'write:product.Template',
  'write:stock.Picking',
  ...PICKING_NAME_EFFECTS,
  'write:stock.Move',
  'write:stock.MoveLink',
]

export function createOrderpointFunctions(provider?: SupplierReplenishment): Record<string, FnSpec> {
  const readEffects = [
    ...replenishmentReads,
    ...(provider?.effects ?? []),
    ...(provider?.make?.effects ?? []),
  ]
  const writeEffects = orderpointWriteEffects(provider)

  async function listOrderpointsHandler(ctx: Ctx) {
    return ours(ctx, 'stock.Orderpoint', { active: true })
  }
  async function getOrderpointCollectionHandler(ctx: Ctx) {
    const [points, products, templates, warehouses, locations, units, routes] = await Promise.all([
      ours(ctx, 'stock.Orderpoint', { active: true }),
      ctx.db.select('product.Product'),
      ctx.db.select('product.Template'),
      ours(ctx, 'stock.Warehouse'),
      ours(ctx, 'stock.Location'),
      ctx.db.select('uom.Unit'),
      ours(ctx, 'stock.Route'),
    ])
    const byId = (rows: Row[]) => new Map(rows.map((row) => [row.id, row]))
    const p = byId(products),
      t = byId(templates),
      w = byId(warehouses),
      l = byId(locations),
      u = byId(units),
      rt = byId(routes)
    const at = new Date().toISOString()
    return Promise.all(
      points.map(async (point) => {
        const product = p.get(point.productId),
          template = t.get(product?.templateId)
        const plan = await catchRefusal(async () => ({
          ok: true,
          ...(await planOrderpoint(ctx, point, provider, at)),
        }))
        return {
          id: String(point.id),
          product: `${template?.name ?? point.productId}${product?.defaultCode ? ` · ${product.defaultCode}` : ''}`,
          warehouse: String(w.get(point.warehouseId)?.name ?? point.warehouseId),
          location: String(l.get(point.locationId)?.name ?? point.locationId),
          trigger: String(point.trigger),
          minQuantity: String(point.minQuantity),
          maxQuantity: String(point.maxQuantity),
          forecasted: plan.ok ? String(plan.forecasted) : '—',
          toOrder: plan.ok ? String(plan.quantity) : '—',
          onOrder: plan.ok ? String(plan.onOrder) : '—',
          leadDays: plan.ok ? String(plan.leadDays) : '—',
          source: String(point.source ?? 'route'),
          sourceName: String((plan.selected as Row | undefined)?.name ?? rt.get(point.routeId)?.name ?? ''),
          replenishmentUom: String(u.get(point.replenishmentUomId ?? template?.uomId)?.name ?? '—'),
          planOk: Boolean(plan.ok),
          errors: plan.errors ?? [],
        }
      }),
    )
  }
  async function getOrderpointSupplyHandler(ctx: Ctx, args: Row) {
    const at = new Date().toISOString()
    if (!args.id)
      return {
        options: provider && args.productId ? await provider.options(ctx, args.productId, at) : [],
        enabled: Boolean(provider),
        make: Boolean(provider?.make),
      }
    const point = (await ours(ctx, 'stock.Orderpoint', { id: args.id }))[0]
    if (!point) return null
    const result = await catchRefusal(async () => ({
      ok: true,
      ...(await planOrderpoint(ctx, point, provider, at)),
    }))
    return { ...result, enabled: Boolean(provider), make: Boolean(provider?.make) }
  }
  async function listOrderpointSuppliersHandler(ctx: Ctx, args: Row) {
    const fold = (value: unknown) =>
      String(value ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[đĐ]/gu, 'd')
        .toLowerCase()
    const search = fold(args.search).trim()
    const options = provider ? await provider.options(ctx, args.productId, new Date().toISOString()) : []
    const matched = options
      .filter((option) => !search || fold(option.name).includes(search))
      .slice(0, Math.max(1, Math.min(20, Number(args.limit) || 20)))
      .map((option) => ({ id: option.partnerId, name: option.name, delay: option.delay }))
    return args.includeAutomatic && !search
      ? [{ id: '', name: args.locale === 'en' ? 'Follow product' : 'Theo sản phẩm', delay: null }, ...matched]
      : matched
  }
  async function saveOrderpointHandler(ctx: Ctx, args: Row) {
    const checked = validateForm(orderpointFormSchema, args)
    if (!checked.valid)
      return {
        ok: false,
        errors: checked.issues.map((issue) => ({ ...issue, messageKey: `backend.${issue.messageKey}` })),
      }
    return catchRefusal(() =>
      ctx.tx(async (tx) => {
        await lockWarehouse(tx, args.warehouseId)
        const template = await lockProduct(tx, args)
        const existing = (await ours(tx, 'stock.Orderpoint', { id: args.id }))[0]
        const location = (await ours(tx, 'stock.Location', { id: args.locationId }))[0]
        if (
          !location ||
          location.active === false ||
          location.warehouseId !== args.warehouseId ||
          !['internal', 'transit'].includes(String(location.usage))
        )
          return refuseReplenishment('locationId', 'location')
        if (
          (
            await ours(tx, 'stock.Orderpoint', { productId: args.productId, locationId: args.locationId })
          ).some((row) => row.id !== args.id)
        )
          return refuseReplenishment('productId', 'duplicate')
        const minimum = Number(args.minQuantity),
          maximum = Number(args.maxQuantity)
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum)
          return refuseReplenishment('maxQuantity', 'range')
        const source = String(args.source ?? existing?.source ?? 'route')
        if (!['route', 'supplier', 'manufacture'].includes(source))
          return refuseReplenishment('source', 'source')
        // A rule makes only what has a BOM in use, and only where manufacturing is composed.
        if (source === 'manufacture' && !(provider?.make && (await provider.make.makes(tx, args.productId))))
          return refuseReplenishment('source', 'make')
        if (source === 'supplier' && template.purchaseOk !== true)
          return refuseReplenishment('productId', 'purchase')
        const trigger = String(args.trigger ?? existing?.trigger ?? 'auto')
        if (!['auto', 'manual'].includes(trigger)) return refuseReplenishment('trigger', 'trigger')
        const values: Row = {
          ...args,
          source: args.source ?? existing?.source ?? null,
          trigger,
          active: true,
          replenishmentUomId: args.replenishmentUomId ?? template.uomId,
          vendorId:
            source === 'supplier'
              ? Object.hasOwn(args, 'vendorId')
                ? args.vendorId
                : (existing?.vendorId ?? null)
              : null,
          leadDays: Object.hasOwn(args, 'leadDays') ? args.leadDays : (existing?.leadDays ?? null),
        }
        if (source !== 'supplier' && Object.hasOwn(args, 'leadDays') && values.leadDays == null)
          return refuseReplenishment('leadDays', 'lead')
        // A read-only plan validates supplier membership, automatic days and compatible units.
        await planOrderpoint(tx, values, provider)
        const cs = tx
          .change('stock.Orderpoint', values, existing ?? null)
          .cast([
            'id',
            'productId',
            'warehouseId',
            'locationId',
            'trigger',
            'minQuantity',
            'maxQuantity',
            'replenishmentUomId',
            'routeId',
            'source',
            'vendorId',
            'leadDays',
            'active',
          ])
          .required(['productId', 'warehouseId', 'locationId', 'trigger', 'minQuantity', 'maxQuantity'])
        if (!cs.valid) return { ok: false, errors: cs.errors }
        if (existing) await tx.db.commit(cs, { id: args.id })
        else {
          const inserted = await tx.db.insertIfAbsent('stock.Orderpoint', cs.changes)
          if (!('dryRun' in inserted) && !inserted.inserted) throw new ReplenishmentRefused('id', 'conflict')
        }
        return { ok: true, id: args.id }
      }),
    )
  }

  const runPoint = orderpointRunner(provider)
  async function runOrderpointHandler(ctx: Ctx, args: Row) {
    return runPoint(ctx, args)
  }
  async function runOrderpointsHandler(ctx: Ctx, args: Row) {
    const points = (await ours(ctx, 'stock.Orderpoint', { active: true })).filter(
      (point) => point.trigger === 'auto' && (!args.warehouseId || point.warehouseId === args.warehouseId),
    )
    const results: Row[] = []
    for (const point of points)
      results.push({ id: point.id, ...(await runPoint(ctx, { id: point.id, moveId: randomUUID() })) })
    return { ok: results.every((row) => row.ok === true), results }
  }
  return {
    getOrderpointCollection: defineFn({
      input: {},
      effects: [...readEffects, 'read:stock.Route'],
      handler: getOrderpointCollectionHandler,
    }),
    listOrderpoints: defineFn({
      input: {},
      effects: ['read:stock.Orderpoint'],
      agent: true,
      handler: listOrderpointsHandler,
    }),
    getOrderpointSupply: defineFn({
      input: { id: 'id?', productId: 'id?' },
      effects: readEffects,
      agent: true,
      handler: getOrderpointSupplyHandler,
    }),
    listOrderpointSuppliers: defineFn({
      input: { productId: 'id', search: 'text?', limit: 'int?', includeAutomatic: 'bool?', locale: 'text?' },
      effects: readEffects,
      agent: true,
      handler: listOrderpointSuppliersHandler,
    }),
    saveOrderpoint: defineFn({
      input: {
        id: 'id',
        productId: 'id',
        warehouseId: 'id',
        locationId: 'id',
        trigger: 'text?',
        minQuantity: 'decimal',
        maxQuantity: 'decimal',
        replenishmentUomId: 'id?',
        routeId: 'id?',
        source: 'text?',
        vendorId: 'id?',
        leadDays: 'int?',
      },
      output: { ok: 'bool', id: 'id?', errors: 'json?' },
      effects: [...readEffects, 'write:stock.Orderpoint', 'write:stock.Warehouse', 'write:product.Template'],
      idempotent: true,
      agent: true,
      handler: saveOrderpointHandler,
    }),
    runOrderpoint: defineFn({
      input: { id: 'id', moveId: 'id' },
      output: {
        ok: 'bool',
        quantity: 'decimal?',
        moveIds: 'json?',
        pickingId: 'id?',
        productionId: 'id?',
        href: 'text?',
        method: 'text?',
        errors: 'json?',
      },
      effects: writeEffects,
      idempotent: true,
      agent: true,
      handler: runOrderpointHandler,
    }),
    runOrderpoints: defineFn({
      input: { warehouseId: 'id?' },
      output: { ok: 'bool', results: 'json' },
      effects: writeEffects,
      agent: true,
      handler: runOrderpointsHandler,
    }),
  }
}
export const orderpointFunctions = createOrderpointFunctions()
