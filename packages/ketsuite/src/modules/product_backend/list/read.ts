import { savedFilters } from '../filters/read.ts'
import { productFilterState, type SavedFilter } from '../filters/state.ts'
import { catalogueTags } from '../tags/catalogue.ts'
import { categoryPaths, compileCategoryListFilter, hasCategoryFilter } from '../../product/category-tree.ts'
import { addDecimals } from '../../account/money.ts'
import { validGtin } from '../../product/barcodes.ts'
// The product list's one paged read (design system: "Collections are client islands").
//
// The browser sends the list's own URL; this reads it against the list's shape, applies
// it and answers with one page of rows, the count behind each preset, the reader's saved
// searches, and every link the island follows in place: sort headers, pager, group
// toggles and group pagers. The list-state codec runs only here, so the island never
// guesses how a query is spelled.
//
// Stock is not a dependency of `product_backend`. When it is installed,
// `stock_backend.searchProductTemplates` answers through this same read and adds what
// only stock knows: the sellable quantity, its sort and the out-of-stock preset. Without
// stock there is no stock column, no such sort and no such preset at all.

import {
  and,
  asc,
  bucketEq,
  desc,
  encodeListState,
  eq,
  from,
  ilike,
  inArray,
  isNull,
  or,
  parseListState,
  validateListState,
} from '@ketvietlab/ketjs'
import type { Ctx, Expr, ListSearchSpec, ListState, Row, Table } from '@ketvietlab/ketjs'
import { productListSearch } from '../../product/search.ts'
import { fold } from '../units.ts'
import { compareNames } from '../../product/text-fold.ts'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { COLLECTION_PAGE_SIZE } from '../../../ui/collection-state.ts'

export const PRODUCT_LIST_PATH = '/admin/product/templates'
export const PRODUCT_LIST_PAGE_SIZE = COLLECTION_PAGE_SIZE
const MAX_PAGE_SIZE = 100
/** Groups shown at one level; their rows page on their own. */
const GROUP_LIMIT = COLLECTION_PAGE_SIZE

/** What stock adds to the list. */
export type ProductListStock = {
  /**
   * The sellable quantity of every template that keeps stock, in the company in scope.
   * A template that does not keep stock is absent, which the list shows as a dash rather
   * than as zero. The whole catalogue at once: the out-of-stock preset and its count,
   * and the sort by quantity, need every figure anyway.
   */
  availability(ctx: Ctx): Promise<Map<string, number>>
}

export type ProductListRow = {
  id: string
  name: string
  type: string
  /** The default variant's code, else the product's code base a variant holds, else the first variant's. */
  code: string | null
  categoryId: string | null
  category: string | null
  uomId: string | null
  unit: string | null
  listPrice: string
  /** The lowest price a selling variant has before pricelists: own price, or list price plus extras. */
  fromPrice: string
  /** The selling variants do not all sell for `fromPrice`. */
  priceVaries: boolean
  saleOk: boolean
  purchaseOk: boolean
  active: boolean
  /** Selling combinations; zero for a template without attributes. */
  variants: number
  /** The primary image's attachment. */
  image: string | null
  /** Margin on the sales price, in percent; null without the money permission or a known cost. */
  margin: number | null
  /** Sellable now; null when the product keeps no stock or stock is not installed. */
  available: number | null
}

export type ProductListGroup = {
  /** The group's path, as the list state keys open groups and group pages. */
  id: string
  field: string
  value: unknown
  /** The name a reference value stands for (a category, a unit); the island words the rest. */
  name: string | null
  count: number
  open: boolean
  /** Opens or closes this group. */
  href: string
  rows?: ProductListRow[]
  groups?: ProductListGroup[]
  pager?: { from: number; to: number; total: number; previous: string | null; next: string | null }
}

export type ProductListFavorite = SavedFilter

