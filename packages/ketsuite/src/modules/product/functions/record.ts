import { PACKAGING_GRID_WRITE_EFFECTS } from '../packaging-grid.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { saveProductRecord } from '../save-record.ts'
import { saveTemplateFunction } from './templates.ts'
import { setProductAccountsFunction } from '../../account/functions/product-accounts.ts'
import { shelfLifeInput } from '../../stock/lot-policy.ts'
import { stockPositionEffects } from '../stock-policy.ts'
const templateSave = saveTemplateFunction({ inTransaction: true })
const accountSave = setProductAccountsFunction({ inTransaction: true })
export async function saveRecordHandler(ctx: Ctx, args: Record<string, unknown>) {
  return saveProductRecord(ctx, args)
}

export const recordFunctions: Record<string, FnSpec> = {
  saveRecord: defineFn({
    input: {
      ...templateSave.input,
      duplicateSourceId: 'id?',
      packagings: 'json?',
      // Accounting: the default variant's cost in the active company.
      costPrice: 'decimal?',
      taxId: 'id?',
      // Stock setup, with the stock module: whether the product is stocked and how.
      isStorable: 'bool?',
      tracking: 'text?',
      ...shelfLifeInput,
      incomeAccountId: 'id?',
      expenseAccountId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        ...templateSave.effects!,
        'read:account.Tax',
        'read:account.ProductTax',
        'write:account.ProductTax',
        'read:product.Cost',
        'write:product.Cost',
        ...stockPositionEffects,
        ...PACKAGING_GRID_WRITE_EFFECTS,
        ...accountSave.effects!,
      ]),
    ],
    idempotent: true,
    agent: true,
    handler: saveRecordHandler,
  }),
}
