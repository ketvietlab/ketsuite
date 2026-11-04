import type { Ctx, Row } from '@ketvietlab/ketjs'
import { canonicalDecimalText, minorText, moneyMinor, roundedQuotient } from '../account/money.ts'
import { functions as stockFunctions } from '../stock/functions.ts'
import { PICKING_NAME_EFFECTS } from '../stock/picking-names.ts'
import {
  invalid,
  n,
  quantityText,
  now,
  PurchaseRefused,
  claimRevision,
  inUnit,
  productContext,
} from './functions/shared.ts'
import { refreshInvoiceStatus } from './order-amounts.ts'
import {
  approvalEffects,
  clearApprovals,
  draftedByCaller,
  levelsFor,
  orderApprovals,
  pendingLevels,
  purchaseConfiguration,
  type ApprovalLevel,
} from './approval.ts'

export const confirmEffects = [
  'read:purchase.Order',
  'read:purchase.OrderLine',
  'write:purchase.Order',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:stock.PickingType',
  'read:stock.Picking',
  'write:stock.Picking',
  'read:stock.Move',
  'write:stock.Move',
  ...PICKING_NAME_EFFECTS,
  'read:company.Company',
  // Confirming settles the invoice status, which is read from the bills.
  'read:account.Move',
  'read:account.MoveLine',
] as const

export async function createReceipt(ctx: Ctx, order: Row) {
  const goods: Row[] = []
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId: order.id })) {
    const context = await productContext(ctx, line.productId)
    if (context && context.template.type !== 'service') goods.push(line)
  }
  if (!goods.length) return { ok: true }
  const companyCurrency = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency
  const pickingId = `${String(order.id)}:receipt`
  const created = (await stockFunctions.createPicking!.handler(ctx, {
    id: pickingId,
    pickingTypeId: order.pickingTypeId,
    scheduledDate: order.datePlanned,
    // A request from a reorder rule delivers where the rule restocks.
    ...(order.locationDestId ? { locationDestId: order.locationDestId } : {}),
  })) as Row
  if (created.ok !== true) return created
  // The receipt comes from the order's vendor.
  await ctx.db.update('stock.Picking', { id: pickingId }, { partnerId: order.partnerId ?? null })
  for (const line of goods) {
    const moveId = `${String(line.id)}:receipt`
    const context = await productContext(ctx, line.productId)
    const stockUom = context?.template.uomId ?? line.productUomId
    const quantity = await inUnit(ctx, n(line.productQty), line.productUomId, stockUom)
    if (quantity === null) return invalid('productUomId', 'ordered unit does not convert to the product unit')
    const moved = (await stockFunctions.addMove!.handler(ctx, {
      id: moveId,
      name: line.name,
      pickingId,
      productId: line.productId,
      productUomId: stockUom,
      productUomQty: quantityText(quantity),
      origin: order.name,
    })) as Row
    if (moved.ok !== true) return moved
    // The receipt is valued at the agreed net price per stock unit; a foreign-currency order
    // leaves it blank so stock falls back to its running average.
    const priceUnit =
      String(order.currency) === String(companyCurrency) && quantity > 0
        ? canonicalDecimalText(
            minorText(
              roundedQuotient(
                moneyMinor(line.priceSubtotal ?? '0', 6) * 1_000_000n,
                moneyMinor(quantityText(quantity), 6),
              ),
              6,
            ),
          )
        : null
    await ctx.db.update('stock.Move', { id: moveId }, { purchaseLineId: line.id, priceUnit })
  }
  return { ok: true, pickingId }
}

export const approvalConfirmEffects = [...confirmEffects, ...approvalEffects] as const

const refusal = (field: string, code: string, message: string) => ({
  ok: false,
  errors: [{ field, code: `purchase.error.approval.${code}`, message }],
})

/** Receive the order: its receipt, its state and its invoice status, inside the caller's transaction. */
async function place(tx: Ctx, order: Row): Promise<unknown> {
  // The receipt is a picking plus one move per line plus the order's own
  // state. A domain refusal rolls the entire graph back.
  const receipt = (await createReceipt(tx, order)) as Row
  if (receipt.ok !== true) throw new PurchaseRefused(receipt)
  await tx.db.update('purchase.Order', { id: order.id }, { state: 'purchase', dateApprove: now() })
  await refreshInvoiceStatus(tx, order.id)
  return receipt.pickingId
}

