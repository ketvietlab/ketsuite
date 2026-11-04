import type { Ctx, Row } from '@ketvietlab/ketjs'
import { ours } from './scope.ts'
import { invalid, externalOrder, authorityRefusal, n } from './functions/shared.ts'

export async function resetOrder(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order) return invalid('id', 'sales order does not exist')
  if (order.state !== 'cancel') return invalid('state', 'only a cancelled order can return to draft')
  if (externalOrder(order)) return authorityRefusal()
  await ctx.db.update(
    'sale.Order',
    { id: args.id },
    { state: 'draft', locked: false, confirmedAt: null, revision: n(order.revision) + 1 },
  )
  return { ok: true, id: args.id }
}
