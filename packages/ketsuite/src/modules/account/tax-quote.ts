import type { Ctx, Row } from '@ketvietlab/ketjs'
import {
  canonicalDecimalText,
  compareDecimals,
  decimalSign,
  discountedLineMinor,
  divisionTaxMinor,
  includedDivisionBaseMinor,
  includedPercentBaseMinor,
  minorText,
  multiplyToMinor,
  percentOfMinor,
} from './money.ts'
import { invalid, Refusal, refused, n } from './validation.ts'
import { ledgerOf } from './ledger.ts'

const dayOf = (value: unknown): string | null =>
  value == null || value === '' ? null : String(value).slice(0, 10)

/** Whether a tax applies to a document dated `date` (YYYY-MM-DD); both ends are inclusive. */
export const taxInEffect = (tax: Row, date: string): boolean => {
  const from = dayOf(tax.validFrom)
  const to = dayOf(tax.validTo)
  return (from === null || from <= date) && (to === null || date <= to)
}

/**
 * Refunds and reversals settle a document of the rate's own period, so they keep the
 * rate after it ends: an 8% invoice of 2026 is credited at 8% in 2027.
 */
export const settlesEarlierDocument = (move: { moveType?: unknown; reversalOfId?: unknown }): boolean =>
  move.reversalOfId != null || ['out_refund', 'in_refund'].includes(String(move.moveType))

/** One tax's share of a line, carrying where it has to post. */
export type TaxShare = { taxId: unknown; name: string; accountId: unknown; amount: string }

/** A discount reduces the taxable base, never the per-unit fixed levy. */
export const discountTaxes = (taxes: readonly Row[]) =>
  taxes.filter((tax) => tax.amountType !== 'fixed').map((tax) => ({ ...tax, priceInclude: false }))

export type LineAmounts = { untaxed: string; tax: string; total: string; shares: TaxShare[] }

export const taxOrder = (a: Row, b: Row): number =>
  n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id))

/**
 * Apply a line's taxes in sequence.
 *
 * A tax marked `includeBaseAmount` adds its own amount to the base every later
 * tax is computed on — this is how import duty compounds into import VAT, which
 * is the case for a chart installed by a localization or configured by an operator.
 */
export function taxAmounts(
  taxes: readonly Row[],
  quantity: unknown,
  priceUnit: unknown,
  discount: unknown,
  scale: number,
): LineAmounts {
  const gross = discountedLineMinor(quantity, priceUnit, discount, scale)
  if (!taxes.length) {
    const amount = minorText(gross, scale)
    return { untaxed: amount, tax: minorText(0n, scale), total: amount, shares: [] }
  }

  const ordered = [...taxes].sort(taxOrder)
  const included = ordered.filter((tax) => tax.priceInclude === true)
  if (included.length && included.length !== ordered.length) throw new Refusal('taxMixedPriceInclude')
  if (included.length > 1) throw new Refusal('taxManyPriceInclude')

  const share = (tax: Row, base: bigint): bigint => {
    if (tax.amountType === 'fixed') return multiplyToMinor([tax.amount, quantity], scale)
    if (tax.amountType === 'percent') return percentOfMinor(base, tax.amount)
    if (tax.amountType === 'division') {
      if (compareDecimals(tax.amount, '100') >= 0) throw new Refusal('taxDivisionFull')
      return divisionTaxMinor(base, tax.amount)
    }
    throw new Refusal('taxComputationUnsupported')
  }

  if (included.length === 1) {
    const tax = ordered[0]!
    let untaxed = gross
    if (tax.amountType === 'fixed') {
      untaxed = gross - share(tax, gross)
      // A fixed tax said to be inside the price cannot be more than the price.
      // Left alone it makes the base negative, which posts a credit to revenue
      // as a debit and reverses the sign of the sale in the ledger.
      if (untaxed < 0n) throw new Refusal('taxFixedExceedsLine')
    } else if (tax.amountType === 'percent') untaxed = includedPercentBaseMinor(gross, tax.amount)
    else if (tax.amountType === 'division') {
      if (compareDecimals(tax.amount, '100') >= 0) throw new Refusal('taxDivisionFull')
      untaxed = includedDivisionBaseMinor(gross, tax.amount)
    } else throw new Refusal('taxComputationUnsupported')
    const amount = gross - untaxed
    return {
      untaxed: minorText(untaxed, scale),
      tax: minorText(amount, scale),
      total: minorText(untaxed + amount, scale),
      shares: [
        {
          taxId: tax.id,
          name: String(tax.name),
          accountId: tax.accountId ?? null,
          amount: minorText(amount, scale),
        },
      ],
    }
  }

  const shares: TaxShare[] = []
  let base = gross
  let total = 0n
  for (const tax of ordered) {
    const amount = share(tax, base)
    shares.push({
      taxId: tax.id,
      name: String(tax.name),
      accountId: tax.accountId ?? null,
      amount: minorText(amount, scale),
    })
    total += amount
    if (tax.includeBaseAmount === true) base += amount
  }
  return {
    untaxed: minorText(gross, scale),
    tax: minorText(total, scale),
    total: minorText(gross + total, scale),
    shares,
  }
}

