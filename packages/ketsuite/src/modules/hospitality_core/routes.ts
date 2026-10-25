import { deskBookingRequest } from './screens/desk-booking-request.tsx'
import { folioWorkspaceRequest } from './screens/folio-workspace-request.tsx'
import { cleaningTaskWorkspaceRequest } from './screens/cleaning-task-workspace-request.tsx'
import { reservationCommandRequest } from './screens/reservation-command-request.tsx'
import { reservationWorkspaceRequest } from './screens/reservation-workspace-request.tsx'
import { hospitalityRecordContextRequest } from './screens/record-context-request.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { hospitalityRequestFrontDesk } from './screens/front-desk-request.tsx'
import { hospitalityRequestReservations } from './screens/reservations-request.tsx'
import { hospitalityRequestReservationsId } from './screens/reservations-id-request.tsx'
import { hospitalityRequestStays } from './screens/stays-request.tsx'
import { hospitalityRequestStaysId } from './screens/stays-id-request.tsx'
import { hospitalityRequestFolios } from './screens/folios-request.tsx'
import { hospitalityRequestFoliosId } from './screens/folios-id-request.tsx'
import { hospitalityRequestTapeChart } from './screens/tape-chart-request.tsx'
import { hospitalityRequestProperties } from './screens/properties-request.tsx'
import { hospitalityRequestPropertiesNew } from './screens/properties-new-request.tsx'
import { hospitalityRequestPropertiesId } from './screens/properties-id-request.tsx'
import { hospitalityRequestBuildingsId } from './screens/buildings-id-request.tsx'
import { hospitalityRequestBuildingsIdArchive } from './screens/buildings-id-archive-request.tsx'
import { hospitalityRequestLevelsId } from './screens/levels-id-request.tsx'
import { hospitalityRequestLevelsIdArchive } from './screens/levels-id-archive-request.tsx'
import { hospitalityRequestRooms } from './screens/rooms-request.tsx'
import { hospitalityRequestRoomsNew } from './screens/rooms-new-request.tsx'
import { hospitalityRequestRoomsId } from './screens/rooms-id-request.tsx'
import { hospitalityRequestRoomsIdArchive } from './screens/rooms-id-archive-request.tsx'
import { hospitalityRequestRoomTypes } from './screens/room-types-request.tsx'
import { hospitalityRequestRoomTypesNew } from './screens/room-types-new-request.tsx'
import { hospitalityRequestRoomTypesId } from './screens/room-types-id-request.tsx'
import { hospitalityRequestRatePlans } from './screens/rate-plans-request.tsx'
import { hospitalityRequestInventory } from './screens/inventory-request.tsx'
import { hospitalityRequestServices } from './screens/services-request.tsx'
import { hospitalityRequestNightAudit } from './screens/night-audit-request.tsx'
import { hospitalityRequestStayNotices } from './screens/stay-notices-request.tsx'
import { hospitalityRequestHousekeeping } from './screens/housekeeping-request.tsx'
import { hospitalityRequestHousekeepingTasksId } from './screens/housekeeping-tasks-id-request.tsx'
import { hospitalityRequestHousekeepingRooms } from './screens/housekeeping-rooms-request.tsx'
import { hospitalityRequestHousekeepingRoomsId } from './screens/housekeeping-rooms-id-request.tsx'
import { hospitalityRequestContent } from './screens/content-request.tsx'
import { hospitalityRequestContentUpload } from './screens/content-upload-request.tsx'
import { hospitalityRequestContentImagesIdMetadata } from './screens/content-images-id-metadata-request.tsx'
import { hospitalityRequestContentImagesIdPrimary } from './screens/content-images-id-primary-request.tsx'
import { hospitalityRequestContentImagesIdRemove } from './screens/content-images-id-remove-request.tsx'
import { hospitalityRequestContentImagesIdMoveUp } from './screens/content-images-id-move-up-request.tsx'
import { hospitalityRequestContentImagesIdMoveDown } from './screens/content-images-id-move-down-request.tsx'
import { hospitalityRequestAmenities } from './screens/amenities-request.tsx'
import { hospitalityRequestPolicies } from './screens/policies-request.tsx'