export type ProductListAnswer = {
  /** The query as applied: unknown values dropped, the page clamped. */
  query: ListState
  /** The list's URL for that query; the island writes it back when it differs. */
  href: string
  total: number
  page: number
  pages: number
  pageSize: number
  rows: ProductListRow[]
  groups: ProductListGroup[] | null
  /** Templates each preset would show, with the rest of the query applied. */
  counts: Record<string, number>
  /** Nothing recorded yet, as opposed to nothing matching. */
  isEmpty: boolean
  /** Per sortable column, the link that sorts by it (the current one turns it around). */
  sort: Record<string, string>
  previous: string | null
  next: string | null
  tags?: Array<{ id: string; name: string; href: string; active: boolean }>
  favorites: ProductListFavorite[]
  money: boolean
  stock: boolean
}

export type ProductListInput = { href?: unknown; pageSize?: unknown; timezone?: unknown }

/** What the read reads, for the function that declares it. */
export const PRODUCT_LIST_EFFECTS = [
  ...AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
  'read:product.Template',
  'read:product.Product',
  'read:product.ProductUom',
  'read:product.Category',
  'read:product.Tag',
  'read:product.TemplateTag',
  'read:product.Cost',
  'read:product.ProductValue',
  'read:product.TemplateAttributeValue',
  'read:uom.Unit',
  'read:product_media.Media',
  'read:backend.SavedSearch',
] as const

/** The answer's schema, as the function transport and the staff contract describe it. */
export const PRODUCT_LIST_OUTPUT = {
  query: 'json',
  href: 'text',
  total: 'int',
  page: 'int',
  pages: 'int',
  pageSize: 'int',
  rows: 'json',
  groups: 'json?',
  counts: 'json',
  isEmpty: 'bool',
  sort: 'json',
  previous: 'text?',
  next: 'text?',
  favorites: 'json',
  tags: 'json',
  money: 'bool',
  stock: 'bool',
} as const

/**
 * The list's shape: the catalogue's own search, plus what stock adds when this read
 * answers with it. `outOfStock` holds the templates that preset keeps; the shape only
 * parses and validates, so an empty list is fine for that.
 */
export const productListShape = (
  T: Table,
  stock: boolean,
  outOfStock: readonly string[] = [],
): ListSearchSpec => {
  const domain = productListSearch(T)
  const base = {
    ...domain,
    filterable: [
      ...(domain.filterable ?? []),
      { key: 'tagId', label: 'Tags', col: T.id!, type: 'reference' as const },
    ],
  }
  if (!stock) return base
  return {
    ...base,
    // Sorted in memory: the figure is not a column. The column here is never compiled.
    sortable: [...(base.sortable ?? []), { key: 'available', label: 'Available', col: T.id! }],
    presets: [
      ...(base.presets ?? []),
      { key: 'outOfStock', label: 'Out of stock', group: 'stock', expr: inArray(T.id!, [...outOfStock]) },
    ],
  }
}

const wildcard = (value: string): string => value.replace(/[\\%_]/g, '\\$&')
const round = (value: number): number => Math.round(value * 1000) / 1000
const round1 = (value: number): number => Math.round(value * 10) / 10
const text = (value: unknown): string | null => (value == null || value === '' ? null : String(value))

/**
 * The list's URL, on this list's path whatever the caller sent. A route modal over the
 * list and a one-off notice are not the list's state, so its links do not carry them.
 */
const listUrl = (href: unknown): URL => {
  const url = new URL(typeof href === 'string' && href ? href : PRODUCT_LIST_PATH, 'http://ket.local')
  if (url.pathname !== PRODUCT_LIST_PATH) return new URL(PRODUCT_LIST_PATH, 'http://ket.local')
  for (const key of ['modal', 'favoriteError', 'bulkError', 'record', 'bulkProduct'])
    url.searchParams.delete(key)
  url.hash = ''
  return url
}

const cloneState = (state: ListState): ListState => structuredClone(state)

