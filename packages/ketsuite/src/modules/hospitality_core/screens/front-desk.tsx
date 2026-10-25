import { ActivityTimeline } from '@ketvietlab/design-system'
import { hospitalityScopedHref } from './scoped-href.ts'
import {
  badge,
  CardGrid,
  type Column,
  dataTable,
  dateTime,
  emptyState,
  formatDateTime,
  formatMoney,
  type Frame,
  guestName,
  inline,
  linkButton,
  Metric,
  Notice,
  person,
  Section,
  setupAction,
  stack,
  type StayRow,
  type TemplateResult,
  type Translator,
  WorkspaceScreen,
  zonedMidnight,
} from './shared.tsx'

type DeskQueue = { rows: StayRow[]; total: number; guests: number; page: number; pages: number }
export type FrontDeskData = {
  attention?: {
    reservationId: string
    time: string
    roomCode: string
    roomStatus: string
    task: { id: string; state: string; dueAt: string | null; assigneeName: string | null } | null
  } | null
  activity?: {
    total: number
    rows: Array<{
      id: string
      action: string
      occurredAt: string
      actorName: string | null
      code: string | null
    }>
  }
  billingSummary?: { owing: number; unknown: number }
  summary?: {
    departureTotal: number
    departed: number
    ready: number
    blocked: number
    unassigned: number
    totalRooms: number
    cleanVacant: number
    tonightRooms: number
    occupancyPercent: number
  }
  propertyName?: string | null
  currency?: string | null
  configured: boolean
  propertyId: string | null
  timezone: string
  day: string
  arrivals: DeskQueue
  departures: DeskQueue
  overdue: DeskQueue
  inHouse: DeskQueue
}
export type FrontDeskToday = {
  controls?: TemplateResult
  queues?: FrontDeskData
  source?: string
  /** The calendar day the screen is showing, as YYYY-MM-DD. */
  day: string
  /** Booked for today and not yet in the room. */
  arrivals: StayRow[]
  /** In the room and due out today. */
  departures: StayRow[]
  /** In the room past the hour they were due out. */
  overdue: StayRow[]
  /** Everyone in a room right now, whatever day they leave. */
  inHouse: StayRow[]
}

/**
 * What the viewer may do, not what they may see. A read-only viewer opens this
 * screen legitimately — an auditor reads the shift, a night auditor reconciles
 * it — and offering them a button for work the reservation screen will refuse
 * is the same mistake the sidebar made before it separated the two.
 */
export type FrontDeskPermissions = {
  walkIn?: boolean
  create?: boolean
  housekeeping?: boolean
  billing?: boolean
  checkIn: boolean
  checkOut: boolean
}

/**
 * The room being kept for an arriving guest.
 *
 * Until rooms could be held this column was the booked room type, because a
 * room column on somebody who has not arrived was empty by construction. Now
 * it is either the room the desk chose or a mark that nobody has.
 */
const heldRoom = (row: StayRow): string | null => {
  const held = row.assignments?.find((assignment) => assignment.state === 'held')
  return held ? (held.roomName ?? held.roomId) : null
}

const headcount = (rows: StayRow[]): number =>
  rows.reduce((total, row) => total + row.adults + row.children, 0)

/**
 * Every heading on this screen says "today". The route has always accepted a
 * `?date=`, so "today" can be a Tuesday in August, and nothing on the page
 * said so. The day heads the day's counts.
 */
