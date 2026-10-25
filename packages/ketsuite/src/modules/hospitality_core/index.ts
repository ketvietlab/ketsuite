import { guestBenefitFunctions } from './functions/guest-benefits.ts'
import { deskBookingFunctions } from './functions/desk-booking.ts'
import { folioServiceChargeFunctions } from './functions/folio-service-charge.ts'
import { folioWorkspaceFunctions } from './functions/folio-workspace.ts'
import { inHouseGuestFunctions } from './functions/add-in-house-guest.ts'
import { roomBoardFunctions } from './functions/room-board.ts'
import { roomPlanFunctions } from './functions/room-plan.ts'
import { reservationBookFunctions } from './functions/reservation-book.ts'
import { stayBookFunctions } from './functions/stay-book.ts'
import { folioBookFunctions } from './functions/folio-book.ts'
import { cleaningTaskRecordFunctions } from './functions/cleaning-task-record.ts'
import { inventoryWorkbenchFunctions } from './functions/inventory-workbench.ts'
import { arrivalPlanFunctions } from './functions/arrival-plan.ts'
import { arrivalGuestFunctions } from './functions/arrival-guests.ts'
import { reservationWorkspaceFunctions } from './functions/reservation-workspace.ts'
import { frontDeskFunctions } from './functions/front-desk.ts'
import { arrivalHoldJobs } from './functions/arrival-hold-expiry.ts'
import { chargeAdjustmentFunctions } from './functions/charge-adjustment.ts'
import { propertyContentFunctions } from './functions/property-content.ts'
import { guardCatalogueParents } from './functions/catalogue-parent.ts'
import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions/index.ts'
import { catalog } from './catalog.ts'
import { housekeeping } from './housekeeping.ts'
import { content } from './content.ts'
import { inventory } from './inventory.ts'
import { nightAuditFunctions, nightAuditJobs } from './night-audit.ts'
import { onlineBooking } from './online-booking.ts'
import { operations } from './operations.ts'
import { services } from './services.ts'
import { stayNoticeFunctions, stayNoticeJobs } from './stay-notices.ts'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routes } from './routes.ts'
import { searchFilterFunctions } from './search-functions.ts'
import { collectionSearchFunctions } from './functions/collection-search.ts'
import { catalogueLookupFunctions } from './functions/catalogue-lookups.ts'
import { catalogueRecordFunctions } from './functions/record-context.ts'
import { catalogueRecords } from './records/config.ts'
import { auditDecisionFunctions } from './functions/audit-decisions.ts'
import { propertyOperationFunctions } from './functions/property-operations.ts'
import { roomOperationFunctions } from './functions/room-operations.ts'
import { islands } from './islands.ts'
import {
  guardedOperationalFunctions,
  scopedHospitalityRecordReads,
} from './functions/operational-commands.ts'
import { noticeRecordFunctions } from './functions/notice-record.ts'
import { serviceRecordFunctions } from './functions/service-record.ts'
import { cleaningTaskFunctions } from './functions/save-cleaning-task.ts'

