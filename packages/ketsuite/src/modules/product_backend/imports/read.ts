import { from, inArray } from '@ketvietlab/ketjs'
import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { readProductImport, readProductImports } from '../../product/import-history.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import {
  IMPORT_PATH,
  importQuery,
  importHref,
  type ImportAnswer,
  type ImportModalData,
  type ImportRow,
} from './shared.ts'
export const IMPORT_READ_EFFECTS = [
  'read:company.Company',
  'read:product.Import',
  'read:product.ImportItem',
  'read:product.Template',
  'read:user.User',
  ...AUTHORIZATION_READ_EFFECTS,
]
async function importTimezone(ctx: Ctx): Promise<string> {
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : undefined
  return String(company?.accountingTimezone ?? 'Asia/Ho_Chi_Minh')
}
async function permissions(ctx: Ctx) {
  const keys = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  return {
    read: keys === null || keys.includes('product.listImports'),
    create: keys === null || keys.includes('product.importProducts'),
  }
}
export async function readImports(ctx: Ctx, args: Row): Promise<ImportAnswer> {
  const requested = new URL(String(args.href ?? IMPORT_PATH), 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  const query = importQuery(requested, Number(args.pageSize) || undefined)
  const allowed = await permissions(ctx)
  const url = new URL(query.href, 'http://ket.local')
  const result = allowed.read
    ? await readProductImports(ctx, {
        q: query.q,
        templateId: url.searchParams.get('templateId'),
        page: query.page,
        limit: query.pageSize,
      })
    : { rows: [], total: 0, page: 1, pages: 1 }
  const { rows, page, pages } = result
  const U = ctx.table('user.User')
  const people = rows.length
    ? await ctx.db.all(
        from(U)
          .select(U.id!, U.name!)
          .where(inArray(U.id!, [...new Set(rows.map((row) => row.actor))])),
      )
    : []
  const timezone = await importTimezone(ctx)
  const visible: ImportRow[] = rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    actorName: String(people.find((person) => person.id === row.actor)?.name ?? row.actor),
    occurredAt: String(row.occurredAt),
    timezone,
    rowCount: row.rowCount,
    createdCount: row.createdCount,
    changedCount: row.changedCount,
    variantCount: row.variantCount,
    editHref: recordModalHref(url, { kind: 'product.import', id: String(row.id) }),
  }))
  return {
    query: { ...query, page },
    rows: visible,
    total: result.total,
    page,
    pages,
    counts: {},
    previous: page > 1 ? importHref(query.href, { page: String(page - 1) }) : undefined,
    next: page < pages ? importHref(query.href, { page: String(page + 1) }) : undefined,
  }
}
export async function importContextHandler(ctx: Ctx, args: Row) {
  const allowed = await permissions(ctx)
  if (!allowed.read || (!args.id && !allowed.create)) return null
  const lang = args.locale === 'en' ? 'en' : 'vi'
  const detail = args.id ? await readProductImport(ctx, { id: args.id, locale: lang }) : null
  if (args.id && !detail?.record) return null
  const record = (detail?.record ?? { id: randomUUID(), name: '', data: '' }) as ImportModalData['record']
  if (record.actor)
    record.actorName = String(
      (await ctx.db.select('user.User', { id: record.actor }))[0]?.name ?? record.actor,
    )
  const query = new URLSearchParams({ lang, ...(ctx.scope.company ? { company: ctx.scope.company } : {}) })
  const items = ((detail?.items ?? []) as Row[]).map((item) => ({
    ...item,
    href: item.exists
      ? `/admin/product/templates/${encodeURIComponent(String(item.templateId))}?${query}`
      : '',
  }))
  const data: ImportModalData = {
    lang,
    timezone: await importTimezone(ctx),
    record,
    items,
    permissions: { create: allowed.create },
    download: `${IMPORT_PATH}/export?${query}`,
  }
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[lang] ?? {})
      .filter(
        ([key]) =>
          key.startsWith('product_backend.import.') ||
          key.startsWith('product.error.import.') ||
          key.startsWith('recordModal.'),
      )
      .map(([key, value]) => [key, typeof value === 'string' ? value : String(value.other ?? key)]),
  )
  return { data, messages }
}

/** The public list and catalogue search share this read service. */
export function searchImportsHandler(ctx: Ctx, args: Row) {
  return readImports(ctx, args)
}
