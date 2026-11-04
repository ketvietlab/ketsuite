import type { Ctx, Row } from '@ketvietlab/ketjs'
import { companyKey, ours } from './scope.ts'

export const configurationEffects = ['read:sale.Configuration', 'write:sale.Configuration'] as const
export async function salesConfiguration(ctx: Ctx): Promise<Row> {
  const row = (await ours(ctx, 'sale.Configuration', { id: companyKey(ctx, 'sales') }))[0] ?? {
    id: companyKey(ctx, 'sales'),
    requireProduct: false,
    revision: 0,
  }
  return {
    ...row,
    saleWarnings: row.saleWarnings === true,
    quotationValidityDays: row.quotationValidityDays == null ? null : Number(row.quotationValidityDays),
    onlineSignature: row.onlineSignature === true,
    onlinePayment: row.onlinePayment === true,
    prepaymentPercent: row.prepaymentPercent == null ? null : String(Number(row.prepaymentPercent)),
    lockConfirmed: row.lockConfirmed === true,
    goodsInvoicePolicy: row.goodsInvoicePolicy === 'delivery' ? 'delivery' : 'order',
  }
}

/**
 * How a line is invoiced once sold: for goods, the product's own policy (D21), else the company's
 * default (D20). A service, or a line without a product, is invoiced by what was ordered.
 */
export function soldInvoicePolicy(template: Row | undefined, config: Row): 'order' | 'delivery' {
  if (template?.type !== 'goods') return 'order'
  if (template.invoicePolicy === 'order' || template.invoicePolicy === 'delivery')
    return template.invoicePolicy
  return config.goodsInvoicePolicy === 'delivery' ? 'delivery' : 'order'
}

/** The policy a line is invoiced by: the one it was sold with, else its product's (lines sold before D20). */
export const lineInvoicePolicy = (line: Row, template: Row | undefined): 'order' | 'delivery' =>
  line.invoicePolicy === 'delivery' || line.invoicePolicy === 'order'
    ? line.invoicePolicy
    : template?.invoicePolicy === 'delivery'
      ? 'delivery'
      : 'order'

/** Serialize policy changes and confirmations on the company policy row. */
export async function lockSalesConfiguration(ctx: Ctx): Promise<Row | null> {
  const id = companyKey(ctx, 'sales')
  await ctx.db.insertIfAbsent('sale.Configuration', { id, requireProduct: false, revision: 0 })
  const config = await salesConfiguration(ctx)
  const held = await ctx.db.compareAndSet(
    'sale.Configuration',
    { id },
    { revision: config.revision },
    { revision: config.revision },
  )
  return 'dryRun' in held || held.matched ? config : null
}
