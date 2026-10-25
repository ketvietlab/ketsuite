import type { FnSpec } from '@ketvietlab/ketjs'
import { listPropertiesFunction } from './list-properties.ts'
import { getPropertyFunction } from './get-property.ts'
import { savePropertyFunction } from './save-property.ts'
import { archivePropertyFunction } from './archive-property.ts'
import { listBuildingsFunction } from './list-buildings.ts'
import { getBuildingFunction } from './get-building.ts'
import { saveBuildingFunction } from './save-building.ts'
import { archiveBuildingFunction } from './archive-building.ts'
import { listFloorsFunction } from './list-floors.ts'
import { getFloorFunction } from './get-floor.ts'
import { saveFloorFunction } from './save-floor.ts'
import { archiveFloorFunction } from './archive-floor.ts'
import { listRoomTypesFunction } from './list-room-types.ts'
import { getRoomTypeFunction } from './get-room-type.ts'
import { saveRoomTypeFunction } from './save-room-type.ts'
import { listRoomsFunction } from './list-rooms.ts'
import { getRoomFunction } from './get-room.ts'
import { saveRoomFunction } from './save-room.ts'
import { archiveRoomFunction } from './archive-room.ts'
import { setRoomStatusFunction } from './set-room-status.ts'
import { listAmenityCategoriesFunction } from './list-amenity-categories.ts'
import { saveAmenityCategoryFunction } from './save-amenity-category.ts'
import { listAmenitiesFunction } from './list-amenities.ts'
import { saveAmenityFunction } from './save-amenity.ts'
import { assignAmenityFunction } from './assign-amenity.ts'
import { saveBedFunction } from './save-bed.ts'
import { listCancellationPoliciesFunction } from './list-cancellation-policies.ts'
import { saveCancellationPolicyFunction } from './save-cancellation-policy.ts'
import { savePropertyContactFunction } from './save-property-contact.ts'

const entries: Array<[string, FnSpec]> = [
  ['listProperties', listPropertiesFunction],
  ['getProperty', getPropertyFunction],
  ['saveProperty', savePropertyFunction],
  ['archiveProperty', archivePropertyFunction],
  ['listBuildings', listBuildingsFunction],
  ['getBuilding', getBuildingFunction],
  ['saveBuilding', saveBuildingFunction],
  ['archiveBuilding', archiveBuildingFunction],
  ['listFloors', listFloorsFunction],
  ['getFloor', getFloorFunction],
  ['saveFloor', saveFloorFunction],
  ['archiveFloor', archiveFloorFunction],
  ['listRoomTypes', listRoomTypesFunction],
  ['getRoomType', getRoomTypeFunction],
  ['saveRoomType', saveRoomTypeFunction],
  ['listRooms', listRoomsFunction],
  ['getRoom', getRoomFunction],
  ['saveRoom', saveRoomFunction],
  ['archiveRoom', archiveRoomFunction],
  ['setRoomStatus', setRoomStatusFunction],
  ['listAmenityCategories', listAmenityCategoriesFunction],
  ['saveAmenityCategory', saveAmenityCategoryFunction],
  ['listAmenities', listAmenitiesFunction],
  ['saveAmenity', saveAmenityFunction],
  ['assignAmenity', assignAmenityFunction],
  ['saveBed', saveBedFunction],
  ['listCancellationPolicies', listCancellationPoliciesFunction],
  ['saveCancellationPolicy', saveCancellationPolicyFunction],
  ['savePropertyContact', savePropertyContactFunction],
]

export const functions: Record<string, FnSpec> = {}
for (const [key, spec] of entries) {
  if (key in functions) throw new Error(`Duplicate hospitality catalogue function: ${key}`)
  functions[key] = spec
}
