import { encodeListState, text, parseListState } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { EmptyState, LinkButton } from '@ketvietlab/design-system'
import {
  CardGrid,
  ListPage,
  Metric,
  Section,
  WorkspacePage,
  collectionTable as dataTable,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { adminPage } from '../../backend/screen.ts'
import { optionalRead } from '../../backend/optional-read.ts'
import { DeliveryHelp, type DeliveryScreen } from './help.tsx'
import { deliveryControls, deliveryFooter, deliveryResults } from './island.tsx'
import { DELIVERY_READS } from './data.ts'
import { DELIVERY_SPECS, deliverySearch } from './search.ts'
import { DELIVERY_PATHS, deliveryQuery, scoped } from './shared.ts'
import type { DeliveryColumn, DeliveryList, DeliveryProps } from './shared.ts'

const TITLES: Record<DeliveryList, string> = {
  dispatch: 'stock_backend.dispatch.title',
  shipments: 'stock_backend.shipment.title',
  statements: 'stock_backend.statement.title',
  carriers: 'stock_backend.carrier.title',
}
const EMPTY: Record<DeliveryList, string> = {
  dispatch: 'dispatch',
  shipments: 'shipment',
  statements: 'statement',
  carriers: 'carrier',
}
/** Who may not open a list meets this lock: statements are read with stock value, the rest with stock. */
const LOCKS: Record<DeliveryList, string> = {
  dispatch: 'shipment',
  shipments: 'shipment',
  statements: 'statement',
  carriers: 'shipment',
}

const columns = (_: Translator, list: DeliveryList): DeliveryColumn[] => {
  const w = (key: string) => _(`stock_backend.${key}`)
  if (list === 'dispatch')
    return [
      { key: 'name', label: w('delivery.picking'), kind: 'identifier', priority: 'primary', sort: 'name' },
      { key: 'partner', label: w('delivery.customer'), priority: 'secondary', sort: 'partner' },
      { key: 'order', label: w('delivery.order') },
      { key: 'warehouse', label: w('delivery.warehouse') },
      { key: 'scheduledText', label: w('delivery.scheduled'), kind: 'date', sort: 'scheduled' },
      { key: 'shipment', label: w('shipment.record'), kind: 'identifier' },
      { key: 'carrier', label: w('delivery.carrier') },
      { key: 'codText', label: w('delivery.cod'), kind: 'currency' },
      { key: 'statusText', label: w('delivery.status'), kind: 'status' },
    ]
  if (list === 'shipments')
    return [
      { key: 'name', label: w('shipment.name'), kind: 'identifier', priority: 'primary', sort: 'name' },
      { key: 'tracking', label: w('shipment.tracking'), kind: 'identifier' },
      { key: 'partner', label: w('delivery.customer'), priority: 'secondary', sort: 'partner' },
      { key: 'picking', label: w('delivery.picking'), kind: 'identifier' },
      { key: 'carrier', label: w('delivery.carrier') },
      { key: 'warehouse', label: w('delivery.warehouse') },
      { key: 'codText', label: w('delivery.cod'), kind: 'currency', sort: 'cod' },
      { key: 'feeText', label: w('delivery.fees'), kind: 'currency' },
      { key: 'statusText', label: w('delivery.status'), kind: 'status' },
    ]
  if (list === 'statements')
    return [
      { key: 'name', label: w('statement.name'), kind: 'identifier', priority: 'primary', sort: 'name' },
      { key: 'carrier', label: w('delivery.carrier'), priority: 'secondary' },
      { key: 'dateText', label: w('statement.date'), kind: 'date', sort: 'date' },
      { key: 'count', label: w('statement.count'), kind: 'number' },
      { key: 'codText', label: w('delivery.cod'), kind: 'currency' },
      { key: 'feeText', label: w('delivery.fees'), kind: 'currency' },
      { key: 'netText', label: w('statement.net'), kind: 'currency', sort: 'net' },
      { key: 'statusText', label: w('delivery.status'), kind: 'status' },
    ]
  return [
    { key: 'code', label: w('carrier.code'), kind: 'identifier', sort: 'code' },
    { key: 'name', label: w('carrier.name'), priority: 'primary', sort: 'name' },
    { key: 'baseFeeText', label: w('carrier.baseFee'), kind: 'currency' },
    { key: 'extraKgFeeText', label: w('carrier.extraKgFee'), kind: 'currency' },
    { key: 'codFeeRateText', label: w('carrier.codFeeRate'), kind: 'number' },
    { key: 'isDefaultText', label: w('carrier.isDefault') },
    { key: 'statusText', label: w('delivery.status'), kind: 'status' },
  ]
}

const labels = (_: Translator, list: DeliveryList): DeliveryProps['labels'] => ({
  ...Object.fromEntries(
    Object.entries({
      noMatches: 'delivery.noMatches',
      noMatchesHint: 'delivery.noMatchesHint',
      denied: 'delivery.denied',
      offline: 'delivery.offline',
      loadError: 'delivery.loadError',
      selectionCount: 'delivery.selectionCount',
      bulkSkipped: 'delivery.bulkSkipped',
      'skip.hasShipment': 'delivery.skip.hasShipment',
      'skip.closed': 'delivery.skip.closed',
      'skip.notBooked': 'delivery.skip.notBooked',
      'skip.waitingGoods': 'delivery.skip.waitingGoods',
      'skip.changed': 'delivery.skip.changed',
      'skip.missing': 'delivery.skip.missing',
    }).map(([key, value]) => [key, _(`stock_backend.${value}`)]),
  ),
  title: _(TITLES[list]),
  region: _(TITLES[list]),
  loadError: _('stock_backend.delivery.loadError'),
  empty: _(`stock_backend.${EMPTY[list]}.empty`),
  emptyHint: _(`stock_backend.${EMPTY[list]}.emptyHint`),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
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
    ? { applications: { ...frame.applications, helpLabel: _('stock_backend.delivery.help') } }
    : {}),
})
const lang = (_: Translator) => (_.locale === 'en' ? 'en' : 'vi')
const SCREENS: Record<DeliveryList, DeliveryScreen> = {
  dispatch: 'dispatch',
  shipments: 'shipments',
  statements: 'statements',
  carriers: 'carriers',
}