export type TaxQuote = {
  ok: true
  currency: string
  scale: number
  quantity: string
  priceUnit: string
  discount: string
  amountUntaxed: string
  amountTax: string
  amountTotal: string
  taxIds: string[]
  taxes: Array<{
    id: string
    name: string
    amountType: string
    amount: string
    priceInclude: boolean
    includeBaseAmount: boolean
    sequence: number
    share: string
  }>
  shares: Array<{ taxId: unknown; name: string; amount: string }>
}

export type TaxQuoteRefusal = {
  ok: false
  errors: Array<{
    field: string
    message: string
    code?: string
    params?: Record<string, unknown>
  }>
}

/** Canonical product line calculation shared by Sales, POS and invoices. */
export async function quoteTaxLineForPosting(
  ctx: Ctx,
  input: {
    productId?: unknown
    taxIds?: unknown
    quantity: unknown
    priceUnit: unknown
    discount?: unknown
    taxUse?: 'sale' | 'purchase'
    /** Internal contra-line support; public product pricing remains non-negative. */
    allowNegativePrice?: boolean
    discountLine?: boolean
  },
  options: { allowZeroQuantity?: boolean } = {},
): Promise<(Omit<TaxQuote, 'shares'> & { shares: TaxShare[] }) | TaxQuoteRefusal> {
  let quantity: string
  let priceUnit: string
  let discount: string
  try {
    quantity = canonicalDecimalText(input.quantity)
    priceUnit = canonicalDecimalText(input.priceUnit)
    discount = canonicalDecimalText(input.discount ?? '0')
    if (decimalSign(quantity) < 0 || (decimalSign(quantity) === 0 && !options.allowZeroQuantity))
      return invalid('quantity', 'taxQuantityPositive')
    if (
      (!input.allowNegativePrice && decimalSign(priceUnit) < 0) ||
      (input.discountLine && decimalSign(priceUnit) > 0) ||
      decimalSign(discount) < 0 ||
      compareDecimals(discount, '100') > 0
    )
      return invalid('priceUnit', 'taxPriceInvalid')
  } catch {
    return invalid('priceUnit', 'taxPriceInvalid')
  }

  let wanted: string[]
  if (Array.isArray(input.taxIds)) wanted = [...new Set(input.taxIds.map(String))]
  else if (input.productId) {
    const product = (await ctx.db.select('product.Product', { id: input.productId }))[0]
    if (!product) return invalid('productId', 'productMissing')
    const mapping = (await ctx.db.select('account.ProductTax', { templateId: product.templateId }))[0]
    wanted = mapping?.taxId ? [String(mapping.taxId)] : []
  } else wanted = []

  const taxes: Row[] = []
  for (const id of wanted) {
    const tax = (await ctx.db.select('account.Tax', { id }))[0]
    if (!tax || tax.active === false) return invalid('taxIds', 'taxMissing')
    if (![input.taxUse ?? 'sale', 'none'].includes(String(tax.typeTaxUse)))
      return invalid('taxIds', 'taxDirectionMismatch', { name: tax.name })
    taxes.push(tax)
  }
  const { currency, scale } = await ledgerOf(ctx)
  try {
    const amounts = taxAmounts(
      input.discountLine ? discountTaxes(taxes) : taxes,
      quantity,
      priceUnit,
      discount,
      scale,
    )
    const shares = new Map(amounts.shares.map((share) => [String(share.taxId), share]))
    return {
      ok: true,
      currency,
      scale,
      quantity,
      priceUnit,
      discount,
      amountUntaxed: amounts.untaxed,
      amountTax: amounts.tax,
      amountTotal: amounts.total,
      taxIds: taxes.sort(taxOrder).map((tax) => String(tax.id)),
      taxes: taxes.sort(taxOrder).map((tax) => ({
        id: String(tax.id),
        name: String(tax.name),
        amountType: String(tax.amountType),
        amount: String(tax.amount),
        priceInclude: tax.priceInclude === true,
        includeBaseAmount: tax.includeBaseAmount === true,
        sequence: n(tax.sequence),
        share: shares.get(String(tax.id))?.amount ?? minorText(0n, scale),
      })),
      shares: amounts.shares,
    }
  } catch (error) {
    return refused('taxIds', error)
  }
}

/** Public calculation evidence intentionally excludes ledger account routing. */
export async function quoteTaxLine(
  ctx: Ctx,
  input: Parameters<typeof quoteTaxLineForPosting>[1],
  options: { allowZeroQuantity?: boolean } = {},
): Promise<TaxQuote | TaxQuoteRefusal> {
  const quote = await quoteTaxLineForPosting(ctx, input, options)
  if (quote.ok !== true) return quote
  return {
    ...quote,
    shares: quote.shares.map(({ accountId: _accountId, ...share }) => share),
  }
}