export default defineModule({
  name: 'hospitality_core',
  version: '0.1.0',
  depends: ['backend', 'company', 'storage', 'partner', 'address', 'uom', 'product'],
  // Billing and OTA build on this module, so the front desk reads their rows, the ledger
  // and user grants only where a deployment installs them.
  optional: ['account', 'hospitality_billing', 'hospitality_ota', 'user'],
  title: 'Khách sạn',
  summary: 'Cơ sở lưu trú, loại phòng, phòng, tiện nghi và chính sách vận hành.',
  category: 'Khách sạn',
  models,
  relations,
  functions: scopedHospitalityRecordReads(
    guardCatalogueParents(
      guardedOperationalFunctions({
        ...functions,
        ...frontDeskFunctions,
        ...roomBoardFunctions,
        ...roomPlanFunctions,
        ...reservationBookFunctions,
        ...stayBookFunctions,
        ...folioBookFunctions,
        ...reservationWorkspaceFunctions,
        ...folioWorkspaceFunctions,
        ...folioServiceChargeFunctions,
        ...deskBookingFunctions,
        ...arrivalPlanFunctions,
        ...guestBenefitFunctions,
        ...arrivalGuestFunctions,
        ...inHouseGuestFunctions,
        ...catalog,
        ...inventory,
        ...inventoryWorkbenchFunctions,
        ...onlineBooking,
        ...operations,
        ...chargeAdjustmentFunctions,
        ...housekeeping,
        ...cleaningTaskFunctions,
        ...content,
        ...services,
        ...nightAuditFunctions,
        ...stayNoticeFunctions,
        ...searchFilterFunctions,
        ...collectionSearchFunctions,
        ...roomOperationFunctions,
        ...propertyOperationFunctions,
        ...propertyContentFunctions,
        ...auditDecisionFunctions,
        ...catalogueRecordFunctions,
        ...cleaningTaskRecordFunctions,
        ...catalogueLookupFunctions,
        ...serviceRecordFunctions,
        ...noticeRecordFunctions,
      }),
    ),
  ),
  jobs: { ...nightAuditJobs, ...arrivalHoldJobs, ...stayNoticeJobs },
  routes,
  menus,
  messages,
  assets: new URL('./client/', import.meta.url),
  styles: ['room-plan.css'],
  islands,
  joints: {
    'deskBooking.page': {
      props: { id: 'text', title: 'text', loading: 'text', back: 'text', width: 'text?', envelope: 'json?' },
    },
    'folio.page': {
      props: {
        id: 'text',
        title: 'text',
        loading: 'text',
        back: 'text',
        width: 'text?',
        dialog: 'text?',
        envelope: 'json?',
      },
    },
    'cleaningTask.page': {
      props: {
        id: 'text',
        title: 'text',
        loading: 'text',
        back: 'text',
        width: 'text?',
        dialog: 'text?',
        envelope: 'json?',
      },
    },
    'reservation.page': {
      props: {
        id: 'text',
        title: 'text',
        loading: 'text',
        back: 'text',
        width: 'text?',
        dialog: 'text?',
        envelope: 'json?',
      },
    },
  },
  fills: {
    'hospitality_core:deskBooking.page': '{% island "hospitality.desk-booking-page" %}',
    'hospitality_core:folio.page': '{% island "hospitality.folio-page" %}',
    'hospitality_core:cleaningTask.page': '{% island "hospitality.cleaning-task-page" %}',
    'hospitality_core:reservation.page': '{% island "hospitality.reservation-page" %}',
    'backend:runtime': catalogueRecords
      .map((definition) => `{% island "hospitality.${definition.kind}-modal" %}`)
      .join('\n'),
  },
})

export {
  ACCOMMODATION_TYPES,
  AMENITY_SCOPES,
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  CONTACT_TYPES,
  CONTENT_IMAGE_CATEGORIES,
  ROOM_STATUSES,
  ASSIGNMENT_STATES,
  BILLING_MODES,
  BOOKING_PROVIDERS,
  BOOKING_TYPES,
  RATE_TYPES,
  MEAL_PLANS,
  CHARGE_FULFILLMENT_KINDS,
  CHARGE_TYPES,
  PROPERTY_CHARGE_TYPES,
  EXTRA_RECURRENCES,
  DOCUMENT_TYPES,
  FOLIO_STATES,
  GENDERS,
  OCR_STATES,
  RESERVATION_STATES,
  STAY_STATES,
  CLEANING_TASK_PRIORITIES,
  CLEANING_TASK_STATES,
  CLEANING_TASK_TYPES,
  NIGHT_AUDIT_STATES,
  STAY_NOTICE_CHANNELS,
  STAY_NOTICE_REASONS,
  STAY_NOTICE_STATES,
} from './types.ts'
export type {
  AccommodationType,
  AmenityScope,
  BedType,
  CancellationPolicyType,
  ContactType,
  ContentImageCategory,
  RoomStatus,
  AssignmentState,
  BillingMode,
  BookingProvider,
  BookingType,
  RateType,
  MealPlan,
  ChargeFulfillmentKind,
  ChargeType,
  PropertyChargeType,
  ExtraRecurrence,
  DocumentType,
  FolioState,
  Gender,
  OcrState,
  ReservationState,
  StayState,
  CleaningTaskPriority,
  CleaningTaskState,
  CleaningTaskType,
  NightAuditState,
  StayNoticeChannel,
  StayNoticeReason,
  StayNoticeState,
} from './types.ts'