export function deliveryListScreen(
  _: Translator,
  frame: Frame,
  url: URL,
  list: DeliveryList,
  options: { createHref?: string | null; bulk?: DeliveryProps['bulk'] } = {},
) {
  const path = DELIVERY_PATHS[list]
  const query = deliveryQuery(path, url)
  const source = new URL(`${path}/data`, url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: DeliveryProps = {
    key: `delivery-${list}:${query.href}`,
    list,
    path,
    query,
    source: `${source.pathname}${source.search}`,
    columns: columns(_, list),
    labels: labels(_, list),
    search: deliverySearch(_, list, parseListState(DELIVERY_SPECS[list], url).state, query.href),
    bulk: options.bulk ?? null,
  }
  const part = (name: string, controller: typeof deliveryControls) =>
    html`${trustedMarkup(renderIsland(`stock.delivery-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _(TITLES[list]),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_(TITLES[list])}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('stock_backend.action.create')}
              href={options.createHref}
              variant="primary"
            />
          ) : undefined
        }
        controls={part('controls', deliveryControls)}
        body={part('results', deliveryResults)}
        footer={part('footer', deliveryFooter)}
      />
      <DeliveryHelp lang={lang(_)} screen={SCREENS[list]} />
    </>,
    helpFrame(_, frame),
  )
}

/** A role that may not read a shipping screen meets its own locked page rather than an empty one. */
export function deliveryLockedScreen(
  _: Translator,
  frame: Frame,
  title: string,
  lock: string,
  screen: DeliveryScreen,
) {
  return shell(
    _,
    _(title),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_(title)}
        body={
          <EmptyState
            visual="locked"
            title={_(`stock_backend.${lock}.locked`)}
            message={_(`stock_backend.${lock}.lockedHint`)}
          />
        }
      />
      <DeliveryHelp lang={lang(_)} screen={screen} />
    </>,
    helpFrame(_, frame),
  )
}

/** A new carrier statement's page, in the reader's language, company and branch. */
export const statementNewHref = (url: URL) => scoped(url, `${DELIVERY_PATHS.statements}/new`)

