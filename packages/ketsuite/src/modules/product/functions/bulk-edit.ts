import { readBulkEdits } from '../bulk-history.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { writeBulkEdit, BulkEditRefused, bulkFieldLabels, type BulkField } from '../bulk-edit.ts'
import { recordFunctions } from './record.ts'

export async function bulkEditProductsHandler(ctx: Ctx, args: Row) {
  try {
    return await writeBulkEdit(ctx, args)
  } catch (error) {
    if (error instanceof BulkEditRefused)
      return {
        ok: false,
        errors: [
          {
            field: 'value',
            code: `product.error.bulk.${error.reason === 'value' && !error.product ? 'input' : error.reason}`,
            params: {
              product: error.product,
              field:
                bulkFieldLabels[args.locale === 'en' ? 'en' : 'vi'][error.field as BulkField] ?? error.field,
            },
          },
        ],
      }
    throw error
  }
}
export async function listBulkEditsHandler(ctx: Ctx, args: Row) {
  return readBulkEdits(ctx, args)
}

export const bulkEditFunctions = {
  bulkEditProducts: defineFn({
    input: { id: 'id', products: 'json', field: 'text', value: 'text', locale: 'text?' },
    output: {
      ok: 'bool',
      id: 'id?',
      name: 'text?',
      productCount: 'int?',
      changedCount: 'int?',
      errors: 'json?',
    },
    effects: [
      ...new Set([
        ...recordFunctions.saveRecord!.effects!,
        'read:product.BulkEdit',
        'write:product.BulkEdit',
        'read:product.BulkEditItem',
        'write:product.BulkEditItem',
        'read:product.BulkEditSequence',
        'write:product.BulkEditSequence',
      ]),
    ],
    idempotent: true,
    handler: bulkEditProductsHandler,
  }),
  listBulkEdits: defineFn({
    input: { templateId: 'id', limit: 'int?' },
    output: { rows: 'json' },
    effects: ['read:product.BulkEdit', 'read:product.BulkEditItem'],
    handler: listBulkEditsHandler,
  }),
}
