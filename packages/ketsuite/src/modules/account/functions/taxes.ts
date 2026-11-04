import { saveProductTax } from '../product-tax.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { recordChange } from '../audit.ts'
import { canonicalDecimalText } from '../money.ts'
import { ACCOUNT_SETUP_EFFECTS, ensureCompanyAccounting } from '../setup.ts'
import { TAX_USES, TAX_AMOUNT_TYPES } from '../vocabulary.ts'
import { invalid } from '../validation.ts'
import { accountOf } from '../ledger.ts'
import { taxOrder, quoteTaxLine, taxInEffect } from '../tax-quote.ts'
import { narrow } from '../querying.ts'

export async function quoteLineHandler(ctx: Ctx, args: Row) {
  return quoteTaxLine(
    ctx,
    args as {
      productId?: unknown
      taxIds?: unknown
      quantity: unknown
      priceUnit: unknown
      discount?: unknown
    },
  )
}

export const quoteLineFunction = defineFn({
  input: {
    productId: 'id?',
    taxIds: 'json?',
    quantity: 'decimal',
    priceUnit: 'decimal',
    discount: 'decimal?',
  },
  output: {
    ok: 'bool',
    currency: 'text?',
    scale: 'int?',
    quantity: 'decimal?',
    priceUnit: 'decimal?',
    discount: 'decimal?',
    amountUntaxed: 'decimal?',
    amountTax: 'decimal?',
    amountTotal: 'decimal?',
    taxIds: 'json?',
    taxes: 'json?',
    errors: 'json?',
  },
  effects: ['read:company.Company', 'read:product.Product', 'read:account.ProductTax', 'read:account.Tax'],
  agent: true,
  handler: quoteLineHandler,
})

export async function listTaxesHandler(ctx: Ctx, args: Row) {
  await ensureCompanyAccounting(ctx)
  const rows = await ctx.db.select('account.Tax', {
    ...(args.typeTaxUse ? { typeTaxUse: args.typeTaxUse } : {}),
    ...(args.includeArchived ? {} : { active: true }),
  })
  const usable = args.on ? rows.filter((tax) => taxInEffect(tax, String(args.on).slice(0, 10))) : rows
  return narrow(usable.sort(taxOrder), args, ['name'])
}

export const listTaxesFunction = defineFn({
  // `on` keeps only the rates that apply to a document of that date.
  input: { typeTaxUse: 'text?', includeArchived: 'bool?', on: 'date?', search: 'text?', limit: 'int?' },
  effects: ['read:account.Tax', ...ACCOUNT_SETUP_EFFECTS],
  agent: true,
  handler: listTaxesHandler,
})

export async function getProductTaxHandler(ctx: Ctx, args: Row) {
  return (await ctx.db.select('account.ProductTax', { templateId: args.templateId }))[0] ?? null
}

export const getProductTaxFunction = defineFn({
  input: { templateId: 'id' },
  output: { id: 'id', templateId: 'id', taxId: 'id' },
  effects: ['read:account.ProductTax'],
  agent: true,
  handler: getProductTaxHandler,
})

export async function setProductTaxHandler(ctx: Ctx, args: Row) {
  return saveProductTax(ctx, args)
}

export const setProductTaxFunction = defineFn({
  input: { templateId: 'id', taxId: 'id?' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:product.Template',
    'read:account.Tax',
    'read:account.ProductTax',
    'write:account.ProductTax',
  ],
  idempotent: true,
  agent: true,
  handler: setProductTaxHandler,
})

export async function saveTaxHandler(ctx: Ctx, args: Row) {
  if (!TAX_USES.includes(args.typeTaxUse as never)) return invalid('typeTaxUse', 'taxUseUnsupported')
  if (!TAX_AMOUNT_TYPES.includes(args.amountType as never))
    return invalid('amountType', 'taxComputationUnsupported')
  if (args.taxScope && !['service', 'consu'].includes(String(args.taxScope)))
    return invalid('taxScope', 'taxScopeUnsupported')
  const account = args.accountId ? await accountOf(ctx, args.accountId) : null
  if (args.accountId && !account) return invalid('accountId', 'taxAccountMissing')
  // A company may pin each use of tax to branches of its chart (output VAT under
  // 3331, input VAT under 1331); a tax account outside them misstates the return.
  if (account && (args.typeTaxUse === 'sale' || args.typeTaxUse === 'purchase')) {
    const defaults = (await ctx.db.select('account.Defaults'))[0]
    const held =
      args.typeTaxUse === 'sale' ? defaults?.saleTaxAccountRoots : defaults?.purchaseTaxAccountRoots
    const roots = Array.isArray(held) ? held.map(String).filter(Boolean) : []
    if (roots.length && !roots.some((root) => String(account.code).startsWith(root)))
      return invalid('accountId', 'taxAccountRoot', { roots: roots.join(', ') })
  }
  let amount: string
  try {
    amount = canonicalDecimalText(args.amount)
  } catch {
    return invalid('amount', 'moneyExactString')
  }
  const existing = (await ctx.db.select('account.Tax', { id: args.id }))[0]
  const from = args.validFrom !== undefined ? args.validFrom : (existing?.validFrom ?? null)
  const to = args.validTo !== undefined ? args.validTo : (existing?.validTo ?? null)
  if (from != null && to != null && String(to).slice(0, 10) < String(from).slice(0, 10))
    return invalid('validTo', 'taxEffectRange')
  const values = {
    ...args,
    amount,
    priceInclude: args.priceInclude === true,
    includeBaseAmount: args.includeBaseAmount === true,
    sequence: args.sequence ?? 10,
    active: args.active ?? true,
  }
  const cs = ctx
    .change('account.Tax', values, existing ?? null)
    .cast([
      'id',
      'name',
      'description',
      'typeTaxUse',
      'amountType',
      'amount',
      'priceInclude',
      'includeBaseAmount',
      'accountId',
      'sequence',
      'active',
      'validFrom',
      'validTo',
    ])
    .required(['name', 'typeTaxUse', 'amountType', 'amount'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  if (existing)
    await recordChange(
      ctx,
      'tax',
      args.id,
      existing,
      (await ctx.db.select('account.Tax', { id: args.id }))[0],
    )
  return { ok: true, id: args.id }
}

export const saveTaxFunction = defineFn({
  input: {
    id: 'id',
    name: 'text',
    description: 'text?',
    typeTaxUse: 'text',
    amountType: 'text',
    amount: 'decimal',
    priceInclude: 'bool?',
    includeBaseAmount: 'bool?',
    accountId: 'id?',
    sequence: 'int?',
    active: 'bool?',
    validFrom: 'date?',
    validTo: 'date?',
  },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:account.Tax',
    'write:account.Tax',
    'read:account.Account',
    'read:account.Defaults',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: saveTaxHandler,
})

export const taxesFunctions: Record<string, FnSpec> = {
  quoteLine: quoteLineFunction,
  listTaxes: listTaxesFunction,
  getProductTax: getProductTaxFunction,
  setProductTax: setProductTaxFunction,
  saveTax: saveTaxFunction,
}
