import { randomUUID } from 'node:crypto'
import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../account/money.ts'
import { insertMoveHandler } from '../stock/functions/moves.ts'
import { InventoryRefused } from '../stock/inventory-validation.ts'
import { updatePickingState } from '../stock/stock-ledger.ts'
import { resizeComboDemand } from './combo-demand.ts'
import { invoicedQuantity } from './invoice-settlement.ts'
import { deleteLineCosts } from './line-cost.ts'
import { refreshDeliveredCosts } from './delivered-cost.ts'
import { editSaleLine } from './line-edit.ts'
import { writeQuotationLine } from './functions/lines.ts'
import { claimRevision, invalid, recompute, refreshStatus, SaleRefused } from './functions/shared.ts'
import { companyKey, ours } from './scope.ts'

const numeric = new Set(['productUomQty', 'priceUnit', 'discount'])
const same = (key: string, a: unknown, b: unknown) =>
  numeric.has(key) && a != null && b != null && a !== '' && b !== ''
    ? compareDecimals(String(a), String(b)) === 0
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const decimal = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
    : value
const blank = (value: unknown) => value == null || value === ''
const frozen = (line: Row) => line.lineKind === 'discount' || line.lineKind === 'reward'
// The grid shows its refusals above the lines, so a refusal about one line names it.
const named = (key: string, line: Row, params: Row = {}) => {
  const code = `sale.error.${key}`
  return new SaleRefused({
    ok: false,
    errors: [
      { field: 'changes', code, messageKey: code, params: { ...params, name: String(line.name ?? '') } },
    ],
  })
}
const orderChanged = () => new SaleRefused(invalid('expectedRevision', 'sale.error.orderChanged'))
const fresh = async (ctx: Ctx, order: Row) => (await ours(ctx, 'sale.Order', { id: order.id }))[0]!

/** A delivery, any invoice line or a delivered/invoiced count fixes a line's product and keeps it on the order. */
async function settled(ctx: Ctx, line: Row) {
  if (compareDecimals(line.qtyDelivered ?? '0', '0') > 0 || compareDecimals(line.qtyInvoiced ?? '0', '0') > 0)
    return true
  if ((await ctx.db.select('account.MoveLine', { saleLineId: line.id })).length) return true
  // A delivery completed with a backorder also closes the moves it left, at 0: those delivered nothing.
  return (await ctx.db.select('stock.Move', { saleLineId: line.id })).some(
    (move) => move.state === 'done' && Number(move.quantity) > 0,
  )
}

/** Cancel what the line still waits to deliver and detach those moves, so it can go or take another product. */
async function releaseDemand(ctx: Ctx, order: Row, line: Row, shown: Row = line) {
  if (await settled(ctx, line)) throw named('lineSettled', shown)
  try {
    if (line.productId) await resizeComboDemand(ctx, order, [line], '0')
  } catch (error) {
    // Goods already picked on the delivery stay until the warehouse puts them back.
    if (error instanceof InventoryRefused) throw named('linePicked', shown)
    throw error
  }
  for (const move of await ctx.db.select('stock.Move', { saleLineId: line.id }))
    await ctx.db.update('stock.Move', { id: move.id }, { saleLineId: null })
}

async function deleteLine(ctx: Ctx, line: Row) {
  await deleteLineCosts(ctx, 'lineId', line.id)
  const L = ctx.table('sale.OrderLine')
  await ctx.db.del(deleteFrom(L).where(eq(L.id, String(line.id))))
}

/** The order's delivery still open in its warehouse, which new demand joins instead of opening another. */
async function openDelivery(ctx: Ctx, order: Row) {
  for (const line of await ours(ctx, 'sale.OrderLine', { orderId: order.id }))
    for (const move of await ctx.db.select('stock.Move', { saleLineId: line.id })) {
      if (!move.pickingId || ['done', 'cancel'].includes(String(move.state))) continue
      const picking = (await ctx.db.select('stock.Picking', { id: move.pickingId }))[0]
      if (
        picking &&
        !['done', 'cancel'].includes(String(picking.state)) &&
        picking.pickingTypeId === `${String(order.warehouseId)}:outgoing`
      )
        return picking
    }
  return null
}

