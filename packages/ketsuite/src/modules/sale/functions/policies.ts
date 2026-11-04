import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { categoryPaths } from '../../product/category-tree.ts'
import { salesConfiguration, soldInvoicePolicy } from '../configuration.ts'
import { saleRecordResult } from '../record-result.ts'
import { INVOICE_POLICIES } from './shared.ts'

const own = (template: Row) =>
  INVOICE_POLICIES.includes(template.invoicePolicy as never) ? (template.invoicePolicy as string) : null

/** What decides a product's policy (D21): the company default, its own, or its being a service. */
export const policySetting = (template: Row): 'default' | 'own' | 'service' =>
  template.type !== 'goods' ? 'service' : own(template) ? 'own' : 'default'

/**
 * The company's products on sale with the policy their next sold line takes (D21). Goods follow the
 * company default (D20) unless they have their own; services are invoiced by what was ordered.
 */
export async function listInvoicePoliciesHandler(ctx: Ctx, args: Row = {}) {
  const ids = Array.isArray(args.ids) ? args.ids.map(String) : null
  const templates = (await ctx.db.select('product.Template', { saleOk: true })).filter(
    (row) => row.type !== 'combo' && row.active !== false && (!ids || ids.includes(String(row.id))),
  )
  const [config, variants, categories] = await Promise.all([
    salesConfiguration(ctx),
    ctx.db.select('product.Product', {}),
    ctx.db.select('product.Category', {}),
  ])
  const paths = categoryPaths(categories)
  return templates
    .map((template) => ({
      id: template.id,
      name: template.name,
      type: template.type,
      defaultCode: variants
        .filter((row) => row.templateId === template.id && row.active !== false && row.defaultCode)
        .map((row) => String(row.defaultCode))
        .sort()
        .join(', '),
      categoryName: paths.get(String(template.categoryId)) ?? '',
      invoicePolicy: template.type === 'goods' ? own(template) : null,
      policy: soldInvoicePolicy(template, config),
      setting: policySetting(template),
      revisionId: template.revisionId ?? null,
    }))
    .sort(
      (a, b) =>
        a.defaultCode.localeCompare(b.defaultCode) ||
        String(a.name).localeCompare(String(b.name), 'vi') ||
        String(a.id).localeCompare(String(b.id)),
    )
}

/** One company-scoped fact for a product workspace, without catalogue/pricing data. */
export async function getProductInvoicePolicyHandler(ctx: Ctx, args: Row) {
  const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
  if (!template || template.type === 'combo') return null
  return { invoicePolicy: soldInvoicePolicy(template, await salesConfiguration(ctx)) }
}

const refuse = (field: string, code: string) => ({ ok: false, errors: [{ field, message: code }] })

/**
 * Sets a goods product's own policy, or clears it (null or empty) so the product follows the company
 * default again. Quotations confirmed and lines added afterwards take it; sold lines keep theirs.
 */
async function setInvoicePolicy(ctx: Ctx, args: Row) {
  const policy = args.invoicePolicy == null || args.invoicePolicy === '' ? null : String(args.invoicePolicy)
  if (policy !== null && !INVOICE_POLICIES.includes(policy as never))
    return refuse('invoicePolicy', 'sale.error.invoicePolicy.value')
  const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
  if (!template) return refuse('templateId', 'sale.error.invoicePolicy.missing')
  if (template.type === 'combo') return refuse('templateId', 'sale.error.invoicePolicy.combo')
  if (template.type !== 'goods') return refuse('invoicePolicy', 'sale.error.invoicePolicy.service')
  if (args.expectedRevisionId != null && args.expectedRevisionId !== (template.revisionId ?? ''))
    return refuse('expectedRevisionId', 'sale.error.invoicePolicy.changed')
  if (own(template) === policy) return { ok: true, id: template.id }
  const held = await ctx.db.compareAndSet(
    'product.Template',
    { id: template.id },
    { revisionId: template.revisionId ?? null },
    { invoicePolicy: policy, revisionId: randomUUID() },
  )
  if (!('dryRun' in held) && !held.matched)
    return refuse('expectedRevisionId', 'sale.error.invoicePolicy.changed')
  return { ok: true, id: template.id }
}

export async function setInvoicePolicyHandler(ctx: Ctx, args: Row) {
  return saleRecordResult(await setInvoicePolicy(ctx, args))
}

export const policiesFunctions: Record<string, FnSpec> = {
  getProductInvoicePolicy: defineFn({
    input: { templateId: 'id' },
    effects: ['read:product.Template', 'read:sale.Configuration'],
    agent: true,
    handler: getProductInvoicePolicyHandler,
  }),
  listInvoicePolicies: defineFn({
    input: { ids: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:product.Category',
      'read:sale.Configuration',
    ],
    agent: true,
    handler: listInvoicePoliciesHandler,
  }),
  setInvoicePolicy: defineFn({
    input: { templateId: 'id', invoicePolicy: 'text?', expectedRevisionId: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: setInvoicePolicyHandler,
  }),
}
