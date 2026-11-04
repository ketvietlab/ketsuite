import { from } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { PRODUCT_LIST_EFFECTS, readProductList } from '../list/read.ts'
import { VARIANT_LIST_EFFECTS, readVariantList } from '../variants/read.ts'
import { CATEGORY_READ_EFFECTS, readCategories } from '../categories/read.ts'
import { TAG_READ_EFFECTS, readTags } from '../tags/read.ts'
import { COMBO_READ_EFFECTS, readCombos } from '../combos/read.ts'
import { IMPORT_READ_EFFECTS, readImports } from '../imports/read.ts'
import { fold, readUnits } from '../units.ts'
import {
  SEARCH_PATH,
  SEARCH_PAGE_SIZE,
  searchQuery,
  searchHref,
  type SearchKind,
  type SearchRow,
  type SearchAnswer,
} from './shared.ts'

export const SEARCH_EFFECTS = [
  ...new Set([
    ...AUTHORIZATION_READ_EFFECTS,
    ...PRODUCT_LIST_EFFECTS,
    ...VARIANT_LIST_EFFECTS,
    ...CATEGORY_READ_EFFECTS,
    ...TAG_READ_EFFECTS,
    ...COMBO_READ_EFFECTS,
    ...IMPORT_READ_EFFECTS,
    'read:product.Attribute',
    'read:product.AttributeValue',
    'read:product.TemplateUom',
  ]),
]
type Page = { total: number; rows: Row[] }
type Provider = { kind: SearchKind; grants: readonly string[]; read: (page: number) => Promise<Page> }
async function attributePage(ctx: Ctx, q: string, page: number): Promise<Page> {
  const A = ctx.table('product.Attribute'),
    needle = fold(q)
  const rows = (await ctx.db.all(from(A).preload('values')))
    .filter(
      (row) =>
        row.active !== false &&
        fold(`${row.name} ${((row.values ?? []) as Row[]).map((value) => value.name).join(' ')}`).includes(
          needle,
        ),
    )
    .sort(
      (a, b) =>
        Number(a.sequence ?? 0) - Number(b.sequence ?? 0) ||
        String(a.name).localeCompare(String(b.name), 'vi') ||
        String(a.id).localeCompare(String(b.id)),
    )
  return { total: rows.length, rows: rows.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE) }
}
const destinations: Record<Exclude<SearchKind, 'template' | 'variant'>, { path: string; kind: string }> = {
  attribute: { path: '/admin/product/attributes', kind: 'product.attribute' },
  unit: { path: '/admin/product/uoms', kind: 'product.uom' },
  category: { path: '/admin/product/categories', kind: 'product.category' },
  tag: { path: '/admin/product/tags', kind: 'product.tag' },
  combo: { path: '/admin/product/combos', kind: 'product.combo' },
  import: { path: '/admin/product/imports', kind: 'product.import' },
}
function resultRow(row: Row, kind: SearchKind, source: string): SearchRow {
  const id = String(row.id),
    context = new URL(source, 'http://ket.local')
  const parent = kind === 'variant' ? String(row.templateId) : id
  const target = new URL(
    kind === 'template' || kind === 'variant'
      ? `/admin/product/templates/${encodeURIComponent(parent)}`
      : destinations[kind].path,
    context,
  )
  for (const key of ['company', 'branch', 'lang']) {
    const value = context.searchParams.get(key)
    if (value) target.searchParams.set(key, value)
  }
  // A record returns to the search, while configuration opens over its own collection.
  target.searchParams.set('returnTo', source)
  const href =
    kind === 'template' || kind === 'variant'
      ? target.pathname + target.search
      : recordModalHref(target, { kind: destinations[kind].kind, id })
  return {
    id: `${kind}:${id}`,
    recordId: id,
    kind,
    // SKUs of one product share its name; their values tell them apart, as on the Variants list.
    name: kind === 'variant' && row.values ? `${row.name} · ${row.values}` : String(row.name ?? ''),
    code: String(row.code ?? ''),
    href,
  }
}
/** One bounded page across the same company-scoped reads as the eight collections. */
export async function readCatalogueSearch(ctx: Ctx, args: Row): Promise<SearchAnswer> {
  const requested = new URL(String(args.href ?? SEARCH_PATH), 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  if (ctx.scope.company) requested.searchParams.set('company', ctx.scope.company)
  const query = searchQuery(requested)
  const empty = {
    query: { ...query, page: 1, href: searchHref(query.href, { page: null }) },
    rows: [],
    total: 0,
    page: 1,
    pages: 1,
    counts: {},
    isEmpty: true,
  }
  if (!query.q || !ctx.actor || !ctx.scope.company) return empty
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  const may = (fn: string) =>
    Boolean(ctx.manifest.functions[fn]) && (allowed === null || allowed.includes(fn))
  const input = (page: number) => ({ q: query.q, page, pageSize: SEARCH_PAGE_SIZE })
  const productHref = (page: number) => {
    const url = new URL('/admin/product/templates', 'http://ket.local')
    url.searchParams.set('q', query.q)
    url.searchParams.set('page', String(page))
    return url.pathname + url.search
  }
  const available: Provider[] = [
    {
      kind: 'template',
      grants: ['product_backend.searchTemplates', 'product.getTemplate'],
      read: (page) => readProductList(ctx, { href: productHref(page), pageSize: SEARCH_PAGE_SIZE }),
    },
    {
      kind: 'variant',
      grants: ['product_backend.searchVariants', 'product.getTemplate'],
      read: (page) => readVariantList(ctx, input(page)),
    },
    {
      kind: 'attribute',
      grants: ['product.listAttributes', 'product.attributeModalContext'],
      read: (page) => attributePage(ctx, query.q, page),
    },
    {
      kind: 'unit',
      grants: ['product_backend.searchUnits', 'product_backend.unitContext'],
      read: (page) => readUnits(ctx, input(page)),
    },
    {
      kind: 'category',
      grants: ['product_backend.searchCategories', 'product_backend.categoryContext'],
      read: (page) => readCategories(ctx, input(page)),
    },
    {
      kind: 'tag',
      grants: ['product_backend.searchTags', 'product_backend.tagContext'],
      read: (page) => readTags(ctx, input(page)),
    },
    {
      kind: 'combo',
      grants: ['product_backend.searchCombos', 'product_backend.comboContext'],
      read: (page) => readCombos(ctx, input(page)),
    },
    {
      kind: 'import',
      grants: ['product_backend.searchImports', 'product.listImports', 'product_backend.importContext'],
      read: (page) => readImports(ctx, input(page)),
    },
  ]
  const providers = available.filter((provider) => provider.grants.every(may))
  const initial = await Promise.all(providers.map((provider) => provider.read(1)))
  const total = initial.reduce((sum, answer) => sum + answer.total, 0),
    pages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
    page = Math.min(query.page, pages)
  const href = searchHref(query.href, { page: page > 1 ? String(page) : null })
  let offset = (page - 1) * SEARCH_PAGE_SIZE
  const rows: SearchRow[] = []
  for (let index = 0; index < providers.length && rows.length < SEARCH_PAGE_SIZE; index++) {
    const provider = providers[index]!,
      first = initial[index]!
    if (offset >= first.total) {
      offset -= first.total
      continue
    }
    let position = offset
    while (position < first.total && rows.length < SEARCH_PAGE_SIZE) {
      const sourcePage = Math.floor(position / SEARCH_PAGE_SIZE) + 1
      const answer = sourcePage === 1 ? first : await provider.read(sourcePage)
      const part = answer.rows.slice(
        position % SEARCH_PAGE_SIZE,
        (position % SEARCH_PAGE_SIZE) + SEARCH_PAGE_SIZE - rows.length,
      )
      if (!part.length) break
      rows.push(...part.map((row) => resultRow(row, provider.kind, href)))
      position += part.length
    }
    offset = 0
  }
  return {
    query: { ...query, page, href },
    rows,
    total,
    page,
    pages,
    counts: {},
    isEmpty: total === 0,
    ...(page > 1 ? { previous: searchHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: searchHref(href, { page: String(page + 1) }) } : {}),
  }
}