const samePath = (left: unknown[], right: unknown[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => JSON.stringify(value) === JSON.stringify(right[index]))

const canSeeMoney = async (ctx: Ctx): Promise<boolean> => {
  if (!ctx.actor) return false
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  return allowed === null || allowed.includes('product.listVariantCosts')
}

const favoritesOf = async (
  ctx: Ctx,
  spec: ListSearchSpec,
  state: ListState,
): Promise<ProductListFavorite[]> => {
  const canonical = (raw: Row) => {
    const value = { ...state, ...raw, sort: raw.sort ?? spec.defaultSort ?? [] } as ListState
    validateListState(spec, value)
    return productFilterState(value)
  }
  return savedFilters(ctx, spec.key, productFilterState(state), canonical, (row) => {
    const value = {
      ...state,
      ...canonical(row.state as Row),
      page: 1,
      openGroups: [],
      groupPages: {},
      favoriteId: String(row.id),
    } as ListState
    return encodeListState(value, new URL(PRODUCT_LIST_PATH, 'http://ket.local'))
  })
}

export const readProductList = async (
  ctx: Ctx,
  input: ProductListInput,
  stock?: ProductListStock,
): Promise<ProductListAnswer> => {
  const T = ctx.table('product.Template')
  const url = listUrl(input.href)
  const timezone = typeof input.timezone === 'string' && input.timezone ? input.timezone : 'UTC'
  const asked = Number(input.pageSize)
  const pageSize =
    Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_PAGE_SIZE) : PRODUCT_LIST_PAGE_SIZE
  const state = parseListState(productListShape(T, Boolean(stock)), url).state
  const [money, availability] = await Promise.all([
    canSeeMoney(ctx),
    stock ? stock.availability(ctx) : Promise.resolve(null),
  ])
  const categoryTree = hasCategoryFilter(state.filters) ? await ctx.db.select('product.Category') : []
  const outOfStock = availability ? [...availability].filter(([, value]) => value <= 0).map(([id]) => id) : []
  const spec = productListShape(T, Boolean(stock), outOfStock)
  const groupable = new Map((spec.groupable ?? []).map((field) => [field.key, field]))
  const sortable = new Map((spec.sortable ?? []).map((field) => [field.key, field.col]))

  // Search covers the name and description, and the codes and barcodes of the variants.
  const q = state.q?.trim() ?? ''
  // Names are matched with accents folded in memory: production databases use the C
  // collation, where ilike folds ASCII only and "mat na" would miss "Mặt nạ".
  const needle = fold(q)
  const tags = await catalogueTags(ctx)
  const tagMatches = tags.search(q)
  const textMatches = q
    ? (await ctx.db.all(from(T).select(T.id!, T.name!, T.description!))).flatMap((row) =>
        fold(String(row.name ?? '')).includes(needle) || fold(String(row.description ?? '')).includes(needle)
          ? [String(row.id)]
          : [],
      )
    : []
  const codeMatches = q
    ? await (async () => {
        const P = ctx.table('product.Product')
        const pattern = `%${wildcard(q)}%`
        const barcodePattern = validGtin(q) ? `%${q.replace(/^0+/, '') || q}%` : pattern
        const U = ctx.table('product.ProductUom')
        const packs = await ctx.db.all(
          from(U)
            .select(U.productId!)
            .where(ilike(U.barcode!, barcodePattern, true)),
        )
        const rows = await ctx.db.all(
          from(P)
            .select(P.templateId!)
            .where(
              or(
                ilike(P.defaultCode!, pattern, true),
                ilike(P.barcode!, barcodePattern, true),
                inArray(
                  P.id!,
                  packs.map((row) => String(row.productId)),
                ),
              ),
            ),
        )
        return [...new Set(rows.map((row) => String(row.templateId)))]
      })()
    : []

  const conditions = (applied: ListState, path: unknown[] = []): Expr[] => {
    const parts: Expr[] = []
    if (!applied.includeArchived) parts.push(eq(T.active!, true))
    const compiled = compileCategoryListFilter(
      spec,
      { ...applied, q: undefined },
      categoryTree,
      timezone,
      (rule) => tags.filter(T.id!, rule),
    )
    if (compiled) parts.push(compiled)
    if (q) parts.push(inArray(T.id!, [...new Set([...textMatches, ...codeMatches, ...tagMatches])]))
    path.forEach((value, index) => {
      const selected = applied.groupBy[index]
      const field = selected ? groupable.get(selected.key) : undefined
      if (!field) return
      parts.push(
        value == null
          ? isNull(field.col)
          : selected?.interval
            ? bucketEq(field.col, selected.interval, timezone, String(value))
            : eq(field.col, value),
      )
    })
    return parts
  }
  const where = (applied: ListState, path: unknown[] = []) => {
    const parts = conditions(applied, path)
    return parts.length ? from(T).where(and(...parts)) : from(T)
  }

  const sort = state.sort[0] ?? spec.defaultSort?.[0] ?? { key: 'name', dir: 'asc' as const }
  /** One page of templates under `path`, in the list's order. */
  const pageOf = async (path: unknown[], offset: number, limit: number): Promise<Row[]> => {
    if (sort.key === 'available' && availability) {
      // The figure lives in stock, not in a column: order every match by it, then read the page.
      const matches = await ctx.db.all(where(state, path).select(T.id!, T.name!))
      const figure = (row: Row) => availability.get(String(row.id))
      const ordered = matches.sort((left, right) => {
        const [a, b] = [figure(left), figure(right)]
        // A product that keeps no stock has no figure to order by; it goes last either way.
        if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1
        return (sort.dir === 'desc' ? b - a : a - b) || compareNames(String(left.name), String(right.name))
      })
      const ids = ordered.slice(offset, offset + limit).map((row) => String(row.id))
      if (!ids.length) return []
      const rows = new Map(
        (await ctx.db.all(from(T).where(inArray(T.id!, ids)))).map((row) => [String(row.id), row]),
      )
      return ids.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []))
    }
    if (sort.key === 'listPrice') {
      // The column shows the lowest price a selling variant has, which no column holds:
      // order every match by it, as the page prices them, then cut the page.
      const matches = await ctx.db.all(where(state, path))
      const P = ctx.table('product.Product')
      const ids = matches.map((row) => String(row.id))
      const products = ids.length ? await ctx.db.all(from(P).where(inArray(P.templateId!, ids))) : []
      const variantsOf = byTemplate(products)
      const priced = await pricing(ctx, products, selling, false)
      const figure = new Map(
        matches.map((row) => [
          String(row.id),
          Number(sellingPrices(row, variantsOf.get(String(row.id)) ?? [], priced).lowest),
        ]),
      )
      return matches
        .sort((left, right) => {
          const [a, b] = [figure.get(String(left.id))!, figure.get(String(right.id))!]
          return (
            (sort.dir === 'desc' ? b - a : a - b) ||
            compareNames(String(left.name), String(right.name)) ||
            String(left.id).localeCompare(String(right.id))
          )
        })
        .slice(offset, offset + limit)
    }
    if (sort.key === 'name' || !sortable.has(sort.key)) {
      // Databases order text by bytes (production runs the C collation), which puts Á, Đ or
      // Ô after Z. Order the names as Vietnamese reads them, then read the page.
      const matches = await ctx.db.all(where(state, path).select(T.id!, T.name!))
      const ids = matches
        .sort(
          (left, right) =>
            (sort.dir === 'desc' ? -1 : 1) *
              compareNames(String(left.name ?? ''), String(right.name ?? '')) ||
            String(left.id).localeCompare(String(right.id)),
        )
        .slice(offset, offset + limit)
        .map((row) => String(row.id))
      if (!ids.length) return []
      const rows = new Map(
        (await ctx.db.all(from(T).where(inArray(T.id!, ids)))).map((row) => [String(row.id), row]),
      )
      return ids.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []))
    }
    const col = sortable.get(sort.key)!
    return ctx.db.all(
      where(state, path)
        // The id breaks ties, so two pages never show the same template.
        .orderBy(sort.dir === 'desc' ? desc(col) : asc(col), asc(T.id!))
        .limit(limit)
        .offset(offset),
    )
  }

  const decorate = async (templates: Row[]): Promise<ProductListRow[]> => {
    if (!templates.length) return []
    const ids = templates.map((row) => String(row.id))
    const P = ctx.table('product.Product')
    const M = ctx.table('product_media.Media')
    const categoryIds = [
      ...new Set(templates.flatMap((row) => (row.categoryId ? [String(row.categoryId)] : []))),
    ]
    const unitIds = [...new Set(templates.flatMap((row) => (row.uomId ? [String(row.uomId)] : [])))]
    const Category = ctx.table('product.Category')
    const Unit = ctx.table('uom.Unit')
    const [products, media, categories, units] = await Promise.all([
      ctx.db.all(from(P).where(inArray(P.templateId!, ids))),
      ctx.db.all(
        from(M)
          .where(eq(M.primary!, true), inArray(M.templateId!, ids))
          .orderBy(asc(M.sequence!), asc(M.id!)),
      ),
      // The whole tree: a category reads by its full name, its parents' names first.
      categoryIds.length ? ctx.db.all(from(Category)) : [],
      unitIds.length ? ctx.db.all(from(Unit).where(inArray(Unit.id!, unitIds))) : [],
    ])
    const names = (rows: Row[]) => new Map(rows.map((row) => [String(row.id), String(row.name)]))
    const [categoryName, unitName] = [categoryPaths(categories), names(units)]
    const image = new Map<string, string>()
    for (const row of media)
      if (!image.has(String(row.templateId))) image.set(String(row.templateId), String(row.attachmentId))
    const variantsOf = byTemplate(products)
    const priced = await pricing(ctx, products, selling, money)
    return templates.map((template) => {
      const id = String(template.id)
      const variants = variantsOf.get(id) ?? []
      const { fallback, sold, sellers, prices, lowest } = sellingPrices(template, variants, priced)
      // The original SKU keeps the product's code when it becomes the first combination.
      const base = text(template.variantCodeBase)
      const code =
        text(fallback?.defaultCode) ??
        (base && variants.some((variant) => text(variant.defaultCode) === base) ? base : null) ??
        text(
          [...variants]
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .find((variant) => text(variant.defaultCode))?.defaultCode,
        )
      return {
        id,
        name: String(template.name ?? ''),
        type: String(template.type ?? 'goods'),
        code,
        categoryId: text(template.categoryId),
        category: template.categoryId
          ? (categoryName.get(String(template.categoryId)) ?? String(template.categoryId))
          : null,
        uomId: text(template.uomId),
        unit: template.uomId ? (unitName.get(String(template.uomId)) ?? String(template.uomId)) : null,
        listPrice: String(template.listPrice ?? '0'),
        fromPrice: lowest,
        priceVaries: new Set(prices.map(Number)).size > 1,
        saleOk: template.saleOk !== false,
        purchaseOk: template.purchaseOk !== false,
        active: template.active !== false,
        variants: sold.length,
        image: image.get(id) ?? null,
        margin: money ? marginOf(template, sellers, priced, sold.length > 0) : null,
        available: availability?.has(id) ? round(availability.get(id)!) : null,
      }
    })
  }

  const href = (applied: ListState): string => encodeListState(applied, url)
  const count = (applied: ListState, path: unknown[] = []) => ctx.db.count(where(applied, path))

  const presetGroup = new Map((spec.presets ?? []).map((preset) => [preset.key, preset.group]))
  const counts = Object.fromEntries(
    await Promise.all(
      (spec.presets ?? []).map(async (preset) => {
        // A group's count ignores its own choice: "Services" counts services whatever type is picked.
        const applied = cloneState(state)
        applied.presets = [
          ...applied.presets.filter((key) => presetGroup.get(key) !== preset.group),
          preset.key,
        ]
        return [preset.key, await count(applied)] as const
      }),
    ),
  )

  const total = await count(state)
  const grouped = state.groupBy.length > 0
  const pages = grouped ? 1 : Math.max(1, Math.ceil(total / pageSize))
  const page = grouped ? 1 : Math.min(Math.max(1, state.page), pages)
  const applied = cloneState(state)
  applied.page = page

  const groupsAt = async (path: unknown[]): Promise<ProductListGroup[]> => {
    const selected = state.groupBy[path.length]!
    const field = groupable.get(selected.key)
    if (!field) return []
    const found = await ctx.db.group(
      where(state, path)
        .groupBy({ col: field.col, interval: selected.interval, timezone })
        .orderGroupsBy({ by: 'key', dir: 'asc' })
        .limit(GROUP_LIMIT),
    )
    const refs =
      selected.key === 'categoryId' ? 'product.Category' : selected.key === 'uomId' ? 'uom.Unit' : null
    const values = found.flatMap((group) => (group.key[0] == null ? [] : [String(group.key[0])]))
    const refNames =
      refs && values.length
        ? new Map(
            (await ctx.db.all(from(ctx.table(refs)).where(inArray(ctx.table(refs).id!, values)))).map(
              (row) => [String(row.id), String(row.name)],
            ),
          )
        : new Map<string, string>()
    return Promise.all(
      found.map(async (group) => {
        const value = group.key[0] ?? null
        const nextPath = [...path, value]
        const id = JSON.stringify(nextPath)
        const open = state.openGroups.some((candidate) => samePath(candidate, nextPath))
        const toggled = cloneState(applied)
        toggled.openGroups = open
          ? toggled.openGroups.filter((candidate) => !samePath(candidate.slice(0, nextPath.length), nextPath))
          : [...toggled.openGroups, nextPath]
        const leaf = nextPath.length === state.groupBy.length
        const size = Number(group.count)
        const groupPage = Math.min(
          Math.max(1, state.groupPages[id] ?? 1),
          Math.max(1, Math.ceil(size / pageSize)),
        )
        const pagedTo = (target: number): string => {
          const paged = cloneState(applied)
          if (target <= 1) delete paged.groupPages[id]
          else paged.groupPages[id] = target
          return href(paged)
        }
        const start = (groupPage - 1) * pageSize
        return {
          id,
          field: selected.key,
          value,
          name: value == null ? null : (refNames.get(String(value)) ?? null),
          count: size,
          open,
          href: href(toggled),
          ...(open && !leaf ? { groups: await groupsAt(nextPath) } : {}),
          ...(open && leaf ? { rows: await decorate(await pageOf(nextPath, start, pageSize)) } : {}),
          ...(open && leaf && size > pageSize
            ? {
                pager: {
                  from: start + 1,
                  to: Math.min(start + pageSize, size),
                  total: size,
                  previous: groupPage > 1 ? pagedTo(groupPage - 1) : null,
                  next: start + pageSize < size ? pagedTo(groupPage + 1) : null,
                },
              }
            : {}),
        }
      }),
    )
  }

  const [rows, groups, favorites, recorded] = await Promise.all([
    grouped ? Promise.resolve([]) : pageOf([], (page - 1) * pageSize, pageSize).then(decorate),
    grouped ? groupsAt([]) : Promise.resolve(null),
    favoritesOf(ctx, spec, state),
    total > 0 ? Promise.resolve(true) : ctx.db.count(from(T)).then((all) => all > 0),
  ])
  const sortLinks = Object.fromEntries(
    [...sortable.keys()].map((key) => {
      const next = cloneState(applied)
      next.sort = [{ key, dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' }]
      next.page = 1
      next.groupPages = {}
      return [key, href(next)]
    }),
  )
  const pagedTo = (target: number): string => {
    const next = cloneState(applied)
    next.page = target
    return href(next)
  }
  const tagChoice = (id: string, name: string) => {
    const next = cloneState(applied)
    const current = next.filters.find(
      (node) => node.kind === 'rule' && node.field === 'tagId' && node.operator === 'equals',
    )
    next.filters = next.filters.filter(
      (node) => !(node.kind === 'rule' && node.field === 'tagId' && node.operator === 'equals'),
    )
    if (id) next.filters.push({ kind: 'rule', field: 'tagId', operator: 'equals', value: id })
    next.page = 1
    next.openGroups = []
    next.groupPages = {}
    next.favoriteId = undefined
    return { id, name, href: href(next), active: current?.kind === 'rule' ? current.value === id : !id }
  }
  return {
    tags: [tagChoice('', ''), ...tags.choices.map((tag) => tagChoice(tag.id, tag.name))],
    query: applied,
    href: href(applied),
    total,
    page,
    pages,
    pageSize,
    rows,
    groups,
    counts,
    isEmpty: !recorded,
    sort: sortLinks,
    previous: !grouped && page > 1 ? pagedTo(page - 1) : null,
    next: !grouped && page < pages ? pagedTo(page + 1) : null,
    favorites,
    money,
    stock: Boolean(stock),
  }
}

type Pricing = { cost: Map<string, number>; extra: Map<string, string> }

/** Variants by the template they belong to. */
const byTemplate = (products: Row[]): Map<string, Row[]> => {
  const variantsOf = new Map<string, Row[]>()
  for (const product of products) {
    const list = variantsOf.get(String(product.templateId)) ?? []
    list.push(product)
    variantsOf.set(String(product.templateId), list)
  }
  return variantsOf
}

// Archived combinations do not sell; once every one is archived the default variant sells again.
const selling = (variants: Row[]): Row[] =>
  variants.filter((variant) => String(variant.combinationKey ?? '') !== '' && variant.active !== false)

/**
 * What one product sells for: the variants that sell, each one's price and the lowest of
 * them, the list's From price. The page and the sort by price read it the same way.
 */
const sellingPrices = (template: Row, variants: Row[], priced: Pricing) => {
  const fallback = variants.find((variant) => String(variant.combinationKey ?? '') === '')
  const sold = selling(variants)
  const sellers = sold.length ? sold : fallback ? [fallback] : []
  const prices = sellers.map((variant) => priceOf(template, variant, priced, sold.length > 0))
  const lowest = prices.reduce<string | null>(
    (low, price) => (low === null || Number(price) < Number(low) ? price : low),
    null,
  )
  return { fallback, sold, sellers, prices, lowest: lowest ?? String(template.listPrice ?? '0') }
}

/**
 * Value surcharges of the variants on the page and, for a viewer allowed money, their costs
 * (this company's), in a few reads rather than one per variant.
 */
const pricing = async (
  ctx: Ctx,
  products: Row[],
  selling: (variants: Row[]) => Row[],
  money: boolean,
): Promise<Pricing> => {
  const ids = products.map((product) => String(product.id))
  const company = money ? ctx.scope.company : null
  const C = ctx.table('product.Cost')
  const V = ctx.table('product.ProductValue')
  const [costs, links] = await Promise.all([
    company && ids.length
      ? ctx.db.all(from(C).where(eq(C.companyId!, company), inArray(C.productId!, ids)))
      : [],
    ids.length
      ? ctx.db.all(
          from(V).where(
            inArray(
              V.productId!,
              selling(products).map((row) => String(row.id)),
            ),
          ),
        )
      : [],
  ])
  const valueIds = [...new Set(links.map((link) => String(link.templateAttributeValueId)))]
  const A = ctx.table('product.TemplateAttributeValue')
  const values = valueIds.length ? await ctx.db.all(from(A).where(inArray(A.id!, valueIds))) : []
  const surcharge = new Map(values.map((value) => [String(value.id), String(value.priceExtra ?? '0')]))
  const extra = new Map<string, string>()
  for (const link of links)
    extra.set(
      String(link.productId),
      addDecimals(
        extra.get(String(link.productId)) ?? '0',
        surcharge.get(String(link.templateAttributeValueId)) ?? '0',
      ),
    )
  return {
    cost: new Map(
      costs.flatMap((row) =>
        row.standardPrice == null ? [] : [[String(row.productId), Number(row.standardPrice)] as const],
      ),
    ),
    extra,
  }
}

/**
 * The page's margin (`productMargin`): over the selling variants whose cost is known, or
 * the default variant's when there are none; a price of zero has no margin, nor does a
 * product that is not sold.
 */
const marginOf = (template: Row, variants: Row[], priced: Pricing, combinations: boolean): number | null => {
  if (template.saleOk === false) return null
  const pairs = variants.flatMap((variant) => {
    const cost = priced.cost.get(String(variant.id))
    if (cost === undefined) return []
    const price = Number(priceOf(template, variant, priced, combinations))
    return price > 0 ? [[price, cost] as const] : []
  })
  if (!pairs.length) return null
  const price = pairs.reduce((sum, [value]) => sum + value, 0) / pairs.length
  const cost = pairs.reduce((sum, [, value]) => sum + value, 0) / pairs.length
  return round1(((price - cost) / price) * 100)
}

/**
 * One variant's price before pricelists, as `variantSalePrice` reads it: its own price when
 * set, otherwise the list price plus the extras of its values (none for the default variant).
 */
const priceOf = (template: Row, variant: Row, priced: Pricing, combinations: boolean): string => {
  const own = variant.listPriceOverride
  if (own != null && String(own).trim() !== '') return String(own)
  const listPrice = String(template.listPrice ?? '0')
  const extra = combinations ? (priced.extra.get(String(variant.id)) ?? '0') : '0'
  return extra === '0' || Number(extra) === 0 ? listPrice : addDecimals(listPrice, extra)
}
