// The room plan (`/admin/hospitality/tape-chart`) as three islands sharing one store, as accepted in the mock
// (design/shared/hospitality-room-plan.mjs): `hospitality.room-plan-controls` holds the filters, period and
// pager, `hospitality.room-plan` the grid, `hospitality.room-plan-peek` one reservation beside it. The server
// renders the frame from the URL with the nights, room types and floors only; rooms and stays arrive from
// `hospitality_core.getTapeChart` through `/_ket/fn`, and every filter, count and scroll position is worked
// out here without a reload. The grid draws only the rows near the scroll, so a tower of several hundred
// rooms scrolls as lightly as one floor.

import { batch, computed, each, effect, html, signal } from '@ketvietlab/ketjs-view'
import type { IslandMountContext, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  ActionGroup,
  attachPeekInteractions,
  Badge,
  Button,
  DescriptionList,
  FormattedMoney,
  Inline,
  LinkButton,
  ListChrome,
  Menu,
  Notice,
  Peek,
  Stack,
} from '@ketvietlab/design-system'

export const ROOM_PLAN_PEEK_ID = 'tape-peek'

export type RoomPlanNight = {
  night: number
  weekday: string
  short: string
  long: string
  weekend: boolean
  saturday: boolean
}
export type RoomPlanProps = {
  key: string
  /** The plan's own path: links to it are filtered in place. */
  path: string
  /** The plan's address with its scope and property, without plan parameters. */
  planHref: string
  source: string
  request: { propertyId: string; from: string; to: string }
  peekSource: string
  /** Billing's folio due read, only for a reader who may see money. */
  dueSource: string | null
  lang: string
  timezone: string
  businessDate: string
  first: number
  last: number
  nights: RoomPlanNight[]
  types: Array<{ id: string; name: string; short: string }>
  floors: Array<{ id: string; name: string }>
  property: string
  properties: Array<{ id: string; name: string; href: string }>
  /** `{id}` templates, already scoped and carrying the way back. */
  links: {
    reservation: string
    folio: string | null
    room: string | null
    arrivals: string
    reservations: string
  }
  may: {
    checkIn: boolean
    checkout: boolean
    move: boolean
    amend: boolean
    deposit: boolean
    guarantee: boolean
    payment: boolean
  }
  words: Record<string, string>
  query: {
    from: number
    days: number
    floor: string | null
    type: string | null
    view: string
    q: string
    peek: string | null
  }
}

type PlanStay = {
  code: string
  guest: string
  folded: string
  type: string
  arrival: number
  nights: number
  status: string
  kind: 'past' | 'in-house' | 'booked'
  range: string
}
type PlanRoom = {
  id: string
  number: string
  floor: string | null
  type: string
  state: string
  out: boolean
  stays: PlanStay[]
}
type PlanRow = { key: string; floor: string | null; count?: number; room?: PlanRoom }
type PlanData = {
  timezone?: string
  rooms: Array<{ id: string; code: string; roomTypeId: string; floorId: string | null; status: string }>
  events: Array<{
    reservationId: string | null
    stayId: string
    roomId: string | null
    roomTypeId: string
    guest: string
    state: string
    start: string
    end: string
  }>
  truncated?: boolean
}
type PeekValue = {
  id: string
  code: string
  state: string
  checkIn: string
  checkOut: string
  nights: number
  adults: number
  children: number
  guest: { name: string }
  room: { code: string } | null
  roomType: { name: string } | null
  amountTotal: string
  currency: string
  source: string
  guarantee: { kind: string }
  arrival: { expectedTime: string | null; early: boolean; note: string | null }
  benefits: { vip: boolean; tier: string | null; program: string | null }
  folio: { id: string; due?: string | null; known?: boolean } | null
}
type PeekSummary =
  | { code: string; state: 'ready'; value: PeekValue }
  | { code: string; state: 'loading' | 'missing' | 'error' }

export const fold = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')

const roomTones: Record<string, string> = {
  available: 'positive',
  dirty: 'warning',
  cleaning: 'info',
  occupied: 'neutral',
  maintenance: 'warning',
  out_of_order: 'danger',
  inspection: 'info',
}
const outOfService = ['maintenance', 'out_of_order']
const day = 86_400_000
const viewIds = ['all', 'free', 'arriving'] as const
// Rows are rendered in chunks, so scrolling re-renders the grid once per chunk, not once per row.
const chunk = 20
const quiet = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const say = (props: RoomPlanProps, key: string, values: Record<string, string | number> = {}) =>
  ((String(values.count) === '1' ? props.words[`${key}.one`] : undefined) ?? props.words[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, name: string) => String(values[name] ?? ''),
  )

type Store = ReturnType<typeof createStore>