/**
 * Confirm an RFQ. The company's thresholds decide from the saved total whether it
 * needs approval; `requested` asks for a purchasing manager's approval even below
 * them. An order that needs approval waits for it instead of becoming an order.
 */
export async function confirm(ctx: Ctx, id: unknown, requested: boolean, expectedRevision?: unknown) {
  const order = (await ctx.db.select('purchase.Order', { id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  if (expectedRevision !== undefined && n(order.revision) !== n(expectedRevision))
    return invalid('expectedRevision', 'purchase order changed')
  // A repeated confirmation reports where the order already is; it never
  // turns a pending approval into an order.
  if (order.state === 'purchase' || order.state === 'to approve') return { ok: true, id, state: order.state }
  if (!['draft', 'sent'].includes(String(order.state)))
    return invalid('state', 'only an RFQ can be confirmed')
  if (!(await ctx.db.select('purchase.OrderLine', { orderId: id })).length)
    return invalid('lines', 'an RFQ needs at least one product line')
  try {
    let pickingId: unknown
    let levels = 0
    await ctx.tx(async (tx) => {
      const current = (await tx.db.select('purchase.Order', { id }))[0]
      if (!current || !(await claimRevision(tx, current, expectedRevision)))
        throw new PurchaseRefused(invalid('expectedRevision', 'purchase order changed'))
      levels = Math.max(levelsFor(await purchaseConfiguration(tx), current.amountTotal), requested ? 1 : 0)
      if (levels > 0) {
        await clearApprovals(tx, id)
        await tx.db.update('purchase.Order', { id }, { state: 'to approve', approvalLevels: levels })
        return
      }
      pickingId = await place(tx, current)
    })
    return {
      ok: true,
      id,
      state: levels > 0 ? 'to approve' : 'purchase',
      ...(pickingId ? { pickingId } : {}),
    }
  } catch (error) {
    if (error instanceof PurchaseRefused) return error.result
    throw error
  }
}

/**
 * Give an approval to an order waiting for one. A purchasing manager gives level
 * one; a final approver gives every level still pending. The order becomes an
 * order once nothing is pending. Whoever drafted the order cannot approve it.
 */
export async function approve(ctx: Ctx, id: unknown, as: ApprovalLevel, expectedRevision?: unknown) {
  const order = (await ctx.db.select('purchase.Order', { id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  if (expectedRevision !== undefined && n(order.revision) !== n(expectedRevision))
    return invalid('expectedRevision', 'purchase order changed')
  if (order.state === 'purchase') return { ok: true, id, state: order.state, pending: [] }
  if (order.state !== 'to approve') return invalid('state', 'order is not waiting for approval')
  if (draftedByCaller(ctx, order))
    return refusal('state', 'ownOrder', 'an order cannot be approved by the person who drafted it')
  try {
    let pickingId: unknown
    let remaining: ApprovalLevel[] = []
    await ctx.tx(async (tx) => {
      const current = (await tx.db.select('purchase.Order', { id }))[0]
      if (!current || current.state !== 'to approve' || !(await claimRevision(tx, current, expectedRevision)))
        throw new PurchaseRefused(invalid('expectedRevision', 'purchase order changed'))
      const pending = pendingLevels(current, await orderApprovals(tx, id))
      const giving = as === 'owner' ? pending : pending.filter((level) => level === 'manager')
      if (!giving.length)
        throw new PurchaseRefused(refusal('state', 'finalPending', 'the order waits for a final approval'))
      const at = now()
      for (const level of giving)
        await tx.db.insert('purchase.OrderApproval', {
          id: `${String(id)}:approval:${level}`,
          orderId: id,
          level,
          approvedBy: ctx.actor ?? null,
          approvedAt: at,
        })
      remaining = pending.filter((level) => !giving.includes(level))
      if (!remaining.length) pickingId = await place(tx, current)
    })
    return {
      ok: true,
      id,
      state: remaining.length ? 'to approve' : 'purchase',
      pending: remaining,
      ...(pickingId ? { pickingId } : {}),
    }
  } catch (error) {
    if (error instanceof PurchaseRefused) return error.result
    throw error
  }
}
