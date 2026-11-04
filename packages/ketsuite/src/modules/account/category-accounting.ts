import type { Ctx, Row } from '@ketvietlab/ketjs'
import { invalid } from './validation.ts'
import { accountOf } from './ledger.ts'
import { requireActiveCategory } from '../product/category-policy.ts'

/** The record command and standalone API share validation inside the caller transaction. */
export async function writeCategoryAccounts(ctx: Ctx, args: Row) {
  await requireActiveCategory(ctx, args.categoryId)
  if (!(await ctx.db.select('product.Category', { id: args.categoryId }))[0])
    return invalid('categoryId', 'categoryMissing')
  for (const [field, wanted] of [
    ['incomeAccountId', ['income', 'income_other']],
    [
      'expenseAccountId',
      ['asset_current', 'expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost'],
    ],
  ] as const) {
    const id = args[field]
    if (!id) continue
    const account = await accountOf(ctx, id)
    if (!account) return invalid(field, 'accountMissing')
    if (account.active === false) return invalid(field, 'accountInactive')
    if (!wanted.includes(String(account.accountType) as never)) return invalid(field, 'defaultAccountType')
  }
  const values = {
    incomeAccountId: args.incomeAccountId ?? null,
    expenseAccountId: args.expenseAccountId ?? null,
  }
  const held = (await ctx.db.select('account.CategoryAccount', { categoryId: args.categoryId }))[0]
  if (held) {
    await ctx.db.update('account.CategoryAccount', { id: held.id }, values)
    return { ok: true, id: held.id }
  }
  // One row per company and category, so the id can be derived rather than
  // generated: a second save corrects the first instead of racing it.
  const id = `category-account:${String(ctx.scope.company ?? '')}:${String(args.categoryId)}`
  await ctx.db.insert('account.CategoryAccount', { id, categoryId: args.categoryId, ...values })
  return { ok: true, id }
}
