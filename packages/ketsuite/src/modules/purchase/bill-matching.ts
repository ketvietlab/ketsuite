import { deleteFrom, eq, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import {
  absDecimalText,
  addDecimals,
  canonicalDecimalText,
  compareDecimals,
  multiplyDecimals,
  negateDecimalText,
  subtractDecimals,
} from '../account/money.ts'
import { purchaseConfiguration } from './approval.ts'
import { receivedQuantity } from './order-amounts.ts'
import { inUnit, productContext, quantityText } from './functions/shared.ts'

/**
 * Vendor bill matching (#1737).
 *
 * A vendor bill line that comes from a purchase line is compared with it when the
 * bill is posted: the quantity billed so far, this bill included, may not exceed
 * what the line allows (received, or ordered under the ordered-quantity policy),
 * and, when the company sets a price tolerance, the net unit price may not differ
 * from the order's by more than that percentage. A bill without purchase lines is
 * not compared. Credit notes are not compared; they lower what was billed.
 */
export const BILL_MATCH_READS = [
  'read:account.Move',
  'read:account.MoveLine',
  'read:purchase.Order',
  'read:purchase.OrderLine',
  'read:purchase.Configuration',
  'read:purchase.BillHold',
  'read:stock.Move',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
] as const

export type BillMatchLine = {
  id: string
  purchaseLineId: string
  orderId: string
  orderName: string
  name: string
  /** The purchase line's quantities, in its unit. */
  ordered: string
  received: string
  allowed: string
  /** Billed on other posted bills, credit notes deducted. */
  billedBefore: string
  /** This bill line, in the purchase line's unit. */
  quantity: string
  /** Net unit prices (after discount) per purchase line unit. */
  expectedPrice: string
  price: string
  /** How far the bill's net price is from the order's, in percent; null when the order price is zero. */
  drift: number | null
  quantityIssue: boolean
  priceIssue: boolean
}

export type BillHoldFacts = { reason: string; heldBy: string | null; heldAt: string }

export type BillMatch = {
  /** `none` for a bill with no purchase lines, which is not compared. */
  status: 'none' | 'ok' | 'mismatch'
  tolerance: string | null
  lines: BillMatchLine[]
  hold: BillHoldFacts | null
}

const percentLeft = (discount: unknown) => subtractDecimals('100', discount ?? '0')

export async function billHold(ctx: Ctx, moveId: unknown): Promise<BillHoldFacts | null> {
  const row = (await ctx.db.select('purchase.BillHold', { moveId }))[0]
  return row
    ? {
        reason: String(row.reason),
        heldBy: row.heldBy == null ? null : String(row.heldBy),
        heldAt: String(row.heldAt),
      }
    : null
}

/** The purchase-line quantity a bill line stands for, and the factor from its unit to the line's. */
async function inOrderUnit(ctx: Ctx, billLine: Row, purchaseLine: Row) {
  if (!billLine.productUomId || billLine.productUomId === purchaseLine.productUomId)
    return { quantity: canonicalDecimalText(billLine.quantity ?? '0'), factor: '1' }
  const factor = await inUnit(ctx, 1, billLine.productUomId, purchaseLine.productUomId)
  if (factor === null || !(factor > 0))
    return { quantity: canonicalDecimalText(billLine.quantity ?? '0'), factor: '1' }
  return { quantity: quantityText(Number(billLine.quantity ?? 0) * factor), factor: String(factor) }
}

/** What other posted bills have billed of a purchase line, credit notes deducted, in its unit. */
async function billedElsewhere(ctx: Ctx, purchaseLine: Row, moveId: unknown): Promise<string> {
  let billed = '0'
  for (const line of await ctx.db.select('account.MoveLine', { purchaseLineId: purchaseLine.id })) {
    if (!line.productId || line.moveId === moveId) continue
    const move = (await ctx.db.select('account.Move', { id: line.moveId }))[0]
    if (move?.state !== 'posted') continue
    const { quantity } = await inOrderUnit(ctx, line, purchaseLine)
    billed = addDecimals(billed, move.moveType === 'in_refund' ? negateDecimalText(quantity) : quantity)
  }
  return billed
}

/** How a vendor bill compares with its purchase lines, line by line. */
export async function billMatch(ctx: Ctx, move: Row): Promise<BillMatch> {
  const config = await purchaseConfiguration(ctx)
  const tolerance = config.priceTolerance == null ? null : String(config.priceTolerance)
  const hold = await billHold(ctx, move.id)
  if (move.moveType !== 'in_invoice') return { status: 'none', tolerance, lines: [], hold }
  const billLines = (await ctx.db.select('account.MoveLine', { moveId: move.id }))
    .filter((line) => line.purchaseLineId && line.productId)
    .sort(
      (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0) || String(a.id).localeCompare(String(b.id)),
    )
  const purchaseLines = new Map<string, Row>()
  const orders = new Map<string, Row>()
  const billedHere = new Map<string, string>()
  const lines: BillMatchLine[] = []
  for (const billLine of billLines) {
    const key = String(billLine.purchaseLineId)
    if (!purchaseLines.has(key)) {
      const row = (await ctx.db.select('purchase.OrderLine', { id: billLine.purchaseLineId }))[0]
      if (!row) continue
      purchaseLines.set(key, row)
    }
    const purchaseLine = purchaseLines.get(key)!
    const orderKey = String(purchaseLine.orderId)
    if (!orders.has(orderKey))
      orders.set(orderKey, (await ctx.db.select('purchase.Order', { id: purchaseLine.orderId }))[0] ?? {})
    const context = await productContext(ctx, purchaseLine.productId)
    const method = String(
      context?.template.purchaseMethod ?? (context?.template.type === 'service' ? 'purchase' : 'receive'),
    )
    const ordered = canonicalDecimalText(purchaseLine.productQty ?? '0')
    const received = quantityText(await receivedQuantity(ctx, purchaseLine))
    const allowed = method === 'purchase' ? ordered : received
    const billedBefore = await billedElsewhere(ctx, purchaseLine, move.id)
    const { quantity, factor } = await inOrderUnit(ctx, billLine, purchaseLine)
    // Two lines of one bill for the same purchase line count together.
    const together = addDecimals(billedHere.get(key) ?? '0', quantity)
    billedHere.set(key, together)
    const quantityIssue = compareDecimals(addDecimals(billedBefore, together), allowed) > 0
    // Net prices times 100, per purchase line unit: the bill's is divided by `factor`, so compare
    // the order's multiplied by it instead and keep the arithmetic exact.
    const expected100 = multiplyDecimals(purchaseLine.priceUnit ?? '0', percentLeft(purchaseLine.discount))
    const actual100 = multiplyDecimals(billLine.priceUnit ?? '0', percentLeft(billLine.discount))
    const expectedScaled = multiplyDecimals(expected100, factor)
    const difference = absDecimalText(subtractDecimals(actual100, expectedScaled))
    const zero = compareDecimals(expectedScaled, '0') === 0
    const priceIssue =
      tolerance != null &&
      (zero
        ? compareDecimals(difference, '0') !== 0
        : compareDecimals(multiplyDecimals(difference, '100'), multiplyDecimals(tolerance, expectedScaled)) >
          0)
    const expectedPrice = Number(expected100) / 100
    const price = Number(actual100) / 100 / Number(factor)
    lines.push({
      id: String(billLine.id),
      purchaseLineId: key,
      orderId: orderKey,
      orderName: String(orders.get(orderKey)?.name ?? orderKey),
      name: String(billLine.name ?? purchaseLine.name ?? ''),
      ordered,
      received,
      allowed,
      billedBefore,
      quantity,
      expectedPrice: String(expectedPrice),
      price: String(price),
      drift: zero ? null : Math.round(((price - expectedPrice) / expectedPrice) * 10_000) / 100,
      quantityIssue,
      priceIssue,
    })
  }
  if (!lines.length) return { status: 'none', tolerance, lines, hold }
  return {
    status: lines.some((line) => line.quantityIssue || line.priceIssue) ? 'mismatch' : 'ok',
    tolerance,
    lines,
    hold,
  }
}

/** Why a bill cannot be posted: its first line over the quantity, else its first line off price. */
export function matchRefusal(match: BillMatch) {
  const over = match.lines.find((line) => line.quantityIssue)
  if (over)
    return {
      ok: false,
      errors: [
        {
          field: 'lines',
          code: 'purchase.error.bill.quantity',
          params: {
            line: over.name,
            order: over.orderName,
            billed: addDecimals(over.billedBefore, over.quantity),
            allowed: over.allowed,
          },
        },
      ],
    }
  const off = match.lines.find((line) => line.priceIssue)
  if (off)
    return {
      ok: false,
      errors: [
        {
          field: 'lines',
          code: 'purchase.error.bill.price',
          params: { line: off.name, order: off.orderName, tolerance: match.tolerance ?? '0' },
        },
      ],
    }
  return null
}

/**
 * `account.postMove` that first compares a draft vendor bill with its purchase lines and refuses
 * one that does not match. Posting a bill lifts its hold.
 */
export function withPurchaseBillMatching(spec: FnSpec): FnSpec {
  return {
    ...spec,
    effects: [...new Set([...(spec.effects ?? []), ...BILL_MATCH_READS, 'write:purchase.BillHold'])],
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('account.Move', { id: (args as Row).id }))[0]
      const bill = move?.state === 'draft' && move.moveType === 'in_invoice'
      if (bill) {
        const refusal = matchRefusal(await billMatch(ctx, move))
        if (refusal) return refusal
      }
      const result = await spec.handler(ctx, args)
      if (bill && (result as Row | null)?.ok === true) {
        const H = ctx.table('purchase.BillHold')
        await ctx.db.del(deleteFrom(H).where(eq(H.moveId, String(move.id))))
      }
      return result
    },
  }
}

/** Accounting with vendor bills compared to their purchase orders before they are posted. */
export function moduleWithPurchaseBillMatching<M extends { functions: Record<string, FnSpec> }>(
  module: M,
): M {
  const spec = module.functions.postMove
  if (!spec) throw new Error('moduleWithPurchaseBillMatching: no function postMove')
  return { ...module, functions: { ...module.functions, postMove: withPurchaseBillMatching(spec) } }
}