const createStore = (props: RoomPlanProps, browser: boolean) => {
  const { first, last, nights, query } = props
  const holds = (stay: PlanStay, night: number) => stay.arrival <= night && night < stay.arrival + stay.nights
  // The room state is today's: out of service counts against tonight only.
  const freeOn = (room: PlanRoom, night: number) =>
    !(night === 0 && room.out) && !room.stays.some((stay) => holds(stay, night))
  const count = (value: number) => value.toLocaleString(props.lang === 'en' ? 'en' : 'vi')
  const days = signal(query.days)
  const type = signal<string | null>(query.type)
  const view = signal(query.view)
  const q = signal(query.q)
  const peek = signal<string | null>(query.peek ?? null)
  const summary = signal<PeekSummary | null>(query.peek ? { code: query.peek, state: 'loading' } : null)
  const data = signal<PlanData | null>(null)
  const failed = signal(false)
  // Where the scroll stands: the nights in view and the floor at the top of the plan.
  const seen = signal({ from: query.from, to: query.from + query.days - 1, floor: query.floor })

  const prepared = computed(() => {
    const value = data()
    if (!value) return null
    // The function answers in UTC; a stay holds the property-local nights from its arrival date, counted
    // from the business date like the nights in the header.
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: value.timezone ?? props.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const dateOf = (instant: string) => local.format(new Date(instant))
    const base = Date.parse(`${props.businessDate}T00:00:00Z`)
    const offset = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - base) / day)
    const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
    const order = new Map(props.floors.map((item, index) => [item.id, index]))
    const rank = (room: PlanRoom) => (room.floor ? (order.get(room.floor) ?? order.size) : order.size + 1)
    const rooms: PlanRoom[] = value.rooms
      .map((room) => ({
        id: room.id,
        number: room.code,
        floor: room.floorId,
        type: room.roomTypeId,
        state: room.status,
        out: outOfService.includes(room.status),
        stays: [] as PlanStay[],
      }))
      // The plan reads rooms floor by floor, 1002 after 902.
      .sort((a, b) => rank(a) - rank(b) || a.number.localeCompare(b.number, props.lang, { numeric: true }))
    const byId = new Map(rooms.map((room) => [room.id, room]))
    const unroomed: PlanStay[] = []
    const byCode = new Map<string, { stay: PlanStay; room: PlanRoom }>()
    for (const event of value.events) {
      if (!event.reservationId) continue
      const start = dateOf(event.start)
      const end = dateOf(event.end)
      const arrival = offset(start)
      const length = Math.max(1, offset(end) - arrival)
      const status =
        event.state === 'checked_in' && arrival + length === 0
          ? say(props, 'stay.departing')
          : say(props, `stay.${event.state}`)
      const stay: PlanStay = {
        code: event.reservationId,
        guest: event.guest,
        folded: fold(event.guest),
        type: event.roomTypeId,
        arrival,
        nights: length,
        status,
        kind: event.state === 'checked_out' ? 'past' : event.state === 'checked_in' ? 'in-house' : 'booked',
        range: `${dayMonth(start)}–${dayMonth(end)} · ${say(props, 'nights', { count: length })}`,
      }
      const room = event.roomId ? byId.get(event.roomId) : undefined
      if (room) {
        room.stays.push(stay)
        byCode.set(stay.code, { stay, room })
      } else unroomed.push(stay)
    }
    return { rooms, unroomed, byCode }
  })
  const scope = computed(() => {
    const ready = prepared()
    if (!ready) return []
    const kind = type()
    const text = q().trim()
    const needle = fold(text)
    return ready.rooms.filter(
      (room) =>
        (!kind || room.type === kind) &&
        (!text || room.number.startsWith(text) || room.stays.some((stay) => stay.folded.includes(needle))),
    )
  })
  // The views are tonight's desk questions; scrolling moves the plan, not the rows.
  const byView = computed(() => {
    const rooms = scope()
    return {
      all: rooms,
      free: rooms.filter((room) => freeOn(room, 0)),
      arriving: rooms.filter((room) => room.stays.some((stay) => stay.arrival === 0)),
    } as Record<string, PlanRoom[]>
  })
  const shown = computed(() => byView()[view()] ?? byView().all!)
  const floors = computed(() =>
    prepared() ? [...new Set(shown().map((room) => room.floor ?? ''))] : props.floors.map((item) => item.id),
  )
  const floorNames = new Map(props.floors.map((item) => [item.id, item.name]))
  const floorName = (id: string | null) => (id && floorNames.get(id)) || say(props, 'noFloor')
  // One flat list of floor bands and rooms, so the grid can draw any slice of it.
  const rows = computed(() => {
    const list: PlanRow[] = []
    const groups = new Map<string, PlanRoom[]>()
    for (const room of shown()) {
      const key = room.floor ?? ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(room)
    }
    for (const [floor, members] of groups) {
      list.push({ key: `floor-${floor}`, floor, count: members.length })
      for (const room of members) list.push({ key: `room-${room.id}`, floor, room })
    }
    return list
  })
  const free = computed(() => nights.map(({ night }) => scope().filter((room) => freeOn(room, night)).length))
  const waiting = computed(() => {
    const ready = prepared()
    const kind = type()
    return nights.map(({ night }) =>
      ready
        ? ready.unroomed.filter((stay) => stay.arrival === night && (!kind || stay.type === kind)).length
        : 0,
    )
  })

  const span = () => seen().to - seen().from + 1
  const clampFrom = (night: number, length = span()) => Math.min(last + 1 - length, Math.max(first, night))
  const topFloor = () => floors()[0] ?? null
  const floorOf = (value: string | null) => (value !== null && floors().includes(value) ? value : topFloor())
  const params = (change: Record<string, unknown> = {}) => {
    const next = {
      from: seen().from,
      days: days(),
      floor: floorOf(seen().floor),
      type: type(),
      view: view(),
      q: q().trim(),
      peek: peek(),
      ...change,
    } as {
      from: number
      days: number
      floor: string | null
      type: string | null
      view: string
      q: string
      peek: string | null
    }
    return Object.fromEntries(
      Object.entries({
        from: next.from ? String(next.from) : '',
        days: next.days === 7 ? '7' : '',
        floor: next.floor && next.floor !== topFloor() ? String(next.floor) : '',
        type: next.type ?? '',
        view: next.view === 'all' ? '' : next.view,
        q: next.q,
        peek: next.peek ?? '',
      }).filter(([, value]) => value),
    )
  }
  const at = (change: Record<string, unknown> = {}) => {
    const url = new URL(props.planHref, 'http://plan.invalid')
    for (const [name, value] of Object.entries(params(change))) url.searchParams.set(name, value)
    return `${url.pathname}${url.search}`
  }
  const nightOf = (night: number) => nights[night - first]!
  // A bar's own link, and the peek's steps: the plan with that reservation peeked. Built from the plan's
  // address only, so drawing them does not follow the scroll; the runtime keeps the rest of the URL.
  const peekHref = (code: string) => {
    const url = new URL(props.planHref, 'http://plan.invalid')
    url.searchParams.set('peek', code)
    return `${url.pathname}${url.search}`
  }
  // Stays arriving the same night as the peeked one, in the order the plan shows their rooms.
  const sameArrival = (code: string) => {
    const current = prepared()?.byCode.get(code)
    if (!current) return []
    return shown().flatMap((room) =>
      room.stays.filter((stay) => stay.arrival === current.stay.arrival).map((stay) => stay.code),
    )
  }

  const store = {
    props,
    count,
    days,
    type,
    view,
    q,
    peek,
    summary,
    data,
    failed,
    seen,
    scope,
    byView,
    shown,
    floors,
    rows,
    free,
    waiting,
    prepared,
    clampFrom,
    floorOf,
    floorName,
    params,
    at,
    nightOf,
    peekHref,
    sameArrival,
    holds,
    refs: 0,
    // The grid island answers these; the controls ask for them.
    jump: (_target: { night?: number; floor?: string | null }, _behavior: ScrollBehavior = 'auto') => {},
    reset: () => {},
    load: (): Promise<void> => Promise.resolve(),
    write: (_push: boolean) => {},
    apply: (_change: Record<string, unknown>, _options: { push?: boolean; record?: boolean } = {}) => {},
    read: (_url: URL) => {},
    openPeek: (_code: string) => {},
    closePeek: () => {},
    retryPeek: () => {},
    prefetch: (_code: string) => {},
    dispose: () => {},
  }
  if (!browser) return store

  const controller = new AbortController()
  store.dispose = () => controller.abort()
  const post = async (source: string, body: unknown) => {
    const response = await fetch(source, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const reply = (await response.json()) as { ok?: boolean; value?: unknown }
    if (!response.ok || !reply.ok) throw new Error('room plan read failed')
    return reply.value
  }
  let loading: Promise<void> | null = null
  // One read at a time; after a failed one, the plan reads again, as it is loading, when asked.
  store.load = () => {
    if (loading) return loading
    failed.set(false)
    loading = post(props.source, props.request)
      .then((value) => {
        const plan = value as PlanData
        if (!Array.isArray(plan?.rooms) || !Array.isArray(plan?.events)) throw new Error('invalid room plan')
        data.set(plan)
      })
      .catch(() => {
        loading = null
        if (!controller.signal.aborted) failed.set(true)
      })
    return loading
  }
  // Summaries the peek has read, most recent last; a reservation read twice in a row is not read again.
  const summaries = new Map<string, PeekValue | null>()
  const reading = new Map<string, Promise<PeekValue | null>>()
  const remember = (code: string, value: PeekValue | null) => {
    summaries.delete(code)
    summaries.set(code, value)
    if (summaries.size > 30) summaries.delete(summaries.keys().next().value!)
  }
  const readSummary = (code: string) => {
    if (!reading.has(code)) {
      reading.set(
        code,
        post(props.peekSource, { id: code })
          .then(async (reply) => {
            // `null`: the reservation is gone (cancelled, or a stale link); that is an answer, not a failure.
            const value = ((reply as { record?: PeekValue | null } | null)?.record ??
              null) as PeekValue | null
            if (value?.folio && props.dueSource) {
              const due = (await post(props.dueSource, { id: value.folio.id }).catch(() => null)) as {
                due?: string | null
                known?: boolean
              } | null
              value.folio = { ...value.folio, due: due?.due ?? null, known: due?.known === true }
            }
            remember(code, value)
            return value
          })
          .finally(() => reading.delete(code)),
      )
    }
    return reading.get(code)!
  }
  const show = (code: string | null) => {
    if (!code) return summary.set(null)
    if (summaries.has(code)) {
      const known = summaries.get(code)
      return summary.set(known ? { code, state: 'ready', value: known } : { code, state: 'missing' })
    }
    summary.set({ code, state: 'loading' })
    readSummary(code).then(
      (value) => {
        if (peek.peek() === code)
          summary.set(value ? { code, state: 'ready', value } : { code, state: 'missing' })
      },
      () => {
        if (peek.peek() === code && !controller.signal.aborted) summary.set({ code, state: 'error' })
      },
    )
  }
  store.prefetch = (code) => {
    if (code && !summaries.has(code)) readSummary(code).catch(() => {})
  }
  store.retryPeek = () => show(peek.peek())

  const names = ['from', 'days', 'floor', 'type', 'view', 'q', 'peek']
  store.write = (push) => {
    const url = new URL(location.href)
    for (const name of names) url.searchParams.delete(name)
    for (const [name, value] of Object.entries(params())) url.searchParams.set(name, value)
    if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](history.state, '', url.href)
  }
  // A filter starts at the top of its matches and keeps the nights in view; the back button undoes it.
  // `record: false` when the URL already holds the change (Back/Forward): writing it again would stamp the
  // scroll the page had before onto the entry being returned to.
  store.apply = (change, { push = true, record = true } = {}) => {
    batch(() => {
      if ('days' in change) days.set(change.days === 7 ? 7 : 14)
      if ('type' in change) type.set((change.type as string | null) ?? null)
      if ('view' in change) view.set(String(change.view ?? 'all'))
      if ('q' in change) q.set(String(change.q ?? ''))
    })
    store.reset()
    if (record) store.write(push)
  }
  // Opening a peek is a step Back undoes; moving to another reservation replaces it; closing is a step again.
  store.openPeek = (code) => {
    if (!code || code === peek.peek()) return
    const swap = peek.peek() !== null
    batch(() => {
      peek.set(code)
      show(code)
    })
    store.write(!swap)
  }
  store.closePeek = () => {
    if (peek.peek() === null) return
    batch(() => {
      peek.set(null)
      show(null)
    })
    store.write(true)
  }
  store.read = (url) => {
    const value = (name: string) => url.searchParams.get(name) ?? ''
    const code = value('peek') || null
    if (code !== peek.peek()) {
      batch(() => {
        peek.set(code)
        show(code)
      })
    }
    store.apply(
      {
        days: value('days') === '7' ? 7 : 14,
        type: props.types.some((item) => item.id === value('type')) ? value('type') : null,
        view: ['free', 'arriving'].includes(value('view')) ? value('view') : 'all',
        q: value('q'),
      },
      { record: false },
    )
    store.jump({ night: Number.parseInt(value('from'), 10) || 0, floor: value('floor') || null }, 'auto')
  }
  if (query.peek) show(query.peek)
  return store
}

