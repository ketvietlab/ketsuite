import type { Ctx } from '@ketvietlab/ketjs'
import { n } from './validation.ts'

export async function dueDate(ctx: Ctx, paymentTermId: unknown, date: Date): Promise<string> {
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
