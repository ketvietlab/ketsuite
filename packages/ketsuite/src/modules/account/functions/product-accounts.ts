import { randomUUID } from 'node:crypto'
import { defineFn, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ACCOUNT_RESOLUTION_EFFECTS, resolveAccounts } from '../account-resolution.ts'
import { accountOf } from '../ledger.ts'
import { invalid } from '../validation.ts'

const INCOME_TYPES = ['income', 'income_other']
const PURCHASE_TYPES = [
  'asset_current',
  'expense',
  'expense_other',
  'expense_depreciation',
  'expense_direct_cost',
]
const fields = ['incomeAccountId', 'expenseAccountId'] as const
const keyOf = (value: unknown) => (value == null || value === '' ? null : String(value))

export async function getProductAccountsHandler(ctx: Ctx, args: Row) {
  const template = args.templateId
    ? (await ctx.db.select('product.Template', { id: args.templateId }))[0]
    : null
  if (args.templateId && !template) return null
  const held = template
    ? (await ctx.db.select('account.ProductAccount', { templateId: template.id }))[0]
    : null
  const accounts = await ctx.db.select('account.Account')
  const byId = new Map(accounts.map((row) => [String(row.id), row]))
  const option = (row: Row) => ({ value: String(row.id), label: `${String(row.code)} · ${String(row.name)}` })
  const resolved = async (moveType: string) => {
    const result = await resolveAccounts(ctx, { ...args, moveType })
    const account = byId.get(String(result.lineAccountId ?? ''))
    return {
      id: result.lineAccountId,
      label: account ? option(account).label : null,
      from: result.lineAccountFrom,
    }
  }
  return {
    incomeAccountId: held?.incomeAccountId ?? null,
    expenseAccountId: held?.expenseAccountId ?? null,
    income: await resolved('out_invoice'),
    purchase: await resolved('in_invoice'),
    incomeOptions: accounts
      .filter((row) => !row.deprecated && INCOME_TYPES.includes(String(row.accountType)))
      .map(option),
    purchaseOptions: accounts
      .filter((row) => !row.deprecated && PURCHASE_TYPES.includes(String(row.accountType)))
      .map(option),
  }
}

export const getProductAccountsFunction = defineFn({
  input: { templateId: 'id?', type: 'text?', categoryId: 'id?' },
  effects: [...ACCOUNT_RESOLUTION_EFFECTS],
  agent: true,
  handler: getProductAccountsHandler,
})

async function applyProductAccounts(ctx: Ctx, args: Row, claimRevision: boolean) {
  const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
  if (!template) throw new KetError({ code: 'not_found', message: 'Product template not found' })
  if (args.expectedRevisionId != null && args.expectedRevisionId !== (template.revisionId ?? 'initial'))
    throw new KetError({
      code: 'conflict',
      message: 'The product changed; reload before saving its accounts.',
    })
  const held = (await ctx.db.select('account.ProductAccount', { templateId: template.id }))[0]
  const values = Object.fromEntries(
    fields.map((field) => [field, Object.hasOwn(args, field) ? keyOf(args[field]) : (held?.[field] ?? null)]),
  )
  const changed = fields.filter((field) => keyOf(values[field]) !== keyOf(held?.[field]))
  if (!changed.length) return { ok: true, id: held?.id ?? null }
  // Validate only changed overrides: an old mapping remains intact on unrelated edits.
  for (const field of changed) {
    const id = values[field]
    if (!id) continue
    const account = await accountOf(ctx, id)
    if (!account || account.deprecated) return invalid(field, 'accountMissing')
    if (!(field === 'incomeAccountId' ? INCOME_TYPES : PURCHASE_TYPES).includes(String(account.accountType)))
      return invalid(field, 'defaultAccountType')
  }
  if (claimRevision) {
    const stock = Boolean(ctx.manifest.modules.stock)
    const result = await ctx.db.compareAndSet(
      'product.Template',
      { id: template.id },
      {
        revisionId: template.revisionId ?? null,
        ...(stock ? { inventoryRevision: template.inventoryRevision ?? null } : {}),
      },
      {
        revisionId: randomUUID(),
        ...(stock ? { inventoryRevision: Number(template.inventoryRevision ?? 0) + 1 } : {}),
      },
    )
    if (!('dryRun' in result) && !result.matched)
      throw new KetError({
        code: 'conflict',
        message: 'The product changed; reload before saving its accounts.',
      })
  }
  const id = held?.id ?? `product-account:${String(ctx.scope.company ?? '')}:${String(template.id)}`
  if (held) await ctx.db.update('account.ProductAccount', { id }, values)
  else await ctx.db.insert('account.ProductAccount', { id, templateId: template.id, ...values })
  return { ok: true, id }
}

export async function setProductAccountsHandler(ctx: Ctx, args: Row) {
  return ctx.tx((tx) => applyProductAccounts(tx, args, true))
}

/** Public transactional spec for product.saveRecord; caller checks rights and owns the revision/transaction. */
export function setProductAccountsFunction(options: { inTransaction?: boolean } = {}): FnSpec {
  return defineFn({
    input: { templateId: 'id', incomeAccountId: 'id?', expenseAccountId: 'id?', expectedRevisionId: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:account.Account',
      'read:account.ProductAccount',
      'read:product.Template',
      'write:account.ProductAccount',
      'write:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: options.inTransaction
      ? (ctx, args) => applyProductAccounts(ctx, args, false)
      : setProductAccountsHandler,
  })
}

export const productAccountsFunctions: Record<string, FnSpec> = {
  getProductAccounts: getProductAccountsFunction,
  setProductAccounts: setProductAccountsFunction(),
}
