import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import * as billingScreens from '../packages/ketsuite/src/modules/hospitality_billing/screens/index.ts'
import { ListScreenFrame as BillingListFrame } from '../packages/ketsuite/src/modules/hospitality_billing/screens/page-frame.tsx'
import { islands } from '../packages/ketsuite/src/modules/hospitality_core/islands.ts'
import { islands as billingIslands } from '../packages/ketsuite/src/modules/hospitality_billing/islands.ts'
import { billingBookNext } from '../packages/ketsuite/src/modules/hospitality_billing/collections/billing-book.tsx'
import { billingBookQuery } from '../packages/ketsuite/src/modules/hospitality_billing/billing-book-query.ts'
import { chargeRuleModalDefinition } from '../packages/ketsuite/src/modules/hospitality_billing/screens/charge-rule-modal.tsx'
import type { ChargeRuleModalData } from '../packages/ketsuite/src/modules/hospitality_billing/screens/charge-rule-modal.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import * as coreScreens from '../packages/ketsuite/src/modules/hospitality_core/screens/index.ts'
import { propertiesScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/properties.tsx'
import { roomTypesScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/room-types.tsx'
import { roomsScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/rooms.tsx'
import {
  FormScreenFrame as CoreFormFrame,
  ListScreenFrame as CoreListFrame,
} from '../packages/ketsuite/src/modules/hospitality_core/screens/page-frame.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('Hospitality exports one focused module for every routed renderer', () => {
  const routedScreens = (screens: Record<string, unknown>) =>
    Object.keys(screens).filter((name) => /^[a-z].*Screen$/.test(name))
  // 33 since the reservation book got its island page beside the reservation
  // screen that still owns the native create modal; 34 with the in-house list's, 35 with the folio register's.
  assert.equal(routedScreens(coreScreens).length, 35)
  // 3 with the billing book's island page beside the old billing and charge rule screens.
  assert.equal(routedScreens(billingScreens).length, 3)
})

test('Hospitality collection and form adapters use public page contracts', () => {
  const props = { translator: translate, title: 'Hospitality', frame: {}, body: <p>Body</p> }
  assert.match(renderToString(CoreListFrame(props)), /data-ui="list-page"/)
  assert.match(renderToString(CoreFormFrame(props)), /data-ui="form-page"/)
  assert.match(renderToString(BillingListFrame(props)), /data-ui="list-page"/)
})

test('Hospitality folio renders its financial workspace and native dialog only once', () => {
  const folio = {
    id: 'folio',
    code: 'F-001',
    propertyId: 'property',
    partnerId: 'guest',
    state: 'open',
    amountTotal: '0',
    version: 1,
    openedAt: '2026-10-13T07:00:00Z',
    charges: [],
    stays: [],
  }
  const financial = (
    <section id="financial-workspace">
      <form id="financial-command">
        <input id="financial-amount" name="amount" />
      </form>
    </section>
  )
  const html = renderToString(
    coreScreens.folioDetailScreen(
      translate,
      folio,
      'en',
      'Asia/Ho_Chi_Minh',
      {},
      'charge-id',
      null,
      [],
      financial,
    ),
  )
  for (const id of ['financial-workspace', 'financial-command', 'financial-amount'])
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `${id} must have one owner`)
})

test('Hospitality billing blockers link directly to their repair surfaces and suppress invoice actions', () => {
  const html = renderToString(
    billingScreens.billingScreen(
      translate,
      [
        {
          folioId: 'folio-1',
          folioCode: 'FOL-001',
          guest: null,
          closedAt: null,
          folioState: 'open',
          folioTotal: '0',
          chargeCount: 0,
          missingRules: [],
          blockers: [
            {
              code: 'folio_open',
              repairHref: '/admin/hospitality/stays/stay-1',
            },
            {
              code: 'folio_without_charges',
              repairHref: '/admin/hospitality/folios/folio-1',
            },
            {
              code: 'journal_missing',
              repairHref: '/admin/accounting/journals/new',
            },
            {
              code: 'folio_without_guest',
              repairHref: '/admin/hospitality/reservations/reservation-1',
            },
          ],
          moveId: null,
          moveName: null,
          amountTotal: null,
          amountDue: null,
          paymentState: null,
        },
      ],
      {},
    ),
  )

  assert.match(html, /hospitality_billing\.blocker\.folio_open/)
  assert.match(html, /href="\/admin\/hospitality\/stays\/stay-1"/)
  assert.match(html, /href="\/admin\/hospitality\/folios\/folio-1"/)
  assert.match(html, /href="\/admin\/accounting\/journals\/new"/)
  assert.match(html, /href="\/admin\/hospitality\/reservations\/reservation-1"/)
  assert.match(html, /data-col="folioCode"[\s\S]*data-col="state"[\s\S]*data-col="guest"/)
  assert.doesNotMatch(html, /hospitality_billing\.action\.invoice(?:All)?</)
})

test('Hospitality services show one useful prerequisite state instead of duplicate empty cards', () => {
  const html = renderToString(
    coreScreens.servicesScreen(
      translate,
      {
        properties: [{ id: 'hotel', name: 'Hotel' }],
        propertyId: 'hotel',
        products: [],
        targets: [],
        propertyCharges: [],
        extraLines: [],
        charges: [],
        ids: { propertyCharge: 'fee-1', extraLine: 'extra-1', requestKey: 'request-1' },
      },
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
    ),
  )

  assert.match(html, /hospitality_core\.services\.empty\.catalogue/)
  assert.doesNotMatch(html, /hospitality_core\.services\.empty\.intentions/)
})

test('Hospitality manual folio form cannot bypass stock fulfilment for minibar', () => {
  const html = renderToString(
    coreScreens.folioDetailScreen(
      translate,
      {
        id: 'folio-1',
        code: 'FOL-001',
        propertyId: 'hotel',
        partnerId: 'guest',
        state: 'open',
        amountTotal: '0',
        version: 0,
        openedAt: '2026-09-02T00:00:00.000Z',
        partner: { name: 'Synthetic Guest' },
        stays: [],
        charges: [],
      },
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      'charge-1',
    ),
  )

  assert.match(html, /value="spa"/)
  assert.doesNotMatch(html, /value="minibar"/)
})

