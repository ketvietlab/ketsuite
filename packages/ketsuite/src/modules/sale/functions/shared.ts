import {
  configurationEffects,
  lineInvoicePolicy,
  lockSalesConfiguration,
  soldInvoicePolicy,
} from '../configuration.ts'
import { expectedDeliveryDate, deliverySchedule } from '../delivery-promise.ts'
import { from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { quoteSaleLine as quoteTaxLine } from '../tax-quote.ts'
import { compareDecimals, minorText, scaleOf, sumMoneyMinor } from '../../account/money.ts'
import { functions as stockFunctions } from '../../stock/functions.ts'
import { insertMoveHandler } from '../../stock/functions/moves.ts'
import { PICKING_NAME_EFFECTS } from '../../stock/picking-names.ts'
import { company, companyKey, ours } from '../scope.ts'
import { ORDER_EVENT_EFFECTS, recordOrderEvent } from '../order-history.ts'

export const SALE_STATES = ['draft', 'sent', 'sale', 'cancel'] as const
export const SALE_INVOICE_STATUSES = ['upselling', 'invoiced', 'to invoice', 'no'] as const
export const INVOICE_POLICIES = ['order', 'delivery'] as const
export const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
export const externalOrder = (order: Row | undefined) =>
  order?.orderAuthority != null && order.orderAuthority !== 'local'
export const authorityRefusal = () => invalid('orderAuthority', 'this order is managed by an external system')
export const n = (value: unknown) => Number(value ?? 0)
export const quantityRound = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
export const quantityText = (value: number) => String(quantityRound(value))
export const now = () => new Date().toISOString()
export const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

export async function companyCurrency(ctx: Ctx) {
  const row = (await ctx.db.select('company.Company', { id: company(ctx) }))[0]
  if (!row) throw new Error(`company ${company(ctx)} does not exist`)
  return String(row.currency)
}
/**
 * The next order number for this company.
 *
 * The sequence row is keyed by the company because `id` is a tenant-wide primary
 * key: keyed by the constant `'sale'`, the first company to raise an order owned
 * the only row there could ever be, and every other company either read a row it
 * could never write — the update pins the active company, so it matched nothing
 * and span out blaming concurrency — or found none at all and dereferenced
 * undefined. Numbers stay per-company, which the `(companyId, name)` index on
 * Order already assumed.
 */
export async function nextName(ctx: Ctx) {
  const id = companyKey(ctx, 'sale')
  await ctx.db.insertIfAbsent('sale.Sequence', { id, nextNumber: 1 })
  // Every order in the company funnels through this one row, so a bulk import
  // running in parallel is a stampede by design. Losing the compare-and-set is
  // normal there; what must not happen is giving up while the row is live —
  // that turns a perfectly valid order into a spurious failure. Retries back
  // off with jitter so the herd spreads out instead of colliding again.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const row = (await ours(ctx, 'sale.Sequence', { id }))[0]
    if (!row) throw new Error('sale sequence row disappeared while assigning a number')
    const current = n(row.nextNumber)
    const changed = await ctx.db.compareAndSet(
      'sale.Sequence',
      { id },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in changed || changed.matched) return `S${String(current).padStart(5, '0')}`
    if (attempt >= 2)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, 2 ** (attempt - 2)) * (0.5 + Math.random())),
      )
  }
  throw new Error('sale sequence did not settle after concurrent updates')
}
/**
 * When an invoice on this payment term falls due.
 *
 * `account` computes the same thing for the invoices it raises (its `dueDate`),
 * walking the term's lines and taking the latest maturity. Sale used to write the
 * invoice date into both date fields while still storing the term on the move,
 * so a thirty-day term produced an invoice that was overdue on the day it was
 * issued.
 */
