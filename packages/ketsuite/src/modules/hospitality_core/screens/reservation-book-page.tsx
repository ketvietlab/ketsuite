import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { LinkButton } from '@ketvietlab/design-system'
import type { ReservationBookProps } from '../collections/reservation-book.tsx'
import {
  reservationBookControls,
  reservationBookFooter,
  reservationBookResults,
} from '../collections/reservation-book.tsx'
import { reservationBookQueryFromUrl } from '../reservation-book-query.ts'
import { BOOKING_PROVIDERS } from '../types.ts'
import type { Frame } from '../../../ui/index.ts'
import { hospitalityAdminPage as adminPage } from './hospitality-admin-page.tsx'
import { ListScreenFrame } from './page-frame.tsx'

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
  'status',
  'source',
  'allSources',
  'days',
  'daysOption',
  'allDays',
  'today',
  'window',
  'previousWindow',
  'nextWindow',
  'previousRange',
  'nextRange',
  ...['all', 'arriving', 'in_house', 'departing', 'confirmed', 'checked_out', 'cancelled'].map(
    (id) => `status.${id}`,
  ),
  ...['arriving', 'in_house', 'departing', 'confirmed', 'checked_out', 'cancelled', 'no_show'].map(
    (id) => `rowStatus.${id}`,
  ),
  'view.all',
  'view.unguaranteed',
  ...['relevance', 'arrival', '-arrival', 'total', '-total'].map((id) => `sort.${id}`),
  'sortedBy',
  ...['reservation', 'status', 'stay', 'room', 'unit', 'source', 'total'].map((id) => `column.${id}`),
  'nights',
  'nights.one',
  'adults',
  'adults.one',
  'children',
  'children.one',
  'unroomed',
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
  'emptyBook',
  'emptyBookHint',
  'create',
  'emptyWindow',
  'emptySearch',
  'emptySearchFiltered',
  'whereBook',
  'whereWindow',
  'filteredMessage',
  'windowMessage',
  'allDates',
  'clear',
  'partial',
  'partialHint',
]
const PLACEHOLDERS = Object.fromEntries(
  ['count', 'first', 'last', 'total', 'label', 'order', 'period', 'q', 'where'].map((name) => [
    name,
    `{${name}}`,
  ]),
)
const GUARANTEES = ['none', 'prepaid', 'agent', 'deposit', 'card']

export type ReservationBookScreenInput = {
  url: URL
  locale: 'vi' | 'en'
  allowed: boolean
  properties: ReservationBookProps['properties']
  may: { book: boolean; walkIn: boolean }
}

/** The islands' props from the URL: the frame only; rows, counts and pages are read in the browser. */
export const reservationBookProps = (
  { url, locale, allowed, properties, may }: ReservationBookScreenInput,
  _: Translator,
): ReservationBookProps => {
  const words: Record<string, string> = Object.fromEntries(
    WORDS.map((key) => [key, _(`hospitality_core.reservationBook.${key}`, PLACEHOLDERS)]),
  )
  for (const provider of BOOKING_PROVIDERS)
    words[`provider.${provider}`] = _(`hospitality_core.provider.${provider}`)
  for (const kind of GUARANTEES) words[`guarantee.${kind}`] = _(`hospitality_core.roomPlan.guarantee.${kind}`)
  const query = reservationBookQueryFromUrl(url, properties)
  return {
    key: `reservations:${locale}:${JSON.stringify(SCOPE.map((name) => url.searchParams.getAll(name)))}`,
    id: 'hospitality-reservations',
    source: scoped(url, '/_ket/fn/hospitality_core.searchReservations'),
    path: scoped(url, '/admin/hospitality/reservations'),
    recordPath: '/admin/hospitality/reservations',
    createHref: may.book
      ? scoped(
          url,
          '/admin/hospitality/reservations/new',
          query.propertyId ? { propertyId: query.propertyId } : {},
        )
      : null,
    lang: locale,
    allowed,
    properties,
    sources: [...BOOKING_PROVIDERS],
    query,
    words,
  }
}

/**
 * The reservation book (HOS-UI-003): a list page whose controls, rows and pager are islands on one read,
 * `hospitality_core.searchReservations`. The header books ahead or takes a walk-in at the property shown.
 */
export const reservationBookScreen = (
  _: Translator,
  input: ReservationBookScreenInput,
  frame: Frame,
): TemplateResult => {
  const props = reservationBookProps(input, _)
  const { url, may } = input
  const property: Record<string, string> = props.query.propertyId
    ? { propertyId: props.query.propertyId }
    : {}
  const island = (name: string, factory: (props: ReservationBookProps) => { view: () => unknown }) =>
    trustedMarkup(renderIsland(name, factory as never, props, { tag: 'div' }))
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.reservations.title')}
      frame={{ ...frame, chrome: null }}
      controlsMode="islands"
      headerActions={
        props.createHref || may.walkIn ? (
          <>
            {props.createHref ? (
              <LinkButton
                id={`${props.id}-create`}
                label={_('hospitality_core.deskBooking.title')}
                href={props.createHref}
                variant={may.walkIn ? 'secondary' : 'primary'}
              />
            ) : null}
            {may.walkIn ? (
              <LinkButton
                id={`${props.id}-walk-in`}
                label={_('hospitality_core.deskBooking.walkInTitle')}
                href={scoped(url, '/admin/hospitality/reservations/new', { walkIn: '1', ...property })}
                variant="primary"
              />
            ) : null}
          </>
        ) : undefined
      }
      controls={island('hospitality.reservations-controls', reservationBookControls)}
      body={island('hospitality.reservations-results', reservationBookResults)}
      footer={island('hospitality.reservations-footer', reservationBookFooter)}
    />
  )
}

/**
 * Who may book ahead and who may take a walk-in: the same gates as the room plan's header. A walk-in also takes the
 * guests' declarations, a guarantee and the arrival in one step.
 */
export async function deskBookingGates(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  const allows = (fn: string) => ctx.allows(fn, url, req)
  const book = await allows('hospitality_billing.confirmDeskBooking')
  const walkIn =
    book &&
    (await allows('hospitality_core.checkIn')) &&
    (await allows('hospitality_core.declareArrivalGuests')) &&
    ((await allows('hospitality_billing.takeReservationGuarantee')) ||
      (await allows('hospitality_billing.setReservationGuarantee')))
  return { book, walkIn }
}

/** The book's request: who may read and book, and the properties it shows. */
export async function renderReservationBook(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const allows = (fn: string) => ctx.allows(fn, url, req)
  const allowed = await allows('hospitality_core.searchReservations')
  const properties = allowed
    ? (
        (await ctx.call('hospitality_core.getReservationBookFrame', {}, url, req)) as {
          properties: ReservationBookProps['properties']
        }
      ).properties
    : []
  const { book, walkIn } = await deskBookingGates(ctx, url, req)
  return adminPage(ctx, url, req, {
    title: 'hospitality_core.screen.reservations.title',
    body: (_, frame) =>
      reservationBookScreen(_, { url, locale, allowed, properties, may: { book, walkIn } }, frame),
  })
}
