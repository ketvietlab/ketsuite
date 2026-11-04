import { randomUUID } from 'node:crypto'
import { defineFn, parseListState, validateListState } from '@ketvietlab/ketjs'
import type { Ctx, Row, ListState } from '@ketvietlab/ketjs'
import { readVisibleSearch, saveOwnedSearch, removeOwnedSearch } from '../../backend/saved-search-policy.ts'
import { productListShape } from '../list/read.ts'
import { variantListQuery } from '../variants/read.ts'
import {
  PRODUCT_FILTERS,
  VARIANT_FILTERS,
  productFilterState,
  variantFilterState,
  type FilterModalData,
} from '../filters/state.ts'
const validList = (key: unknown) => key === PRODUCT_FILTERS || key === VARIANT_FILTERS
const spec = (ctx: Ctx) =>
  productListShape(
    ctx.table('product.Template'),
    Boolean(ctx.manifest.functions['stock_backend.searchProductTemplates']),
  )
function canonical(ctx: Ctx, listKey: unknown, state: Row) {
  if (!validList(listKey) || !state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('invalid filter')
  if (listKey === VARIANT_FILTERS) return variantFilterState(variantListQuery(state))
  const shape = spec(ctx),
    fallback = parseListState(shape, new URL('http://ket.local')).state
  const value = { ...fallback, ...productFilterState(state as Partial<ListState>) }
  if (!value.sort.length) value.sort = fallback.sort
  validateListState(shape, value)
  return productFilterState(value)
}
export async function filterContextHandler(ctx: Ctx, args: Row) {
  if (!ctx.actor || !ctx.scope.company || !validList(args.listKey)) return null
  const existing = args.id !== 'new'
  const row = existing ? await readVisibleSearch(ctx, args.id, String(args.listKey)) : null
  if (existing && (!row || row.ownerId !== ctx.actor)) return null
  let state: Row
  try {
    const url = new URL(String(args.href ?? ''), 'http://ket.local')
    state = row
      ? canonical(ctx, args.listKey, row.state as Row)
      : args.listKey === VARIANT_FILTERS
        ? canonical(ctx, args.listKey, {
            ...Object.fromEntries(url.searchParams),
            categoryId: url.searchParams.get('category'),
            tagId: url.searchParams.get('tag'),
          })
        : canonical(ctx, args.listKey, parseListState(spec(ctx), url).state)
  } catch {
    return null
  }
  const lang = args.locale === 'en' ? 'en' : 'vi'
  const data: FilterModalData = {
    id: row ? String(row.id) : randomUUID(),
    listKey: String(args.listKey),
    state,
    name: String(row?.name ?? ''),
    shared: row?.shared === true,
    isDefault: Boolean(row?.defaultKey),
    existing,
    revisionId: row ? String(row.revisionId ?? 'initial') : undefined,
    lang,
  }
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[lang] ?? {}).filter(
      ([key]) =>
        key.startsWith('product_backend.filters.') ||
        key.startsWith('backend.error.savedSearch.') ||
        key.startsWith('recordModal.'),
    ),
  )
  return { data, messages }
}
export async function saveFilterHandler(ctx: Ctx, args: Row) {
  if (!ctx.scope.company || !validList(args.listKey))
    return { ok: false, errors: [{ field: 'name', code: 'backend.error.savedSearch.state' }] }
  let state: Row
  try {
    state = canonical(ctx, args.listKey, args.state as Row)
  } catch {
    return { ok: false, errors: [{ field: 'name', code: 'backend.error.savedSearch.state' }] }
  }
  const current = (await ctx.db.select('backend.SavedSearch', { id: args.id }))[0]
  if (current && args.expectedRevisionId == null)
    return { ok: false, errors: [{ field: 'name', code: 'backend.error.savedSearch.conflict' }] }
  return saveOwnedSearch(ctx, { ...args, state })
}
export async function deleteFilterHandler(ctx: Ctx, args: Row) {
  if (!ctx.scope.company || !validList(args.listKey) || !args.expectedRevisionId)
    return { ok: false, errors: [{ field: 'name', code: 'backend.error.savedSearch.state' }] }
  return removeOwnedSearch(ctx, args)
}
const effects = ['read:backend.SavedSearch', 'write:backend.SavedSearch']
export const filterFunctions = {
  filterContext: defineFn({
    input: { id: 'text', listKey: 'text', href: 'text?', locale: 'text?' },
    effects: ['read:backend.SavedSearch'],
    handler: filterContextHandler,
  }),
  saveFilter: defineFn({
    idempotent: true,
    input: {
      id: 'id',
      listKey: 'text',
      name: 'text',
      shared: 'bool',
      default: 'bool?',
      state: 'json',
      expectedRevisionId: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects,
    handler: saveFilterHandler,
  }),
  deleteFilter: defineFn({
    idempotent: true,
    input: { id: 'id', listKey: 'text', expectedRevisionId: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects,
    handler: deleteFilterHandler,
  }),
}
