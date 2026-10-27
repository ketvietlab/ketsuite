// A collection's three islands on its page, the words they share, and the route that
// reads them (design system: "Collections are client islands"; the islands are
// ../../ui/client/row-list-island.tsx, the read ./row-list-read.ts).
//
// The read is a module route rather than a `/_ket/fn` function: it answers with what the
// list's own route may already call for this viewer (`user.listRoles`, say), so a list is
// readable by exactly the people who could open its page, with no grant of its own.
import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { ROW_LIST_KEY, rowList, rowListControls, rowListFooter } from '../../ui/client/row-list-island.tsx'
import type { RowListLabels, RowListProps } from '../../ui/client/row-list-island.tsx'
import type { RowListAnswer } from './row-list-read.ts'

type Req = Parameters<Route>[1]

/** The islands of one collection, for ListPage's `controls`, `body` and `footer`. */
export const rowListIslands = (
  props: RowListProps,
): { controls: TemplateResult; body: TemplateResult; footer: TemplateResult } => {
  const part = (name: string, controller: typeof rowList) =>
    html`${trustedMarkup(renderIsland(name, controller, props, { tag: 'div', key: ROW_LIST_KEY }))}`
  return {
    controls: part('backend.row-list-controls', rowListControls),
    body: part('backend.row-list', rowList),
    footer: part('backend.row-list-footer', rowListFooter),
  }
}

/** The words every collection island shares, with the ones that name this collection. */
export const rowListLabels = (
  _: Translator,
  own: Pick<RowListLabels, 'empty' | 'emptyHint' | 'announce' | 'announceNone'> &
    Partial<Omit<RowListLabels, 'empty' | 'emptyHint' | 'announce' | 'announceNone'>>,
): RowListLabels => ({
  region: _('backend.table.results'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('backend.table.sortAscending'),
  sortedDescending: _('backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
  loadError: _('backend.collection.failed'),
  retry: _('backend.collection.retry'),
  range: _('backend.collection.range'),
  pages: _('backend.collection.pages'),
  previous: _('backend.chrome.previous'),
  next: _('backend.chrome.next'),
  failed: _('backend.collection.failed'),
  offline: _('backend.collection.offline'),
  retryHint: _('backend.collection.retryHint'),
  deniedTitle: _('backend.collection.deniedTitle'),
  deniedMessage: _('backend.collection.deniedMessage'),
  noMatch: _('backend.collection.noMatch'),
  noMatchQuery: _('backend.collection.noMatchQuery'),
  noMatchHint: _('backend.collection.noMatchHint'),
  clearFilters: _('backend.collection.clearFilters'),
  sortAsc: _('backend.collection.sortAsc'),
  sortDesc: _('backend.collection.sortDesc'),
  columns: _('backend.table.columns'),
  ...own,
})

const MAX_READ_BYTES = 16 * 1024

/** No Origin is a non-browser caller; a browser names one on every request that could be forged. */
const crossSite = (req: Req): boolean => {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const readHref = async (req: Req): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += value.length
    if (size > MAX_READ_BYTES) return undefined
    chunks.push(value)
  }
  try {
    return (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { href?: unknown }).href
  } catch {
    return undefined
  }
}

const answered = (status: number, value: unknown) => ({
  ...json(value, { status }),
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

/**
 * The route a collection's islands read through: a same-origin POST of `{ href }`, the
 * list's URL. `read` answers one page for it, `null` when the viewer may not read the list
 * (403, which the island shows as denied), or `undefined` for a URL that is not the list's.
 */
export const rowListReadRoute =
  (
    read: (ctx: ServeContext, url: URL, req: Req, href: unknown) => Promise<RowListAnswer | null | undefined>,
  ): ((ctx: ServeContext) => Route) =>
  (ctx) =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (crossSite(req)) return answered(403, { ok: false })
    const answer = await read(ctx, url, req, await readHref(req))
    if (answer === null) return answered(403, { ok: false })
    if (answer === undefined) return answered(400, { ok: false })
    return answered(200, { ok: true, value: answer })
  }
