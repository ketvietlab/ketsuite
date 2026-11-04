import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { bulkFields, bulkFieldLabels } from '../../product/bulk-edit.ts'
import { importCatalogue, importCategoryPath } from '../../product/import-catalogue.ts'
import type { BulkModalData } from '../bulk/shared.ts'

export async function bulkContextHandler(ctx: Ctx, args: Row) {
  const keys = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  const can = (key: string) => keys === null || keys.includes(key)
  if (!can('product.bulkEditProducts') || !can('product.getTemplate') || !ctx.scope.company) return null
  const ids = args.products
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    return null
  const rows = await importCatalogue(ctx, 'product.Template')
  const selected = ids.map((id) => rows.find((row) => row.id === id && row.active !== false))
  if (selected.some((row) => !row)) return null
  const lang = args.locale === 'en' ? 'en' : 'vi'
  const general = can('product.saveTemplate')
  const categories = general ? await importCatalogue(ctx, 'product.Category') : []
  const tags = general ? await importCatalogue(ctx, 'product.Tag') : []
  const taxes =
    general && ctx.manifest.modules.account
      ? await ctx.db.select('account.Tax', { companyId: ctx.scope.company })
      : []
  const data: BulkModalData = {
    id: randomUUID(),
    lang,
    products: selected.map((row) => ({
      id: String(row!.id),
      name: String(row!.name),
      revision: String(row!.revisionId ?? 'initial'),
    })),
    fields: bulkFields
      .filter((field) =>
        field === 'isStorable'
          ? can('stock.configureProduct')
          : general && (field !== 'taxId' || Boolean(ctx.manifest.modules.account)),
      )
      .map((value) => ({ value, label: bulkFieldLabels[lang][value] })),
    choices: {
      categoryId: categories
        .filter((row) => row.active !== false)
        .map((row) => ({ value: String(row.id), label: importCategoryPath(row, categories) })),
      addTag: tags
        .filter((row) => row.active !== false)
        .map((row) => ({ value: String(row.id), label: String(row.name) })),
      removeTag: tags.map((row) => ({ value: String(row.id), label: String(row.name) })),
      taxId: taxes
        .filter((row) => row.active !== false && ['sale', 'none'].includes(String(row.typeTaxUse)))
        .map((row) => ({ value: String(row.id), label: String(row.name) })),
    },
  }
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[lang] ?? {}).filter(
      ([key]) =>
        key.startsWith('product_backend.bulk.') ||
        key.startsWith('product.error.bulk.') ||
        key.startsWith('recordModal.') ||
        key.startsWith('backend.relation.'),
    ),
  )
  return { data, messages }
}
export const bulkFunctions = {
  bulkContext: defineFn({
    input: { products: 'json', locale: 'text?' },
    effects: [
      'read:product.Template',
      'read:product.Category',
      'read:product.Tag',
      'read:account.Tax',
      ...AUTHORIZATION_READ_EFFECTS,
    ],
    handler: bulkContextHandler,
  }),
}
