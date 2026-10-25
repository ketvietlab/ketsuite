// "Duplicate" on the product page: a new template with the same information and prices.
//
// Only this module's own fields are copied. The internal reference and barcode are not,
// because both identify one product; nor are images, variants or the company cost. Stock
// tracking belongs to another module, so the page copies it with that module's function
// in the same action (`RecordModalCommand.also`), under the viewer's own permission for
// it. The sales tax is not copied: accounting sets it. The caller names the new id, which
// lets that step address it.

import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'

const COPIED = [
  'type',
  'categoryId',
  'brandId',
  'uomId',
  'origin',
  'description',
  'summaryDoc',
  'descriptionDoc',
  'listPrice',
  'compareAtPrice',
  'hsCode',
  'saleOk',
  'purchaseOk',
] as const

export const duplicateTemplateFunctions: Record<string, FnSpec> = {
  duplicateTemplate: defineFn({
    input: { id: 'id', sourceId: 'id', name: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'write:product.Template',
      'read:product.Product',
      'write:product.Product',
      'write:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const source = (await ctx.db.select('product.Template', { id: args.sourceId }))[0]
      if (!source)
        return { ok: false, errors: [{ field: 'sourceId', code: 'product.error.duplicate.missing' }] }
      if ((await ctx.db.select('product.Template', { id: args.id }))[0])
        return { ok: false, errors: [{ field: 'id', code: 'product.error.duplicate.taken' }] }
      const name = (typeof args.name === 'string' && args.name.trim()) || `${String(source.name)} (bản sao)`
      const sourceDefault = (await ctx.db.select('product.Product', { templateId: args.sourceId })).find(
        (product) => String(product.combinationKey ?? '') === '',
      )
      await ctx.tx(async (tx) => {
        await tx.db.insert('product.Template', {
          id: args.id,
          name: name.slice(0, 200),
          ...Object.fromEntries(COPIED.map((field) => [field, source[field] ?? null])),
          listPrice: source.listPrice ?? '0',
          saleOk: source.saleOk !== false,
          purchaseOk: source.purchaseOk !== false,
          active: true,
          revisionId: randomUUID(),
        })
        await tx.db.insert('product.Product', {
          id: `${String(args.id)}:default`,
          templateId: args.id,
          defaultCode: null,
          barcode: null,
          weight: sourceDefault?.weight ?? '0',
          volume: sourceDefault?.volume ?? '0',
          combinationKey: '',
          active: true,
        })
        if (source.uomId) await tx.db.update('uom.Unit', { id: source.uomId }, { locked: true })
      })
      return { ok: true, id: args.id }
    },
  }),
}