test('Hospitality primary create actions stay in the ListPage title row', () => {
  const properties = renderToString(
    propertiesScreen(translate, [], { rooms: 0, available: 0, attention: 0 }, 'vi', {}),
  )
  const property = {
    id: 'hotel',
    code: 'HOTEL',
    name: 'Hotel',
    accommodationType: 'hotel',
    starRating: 4,
    active: true,
    rooms: 1,
    availableRooms: 1,
    attentionRooms: 0,
  }
  const rooms = renderToString(
    roomsScreen(
      translate,
      {
        rows: [],
        properties: [property],
        propertyId: 'hotel',
        roomTypes: [
          {
            id: 'type',
            code: 'TYPE',
            name: 'Type',
            defaultCapacity: 2,
            baseRate: 100,
            published: true,
            active: true,
          },
        ],
        buildings: [],
        floors: [],
      },
      'vi',
      {},
    ),
  )
  const roomTypes = renderToString(roomTypesScreen(translate, [], [property], 'hotel', 'vi', {}))

  assert.match(
    properties,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/hospitality\/properties\/new\?lang=vi"/,
  )
  assert.match(
    rooms,
    /data-ui="list-page-actions"[\s\S]*?href="\/admin\/hospitality\/rooms\/new\?lang=vi&amp;property=hotel"/,
  )
  assert.match(
    roomTypes,
    /data-ui="list-page-actions"[\s\S]*?href="\/admin\/hospitality\/room-types\/new\?lang=vi&amp;property=hotel"/,
  )
  assert.doesNotMatch(
    properties,
    /data-ui="list-page-body"[\s\S]*?href="\/admin\/hospitality\/properties\/new\?lang=vi"/,
  )
})

test('Hospitality split collections keep context mounted under URL-owned create modals', () => {
  const modal = {
    open: true,
    createHref: '/collection?lang=vi&create=1',
    closeHref: '/collection?lang=vi',
    action: '/collection?lang=vi&create=1',
  }
  const reservationData = {
    rows: [],
    properties: [{ id: 'hotel', name: 'Hotel' }],
    roomTypes: [{ id: 'deluxe', name: 'Deluxe' }],
    partners: [{ id: 'guest', name: 'Guest' }],
    values: {
      id: 'reservation',
      code: 'RES-001',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: '2026-08-27T14:00',
      checkOut: '2026-08-28T12:00',
      adults: 1,
      children: 0,
      rate: '',
    },
  }
  const room = {
    id: '101',
    code: '101',
    name: 'Room 101',
    status: 'available',
  }
  const collectionPairs = [
    [
      coreScreens.reservationsScreen(translate, reservationData, 'vi', 'Asia/Ho_Chi_Minh', {}),
      coreScreens.reservationsScreen(translate, reservationData, 'vi', 'Asia/Ho_Chi_Minh', {}, null, modal),
      'hospitality-reservation-create',
    ],
    [
      coreScreens.ratePlansScreen(translate, [], [], [{ id: 'deluxe', name: 'Deluxe' }], 'hotel', {}),
      coreScreens.ratePlansScreen(
        translate,
        [],
        [],
        [{ id: 'deluxe', name: 'Deluxe' }],
        'hotel',
        {},
        null,
        modal,
      ),
      'hospitality-rate-plan-create',
    ],
    [
      coreScreens.cleaningTasksScreen(
        translate,
        {
          rows: [],
          properties: [],
          propertyId: 'hotel',
          state: 'all',
          rooms: [room] as never,
          summary: { todo: 0, inProgress: 0, done: 0, cancelled: 0 },
          id: 'task',
          code: 'HK-001',
        },
        'vi',
        'Asia/Ho_Chi_Minh',
        {},
      ),
      coreScreens.cleaningTasksScreen(
        translate,
        {
          rows: [],
          properties: [],
          propertyId: 'hotel',
          state: 'all',
          rooms: [room] as never,
          summary: { todo: 0, inProgress: 0, done: 0, cancelled: 0 },
          id: 'task',
          code: 'HK-001',
        },
        'vi',
        'Asia/Ho_Chi_Minh',
        {},
        null,
        modal,
      ),
      'hospitality-cleaning-task-create',
    ],
    [
      coreScreens.amenitiesScreen(translate, [], [], {}),
      coreScreens.amenitiesScreen(translate, [], [], {}, null, modal),
      'hospitality-amenity-create',
    ],
    [
      coreScreens.policiesScreen(translate, [], {}),
      coreScreens.policiesScreen(translate, [], {}, null, modal),
      'hospitality-policy-create',
    ],
  ] as const

  for (const [closed, open, id] of collectionPairs) {
    const closedHtml = renderToString(closed)
    const openHtml = renderToString(open)
    assert.match(closedHtml, /data-ui="list-page"/)
    assert.match(closedHtml, /href="[^"]*create=1"/)
    assert.doesNotMatch(closedHtml, /data-route-modal="true"/)
    assert.match(openHtml, /data-ui="list-page"/)
    assert.match(openHtml, /data-route-modal="true"/)
    assert.match(openHtml, new RegExp(`aria-labelledby="${id}-title"`))
    assert.match(openHtml, /href="\/collection\?lang=vi"/)
  }

  const billingModal = {
    ...modal,
    rowHref: (row: { chargeType: string }) => `/collection?lang=vi&create=1&rule=${row.chargeType}`,
  }
  const billingClosed = renderToString(
    billingScreens.chargeRulesScreen(translate, [], [], [], [], {}, null, {
      ...billingModal,
      open: false,
    }),
  )
  const billingOpen = renderToString(
    billingScreens.chargeRulesScreen(translate, [], [], [], [], {}, null, billingModal),
  )
  assert.match(billingClosed, /href="\/collection\?lang=vi&amp;create=1"/)
  assert.doesNotMatch(billingClosed, /data-route-modal="true"/)
  assert.match(billingOpen, /data-route-modal="true"/)
  assert.match(billingOpen, /aria-labelledby="hospitality-charge-rule-save-title"/)
})