export async function paymentTermDue(ctx: Ctx, paymentTermId: unknown, date: Date): Promise<string> {
  if (!paymentTermId) return date.toISOString()
  const lines = (await ctx.db.select('account.PaymentTermLine', { paymentId: paymentTermId })).sort(
    (a, b) => n(a.sequence) - n(b.sequence),
  )
  let latest = new Date(date)
  for (const line of lines) {
    const due = new Date(date)
    const days = n(line.nbDays)
    if (line.delayType === 'days_after') due.setUTCDate(due.getUTCDate() + days)
    else if (line.delayType === 'days_after_end_of_month') {
      due.setUTCMonth(due.getUTCMonth() + 1, 0)
      due.setUTCDate(due.getUTCDate() + days)
    } else if (line.delayType === 'days_after_end_of_next_month') {
      due.setUTCMonth(due.getUTCMonth() + 2, 0)
      due.setUTCDate(due.getUTCDate() + days)
    } else {
      due.setUTCDate(due.getUTCDate() + days)
      due.setUTCMonth(due.getUTCMonth() + 1, Math.max(1, Math.min(31, n(line.daysNextMonth) || 1)))
    }
    if (due > latest) latest = due
  }
  return latest.toISOString()
}

export async function contextOf(ctx: Ctx, productId: unknown) {
  if (!productId) return null
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) return null
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return template ? { product, template } : null
}
export async function recompute(ctx: Ctx, orderId: unknown) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return
  const scale = scaleOf(order.currency)
  const lines = await ours(ctx, 'sale.OrderLine', { orderId })
  const amounts = await Promise.all(
    lines.map(async (line) => {
      if (line.priceSubtotalIncl != null)
        return { untaxed: line.priceSubtotal, total: line.priceSubtotalIncl }
      // Rows written before Wave 1B have no stored inclusive total. Re-quote them through the same
      // account boundary; explicit [] preserves a historically tax-free line instead of applying a
      // product default that may have been configured later.
      const quote = await quoteTaxLine(ctx, {
        productId: line.productId,
        taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
        quantity: line.productUomQty,
        priceUnit: line.priceUnit,
        discount: line.discount,
      })
      if (quote.ok !== true) return { untaxed: line.priceSubtotal, total: line.priceSubtotal }
      return { untaxed: quote.amountUntaxed, total: quote.amountTotal }
    }),
  )
  const untaxed = sumMoneyMinor(
    amounts.map((line) => line.untaxed),
    scale,
  )
  const total = sumMoneyMinor(
    amounts.map((line) => line.total),
    scale,
  )
  const tax = total - untaxed
  await ctx.db.update(
    'sale.Order',
    { id: orderId },
    {
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(tax, scale),
      amountTotal: minorText(total, scale),
      revision: n(order.revision) + 1,
    },
  )
}
/**
 * The stock moves and invoice lines behind an order's lines.
 *
 * Both used to be found by reading the whole table and filtering in JS. A
 * tenant that has imported a real order history holds hundreds of thousands of
 * moves, so an order-detail page was reading the entire ledger to find the
 * handful of rows that belong to one order. The `saleLineId` relation is
 * auto-indexed, so these are index lookups now.
 */
export async function movesOf(ctx: Ctx, lineIds: string[]): Promise<Row[]> {
  if (!lineIds.length) return []
  const M = ctx.table('stock.Move')
  return ctx.db.all(from(M).where(inArray(M.saleLineId, lineIds)))
}
export async function invoiceLinesOf(ctx: Ctx, lineIds: string[]): Promise<Row[]> {
  if (!lineIds.length) return []
  const L = ctx.table('account.MoveLine')
  return ctx.db.all(from(L).where(inArray(L.saleLineId, lineIds)))
}

export async function statusOf(ctx: Ctx, orderId: unknown) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (order?.state !== 'sale') return 'no'
  if (order.invoiceAuthority != null && order.invoiceAuthority !== 'local') return 'no'
  let toInvoice = false,
    upselling = false,
    invoiced = false
  for (const line of await ours(ctx, 'sale.OrderLine', { orderId })) {
    if (line.displayType || line.comboBasePrice != null) continue
    const context = await contextOf(ctx, line.productId)
    const policy = lineInvoicePolicy(line, context?.template)
    const basis = policy === 'delivery' ? n(line.qtyDelivered) : n(line.productUomQty)
    if (basis - n(line.qtyInvoiced) > 0.000001) toInvoice = true
    if (policy === 'order' && line.productId && n(line.qtyDelivered) - n(line.productUomQty) > 0.000001)
      upselling = true
    if (n(line.qtyInvoiced) > 0) invoiced = true
  }
  return toInvoice ? 'to invoice' : upselling ? 'upselling' : invoiced ? 'invoiced' : 'no'
}
export async function refreshStatus(ctx: Ctx, orderId: unknown) {
  await ctx.db.update('sale.Order', { id: orderId }, { invoiceStatus: await statusOf(ctx, orderId) })
}

