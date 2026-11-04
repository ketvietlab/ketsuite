/**
 * Text as a search compares it: lower case, accents and the Vietnamese đ folded away.
 * Production databases use the C collation, where ilike folds ASCII only, so catalogue
 * searches fold in memory with this instead.
 */
export const fold = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/gu, '').replace(/đ/gu, 'd')

/**
 * Names in the order a Vietnamese reader expects: Á beside A, Đ after D, numbers by value.
 * Databases order text by bytes (production runs the C collation), so catalogue lists
 * that sort by name do it in memory with this.
 */
export const compareNames: (left: string, right: string) => number = new Intl.Collator('vi', {
  numeric: true,
  sensitivity: 'base',
}).compare
