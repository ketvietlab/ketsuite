export type RecordField = {
  name: string
  label: string
  type?: 'text' | 'number' | 'textarea' | 'datetime-local' | 'checkbox' | 'select'
  required?: boolean
  fixed?: boolean
  multiple?: boolean
  options?: readonly string[]
  lookup?:
    | 'policies'
    | 'amenities'
    | 'properties'
    | 'roomTypes'
    | 'buildings'
    | 'floors'
    | 'categories'
    | 'rooms'
    | 'staff'
    | 'serviceTargets'
    | 'serviceProducts'
  default?: string | number | boolean
}
export type CatalogueRecord = {
  kind: string
  model: string
  read: string
  save: string
  path: string
  list: string
  title: string
  parentVersion?: boolean
  parentPage?: boolean
  lifecycle?: string
  fields: readonly RecordField[]
}
const identity = [
  { name: 'code', label: 'code', required: true, fixed: true },
  { name: 'name', label: 'name', required: true },
] as const
const property = {
  name: 'propertyId',
  label: 'property',
  type: 'select',
  required: true,
  fixed: true,
  lookup: 'properties',
} as const
export const catalogueRecords: readonly CatalogueRecord[] = [
  {
    kind: 'notice',
    model: 'StayNotice',
    read: 'getStayNoticeRecord',
    save: 'recordStayNoticeSubmission',
    path: 'stay-notices',
    list: 'notices',
    title: 'record.notice',
    fields: [
      {
        name: 'reason',
        label: 'noticeReason',
        type: 'select',
        required: true,
        options: ['tourism', 'business', 'family', 'other'],
        default: 'tourism',
      },
      {
        name: 'channel',
        label: 'noticeChannel',
        type: 'select',
        required: true,
        options: ['online', 'vneid', 'email', 'phone', 'software'],
        default: 'online',
      },
      { name: 'evidenceRef', label: 'noticeEvidence', required: true },
      { name: 'submittedAt', label: 'noticeSentAt', type: 'datetime-local', required: true },
      { name: 'submissionNote', label: 'description', type: 'textarea' },
    ],
  },
  {
    kind: 'service',
    model: 'ExtraLine',
    read: 'getServiceRecord',
    save: 'saveExtraLine',
    path: 'services',
    list: 'services',
    title: 'record.service',
    fields: [
      property,
      {
        name: 'target',
        label: 'serviceTarget',
        type: 'select',
        required: true,
        fixed: true,
        lookup: 'serviceTargets',
      },
      {
        name: 'productId',
        label: 'serviceProduct',
        type: 'select',
        required: true,
        lookup: 'serviceProducts',
      },
      {
        name: 'fulfillmentKind',
        label: 'fulfillment',
        type: 'select',
        required: true,
        options: ['none', 'external_stock'],
        default: 'none',
      },
      {
        name: 'recurrence',
        label: 'recurrence',
        type: 'select',
        required: true,
        options: ['once', 'per_unit', 'per_night'],
        default: 'once',
      },
      { name: 'quantity', label: 'quantity', type: 'number', required: true, default: 1 },
      { name: 'unitPrice', label: 'unitPrice', type: 'number', required: true },
      { name: 'description', label: 'description', type: 'textarea' },
    ],
  },
  {
    kind: 'building',
    model: 'Building',
    read: 'getBuildingRecord',
    save: 'saveBuilding',
    path: 'buildings',
    list: 'properties',
    title: 'record.building',
    parentVersion: true,
    parentPage: true,
    lifecycle: 'archiveBuilding',
    fields: [
      property,
      ...identity.map((field) => (field.name === 'code' ? { ...field, fixed: false } : field)),
      { name: 'sequence', label: 'sequence', type: 'number', default: 10 },
    ],
  },
  {
    kind: 'floor',
    model: 'Floor',
    read: 'getFloorRecord',
    save: 'saveFloor',
    path: 'levels',
    list: 'properties',
    title: 'record.floor',
    parentVersion: true,
    parentPage: true,
    lifecycle: 'archiveFloor',
    fields: [
      property,
      {
        name: 'buildingId',
        label: 'building',
        type: 'select',
        required: true,
        lookup: 'buildings',
      },
      ...identity.map((field) => (field.name === 'code' ? { ...field, fixed: false } : field)),
      { name: 'level', label: 'floorLevel', type: 'number' },
      { name: 'sequence', label: 'sequence', type: 'number', default: 10 },
    ],
  },
  {
    kind: 'fee',
    model: 'PropertyCharge',
    read: 'getPropertyChargeRecord',
    save: 'savePropertyCharge',
    path: 'property-charges',
    list: 'properties',
    title: 'record.fee',
    parentVersion: true,
    parentPage: true,
    fields: [
      property,
      { name: 'name', label: 'name', required: true },
      {
        name: 'chargeType',
        label: 'feeType',
        type: 'select',
        required: true,
        options: ['parking', 'city_tax', 'internet', 'resort_fee', 'extra_bed', 'other'],
        default: 'other',
      },
      { name: 'amount', label: 'amount', type: 'number', required: true, default: 0 },
      {
        name: 'basis',
        label: 'basis',
        type: 'select',
        required: true,
        options: ['per_night', 'per_stay', 'per_person', 'per_room'],
        default: 'per_stay',
      },
      { name: 'included', label: 'included', type: 'checkbox', default: false },
      { name: 'description', label: 'description', type: 'textarea' },
    ],
  },
  {
    kind: 'locale',
    model: 'ContentLocale',
    read: 'getContentLocaleRecord',
    save: 'saveContentLocale',
    path: 'content-locales',
    list: 'properties',
    title: 'record.locale',
    parentVersion: true,
    parentPage: true,
    fields: [
      property,
      { name: 'roomTypeId', label: 'roomType', type: 'select', fixed: true, lookup: 'roomTypes' },
      { name: 'locale', label: 'locale', required: true, fixed: true },
      { name: 'title', label: 'publicTitle', required: true },
      { name: 'description', label: 'description', type: 'textarea', required: true },
    ],
  },

  {
    kind: 'cleaningTask',
    model: 'CleaningTask',
    read: 'getCleaningTaskRecord',
    save: 'saveCleaningTask',
    path: 'housekeeping/tasks',
    list: 'housekeeping',
    title: 'record.cleaningTask',
    fields: [
      property,
      { name: 'roomId', label: 'room', type: 'select', required: true, fixed: true, lookup: 'rooms' },
      {
        name: 'taskType',
        label: 'type',
        type: 'select',
        required: true,
        fixed: true,
        options: ['daily_clean', 'checkout_clean', 'inspection', 'maintenance'],
        default: 'checkout_clean',
      },
      {
        name: 'priority',
        label: 'priority',
        type: 'select',
        required: true,
        options: ['normal', 'urgent'],
        default: 'normal',
      },
      { name: 'assigneeId', label: 'assignee', type: 'select', lookup: 'staff' },
      { name: 'dueAt', label: 'deadline', type: 'datetime-local', required: true },
      { name: 'notes', label: 'description', type: 'textarea' },
    ],
  },
  {
    kind: 'room',
    model: 'Room',
    read: 'getRoomRecord',
    save: 'saveRoom',
    path: 'rooms',
    list: 'rooms',
    title: 'record.room',
    parentVersion: true,
    lifecycle: 'archiveRoom',
    fields: [
      property,
      ...identity,
      { name: 'roomTypeId', label: 'roomType', type: 'select', required: true, lookup: 'roomTypes' },
      { name: 'buildingId', label: 'building', type: 'select', required: true, lookup: 'buildings' },
      { name: 'floorId', label: 'floor', type: 'select', required: true, lookup: 'floors' },
      { name: 'capacity', label: 'capacity', type: 'number', required: true, default: 2 },
    ],
  },
  {
    kind: 'roomType',
    model: 'RoomType',
    read: 'getRoomTypeRecord',
    save: 'saveRoomType',
    path: 'room-types',
    list: 'room-types',
    title: 'record.roomType',
    parentVersion: true,
    fields: [
      property,
      ...identity,
      { name: 'publicName', label: 'publicName' },
      {
        name: 'bedType',
        label: 'bedType',
        type: 'select',
        options: ['keep', 'single', 'double', 'queen', 'king', 'sofa', 'bunk'],
        default: 'queen',
        required: true,
      },
      { name: 'bedQuantity', label: 'bedQuantity', type: 'number', default: 1, required: true },
      { name: 'cancellationPolicyId', label: 'cancellationPolicy', type: 'select', lookup: 'policies' },
      { name: 'amenityIds', label: 'roomAmenities', type: 'select', lookup: 'amenities', multiple: true },
      { name: 'defaultCapacity', label: 'capacity', type: 'number', required: true, default: 2 },
      { name: 'maxAdults', label: 'adults', type: 'number', required: true, default: 2 },
      { name: 'maxChildren', label: 'children', type: 'number', default: 0 },
      { name: 'maxInfants', label: 'infants', type: 'number', default: 0 },
      { name: 'maxExtraBeds', label: 'extraBeds', type: 'number', default: 0 },
      { name: 'sizeSqm', label: 'size', type: 'number' },
      { name: 'baseRate', label: 'amount', type: 'number', default: 0 },
      { name: 'description', label: 'description', type: 'textarea' },
    ],
  },
  {
    kind: 'amenity',
    model: 'Amenity',
    read: 'getAmenityRecord',
    save: 'saveAmenity',
    path: 'amenities',
    list: 'amenities',
    title: 'record.amenity',
    fields: [
      ...identity,
      {
        name: 'scope',
        label: 'scope',
        type: 'select',
        required: true,
        options: ['property', 'room'],
        default: 'room',
      },
      { name: 'categoryId', label: 'category', type: 'select', lookup: 'categories' },
      { name: 'sequence', label: 'sequence', type: 'number', default: 10 },
    ],
  },
  {
    kind: 'policy',
    model: 'CancellationPolicy',
    read: 'getPolicyRecord',
    save: 'saveCancellationPolicy',
    path: 'policies',
    list: 'policies',
    title: 'record.policy',
    fields: [
      ...identity,
      {
        name: 'type',
        label: 'type',
        type: 'select',
        required: true,
        options: ['flexible', 'moderate', 'strict', 'non_refundable', 'peak', 'contract'],
        default: 'flexible',
      },
      {
        name: 'feeRule',
        label: 'feeRule',
        type: 'select',
        required: true,
        options: ['template', 'percentage'],
        default: 'percentage',
      },
      { name: 'freeCancellationHours', label: 'freeHours', type: 'number', default: 24 },
      { name: 'penaltyPercent', label: 'penalty', type: 'number', default: 0 },
      { name: 'description', label: 'description', type: 'textarea' },
    ],
  },
  {
    kind: 'rate',
    model: 'RatePlan',
    read: 'getRateRecord',
    save: 'saveRatePlan',
    path: 'rate-plans',
    list: 'rates',
    title: 'record.rate',
    parentVersion: true,
    fields: [
      property,
      ...identity,
      {
        name: 'roomTypeId',
        label: 'roomType',
        type: 'select',
        required: true,
        fixed: true,
        lookup: 'roomTypes',
      },
      {
        name: 'rateType',
        label: 'rateType',
        type: 'select',
        required: true,
        options: ['nightly', 'hourly', 'weekly', 'monthly'],
        default: 'nightly',
      },
      { name: 'amount', label: 'amount', type: 'number', required: true },
      { name: 'minAdvanceDays', label: 'minAdvanceDays', type: 'number', default: 0 },
      { name: 'cancellationPolicyId', label: 'cancellationPolicy', type: 'select', lookup: 'policies' },
      { name: 'minStay', label: 'minStay', type: 'number', default: 1 },
      { name: 'maxStay', label: 'maxStay', type: 'number', default: 0 },
      { name: 'isDefault', label: 'defaultRate', type: 'checkbox', default: false },
    ],
  },
]
export const HOSPITALITY_RECORD_LABELS: Record<'vi' | 'en', Record<string, string>> = {
  vi: {
    'recordModal.close': 'Đóng',
    'recordModal.loading': 'Đang tải…',
    'recordModal.loadFailed': 'Chưa đọc được bản ghi.',
    'recordModal.notFound': 'Bản ghi không còn tồn tại hoặc bạn không có quyền xem.',
    'recordModal.retry': 'Thử lại',
    'recordModal.errorTitle': 'Chưa lưu được',
    'recordModal.saveFailed': 'Thao tác chưa thành công. Hãy thử lại.',
    'recordModal.savedTitle': 'Đã lưu',
    'recordModal.saved': 'Thay đổi đã được ghi nhận.',
    'recordModal.unsaved': 'Bỏ nội dung vừa nhập?',
    'recordModal.uploadFailed': 'Chưa tải được tệp. Hãy thử lại.',
  },
  en: {
    'recordModal.close': 'Close',
    'recordModal.loading': 'Loading…',
    'recordModal.loadFailed': 'The record could not be read.',
    'recordModal.notFound': 'The record is gone or you cannot see it.',
    'recordModal.retry': 'Retry',
    'recordModal.errorTitle': 'Not saved',
    'recordModal.saveFailed': 'That did not work. Try again.',
    'recordModal.savedTitle': 'Saved',
    'recordModal.saved': 'The change was recorded.',
    'recordModal.unsaved': 'Discard what you typed?',
    'recordModal.uploadFailed': 'The file could not be uploaded. Try again.',
  },
}
