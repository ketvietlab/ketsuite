import { compareDecimals, minorText, moneyMinor, scaleOf } from '../../account/money.ts'
/** Allocation records must use the same exact units as the posted ledger. */
export const isExactCurrencyValue = (amount: string, currency: unknown): boolean => {
  try {
    const scale = scaleOf(currency)
    return compareDecimals(amount, minorText(moneyMinor(amount, scale), scale)) === 0
  } catch {
    return false
  }
}
