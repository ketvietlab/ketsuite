import { defineFn, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { writeCategoryAccounts } from '../../account/category-accounting.ts'
import { writeCategory } from '../category-write.ts'
import { categoryFailure, categoryRefusal, categoryRevision, lockCategories } from '../category-policy.ts'
import { holdsFunction } from './shared.ts'

class Refused extends Error {
  readonly value: Row
  constructor(value: Row) {
    super('Category record refused')
    this.value = value
  }
}
export async function saveCategoryRecordHandler(ctx: Ctx, args: Row) {
  const general = await holdsFunction(ctx, 'product.saveCategory')
  const accounting =
    Boolean(ctx.manifest.models['account.CategoryAccount']) &&
    (await holdsFunction(ctx, 'account.saveCategoryAccount'))
  const denied = (fields: string[]) =>
    new KetError({
      code: 'E_FN_NOT_PERMITTED',
      message: `Cannot change category fields: ${fields.join(', ')}`,
    })
  try {
    return await ctx.tx(async (tx) => {
      await lockCategories(tx)
      const current = (await tx.db.select('product.Category', { id: args.id }))[0]
      const accounts = ctx.manifest.models['account.CategoryAccount']
        ? (await tx.db.select('account.CategoryAccount', { categoryId: args.id }))[0]
        : undefined
      if (!current && !general) throw denied(['name', 'parentId'])
      if (current && current.active === false) throw new Refused(categoryRefusal('id', 'inactive'))
      if (current && args.expectedRevision !== categoryRevision(current, accounts))
        throw new Refused(categoryRefusal('expectedRevision', 'conflict'))
      const generalFields = ['name', 'parentId'].filter(
        (key) => Object.hasOwn(args, key) && String(args[key] ?? '') !== String(current?.[key] ?? ''),
      )
      const accountFields = ['incomeAccountId', 'expenseAccountId'].filter(
        (key) => Object.hasOwn(args, key) && String(args[key] ?? '') !== String(accounts?.[key] ?? ''),
      )
      if (generalFields.length && !general) throw denied(generalFields)
      if (accountFields.length && !accounting) throw denied(accountFields)
      if (!general && !accounting) throw denied(['name', 'incomeAccountId', 'expenseAccountId'])
      if (!current || generalFields.length) {
        const saved = await writeCategory(tx, {
          id: args.id,
          name: args.name ?? current?.name,
          parentId: Object.hasOwn(args, 'parentId') ? args.parentId : current?.parentId,
        })
        if (!saved.ok) throw new Refused(saved)
      }
      if (accountFields.length) {
        const saved = await writeCategoryAccounts(tx, {
          categoryId: args.id,
          incomeAccountId: Object.hasOwn(args, 'incomeAccountId')
            ? args.incomeAccountId
            : accounts?.incomeAccountId,
          expenseAccountId: Object.hasOwn(args, 'expenseAccountId')
            ? args.expenseAccountId
            : accounts?.expenseAccountId,
        })
        if (!saved.ok) throw new Refused(saved)
      }
      return { ok: true, id: args.id }
    })
  } catch (error) {
    if (error instanceof Refused) return error.value
    const refused = categoryFailure(error)
    if (refused) return refused
    throw error
  }
}

export const categoryRecordFunctions = {
  saveCategoryRecord: defineFn({
    input: {
      id: 'id',
      name: 'text?',
      parentId: 'id?',
      incomeAccountId: 'id?',
      expenseAccountId: 'id?',
      expectedRevision: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...AUTHORIZATION_READ_EFFECTS,
      'read:product.Category',
      'write:product.Category',
      'read:account.CategoryAccount',
      'write:account.CategoryAccount',
      'read:account.Account',
    ],
    idempotent: true,
    agent: true,
    handler: saveCategoryRecordHandler,
  }),
}
