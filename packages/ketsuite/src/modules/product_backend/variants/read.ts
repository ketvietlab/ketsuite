import { savedFilters } from '../filters/read.ts'
import { variantFilterState, VARIANT_FILTERS } from '../filters/state.ts'
import { matchesProductUse } from '../../product/use-filter.ts'
import { catalogueTags } from '../tags/catalogue.ts'
import { categoryDescendants, categoryPaths } from '../../product/category-tree.ts'
// The Variants list's one paged read (design system: "Collections are client islands").
//
// One row per SKU: the item a sales order line, a stock operation, a lot and an invoice
// name. Its product's name and type live on the template, so the read filters both in
// memory with the same accent folding the Units list uses: production databases sort with
// the C collation, where `ilike` does not fold Vietnamese. A template's resting
// default variant (an inactive `combinationKey ''` beside combinations) is not a SKU anyone
// sells and is left out.
//
// Stock is not a dependency of `product_backend`. When it is installed,
// `stock_backend.searchProductVariants` answers through this same read and adds the
// on-hand and available figures of the rows on the page.

import { from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { describeVariants } from '../../product/functions/variants.ts'
import { VARIANT_PRICE_EFFECTS, variantSalePrice } from '../../product/variant-price.ts'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { COLLECTION_PAGE_SIZE } from '../../../ui/collection-state.ts'
import { fold } from '../units.ts'
import { compareNames } from '../../product/text-fold.ts'
import type { VariantAnswer, VariantListQuery, VariantRow } from './shape.ts'

export { VARIANT_LIST_PATH } from './shape.ts'
export type {
  VariantAnswer,
  VariantListQuery,
  VariantRow,
  VariantSort,
  VariantStatus,
  VariantType,
} from './shape.ts'
export const VARIANT_PAGE_SIZE = COLLECTION_PAGE_SIZE
const MAX_PAGE_SIZE = 100

/** What stock adds: on hand and available (on hand less reserved), per SKU of the page. */
export type VariantListStock = {
  figures: (ctx: Ctx, productIds: string[]) => Promise<Map<string, { onHand: number; available: number }>>
}

export type VariantListInput = {
  q?: unknown
  use?: unknown
  type?: unknown
  tagId?: unknown
  categoryId?: unknown
  status?: unknown
  sort?: unknown
  dir?: unknown
  page?: unknown
  pageSize?: unknown
}

/** What the read reads, for the function that declares it. */
export const VARIANT_LIST_EFFECTS = [
  ...AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
  'read:backend.SavedSearch',
  'read:product.Template',
  'read:product.Product',
  'read:product.ProductUom',
  'read:product.Category',
  'read:product.Tag',
  'read:product.TemplateTag',
  'read:product.Cost',
  'read:product.Attribute',
  'read:product.AttributeValue',
  ...VARIANT_PRICE_EFFECTS,
] as const

export const VARIANT_LIST_INPUT = {
  q: 'text?',
  use: 'text?',
  type: 'text?',
  tagId: 'text?',
  categoryId: 'text?',
  status: 'text?',
  sort: 'text?',
  dir: 'text?',
  page: 'int?',
  pageSize: 'int?',
} as const

export const VARIANT_LIST_OUTPUT = {
  query: 'json',
  favorites: 'json',
  total: 'int',
  page: 'int',
  pages: 'int',
  rows: 'json',
  counts: 'json',
  categories: 'json',
  tags: 'json',
  isEmpty: 'bool',
  money: 'bool',
  stock: 'bool',
} as const

/** The query as the read applies it: unknown values fall back to the defaults. */
export const variantListQuery = (input: VariantListInput): VariantListQuery => {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  const asked = Math.trunc(Number(input.pageSize))
  return {
    q: String(input.q ?? '')
      .trim()
      .slice(0, 100),
    use: pick(input.use, ['all', 'sale', 'purchase', 'notSold', 'tracked'] as const, 'all'),
    type: pick(input.type, ['all', 'goods', 'service', 'combo'], 'all'),
    tagId: typeof input.tagId === 'string' && input.tagId ? input.tagId : null,
    categoryId: typeof input.categoryId === 'string' && input.categoryId ? input.categoryId : null,
    status: pick(input.status, ['active', 'archived', 'all'], 'active'),
    sort: pick(input.sort, ['code', 'name'], 'name'),
    dir: pick(input.dir, ['asc', 'desc'], 'asc'),
    page: Math.max(Math.trunc(Number(input.page)) || 1, 1),
    pageSize: asked > 0 ? Math.min(asked, MAX_PAGE_SIZE) : VARIANT_PAGE_SIZE,
  }
}

const textOf = (value: unknown): string | null => (value == null || value === '' ? null : String(value))

const canSeeMoney = async (ctx: Ctx): Promise<boolean> => {
  if (!ctx.actor) return false
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  return allowed === null || allowed.includes('product.listVariantCosts')
}

export const readVariantList = async (
  ctx: Ctx,
  input: VariantListInput,
  stock?: VariantListStock,
): Promise<VariantAnswer> => {
  const query = variantListQuery(input)
  const tags = await catalogueTags(ctx)
  const tagMatches = tags.search(query.q)
  const selectedTags = query.tagId ? tags.templates([query.tagId]) : null
  const [templates, products, categories, values, money, packs] = await Promise.all([
    ctx.db.select('product.Template'),
    ctx.db.select('product.Product'),
    ctx.db.select('product.Category'),
    query.q ? ctx.db.select('product.AttributeValue') : Promise.resolve([] as Row[]),
    canSeeMoney(ctx),
    query.q ? ctx.db.select('product.ProductUom') : Promise.resolve([] as Row[]),
  ])
  const templateOf = new Map(templates.map((row) => [String(row.id), row]))
  // The no-combination row sells only while nothing else does: beside combinations it rests,
  // inactive, and is not a SKU. Once every combination is dropped it sells again and is listed.
  const combined = new Set(
    products.flatMap((row) => (String(row.combinationKey ?? '') !== '' ? [String(row.templateId)] : [])),
  )
  const resting = (row: Row) =>
    String(row.combinationKey ?? '') === '' && row.active === false && combined.has(String(row.templateId))
  const skus = products.filter((row) => templateOf.has(String(row.templateId)) && !resting(row))
  const isActive = (row: Row) =>
    row.active !== false && templateOf.get(String(row.templateId))?.active !== false

  // Search covers the code, the barcode, the product's name and the attribute values.
  const needle = fold(query.q)
  const packagingMatches = new Set(
    packs
      .filter((row) => fold(String(row.barcode ?? '')).includes(needle))
      .map((row) => String(row.productId)),
  )
  const valueMatches = needle
    ? new Set(
        values.flatMap((row) => (fold(String(row.name ?? '')).includes(needle) ? [String(row.id)] : [])),
      )
    : new Set<string>()
  const linked = valueMatches.size
    ? await (async () => {
        const V = ctx.table('product.TemplateAttributeValue')
        const L = ctx.table('product.ProductValue')
        const templateValues = await ctx.db.all(
          from(V)
            .select(V.id!)
            .where(inArray(V.valueId!, [...valueMatches])),
        )
        if (!templateValues.length) return new Set<string>()
        const links = await ctx.db.all(
          from(L)
            .select(L.productId!)
            .where(
              inArray(
                L.templateAttributeValueId!,
                templateValues.map((row) => String(row.id)),
              ),
            ),
        )
        return new Set(links.map((row) => String(row.productId)))
      })()
    : new Set<string>()
  const matches = (row: Row): boolean => {
    if (!needle) return true
    const template = templateOf.get(String(row.templateId))
    return (
      fold(String(row.defaultCode ?? '')).includes(needle) ||
      fold(String(row.barcode ?? '')).includes(needle) ||
      packagingMatches.has(String(row.id)) ||
      fold(String(template?.name ?? '')).includes(needle) ||
      linked.has(String(row.id)) ||
      tagMatches.has(String(row.templateId)) ||
      // A variant written before value links existed is still known by its combination.
      String(row.combinationKey ?? '')
        .split(',')
        .some((id) => valueMatches.has(id))
    )
  }
  const typeOf = (row: Row) => String(templateOf.get(String(row.templateId))?.type ?? 'goods')
  const selectedCategories = query.categoryId ? categoryDescendants(categories, [query.categoryId]) : null
  const searched = skus.filter(
    (row) =>
      matches(row) &&
      matchesProductUse(templateOf.get(String(row.templateId))!, query.use) &&
      (!selectedTags || selectedTags.has(String(row.templateId))) &&
      (!selectedCategories ||
        selectedCategories.has(String(templateOf.get(String(row.templateId))?.categoryId))),
  )
  const statusOk = (row: Row) => query.status === 'all' || isActive(row) === (query.status === 'active')
  const typed = searched.filter((row) => query.type === 'all' || typeOf(row) === query.type)
  const shown = typed.filter(statusOk)

  const nameOf = (row: Row) => String(templateOf.get(String(row.templateId))?.name ?? '')
  const codeOf = (row: Row) => String(row.defaultCode ?? '')
  const order = query.dir === 'desc' ? -1 : 1
  const sorted = [...shown].sort(
    (a, b) =>
      // Sorting by code puts the SKUs that have none last, whichever way it runs.
      (query.sort === 'code' ? Number(!codeOf(a)) - Number(!codeOf(b)) : 0) ||
      order *
        (query.sort === 'code'
          ? compareNames(codeOf(a), codeOf(b)) || compareNames(nameOf(a), nameOf(b))
          : compareNames(nameOf(a), nameOf(b)) || compareNames(codeOf(a), codeOf(b))) ||
      String(a.id).localeCompare(String(b.id)),
  )
  const pages = Math.max(1, Math.ceil(sorted.length / query.pageSize))
  const page = Math.min(query.page, pages)
  const pageRows = sorted.slice((page - 1) * query.pageSize, page * query.pageSize)
  const ids = pageRows.map((row) => String(row.id))

  const [described, costs, figures] = await Promise.all([
    describeVariants(ctx, pageRows),
    money && ids.length
      ? ctx.db.all(from(ctx.table('product.Cost')).where(inArray(ctx.table('product.Cost').productId!, ids)))
      : Promise.resolve([] as Row[]),
    stock && ids.length ? stock.figures(ctx, ids) : Promise.resolve(null),
  ])
  const costOf = new Map(costs.map((row) => [String(row.productId), textOf(row.standardPrice)]))
  const rows: VariantRow[] = []
  for (const row of described) {
    const template = templateOf.get(String(row.templateId))!
    const id = String(row.id)
    const figure = figures?.get(id)
    rows.push({
      id,
      templateId: String(row.templateId),
      code: textOf(row.defaultCode),
      name: String(template.name ?? ''),
      values: textOf(row.name) ?? '',
      barcode: textOf(row.barcode),
      type: String(template.type ?? 'goods'),
      price: await variantSalePrice(ctx, row, template),
      cost: money ? (costOf.get(id) ?? null) : null,
      onHand: figure ? figure.onHand : null,
      available: figure ? figure.available : null,
      active: isActive(row),
    })
  }
  const canonical = (raw: Row) => variantFilterState(variantListQuery(raw))
  const favorites = await savedFilters(ctx, VARIANT_FILTERS, canonical(query), canonical, (row) => {
    const url = new URL('/admin/product/variants', 'http://ket.local')
    for (const [key, value] of Object.entries(canonical(row.state as Row)))
      if (value != null && value !== '')
        url.searchParams.set(key === 'categoryId' ? 'category' : key === 'tagId' ? 'tag' : key, String(value))
    return url.pathname + url.search
  })
  return {
    favorites,
    query: { ...query, page },
    total: sorted.length,
    page,
    pages,
    rows,
    counts: {
      active: typed.filter(isActive).length,
      archived: typed.filter((row) => !isActive(row)).length,
      goods: searched.filter((row) => statusOk(row) && typeOf(row) === 'goods').length,
      service: searched.filter((row) => statusOk(row) && typeOf(row) === 'service').length,
      combo: searched.filter((row) => statusOk(row) && typeOf(row) === 'combo').length,
    },
    tags: tags.choices,
    categories: [...categoryPaths(categories)]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => compareNames(a.name, b.name)),
    isEmpty: skus.length === 0,
    money,
    stock: Boolean(stock),
  }
}
