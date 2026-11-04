export const APPLIED_ON = ['3_global', '2_product_category', '1_product', '0_product_variant'] as const
export const COMPUTE_PRICE = ['percentage', 'formula', 'fixed'] as const
export const PRICE_BASES = ['list_price', 'standard_price', 'pricelist'] as const

export const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

/**
 * A datetime as an instant, whichever adapter handed it over.
 *
 * SQLite gives back the ISO text that was written; Postgres stores TIMESTAMPTZ and
 * postgres.js parses it into a Date, whose `toString` is "Wed Aug 20 2026 …". A
 * string comparison between those two formats is not a date comparison at all — it
 * ranked every dated rule out of the running on Postgres and nowhere else.
 */
export const at = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isNaN(ms) ? null : ms
}
