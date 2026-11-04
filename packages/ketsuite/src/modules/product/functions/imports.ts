import { readProductImports, readProductImport } from '../import-history.ts'
import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import {
  ProductImportRefused,
  productImportColumns,
  importIssue,
  parseProductImport,
  type ProductImportRow,
} from '../import-format.ts'
import { writeImportedProduct } from '../import-execution.ts'
import { importCatalogue } from '../import-catalogue.ts'
import { recordFunctions } from './record.ts'
import { costsFunctions } from './costs.ts'
import { configureAttributesFunctions } from '../configure-attributes.ts'
import { variantSetupFunctions } from '../variant-setup.ts'
import { setProductTaxFunction } from '../../account/functions/taxes.ts'

const refuse = (row: number, column: string, code: string): never => {
  throw new ProductImportRefused([importIssue(row, column, code)])
}
const company = (ctx: Ctx) => ({ companyId: ctx.scope.company })
const receipt = (row: Row) => {
  const { data: _data, ...visible } = row
  return visible
}
export async function importProductsHandler(ctx: Ctx, args: Row) {
  try {
    const rows = parseProductImport(args.data)
    if (!ctx.scope.company) return refuse(1, 'data', 'company')
    return await ctx.tx(async (tx) => {
      // A company sequence serializes imports, including a replay that raced the first submit.
      const sequenceId = `product-import:${tx.scope.company}`
      await tx.db.insertIfAbsent('product.ImportSequence', { id: sequenceId, value: 0, revision: 'initial' })
      const sequence = (await tx.db.select('product.ImportSequence', { ...company(tx), id: sequenceId }))[0]!
      const lock = await tx.db.compareAndSet(
        'product.ImportSequence',
        { id: sequenceId },
        { revision: sequence.revision },
        { revision: randomUUID() },
      )
      if (!('dryRun' in lock) && !lock.matched) return refuse(1, 'data', 'conflict')
      const previous = (await tx.db.select('product.Import', { ...company(tx), id: args.id }))[0]
      if (previous) {
        if (previous.data !== args.data) return refuse(1, 'data', 'replay')
        return { ok: true, ...receipt(previous) }
      }
      const groups = new Map<string, ProductImportRow[]>()
      for (const row of rows) {
        const code = row.cells.templateCode!.trim().toUpperCase()
        const group = groups.get(code) ?? []
        group.push(row)
        groups.set(code, group)
      }
      const templates = await importCatalogue(tx, 'product.Template')
      const products = await importCatalogue(tx, 'product.Product')
      const items = []
      for (const [code, group] of groups) {
        const matches = templates.filter(
          (template) =>
            String(
              template.variantCodeBase ??
                products.find(
                  (product) =>
                    product.templateId === template.id && String(product.combinationKey ?? '') === '',
                )?.defaultCode ??
                '',
            )
              .trim()
              .toUpperCase() === code,
        )
        if (matches.length > 1) return refuse(group[0]!.row, 'templateCode', 'ambiguous')
        items.push(await writeImportedProduct(tx, group, matches[0]))
      }
      const number = Number(sequence.value) + 1
      const saved = {
        id: args.id,
        name: `NHAP/${String(number).padStart(4, '0')}`,
        actor: tx.actor ?? '',
        occurredAt: new Date().toISOString(),
        data: args.data,
        rowCount: rows.length,
        createdCount: items.filter((item) => item.created).length,
        changedCount: items.filter((item) => item.changed).length,
        variantCount: items.reduce((sum, item) => sum + item.variantIds.length, 0),
      }
      await tx.db.insert('product.Import', saved)
      for (const item of items)
        await tx.db.insert('product.ImportItem', { id: randomUUID(), importId: args.id, ...item })
      await tx.db.update('product.ImportSequence', { id: sequenceId }, { value: number })
      return { ok: true, ...receipt(saved) }
    })
  } catch (error) {
    if (error instanceof ProductImportRefused)
      return {
        ok: false,
        errors: error.issues.map((issue) => ({
          ...issue,
          params: {
            ...issue.params,
            column:
              productImportColumns.find((column) => column.key === issue.column)?.[
                args.locale === 'en' ? 'en' : 'vi'
              ] ?? issue.column,
          },
        })),
      }
    throw error
  }
}

export async function listImportsHandler(ctx: Ctx, args: Row) {
  return readProductImports(ctx, args)
}
export async function getImportHandler(ctx: Ctx, args: Row) {
  return readProductImport(ctx, args)
}
const readEffects = [
  'read:product.Import',
  'read:product.ImportItem',
  'read:product.Template',
  ...AUTHORIZATION_READ_EFFECTS,
]
export const importFunctions = {
  importProducts: defineFn({
    input: { id: 'id', data: 'text', locale: 'text?' },
    output: {
      ok: 'bool',
      id: 'id?',
      name: 'text?',
      rowCount: 'int?',
      createdCount: 'int?',
      changedCount: 'int?',
      variantCount: 'int?',
      errors: 'json?',
    },
    effects: [
      ...new Set([
        ...readEffects,
        'write:product.Import',
        'write:product.ImportItem',
        'read:product.ImportSequence',
        'write:product.ImportSequence',
        'read:uom.Unit',
        ...recordFunctions.saveRecord!.effects!,
        ...costsFunctions.setCost!.effects!,
        ...configureAttributesFunctions.configureAttributes!.effects!,
        ...variantSetupFunctions.saveVariantSetup!.effects!,
        ...setProductTaxFunction.effects!,
      ]),
    ],
    idempotent: true,
    agent: true,
    handler: importProductsHandler,
  }),
  listImports: defineFn({
    input: { templateId: 'id?', offset: 'int?', limit: 'int?' },
    output: { rows: 'json', total: 'int' },
    effects: readEffects,
    handler: listImportsHandler,
  }),
  getImport: defineFn({
    input: { id: 'id', locale: 'text?' },
    output: { record: 'json?', items: 'json?' },
    effects: readEffects,
    handler: getImportHandler,
  }),
}
