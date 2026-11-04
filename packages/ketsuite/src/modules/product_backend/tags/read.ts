import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { fold } from '../units.ts'
import { TAG_PATH, tagHref, tagQuery } from './shared.ts'
import type { TagAnswer, TagModalData, TagRow } from './shared.ts'

export const TAG_READ_EFFECTS = ['read:product.Tag', 'read:product.TemplateTag', 'read:product.Template']
export const TAG_CONTEXT_EFFECTS = [...TAG_READ_EFFECTS, ...AUTHORIZATION_READ_EFFECTS]
const text = (value: unknown) => String(value ?? '')
async function dataOf(ctx: Ctx) {
  const [tags, assignments, products] = await Promise.all([
    ctx.db.select('product.Tag'),
    ctx.db.select('product.TemplateTag'),
    ctx.db.select('product.Template'),
  ])
  const productsByTag = new Map<string, Set<string>>()
  for (const link of assignments) {
    const ids = productsByTag.get(text(link.tagId)) ?? new Set<string>()
    ids.add(text(link.templateId))
    productsByTag.set(text(link.tagId), ids)
  }
  const usage = (id: string) => {
    const names = products
      .filter((row) => row.active !== false && productsByTag.get(id)?.has(text(row.id)))
      .map((row) => text(row.name))
      .sort((a, b) => a.localeCompare(b, 'vi'))
    return { products: names.length, names }
  }
  return { tags, usage }
}
export async function readTags(ctx: Ctx, args: Row): Promise<TagAnswer> {
  const requested = new URL(text(args.href) || TAG_PATH, 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  const query = tagQuery(requested, Number(args.pageSize) || undefined)
  const url = new URL(query.href, 'http://ket.local'),
    data = await dataOf(ctx)
  const matched = data.tags.filter((row) => fold(text(row.name)).includes(fold(query.q)))
  const active = matched.filter((row) => row.active !== false).length
  const counts = { active, archived: matched.length - active, all: matched.length }
  const status = url.searchParams.get('status')
  const rows: TagRow[] = matched
    .filter(
      (row) => status === 'all' || (status === 'archived' ? row.active === false : row.active !== false),
    )
    .map((row) => ({
      id: text(row.id),
      name: text(row.name),
      active: row.active !== false,
      productCount: data.usage(text(row.id)).products,
      editHref: '',
    }))
  const direction = url.searchParams.get('dir') === 'desc' ? -1 : 1
  rows.sort(
    (a, b) =>
      direction *
        (url.searchParams.get('sort') === 'products'
          ? a.productCount - b.productCount || a.name.localeCompare(b.name, 'vi')
          : a.name.localeCompare(b.name, 'vi')) || a.id.localeCompare(b.id),
  )
  const pages = Math.max(1, Math.ceil(rows.length / query.pageSize)),
    page = Math.min(query.page, pages)
  const href = tagHref(query.href, { page: page > 1 ? String(page) : null })
  return {
    query: { ...query, page, href },
    total: rows.length,
    page,
    pages,
    counts,
    isEmpty: data.tags.length === 0,
    rows: rows
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map((row) => ({ ...row, editHref: recordModalHref(href, { kind: 'product.tag', id: row.id }) })),
    ...(page > 1 ? { previous: tagHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: tagHref(href, { page: String(page + 1) }) } : {}),
  }
}
export async function tagContextHandler(ctx: Ctx, args: Row) {
  if (!ctx.actor) return null
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  const can = (fn: string) => allowed === null || allowed.includes(fn)
  if (!can('product.listTags') || (!args.id && !can('product.saveTag'))) return null
  const data = await dataOf(ctx),
    current = args.id ? data.tags.find((row) => row.id === args.id) : undefined
  if (args.id && !current) return null
  const active = current?.active !== false
  const modal: TagModalData = {
    lang: args.locale === 'en' ? 'en' : 'vi',
    record: {
      id: current ? text(current.id) : randomUUID(),
      name: text(current?.name),
      active,
      revisionId: text(current?.revisionId),
    },
    permissions: { edit: active && can('product.saveTag'), lifecycle: can('product.setTagActive') },
    usage: current ? data.usage(text(current.id)) : { products: 0, names: [] },
  }
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[modal.lang] ?? {})
      .filter(
        ([key]) =>
          key.startsWith('product_backend.tag.') ||
          key.startsWith('product.error.tag.') ||
          key.startsWith('recordModal.'),
      )
      .map(([key, value]) => [key, typeof value === 'string' ? value : String(value.other ?? key)]),
  )
  return { data: modal, messages }
}

/** The public list and catalogue search share this read service. */
export function searchTagsHandler(ctx: Ctx, args: Row) {
  return readTags(ctx, args)
}
