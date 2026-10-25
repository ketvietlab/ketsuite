import { defineRecordPageIsland, defineRecordModalIsland } from '../../ui/record-modal.tsx'
import { serviceUnit } from './records/service-unit.tsx'
import { catalogueRecords } from './records/config.ts'
import { defineIsland } from '@ketvietlab/ketjs-view'
import type { HospitalityCollectionProps } from './collections/view.tsx'
import {
  hospitalityCollectionControls,
  hospitalityCollectionFooter,
  hospitalityCollectionResults,
} from './collections/view.tsx'
import type { ReservationBookProps } from './collections/reservation-book.tsx'
import {
  reservationBookControls,
  reservationBookFooter,
  reservationBookResults,
} from './collections/reservation-book.tsx'
import type { StayBookProps } from './collections/stay-book.tsx'
import { stayBookControls, stayBookFooter, stayBookResults } from './collections/stay-book.tsx'
import type { FolioBookProps } from './collections/folio-book.tsx'
import { folioBookControls, folioBookFooter, folioBookResults } from './collections/folio-book.tsx'
import type { RoomPlanProps } from './plan/room-plan.tsx'
import { roomPlanControls, roomPlanGrid, roomPlanPeek } from './plan/room-plan.tsx'

const props = {
  key: 'text',
  id: 'text',
  source: 'text',
  path: 'text',
  recordPath: 'text',
  recordKind: 'text?',
  recordParam: 'text?',
  recordIdField: 'text?',
  recordQuery: 'json?',
  createHref: 'text?',
  query: 'json',
  defaultSort: 'text',
  defaultDirection: 'text?',
  lang: 'text',
  allowed: 'bool',
  columns: 'json',
  sorts: 'json?',
  states: 'json',
  properties: 'json',
  words: 'json',
} as const
const planProps = {
  key: 'text',
  path: 'text',
  planHref: 'text',
  source: 'text',
  request: 'json',
  peekSource: 'text',
  dueSource: 'text?',
  lang: 'text',
  timezone: 'text',
  businessDate: 'text',
  first: 'int',
  last: 'int',
  nights: 'json',
  types: 'json',
  floors: 'json',
  property: 'text',
  properties: 'json',
  links: 'json',
  may: 'json',
  words: 'json',
  query: 'json',
} as const
const bookProps = {
  key: 'text',
  id: 'text',
  source: 'text',
  path: 'text',
  recordPath: 'text',
  createHref: 'text?',
  lang: 'text',
  allowed: 'bool',
  properties: 'json',
  sources: 'json',
  query: 'json',
  words: 'json',
} as const
const stayProps = {
  key: 'text',
  id: 'text',
  source: 'text',
  dueSource: 'text?',
  path: 'text',
  recordPath: 'text',
  stayPath: 'text',
  arrivalsHref: 'text?',
  lang: 'text',
  allowed: 'bool',
  properties: 'json',
  query: 'json',
  words: 'json',
} as const
const folioProps = {
  key: 'text',
  id: 'text',
  source: 'text',
  dueSource: 'text?',
  path: 'text',
  recordPath: 'text',
  staysHref: 'text?',
  lang: 'text',
  allowed: 'bool',
  properties: 'json',
  query: 'json',
  words: 'json',
} as const
export const islands = {
  'hospitality.room-plan-controls': defineIsland<RoomPlanProps>()({
    props: planProps,
    key: ['key'],
    client: 'room-plan.mjs',
    export: 'roomPlanControls',
    view: (input) => roomPlanControls(input).view,
  }),
  'hospitality.room-plan-grid': defineIsland<RoomPlanProps>()({
    props: planProps,
    key: ['key'],
    client: 'room-plan.mjs',
    export: 'roomPlanGrid',
    view: (input) => roomPlanGrid(input).view,
  }),
  'hospitality.room-plan-peek': defineIsland<RoomPlanProps>()({
    props: planProps,
    key: ['key'],
    client: 'room-plan.mjs',
    export: 'roomPlanPeek',
    view: (input) => roomPlanPeek(input).view,
  }),
  'hospitality.desk-booking-page': defineRecordPageIsland({
    kind: 'hospitality.deskBooking',
    client: 'desk-booking-page.mjs',
    export: 'deskBookingPage',
  }),
  'hospitality.folio-page': defineRecordPageIsland({
    kind: 'hospitality.folio',
    client: 'folio-page.mjs',
    export: 'folioPage',
  }),
  'hospitality.cleaning-task-page': defineRecordPageIsland({
    kind: 'hospitality.cleaningTask',
    client: 'cleaning-task-page.mjs',
    export: 'cleaningTaskPage',
  }),
  'hospitality.reservation-page': defineRecordPageIsland({
    kind: 'hospitality.reservation',
    client: 'reservation-page.mjs',
    export: 'reservationPage',
  }),
  'hospitality.service-unit': defineIsland()({
    props: {
      productId: 'text',
      propertyId: 'text',
      value: 'text',
      loading: 'text',
      priceInputId: 'text',
      query: 'text',
    },
    key: ['productId', 'propertyId'],
    client: 'service-unit.mjs',
    export: 'serviceUnit',
    view: (input) => serviceUnit(input).view,
  }),
  ...Object.fromEntries(
    catalogueRecords.map((definition) => [
      `hospitality.${definition.kind}-modal`,
      defineRecordModalIsland({
        kind: `hospitality.${definition.kind}`,
        client: 'catalogue-modal.mjs',
        export: `${definition.kind}Modal`,
      }),
    ]),
  ),
  'hospitality.stays-controls': defineIsland<StayBookProps>()({
    props: stayProps,
    key: ['key'],
    client: 'stay-book.mjs',
    export: 'stayBookControls',
    view: (input) => stayBookControls(input).view,
  }),
  'hospitality.stays-results': defineIsland<StayBookProps>()({
    props: stayProps,
    key: ['key'],
    client: 'stay-book.mjs',
    export: 'stayBookResults',
    view: (input) => stayBookResults(input).view,
  }),
  'hospitality.stays-footer': defineIsland<StayBookProps>()({
    props: stayProps,
    key: ['key'],
    client: 'stay-book.mjs',
    export: 'stayBookFooter',
    view: (input) => stayBookFooter(input).view,
  }),
  'hospitality.folios-controls': defineIsland<FolioBookProps>()({
    props: folioProps,
    key: ['key'],
    client: 'folio-book.mjs',
    export: 'folioBookControls',
    view: (input) => folioBookControls(input).view,
  }),
  'hospitality.folios-results': defineIsland<FolioBookProps>()({
    props: folioProps,
    key: ['key'],
    client: 'folio-book.mjs',
    export: 'folioBookResults',
    view: (input) => folioBookResults(input).view,
  }),
  'hospitality.folios-footer': defineIsland<FolioBookProps>()({
    props: folioProps,
    key: ['key'],
    client: 'folio-book.mjs',
    export: 'folioBookFooter',
    view: (input) => folioBookFooter(input).view,
  }),
  'hospitality.reservations-controls': defineIsland<ReservationBookProps>()({
    props: bookProps,
    key: ['key'],
    client: 'reservation-book.mjs',
    export: 'reservationBookControls',
    view: (input) => reservationBookControls(input).view,
  }),
  'hospitality.reservations-results': defineIsland<ReservationBookProps>()({
    props: bookProps,
    key: ['key'],
    client: 'reservation-book.mjs',
    export: 'reservationBookResults',
    view: (input) => reservationBookResults(input).view,
  }),
  'hospitality.reservations-footer': defineIsland<ReservationBookProps>()({
    props: bookProps,
    key: ['key'],
    client: 'reservation-book.mjs',
    export: 'reservationBookFooter',
    view: (input) => reservationBookFooter(input).view,
  }),
  'hospitality.collection-controls': defineIsland<HospitalityCollectionProps>()({
    props,
    key: ['key'],
    client: 'collection.mjs',
    export: 'hospitalityCollectionControls',
    view: (input) => hospitalityCollectionControls(input).view,
  }),
  'hospitality.collection-results': defineIsland<HospitalityCollectionProps>()({
    props,
    key: ['key'],
    client: 'collection.mjs',
    export: 'hospitalityCollectionResults',
    view: (input) => hospitalityCollectionResults(input).view,
  }),
  'hospitality.collection-footer': defineIsland<HospitalityCollectionProps>()({
    props,
    key: ['key'],
    client: 'collection.mjs',
    export: 'hospitalityCollectionFooter',
    view: (input) => hospitalityCollectionFooter(input).view,
  }),
}
