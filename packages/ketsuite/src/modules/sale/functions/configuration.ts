import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { configurationEffects, lockSalesConfiguration, salesConfiguration } from '../configuration.ts'
import { saleRecordResult } from '../record-result.ts'
import { invalid } from './shared.ts'

const SETTINGS = [
  'requireProduct',
  'saleWarnings',
  'quotationValidityDays',
  'onlineSignature',
  'onlinePayment',
  'prepaymentPercent',
  'lockConfirmed',
  'goodsInvoicePolicy',
] as const

/** A prepayment share: more than 0 and at most 100 percent, to two decimals. */
const percent = (value: unknown) => {
  const raw = String(value ?? '').trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > 100) return null
  return String(Number(raw))
}

/**
 * Saves the company's sales settings (D20). A setting the caller leaves out keeps its value. Validity,
 * signature and payment apply to quotations created afterwards; locking and the goods invoicing policy
 * to quotations confirmed afterwards.
 */
export async function saveConfiguration(ctx: Ctx, args: Row) {
  return ctx.tx(async (tx) => {
    const config = await lockSalesConfiguration(tx)
    if (!config || Number(config.revision) !== Number(args.expectedRevision))
      return { ok: false, errors: [{ field: 'expectedRevision', code: 'sale.error.configurationChanged' }] }
    const next: Row = Object.fromEntries(
      SETTINGS.map((key) => [key, args[key] === undefined ? config[key] : args[key]]),
    )
    if (
      next.quotationValidityDays != null &&
      (!Number.isInteger(Number(next.quotationValidityDays)) ||
        Number(next.quotationValidityDays) < 1 ||
        Number(next.quotationValidityDays) > 365)
    )
      return invalid('quotationValidityDays', 'sale.error.configuration.validity')
    if (next.goodsInvoicePolicy !== 'order' && next.goodsInvoicePolicy !== 'delivery')
      return invalid('goodsInvoicePolicy', 'sale.error.configuration.invoicePolicy')
    if (next.prepaymentPercent != null && next.prepaymentPercent !== '') {
      const share = percent(next.prepaymentPercent)
      if (share === null) return invalid('prepaymentPercent', 'sale.error.configuration.prepayment')
      next.prepaymentPercent = share
    } else next.prepaymentPercent = null
    // Online payment asks for a share of the total up front.
    if (next.onlinePayment === true && next.prepaymentPercent === null)
      return invalid('prepaymentPercent', 'sale.error.configuration.prepayment')
    for (const key of ['requireProduct', 'saleWarnings', 'onlineSignature', 'onlinePayment', 'lockConfirmed'])
      next[key] = next[key] === true
    if (SETTINGS.every((key) => next[key] === config[key])) return { ok: true, ...config }
    const revision = Number(config.revision) + 1
    await tx.db.update('sale.Configuration', { id: config.id }, { ...next, revision })
    return { ok: true, id: config.id, ...next, revision }
  })
}
export const getConfigurationHandler = (ctx: Ctx) => salesConfiguration(ctx)
export const saveConfigurationHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await saveConfiguration(ctx, args))

export const configurationFunctions = {
  getConfiguration: defineFn({
    input: {},
    effects: ['read:sale.Configuration'],
    agent: true,
    handler: getConfigurationHandler,
  }),
  saveConfiguration: defineFn({
    input: {
      requireProduct: 'bool?',
      saleWarnings: 'bool?',
      quotationValidityDays: 'int?',
      onlineSignature: 'bool?',
      onlinePayment: 'bool?',
      prepaymentPercent: 'text?',
      lockConfirmed: 'bool?',
      goodsInvoicePolicy: 'text?',
      expectedRevision: 'int',
    },
    effects: [...configurationEffects],
    agent: true,
    idempotent: true,
    handler: saveConfigurationHandler,
  }),
}