export type OrderLifecyclePhase = 'confirmed' | 'shipped' | 'delivered' | 'cancelled'

/**
 * Append one durable lifecycle fact for an order.
 *
 * The deterministic id and unique domain key make this safe to call from both
 * the mutation path and an idempotent replay. Downstream modules consume the
 * ledger independently; Sale does not know which bridges are installed.
 */
export async function recordOrderLifecycle(
  ctx: Ctx,
  orderId: unknown,
  phase: OrderLifecyclePhase,
  occurredAt = now(),
) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return
  await ctx.db.insertIfAbsent('sale.OrderLifecycleEvent', {
    id: companyKey(ctx, 'sale-order-lifecycle', String(orderId), phase),
    orderId,
    phase,
    orderRevision: order.revision ?? null,
    occurredAt,
    createdAt: now(),
  })
}

export const confirmEffects = [
  ...configurationEffects,
  'read:sale.Order',
  'read:sale.OrderLine',
  // Confirming fixes how each line is invoiced (D20).
  'write:sale.OrderLine',
  'write:sale.Order',
  'read:sale.OrderLifecycleEvent',
  'write:sale.OrderLifecycleEvent',
  ...ORDER_EVENT_EFFECTS,
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:stock.Warehouse',
  'read:stock.PickingType',
  'read:stock.Picking',
  'write:stock.Picking',
  'write:stock.Move',
  // A new delivery takes its warehouse's next number (K17).
  ...PICKING_NAME_EFFECTS,
] as const
/**
 * A refusal thrown so the transaction it happened inside rolls back.
 *
 * `adapter.tx` commits on a normal return, so a soft error returned from inside
 * one would commit the half-built delivery it is refusing over.
 */
export class SaleRefused extends Error {
  result: Row
  constructor(result: Row) {
    super('refused')
    this.result = result
  }
}

export const claimRevision = async (ctx: Ctx, order: Row, expectedRevision?: unknown): Promise<boolean> => {
  const revision = n(order.revision)
  if (expectedRevision !== undefined && revision !== n(expectedRevision)) return false
  const changed = await ctx.db.compareAndSet(
    'sale.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: revision + 1 },
  )
  return 'dryRun' in changed || changed.matched
}

