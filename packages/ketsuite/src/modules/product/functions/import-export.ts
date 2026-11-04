import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { holdsFunction } from './shared.ts'
import { importCatalogue, importCategoryPath } from '../import-catalogue.ts'
import { variantSetupOf } from '../variant-setup.ts'
import {
  exportProductImportCsv,
  exportImportAttributes,
  exportImportMoney,
  productImportColumns,
  importIssue,
} from '../import-format.ts'

export async function exportImportSheetHandler(ctx: Ctx, args: Row) {
  const costAllowed = await holdsFunction(ctx, 'product.listVariantCosts')
  const [templates, products, units, categories, taxes, productTaxes, costs] = await Promise.all([
    importCatalogue(ctx, 'product.Template'),
    importCatalogue(ctx, 'product.Product'),
    importCatalogue(ctx, 'uom.Unit'),
    importCatalogue(ctx, 'product.Category'),
    ctx.manifest.models['account.Tax'] ? importCatalogue(ctx, 'account.Tax') : [],
    ctx.manifest.models['account.ProductTax'] ? importCatalogue(ctx, 'account.ProductTax') : [],
    costAllowed ? importCatalogue(ctx, 'product.Cost') : [],
  ])
  const columns = productImportColumns.filter((column) => costAllowed || column.key !== 'cost')
  const rows: unknown[][] = [columns.map((column) => column[args.locale === 'en' ? 'en' : 'vi'])]
  // Every product that cannot round-trip is named, so one export tells which records to correct.
  const blocked: Row[] = []
  const block = (template: Row, code: string) =>
    blocked.push({
      ...importIssue(rows.length + 1, code === 'legacyCode' ? 'templateCode' : 'values', code),
      product: String(template.name ?? template.id),
    })
  for (const template of templates
    .filter((row) => row.active !== false && row.type !== 'combo')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const variants = products.filter((row) => row.templateId === template.id && row.active !== false)
    if (!variants.length) continue
    const defaultVariant = products.find(
      (row) => row.templateId === template.id && String(row.combinationKey ?? '') === '',
    )
    const code = String(template.variantCodeBase ?? defaultVariant?.defaultCode ?? '').trim()
    if (!code) {
      block(template, 'legacyCode')
      continue
    }
    const setup = (await variantSetupOf(ctx, String(template.id)))!
    const category = categories.find((row) => row.id === template.categoryId)
    const tax = taxes.find(
      (row) => row.id === productTaxes.find((link) => link.templateId === template.id)?.taxId,
    )
    for (const variant of variants) {
      const variantSetup = setup.variants.find((row) => row.id === variant.id)!
      const pairs = setup.lines
        .filter((line) => line.createVariant !== 'no_variant')
        .map((line) => ({
          attribute: line.name,
          value:
            line.values.find((value) => value.valueId === variantSetup.valueIds[line.attributeId])?.name ??
            '',
        }))
      if (pairs.some((pair) => !pair.value)) {
        block(template, 'variant')
        break
      }
      const values: Row = {
        templateCode: code,
        name: template.name,
        kind: template.type,
        uom: units.find((row) => row.id === template.uomId)?.name ?? '',
        category: category ? importCategoryPath(category, categories) : '',
        tax: tax?.name ?? '',
        listPrice: exportImportMoney(template.listPrice),
        values: exportImportAttributes(pairs),
        code: variant.defaultCode ?? '',
        barcode: variant.barcode ?? '',
        ownPrice: exportImportMoney(variant.listPriceOverride),
        cost: exportImportMoney(costs.find((row) => row.productId === variant.id)?.standardPrice),
      }
      rows.push(columns.map((column) => values[column.key]))
    }
  }
  if (blocked.length) return { ok: false, errors: blocked }
  return {
    ok: true,
    filename: 'product-import.csv',
    csv: exportProductImportCsv(rows),
    rowCount: rows.length - 1,
    costIncluded: costAllowed,
  }
}
export const importExportFunctions = {
  exportImportSheet: defineFn({
    input: { locale: 'text?' },
    output: {
      ok: 'bool',
      filename: 'text?',
      csv: 'text?',
      rowCount: 'int?',
      costIncluded: 'bool?',
      errors: 'json?',
    },
    effects: [
      ...AUTHORIZATION_READ_EFFECTS,
      ...[
        'product.Template',
        'product.Product',
        'uom.Unit',
        'product.Category',
        'account.Tax',
        'account.ProductTax',
        'product.Cost',
        'product.Attribute',
        'product.AttributeValue',
        'product.TemplateAttributeLine',
        'product.TemplateAttributeValue',
        'product.ProductValue',
        'product_media.Media',
      ].map((model) => `read:${model}`),
    ],
    handler: exportImportSheetHandler,
  }),
}
