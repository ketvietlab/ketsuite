import { productCodeFailure } from './codes.ts'
import { barcodeFailure } from './barcodes.ts'
import { attributeFailure } from './attribute-policy.ts'
import { VariantPolicyRefused } from './variant-policy.ts'
import { importCatalogue, importCategoryPath } from './import-catalogue.ts'
import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import {
  ProductImportRefused,
  importIssue,
  importNameKey,
  importMoney,
  importAttributeValues,
  type ProductImportRow,
  type ProductImportColumn,
} from './import-format.ts'
import { saveProductRecord } from './save-record.ts'
import { saveProductCost } from './save-cost.ts'
import { holdsFunction } from './functions/shared.ts'
import { variantSetupOf, applyVariantSetup } from './variant-setup.ts'
import { configureProductAttributes } from './configure-attributes.ts'
import { lockVariantTemplate } from './variant-lifecycle.ts'
import { claimProductCodeRevision } from './codes.ts'

const fail = (row: number, column: string, code = 'field'): never => {
  throw new ProductImportRefused([importIssue(row, column, code)])
}
const sameMoney = (a: unknown, b: unknown) => {
  if (a == null || a === '') return b == null || b === ''
  if (b == null || b === '') return false
  const clean = (value: unknown) =>
    String(value)
      .replace(/^0+(?=\d)/u, '')
      .replace(/(\.\d*?)0+$/u, '$1')
      .replace(/\.$/u, '')
  return clean(a) === clean(b)
}
const first = (rows: ProductImportRow[], key: ProductImportColumn) =>
  rows.find((row) => row.cells[key]?.trim())?.cells[key]?.trim()
const sourceRow = (rows: ProductImportRow[], key: ProductImportColumn) =>
  rows.find((row) => row.cells[key]?.trim())?.row ?? rows[0]!.row
const fields: Record<string, ProductImportColumn> = {
  defaultCode: 'templateCode',
  name: 'name',
  type: 'kind',
  uomId: 'uom',
  categoryId: 'category',
  taxId: 'tax',
  listPrice: 'listPrice',
  variants: 'values',
  lines: 'values',
  barcode: 'barcode',
  costPrice: 'cost',
  standardPrice: 'cost',
}
async function written(
  result: Promise<Row>,
  row: number,
  fallback: ProductImportColumn,
  variants = false,
  sourceRows: number[] = [],
) {
  const refused = (value: Row): Row => {
    if (value.ok === false) {
      const errors = (value.errors ?? []) as Row[]
      const path = String(errors[0]?.field ?? ''),
        field = path.split('.').at(-1) ?? ''
      const index = /^variants\.(\d+)/u.exec(path)?.[1]
      const at = index == null ? row : (sourceRows[Number(index)] ?? row)
      const reason =
        String(errors[0]?.code ?? '')
          .split('.')
          .at(-1) ?? ''
      fail(
        at,
        variants && field === 'defaultCode'
          ? 'code'
          : variants && field === 'listPrice'
            ? 'ownPrice'
            : (fields[field] ?? fallback),
        ['stockLocked', 'codeFormat', 'codeTaken', 'barcodeTaken', 'barcodeInvalid'].includes(reason)
          ? reason
          : 'field',
      )
    }
    return value
  }
  try {
    return refused(await result)
  } catch (error) {
    if (error instanceof ProductImportRefused) throw error
    const value =
      error instanceof VariantPolicyRefused
        ? error.result
        : (productCodeFailure(error) ?? barcodeFailure(error) ?? attributeFailure(error))
    if (value) return refused(value)
    const code = (error as { code?: string }).code
    if (code === 'E_FN_NOT_PERMITTED') fail(row, fallback, 'permission')
    if (code === 'conflict' || code === 'E_CONFLICT') fail(row, fallback, 'conflict')
    throw error
  }
}