test('Hospitality focused roles render only actions present in their exact allow-list', () => {
  const housekeepingQueue = renderToString(
    coreScreens.cleaningTasksScreen(
      translate,
      {
        rows: [],
        properties: [],
        propertyId: 'hotel',
        state: 'all',
        rooms: [{ id: '101', code: '101', name: 'Room 101', status: 'available' }] as never,
        summary: { todo: 0, inProgress: 0, done: 0, cancelled: 0 },
        id: 'task',
        code: 'HK-001',
      },
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      null,
      undefined,
      false,
    ),
  )
  assert.doesNotMatch(housekeepingQueue, /href="[^"]*create=1"/)

  const housekeeping = renderToString(
    coreScreens.cleaningTaskDetailScreen(
      translate,
      {
        id: 'task-1',
        code: 'HK-001',
        propertyId: 'hotel',
        roomId: '101',
        taskType: 'daily_clean',
        priority: 'normal',
        state: 'todo',
        requestedAt: '2026-09-03T00:00:00.000Z',
        room: { id: '101', code: '101', name: 'Room 101' },
      } as never,
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      null,
      [],
      { start: true, complete: true, cancel: false },
    ),
  )
  assert.match(housekeeping, /hospitality_core\.housekeeping\.action\.start</)
  assert.doesNotMatch(housekeeping, /hospitality_core\.housekeeping\.action\.cancel</)

  const reservation = renderToString(
    coreScreens.reservationDetailScreen(
      translate,
      {
        id: 'reservation-1',
        code: 'RES-001',
        propertyId: 'hotel',
        partnerId: 'guest',
        roomTypeId: 'deluxe',
        provider: 'direct',
        state: 'confirmed',
        checkIn: '2026-09-03T07:00:00.000Z',
        checkOut: '2026-09-04T05:00:00.000Z',
        adults: 1,
        children: 0,
        rate: 100,
      } as never,
      [],
      [{ id: 'deluxe', name: 'Deluxe' }],
      [{ id: 'guest', name: 'Guest' }],
      {
        partnerId: 'guest',
        roomTypeId: 'deluxe',
        checkIn: '2026-09-03T14:00',
        checkOut: '2026-09-04T12:00',
        adults: 1,
        children: 0,
        rate: '100',
      },
      '2026-09-04T12:00',
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      null,
      [],
      {
        amend: true,
        checkIn: false,
        holdRoom: false,
        adjustDeparture: false,
        checkOut: false,
        cancel: false,
        noShow: false,
      },
    ),
  )
  assert.match(reservation, /hospitality_core\.reservation\.action\.amend</)
  assert.doesNotMatch(
    reservation,
    /hospitality_core\.reservation\.action\.(?:cancel|checkIn|noShow|holdRoom)</,
  )
})

test('the front desk offers the shift its work and a read-only viewer only the record', () => {
  const stay = (id: string, state: string, checkOut: string) => ({
    id,
    code: id.toUpperCase(),
    folioId: `${id}:folio`,
    propertyId: 'hotel',
    reservationId: `${id}:reservation`,
    partnerId: 'guest',
    roomTypeId: 'deluxe',
    bookingType: 'nightly',
    checkIn: '2026-09-05T07:00:00.000Z',
    checkOut,
    adults: 2,
    children: 1,
    billingMode: 'upfront',
    rate: '100',
    state,
    partner: { name: 'Nguyễn An' },
    roomType: { name: 'Deluxe' },
  })
  const today = {
    day: '2026-09-05',
    arrivals: [stay('arriving', 'draft', '2026-09-07T05:00:00.000Z')],
    departures: [stay('leaving', 'checked_in', '2026-09-05T05:00:00.000Z')],
    overdue: [],
    inHouse: [stay('leaving', 'checked_in', '2026-09-05T05:00:00.000Z')],
  }
  const render = (may: { checkIn: boolean; checkOut: boolean }) =>
    renderToString(coreScreens.frontDeskScreen(translate, today, may, 'vi', 'Asia/Ho_Chi_Minh', {} as never))

  const desk = render({ checkIn: true, checkOut: true })
  assert.match(desk, /hospitality_core\.reservation\.action\.checkIn/)
  assert.match(desk, /hospitality_core\.reservation\.action\.checkOut/)
  assert.match(desk, /hospitality_core\.col\.action/)
  // The action is a link to where the work is done, not a form on this screen.
  assert.match(desk, /\/admin\/hospitality\/reservations\/arriving%3Areservation/)

  const auditor = render({ checkIn: false, checkOut: false })
  assert.doesNotMatch(auditor, /hospitality_core\.reservation\.action\.checkIn/)
  assert.doesNotMatch(auditor, /hospitality_core\.reservation\.action\.checkOut/)
  assert.doesNotMatch(auditor, /hospitality_core\.col\.action/)
  // They still read the shift: both queues, both records.
  assert.match(auditor, /hospitality_core\.screen\.frontDesk\.arrivals/)
  assert.match(auditor, /hospitality_core\.screen\.frontDesk\.departures/)
  assert.match(auditor, /ARRIVING/)
  assert.match(auditor, /LEAVING/)

  // One permission at a time: a viewer who may check a guest out but not in
  // sees exactly one of the two columns.
  const departuresOnly = render({ checkIn: false, checkOut: true })
  assert.doesNotMatch(departuresOnly, /hospitality_core\.reservation\.action\.checkIn/)
  assert.match(departuresOnly, /hospitality_core\.reservation\.action\.checkOut/)
})

test('the front desk handover names each event by its own message, never by a raw key', () => {
  const queue = { rows: [], total: 0, guests: 0, page: 1, pages: 1 }
  const event = (id: string, action: string) => ({
    id,
    action,
    occurredAt: '2026-09-05T03:00:00.000Z',
    actorName: 'Lễ tân',
    code: id.toUpperCase(),
  })
  const today = {
    day: '2026-09-05',
    arrivals: [],
    departures: [],
    overdue: [],
    inHouse: [],
    queues: {
      configured: true,
      propertyId: 'hotel',
      timezone: 'Asia/Ho_Chi_Minh',
      day: '2026-09-05',
      arrivals: queue,
      departures: queue,
      overdue: queue,
      inHouse: queue,
      activity: {
        total: 3,
        rows: [event('a', 'checkIn'), event('b', 'room-cleaned'), event('c', 'unheard')],
      },
    },
  }
  const html = renderToString(
    coreScreens.frontDeskScreen(
      translate,
      today,
      { checkIn: false, checkOut: false },
      'vi',
      'Asia/Ho_Chi_Minh',
      {} as never,
    ),
  )
  assert.match(html, /hospitality_core\.screen\.frontDesk\.event\.checkIn/)
  assert.match(html, /hospitality_core\.screen\.frontDesk\.event\.room-cleaned/)
  // An action the desk has no words for reads as a general update, not as its key.
  assert.match(html, /hospitality_core\.screen\.frontDesk\.event\.other/)
  assert.doesNotMatch(html, /event\.unheard/)
})

