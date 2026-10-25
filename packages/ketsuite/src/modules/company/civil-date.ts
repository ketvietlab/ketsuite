import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

export function civilDate(instant: Date | string, timezone = 'Asia/Ho_Chi_Minh'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant))
  const value = (key: string) => parts.find((part) => part.type === key)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

export async function companyCivilDate(ctx: Ctx, instant: Date | string = new Date()): Promise<string> {
  const C = ctx.table('company.Company')
  const company = ctx.scope.company ? await ctx.db.one(from(C).where(eq(C.id, ctx.scope.company))) : null
  return civilDate(instant, String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh'))
}