const choice = (
  rows: Row[],
  text: string,
  row: number,
  column: ProductImportColumn,
  keys: string[] = ['name', 'code'],
) => {
  const key = importNameKey(text)
  const matches = rows.filter(
    (item) =>
      item.active !== false &&
      keys.some((field) => item[field] != null && importNameKey(String(item[field])) === key),
  )
  if (matches.length !== 1) return fail(row, column, matches.length ? 'ambiguous' : 'choice')
  return matches[0]!
}

export type ImportedProduct = {
  templateId: string
  code: string
  name: string
  created: boolean
  changed: boolean
  variantIds: string[]
}

/** All writes share the caller's transaction; a row refusal unwinds the whole import. */
export async function writeImportedProduct(
  ctx: Ctx,
  rows: ProductImportRow[],
  existing: Row | undefined,
): Promise<ImportedProduct> {
  const code = rows[0]!.cells.templateCode!.trim().toUpperCase(),
    line = rows[0]!.row
  if (existing?.active === false) return fail(line, 'templateCode', 'archived')
  if (existing?.type === 'combo') return fail(line, 'kind', 'combo')
  const id = existing ? String(existing.id) : randomUUID()
  if (existing) {
    const locked = await lockVariantTemplate(ctx, id)
    if (!locked || locked.revisionId !== existing.revisionId) return fail(line, 'templateCode', 'conflict')
  }
  const beforeProducts = existing ? await importCatalogue(ctx, 'product.Product', { templateId: id }) : []
  const beforeCosts = beforeProducts.length ? await importCatalogue(ctx, 'product.Cost') : []
  const fingerprint = (row: Row, costs: Row[]) =>
    JSON.stringify([
      row.defaultCode ?? null,
      row.barcode ?? null,
      row.listPriceOverride ?? null,
      row.combinationKey ?? '',
      row.active !== false,
      costs.find((cost) => cost.productId === row.id)?.standardPrice ?? null,
    ])
  const before = new Map(
    beforeProducts.map((product) => [String(product.id), fingerprint(product, beforeCosts)]),
  )
  const patch: Row = {
    id,
    name: existing?.name ?? first(rows, 'name') ?? '',
    type: existing?.type ?? 'goods',
  }
  if (existing) patch.expectedRevisionId = existing.revisionId ?? 'initial'
  else {
    patch.defaultCode = code
    patch.saleOk = true
    patch.purchaseOk = true
    const kind = importNameKey(first(rows, 'kind') ?? 'goods')
    patch.type = ['goods', 'hang hoa', 'hang', 'san pham', 'product', 'consu'].includes(kind)
      ? 'goods'
      : ['service', 'dich vu'].includes(kind)
        ? 'service'
        : kind
    if (patch.type === 'combo') return fail(sourceRow(rows, 'kind'), 'kind', 'combo')
    const unit = first(rows, 'uom')
    if (!unit) return fail(line, 'uom', 'required')
    patch.uomId = choice(await importCatalogue(ctx, 'uom.Unit'), unit, sourceRow(rows, 'uom'), 'uom').id
  }
  const name = first(rows, 'name'),
    price = first(rows, 'listPrice'),
    category = first(rows, 'category'),
    tax = first(rows, 'tax')
  if (name) patch.name = name
  if (price) patch.listPrice = importMoney(price, sourceRow(rows, 'listPrice'), 'listPrice')
  if (category) {
    const categories = await importCatalogue(ctx, 'product.Category')
    const paths = categories.map((item) => ({ ...item, path: importCategoryPath(item, categories) }))
    patch.categoryId = choice(
      paths,
      category,
      sourceRow(rows, 'category'),
      'category',
      category.includes('/') ? ['path'] : ['name', 'path'],
    ).id
  }
  if (tax) {
    if (!ctx.manifest.models['account.Tax']) return fail(sourceRow(rows, 'tax'), 'tax', 'choice')
    const taxes = (await importCatalogue(ctx, 'account.Tax')).filter((item) =>
      ['sale', 'none'].includes(String(item.typeTaxUse)),
    )
    const selected = choice(
      taxes.map((item) => ({ ...item, rateLabel: String(item.amount) + '%' })),
      tax,
      sourceRow(rows, 'tax'),
      'tax',
      ['name', 'code', 'amount', 'rateLabel'],
    )
    const held = (await importCatalogue(ctx, 'account.ProductTax', { templateId: id }))[0]
    if (held?.taxId !== selected.id) patch.taxId = selected.id
  }
  const changedGeneral =
    !existing ||
    Object.hasOwn(patch, 'taxId') ||
    ['name', 'categoryId', 'listPrice'].some(
      (field) =>
        Object.hasOwn(patch, field) &&
        (field === 'listPrice'
          ? !sameMoney(patch[field], existing[field])
          : String(patch[field] ?? '') !== String(existing[field] ?? '')),
    )
  if (changedGeneral)
    await written(saveProductRecord(ctx, patch, { inTransaction: true }), line, 'templateCode')
  let changed = changedGeneral
  let setup = await variantSetupOf(ctx, id)
  if (!setup) return fail(line, 'templateCode')
  const [attributes, values] = await Promise.all([
    importCatalogue(ctx, 'product.Attribute'),
    importCatalogue(ctx, 'product.AttributeValue'),
  ])
  const selections = rows.map((row) =>
    Object.fromEntries(
      importAttributeValues(row.cells.values ?? '', row.row).map((pair) => {
        const attribute = choice(attributes, pair.attribute, row.row, 'values')
        const value = choice(
          values.filter((item) => item.attributeId === attribute.id),
          pair.value,
          row.row,
          'values',
        )
        return [String(attribute.id), String(value.id)]
      }),
    ),
  )
  const planned = setup.lines.map((row) => ({
    attributeId: row.attributeId,
    values: row.values.map((value) => ({ valueId: value.valueId, priceExtra: value.priceExtra })),
  }))
  let addedValues = false
  for (const selected of selections)
    for (const [attributeId, valueId] of Object.entries(selected)) {
      let row = planned.find((item) => item.attributeId === attributeId)
      if (!row) {
        row = { attributeId, values: [] }
        planned.push(row)
      }
      if (!row.values.some((value) => value.valueId === valueId)) {
        row.values.push({
          valueId,
          priceExtra: String(values.find((value) => value.id === valueId)?.defaultPriceExtra ?? '0'),
        })
        addedValues = true
      }
    }
  if (addedValues) {
    const variants = planned.filter(
      (row) =>
        attributes.find((attribute) => attribute.id === row.attributeId)?.createVariant !== 'no_variant',
    )
    await written(
      configureProductAttributes(ctx, { templateId: id, lines: variants }, { inTransaction: true }),
      line,
      'values',
    )
    setup = (await variantSetupOf(ctx, id))!
    const describing = planned.filter(
      (row) =>
        attributes.find((attribute) => attribute.id === row.attributeId)?.createVariant === 'no_variant',
    )
    if (describing.length) {
      await written(
        applyVariantSetup(
          ctx,
          id,
          [...setup.lines.filter((row) => row.createVariant !== 'no_variant'), ...describing],
          setup.variants,
        ),
        line,
        'values',
      )
      setup = (await variantSetupOf(ctx, id))!
    }
    changed = true
  }
  const variantPatches = structuredClone(setup.variants),
    costs = new Map<string, { row: number; value: string }>()
  if (
    !setup.lines.some((item) => item.createVariant !== 'no_variant') &&
    !variantPatches.some((item) => item.active)
  ) {
    const plain = (await importCatalogue(ctx, 'product.Product', { templateId: id })).find(
      (item) => item.active !== false && String(item.combinationKey ?? '') === '',
    )
    if (plain)
      variantPatches.push({
        id: String(plain.id),
        valueIds: {},
        defaultCode: plain.defaultCode == null ? null : String(plain.defaultCode),
        barcode: plain.barcode == null ? null : String(plain.barcode),
        weight: String(plain.weight ?? '0'),
        volume: String(plain.volume ?? '0'),
        listPrice: plain.listPriceOverride == null ? null : String(plain.listPriceOverride),
        hsCode: plain.hsCode == null ? null : String(plain.hsCode),
        active: true,
        images: [],
      })
  }
  const variantSources = new Map<string, number>()
  let variantChanged = false
  for (const [index, row] of rows.entries()) {
    const own = Object.fromEntries(
      ['code', 'barcode', 'ownPrice', 'cost']
        .filter((key) => row.cells[key as ProductImportColumn]?.trim())
        .map((key) => [key, row.cells[key as ProductImportColumn]!.trim()]),
    )
    const selected = selections[index]!
    if (!Object.keys(selected).length && !Object.keys(own).length) continue
    const dimensions = setup.lines
      .filter((item) => item.createVariant !== 'no_variant')
      .map((item) => item.attributeId)
    if (dimensions.some((attributeId) => !selected[attributeId])) return fail(row.row, 'values', 'variant')
    const candidates = variantPatches.filter(
      (item) =>
        item.active &&
        dimensions.every((attributeId) => item.valueIds[attributeId] === selected[attributeId]),
    )
    const variant =
      candidates.length === 1
        ? candidates[0]
        : candidates.find((item) => own.code && item.defaultCode === own.code)
    if (!variant) return fail(row.row, 'values', 'variant')
    variantSources.set(variant.id, row.row)
    for (const [key, field] of [
      ['code', 'defaultCode'],
      ['barcode', 'barcode'],
      ['ownPrice', 'listPrice'],
    ] as const)
      if (own[key]) {
        const value = key === 'ownPrice' ? importMoney(own[key], row.row, key) : own[key]
        if (key === 'ownPrice' ? !sameMoney(value, variant[field]) : value !== variant[field]) {
          variant[field] = value
          variantChanged = true
        }
      }
    if (own.cost) costs.set(variant.id, { row: row.row, value: importMoney(own.cost, row.row, 'cost') })
  }
  if (variantChanged) {
    await written(
      applyVariantSetup(ctx, id, setup.lines, variantPatches),
      line,
      'values',
      true,
      variantPatches.map((item) => variantSources.get(item.id) ?? line),
    )
    changed = true
  }
  for (const [productId, cost] of costs) {
    const held = (await importCatalogue(ctx, 'product.Cost', { productId }))[0]
    if (sameMoney(held?.standardPrice, cost.value)) continue
    if (!(await holdsFunction(ctx, 'product.setCost'))) return fail(cost.row, 'cost', 'permission')
    await written(
      saveProductCost(ctx, { productId, standardPrice: cost.value }, { inTransaction: true }),
      cost.row,
      'cost',
      true,
    )
    changed = true
  }
  // Product code groups the import independently of an explicitly changed SKU code.
  if (variantChanged && rows.some((row) => row.cells.code?.trim()))
    await ctx.db.update('product.Template', { id }, { variantCodeBase: code })
  const afterProducts = await importCatalogue(ctx, 'product.Product', { templateId: id })
  const afterCosts = await importCatalogue(ctx, 'product.Cost')
  const variantIds = afterProducts
    .filter(
      (product) =>
        product.active !== false && before.get(String(product.id)) !== fingerprint(product, afterCosts),
    )
    .map((product) => String(product.id))
  // Tax-only changes also invalidate an already-open product page.
  const final = (await importCatalogue(ctx, 'product.Template', { id }))[0]!
  if (existing && changed && final.revisionId === existing.revisionId)
    await claimProductCodeRevision(ctx, final)
  return {
    templateId: id,
    code,
    name: String(final.name),
    created: !existing,
    changed: Boolean(existing && changed),
    variantIds,
  }
}