export const deliveryListRoute =
  (list: DeliveryList) =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const allowed = await ctx.allows(DELIVERY_READS[list], url, req)
    const may = (fn: string) => ctx.allows(fn, url, req)
    return adminPage(ctx, url, req, {
      title: TITLES[list],
      ...(allowed ? {} : { status: 403 }),
      body: async (_, frame) => {
        if (!allowed) return deliveryLockedScreen(_, frame, TITLES[list], LOCKS[list], SCREENS[list])
        const createHref =
          list === 'statements' && (await may('stock.saveDeliveryStatement'))
            ? statementNewHref(url)
            : list === 'carriers' && (await may('stock.saveCarrier'))
              ? recordModalCreateHref(scoped(url, DELIVERY_PATHS.carriers), { kind: 'stock.carrier' })
              : null
        const bulk =
          list === 'dispatch' && (await may('stock.createShipments'))
            ? {
                fn: 'stock.createShipments',
                label: _('stock_backend.dispatch.create'),
                done: _('stock_backend.dispatch.created'),
              }
            : list === 'shipments' && (await may('stock.handOverShipments'))
              ? {
                  fn: 'stock.handOverShipments',
                  label: _('stock_backend.shipment.handOverSelected'),
                  done: _('stock_backend.shipment.handedOver'),
                }
              : null
        return deliveryListScreen(_, frame, url, list, { createHref, bulk })
      },
    })
  }

/**
 * K48: the delivery overview, by carrier — what waits to be handed over, is on its way, failed or is not
 * on a statement, the cash on parcels under way and the cash each carrier holds.
 */
export const deliveryOverviewRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const allowed = await ctx.allows('stock.getDeliveryOverview', url, req)
    const title = 'stock_backend.overview.delivery.title'
    if (!allowed)
      return adminPage(ctx, url, req, {
        title,
        status: 403,
        body: async (_, frame) => deliveryLockedScreen(_, frame, title, 'shipment', 'overview'),
      })
    const overview = (await ctx.call('stock.getDeliveryOverview', {}, url, req)) as Row
    const queue = (await optionalRead<Row[]>(ctx, 'stock.listDispatchQueue', {}, url, req, [])) ?? []
    const statements = await ctx.allows('stock.listDeliveryStatements', url, req)
    const carriers = (overview.carriers as Row[]) ?? []
    return adminPage(ctx, url, req, {
      title,
      body: async (_, frame) => {
        const money = (value: unknown) => formatMoney(_, value ?? '0', overview.currency)
        const sum = (key: string) => carriers.reduce((total, row) => total + Number(row[key] ?? 0), 0)
        const cash = (key: string) =>
          carriers.reduce((total, row) => total + BigInt(String(row[key] ?? '0').split('.')[0] || '0'), 0n)
        const link = (path: string, query = '') => scoped(url, `${path}${query}`)
        // K51: a tile opens the parcels it counts, by the status filter of their list.
        const shipmentsIn = (statuses: string[]) =>
          scoped(
            url,
            encodeListState(
              {
                q: '',
                presets: [],
                filters: [
                  statuses.length === 1
                    ? { kind: 'rule', field: 'status', operator: 'equals', value: statuses[0] }
                    : { kind: 'rule', field: 'status', operator: 'anyOf', value: statuses },
                ],
                groupBy: [],
                sort: [],
                openGroups: [],
                groupPages: {},
                page: 1,
                includeArchived: false,
                favoriteId: null,
              } as never,
              DELIVERY_PATHS.shipments,
            ),
          )
        const tiles = [
          { id: 'dispatch', value: String(queue.length), href: link(DELIVERY_PATHS.dispatch) },
          { id: 'toHandOver', value: String(sum('toHandOver')), href: shipmentsIn(['booked']) },
          { id: 'shipping', value: String(sum('shipping')), href: shipmentsIn(['shipping']) },
          { id: 'failed', value: String(sum('failed')), href: shipmentsIn(['failed']) },
          {
            id: 'codShipping',
            value: money(String(cash('codShipping'))),
            href: shipmentsIn(['shipping', 'failed']),
          },
          {
            id: 'codHeld',
            value: money(String(cash('codHeld'))),
            href: statements ? link(DELIVERY_PATHS.statements) : link(DELIVERY_PATHS.shipments),
          },
        ]
        const pageTitle = _(title)
        return shell(
          _,
          pageTitle,
          <>
            <WorkspacePage
              variant="operational"
              frame={frame}
              title={pageTitle}
              actions={
                <>
                  <LinkButton
                    label={_('stock_backend.overview.delivery.openDispatch')}
                    href={link(DELIVERY_PATHS.dispatch)}
                    variant="secondary"
                  />
                  <LinkButton
                    label={_('stock_backend.overview.delivery.openShipments')}
                    href={link(DELIVERY_PATHS.shipments)}
                    variant="secondary"
                  />
                  {statements ? (
                    <LinkButton
                      label={_('stock_backend.overview.delivery.openStatements')}
                      href={link(DELIVERY_PATHS.statements)}
                      variant="secondary"
                    />
                  ) : null}
                </>
              }
              body={stack([
                <CardGrid
                  items={tiles}
                  id={(item) => item.id}
                  card={(item) => (
                    <Metric
                      label={_(`stock_backend.overview.delivery.${item.id}`)}
                      value={item.value}
                      href={item.href}
                      {...(item.id.startsWith('cod') ? { tone: 'money' } : {})}
                    />
                  )}
                />,
                <Section
                  title={_('stock_backend.overview.delivery.carriers')}
                  body={
                    carriers.length ? (
                      dataTable(_, {
                        rows: carriers,
                        id: (row) => String(row.id),
                        rowHref: () => link(DELIVERY_PATHS.shipments),
                        columns: [
                          {
                            key: 'name',
                            label: _('stock_backend.delivery.carrier'),
                            priority: 'primary',
                            cell: (row) => `${String(row.name)} · ${String(row.code)}`,
                          },
                          ...(['toHandOver', 'shipping', 'failed', 'toSettle'] as const).map((key) => ({
                            key,
                            label: _(`stock_backend.overview.delivery.${key}`),
                            kind: 'number' as const,
                            align: 'end' as const,
                            cell: (row: Row) => String(row[key] ?? 0),
                          })),
                          ...(['codShipping', 'codHeld'] as const).map((key) => ({
                            key,
                            label: _(`stock_backend.overview.delivery.${key}`),
                            kind: 'currency' as const,
                            align: 'end' as const,
                            cell: (row: Row) => money(row[key]),
                          })),
                        ],
                      })
                    ) : (
                      <EmptyState
                        title={_('stock_backend.overview.delivery.empty')}
                        message={_('stock_backend.overview.delivery.emptyHint')}
                      />
                    )
                  }
                />,
              ])}
            />
            <DeliveryHelp lang={lang(_)} screen="overview" />
          </>,
          helpFrame(_, frame),
        )
      },
    })
  }

