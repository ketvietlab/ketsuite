import { salesConfiguration } from '../configuration.ts'
import { orderSalesWarnings } from '../warnings.ts'
import { defineFn, type Ctx, type Row } from '@ketvietlab/ketjs'
import { partnerSalesWarning, savePartnerSalesWarning, warningReadEffects } from '../warnings.ts'
import { saleRecordResult } from '../record-result.ts'
export async function getPartnerWarningHandler(ctx: Ctx, args: Row) {
  return partnerSalesWarning(ctx, args.partnerId)
}
export async function savePartnerWarningHandler(ctx: Ctx, args: Row) {
  return saleRecordResult(await savePartnerSalesWarning(ctx, args))
}
export async function getWarningSettingsHandler(ctx: Ctx) {
  return { enabled: (await salesConfiguration(ctx)).saleWarnings === true }
}
export async function previewWarningsHandler(ctx: Ctx, args: Row) {
  const ids = args.productIds
  if (!Array.isArray(ids) || ids.length > 500 || ids.some((id) => typeof id !== 'string' || id.length > 200))
    return { warnings: [] }
  return {
    warnings: await orderSalesWarnings(
      ctx,
      { state: 'draft', partnerId: args.partnerId },
      ids.map((productId) => ({ productId })),
    ),
  }
}
export const warningFunctions = {
  getWarningSettings: defineFn({
    input: {},
    effects: ['read:sale.Configuration'],
    agent: true,
    handler: getWarningSettingsHandler,
  }),
  previewWarnings: defineFn({
    input: { partnerId: 'id?', productIds: 'json' },
    effects: [...warningReadEffects],
    agent: true,
    handler: previewWarningsHandler,
  }),
  getPartnerWarning: defineFn({
    input: { partnerId: 'id' },
    effects: [...warningReadEffects],
    agent: true,
    handler: getPartnerWarningHandler,
  }),
  savePartnerWarning: defineFn({
    input: { partnerId: 'id', message: 'text', expectedRevision: 'int' },
    effects: [...warningReadEffects, 'write:sale.Configuration', 'write:sale.PartnerWarning'],
    idempotent: true,
    agent: true,
    handler: savePartnerWarningHandler,
  }),
}
