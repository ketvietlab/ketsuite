import type { Ctx, Row } from '@ketvietlab/ketjs'
import { moneyMinor, scaleOf } from './money.ts'
import { accountsById } from './ledger.ts'

export const OPEN_ITEM_TYPES = ['asset_receivable', 'liability_payable']

export async function updatePaymentState(
  ctx: Ctx,
  moveId: unknown,
  accounts?: Map<string, Row>,
): Promise<void> {
  const move = (await ctx.db.select('account.Move', { id: moveId }))[0]
  if (!move || move.moveType === 'entry') return
  // A reversal settles the document; it must not be relabelled by the residual math.
  if (move.paymentState === 'reversed') return
  const byId = accounts ?? (await accountsById(ctx))
  const candidates = (await ctx.db.select('account.MoveLine', { moveId })).filter((line) =>
    OPEN_ITEM_TYPES.includes(String(byId.get(String(line.accountId))?.accountType)),
  )
  const scale = scaleOf(move.currency)
  const original = candidates.reduce((sum, line) => {
    const amount = moneyMinor(line.balance, scale)
    return sum + (amount < 0n ? -amount : amount)
  }, 0n)
  const residual = candidates.reduce((sum, line) => {
    const amount = moneyMinor(line.amountResidual, scale)
    return sum + (amount < 0n ? -amount : amount)
  }, 0n)
  const paymentState = residual === 0n ? 'paid' : residual < original ? 'partial' : 'not_paid'
  await ctx.db.update('account.Move', { id: moveId }, { paymentState })
}