test('the room plan renders only its frame and leaves rooms, stays and money to its islands', () => {
  const plan = {
    property: { id: 'hotel', name: 'Hotel', timezone: 'Asia/Ho_Chi_Minh', businessDate: '2026-09-04' },
    properties: [
      { id: 'hotel', name: 'Hotel' },
      { id: 'resort', name: 'Resort' },
    ],
    types: [{ id: 'deluxe', code: 'DLX', name: 'Deluxe' }],
    floors: [{ id: 'floor-2', name: 'Tầng 2' }],
  }
  const may = {
    book: true,
    walkIn: true,
    checkIn: true,
    checkout: true,
    move: true,
    amend: true,
    deposit: true,
    guarantee: true,
    payment: true,
    folio: true,
    room: true,
    balance: true,
  }
  const render = (search: string, allowed = may) =>
    renderToString(
      coreScreens.roomPlanScreen(
        translate,
        {
          url: new URL(`https://suite.test/admin/hospitality/tape-chart?company=c1&${search}`),
          locale: 'vi',
          plan,
          may: allowed,
        },
        {} as never,
      ),
    )
  const propsOf = (markup: string) =>
    JSON.parse(
      markup
        .match(/data-props="([^"]+)"/)![1]!
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&'),
    )
  const page = render('peek=booking-1&type=deluxe&days=7&from=-3')
  const props = propsOf(page)
  // Three islands of one plan, each one the browser can hydrate; the server sends the frame, never the rooms or stays.
  const rendered = [...page.matchAll(/data-island="(hospitality\.room-plan[^"]*)"/g)].map((match) => match[1])
  assert.deepEqual(rendered.sort(), [
    'hospitality.room-plan-controls',
    'hospitality.room-plan-grid',
    'hospitality.room-plan-peek',
  ])
  for (const name of rendered) assert.ok(name in islands, `${name} must be a registered island`)
  assert.equal(props.source, '/_ket/fn/hospitality_core.getTapeChart?company=c1')
  assert.equal(props.peekSource, '/_ket/fn/hospitality_core.getRoomPlanPeek?company=c1')
  assert.equal(props.dueSource, '/_ket/fn/hospitality_billing.getFolioDue?company=c1')
  assert.equal(props.nights.length, 42)
  assert.deepEqual(props.nights[14], {
    night: 0,
    weekday: 'T6',
    short: '04/09',
    long: '04/09/2026',
    weekend: false,
    saturday: false,
  })
  assert.equal(props.request.from, '2026-08-20T17:00:00.000Z')
  assert.equal(props.request.to, '2026-10-01T17:00:00.000Z')
  assert.deepEqual(props.query, {
    from: -3,
    days: 7,
    floor: null,
    type: 'deluxe',
    view: 'all',
    q: '',
    peek: 'booking-1',
  })
  assert.equal(props.links.reservation, '/admin/hospitality/reservations/{id}?company=c1')
  assert.equal(props.properties[1].href, '/admin/hospitality/tape-chart?company=c1&property=resort')
  assert.equal('rooms' in props || 'events' in props, false)
  assert.match(page, /tape-new-booking/)
  assert.match(page, /walkIn=1/)
  assert.match(page, /hospitality_core\.roomPlan\.legend\.booked/)

  // Looking at the plan is not permission to book, take money or see it.
  const reader = render('', {
    ...may,
    book: false,
    walkIn: false,
    payment: false,
    balance: false,
    deposit: false,
  })
  const readerProps = propsOf(reader)
  assert.doesNotMatch(reader, /tape-new-booking|walkIn=1/)
  assert.equal(readerProps.dueSource, null)
  assert.equal(readerProps.may.payment, false)
  assert.equal(readerProps.may.deposit, false)

  // A company without a property it may plan gets a start state, not an empty grid.
  const none = renderToString(
    coreScreens.roomPlanScreen(
      translate,
      {
        url: new URL('https://suite.test/admin/hospitality/tape-chart'),
        locale: 'vi',
        plan: { ...plan, property: null, properties: [] },
        may,
      },
      {} as never,
    ),
  )
  assert.match(none, /hospitality_core\.roomPlan\.noPropertyTitle/)
  assert.doesNotMatch(none, /room-plan-controls/)
})