// One literal key per action the handover reads (`functions/front-desk-activity.ts`), so every label is
// checked in both languages and an action the desk does not know never shows a raw key.
const eventLabel = (_: Translator, action: string): string => {
  switch (action) {
    case 'createReservation':
      return _('hospitality_core.screen.frontDesk.event.createReservation')
    case 'planArrival':
      return _('hospitality_core.screen.frontDesk.event.planArrival')
    case 'holdRoom':
      return _('hospitality_core.screen.frontDesk.event.holdRoom')
    case 'releaseRoom':
      return _('hospitality_core.screen.frontDesk.event.releaseRoom')
    case 'checkIn':
      return _('hospitality_core.screen.frontDesk.event.checkIn')
    case 'checkOut':
      return _('hospitality_core.screen.frontDesk.event.checkOut')
    case 'moveRoom':
      return _('hospitality_core.screen.frontDesk.event.moveRoom')
    case 'room-block':
      return _('hospitality_core.screen.frontDesk.event.room-block')
    case 'room-reopen':
      return _('hospitality_core.screen.frontDesk.event.room-reopen')
    case 'room-inspect':
      return _('hospitality_core.screen.frontDesk.event.room-inspect')
    case 'room-cleaned':
      return _('hospitality_core.screen.frontDesk.event.room-cleaned')
    default:
      return _('hospitality_core.screen.frontDesk.event.other')
  }
}
const dayLabel = (day: string, locale: string, timezone: string): string =>
  formatDateTime(locale, zonedMidnight(day, timezone), {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

/**
 * Where the work is done. Check-in and check-out both live on the reservation,
 * so that is where a row sends the clerk; a stay with no reservation behind it
 * can still be opened on its own.
 */
const workHref = (row: StayRow, locale: string, source?: string): string => {
  const path = row.reservationId
    ? `/admin/hospitality/reservations/${encodeURIComponent(row.reservationId)}`
    : `/admin/hospitality/stays/${encodeURIComponent(row.id)}`
  if (!source) return `${path}?lang=${encodeURIComponent(locale)}`
  const current = new URL(source),
    target = new URL(path, current)
  target.searchParams.set('lang', locale)
  target.searchParams.set('returnTo', current.pathname + current.search)
  return hospitalityScopedHref(current, target.pathname + target.search)
}

const arrivalHref = (row: StayRow, locale: string, source?: string): string => {
  const target = new URL(workHref(row, locale, source), 'http://hospitality.local')
  if (row.reservationId)
    target.searchParams.set('dialog', row.arrivalIssue === 'unassigned' ? 'hold' : 'checkIn')
  return target.pathname + target.search
}

const codeColumn = (_: Translator, locale: string, source?: string): Column<StayRow> => ({
  key: 'code',
  label: _('hospitality_core.col.code'),
  cell: (row) =>
    linkButton({
      label: row.code,
      href: workHref(row, locale, source),
      variant: 'tertiary',
      size: 'compact',
    }),
  kind: 'identifier',
})

const guestColumn = (_: Translator): Column<StayRow> => ({
  key: 'guest',
  label: _('hospitality_core.col.guest'),
  cell: (row) => person(guestName(row)),
  kind: 'person',
  priority: 'primary',
})

/**
 * What the clerk needs to see before the guest walks up: the room being kept
 * for them, or — when nobody has chosen one — the type that was booked, so the
 * clerk knows what to choose from.
 */
const arrivalRoomColumn = (_: Translator): Column<StayRow> => ({
  key: 'roomType',
  label: _('hospitality_core.col.room'),
  cell: (row) => {
    const held = heldRoom(row)
    if (held) return held
    return row.roomType?.name ?? '—'
  },
})

const roomColumn = (_: Translator): Column<StayRow> => ({
  key: 'room',
  label: _('hospitality_core.col.room'),
  cell: (row) => row.currentRoom?.name ?? row.currentRoom?.code ?? '—',
})

const actionColumn = (_: Translator, label: string, locale: string, source?: string): Column<StayRow> => ({
  key: 'action',
  label: _('hospitality_core.col.action'),
  cell: (row) =>
    linkButton({ label, href: workHref(row, locale, source), variant: 'secondary', size: 'compact' }),
  align: 'end',
})

const arrivalColumns = (
  _: Translator,
  locale: string,
  timezone: string,
  permitted: boolean,
  source?: string,
): Array<Column<StayRow>> => [
  codeColumn(_, locale, source),
  guestColumn(_),
  arrivalRoomColumn(_),
  {
    key: 'arrivalIssue',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      row.arrivalIssue
        ? badge(_(`hospitality_core.screen.frontDesk.${row.arrivalIssue}`), 'warning', row.arrivalIssue)
        : '—',
  },
  {
    // Not `col.checkIn`: that reads "Nhận phòng", the same words as the button
    // beside it, and the two mean different things — an hour and a job to do.
    key: 'checkIn',
    label: _('hospitality_core.col.arrivalTime'),
    cell: (row) =>
      stack([
        row.expectedArrivalTime ?? dateTime(row.checkIn, locale, timezone),
        row.earlyArrivalRequested
          ? badge(_('hospitality_core.reservation.arrivalPlan.early'), 'warning')
          : null,
      ]),
    kind: 'date',
  },
  ...(permitted
    ? [
        {
          key: 'action',
          label: _('hospitality_core.col.action'),
          cell: (row: StayRow) =>
            linkButton({
              label: _(
                row.arrivalIssue === 'unassigned'
                  ? 'hospitality_core.reservation.action.holdRoom'
                  : row.arrivalIssue === 'guarantee'
                    ? 'hospitality_core.screen.frontDesk.guaranteeCheckIn'
                    : 'hospitality_core.reservation.action.checkIn',
              ),
              href: arrivalHref(row, locale, source),
              variant: 'secondary',
              size: 'compact',
            }),
          align: 'end' as const,
        },
      ]
    : []),
]

const departureColumns = (
  _: Translator,
  locale: string,
  timezone: string,
  permitted: boolean,
  source?: string,
  billing = false,
  currency?: string | null,
): Array<Column<StayRow>> => [
  codeColumn(_, locale, source),
  guestColumn(_),
  roomColumn(_),
  ...(billing
    ? [
        {
          key: 'balance',
          label: _('hospitality_core.screen.frontDesk.balance'),
          cell: (row: StayRow) =>
            row.balance == null
              ? _('hospitality_core.screen.frontDesk.balanceUnknown')
              : currency
                ? formatMoney(_, row.balance, currency)
                : _('hospitality_core.screen.frontDesk.balanceUnknown'),
          kind: 'currency' as const,
        },
      ]
    : []),
  {
    key: 'checkOut',
    label: _('hospitality_core.col.departureTime'),
    cell: (row) => dateTime(row.checkOut, locale, timezone),
    kind: 'date',
  },
  ...(permitted ? [actionColumn(_, _('hospitality_core.reservation.action.checkOut'), locale, source)] : []),
]

/**
 * The desk's own screen: the guests moving today, the ones already late, and
 * four counts that say whether the shift is on top of it.
 *
 * It deliberately does not list every stay the property holds. A guest who
 * arrived on Monday and leaves on Friday is not the desk's work on Wednesday,
 * and putting them in the same table as today's arrivals was what made the
 * screen something to read rather than something to work from. The full list
 * is one click away under its own menu entry.
 */
export const frontDeskScreen = (
  _: Translator,
  today: FrontDeskToday,
  may: FrontDeskPermissions,
  locale: string,
  timezone: string,
  frame: Frame,
  configured = true,
): TemplateResult => {
  const count = (key: 'arrivals' | 'departures' | 'overdue' | 'inHouse') =>
    today.queues?.[key].total ?? today[key].length
  const guests = (key: 'arrivals' | 'departures' | 'inHouse') =>
    today.queues?.[key].guests ?? headcount(today[key])
  const nothingToday = !count('arrivals') && !count('departures') && !count('overdue') && !count('inHouse')
  const pager = (key: 'arrivals' | 'departures' | 'overdue') => {
    const queue = today.queues?.[key]
    if (!queue || queue.pages < 2 || !today.source) return null
    const href = (page: number) => {
      const next = new URL(today.source!)
      next.searchParams.set(`${key}Page`, String(page))
      return next.pathname + next.search
    }
    return inline([
      queue.page > 1
        ? linkButton({
            label: _('hospitality_core.collection.previous'),
            href: href(queue.page - 1),
            variant: 'tertiary',
            size: 'compact',
          })
        : null,
      `${queue.page} / ${queue.pages}`,
      queue.page < queue.pages
        ? linkButton({
            label: _('hospitality_core.collection.next'),
            href: href(queue.page + 1),
            variant: 'tertiary',
            size: 'compact',
          })
        : null,
    ])
  }

  return (
    <WorkspaceScreen
      translator={_}
      title={_('hospitality_core.screen.frontDesk.title')}
      frame={frame}
      body={stack([
        today.controls ?? null,
        may.create && configured && today.queues?.propertyId && today.source
          ? inline([
              linkButton({
                label: _('hospitality_core.deskBooking.title'),
                href: hospitalityScopedHref(
                  new URL(today.source),
                  `/admin/hospitality/reservations/new?propertyId=${encodeURIComponent(today.queues.propertyId)}`,
                ),
              }),
              may.checkIn && may.walkIn
                ? linkButton({
                    label: _('hospitality_core.deskBooking.walkInTitle'),
                    href: hospitalityScopedHref(
                      new URL(today.source),
                      `/admin/hospitality/reservations/new?walkIn=1&propertyId=${encodeURIComponent(today.queues.propertyId)}`,
                    ),
                  })
                : null,
            ])
          : null,
        // Whole-queue movement and room-readiness totals, independent of pagination.
        <Section
          title={dayLabel(today.day, locale, timezone)}
          body={
            <CardGrid
              items={[
                {
                  id: 'arrivals',
                  label: _('hospitality_core.metric.arrivals'),
                  value: count('arrivals'),
                  detail: today.queues?.summary
                    ? _('hospitality_core.screen.frontDesk.arrivalReadiness', today.queues.summary)
                    : _('hospitality_core.screen.frontDesk.guestCount', { count: guests('arrivals') }),
                  tone: 'neutral' as const,
                },
                {
                  id: 'departures',
                  label: _('hospitality_core.metric.departures'),
                  value: today.queues?.summary?.departureTotal ?? count('departures'),
                  detail: today.queues?.summary
                    ? [
                        _('hospitality_core.screen.frontDesk.departedCount', {
                          count: today.queues.summary.departed,
                        }),
                        today.queues.billingSummary
                          ? _('hospitality_core.screen.frontDesk.owingCount', {
                              count: today.queues.billingSummary.owing,
                            })
                          : null,
                        today.queues.billingSummary?.unknown
                          ? _('hospitality_core.screen.frontDesk.unknownBalances', {
                              count: today.queues.billingSummary.unknown,
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : _('hospitality_core.screen.frontDesk.guestCount', { count: guests('departures') }),
                  tone:
                    today.queues?.billingSummary &&
                    (today.queues.billingSummary.owing || today.queues.billingSummary.unknown)
                      ? ('warning' as const)
                      : ('neutral' as const),
                },
                {
                  id: 'in-house',
                  label: _('hospitality_core.metric.inHouse'),
                  value: count('inHouse'),
                  detail: today.queues?.summary
                    ? _('hospitality_core.screen.frontDesk.occupancy', {
                        percent: today.queues.summary.occupancyPercent,
                      })
                    : _('hospitality_core.screen.frontDesk.guestCount', { count: guests('inHouse') }),
                  tone: 'neutral' as const,
                },
                ...(today.queues?.summary
                  ? [
                      {
                        id: 'clean-vacant',
                        label: _('hospitality_core.screen.frontDesk.cleanVacant'),
                        value: today.queues.summary.cleanVacant,
                        detail: _('hospitality_core.screen.frontDesk.unassignedCount', {
                          count: today.queues.summary.unassigned,
                        }),
                        tone:
                          today.queues.summary.cleanVacant < today.queues.summary.unassigned
                            ? ('danger' as const)
                            : ('neutral' as const),
                      },
                    ]
                  : []),
                ...(today.queues?.summary
                  ? []
                  : [
                      {
                        id: 'overdue',
                        label: _('hospitality_core.metric.overdue'),
                        value: count('overdue'),
                        detail: today.overdue.length
                          ? _('hospitality_core.screen.frontDesk.overdueDetail')
                          : _('hospitality_core.screen.frontDesk.overdueClear'),
                        tone: today.overdue.length ? ('danger' as const) : ('positive' as const),
                      },
                    ]),
              ]}
              id={(item) => item.id}
              card={(item) => (
                <Metric label={item.label} value={String(item.value)} detail={item.detail} tone={item.tone} />
              )}
            />
          }
        />,
        // The band says what is wrong; the table under it is the list to work
        // through, so it carries no second heading repeating the same sentence.
        today.overdue.length ? (
          <Notice
            title={_('hospitality_core.screen.frontDesk.overdue')}
            message={_('hospitality_core.screen.frontDesk.overdueHint', { count: count('overdue') })}
            tone="warning"
          />
        ) : null,
        today.overdue.length
          ? dataTable(_, {
              columns: departureColumns(
                _,
                locale,
                timezone,
                may.checkOut,
                today.source,
                may.billing,
                today.queues?.currency,
              ),
              rows: today.overdue,
              id: (row) => row.id,
              responsive: 'stack',
            })
          : null,
        pager('overdue'),
        today.queues?.attention ? (
          <Notice
            tone="warning"
            title={_('hospitality_core.screen.frontDesk.earlyAttention', {
              room: today.queues.attention.roomCode,
              time: today.queues.attention.time,
            })}
            message={
              today.queues.attention.task
                ? _('hospitality_core.screen.frontDesk.earlyTask', {
                    state: _(`hospitality_core.cleaningState.${today.queues.attention.task.state}`),
                    staff:
                      today.queues.attention.task.assigneeName ??
                      _('hospitality_core.screen.frontDesk.unassignedStaff'),
                  })
                : _('hospitality_core.screen.frontDesk.earlyNoTask')
            }
            actions={
              may.housekeeping && today.queues.attention.task
                ? linkButton({
                    label: _('hospitality_core.screen.frontDesk.openTask'),
                    href: hospitalityScopedHref(
                      new URL(
                        today.source ?? 'http://localhost/admin/hospitality/front-desk',
                        'http://localhost',
                      ),
                      `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(today.queues.attention.task.id)}`,
                    ),
                    variant: 'secondary',
                  })
                : undefined
            }
          />
        ) : null,
        nothingToday
          ? configured
            ? emptyState(
                _('hospitality_core.screen.frontDesk.empty'),
                _('hospitality_core.screen.frontDesk.emptyHint'),
              )
            : emptyState(
                _('hospitality_core.screen.frontDesk.setup'),
                _('hospitality_core.screen.frontDesk.setupHint'),
                {
                  actions: setupAction(
                    _('hospitality_core.property.action.create'),
                    '/admin/hospitality/properties/new',
                  ),
                },
              )
          : null,
        nothingToday ? null : (
          <Section
            title={_('hospitality_core.screen.frontDesk.arrivals')}
            body={
              today.arrivals.length
                ? dataTable(_, {
                    columns: arrivalColumns(_, locale, timezone, may.checkIn, today.source),
                    rows: today.arrivals,
                    id: (row) => row.id,
                    responsive: 'stack',
                  })
                : emptyState(
                    _('hospitality_core.screen.frontDesk.arrivalsEmpty'),
                    _('hospitality_core.screen.frontDesk.arrivalsEmptyHint'),
                  )
            }
          />
        ),
        pager('arrivals'),
        nothingToday ? null : (
          <Section
            title={_('hospitality_core.screen.frontDesk.departures')}
            body={
              today.departures.length
                ? dataTable(_, {
                    columns: departureColumns(
                      _,
                      locale,
                      timezone,
                      may.checkOut,
                      today.source,
                      may.billing,
                      today.queues?.currency,
                    ),
                    rows: today.departures,
                    id: (row) => row.id,
                    responsive: 'stack',
                  })
                : emptyState(
                    _('hospitality_core.screen.frontDesk.departuresEmpty'),
                    _('hospitality_core.screen.frontDesk.departuresEmptyHint'),
                  )
            }
          />
        ),
        pager('departures'),
        today.queues?.activity ? (
          <Section
            title={_('hospitality_core.screen.frontDesk.handover')}
            body={stack([
              <Notice
                title={_('hospitality_core.screen.frontDesk.activityCount', {
                  shown: today.queues.activity.rows.length,
                  total: today.queues.activity.total,
                })}
                message={_('hospitality_core.screen.frontDesk.activityHint')}
              />,
              <ActivityTimeline
                label={_('hospitality_core.screen.frontDesk.handover')}
                emptyTitle={_('hospitality_core.screen.frontDesk.activityEmpty')}
                emptyMessage={_('hospitality_core.screen.frontDesk.activityEmptyHint')}
                items={today.queues.activity.rows.map((event) => ({
                  id: event.id,
                  actor: event.actorName ?? _('hospitality_core.screen.frontDesk.systemActor'),
                  action: eventLabel(_, String(event.action)),
                  detail: event.code ?? undefined,
                  datetime: event.occurredAt,
                  timeLabel: formatDateTime(locale, new Date(event.occurredAt), {
                    timeZone: timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                }))}
              />,
            ])}
          />
        ) : null,
      ])}
    />
  )
}
