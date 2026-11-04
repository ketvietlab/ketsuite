import type { Ctx, Row } from '@ketvietlab/ketjs'
import { randomUUID } from 'node:crypto'
import { categoryDescendants } from '../../product/category-tree.ts'
import { categoryRevision } from '../../product/category-policy.ts'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { CATEGORY_PATH, categoryHref, categoryQuery } from './shared.ts'
import type { CategoryAnswer, CategoryModalData, CategoryRow } from './shared.ts'

export const CATEGORY_READ_EFFECTS = [
  'read:product.Category',
  'read:product.Template',
  'read:account.CategoryAccount',
  'read:account.Account',
  'read:pricing.Pricelist',
  'read:pricing.PricelistItem',
]
export const CATEGORY_CONTEXT_EFFECTS = [...CATEGORY_READ_EFFECTS, ...AUTHORIZATION_READ_EFFECTS]
const fold = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
const text = (value: unknown) => (value == null ? '' : String(value))
async function dataOf(ctx: Ctx) {
  const read = (key: string) => (ctx.manifest.models[key] ? ctx.db.select(key) : Promise.resolve([] as Row[]))
  const [categories, products, mappings, accounts, lists, rules] = await Promise.all([
    read('product.Category'),
    read('product.Template'),
    read('account.CategoryAccount'),
    read('account.Account'),
    read('pricing.Pricelist'),
    read('pricing.PricelistItem'),
  ])
  const byId = new Map(categories.map((row) => [text(row.id), row]))
  const mapping = new Map(mappings.map((row) => [text(row.categoryId), row]))
  const account = new Map(accounts.map((row) => [text(row.id), row]))
  const path = (id: unknown) => {
    const names: string[] = [],
      seen = new Set<string>()
    let current = byId.get(text(id))
    while (current && !seen.has(text(current.id))) {
      seen.add(text(current.id))
      names.unshift(text(current.name))
      current = byId.get(text(current.parentId))
    }
    return names.join(' / ')
  }
  const label = (id: unknown) => {
    const row = account.get(text(id))
    return row ? `${text(row.code)} · ${text(row.name)}` : text(id)
  }
  const inherited = (id: unknown, field: string) => {
    const seen = new Set<string>()
    while (id && !seen.has(text(id))) {
      seen.add(text(id))
      const value = mapping.get(text(id))?.[field]
      if (value) return label(value)
      id = byId.get(text(id))?.parentId
    }
    return ''
  }
  const usage = (id: string) => {
    const subtree = categoryDescendants(categories, [id])
    const usedLists = new Set(
      rules
        .filter((rule) => rule.appliedOn === '2_product_category' && subtree.has(text(rule.categoryId)))
        .map((rule) => text(rule.pricelistId)),
    )
    return {
      products: products.filter((row) => row.active !== false && subtree.has(text(row.categoryId))).length,
      children: categories
        .filter((row) => row.parentId === id && row.active !== false)
        .map((row) => path(row.id)),
      pricelists: lists
        .filter((row) => row.active !== false && usedLists.has(text(row.id)))
        .map((row) => text(row.name)),
    }
  }
  return { categories, accounts, byId, mapping, path, inherited, usage }
}