// The server renders each island once per request; the browser shares one store between the three islands
// of one plan and disposes it when the last of them leaves the page.
const stores = new Map<string, Store>()
const storeOf = (props: RoomPlanProps): Store => {
  if (typeof window === 'undefined') return createStore(props, false)
  if (!stores.has(props.key)) stores.set(props.key, createStore(props, true))
  return stores.get(props.key)!
}
const hold = (props: RoomPlanProps, store: Store, lifetime: AbortSignal) => {
  store.refs++
  lifetime.addEventListener(
    'abort',
    () => {
      store.refs--
      if (store.refs === 0) {
        store.dispose()
        if (stores.get(props.key) === store) stores.delete(props.key)
      }
    },
    { once: true },
  )
}
const closeMenus = (link: Element) => {
  // The menu closes, and so does the folded filter panel holding it on a phone.
  for (
    let open = link.closest('details[open]');
    open;
    open = open.parentElement?.closest('details[open]') ?? null
  )
    open.removeAttribute('open')
}
const planLink = (event: MouseEvent, props: RoomPlanProps) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
  if (
    !link ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null
  const url = new URL(link.href, location.href)
  return url.origin === location.origin && url.pathname === props.path ? { link, url } : null
}
const filtersOf = (url: URL) => {
  const value = (name: string) => url.searchParams.get(name) ?? ''
  return {
    days: value('days') === '7' ? 7 : 14,
    type: value('type') || null,
    view: value('view') || 'all',
    q: value('q'),
  }
}
const hiddenOf = (href: string) => Object.fromEntries(new URL(href, 'http://plan.invalid').searchParams)