/** `held` is the delivery open before this save: lines it removed may have closed it, and it reopens. */
async function addDemand(ctx: Ctx, order: Row, line: Row, held: Row | null) {
  if (!line.productId || order.stockAuthority === 'external') return
  if (compareDecimals(line.productUomQty ?? '0', '0') <= 0) return
  const product = (await ctx.db.select('product.Product', { id: line.productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (template?.type !== 'goods') return
  const picking = held ?? (await openDelivery(ctx, order))
  if (!picking) return resizeComboDemand(ctx, order, [line], line.productUomQty)
  const now = (await ctx.db.select('stock.Picking', { id: picking.id }))[0]
  if (now?.state === 'cancel')
    await ctx.db.update(
      'stock.Picking',
      { id: picking.id },
      { state: picking.state === 'draft' ? 'draft' : 'confirmed' },
    )
  const id = companyKey(ctx, 'confirmed-grid-line', String(line.id), String(order.revision))
  const added = (await insertMoveHandler(ctx, {
    id,
    name: line.name,
    pickingId: picking.id,
    productId: line.productId,
    productUomId: line.productUomId,
    productUomQty: String(line.productUomQty),
    origin: order.name,
  })) as Row
  if (added.ok !== true) throw new SaleRefused(added)
  await ctx.db.update('stock.Move', { id }, { saleLineId: line.id })
  await updatePickingState(ctx, picking.id)
}

/** Write a line and the stock its goods (or its combo's items) now need. */
async function writeLine(ctx: Ctx, order: Row, args: Row, held: Row | null) {
  const written = await writeQuotationLine(ctx, args, undefined, [], undefined, true)
  if (written.ok !== true) throw new SaleRefused(written as Row)
  const current = await fresh(ctx, order)
  const line = (await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]!
  const items = await ours(ctx, 'sale.OrderLine', { comboParentId: line.id })
  for (const item of items.length ? items : [line]) await addDemand(ctx, current, item, held)
}

/** A grid value as the shared line writer takes it: an empty price is the pricelist's, an empty tax none. */
const lineArgs = (values: Row) => {
  const { priceAutomatic, taxId, ...rest } = values
  const automatic = priceAutomatic === true || blank(values.priceUnit)
  return {
    ...rest,
    productUomQty: decimal(values.productUomQty ?? '1'),
    priceUnit: automatic ? undefined : decimal(values.priceUnit),
    priceAutomatic: automatic,
    discount: blank(values.discount) ? undefined : decimal(values.discount),
    ...(Object.hasOwn(values, 'taxId') ? { taxIds: taxId ? [taxId] : [] } : {}),
  }
}

/** Added lines take their place in the grid's order, as on a quotation; the rest keep theirs. */
async function arrange(
  ctx: Ctx,
  current: Row,
  lines: Row[],
  gone: Set<string>,
  added: { id: string; index: number; values: Row }[],
  order: unknown,
  held: Row | null,
) {
  const kept = lines.filter((line) => !gone.has(String(line.id)))
  const placed: Row[] = [...kept]
  const aliases = new Map<string, string>()
  for (const entry of added) {
    if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index > placed.length)
      throw new SaleRefused(invalid('changes', 'sale.error.gridOrder'))
    const id = randomUUID()
    aliases.set(entry.id, id)
    placed.splice(entry.index, 0, { id, entry })
  }
  let ordered = placed
  if (order !== null) {
    const ids = (order as unknown[]).map((id) => (typeof id === 'string' ? (aliases.get(id) ?? id) : ''))
    const byId = new Map(placed.map((line) => [String(line.id), line]))
    if (ids.length !== placed.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id)))
      throw new SaleRefused(invalid('changes', 'sale.error.gridOrder'))
    ordered = ids.map((id) => byId.get(id)!)
  }
  if (ordered.length > 100) throw new SaleRefused(invalid('changes', 'sale.error.gridTooMany'))
  // Wide steps leave room after each line for the items a new combo writes behind it.
  for (const [index, line] of ordered.entries()) {
    const sequence = (index + 1) * 100
    const entry = line.entry as { values: Row } | undefined
    if (!entry) {
      if (Number(line.sequence) !== sequence)
        await ctx.db.update('sale.OrderLine', { id: line.id }, { sequence })
      continue
    }
    const { displayType, name } = entry.values
    await writeLine(
      ctx,
      current,
      displayType
        ? { id: line.id, orderId: current.id, displayType, name, productUomQty: '0', sequence }
        : { ...lineArgs(entry.values), id: line.id, orderId: current.id, sequence },
      held,
    )
  }
}

