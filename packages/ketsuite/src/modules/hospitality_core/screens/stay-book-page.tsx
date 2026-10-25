import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { LinkButton } from '@ketvietlab/design-system'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { StayBookProps } from '../collections/stay-book.tsx'
import { stayBookControls, stayBookFooter, stayBookResults } from '../collections/stay-book.tsx'
import { stayBookQueryFromUrl } from '../stay-book-query.ts'
import { GUEST_LOYALTY_TIERS } from '../types.ts'
import type { Frame } from '../../../ui/index.ts'
import { hospitalityAdminPage as adminPage } from './hospitality-admin-page.tsx'
import { ListScreenFrame } from './page-frame.tsx'
import { deskBookingGates } from './reservation-book-page.tsx'

const SCOPE = ['company', 'companies', 'branch', 'branches', 'lang']
const scoped = (url: URL, path: string, extra: Record<string, string> = {}) => {
  const target = new URL(path, url)
  for (const [name, value] of url.searchParams)
    if (SCOPE.includes(name)) target.searchParams.append(name, value)
  for (const [name, value] of Object.entries(extra)) target.searchParams.set(name, value)
  return `${target.pathname}${target.search}`
}
const WORDS = [
  'search',
  'searchPlaceholder',
  'searchSubmit',
  'filters',
  'filtersToggle',
  'property',
  'allProperties',
  ...['all', 'departing', 'tomorrow', 'vip'].map((id) => `view.${id}`),
  ...['room', '-room', 'departure', '-departure', 'guest'].map((id) => `sort.${id}`),
  'sortedBy',
  ...['room', 'guest', 'stay', 'departure', 'balance', 'request'].map((id) => `column.${id}`),
  'adults',
  'adults.one',
  'children',
  'children.one',
  'nightsStayed',
  'leavesToday',
  'leavesTodayLate',
  'leavesTomorrow',
  'leavesOn',
  'vip',
  'unroomed',
  'noRequest',
  'paid',
  'dueUnknown',
  'dueFailed',
  'dueLoading',
  'sharedFolio',
  'describe',
  'noResults',
  'lost',
  'pager',
  'region',
  'loading',
  'retry',
  'error',
  'errorHint',
  'errorHintStale',
  'offline',
  'offlineHint',
  'offlineHintStale',
  'denied',
  'deniedHint',
  'selectAll',
  'selectRow',
  'ascending',
  'descending',
  'previousPage',
  'nextPage',
  'emptyHouse',
  'emptyHouseHint',
  'arrivals',
  'emptySearch',
  'emptySearchFiltered',
  'filteredMessage',
  'clear',
  'partial',
  'partialHint',
]
const PLACEHOLDERS = Object.fromEntries(
  ['count', 'nights', 'first', 'last', 'total', 'label', 'order', 'q', 'time', 'date'].map((name) => [
    name,
    `{${name}}`,
  ]),
)

export type StayBookScreenInput = {
  url: URL
  locale: 'vi' | 'en'
  allowed: boolean
  properties: StayBookProps['properties']
  may: { dues: boolean; arrivals: boolean; walkIn: boolean }
}

/** The islands' props from the URL: the frame only; rows, counts, pages and dues are read in the browser. */
export const stayBookProps = (
  { url, locale, allowed, properties, may }: StayBookScreenInput,
  _: Translator,
): StayBookProps => {
  const words: Record<string, string> = Object.fromEntries(
    WORDS.map((key) => [key, _(`hospitality_core.stayBook.${key}`, PLACEHOLDERS)]),
  )
  for (const tier of GUEST_LOYALTY_TIERS)
    if (tier !== 'none') words[`tier.${tier}`] = _(`hospitality_core.reservation.benefits.tier.${tier}`)
  const query = stayBookQueryFromUrl(url, properties)
  return {
    key: `stays:${locale}:${JSON.stringify(SCOPE.map((name) => url.searchParams.getAll(name)))}`,
    id: 'hospitality-stays',
    source: scoped(url, '/_ket/fn/hospitality_core.searchStays'),
    dueSource: may.dues ? scoped(url, '/_ket/fn/hospitality_billing.getStayDues') : null,
    path: scoped(url, '/admin/hospitality/stays'),
    recordPath: '/admin/hospitality/reservations',
    stayPath: '/admin/hospitality/stays',
    // An empty house points at who is due to arrive, at the property shown.
    arrivalsHref: may.arrivals
      ? scoped(url, '/admin/hospitality/reservations', {
          status: 'arriving',
          ...(query.propertyId ? { property: query.propertyId } : {}),
        })
      : null,
    lang: locale,
    allowed,
    properties,
    query,
    words,
  }
}

/**
 * The guests in house (HOS-UI-010): a list page whose controls, rows and pager are islands on one read,
 * `hospitality_core.searchStays`, with what each stay owes read from billing for the rows shown. The header takes
 * a walk-in at the property shown: the one stay that starts here rather than from a booking.
 */
export const stayBookScreen = (_: Translator, input: StayBookScreenInput, frame: Frame): TemplateResult => {
  const props = stayBookProps(input, _)
  const { url, may } = input
  const island = (name: string, factory: (props: StayBookProps) => { view: () => unknown }) =>
    trustedMarkup(renderIsland(name, factory as never, props, { tag: 'div' }))
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.stays.title')}
      frame={{ ...frame, chrome: null }}
      controlsMode="islands"
      headerActions={
        may.walkIn ? (
          <LinkButton
            id={`${props.id}-walk-in`}
            label={_('hospitality_core.deskBooking.walkInTitle')}
            href={scoped(url, '/admin/hospitality/reservations/new', {
              walkIn: '1',
              ...(props.query.propertyId ? { propertyId: props.query.propertyId } : {}),
            })}
            variant="secondary"
          />
        ) : undefined
      }
      controls={island('hospitality.stays-controls', stayBookControls)}
      body={island('hospitality.stays-results', stayBookResults)}
      footer={island('hospitality.stays-footer', stayBookFooter)}
    />
  )
}

/** The list's request: who may read the house and its dues, and the properties it shows. */
export async function renderStayBook(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const allows = (fn: string) => ctx.allows(fn, url, req)
  const allowed = await allows('hospitality_core.searchStays')
  const properties = allowed
    ? (
        (await ctx.call('hospitality_core.getStayBookFrame', {}, url, req)) as {
          properties: StayBookProps['properties']
        }
      ).properties
    : []
  const may = {
    dues: allowed && (await allows('hospitality_billing.getStayDues')),
    arrivals: await allows('hospitality_core.searchReservations'),
    walkIn: (await deskBookingGates(ctx, url, req)).walkIn,
  }
  return adminPage(ctx, url, req, {
    title: 'hospitality_core.screen.stays.title',
    body: (_, frame) => stayBookScreen(_, { url, locale, allowed, properties, may }, frame),
  })
}