/**
 * A shipment and a carrier statement are pages (`/admin/stock/shipments/{id}`,
 * `/admin/stock/delivery-statements/{id}`, `new` for a statement). The server renders the RecordPage
 * loading; the record runtime reads the context and renders the record. Its guide sits in the content slot.
 */
export const deliveryRecordRoute =
  (kind: 'shipment' | 'statement') =>
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = kind === 'statement' && params.id === 'new'
    const read = kind === 'shipment' ? 'stock.getShipment' : 'stock.getDeliveryStatement'
    const allowed = await ctx.allows(creating ? 'stock.saveDeliveryStatement' : read, url, req)
    const record =
      allowed && !creating ? ((await ctx.call(read, { id: params.id }, url, req)) as Row | null) : null
    if (allowed && !creating && !record) return text('not found', { status: 404 })
    const list = kind === 'shipment' ? 'shipments' : 'statements'
    const screen: DeliveryScreen = kind === 'shipment' ? 'shipment' : 'statement'
    return adminPage(ctx, url, req, {
      title: TITLES[list],
      ...(allowed ? {} : { status: 403 }),
      body: async (_, frame) => {
        if (!allowed) return deliveryLockedScreen(_, frame, TITLES[list], kind, screen)
        const title = record ? String(record.name) : _('stock_backend.statement.new')
        const island = await ctx.joint(
          url,
          req,
          `stock_backend:${kind === 'shipment' ? 'shipment' : 'delivery-statement'}.page`,
          {
            id: params.id,
            title,
            loading: _('backend.relation.loading'),
            back: scoped(url, DELIVERY_PATHS[list]),
            width: 'wide',
          },
        )
        return shell(
          _,
          title,
          <>
            {island}
            <DeliveryHelp lang={lang(_)} screen={screen} />
          </>,
          { ...helpFrame(_, frame), titled: false },
        )
      },
    })
  }
