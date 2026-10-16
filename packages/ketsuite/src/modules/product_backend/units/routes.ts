// The Units of measure screen (`/admin/product/uoms`) and the save behind its record modal.
//
// The page is the frame and the list island in its loading state (units/island.tsx); a unit
// opens in the `product.uom` record modal (modal/uom-modal-view.tsx), whose save posts here.
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { RECORD_TAB_PARAM, recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { adminPage } from '../../backend/screen.ts'
import { UNIT_COMMAND_PATH, UNIT_LIST_PATH, UNIT_PAGE_SIZE, parseQuantity } from '../units.ts'
import type { UnitModalData } from '../units.ts'
import { UNIT_LIST_KEY, unitList } from './island.tsx'
import type { UnitListLabels } from './island.tsx'
import { unitsScreen } from './screen.tsx'

const MAX_BODY_BYTES = 16 * 1024

const crossSite = (req: IncomingMessage): boolean => {
  const origin = req.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown> | null> => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Uint8Array).byteLength
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk as Uint8Array)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const listLabels = (_: Translator): UnitListLabels =>
  ({
    ...Object.fromEntries(
      [
        'search',
        'searchPlaceholder',
        'searchSubmit',
        'status',
        'active',
        'archived',
        'all',
        'kind',
        'kindAll',
        'kindReference',
        'kindDerived',
        'name',
        'conversion',
        'root',
        'products',
        'packagings',
        'state',
        'reference',
        'locked',
        'noMatch',
        'noMatchHint',
        'create',
        'pager',
        'clearFilters',
        'offline',
        'retryHint',
        'deniedTitle',
        'deniedMessage',
        'announce',
        'announceNone',
      ].map((key) => [key, _(`product_backend.uom.${key}`)]),
    ),
    region: _('product_backend.uom.title'),
    selectAll: _('backend.table.selectAll'),
    selectRow: _('backend.table.selectRow'),
    sortedAscending: _('product_backend.table.sortAscending'),
    sortedDescending: _('product_backend.table.sortDescending'),
    previousPage: _('backend.chrome.previous'),
    nextPage: _('backend.chrome.next'),
    loading: _('backend.relation.loading'),
    loadError: _('product_backend.uom.loadError'),
    retry: _('backend.relation.retry'),
    empty: _('product_backend.uom.empty'),
    emptyHint: _('product_backend.uom.emptyHint'),
  }) as UnitListLabels

type Issue = { field: string | null; code: string; message: string }
const refused = (issues: Issue[]) => json({ ok: true, value: { ok: false, errors: issues } })

/** The domain's field names, as the modal's form names them. */
const FORM_FIELD: Record<string, string> = { relativeUomId: 'referenceId', relativeFactor: 'factor' }

const listPage: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const live = (await ctx.live(req)).functions
    // `live` is the same for every viewer: whether this one may create is their allow-list.
    const canCreate = Boolean(live['uom.saveUnit']) && (await ctx.allows('uom.saveUnit', url, req))
    // What the island reads with: the list's own URL, less the record open over it.
    const listUrl = new URL(url)
    for (const key of ['record', RECORD_TAB_PARAM]) listUrl.searchParams.delete(key)
    const href = `${listUrl.pathname}${listUrl.search}`
    return adminPage(ctx, url, req, {
      title: 'product_backend.uom.title',
      body: (_, frame) => {
        const lang = _.locale === 'en' ? 'en' : 'vi'
        const createHref = canCreate ? recordModalCreateHref(url, { kind: 'product.uom' }) : null
        const island = html`${trustedMarkup(
          renderIsland(
            'product.uom-list',
            unitList,
            { href, lang, pageSize: UNIT_PAGE_SIZE, labels: listLabels(_), createHref },
            { tag: 'div', key: UNIT_LIST_KEY },
          ),
        )}`
        return unitsScreen(
          _,
          {
            ...frame,
            chrome: createHref
              ? { create: { label: _('product_backend.uom.create'), path: createHref } }
              : {},
          },
          island,
          lang,
        )
      },
    })
  }

/**
 * `POST {id, name, referenceId, factor, active}` from the unit's record modal → `{ ok, value }`.
 * `value` is `{ ok: true, id }` or `{ ok: false, errors }` with the modal's field names and the
 * viewer's words. A unit still the unit of an active product stays active: archiving it would
 * leave those products on a unit no one can choose.
 */
const command: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (crossSite(req)) return text('Forbidden', { status: 403 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const _ = ctx.translate(lang)
    const body = await readBody(req)
    const id = typeof body?.id === 'string' && body.id ? body.id : null
    if (!body || (body.id != null && !id) || typeof body.name !== 'string')
      return json({ ok: false, error: { message: _('product_backend.uom.error.invalid') } }, { status: 400 })
    let context: { data: UnitModalData } | null
    try {
      context = (await ctx.call(
        'product_backend.unitContext',
        { ...(id ? { id } : {}), locale: lang },
        url,
        req,
      )) as { data: UnitModalData } | null
    } catch {
      context = null
    }
    if (!context?.data.editable)
      return json({ ok: false, error: { message: _('product_backend.uom.error.denied') } }, { status: 403 })
    const current = context.data
    const referenceId = typeof body.referenceId === 'string' ? body.referenceId : ''
    const issues: Issue[] = []
    if (referenceId && !current.references.some((choice) => choice.value === referenceId))
      issues.push({
        field: 'referenceId',
        code: 'reference',
        message: _('product_backend.uom.error.reference'),
      })
    const factor = referenceId ? parseQuantity(String(body.factor ?? ''), lang) : '1'
    if (factor === null)
      issues.push({ field: 'factor', code: 'factor', message: _('product_backend.uom.error.factor') })
    const active = body.active !== false
    if (id && !active && current.record.active && current.usage.products > 0)
      issues.push({
        field: 'active',
        code: 'archiveUsed',
        message: _('product_backend.uom.error.archiveUsed', { count: current.usage.products }),
      })
    if (issues.length) return refused(issues)
    let result: { ok?: boolean; id?: string; errors?: unknown }
    try {
      result = (await ctx.call(
        'uom.saveUnit',
        {
          id: id ?? randomUUID(),
          name: body.name,
          relativeUomId: referenceId || null,
          relativeFactor: factor,
          active,
        },
        url,
        req,
      )) as typeof result
    } catch {
      return json({ ok: false, error: { message: _('product_backend.uom.error.denied') } }, { status: 403 })
    }
    if (result.ok) return json({ ok: true, value: { ok: true, id: result.id } })
    const errors = Array.isArray(result.errors) ? (result.errors as Array<Record<string, unknown>>) : []
    return refused(
      errors.map((error) => {
        const field = typeof error.field === 'string' ? (FORM_FIELD[error.field] ?? error.field) : null
        const code = typeof error.code === 'string' ? error.code : ''
        const params = (error.params && typeof error.params === 'object' ? error.params : {}) as Record<
          string,
          unknown
        >
        const known = code ? _(code, params) : code
        return {
          field,
          code: code || 'invalid',
          message:
            known && known !== code
              ? known
              : field === 'referenceId'
                ? _('product_backend.uom.error.reference')
                : field === 'factor'
                  ? _('product_backend.uom.error.factor')
                  : _('product_backend.uom.error.invalid'),
        }
      }),
    )
  }

export const unitRoutes: Record<string, RouteEntry> = {
  [UNIT_LIST_PATH]: listPage,
  [UNIT_COMMAND_PATH]: command,
}