test('the reservation book renders only its frame and leaves bookings, counts and pages to its islands', () => {
  const properties = [
    { id: 'hotel', name: 'Hotel', businessDate: '2026-09-04' },
    { id: 'resort', name: 'Resort', businessDate: '2026-09-03' },
  ]
  const render = (search: string, may = { book: true, walkIn: true }, allowed = true) =>
    renderToString(
      coreScreens.reservationBookScreen(
        translate,
        {
          url: new URL(`https://suite.test/admin/hospitality/reservations?company=c1&lang=vi&${search}`),
          locale: 'vi',
          allowed,
          properties,
          may,
        },
        {} as never,
      ),
    )
  const propsOf = (markup: string) =>
    JSON.parse(
      markup
        .match(/data-props="([^"]+)"/)![1]!
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&'),
    )
  const page = render('property=resort&status=in-house&q=101&page=2')
  // Three islands of one book, each one the browser can hydrate; the server sends the frame, never the bookings.
  const rendered = [...page.matchAll(/data-island="(hospitality\.[^"]*)"/g)].map((match) => match[1]!)
  assert.deepEqual(rendered.sort(), [
    'hospitality.reservations-controls',
    'hospitality.reservations-footer',
    'hospitality.reservations-results',
  ])
  for (const name of rendered) assert.ok(name in islands, `${name} must be a registered island`)
  const props = propsOf(page)
  assert.equal(props.source, '/_ket/fn/hospitality_core.searchReservations?company=c1&lang=vi')
  // The URL is the query: an old status link lands, and the resort's own today opens its window.
  assert.deepEqual(props.query, {
    propertyId: 'resort',
    from: '2026-09-03',
    days: 14,
    status: 'in_house',
    source: null,
    view: 'all',
    q: '101',
    sort: 'relevance',
    page: 2,
    pageSize: 25,
  })
  assert.equal('rows' in props || 'counts' in props || 'total' in props, false)
  assert.equal(props.createHref, '/admin/hospitality/reservations/new?company=c1&lang=vi&propertyId=resort')
  assert.match(page, /id="hospitality-reservations-create"/)
  assert.match(page, /walkIn=1&amp;propertyId=resort/)
  assert.match(page, /hospitality_core\.reservationBook\.searchPlaceholder/)
  assert.doesNotMatch(page, /hospitality\.collection-(controls|results|footer)/)

  // A reader without the book, or a company without a property, still gets the page and its frame.
  const empty = renderToString(
    coreScreens.reservationBookScreen(
      translate,
      {
        url: new URL('https://suite.test/admin/hospitality/reservations?from=2026-09-01'),
        locale: 'en',
        allowed: false,
        properties: [],
        may: { book: false, walkIn: false },
      },
      {} as never,
    ),
  )
  assert.equal(propsOf(empty).query.from, '2026-09-01')
  const nowhere = renderToString(
    coreScreens.reservationBookScreen(
      translate,
      {
        url: new URL('https://suite.test/admin/hospitality/reservations'),
        locale: 'en',
        allowed: false,
        properties: [],
        may: { book: false, walkIn: false },
      },
      {} as never,
    ),
  )
  assert.equal(propsOf(nowhere).query.from, null)
  assert.match(nowhere, /data-island="hospitality\.reservations-controls"/)

  // Reading the book is not permission to book or to take a walk-in.
  const reader = render('', { book: false, walkIn: false })
  assert.doesNotMatch(reader, /hospitality-reservations-create|walkIn=1/)
  assert.equal(propsOf(reader).createHref, null)
  assert.equal(propsOf(render('', { book: false, walkIn: false }, false)).allowed, false)
})

test('the in-house list renders only its frame and reads its rows, and their dues, in the browser', () => {
  const properties = [
    { id: 'hotel', name: 'Hotel', businessDate: '2026-09-04' },
    { id: 'resort', name: 'Resort', businessDate: '2026-09-03' },
  ]
  const render = (search: string, may = { dues: true, arrivals: true, walkIn: true }, allowed = true) =>
    renderToString(
      coreScreens.stayBookScreen(
        translate,
        {
          url: new URL(`https://suite.test/admin/hospitality/stays?company=c1&lang=vi&${search}`),
          locale: 'vi',
          allowed,
          properties,
          may,
        },
        {} as never,
      ),
    )
  const propsOf = (markup: string) =>
    JSON.parse(
      markup
        .match(/data-props="([^"]+)"/)![1]!
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&'),
    )
  const page = render('property=resort&view=owing&sort=-balance&q=101&page=2')
  // Three islands of one list, each one the browser can hydrate; the server sends the frame, never the guests.
  const rendered = [...page.matchAll(/data-island="(hospitality\.[^"]*)"/g)].map((match) => match[1]!)
  assert.deepEqual(rendered.sort(), [
    'hospitality.stays-controls',
    'hospitality.stays-footer',
    'hospitality.stays-results',
  ])
  for (const name of rendered) assert.ok(name in islands, `${name} must be a registered island`)
  const props = propsOf(page)
  assert.equal(props.source, '/_ket/fn/hospitality_core.searchStays?company=c1&lang=vi')
  assert.equal(props.dueSource, '/_ket/fn/hospitality_billing.getStayDues?company=c1&lang=vi')
  // The URL is the query: the facet and sorts the list no longer has land on the whole house by room.
  assert.deepEqual(props.query, {
    propertyId: 'resort',
    view: 'all',
    q: '101',
    sort: 'room',
    page: 2,
    pageSize: 25,
  })
  assert.equal('rows' in props || 'counts' in props || 'total' in props, false)
  // A row names its guest's tier in words, not by its id.
  assert.equal(props.words['tier.gold_elite'], 'hospitality_core.reservation.benefits.tier.gold_elite')
  assert.equal(
    props.arrivalsHref,
    '/admin/hospitality/reservations?company=c1&lang=vi&status=arriving&property=resort',
  )
  assert.match(page, /hospitality_core\.stayBook\.searchPlaceholder/)
  // A reader of billing gets the balance column; its amounts come later, row by row. (The header's text node, not
  // the words the islands carry in their props.)
  const balanceHeader = /-->hospitality_core\.stayBook\.column\.balance</
  assert.match(page, balanceHeader)
  assert.doesNotMatch(page, /hospitality\.collection-(controls|results|footer)/)

  // Reading the house is not reading what it owes, nor the reservation book.
  const desk = render('', { dues: false, arrivals: false, walkIn: false })
  assert.deepEqual([propsOf(desk).dueSource, propsOf(desk).arrivalsHref], [null, null])
  assert.doesNotMatch(desk, balanceHeader)
  // A walk-in starts at the property shown, for one who may take it.
  assert.match(
    page,
    /id="hospitality-stays-walk-in"[^>]*walkIn=1&amp;propertyId=resort|walkIn=1&amp;propertyId=resort[^>]*id="hospitality-stays-walk-in"/,
  )
  assert.doesNotMatch(desk, /hospitality-stays-walk-in/)
  assert.match(desk, /-->hospitality_core\.stayBook\.column\.departure</)
  // A reader without the list still gets the page, with its notice instead of rows.
  const denied = render('', { dues: false, arrivals: false, walkIn: false }, false)
  assert.equal(propsOf(denied).allowed, false)
  assert.match(denied, /hospitality_core\.stayBook\.denied/)
})

