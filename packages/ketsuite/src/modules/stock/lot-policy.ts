import type { Row } from '@ketvietlab/ketjs'

export const shelfLifeFields = ['shelfLifeMonths', 'bestBeforeDays', 'removalDays', 'alertDays'] as const
export const shelfLifeInput = Object.fromEntries(shelfLifeFields.map((field) => [field, 'int?']))
export const lotDateFields = [
  'manufacturingDate',
  'expirationDate',
  'bestBeforeDate',
  'removalDate',
  'alertDate',
] as const
export const lotDateInput = Object.fromEntries(lotDateFields.map((field) => [field, 'datetime?']))
const offsetFields = {
  bestBeforeDate: 'bestBeforeDays',
  removalDate: 'removalDays',
  alertDate: 'alertDays',
} as const
const DAY = 86_400_000

export const lotRefusal = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `stock.error.${code}` }],
})
export class LotRefused extends Error {
  readonly result: Row
  constructor(field: string, code: string) {
    super(code)
    this.result = lotRefusal(field, code)
  }
}

/** Empty settings stay empty; existing lots are never rewritten by product setup. */
export function shelfLifePatch(args: Row): Row {
  const patch: Row = {}
  for (const field of shelfLifeFields) {
    if (!Object.hasOwn(args, field)) continue
    const value = args[field] == null || args[field] === '' ? null : Number(args[field])
    if (
      value !== null &&
      (!Number.isSafeInteger(value) ||
        value < (field === 'shelfLifeMonths' ? 1 : 0) ||
        value > (field === 'shelfLifeMonths' ? 120 : 36500))
    )
      throw new LotRefused(field, field === 'shelfLifeMonths' ? 'shelfLifeMonths' : 'shelfLifeOffset')
    patch[field] = value
  }
  return patch
}

/** Calendar months, UTC, clamped to the last day rather than overflowing into another month. */
export function addShelfLifeMonths(value: string, months: number): string {
  const date = new Date(value)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, end))
  return date.toISOString()
}
const instant = (value: unknown): string | null => {
  if (value == null || value === '') return null
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) throw new LotRefused('expirationDate', 'lotDate')
  return date.toISOString()
}

/** Track generated values so shifting expiry preserves every explicitly overridden date. */
export function lotDatePatch(args: Row, existing: Row | undefined, template: Row): Row {
  const patch: Row = {}
  const automatic = { ...((existing?.automaticDates as Record<string, unknown> | null) ?? {}) }
  for (const field of lotDateFields) if (Object.hasOwn(args, field)) patch[field] = instant(args[field])
  const manufacture =
    patch.manufacturingDate !== undefined ? patch.manufacturingDate : existing?.manufacturingDate
  if (!existing && !patch.expirationDate && manufacture && template.shelfLifeMonths) {
    patch.expirationDate = addShelfLifeMonths(String(manufacture), Number(template.shelfLifeMonths))
    automatic.expirationDate = patch.expirationDate
  }
  const expiry = patch.expirationDate !== undefined ? patch.expirationDate : existing?.expirationDate
  if (manufacture && expiry && new Date(String(manufacture)).getTime() >= new Date(String(expiry)).getTime())
    throw new LotRefused('expirationDate', 'lotDateOrder')
  const expiryChanged = instant(expiry) !== instant(existing?.expirationDate)
  for (const [field, setting] of Object.entries(offsetFields)) {
    if (Object.hasOwn(args, field) && instant(args[field]) !== instant(existing?.[field])) {
      delete automatic[field]
      continue
    }
    const held = existing?.[field]
    if ((!existing || expiryChanged) && (!held || instant(held) === instant(automatic[field]))) {
      patch[field] =
        expiry && template[setting] != null
          ? new Date(new Date(String(expiry)).getTime() - Number(template[setting]) * DAY).toISOString()
          : null
      automatic[field] = patch[field]
    }
  }
  for (const field of Object.keys(offsetFields)) {
    const next = patch[field] !== undefined ? patch[field] : existing?.[field]
    if (next && expiry && new Date(String(next)).getTime() > new Date(String(expiry)).getTime())
      throw new LotRefused(field, 'lotDateOrder')
  }
  patch.automaticDates = automatic
  return patch
}

export function lotAvailable(lot: Row | undefined, at = Date.now()): boolean {
  if (!lot || lot.active === false || lot.quarantined === true) return false
  return ['expirationDate', 'removalDate'].every(
    (field) => !lot[field] || new Date(String(lot[field])).getTime() > at,
  )
}

export const fefoTime = (lot: Row | undefined): number => {
  const value = lot?.removalDate ?? lot?.expirationDate
  return value ? new Date(String(value)).getTime() : Number.POSITIVE_INFINITY
}
