import type { Translator } from '@ketvietlab/ketjs'
import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { EmptyState, LinkButton, PeekLayout } from '@ketvietlab/design-system'
import { shell, WorkspacePage } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { addCalendarDays, zonedMidnight } from '../calendar.ts'
import { BOOKING_PROVIDERS, ROOM_STATUSES } from '../types.ts'
import {
  ROOM_PLAN_PEEK_ID,
  roomPlanControls,
  roomPlanGrid,
  roomPlanPeek,
  type RoomPlanNight,
  type RoomPlanProps,
} from '../plan/room-plan.tsx'

/** The nights the plan holds around the business date: a fortnight back and four weeks ahead. */
export const ROOM_PLAN_FIRST = -14
export const ROOM_PLAN_LAST = 27

export type RoomPlanFrame = {
  property: { id: string; name: string; timezone: string; businessDate: string } | null
  properties: Array<{ id: string; name: string }>
  types: Array<{ id: string; code: string; name: string }>
  floors: Array<{ id: string; name: string }>
}

const WORDS = [
  'filtersLabel',
  'filters',
  'searchLabel',
  'searchPlaceholder',
  'searchAction',
  'property',
  'propertyMenu',
  'floor',
  'floorMenu',
  'noFloor',
  'typeMenu',
  'allTypes',
  'view.all',
  'view.free',
  'view.arriving',
  'today',
  'days',
  'daysMenu',
  'pager',
  'previous',
  'next',
  'nights',
  'failedTitle',
  'failedMessage',
  'retry',
  'noRoomsTitle',
  'noRoomsMessage',
  'emptyTitle',
  'emptyFilters',
  'emptyNarrowed',
  'emptySearch',
  'clearFilters',
  'truncatedTitle',
  'truncatedMessage',
  'corner',
  'free',
  'unroomed',
  'unroomedLink',
  'floorRooms',
  'loadingRooms',
  'region',
  'out',
  'outRoom',
  'roomTitle',
  'stay.checked_in',
  'stay.checked_out',
  'stay.draft',
  'stay.departing',
  'guarantee.none',
  'guarantee.prepaid',
  'guarantee.agent',
  'guarantee.deposit',
  'guarantee.card',
  'peek.title',
  'peek.arriving',
  'peek.booked',
  'peek.inHouse',
  'peek.departing',
  'peek.past',
  'peek.adults',
  'peek.children',
  'peek.stay',
  'peek.checkInAt',
  'peek.checkOutAt',
  'peek.nights',
  'peek.guests',
  'peek.room',
  'peek.roomType',
  'peek.unassigned',
  'peek.payment',
  'peek.total',
  'peek.due',
  'peek.noFolio',
  'peek.dueHidden',
  'peek.dueUnknown',
  'peek.guaranteeLabel',
  'peek.source',
  'peek.notes',
  'peek.eta',
  'peek.request',
  'peek.early',
  'peek.arrivalNote',
  'peek.loyalty',
  'peek.vip',
  'peek.actions',
  'peek.checkIn',
  'peek.deposit',
  'peek.guarantee',
  'peek.amend',
  'peek.checkout',
  'peek.move',
  'peek.collect',
  'peek.openReservation',
  'peek.openStay',
  'peek.close',
  'peek.previous',
  'peek.next',
  'peek.loading',
  'peek.failedTitle',
  'peek.failedMessage',
  'peek.missingTitle',
  'peek.missingMessage',
  'legend.inHouse',
  'legend.booked',
  'legend.past',
  'legend.out',
  // A count of one reads in the singular where the language has one.
  ...['previous', 'next', 'nights', 'unroomedLink', 'floorRooms', 'peek.adults', 'peek.children'].map(
    (key) => `${key}.one`,
  ),
] as const
// The browser fills these in; the server keeps them as written.
const PLACEHOLDERS = Object.fromEntries(
  ['count', 'name', 'room', 'type', 'state', 'q', 'date', 'from', 'to'].map((name) => [name, `{${name}}`]),
)
const WEEKDAYS: Record<string, string[]> = {
  vi: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

export const roomPlanNights = (businessDate: string, locale: string): RoomPlanNight[] =>
  Array.from({ length: ROOM_PLAN_LAST - ROOM_PLAN_FIRST + 1 }, (_, index) => {
    const night = ROOM_PLAN_FIRST + index
    const key = addCalendarDays(businessDate, night)
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay()
    return {
      night,
      weekday: WEEKDAYS[locale === 'en' ? 'en' : 'vi']![weekday]!,
      short: `${key.slice(8, 10)}/${key.slice(5, 7)}`,
      long: `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`,
      weekend: weekday === 0 || weekday === 6,
      saturday: weekday === 6,
    }
  })

export type RoomPlanScreenInput = {
  url: URL
  locale: string
  plan: RoomPlanFrame
  may: RoomPlanProps['may'] & {
    book: boolean
    walkIn: boolean
    folio: boolean
    room: boolean
    balance: boolean
  }
}

const SCOPE = ['company', 'companies', 'branch', 'branches', 'lang']
const scoped = (url: URL, path: string, extra: Record<string, string> = {}) => {
  const target = new URL(path, url)
  for (const [name, value] of url.searchParams)
    if (SCOPE.includes(name)) target.searchParams.append(name, value)
  for (const [name, value] of Object.entries(extra)) target.searchParams.set(name, value)
  return `${target.pathname}${target.search}`.replace('%7Bid%7D', '{id}')
}

/** The plan's islands' props from the URL: its frame only; the rooms and stays are read in the browser. */
export const roomPlanProps = (
  { url, locale, plan, may }: RoomPlanScreenInput,
  _: Translator,
): RoomPlanProps | null => {
  const property = plan.property
  if (!property) return null
  const read = (name: string) => url.searchParams.get(name)?.trim() ?? ''
  const days = read('days') === '7' ? 7 : 14
  const first = ROOM_PLAN_FIRST,
    last = ROOM_PLAN_LAST
  const isDefault = plan.properties[0]?.id === property.id && !read('property')
  const planHref = scoped(url, '/admin/hospitality/tape-chart', isDefault ? {} : { property: property.id })
  const fn = (name: string) => scoped(url, `/_ket/fn/${name}`)
  const words: Record<string, string> = Object.fromEntries(
    WORDS.map((key) => [key, _(`hospitality_core.roomPlan.${key}`, PLACEHOLDERS)]),
  )
  for (const status of ROOM_STATUSES) words[`room.${status}`] = _(`hospitality_core.roomStatus.${status}`)
  for (const provider of BOOKING_PROVIDERS)
    words[`provider.${provider}`] = _(`hospitality_core.provider.${provider}`)
  const back = { property: property.id }
  return {
    key: `room-plan:${property.id}:${locale}:${JSON.stringify(SCOPE.map((name) => url.searchParams.getAll(name)))}`,
    path: '/admin/hospitality/tape-chart',
    planHref,
    source: fn('hospitality_core.getTapeChart'),
    request: {
      propertyId: property.id,
      from: zonedMidnight(addCalendarDays(property.businessDate, first), property.timezone).toISOString(),
      to: zonedMidnight(addCalendarDays(property.businessDate, last + 1), property.timezone).toISOString(),
    },
    peekSource: fn('hospitality_core.getRoomPlanPeek'),
    dueSource: may.balance ? fn('hospitality_billing.getFolioDue') : null,
    lang: locale === 'en' ? 'en' : 'vi',
    timezone: property.timezone,
    businessDate: property.businessDate,
    first,
    last,
    nights: roomPlanNights(property.businessDate, locale),
    types: plan.types.map((type) => ({ id: type.id, name: type.name, short: type.code || type.name })),
    floors: plan.floors,
    property: property.id,
    properties: plan.properties.map((item, index) => ({
      id: item.id,
      name: item.name,
      href: scoped(url, '/admin/hospitality/tape-chart', index === 0 ? {} : { property: item.id }),
    })),
    links: {
      reservation: scoped(url, '/admin/hospitality/reservations/{id}'),
      folio: may.folio ? scoped(url, '/admin/hospitality/folios/{id}') : null,
      room: may.room ? scoped(url, '/admin/hospitality/housekeeping/rooms/{id}', back) : null,
      arrivals: scoped(url, '/admin/hospitality/front-desk', back),
      reservations: scoped(url, '/admin/hospitality/reservations', back),
    },
    may: {
      checkIn: may.checkIn,
      checkout: may.checkout,
      move: may.move,
      amend: may.amend,
      deposit: may.deposit,
      guarantee: may.guarantee,
      payment: may.payment && may.folio,
    },
    words,
    query: {
      from: Math.min(last + 1 - days, Math.max(first, Number.parseInt(read('from'), 10) || 0)),
      days,
      floor: plan.floors.some((item) => item.id === read('floor')) ? read('floor') : null,
      type: plan.types.some((item) => item.id === read('type')) ? read('type') : null,
      view: ['free', 'arriving'].includes(read('view')) ? read('view') : 'all',
      q: read('q'),
      peek: read('peek') || null,
    },
  }
}

const swatch = (kind: string, label: string) => (
  <span class="hos-tape-key">
    <span class="hos-tape-swatch" data-kind={kind} aria-hidden="true"></span>
    {label}
  </span>
)

/**
 * As OPERA's Room Plan and Cloudbeds' calendar: rooms down the side, nights across, and one bar per stay from
 * the afternoon it arrives to the morning it leaves. The plan, its filters and its peek are islands; the
 * server renders only their frame from the URL.
 */
export const roomPlanScreen = (_: Translator, input: RoomPlanScreenInput, frame: Frame): TemplateResult => {
  const title = _('hospitality_core.screen.tapeChart.title')
  const props = roomPlanProps(input, _)
  const { url, may } = input
  const property = input.plan.property
  const actions: JSXChild = (
    <>
      {may.book ? (
        <LinkButton
          id="tape-new-booking"
          label={_('hospitality_core.deskBooking.title')}
          href={scoped(
            url,
            '/admin/hospitality/reservations/new',
            property ? { propertyId: property.id } : {},
          )}
          variant={may.walkIn ? 'secondary' : 'primary'}
        />
      ) : null}
      {may.walkIn ? (
        <LinkButton
          id="tape-walk-in"
          label={_('hospitality_core.deskBooking.walkInTitle')}
          href={scoped(url, '/admin/hospitality/reservations/new', {
            walkIn: '1',
            ...(property ? { propertyId: property.id } : {}),
          })}
          variant="primary"
        />
      ) : null}
    </>
  )
  if (!props) {
    return shell(
      _,
      title,
      <WorkspacePage
        variant="operational"
        layout="canvas"
        frame={frame}
        title={title}
        body={
          <EmptyState
            visual="start"
            title={_('hospitality_core.roomPlan.noPropertyTitle')}
            message={_('hospitality_core.roomPlan.noPropertyMessage')}
          />
        }
      />,
      { ...frame, topbar: false },
    )
  }
  const island = (name: string, factory: (props: RoomPlanProps) => { view: () => TemplateResult }) =>
    trustedMarkup(renderIsland(name, factory as never, props, { tag: 'div' }))
  return shell(
    _,
    title,
    <WorkspacePage
      variant="operational"
      layout="canvas"
      frame={frame}
      title={title}
      actions={may.book || may.walkIn ? actions : undefined}
      controls={island('hospitality.room-plan-controls', roomPlanControls)}
      body={
        <>
          <div class="hos-legend">
            {swatch('in-house', _('hospitality_core.roomPlan.legend.inHouse'))}
            {swatch('booked', _('hospitality_core.roomPlan.legend.booked'))}
            {swatch('past', _('hospitality_core.roomPlan.legend.past'))}
            {swatch('out', _('hospitality_core.roomPlan.legend.out'))}
          </div>
          <PeekLayout
            peekId={ROOM_PLAN_PEEK_ID}
            main={island('hospitality.room-plan-grid', roomPlanGrid)}
            peek={island('hospitality.room-plan-peek', roomPlanPeek)}
          />
        </>
      }
    />,
    { ...frame, topbar: false },
  )
}