test('the folio register renders only its frame and reads its rows, their dues and invoices, in the browser', () => {
  const properties = [
    { id: 'hotel', name: 'Hotel' },
    { id: 'resort', name: 'Resort' },
  ]
  const render = (search: string, may = { dues: true, stays: true }, allowed = true) =>
    renderToString(
      coreScreens.folioBookScreen(
        translate,
        {
          url: new URL(`https://suite.test/admin/hospitality/folios?company=c1&lang=vi&${search}`),
          locale: 'vi',
          allowed,
          properties,
          may,
        },
        {} as never,
      ),
    )
  const propsOf = (markup: string) =>
    JSON.parse(
      markup
        .match(/data-props="([^"]+)"/)![1]!
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&'),
    )
  const page = render('property=resort&view=owing&sort=-balance&q=PC-1&page=2')
  // Three islands of one list, each one the browser can hydrate; the server sends the frame, never a folio.
  const rendered = [...page.matchAll(/data-island="(hospitality\.[^"]*)"/g)].map((match) => match[1]!)
  assert.deepEqual(rendered.sort(), [
    'hospitality.folios-controls',
    'hospitality.folios-footer',
    'hospitality.folios-results',
  ])
  for (const name of rendered) assert.ok(name in islands, `${name} must be a registered island`)
  const props = propsOf(page)
  assert.equal(props.source, '/_ket/fn/hospitality_core.searchFolios?company=c1&lang=vi')
  assert.equal(props.dueSource, '/_ket/fn/hospitality_billing.getFolioDues?company=c1&lang=vi')
  assert.equal(props.staysHref, '/admin/hospitality/stays?company=c1&lang=vi')
  // The URL is the query: the facet and sorts the register no longer has land on every folio, opened last first.
  assert.deepEqual(props.query, {
    propertyId: 'resort',
    view: 'all',
    q: 'PC-1',
    sort: '-opened',
    page: 2,
    pageSize: 25,
  })
  assert.equal('rows' in props || 'counts' in props || 'total' in props, false)
  assert.equal(props.words['view.closed'], 'hospitality_core.folioBook.view.closed')
  assert.equal(props.words.invoiceVoid, 'hospitality_core.folioBook.invoiceVoid')
  // A reader of billing gets the balance and invoice columns; their values come later, row by row.
  const moneyHeaders = [
    /-->hospitality_core\.folioBook\.column\.balance</,
    /-->hospitality_core\.folioBook\.column\.invoice</,
  ]
  for (const header of moneyHeaders) assert.match(page, header)
  assert.match(page, /-->hospitality_core\.folioBook\.column\.total</)
  assert.doesNotMatch(page, /hospitality\.collection-(controls|results|footer)/)
  // Reading the register is not reading what it owes, nor the guests in house.
  const desk = render('', { dues: false, stays: false })
  assert.deepEqual([propsOf(desk).dueSource, propsOf(desk).staysHref], [null, null])
  for (const header of moneyHeaders) assert.doesNotMatch(desk, header)
  // A reader without the register still gets the page, with its notice instead of rows.
  const denied = render('', { dues: false, stays: false }, false)
  assert.equal(propsOf(denied).allowed, false)
  assert.match(denied, /hospitality_core\.folioBook\.denied/)
})

test('the billing book renders only its frame and reads its work of a period in the browser', () => {
  const properties = [
    { id: 'hotel', name: 'Hotel' },
    { id: 'resort', name: 'Resort' },
  ]
  const render = (
    search: string,
    may = { rule: true, invoice: true, payment: true, folios: true },
    allowed = true,
  ) =>
    renderToString(
      billingScreens.billingBookScreen(
        translate,
        {
          url: new URL(`https://suite.test/admin/hospitality/billing?company=c1&lang=vi&${search}`),
          locale: 'vi',
          allowed,
          properties,
          may,
        },
        {} as never,
      ),
    )
  const propsOf = (markup: string) =>
    JSON.parse(
      markup
        .match(/data-props="([^"]+)"/)![1]!
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&'),
    )
  const page = render(
    'property=resort&period=30&view=owing&sort=-balance&q=PC-1&page=2&record=hospitality.billingRule%3Aminibar',
  )
  // Three islands of one list, each one the browser can hydrate; the server sends the frame, never a folio.
  const rendered = [...page.matchAll(/data-island="(hospitality\.[^"]*)"/g)].map((match) => match[1]!)
  assert.deepEqual(rendered.sort(), [
    'hospitality.billing-controls',
    'hospitality.billing-footer',
    'hospitality.billing-results',
  ])
  for (const name of rendered) assert.ok(name in billingIslands, `${name} must be a registered island`)
  const props = propsOf(page)
  assert.equal(props.source, '/_ket/fn/hospitality_billing.searchBilling?company=c1&lang=vi')
  assert.equal(props.path, '/admin/hospitality/billing?company=c1&lang=vi')
  assert.equal(props.foliosHref, '/admin/hospitality/folios?company=c1&lang=vi')
  assert.deepEqual(props.may, { rule: true, invoice: true, payment: true })
  // The URL is the query; the rule a row opens over the list is the record modal's, not the list's.
  assert.deepEqual(props.query, {
    propertyId: 'resort',
    period: 30,
    view: 'owing',
    q: 'PC-1',
    sort: '-balance',
    page: 2,
    pageSize: 25,
  })
  assert.equal('rows' in props || 'counts' in props || 'total' in props, false)
  assert.equal(props.words['period.90'], 'hospitality_billing.billingBook.period.90')
  assert.equal(props.words['billing.unverified'], 'hospitality_billing.billingBook.billing.unverified')
  assert.equal(props.words['next.payment'], 'hospitality_billing.billingBook.next.payment')
  for (const column of ['folio', 'state', 'total', 'invoice', 'balance', 'next'])
    assert.match(page, new RegExp(`-->hospitality_billing\\.billingBook\\.column\\.${column}<`), column)
  // The period menu offers the three periods and no "every period".
  assert.match(page, /hospitality_billing\.billingBook\.period\.30/)
  assert.doesNotMatch(page, /period=7\b/)
  assert.doesNotMatch(page, /hospitality\.collection-(controls|results|footer)/)
  // A reader who may not take the next steps or read the register gets neither.
  const reader = render('', { rule: false, invoice: false, payment: false, folios: false })
  assert.deepEqual(
    [propsOf(reader).may, propsOf(reader).foliosHref],
    [{ rule: false, invoice: false, payment: false }, null],
  )
  // A reader without billing still gets the page, with its notice instead of rows.
  const denied = render('', { rule: false, invoice: false, payment: false, folios: false }, false)
  assert.equal(propsOf(denied).allowed, false)
  assert.match(denied, /hospitality_billing\.billingBook\.denied/)
})

