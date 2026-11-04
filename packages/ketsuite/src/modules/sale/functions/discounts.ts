import { randomUUID } from 'node:crypto'
import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals, moneyMinor, minorText, percentOfMinor, scaleOf } from '../../account/money.ts'
import { quoteTaxLine } from '../../account/tax-quote.ts'
import { ours } from '../scope.ts'
import { claimRevision, recompute, SaleRefused } from './shared.ts'
import { linesFunctions, replaceQuotationLines } from './lines.ts'

const refusal = (key: string) => ({ ok: false, errors: [{ field: 'value', code: 'sale.error.' + key }] })
const regular = (line: Row) => !line.displayType && !['discount', 'reward'].includes(String(line.lineKind))

/** Replace the order discount as one revisioned action; no product placeholder is created. */
export const applyDiscountHandler = (ctx: Ctx, args: Row) => applyDiscount(ctx, args)

export async function applyDiscount(ctx: Ctx, args: Row, inTransaction = false) {
  if (args.label != null && (typeof args.label !== 'string' || args.label.length > 500))
    return refusal('freeLineRequired')
  if (!['order_percent', 'amount', 'line_percent'].includes(String(args.mode))) return refusal('discountMode')
  try {
    if (
      compareDecimals(args.value, '0') < 0 ||
      (args.mode !== 'amount' && compareDecimals(args.value, '100') > 0)
    )
      return refusal('discountValue')
  } catch {
    return refusal('discountValue')
  }
  try {
    const write = async (tx: Ctx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (
        !order ||
        !['draft', 'sent'].includes(String(order.state)) ||
        order.locked ||
        (order.orderAuthority && order.orderAuthority !== 'local')
      )
        return refusal('lineNotEditable')
      if (Number(args.expectedRevision) !== Number(order.revision)) return refusal('orderChanged')
      const lines = (await ours(tx, 'sale.OrderLine', { orderId: order.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
      )
      for (const line of lines) {
        if (
          (await tx.db.select('stock.Move', { saleLineId: line.id })).length ||
          (await tx.db.select('account.MoveLine', { saleLineId: line.id })).length
        )
          return refusal('gridHistory')
      }
      if (!(await claimRevision(tx, order))) return refusal('orderChanged')
      if (args.mode === 'line_percent') {
        await replaceQuotationLines(
          tx,
          order.id,
          lines.map((line) =>
            regular(line) && !line.comboParentId
              ? { ...line, discount: String(args.value), priceAutomatic: false }
              : line,
          ),
        )
      } else {
        const scale = scaleOf(order.currency)
        const groups = new Map<string, { taxIds: string[]; base: bigint }>()
        for (const line of lines.filter((line) => regular(line) && line.comboBasePrice == null)) {
          const base = moneyMinor(line.priceSubtotal, scale)
          if (base <= 0n) continue
          const taxIds = [
            ...new Set(
              (Array.isArray(line.taxIds) ? line.taxIds : line.taxId ? [line.taxId] : []).map(String),
            ),
          ].sort()
          const key = JSON.stringify(taxIds),
            group = groups.get(key) ?? { taxIds, base: 0n }
          group.base += base
          groups.set(key, group)
        }
        const all = [...groups.values()],
          base = all.reduce((sum, group) => sum + group.base, 0n)
        const amount =
          args.mode === 'amount' ? moneyMinor(args.value, scale) : percentOfMinor(base, args.value)
        if (amount > base || (!base && amount > 0n)) throw new SaleRefused(refusal('discountTooLarge'))
        const table = tx.table('sale.OrderLine')
        for (const line of lines.filter((line) => line.lineKind === 'discount' && !line.loyaltyApplicationId))
          await tx.db.del(deleteFrom(table).where(eq(table.id, String(line.id))))
        if (
          lines.filter((line) => line.lineKind !== 'discount' || line.loyaltyApplicationId).length +
            (amount ? all.length : 0) >
          100
        )
          throw new SaleRefused(refusal('gridTooMany'))
        let remaining = amount,
          sequence = Math.max(0, ...lines.map((line) => Number(line.sequence)))
        for (const [index, group] of all.entries()) {
          const allocated = index === all.length - 1 ? remaining : base ? (amount * group.base) / base : 0n
          remaining -= allocated
          if (!allocated) continue
          const quote = await quoteTaxLine(tx, {
            taxIds: group.taxIds,
            quantity: '1',
            priceUnit: minorText(-allocated, scale),
            discount: '0',
            allowNegativePrice: true,
            discountLine: true,
          })
          if (!quote.ok) throw new SaleRefused(quote)
          sequence += 100
          await tx.db.insert('sale.OrderLine', {
            id: randomUUID(),
            orderId: order.id,
            lineKind: 'discount',
            productId: null,
            productUomId: null,
            name: String(args.label || 'Discount'),
            productUomQty: '1',
            priceUnit: quote.priceUnit,
            priceAutomatic: false,
            discount: '0',
            taxId: quote.taxIds[0] ?? null,
            taxIds: quote.taxIds,
            taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
            qtyDelivered: '0',
            qtyInvoiced: '0',
            priceSubtotal: quote.amountUntaxed,
            priceSubtotalIncl: quote.amountTotal,
            sequence,
          })
        }
        await recompute(tx, order.id)
      }
      const saved = (await ours(tx, 'sale.Order', { id: order.id }))[0]!
      return { ok: true, id: order.id, revision: saved.revision }
    }
    return inTransaction ? await write(ctx) : await ctx.tx(write)
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}
export const discountFunctions = {
  applyDiscount: defineFn({
    input: { id: 'id', expectedRevision: 'int', mode: 'text', value: 'decimal', label: 'text?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [...linesFunctions.addLine!.effects!, 'read:stock.Move', 'read:account.MoveLine'],
    idempotent: true,
    agent: true,
    handler: applyDiscountHandler,
  }),
}