export async function readCategories(ctx: Ctx, args: Row): Promise<CategoryAnswer> {
  const requested = new URL(text(args.href) || CATEGORY_PATH, 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  const query = categoryQuery(requested, Number(args.pageSize) || undefined)
  const url = new URL(query.href, 'http://ket.local'),
    data = await dataOf(ctx)
  const matched = data.categories.filter((row) => fold(data.path(row.id)).includes(fold(query.q)))
  const active = matched.filter((row) => row.active !== false).length
  const counts = { active, archived: matched.length - active, all: matched.length }
  const status = url.searchParams.get('status')
  const visible = matched.filter(
    (row) => status === 'all' || (status === 'archived' ? row.active === false : row.active !== false),
  )
  const direction = url.searchParams.get('dir') === 'desc' ? -1 : 1
  const prepared = visible.map(
    (row): CategoryRow => ({
      id: text(row.id),
      name: text(row.name),
      parentId: row.parentId ? text(row.parentId) : null,
      active: row.active !== false,
      path: data.path(row.id),
      income: data.inherited(row.id, 'incomeAccountId'),
      expense: data.inherited(row.id, 'expenseAccountId'),
      productCount: data.usage(text(row.id)).products,
      editHref: '',
    }),
  )
  prepared.sort(
    (a, b) =>
      direction *
        (url.searchParams.get('sort') === 'products'
          ? a.productCount - b.productCount || a.path.localeCompare(b.path, 'vi')
          : a.path.localeCompare(b.path, 'vi')) || a.id.localeCompare(b.id),
  )
  const pages = Math.max(1, Math.ceil(prepared.length / query.pageSize)),
    page = Math.min(query.page, pages)
  const href = categoryHref(query.href, { page: page > 1 ? String(page) : null })
  return {
    query: { ...query, page, href },
    total: prepared.length,
    page,
    pages,
    counts,
    isEmpty: data.categories.length === 0,
    rows: prepared
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map((row) => ({ ...row, editHref: recordModalHref(href, { kind: 'product.category', id: row.id }) })),
    ...(page > 1 ? { previous: categoryHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: categoryHref(href, { page: String(page + 1) }) } : {}),
  }
}

export async function categoryContextHandler(ctx: Ctx, args: Row) {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : null
  const can = (fn: string) => allowed === null || allowed.includes(fn)
  if (!can('product.listCategories') || (!args.id && !can('product.saveCategory'))) return null
  const data = await dataOf(ctx),
    current = args.id ? data.byId.get(text(args.id)) : undefined
  if (args.id && !current) return null
  const id = text(args.id),
    held = data.mapping.get(id),
    active = current?.active !== false
  const usage = current ? data.usage(id) : { products: 0, children: [], pricelists: [] }
  const descendants = categoryDescendants(data.categories, [id])
  const accountOptions = (types: string[]) =>
    data.accounts
      .filter(
        (row) =>
          types.includes(text(row.accountType)) &&
          (row.active !== false || row.id === held?.incomeAccountId || row.id === held?.expenseAccountId),
      )
      .map((row) => ({ value: text(row.id), label: `${text(row.code)} · ${text(row.name)}` }))
      .sort((a, b) => a.label.localeCompare(b.label))
  const modal: CategoryModalData = {
    lang: args.locale === 'en' ? 'en' : 'vi',
    record: {
      id: id || randomUUID(),
      name: text(current?.name),
      parentId: text(current?.parentId),
      incomeAccountId: text(held?.incomeAccountId),
      expenseAccountId: text(held?.expenseAccountId),
      active,
      revision: current ? categoryRevision(current, held) : '',
      path: current ? data.path(id) : '',
    },
    permissions: {
      general: active && can('product.saveCategory') && can('product.saveCategoryRecord'),
      accounts: active && can('account.saveCategoryAccount') && can('product.saveCategoryRecord'),
      lifecycle: can('product.setCategoryActive'),
    },
    parents: data.categories
      .filter((row) => row.active !== false && !descendants.has(text(row.id)))
      .map((row) => ({ value: text(row.id), label: data.path(row.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    incomeAccounts: accountOptions(['income', 'income_other']),
    expenseAccounts: accountOptions([
      'asset_current',
      'expense',
      'expense_other',
      'expense_depreciation',
      'expense_direct_cost',
    ]),
    inherited: {
      income: data.inherited(current?.parentId, 'incomeAccountId'),
      expense: data.inherited(current?.parentId, 'expenseAccountId'),
    },
    usage,
    canArchive:
      active && usage.products === 0 && usage.children.length === 0 && usage.pricelists.length === 0,
    canRestore:
      !active &&
      (!current?.parentId ||
        Boolean(
          data.byId.get(text(current.parentId)) && data.byId.get(text(current.parentId))?.active !== false,
        )),
  }
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[modal.lang] ?? {})
      .filter(
        ([key]) =>
          key.startsWith('product_backend.category.') ||
          key.startsWith('product.error.category.') ||
          key.startsWith('recordModal.') ||
          key.startsWith('backend.relation.') ||
          key.startsWith('account.error.'),
      )
      .map(([key, value]) => [key, typeof value === 'string' ? value : String(value.other ?? key)]),
  )
  return { data: modal, messages }
}

/** The public list and catalogue search share this read service. */
export function searchCategoriesHandler(ctx: Ctx, args: Row) {
  return readCategories(ctx, args)
}