test('a billing row offers its next step only to a reader who may take it, with the way back to its row', () => {
  const props = (may: { rule: boolean; invoice: boolean; payment: boolean }) =>
    ({
      key: 'billing',
      id: 'hospitality-billing',
      source: '/_ket/fn/hospitality_billing.searchBilling?company=c1',
      path: '/admin/hospitality/billing?company=c1&lang=vi',
      recordPath: '/admin/hospitality/folios',
      foliosHref: null,
      lang: 'vi',
      allowed: true,
      may,
      properties: [{ id: 'hotel', name: 'Hotel' }],
      query: billingBookQuery({}, []),
      words: {},
    }) as Parameters<typeof billingBookNext>[0]
  const query = billingBookQuery({ period: 30, view: 'owing' }, [])
  const row = (next: 'rule' | 'invoice' | 'payment' | 'view', rule: string | null = null) =>
    ({
      id: 'f 1',
      code: 'PC-1',
      guest: 'An',
      property: { id: 'hotel' },
      state: 'closed',
      billing: 'owing',
      total: { amount: '100', currency: 'VND' },
      invoice: null,
      due: null,
      next,
      rule,
      closed: null,
    }) as Parameters<typeof billingBookNext>[2]
  const back = encodeURIComponent(
    '/admin/hospitality/billing?company=c1&lang=vi&period=30&view=owing#row=f%201',
  )
  const folio = (dialog = '') =>
    `/admin/hospitality/folios/f%201?company=c1${dialog}&lang=vi&returnTo=${back}`
  const all = props({ rule: true, invoice: true, payment: true })
  assert.deepEqual(billingBookNext(all, query, row('rule', 'minibar')), {
    label: 'next.rule',
    href: '/admin/hospitality/billing?company=c1&lang=vi&period=30&view=owing&record=hospitality.billingRule%3Aminibar',
  })
  assert.deepEqual(billingBookNext(all, query, row('invoice')), {
    label: 'next.invoice',
    href: folio('&dialog=invoice'),
  })
  assert.deepEqual(billingBookNext(all, query, row('payment')), {
    label: 'next.payment',
    href: folio('&dialog=payment'),
  })
  assert.deepEqual(billingBookNext(all, query, row('view')), { label: 'next.view', href: folio() })
  // A step the reader may not take opens the folio instead.
  const none = props({ rule: false, invoice: false, payment: false })
  for (const next of ['rule', 'invoice', 'payment'] as const)
    assert.deepEqual(
      billingBookNext(none, query, row(next, 'minibar')),
      { label: 'next.view', href: folio() },
      next,
    )
})

test('a billing rule asks one tax question, says whether it is set up and keeps who changed it', () => {
  // HOS-DEC-034: account, tax treatment, then the tax and where it posts, or the reason for no tax; never both.
  const context = (
    record: Record<string, unknown>,
    canSave = true,
  ): RecordModalContext<ChargeRuleModalData> => ({
    kind: 'hospitality.billingRule',
    id: String(record.chargeType),
    creating: false,
    tab: '',
    data: { record, canSave, choices: {}, chargeTypes: ['room', 'spa'], commandKey: 'key', locale: 'vi' },
    t: (key) => key,
    fieldError: () => null,
    draft: (_name, fallback = '') => fallback,
    draftChecked: (_name, _value, fallback = false) => fallback,
    outcome: () => null,
    busy: false,
    dialog: null,
    href: () => '',
    state: (_key, fallback = '') => fallback,
  })
  const view = (record: Record<string, unknown>, canSave = true) => {
    const c = context({ chargeType: 'room', version: 1, history: [], ...record }, canSave)
    return {
      body: renderToString(<>{chargeRuleModalDefinition.body?.(c)}</>),
      status: renderToString(<>{chargeRuleModalDefinition.status?.(c)}</>),
      actions: renderToString(<>{chargeRuleModalDefinition.actions?.(c)}</>),
    }
  }
  // Fields in order, by the control each label names (relation pickers are islands with no SSR `name`).
  const names = (html: string) =>
    [...html.matchAll(/<label\b[^>]*for="hospitality\.billingRule-([^"]+)"/g)].map(([, name]) => name)
  const taxed = view({ taxId: 'vat8', incomeAccountId: 'revenue' })
  assert.deepEqual(names(taxed.body), ['type', 'incomeAccountId', 'tax-mode', 'taxId', 'taxAccountId'])
  // The tax question is a select like the charge type beside it, so the field draws the same chevron.
  assert.match(
    taxed.body,
    /data-ui="field" data-kind="select"[^>]*>(?:(?!data-ui="field")[\s\S])*for="hospitality\.billingRule-tax-mode"/,
  )
  assert.match(taxed.body, /hospitality_billing\.ruleRecord\.section/)
  assert.match(taxed.status, /data-tone="positive"[^>]*>[\s\S]*collection\.state\.ready/)
  const exempt = view({ taxExempt: true, taxExemptReason: 'Bồi thường hủy phòng' })
  assert.deepEqual(names(exempt.body), ['type', 'incomeAccountId', 'tax-mode', 'reason'])
  assert.match(exempt.status, /collection\.state\.ready/)
  // An exemption without its reason, or no tax answer at all, is not set up.
  for (const record of [{ taxExempt: true, taxExemptReason: '' }, {}])
    assert.match(view(record).status, /data-tone="warning"[^>]*>[\s\S]*collection\.state\.incomplete/)
  // A rule moves money on invoices, so it keeps who created and changed it.
  const history = view({
    taxId: 'vat8',
    history: [
      {
        occurredAt: '2026-10-02T08:20:00Z',
        actorName: 'Lan',
        before: { taxId: null },
        after: { taxExempt: false },
      },
      {
        occurredAt: '2026-09-12T02:05:00Z',
        actorId: null,
        before: null,
        after: { taxExempt: true, taxExemptReason: 'X' },
      },
    ],
  }).body
  assert.match(history, /data-ui="activity-timeline"/)
  assert.match(history, /Lan[\s\S]*ruleRecord\.changed[\s\S]*ruleRecord\.system[\s\S]*ruleRecord\.created/)
  assert.doesNotMatch(view({ taxId: 'vat8' }).body, /ruleRecord\.history/)
  // Cancel closes it for everyone; only a reader who may configure saves.
  assert.match(taxed.actions, /data-record-close[\s\S]*ruleRecord\.cancel[\s\S]*ruleRecord\.save/)
  const readOnly = view({ taxId: 'vat8' }, false).actions
  assert.match(readOnly, /ruleRecord\.cancel/)
  assert.doesNotMatch(readOnly, /ruleRecord\.save/)
})

