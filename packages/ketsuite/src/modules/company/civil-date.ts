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

/** The wall clock an instant shows in a zone, to the second, as if it were UTC. */
const wallClock = (instant: Date, timezone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const value = (key: string) => Number(parts.find((part) => part.type === key)?.value)
  return Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  )
}

/**
 * The instant a civil day (YYYY-MM-DD) names in a zone: at the time of day `keep` shows there, or
 * at midnight. A form that edits only the day keeps the hour it does not show.
 */
export function civilDayInstant(day: string, timezone: string, keep?: Date | string | null): string {
  const held = keep == null ? null : new Date(keep)
  const time = held && !Number.isNaN(held.getTime()) ? wallClock(held, timezone) % 86_400_000 : 0
  const desired = Date.parse(`${day}T00:00:00.000Z`) + time
  let guess = desired
  for (let attempt = 0; attempt < 3; attempt++) {
    const delta = desired - wallClock(new Date(guess), timezone)
    if (delta === 0) break
    guess += delta
  }
  return new Date(guess).toISOString()
}

export async function companyCivilDate(ctx: Ctx, instant: Date | string = new Date()): Promise<string> {
  const C = ctx.table('company.Company')
  const company = ctx.scope.company ? await ctx.db.one(from(C).where(eq(C.id, ctx.scope.company))) : null
  return civilDate(instant, String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh'))
}
