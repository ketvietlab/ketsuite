import { localDayRange, type Ctx } from '@ketvietlab/ketjs'

/** Reading the company's calendar, for whoever checks a vendor price's validity. */
export const SUPPLIER_VALIDITY_EFFECTS = ['read:company.Company'] as const

export type SupplierValidity = 'current' | 'upcoming' | 'expired'

/** The calendar a vendor price's validity is read in: the active company's accounting timezone. */
export type CompanyCalendar = { timeZone: string; day: (at: string | Date) => string }

/**
 * A day without a time, as the price form posts it. KetJS keeps such a `datetime` as that day's
 * UTC midnight, whose first ten characters are the day.
 */
const SAVED_DAY = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z)?$/

export async function companyCalendar(ctx: Ctx): Promise<CompanyCalendar> {
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : undefined
  const timeZone = String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh')
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return { timeZone, day: (at) => format.format(new Date(at)) }
}

const text = (value: unknown): string | null =>
  value == null || value === '' ? null : value instanceof Date ? value.toISOString() : String(value)

/**
 * The span a bound covers, from its first instant to the instant after its last: a saved day covers
 * that whole day in the company calendar; any other value, as an API caller may send, is that instant.
 */
const span = (value: unknown, calendar: CompanyCalendar): [number, number] | null => {
  const bound = text(value)
  if (!bound) return null
  if (SAVED_DAY.test(bound)) {
    const [from, next] = localDayRange(bound.slice(0, 10), calendar.timeZone)
    return [Date.parse(from), Date.parse(next)]
  }
  const at = Date.parse(bound)
  return Number.isNaN(at) ? null : [at, at + 1]
}

/** Whether a vendor price applies at `at`; both bounds are inclusive. */
export const supplierValidity = (
  row: { dateStart?: unknown; dateEnd?: unknown },
  at: string | Date,
  calendar: CompanyCalendar,
): SupplierValidity => {
  const moment = new Date(at).getTime()
  const start = span(row.dateStart, calendar)
  const end = span(row.dateEnd, calendar)
  if (start && moment < start[0]) return 'upcoming'
  if (end && moment >= end[1]) return 'expired'
  return 'current'
}

/** A bound's calendar day (YYYY-MM-DD) for display, or null when the bound is open. */
export const validityDay = (value: unknown, calendar: CompanyCalendar): string | null => {
  const bound = text(value)
  if (!bound) return null
  return SAVED_DAY.test(bound) ? bound.slice(0, 10) : calendar.day(bound)
}
