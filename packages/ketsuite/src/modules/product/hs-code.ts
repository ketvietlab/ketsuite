/**
 * A customs (HS) code on a template or a variant: four to ten digits, as the mock's
 * product commands accept (`design/product/editing.mjs`). Spaces and dots only group
 * it for reading (3304.99.30); the code is its digits.
 */
export const hsCodeDigits = (value: unknown): string | null => {
  const digits = String(value ?? '').replace(/[\s.]/gu, '')
  return digits === '' ? null : digits
}

export const hsCodeValid = (digits: string): boolean => /^\d{4,10}$/u.test(digits)
