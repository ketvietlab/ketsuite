import { categoryFailure } from '../../product/category-policy.ts'
import { writeCategoryAccounts } from '../category-accounting.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ACCOUNT_RESOLUTION_EFFECTS, resolveAccounts } from '../account-resolution.ts'

export async function listCategoryAccountsHandler(ctx: Ctx) {
  const categories = new Map((await ctx.db.select('product.Category')).map((row) => [String(row.id), row]))
  return (await ctx.db.select('account.CategoryAccount')).map((row) => ({
    ...row,
    categoryName: categories.get(String(row.categoryId))?.name ?? null,
  }))
}

export const listCategoryAccountsFunction = defineFn({
  input: {},
  effects: ['read:account.CategoryAccount', 'read:product.Category'],
  agent: true,
  handler: listCategoryAccountsHandler,
})

export async function saveCategoryAccountHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx((tx) => writeCategoryAccounts(tx, args))
  } catch (error) {
    const refused = categoryFailure(error)
    if (refused) return refused
    throw error
  }
}

export const saveCategoryAccountFunction = defineFn({
  input: { categoryId: 'id', incomeAccountId: 'id?', expenseAccountId: 'id?' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:account.Account',
    'read:account.CategoryAccount',
    'read:product.Category',
    'write:product.Category',
    'write:account.CategoryAccount',
  ],
  idempotent: true,
  agent: true,
  handler: saveCategoryAccountHandler,
})

export async function previewAccountsHandler(ctx: Ctx, args: Row) {
  return resolveAccounts(ctx, {
    moveType: String(args.moveType),
    partnerId: args.partnerId,
    productId: args.productId,
  })
}

export const previewAccountsFunction = defineFn({
  input: { moveType: 'text', partnerId: 'id?', productId: 'id?' },
  output: {
    lineAccountId: 'id?',
    lineAccountFrom: 'text?',
    counterpartAccountId: 'id?',
    counterpartAccountFrom: 'text?',
  },
  effects: [...ACCOUNT_RESOLUTION_EFFECTS],
  agent: true,
  handler: previewAccountsHandler,
})

export const accountMappingFunctions: Record<string, FnSpec> = {
  listCategoryAccounts: listCategoryAccountsFunction,
  saveCategoryAccount: saveCategoryAccountFunction,
  previewAccounts: previewAccountsFunction,
}
