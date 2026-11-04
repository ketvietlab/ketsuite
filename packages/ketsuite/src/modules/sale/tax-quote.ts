import { quoteTaxLine } from '../account/tax-quote.ts'
import type { Ctx } from '@ketvietlab/ketjs'

/** Quotations may keep unselected lines; posting callers retain strictly positive quantities. */
export const quoteSaleLine = (ctx: Ctx, input: Parameters<typeof quoteTaxLine>[1]) =>
  quoteTaxLine(ctx, input, { allowZeroQuantity: true })