export const roomPlanControls = (props: RoomPlanProps) => {
  const store = storeOf(props)
  const view = (): TemplateResult => {
    const { from, to, floor: seenFloor } = store.seen()
    const days = store.days()
    // A step is the nights in view: where fewer than `days` fit, a step of `days` would pass over some.
    const step = to - from + 1
    const type = store.type()
    const current = store.view()
    const q = store.q()
    const loaded = Boolean(store.data())
    const floors = store.floors()
    const floor = store.floorOf(seenFloor)
    const typeName = props.types.find((item) => item.id === type)?.name ?? say(props, 'allTypes')
    const floorName = floor !== null ? store.floorName(floor) : null
    const property = props.properties.find((item) => item.id === props.property)
    const counts = store.byView()
    return ListChrome({
      filtersLabel: say(props, 'filtersLabel'),
      // On a phone the property, floor, type and views fold into one toggle; the floor is a jump, not a filter.
      filtersToggle: {
        label: say(props, 'filters'),
        count: [type, current !== 'all'].filter(Boolean).length,
      },
      search: {
        id: 'tape-search',
        action: props.path,
        name: 'q',
        value: q,
        label: say(props, 'searchLabel'),
        placeholder: say(props, 'searchPlaceholder'),
        submitLabel: say(props, 'searchAction'),
        hidden: hiddenOf(store.at({ q: '', floor: null, peek: null })),
      },
      filterMenus: [
        // The plan is one property's: choosing another reads its rooms, types and floors anew, as a new page.
        props.properties.length > 1
          ? Menu({
              id: 'tape-property',
              label: say(props, 'propertyMenu', { name: property?.name ?? '' }),
              selectionMode: 'single',
              trigger: html`<span>${property?.name ?? say(props, 'property')}</span>`,
              items: props.properties.map((item) => ({
                id: `property-${item.id}`,
                label: item.name,
                href: item.href,
                checked: item.id === props.property,
              })),
            })
          : null,
        // The floor menu jumps to a floor and names the one at the top of the plan as it scrolls. A menu that
        // shows its choice is named for both, so the name a reader says is the one they see.
        floors.length
          ? Menu({
              id: 'tape-floor',
              label: floorName ? say(props, 'floorMenu', { name: floorName }) : say(props, 'floor'),
              selectionMode: 'single',
              trigger: html`<span data-tape-floor-label>${floorName ?? say(props, 'floor')}</span>`,
              items: floors.map((item) => ({
                id: `floor-${item || 'none'}`,
                label: store.floorName(item || null),
                href: store.at({ floor: item }),
                checked: item === floor,
              })),
            })
          : null,
        Menu({
          id: 'tape-type',
          label: say(props, 'typeMenu', { name: typeName }),
          selectionMode: 'single',
          trigger: html`<span>${typeName}</span>`,
          items: [
            { id: 'type-all', label: say(props, 'allTypes'), href: store.at({ type: null }), checked: !type },
            ...props.types.map((item) => ({
              id: `type-${item.id}`,
              label: item.name,
              href: store.at({ type: item.id }),
              checked: item.id === type,
            })),
          ],
        }),
      ].filter(Boolean),
      // Counts arrive with the rooms; until then the facet holds its place.
      facets: viewIds.map((id) => ({
        id,
        label: say(props, `view.${id}`),
        href: store.at({ view: id }),
        active: id === current,
        count: loaded ? store.count(counts[id]!.length) : '…',
      })),
      // The period sits together: back to today, how many days fill the frame, then the nights in view and
      // their steps. The days menu leads the row, so it opens from its start.
      actions: Inline({
        gap: 'compact',
        blockAlign: 'center',
        items: [
          html`<span data-tape-today>${LinkButton({ label: say(props, 'today'), href: store.at({ from: 0 }), variant: 'secondary' })}</span>`,
          Menu({
            id: 'tape-days',
            label: say(props, 'daysMenu', { count: days }),
            selectionMode: 'single',
            trigger: html`<span>${say(props, 'days', { count: days })}</span>`,
            items: [7, 14].map((item) => ({
              id: `days-${item}`,
              label: say(props, 'days', { count: item }),
              href: store.at({ days: item }),
              checked: item === days,
            })),
          }),
        ],
      }),
      pager: {
        label: say(props, 'pager'),
        summary: `${store.nightOf(from).short}–${store.nightOf(to).long}`,
        previousHref: from > props.first ? store.at({ from: store.clampFrom(from - step) }) : null,
        nextHref: to < props.last ? store.at({ from: store.clampFrom(from + step) }) : null,
        previousLabel: say(props, 'previous', { count: step }),
        nextLabel: say(props, 'next', { count: step }),
      },
    })
  }
  let typing: ReturnType<typeof setTimeout> | 0 = 0
  return {
    view,
    mount: ({ root, lifetime }: IslandMountContext) => {
      if (!(root instanceof HTMLElement)) return
      hold(props, store, lifetime)
      // The controls move or filter the plan in place; every link still navigates without this runtime.
      root.addEventListener(
        'click',
        (event) => {
          const target = planLink(event, props)
          if (!target) return
          const { link, url } = target
          // Another property is another plan: the link navigates.
          if (link.closest('#tape-property-panel, #tape-property')) return
          event.preventDefault()
          closeMenus(link)
          const from = Number.parseInt(url.searchParams.get('from') ?? '0', 10) || 0
          const behavior = quiet() ? 'auto' : 'smooth'
          if (link.closest('[data-tape-today]')) store.jump({ night: 0 }, behavior)
          else if (link.closest('[data-ui="pager-bar"]')) store.jump({ night: from }, behavior)
          else if (link.closest('#tape-floor-panel, #tape-floor'))
            store.jump({ floor: url.searchParams.get('floor') || store.floors()[0] || null }, behavior)
          else store.apply(filtersOf(url))
        },
        { signal: lifetime },
      )
      // Search narrows the rows as the desk types.
      root.addEventListener(
        'input',
        (event) => {
          if (!(event.target instanceof HTMLInputElement) || event.target.id !== 'tape-search') return
          if (event instanceof InputEvent && event.isComposing) return
          const value = event.target.value
          if (typing) clearTimeout(typing)
          typing = setTimeout(() => {
            typing = 0
            store.apply({ q: value }, { push: false })
          }, 150)
        },
        { signal: lifetime },
      )
      root.addEventListener(
        'submit',
        (event) => {
          const input =
            event.target instanceof HTMLFormElement
              ? event.target.querySelector<HTMLInputElement>('#tape-search')
              : null
          if (!input) return
          event.preventDefault()
          if (typing) clearTimeout(typing)
          typing = 0
          store.apply({ q: input.value })
        },
        { signal: lifetime },
      )
      // Back and Forward drop a search still waiting: the entry they reach names its own. Capture runs this
      // before the plan reads that entry.
      addEventListener(
        'popstate',
        () => {
          if (typing) clearTimeout(typing)
          typing = 0
        },
        { signal: lifetime, capture: true },
      )
      // The field shows the search the plan shows; text still waiting to be searched is the reader's.
      const follows = effect(() => {
        const q = store.q()
        const field = root.querySelector('#tape-search')
        if (!typing && field instanceof HTMLInputElement && field.value !== q) field.value = q
      })
      lifetime.addEventListener('abort', () => {
        if (typing) clearTimeout(typing)
        follows()
      })
      void store.load()
    },
  }
}