export const routes: Record<string, RouteEntry> = {
  '/admin/hospitality/reservation-command': reservationCommandRequest,
  '/admin/hospitality/folios/{id}/workspace-context': folioWorkspaceRequest,
  '/admin/hospitality/reservations/{id}/record-context': reservationWorkspaceRequest,
  '/admin/hospitality/stay-notices/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/services/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/housekeeping/tasks/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/buildings/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/levels/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/property-charges/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/content-locales/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/rooms/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/room-types/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/amenities/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/policies/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/rate-plans/{id}/record-context': hospitalityRecordContextRequest,
  '/admin/hospitality/front-desk': hospitalityRequestFrontDesk,
  '/admin/hospitality/reservations/new': deskBookingRequest,
  '/admin/hospitality/reservations/new/context': deskBookingRequest,
  '/admin/hospitality/reservations': hospitalityRequestReservations,
  '/admin/hospitality/reservations/{id}': hospitalityRequestReservationsId,
  '/admin/hospitality/stays': hospitalityRequestStays,
  '/admin/hospitality/stays/{id}': hospitalityRequestStaysId,
  '/admin/hospitality/folios': hospitalityRequestFolios,
  '/admin/hospitality/folios/{id}': hospitalityRequestFoliosId,
  '/admin/hospitality/tape-chart': hospitalityRequestTapeChart,
  '/admin/hospitality/properties': hospitalityRequestProperties,
  '/admin/hospitality/properties/new': hospitalityRequestPropertiesNew,
  '/admin/hospitality/properties/{id}': hospitalityRequestPropertiesId,
  '/admin/hospitality/buildings/{id}': hospitalityRequestBuildingsId,
  '/admin/hospitality/buildings/{id}/archive': hospitalityRequestBuildingsIdArchive,
  '/admin/hospitality/levels/{id}': hospitalityRequestLevelsId,
  '/admin/hospitality/levels/{id}/archive': hospitalityRequestLevelsIdArchive,
  '/admin/hospitality/rooms': hospitalityRequestRooms,
  '/admin/hospitality/rooms/new': hospitalityRequestRoomsNew,
  '/admin/hospitality/rooms/{id}': hospitalityRequestRoomsId,
  '/admin/hospitality/rooms/{id}/archive': hospitalityRequestRoomsIdArchive,
  '/admin/hospitality/room-types': hospitalityRequestRoomTypes,
  '/admin/hospitality/room-types/new': hospitalityRequestRoomTypesNew,
  '/admin/hospitality/room-types/{id}': hospitalityRequestRoomTypesId,
  '/admin/hospitality/rate-plans': hospitalityRequestRatePlans,
  '/admin/hospitality/inventory': hospitalityRequestInventory,
  '/admin/hospitality/services': hospitalityRequestServices,
  '/admin/hospitality/night-audit': hospitalityRequestNightAudit,
  '/admin/hospitality/stay-notices': hospitalityRequestStayNotices,
  '/admin/hospitality/housekeeping': hospitalityRequestHousekeeping,
  '/admin/hospitality/housekeeping/tasks/{id}/workspace-context': cleaningTaskWorkspaceRequest,
  '/admin/hospitality/housekeeping/tasks/{id}': hospitalityRequestHousekeepingTasksId,
  '/admin/hospitality/housekeeping/rooms': hospitalityRequestHousekeepingRooms,
  '/admin/hospitality/housekeeping/rooms/{id}': hospitalityRequestHousekeepingRoomsId,
  '/admin/hospitality/content': hospitalityRequestContent,
  '/admin/hospitality/content/upload': hospitalityRequestContentUpload,
  '/admin/hospitality/content/images/{id}/metadata': hospitalityRequestContentImagesIdMetadata,
  '/admin/hospitality/content/images/{id}/primary': hospitalityRequestContentImagesIdPrimary,
  '/admin/hospitality/content/images/{id}/remove': hospitalityRequestContentImagesIdRemove,
  '/admin/hospitality/content/images/{id}/move-up': hospitalityRequestContentImagesIdMoveUp,
  '/admin/hospitality/content/images/{id}/move-down': hospitalityRequestContentImagesIdMoveDown,
  '/admin/hospitality/amenities': hospitalityRequestAmenities,
  '/admin/hospitality/policies': hospitalityRequestPolicies,
}