export async function confirm(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
  options: { inTransaction?: boolean } = {},
) {
  const order = (await ours(ctx, 'sale.Order', { id }))[0]
  if (!order) return invalid('id', 'sales order does not exist')
  if (externalOrder(order)) return authorityRefusal()
  if (order.stockAuthority != null && !['local', 'external'].includes(String(order.stockAuthority)))
    return invalid('stockAuthority', 'unknown stock authority')
  if (expectedRevision !== undefined && n(order.revision) !== n(expectedRevision))
    return invalid('expectedRevision', 'sales order changed')
  if (order.state === 'sale') {
    await recordOrderLifecycle(ctx, id, 'confirmed')
    return { ok: true, id, state: 'sale' }
  }
  if (!['draft', 'sent'].includes(String(order.state)))
    return invalid('state', 'only a quotation can be confirmed')
  // One transaction for the picking, its moves, their links and the state
  // change. Unwrapped, a crash between `addMove` and the `saleLineId` update
  // left a move with no link back to its line — and `cancelOrder`, which finds
  // an order's moves by that link, could never cancel it: an orphan demanding
  // stock forever, on an order still reading draft.
  let pickingId: string | undefined
  try {
    const commit = async (tx: Ctx) => {
      const current = (await ours(tx, 'sale.Order', { id }))[0]
      if (!current || !(await claimRevision(tx, current, expectedRevision)))
        throw new SaleRefused(invalid('expectedRevision', 'sales order changed'))
      if (!['draft', 'sent'].includes(String(current.state)))
        throw new SaleRefused(invalid('state', 'only a quotation can be confirmed'))
      const config = await lockSalesConfiguration(tx)
      if (!config) throw new SaleRefused(invalid('configuration', 'sale.error.configurationChanged'))
      const lines = await ours(tx, 'sale.OrderLine', { orderId: id })
      const freeLine = lines.find(
        (line) =>
          !line.productId && !line.displayType && line.lineKind !== 'discount' && line.lineKind !== 'reward',
      )
      if (config.requireProduct && freeLine)
        throw new SaleRefused({
          ok: false,
          errors: [
            { field: 'lines', code: 'sale.error.productRequired', params: { name: String(freeLine.name) } },
          ],
        })
      if (
        !lines.some((line) => !line.displayType && line.lineKind !== 'discount' && line.lineKind !== 'reward')
      )
        throw new SaleRefused(invalid('lines', 'a quotation needs at least one product line'))
      const confirmedAt = now()
      const expectedDate = await expectedDeliveryDate(tx, { ...current, confirmedAt }, lines)
      const goods: Row[] = []
      for (const line of lines) {
        if (line.displayType) continue
        const context = await contextOf(tx, line.productId)
        // Each line keeps the invoicing policy it was sold with (D20).
        await tx.db.update(
          'sale.OrderLine',
          { id: line.id },
          { invoicePolicy: soldInvoicePolicy(context?.template, config) },
        )
        if (compareDecimals(line.productUomQty, '0') === 0) continue
        if (context && context.template.type === 'goods' && line.comboBasePrice == null) goods.push(line)
      }
      if (goods.length && current.stockAuthority !== 'external') {
        pickingId = `${String(id)}:delivery`
        const priorPicking = (await ours(tx, 'stock.Picking', { id: pickingId }))[0]
        const deliveryCycle = priorPicking?.state === 'cancel' ? `:${String(current.revision)}` : ''
        pickingId += deliveryCycle
        const created = (await stockFunctions.createPicking!.handler(tx, {
          id: pickingId,
          pickingTypeId: `${String(order.warehouseId)}:outgoing`,
          scheduledDate: await deliverySchedule(tx, current.commitmentDate || expectedDate || confirmedAt),
          moveType: current.shippingPolicy ?? 'direct',
        })) as Row
        if (created.ok !== true) throw new SaleRefused(created)
        // The delivery goes to the order's customer, and a return of it comes back from them (K19, K20).
        await tx.db.update('stock.Picking', { id: pickingId }, { partnerId: order.partnerId ?? null })
        for (const line of goods) {
          const moveId = `${String(line.id)}:delivery${deliveryCycle}`
          const moved = (await insertMoveHandler(tx, {
            id: moveId,
            name: line.name,
            pickingId,
            productId: line.productId,
            productUomId: line.productUomId,
            productUomQty: line.productUomQty,
            origin: order.name,
          })) as Row
          if (moved.ok !== true) throw new SaleRefused(moved)
          await tx.db.update('stock.Move', { id: moveId }, { saleLineId: line.id })
        }
      }
      // The order keeps the date it was raised with. Stamping now() here wrote
      // migration day onto every imported historical order the moment it was
      // confirmed, and revenue-by-date was silently wrong from then on.
      // A company that locks confirmed sales locks this one as it is confirmed (D20).
      await tx.db.update(
        'sale.Order',
        { id },
        { state: 'sale', confirmedAt, ...(config.lockConfirmed ? { locked: true } : {}) },
      )
      await recordOrderLifecycle(tx, id, 'confirmed')
      await recordOrderEvent(tx, id, { action: 'confirm' })
    }
    await (options.inTransaction ? commit(ctx) : ctx.tx(commit))
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
  await refreshStatus(ctx, id)
  return { ok: true, id, state: 'sale', ...(pickingId ? { pickingId } : {}) }
}