export const roomPlanGrid = (props: RoomPlanProps) => {
  const store = storeOf(props)
  const { first, last, nights, links } = props
  const typeById = new Map(props.types.map((item) => [item.id, item]))
  // Measured once the first rooms are drawn: a room row and a floor band, borders included.
  const pitch = signal({ room: 37, floor: 29 })
  const range = signal<[number, number]>([0, 2 * chunk])
  const offsets = computed(() => {
    const { room, floor } = pitch()
    const list: number[] = []
    let y = 0
    for (const row of store.rows()) {
      list.push(y)
      y += row.room ? room : floor
    }
    list.push(y)
    return list
  })
  const today = (night: number) => (night === 0 ? 'true' : null)
  const saturday = nights.findIndex((item) => item.saturday)
  // Night n starts at line 3 + 2(n - first); a stay runs from its afternoon half to the morning half it leaves.
  const line = (night: number) => 3 + 2 * (night - first)
  const roomHref = (id: string) => (links.room ? links.room.replace('{id}', encodeURIComponent(id)) : null)

  const bar = (stay: PlanStay) => {
    const end = stay.arrival + stay.nights
    const name = `${stay.guest} · ${stay.range} · ${stay.status}`
    const clip =
      stay.arrival < first && end > last ? 'both' : stay.arrival < first ? 'start' : end > last ? 'end' : null
    // A bar opens the peek beside the plan; the peek leads on to the reservation.
    return html`<a class="hos-tape-bar" data-kind=${stay.kind} data-clip=${clip} data-peek=${stay.code} style=${`grid-column: ${stay.arrival < first ? 2 : line(stay.arrival)} / ${end > last ? -1 : line(end)}`} href=${store.peekHref(stay.code)} aria-controls=${ROOM_PLAN_PEEK_ID} aria-current=${store.peek() === stay.code ? 'true' : null} title=${name} aria-label=${name}>${stay.guest}</a>`
  }
  const outBar = (room: PlanRoom) => {
    if (!room.out || room.stays.some((stay) => store.holds(stay, 0))) return null
    const label = say(props, 'outRoom', { room: room.number })
    const href = roomHref(room.id)
    return href
      ? html`<a class="hos-tape-bar" data-kind="out" style=${`grid-column: ${line(0) - 1} / ${line(0) + 1}`} href=${href} title=${label} aria-label=${label}>${say(props, 'out')}</a>`
      : html`<span class="hos-tape-bar" data-kind="out" style=${`grid-column: ${line(0) - 1} / ${line(0) + 1}`} title=${label}>${say(props, 'out')}</span>`
  }
  // Day lines, weekends and today are painted once behind the rows instead of a cell per room and night.
  const row = (item: PlanRow) => {
    if (!item.room) {
      return html`<div class="hos-tape-row" data-floor-label="true" data-floor=${item.floor ?? ''}><div class="hos-tape-corner"><strong>${store.floorName(item.floor || null)}</strong><span>${say(props, 'floorRooms', { count: store.count(item.count ?? 0) })}</span></div></div>`
    }
    const { room } = item
    const label = say(props, `room.${room.state}`)
    const tone = roomTones[room.state] ?? 'neutral'
    const kind = typeById.get(room.type)
    return html`<div class="hos-tape-row" data-room=${room.id}>
      <div class="hos-tape-room" title=${say(props, 'roomTitle', { room: room.number, type: kind?.name ?? '', state: label })}>
        <span class="hos-tape-dot" data-tone=${tone} role="img" aria-label=${label}></span>
        <strong>${room.number}</strong>
        <span class="hos-tape-type">${kind?.short ?? ''}</span>
      </div>
      ${each(room.stays, (stay) => stay.code, bar)}
      ${outBar(room)}
    </div>`
  }
  const perNight = (cell: (item: RoomPlanNight) => TemplateResult) =>
    html`<div class="hos-tape-days">${each(nights, (item) => item.night, cell)}</div>`

  const view = (): TemplateResult => {
    const loaded = Boolean(store.data())
    if (store.failed()) {
      // Read again in place, as the lists do: the plan's own links stay in the plan and would not read it.
      return Notice({
        title: say(props, 'failedTitle'),
        message: say(props, 'failedMessage'),
        tone: 'danger',
        actions: Button({ id: 'tape-retry', label: say(props, 'retry'), variant: 'secondary' }),
      })
    }
    if (loaded && !store.prepared()!.rooms.length) {
      return Notice({
        title: say(props, 'noRoomsTitle'),
        message: say(props, 'noRoomsMessage'),
        tone: 'info',
      })
    }
    if (loaded && !store.shown().length) {
      const q = store.q().trim()
      // A search may match rooms that a type or a view leaves out; then the filters, not the words, empty it.
      const narrowed = Boolean(store.type()) || store.view() !== 'all'
      return Notice({
        title: say(props, 'emptyTitle'),
        message: !q
          ? say(props, 'emptyFilters')
          : narrowed
            ? say(props, 'emptyNarrowed', { q })
            : say(props, 'emptySearch', { q }),
        tone: 'info',
        actions: LinkButton({
          label: say(props, 'clearFilters'),
          href: store.at({ type: null, view: 'all', q: '', floor: null }),
          variant: 'secondary',
        }),
      })
    }
    const free = store.free()
    const waiting = store.waiting()
    const rows = store.rows()
    const at = offsets()
    const [start, end] = range()
    const from = Math.min(start, rows.length)
    const to = Math.min(end, rows.length)
    const unroomedHref = (night: number) => (night === 0 ? links.arrivals : links.reservations)
    return html`${store.data()?.truncated ? Notice({ title: say(props, 'truncatedTitle'), message: say(props, 'truncatedMessage'), tone: 'warning' }) : null}<div class="hos-tape" data-hos-tape data-days=${String(store.days())} style=${`--hos-tape-halves: ${2 * nights.length}; --hos-tape-today: ${-first}; --hos-tape-saturday: ${Math.max(0, saturday)}`} tabindex="0" role="region" aria-busy=${loaded ? null : 'true'} aria-label=${say(props, 'region', { from: nights[0]!.short, to: nights.at(-1)!.long })}>
      <div class="hos-tape-grid">
        <div class="hos-tape-head">
          <div class="hos-tape-row">
            <div class="hos-tape-corner">${say(props, 'corner')}</div>
            ${perNight((item) => html`<div class="hos-tape-day" data-night=${String(item.night)} data-today=${today(item.night)} data-weekend=${item.weekend ? 'true' : null}><span>${item.weekday}</span><strong>${item.short}</strong></div>`)}
          </div>
          <div class="hos-tape-row" data-summary="true">
            <div class="hos-tape-corner">${say(props, 'free')}</div>
            ${perNight((item) => html`<div class="hos-tape-total" data-today=${today(item.night)} data-weekend=${item.weekend ? 'true' : null}>${loaded ? store.count(free[item.night - first] ?? 0) : ''}</div>`)}
          </div>
          <div class="hos-tape-row" data-summary="true">
            <div class="hos-tape-corner">${say(props, 'unroomed')}</div>
            ${perNight((item) => {
              const value = waiting[item.night - first] ?? 0
              return html`<div class="hos-tape-total" data-today=${today(item.night)} data-weekend=${item.weekend ? 'true' : null}>${
                !loaded
                  ? ''
                  : value
                    ? html`<a href=${unroomedHref(item.night)} aria-label=${say(props, 'unroomedLink', { count: store.count(value), date: item.short })}>${store.count(value)}</a>`
                    : html`<span aria-hidden="true">–</span>`
              }</div>`
            })}
          </div>
        </div>
        ${
          loaded
            ? html`<div class="hos-tape-spacer" aria-hidden="true" style=${`height: ${at[from]}px`}></div>${each(rows.slice(from, to), (item) => item.key, row)}<div class="hos-tape-spacer" aria-hidden="true" style=${`height: ${(at[rows.length] ?? 0) - (at[to] ?? 0)}px`}></div>`
            : html`<div class="hos-tape-row" data-loading="true"><div class="hos-tape-corner">${say(props, 'loadingRooms')}</div></div>`
        }
      </div>
    </div>`
  }

  return {
    view,
    mount: ({ root, lifetime }: IslandMountContext) => {
      if (!(root instanceof HTMLElement)) return
      hold(props, store, lifetime)
      const tape = () => root.querySelector<HTMLElement>('.hos-tape')
      const dayWidth = (frame: HTMLElement) =>
        frame.querySelector('.hos-tape-day')?.getBoundingClientRect().width || 1
      const roomWidth = (frame: HTMLElement) =>
        frame.querySelector('.hos-tape-corner')?.getBoundingClientRect().width ?? 0
      const headHeight = (frame: HTMLElement) =>
        frame.querySelector('.hos-tape-head')?.getBoundingClientRect().height ?? 0
      const rowAt = (y: number) => {
        const at = offsets()
        let low = 0
        let high = Math.max(0, store.rows().length - 1)
        while (low < high) {
          const mid = (low + high + 1) >> 1
          if ((at[mid] ?? 0) <= y) low = mid
          else high = mid - 1
        }
        return low
      }
      const measure = (frame: HTMLElement) => {
        const room = frame.querySelector('.hos-tape-row[data-room]')?.getBoundingClientRect().height
        const floor = frame.querySelector('.hos-tape-row[data-floor-label]')?.getBoundingClientRect().height
        const current = pitch.peek()
        if (room && floor && (Math.abs(room - current.room) > 0.1 || Math.abs(floor - current.floor) > 0.1))
          pitch.set({ room, floor })
      }
      // The night the frame was last scrolled to, and the width of a day it was scrolled with. A new number of
      // days or a resize gives the days a new width, which the browser may lay out a frame after the change:
      // the grid's resize says when, and the plan scrolls to the same night again.
      let held = { night: store.seen.peek().from, width: 0 }
      let observed: Element | null = null
      const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => later()) : null
      // What the scroll shows: the nights for the pager, the floor for the floor menu, the rows to draw.
      const sync = () => {
        const frame = tape()
        if (!frame) return
        const grid = frame.querySelector('.hos-tape-grid')
        if (resized && grid !== observed) {
          resized.disconnect()
          if (grid) resized.observe(grid)
          observed = grid
        }
        const width = dayWidth(frame)
        if (width !== held.width) {
          store.jump({ night: held.night })
          return
        }
        const rows = store.rows()
        const span = Math.max(1, Math.floor((frame.clientWidth - roomWidth(frame)) / width + 0.05))
        // Scrolled to its end, the frame holds the last night whole, whatever is left of a night at its start.
        const atEnd = frame.scrollLeft >= frame.scrollWidth - frame.clientWidth - 1
        const from = store.clampFrom(atEnd ? last : first + Math.round(frame.scrollLeft / width), span)
        const to = Math.min(last, from + span - 1)
        const top = rowAt(frame.scrollTop)
        const bottom = rowAt(frame.scrollTop + frame.clientHeight - headHeight(frame))
        const floor = rows[top]?.floor ?? null
        const next: [number, number] = [
          Math.max(0, Math.floor(top / chunk) * chunk - chunk),
          Math.min(rows.length, (Math.floor(bottom / chunk) + 2) * chunk),
        ]
        const seen = store.seen.peek()
        const [start, end] = range.peek()
        batch(() => {
          if (next[0] !== start || next[1] !== end) range.set(next)
          if (seen.from !== from || seen.to !== to || seen.floor !== floor)
            store.seen.set({ from, to, floor })
        })
        held = { night: from, width }
        if (seen.from !== from || seen.floor !== floor) store.write(false)
      }
      let frameId = 0
      const later = () => {
        if (frameId) return
        frameId = requestAnimationFrame(() => {
          frameId = 0
          sync()
        })
      }
      store.jump = ({ night, floor }, behavior = 'auto') => {
        const frame = tape()
        if (!frame) return
        const target: ScrollToOptions = {}
        if (night !== undefined) {
          held = { night: store.clampFrom(night), width: dayWidth(frame) }
          target.left = (held.night - first) * held.width
        }
        if (floor !== undefined && floor !== null) {
          const index = store.rows().findIndex((item) => !item.room && item.floor === floor)
          if (index >= 0) target.top = offsets()[index]
        }
        frame.scrollTo({ ...target, behavior })
        later()
      }
      store.reset = () => {
        range.set([0, 2 * chunk])
        const frame = tape()
        if (frame) frame.scrollTop = 0
        // A new number of days changes the day width; the nights in view stay.
        store.jump({ night: store.seen.peek().from })
      }
      // Scroll does not bubble; the grid frame can be replaced by an empty state and back.
      root.addEventListener('scroll', later, { capture: true, passive: true, signal: lifetime })
      addEventListener('resize', later, { signal: lifetime })
      addEventListener(
        'popstate',
        () => {
          const url = new URL(location.href)
          if (url.pathname === props.path) store.read(url)
        },
        { signal: lifetime },
      )
      // The plan read; once it is in, its rows measured and the nights and floor that were in view brought back.
      const load = () => {
        const { from, floor } = store.seen.peek()
        return store.load().then(() => {
          const frame = tape()
          if (!frame) return
          measure(frame)
          store.jump({ night: from, floor })
        })
      }
      root.addEventListener(
        'click',
        (event) => {
          if (event.target instanceof Element && event.target.closest('#tape-retry')) {
            void load()
            return
          }
          const target = planLink(event, props)
          if (!target) return
          event.preventDefault()
          const code = target.link.closest<HTMLElement>('.hos-tape-bar[data-peek]')?.dataset.peek
          if (code) store.openPeek(code)
          else store.apply(filtersOf(target.url))
        },
        { signal: lifetime },
      )
      // Reading the summary while the pointer or focus reaches a bar makes the peek open complete.
      const prefetch = (event: Event) => {
        const code =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('.hos-tape-bar[data-peek]')?.dataset.peek
            : null
        if (code) store.prefetch(code)
      }
      root.addEventListener('pointerover', prefetch, { passive: true, signal: lifetime })
      root.addEventListener('focusin', prefetch, { signal: lifetime })
      lifetime.addEventListener('abort', () => {
        if (frameId) cancelAnimationFrame(frameId)
        resized?.disconnect()
      })
      store.jump({ night: store.seen.peek().from })
      void load()
    },
  }
}

