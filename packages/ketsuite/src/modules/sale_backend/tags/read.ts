import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { fold } from '../../product/text-fold.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { TAG_PATH, tagHref, tagQuery } from './shared.ts'
import type { TagAnswer, TagModalData, TagRow } from './shared.ts'

const str = (value: unknown) => String(value ?? '')

export function tagAnswer(tags: Row[], args: Row): TagAnswer {
  const requested = new URL(str(args.href) || TAG_PATH, 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  const query = tagQuery(requested, Number(args.pageSize) || undefined)
  const url = new URL(query.href, 'http://ket.local')
  const matched = tags.filter((row) => fold(str(row.name)).includes(fold(query.q)))
  const active = matched.filter((row) => row.active !== false).length
  const status = url.searchParams.get('status')
  const rows: TagRow[] = matched
    .filter(
      (row) => status === 'all' || (status === 'archived' ? row.active === false : row.active !== false),
    )
    .map((row) => ({
      id: str(row.id),
      name: str(row.name),
      active: row.active !== false,
      orderCount: Number(row.orderCount ?? 0),
      editHref: '',
    }))
  const direction = url.searchParams.get('dir') === 'desc' ? -1 : 1
  rows.sort(
    (a, b) =>
      direction *
        (url.searchParams.get('sort') === 'orders'
          ? a.orderCount - b.orderCount || a.name.localeCompare(b.name, 'vi')
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
    counts: { active, archived: matched.length - active, all: matched.length },
    isEmpty: tags.length === 0,
    rows: rows
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map((row) => ({ ...row, editHref: recordModalHref(href, { kind: 'sale.tag', id: row.id }) })),
    ...(page > 1 ? { previous: tagHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: tagHref(href, { page: String(page + 1) }) } : {}),
  }
}

export const tagRead =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.allows('sale.listTags', url, req))) return text('Forbidden', { status: 403 })
    const input = await readForm(req)
    const tags = (await ctx.call('sale.listTags', { includeArchived: true }, url, req)) as Row[]
    return json({ ok: true, value: tagAnswer(tags, input) })
  }

export const tagContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    const edit = await ctx.allows('sale.saveTag', url, req)
    if (!(await ctx.allows('sale.listTags', url, req)) || (creating && !edit))
      return text('Forbidden', { status: 403 })
    const current = creating
      ? undefined
      : ((await ctx.call('sale.listTags', { ids: [params.id] }, url, req)) as Row[])[0]
    if (!creating && !current) return text('Not found', { status: 404 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const active = current?.active !== false
    const data: TagModalData = {
      lang,
      record: {
        id: current ? str(current.id) : randomUUID(),
        name: str(current?.name),
        active,
        revisionId: str(current?.revisionId),
      },
      permissions: { edit: active && edit, lifecycle: await ctx.allows('sale.setTagActive', url, req) },
      usage: { orders: Number(current?.orderCount ?? 0) },
    }
    const manifest = await ctx.live(req)
    return json({
      data,
      messages: Object.fromEntries(
        Object.entries(manifest.messages?.[lang] ?? {}).filter(
          ([key]) =>
            key.startsWith('sale_backend.tag.') ||
            key.startsWith('sale.error.tag.') ||
            key.startsWith('recordModal.'),
        ),
      ),
    })
  }
