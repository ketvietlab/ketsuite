import { createHash, randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { minorText, multiplyToMinor, scaleOf } from '../account/money.ts'
import { currency, inUnit } from './functions/shared.ts'

export const supplierIssue = (code: string, field = 'changes') => ({
  ok: false as const,
  errors: [{ field, code: `purchase.error.suppliers.${code}` }],
})
export class SupplierRefused extends Error {
  readonly result: ReturnType<typeof supplierIssue>
  constructor(result: ReturnType<typeof supplierIssue>) {
    super('Supplier grid refused')
    this.result = result
  }
}

export async function supplierRows(ctx: Ctx, templateId: unknown): Promise<Row[]> {
  return (await ctx.db.select('purchase.SupplierInfo', { productTemplateId: templateId }))
    .filter((row) => String(row.companyId) === ctx.scope.company)
    .sort(
      (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0) || String(a.id).localeCompare(String(b.id)),
    )
}

const revisionFields = [
  'id',
  'partnerId',
  'productId',
  'productUomId',
  'productName',
  'productCode',
  'minQty',
  'price',
  'discount',
  'delay',
  'sequence',
  'dateStart',
  'dateEnd',
]
export const supplierRowsKey = (rows: Row[]) =>
  JSON.stringify(rows.map((row) => revisionFields.map((field) => row[field] ?? null)))

/** The public revision never hashes hidden price data. Every supplier writer advances the product revision. */
export function supplierRevision(template: Row): string {
  return createHash('sha256')
    .update(JSON.stringify([template.id, template.revisionId ?? null]))
    .digest('hex')
}

/** The caller owns the transaction; catalogue edits and supplier writes lock the same product. */
export async function lockSupplierTemplate(
  ctx: Ctx,
  templateId: unknown,
  field = 'templateId',
): Promise<Row> {
  const template = (await ctx.db.select('product.Template', { id: templateId }))[0]
  if (!template || template.active === false || template.purchaseOk !== true || template.type === 'combo')
    throw new SupplierRefused(supplierIssue('notEditable', field))
  const locked = await ctx.db.compareAndSet(
    'product.Template',
    { id: template.id },
    { revisionId: template.revisionId ?? null },
    { revisionId: template.revisionId ?? null },
  )
  if (!('dryRun' in locked) && !locked.matched) throw new SupplierRefused(supplierIssue('conflict'))
  return template
}

export async function touchSupplierTemplate(ctx: Ctx, template: Row) {
  await ctx.db.update('product.Template', { id: template.id }, { revisionId: randomUUID() })
}

/** Project legacy supplier-unit rows into the product's unit without rewriting their stored values. */
export async function projectSupplier(ctx: Ctx, template: Row, row: Row, money: boolean): Promise<Row> {
  const quantity = await inUnit(ctx, Number(row.minQty), row.productUomId, template.uomId)
  const factor = await inUnit(ctx, 1, template.uomId, row.productUomId)
  if (quantity === null || factor === null) throw new SupplierRefused(supplierIssue('unit'))
  const partner = (await ctx.db.select('partner.Partner', { id: row.partnerId }))[0]
  const scale = scaleOf(await currency(ctx))
  return {
    id: String(row.id),
    partnerId: String(row.partnerId),
    vendor: String(partner?.name ?? row.partnerId),
    productId: row.productId == null ? '' : String(row.productId),
    productCode: String(row.productCode ?? ''),
    minQty: String(quantity),
    delay: Number(row.delay ?? 0),
    price: money ? minorText(multiplyToMinor([row.price ?? '0', String(factor)], scale), scale) : null,
  }
}
