import type { Ctx, Row } from '@ketvietlab/ketjs'
import { n } from '../../loyalty/engine.ts'
import { finalizeOrderLoyalty } from '../../loyalty/order-functions.ts'
import { ours } from '../../sale/scope.ts'
import { saleSnapshot } from './shared.ts'
import { loyaltyTransaction } from '../order-lifecycle.ts'

export async function backfillHandler(ctx: Ctx, args: Row) {
  const orders = (await ours(ctx, 'sale.Order', { state: 'sale' }))
    .filter((order) => order.loyaltyState !== 'finalized')
    .slice(n(args.offset), n(args.offset) + Math.max(1, n(args.limit ?? 100)))
  if (args.dryRun) return { ok: true, candidates: orders.map((order) => order.id), processed: 0 }
  const results: Row[] = []
  for (const held of orders) {
    const result = await loyaltyTransaction(ctx, async (tx) => {
      const order = await saleSnapshot(tx, String(held.id))
      if (!order) return { ok: false }
      const result = await finalizeOrderLoyalty(tx, { order }, { inTransaction: true })
      if (result.ok === true) await tx.db.update('sale.Order', { id: held.id }, { loyaltyState: 'finalized' })
      return result
    })
    results.push({ id: held.id, ok: result.ok })
  }
  return { ok: results.every((row) => row.ok), processed: results.length, results }
}
