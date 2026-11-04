import { text, parseListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { EmptyState, LinkButton } from '@ketvietlab/design-system'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { adminPage } from '../../backend/screen.ts'
import { landedCostListSearch } from '../search.ts'
import { landedCostControls, landedCostResults, landedCostFooter } from '../landed-costs/island.tsx'
import { landedCostSearch } from '../landed-costs/search.ts'
import { LANDED_COSTS_PATH, landedCostQuery } from '../landed-costs/shared.ts'
import type { LandedCostProps } from '../landed-costs/shared.ts'
import { LandedCostHelp } from '../landed-costs/help.tsx'
import { readLandedCostContext } from '../modal/landed-cost-context.ts'

/** A new landed cost's page, in the reader's language, company and branch. */
export const landedCostNewHref = (url: URL, picking?: string) => {
  const query = new URLSearchParams(
    [...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
  )
  if (picking) query.set('picking', picking)
  return `${LANDED_COSTS_PATH}/new${query.size ? `?${query}` : ''}`
}

const labels = (_: Translator): LandedCostProps['labels'] => ({
  ...Object.fromEntries(
    Object.entries({
      title: 'landedCost.title',
      name: 'landedCost.col.name',
      dateText: 'landedCost.col.date',
      vendor: 'landedCost.col.vendor',
      receipts: 'landedCost.col.receipts',
      totalText: 'landedCost.col.total',
      stateText: 'landedCost.col.state',
      sum: 'landedCost.sum',
      noMatches: 'landedCost.noMatches',
      noMatchesHint: 'landedCost.noMatchesHint',
      denied: 'landedCost.denied',
      offline: 'landedCost.offline',
      loadError: 'landedCost.loadError',
    }).map(([key, value]) => [key, _(`stock_backend.${value}`)]),
  ),
  emptyHint: _('stock_backend.landedCost.emptyHint'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  region: _('stock_backend.landedCost.title'),
  empty: _('stock_backend.landedCost.empty'),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
  loadError: _('stock_backend.landedCost.loadError'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
})

const helpFrame = (_: Translator, frame: Frame) => ({
  ...frame,
  chrome: null,
  topbar: false,
  ...(frame.applications
    ? { applications: { ...frame.applications, helpLabel: _('stock_backend.landedCost.help') } }
    : {}),
})

export function landedCostsScreen(_: Translator, frame: Frame, url: URL, createHref: string | null = null) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = landedCostQuery(url)
  const source = new URL(`${LANDED_COSTS_PATH}/data`, url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: LandedCostProps = {
    key: `landed-costs:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
    search: landedCostSearch(_, parseListState(landedCostListSearch, url).state, query.href),
  }
  const part = (name: string, controller: typeof landedCostControls) =>
    html`${trustedMarkup(renderIsland(`stock.landed-cost-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _('stock_backend.landedCost.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.landedCost.title')}
        headerActions={
          createHref ? (
            <LinkButton label={_('stock_backend.action.create')} href={createHref} variant="primary" />
          ) : undefined
        }
        controls={part('controls', landedCostControls)}
        body={part('results', landedCostResults)}
        footer={part('footer', landedCostFooter)}
      />
      <LandedCostHelp lang={lang} />
    </>,
    helpFrame(_, frame),
  )
}

/** A role that may not read stock value meets its own locked page rather than an empty list. */
function lockedScreen(_: Translator, frame: Frame) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _('stock_backend.landedCost.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.landedCost.title')}
        body={
          <EmptyState
            visual="locked"
            title={_('stock_backend.landedCost.locked')}
            message={_('stock_backend.landedCost.lockedHint')}
          />
        }
      />
      <LandedCostHelp lang={lang} />
    </>,
    helpFrame(_, frame),
  )
}

export const landedCostsRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const allowed = await ctx.allows('stock.listLandedCosts', url, req)
    return adminPage(ctx, url, req, {
      title: 'stock_backend.landedCost.title',
      ...(allowed ? {} : { status: 403 }),
      body: async (_, frame) =>
        allowed
          ? landedCostsScreen(
              _,
              frame,
              url,
              (await ctx.allows('stock.saveLandedCost', url, req)) ? landedCostNewHref(url) : null,
            )
          : lockedScreen(_, frame),
    })
  }

/**
 * A landed cost is a page (`/admin/stock/landed-costs/{id}`, `new` to create). The server renders the
 * RecordPage loading; the record runtime reads `/admin/stock/landed-cost/{id}/context` and renders the
 * cost (modal/landed-cost-view.tsx). Its guide sits in the content slot, as on a transfer's page.
 */
export const landedCostPageRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    const allowed = await ctx.allows(creating ? 'stock.saveLandedCost' : 'stock.getLandedCost', url, req)
    const cost =
      allowed && !creating
        ? ((await ctx.call('stock.getLandedCost', { id: params.id }, url, req)) as { name?: unknown } | null)
        : null
    if (allowed && !creating && !cost) return text('not found', { status: 404 })
    return adminPage(ctx, url, req, {
      title: 'stock_backend.landedCost.title',
      ...(allowed ? {} : { status: 403 }),
      body: async (_, frame) => {
        if (!allowed) return lockedScreen(_, frame)
        const lang = _.locale === 'en' ? 'en' : 'vi'
        const title = cost ? String(cost.name) : _('stock_backend.landedCost.create.title')
        const back = new URL(LANDED_COSTS_PATH, url)
        for (const key of ['lang', 'company', 'branch'])
          if (url.searchParams.has(key)) back.searchParams.set(key, url.searchParams.get(key)!)
        // A new cost opened from a receipt carries its context, `picking` included (see readLandedCostContext).
        const envelope =
          creating && url.searchParams.has('picking')
            ? await readLandedCostContext(ctx, url, req, 'new')
            : null
        const island = await ctx.joint(url, req, 'stock_backend:landed-cost.page', {
          id: params.id,
          ...(envelope && typeof envelope === 'object' ? { envelope } : {}),
          title,
          loading: _('backend.relation.loading'),
          back: `${back.pathname}${back.search}`,
          width: 'wide',
        })
        return shell(
          _,
          title,
          <>
            {island}
            <LandedCostHelp lang={lang} />
          </>,
          { ...helpFrame(_, frame), titled: false },
        )
      },
    })
  }