test('a reservation row says how long the stay is, in the unit it is sold by', () => {
  const row = (bookingType: string, checkIn: string, checkOut: string) => ({
    id: 'dp-1',
    code: 'DP-1',
    partnerId: 'guest',
    provider: 'direct',
    roomTypeId: 'deluxe',
    bookingType,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    amountTotal: '100',
    state: 'confirmed',
  })
  const length = (r: ReturnType<typeof row>) => coreScreens.stayLength(translate, r, 'vi', 'Asia/Ho_Chi_Minh')

  // Two nights, and it says two nights rather than making a reader subtract.
  assert.match(
    length(row('nightly', '2026-09-04T07:00:00.000Z', '2026-09-06T05:00:00.000Z')),
    /hospitality_core\.duration\.nightly/,
  )
  // A room sold by the hour is not measured in nights.
  assert.match(
    length(row('hourly', '2026-09-04T07:00:00.000Z', '2026-09-04T10:00:00.000Z')),
    /hospitality_core\.duration\.hourly/,
  )
  assert.doesNotMatch(
    length(row('hourly', '2026-09-04T07:00:00.000Z', '2026-09-04T10:00:00.000Z')),
    /hospitality_core\.duration\.nightly/,
  )
  // A booking type with no unit, or dates that make no span, says the dates and
  // claims nothing else.
  assert.doesNotMatch(
    length(row('bespoke', '2026-09-04T07:00:00.000Z', '2026-09-06T05:00:00.000Z')),
    /hospitality_core\.duration\./,
  )
  assert.doesNotMatch(
    length(row('nightly', '2026-09-06T05:00:00.000Z', '2026-09-04T07:00:00.000Z')),
    /hospitality_core\.duration\./,
  )

  // A nightly stay always starts and ends at the property's own hours, so the
  // clock is the same on every row; only the hourly case prints it.
  assert.doesNotMatch(
    length(row('nightly', '2026-09-04T07:00:00.000Z', '2026-09-06T05:00:00.000Z')),
    /\d\d:\d\d/,
  )
  assert.match(length(row('hourly', '2026-09-04T07:00:00.000Z', '2026-09-04T10:00:00.000Z')), /\d\d:\d\d/)

  // The list leads with what a reader scans for, and has one date column.
  const columns = coreScreens.reservationColumns(translate, 'vi', 'Asia/Ho_Chi_Minh').map((c) => c.key)
  assert.deepEqual(columns, ['code', 'guest', 'status', 'provider', 'roomType', 'stay', 'amount'])
})

test('the stay list leads with state and marks a guest still in the room past their hour', () => {
  const hour = 3_600_000
  const stay = (state: string, checkOut: number) => ({
    id: 'st-1',
    code: 'ST-1',
    folioId: 'f-1',
    propertyId: 'hotel',
    partnerId: 'guest',
    roomTypeId: 'deluxe',
    bookingType: 'nightly',
    checkIn: new Date(Date.now() - 48 * hour).toISOString(),
    checkOut: new Date(Date.now() + checkOut).toISOString(),
    adults: 2,
    children: 1,
    billingMode: 'upfront',
    rate: '100',
    state,
  })

  // Still in the room, two hours past the hour they were due out.
  assert.equal(coreScreens.overdue(stay('checked_in', -2 * hour)), true)
  // Due out later today: nothing to say yet.
  assert.equal(coreScreens.overdue(stay('checked_in', 2 * hour)), false)
  // Already gone. The dates are in the past; the guest is not.
  assert.equal(coreScreens.overdue(stay('checked_out', -2 * hour)), false)
  // Never arrived, and the same is true of a cancellation.
  assert.equal(coreScreens.overdue(stay('no_show', -2 * hour)), false)
  assert.equal(coreScreens.overdue(stay('cancelled', -2 * hour)), false)

  const columns = coreScreens.stayColumns(translate, 'vi', 'Asia/Ho_Chi_Minh')
  assert.deepEqual(
    columns.map((c) => c.key),
    ['code', 'guest', 'status', 'room', 'stay', 'guests'],
  )
  // A row with nothing to flag renders the dates as plain text; only the flagged
  // one becomes markup, which is the difference the badge makes.
  const dates = columns.find((c) => c.key === 'stay')!
  const quiet = dates.cell(stay('checked_in', 2 * hour))
  assert.equal(typeof quiet, 'string')
  assert.match(quiet as string, /hospitality_core\.duration\.nightly/)
  assert.match(
    renderToString(dates.cell(stay('checked_in', -2 * hour)) as never),
    /hospitality_core\.stayState\.overdue/,
  )
})

test('every Hospitality metric card asks for a tone the design system knows', () => {
  const TONES = new Set(['neutral', 'info', 'positive', 'warning', 'danger'])
  // Resolved from the repository root, not from this file: the test runs
  // compiled, out of `.build/test`, where a relative path lands in the build
  // output — a directory with no `.tsx` in it, so the check would pass by
  // reading nothing. The count below is what makes that failure loud.
  const dir = `${process.cwd()}/packages/ketsuite/src/modules/hospitality_core/screens`
  const screens = readdirSync(dir).filter((file) => file.endsWith('.tsx'))
  assert.ok(screens.length > 20, `expected the Hospitality screens, found ${screens.length} files`)
  const offenders: string[] = []
  for (const file of screens) {
    const source = readFileSync(`${dir}/${file}`, 'utf8')
    // `tone` is deliberately open in the KetSuite wrapper so a board can colour
    // itself by a domain status, and the stylesheet draws a dot only for the
    // five it knows. That is exactly why a wrong value is silent: the card
    // simply stops saying anything. Passing a card's own id was the way this
    // went unnoticed on nine screens at once.
    for (const [, value] of source.matchAll(/tone=\{(?:'|")([a-z-]+)(?:'|")\}/g))
      if (!TONES.has(value)) offenders.push(`${file}: tone="${value}"`)
    for (const [, expression] of source.matchAll(/tone=\{(item\.[A-Za-z]+)\}/g))
      if (expression !== 'item.tone') offenders.push(`${file}: tone={${expression}}`)
  }
  assert.deepEqual(offenders, [], 'a metric tone must be a design-system tone, not an id')
})