/**
 * The grid of a confirmed order (D33b; mock `applyGridLines`). Lines keep their IDs and the history of
 * their deliveries and invoices; one without either may also be removed or take another product, which
 * cancels what it waited to deliver. New lines bring their own demand. On a quotation with history
 * (`structure` false) saved lines keep their product and their place. Caller owns the transaction.
 */
export async function applyConfirmedGrid(
  ctx: Ctx,
  order: Row,
  lines: Row[],
  changes: Row,
  structure = order.state === 'sale',
) {
  const added = changes.added as { id: string; index: number; values: Row }[]
  const removed = changes.removed as string[]
  const updated = changes.updated as { id: string; values: Row }[]
  if (!structure && (added.length || removed.length || changes.order !== null))
    return invalid('changes', 'sale.error.historyGridStructure')
  const known = new Map(lines.map((line) => [String(line.id), line]))
  const swapped = new Set(
    structure
      ? updated
          .filter(({ id, values }) =>
            ['productId', 'productUomId'].some(
              (key) => Object.hasOwn(values, key) && (values[key] ?? null) !== (known.get(id)![key] ?? null),
            ),
          )
          .map(({ id }) => id)
      : [],
  )
  let expectedRevision = order.revision
  const restructured = !!(added.length || removed.length || changes.order !== null)
  if (restructured || swapped.size) {
    if (!(await claimRevision(ctx, order, order.revision))) throw orderChanged()
    const current = await fresh(ctx, order)
    const held = await openDelivery(ctx, current)
    const gone = new Set<string>()
    for (const id of removed) {
      const line = known.get(id)!
      if (frozen(line)) throw new SaleRefused(invalid('changes', 'sale.error.discountLocked'))
      if (line.comboParentId) {
        // A combo's item goes with its combo, which the same save may remove.
        if (removed.includes(String(line.comboParentId))) continue
        throw named('comboItemRemove', known.get(String(line.comboParentId)) ?? line)
      }
      const items = lines.filter((item) => item.comboParentId === line.id)
      // A combo goes with its items; an invoice may name the combo line itself.
      for (const item of [...items, line]) await releaseDemand(ctx, current, item, line)
      for (const item of [...items, line]) {
        await deleteLine(ctx, item)
        gone.add(String(item.id))
      }
    }
    for (const { id, values } of updated.filter((entry) => swapped.has(entry.id))) {
      const line = known.get(id)!
      if (frozen(line)) throw new SaleRefused(invalid('changes', 'sale.error.discountLocked'))
      if (line.displayType) throw new SaleRefused(invalid('changes', 'sale.error.gridFields'))
      if (line.comboParentId || line.comboBasePrice != null)
        throw new SaleRefused(invalid('changes', 'sale.error.confirmedGridIdentity'))
      const productId = Object.hasOwn(values, 'productId') ? values.productId : line.productId
      if (!productId) throw new SaleRefused(invalid('changes', 'sale.error.gridProductUnit'))
      await releaseDemand(ctx, current, line)
      await deleteLine(ctx, line)
      const product = productId !== line.productId
      const args = lineArgs({ productUomQty: line.productUomQty, ...values })
      // Another product takes its own name and pricelist price, as on a quotation; the typed rest stays.
      await writeLine(
        ctx,
        current,
        {
          ...args,
          orderId: order.id,
          id: line.id,
          sequence: line.sequence,
          productId,
          productUomId: Object.hasOwn(values, 'productUomId')
            ? values.productUomId || undefined
            : product
              ? undefined
              : line.productUomId,
          name: blank(values.name) ? (product ? undefined : line.name) : values.name,
          discount: args.discount ?? (args.priceAutomatic ? undefined : line.discount),
          taxIds: args.taxIds ?? line.taxIds ?? [],
        },
        held,
      )
    }
    if (restructured) await arrange(ctx, current, lines, gone, added, changes.order, held)
    expectedRevision = (await fresh(ctx, order)).revision
  }
  for (const entry of updated) {
    if (swapped.has(entry.id)) continue
    const line = known.get(entry.id)!
    const patch = Object.fromEntries(
      Object.entries(entry.values).filter(([key, value]) => !same(key, value, line[key])),
    )
    if (!Object.keys(patch).length) continue
    if (frozen(line) || line.comboParentId)
      throw new SaleRefused(invalid('changes', 'sale.error.discountLocked'))
    if (['productId', 'productUomId', 'displayType'].some((key) => Object.hasOwn(patch, key)))
      throw new SaleRefused(invalid('changes', 'sale.error.confirmedGridIdentity'))
    if (line.comboBasePrice != null && Object.keys(patch).some((key) => key !== 'productUomQty'))
      throw new SaleRefused(invalid('changes', 'sale.error.comboHistory'))
    const current = await fresh(ctx, order)
    if (Number(current.revision) !== Number(expectedRevision)) throw orderChanged()
    if (line.displayType) {
      if (Object.keys(patch).some((key) => key !== 'name') || !String(patch.name ?? '').trim())
        throw new SaleRefused(invalid('changes', 'sale.error.gridFields'))
      if (!(await claimRevision(ctx, current, current.revision))) throw orderChanged()
      await ctx.db.update('sale.OrderLine', { id: line.id }, { name: String(patch.name).trim() })
      expectedRevision = Number(current.revision) + 1
      continue
    }
    const result = await editSaleLine(
      ctx,
      {
        ...patch,
        id: line.id,
        expectedRevision: current.revision,
        productUomQty: String(patch.productUomQty ?? line.productUomQty),
        ...(Object.hasOwn(patch, 'priceUnit')
          ? {
              priceUnit:
                patch.priceUnit === '' || patch.priceUnit == null ? undefined : String(patch.priceUnit),
            }
          : {}),
        ...(patch.discount != null ? { discount: String(patch.discount) } : {}),
        ...(Object.hasOwn(patch, 'taxId') ? { taxIds: patch.taxId ? [patch.taxId] : [] } : {}),
      },
      false,
      'confirmed-grid',
    )
    if (result.ok !== true) {
      // Name the line and the least it may hold, as the mock does: the grid shows one summary for all lines.
      if (
        ((result as Row).errors as Row[] | undefined)?.some(
          (error) => error.message === 'sale.error.belowSettled',
        )
      ) {
        const invoiced = await invoicedQuantity(ctx, line)
        const delivered = String(line.qtyDelivered ?? '0')
        throw named('belowSettledNamed', line, {
          minimum: compareDecimals(invoiced, delivered) > 0 ? invoiced : delivered,
        })
      }
      throw new SaleRefused(result)
    }
    expectedRevision = (await fresh(ctx, order)).revision
    if (Object.hasOwn(patch, 'name')) {
      if (!String(patch.name ?? '').trim())
        throw new SaleRefused(invalid('name', 'sale.error.freeLineRequired'))
      await ctx.db.update('sale.OrderLine', { id: line.id }, { name: String(patch.name).trim() })
    }
  }
  if (restructured || swapped.size) {
    await recompute(ctx, order.id)
    await refreshStatus(ctx, order.id)
  }
  // A line written here took the catalogue cost again; what already left keeps its own (K25).
  await refreshDeliveredCosts(ctx, order.id)
  return { ok: true, id: order.id, revision: (await fresh(ctx, order)).revision }
}
