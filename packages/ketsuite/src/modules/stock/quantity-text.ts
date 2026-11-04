/**
 * A stock quantity as the plain decimal the datastore stores.
 *
 * Quantities are summed as binary floats, so 0.3 − 0.1 − 0.2 lands on −2.8e-17, and
 * `String()` writes that as an exponent the datastore refuses. Anything below a
 * billionth of a unit is rounding residue, not stock.
 */
export const quantityText = (value: number): string => {
  const text = (Math.round(value * 1e9) / 1e9).toFixed(9).replace(/\.?0+$/u, '')
  return text === '-0' ? '0' : text
}