// The peek: what the desk needs to decide about one reservation without leaving the plan. Its commands lead
// to the steps that do the work, on the reservation's or the folio's page.
export const roomPlanPeek = (props: RoomPlanProps) => {
  const store = storeOf(props)
  const { links, timezone, businessDate, may } = props
  const locale = props.lang === 'en' ? 'en-GB' : 'vi-VN'
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: timezone, ...options })
  const dayOf = format({ weekday: 'short', day: '2-digit', month: '2-digit' })
  const timeOf = format({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const when = (instant: string) => `${dayOf.format(new Date(instant))} · ${timeOf.format(new Date(instant))}`
  const money = (value: string, currency: string) => FormattedMoney({ value, currency, locale })
  type Tone = 'neutral' | 'info' | 'warning'
  const stateOf = (value: PeekValue): { label: string; tone: Tone; kind: string } => {
    const arrives = dateKey.format(new Date(value.checkIn)) === businessDate
    const departs = dateKey.format(new Date(value.checkOut)) === businessDate
    if (value.state === 'checked_out')
      return { label: say(props, 'peek.past'), tone: 'neutral', kind: 'past' }
    if (value.state === 'checked_in')
      return departs
        ? { label: say(props, 'peek.departing'), tone: 'warning', kind: 'departing' }
        : { label: say(props, 'peek.inHouse'), tone: 'info', kind: 'in-house' }
    return arrives
      ? { label: say(props, 'peek.arriving'), tone: 'info', kind: 'arriving' }
      : { label: say(props, 'peek.booked'), tone: 'neutral', kind: 'booked' }
  }
  const guestsOf = (value: PeekValue) =>
    [
      value.adults ? say(props, 'peek.adults', { count: value.adults }) : '',
      value.children ? say(props, 'peek.children', { count: value.children }) : '',
    ]
      .filter(Boolean)
      .join(' · ')
  // The reservation or its folio, or one of their steps (`dialog`), on the record's own page.
  const pageHref = (template: string, id: string, dialog?: string) => {
    const url = new URL(template.replace('{id}', encodeURIComponent(id)), 'http://plan.invalid')
    if (dialog) url.searchParams.set('dialog', dialog)
    // Back from the record returns to this plan, peek and nights; the server render and the browser agree on it.
    url.searchParams.set('returnTo', store.at())
    return `${url.pathname}${url.search}`
  }
  // Money is taken where it belongs: a guarantee on the reservation before the guest is in, and what the
  // folio still owes on the folio. A stay with neither to take offers no money command.
  const commands = (kind: string, value: PeekValue) => {
    const link = (label: string, href: string, variant: 'primary' | 'secondary' = 'secondary') =>
      LinkButton({ label, href, variant })
    const owing =
      may.payment && links.folio && value.folio?.known && Number(value.folio.due ?? 0) > 0
        ? link(say(props, 'peek.collect'), pageHref(links.folio, value.folio.id, 'payment'))
        : null
    const guarantee =
      value.guarantee.kind === 'none' &&
      ((kind === 'booked' && may.deposit) || (kind === 'arriving' && may.guarantee))
        ? link(
            say(props, kind === 'booked' ? 'peek.deposit' : 'peek.guarantee'),
            pageHref(links.reservation, value.id, kind === 'booked' ? 'deposit' : 'guarantee'),
          )
        : null
    if (kind === 'arriving')
      return [
        may.checkIn
          ? link(say(props, 'peek.checkIn'), pageHref(links.reservation, value.id, 'checkIn'), 'primary')
          : null,
        guarantee ?? owing,
      ].filter(Boolean)
    if (kind === 'booked')
      return [
        may.amend ? link(say(props, 'peek.amend'), pageHref(links.reservation, value.id, 'amend')) : null,
        guarantee,
      ].filter(Boolean)
    if (kind === 'departing')
      return [
        may.checkout
          ? link(say(props, 'peek.checkout'), pageHref(links.reservation, value.id, 'checkout'), 'primary')
          : null,
        owing,
      ].filter(Boolean)
    if (kind === 'in-house')
      return [
        may.move ? link(say(props, 'peek.move'), pageHref(links.reservation, value.id, 'move')) : null,
        owing,
      ].filter(Boolean)
    return []
  }
  const summaryOf = (value: PeekValue) => {
    const due = !value.folio
      ? say(props, 'peek.noFolio')
      : !props.dueSource
        ? say(props, 'peek.dueHidden')
        : !value.folio.known
          ? say(props, 'peek.dueUnknown')
          : money(value.folio.due ?? '0', value.currency)
    const notes = [
      ...(value.arrival.expectedTime
        ? [{ id: 'eta', label: say(props, 'peek.eta'), value: value.arrival.expectedTime }]
        : []),
      ...(value.arrival.early
        ? [{ id: 'early', label: say(props, 'peek.request'), value: say(props, 'peek.early') }]
        : []),
      ...(value.arrival.note
        ? [{ id: 'note', label: say(props, 'peek.arrivalNote'), value: value.arrival.note }]
        : []),
      ...(value.benefits.tier
        ? [
            {
              id: 'loyalty',
              label: say(props, 'peek.loyalty'),
              value: [value.benefits.tier, value.benefits.program].filter(Boolean).join(' · '),
            },
          ]
        : []),
    ]
    return Stack({
      items: [
        DescriptionList({
          label: say(props, 'peek.stay'),
          columns: 2,
          items: [
            { id: 'arrival', label: say(props, 'peek.checkInAt'), value: when(value.checkIn) },
            { id: 'departure', label: say(props, 'peek.checkOutAt'), value: when(value.checkOut) },
            {
              id: 'nights',
              label: say(props, 'peek.nights'),
              value: say(props, 'nights', { count: value.nights }),
            },
            { id: 'guests', label: say(props, 'peek.guests'), value: guestsOf(value) || '—' },
          ],
        }),
        DescriptionList({
          label: say(props, 'peek.room'),
          columns: 2,
          items: [
            {
              id: 'room',
              label: say(props, 'peek.room'),
              value: value.room?.code ?? say(props, 'peek.unassigned'),
            },
            { id: 'type', label: say(props, 'peek.roomType'), value: value.roomType?.name ?? '—' },
          ],
        }),
        DescriptionList({
          label: say(props, 'peek.payment'),
          columns: 2,
          items: [
            { id: 'total', label: say(props, 'peek.total'), value: money(value.amountTotal, value.currency) },
            { id: 'due', label: say(props, 'peek.due'), value: due },
            {
              id: 'guarantee',
              label: say(props, 'peek.guaranteeLabel'),
              value: say(props, `guarantee.${value.guarantee.kind}`),
            },
            {
              id: 'source',
              label: say(props, 'peek.source'),
              value: props.words[`provider.${value.source}`] ?? value.source,
            },
          ],
        }),
        ...(notes.length
          ? [DescriptionList({ label: say(props, 'peek.notes'), columns: 1, items: notes })]
          : []),
      ],
    })
  }

  const view = (): TemplateResult => {
    const code = store.peek()
    if (!code) return html``
    const current = store.summary()
    const known = store.prepared()?.byCode.get(code)
    const state = current?.code === code ? current.state : 'loading'
    const value = current?.code === code && current.state === 'ready' ? current.value : null
    const status = value ? stateOf(value) : null
    const booked = value ? value.state === 'confirmed' : known ? known.stay.kind === 'booked' : true
    const order = store.sameArrival(code)
    const index = order.indexOf(code)
    const step = (other: string | undefined, label: string) => ({
      label,
      href: other ? store.peekHref(other) : null,
    })
    const steps =
      index >= 0 && order.length > 1
        ? {
            previous: step(order[index - 1], say(props, 'peek.previous')),
            next: step(order[index + 1], say(props, 'peek.next')),
          }
        : {}
    const body =
      state === 'error'
        ? Notice({
            title: say(props, 'peek.failedTitle'),
            message: say(props, 'peek.failedMessage'),
            tone: 'danger',
            actions: Button({
              id: `${ROOM_PLAN_PEEK_ID}-retry`,
              label: say(props, 'retry'),
              variant: 'secondary',
            }),
          })
        : state === 'missing'
          ? Notice({
              title: say(props, 'peek.missingTitle'),
              message: say(props, 'peek.missingMessage'),
              tone: 'info',
            })
          : value
            ? summaryOf(value)
            : ''
    const items = value && status ? commands(status.kind, value) : []
    return Peek({
      id: ROOM_PLAN_PEEK_ID,
      eyebrow: value?.code ?? null,
      title: value?.guest.name || known?.stay.guest || say(props, 'peek.title'),
      status:
        value && status
          ? Inline({
              items: [
                Badge({ label: status.label, tone: status.tone }),
                ...(value.guarantee.kind === 'none'
                  ? [Badge({ label: say(props, 'guarantee.none'), tone: 'warning' })]
                  : []),
                ...(value.benefits.vip ? [Badge({ label: say(props, 'peek.vip'), tone: 'info' })] : []),
              ],
            })
          : undefined,
      body,
      actions: items.length ? ActionGroup({ actions: items, label: say(props, 'peek.actions') }) : undefined,
      record: {
        label: say(props, booked ? 'peek.openReservation' : 'peek.openStay'),
        href: pageHref(links.reservation, code),
      },
      closeLabel: say(props, 'peek.close'),
      closeHref: store.at({ peek: null }),
      ...steps,
      loading: state === 'loading' ? { label: say(props, 'peek.loading') } : null,
    })
  }

  return {
    view,
    mount: ({ root, lifetime }: IslandMountContext) => {
      if (!(root instanceof HTMLElement)) return
      hold(props, store, lifetime)
      const layout = root.closest<HTMLElement>('[data-ui="peek-layout"]')
      if (layout) lifetime.addEventListener('abort', attachPeekInteractions(layout))
      root.addEventListener(
        'click',
        (event) => {
          if (event.target instanceof Element && event.target.closest(`#${ROOM_PLAN_PEEK_ID}-retry`)) {
            store.retryPeek()
            return
          }
          const target = planLink(event, props)
          if (!target) return
          const { link, url } = target
          if (link.id === `${ROOM_PLAN_PEEK_ID}-close`) {
            event.preventDefault()
            store.closePeek()
          } else if (link.closest('[data-ui="peek-tools"]') && url.searchParams.get('peek')) {
            event.preventDefault()
            store.openPeek(url.searchParams.get('peek')!)
          }
        },
        { signal: lifetime },
      )
    },
  }
}
