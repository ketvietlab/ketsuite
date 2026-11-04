/** Shared declaration for the small stock configuration records, not stock movements. */
export type ConfigurationField = {
  name: string
  label: string
  required?: boolean
  span?: 'half' | 'full'
  defaultValue?: string
  choices?: readonly string[]
  choiceLabel?: string
  lookup?: 'locations' | 'warehouses' | 'products' | 'units' | 'routes' | 'pickingTypes' | 'people'
  /** Several values, picked in the design system's relation picker and saved as a list. */
  multiple?: boolean
  type?: 'text' | 'textarea' | 'number' | 'decimal' | 'date'
  help?: string
  /** What an emptied number posts (null clears it); without it an empty number is left out. */
  emptyValue?: number | null
  /** Set on create only: shown, not posted, once the record exists. */
  fixed?: boolean
}
export type Configuration = {
  kind: string
  title: string
  read: string
  /** What the read takes to list every record the modal may open, archived ones included. */
  readInput?: Record<string, unknown>
  save: string
  fields: ConfigurationField[]
}
export const stockConfigurations: Record<string, Configuration> = {
  warehouse: {
    kind: 'stock.warehouse',
    title: 'warehouse.create.title',
    read: 'stock.listWarehouses',
    save: 'stock.saveWarehouse',
    fields: [
      { name: 'name', label: 'warehouse.field.name', required: true },
      { name: 'code', label: 'warehouse.field.code', required: true },
      {
        name: 'receptionSteps',
        label: 'field.receptionSteps',
        defaultValue: 'one_step',
        choices: ['one_step', 'two_steps', 'three_steps'],
        choiceLabel: 'receptionSteps',
      },
      {
        name: 'deliverySteps',
        label: 'field.deliverySteps',
        defaultValue: 'ship_only',
        choices: ['ship_only', 'pick_ship', 'pick_pack_ship'],
        choiceLabel: 'deliverySteps',
      },
      {
        name: 'countFrequencyDays',
        label: 'warehouse.field.countFrequencyDays',
        type: 'number',
        help: 'warehouse.countFrequencyHelp',
        emptyValue: 0,
      },
      // K60: how delivery and internal transfers take goods.
      {
        name: 'reservationMethod',
        label: 'warehouse.field.reservationMethod',
        defaultValue: 'manual',
        choices: ['at_confirm', 'manual', 'by_date'],
        choiceLabel: 'reservationMethod',
        help: 'warehouse.reservationMethodHelp',
      },
      {
        name: 'reservationDaysBefore',
        label: 'warehouse.field.reservationDaysBefore',
        type: 'number',
        help: 'warehouse.reservationDaysBeforeHelp',
        emptyValue: 0,
      },
      {
        name: 'reservationDaysBeforePriority',
        label: 'warehouse.field.reservationDaysBeforePriority',
        type: 'number',
        help: 'warehouse.reservationDaysBeforePriorityHelp',
        emptyValue: null,
      },
      // K15 (#1428): someone assigned to one warehouse only has it chosen on a new quotation, count or scrap.
      {
        name: 'userIds',
        label: 'warehouse.field.userIds',
        lookup: 'people',
        multiple: true,
        span: 'full',
        help: 'warehouse.userIdsHelp',
      },
    ],
  },
  location: {
    kind: 'stock.location',
    title: 'location.create.title',
    read: 'stock.listLocations',
    save: 'stock.saveLocation',
    fields: [
      { name: 'name', label: 'location.field.name', required: true },
      {
        name: 'usage',
        label: 'field.usage',
        required: true,
        defaultValue: 'internal',
        choices: ['internal', 'view', 'supplier', 'customer', 'inventory', 'production', 'transit', 'scrap'],
        choiceLabel: 'usage',
      },
      { name: 'parentId', label: 'field.parentLocation', lookup: 'locations' },
      { name: 'warehouseId', label: 'field.warehouse', lookup: 'warehouses' },
    ],
  },
  'picking-type': {
    kind: 'stock.pickingType',
    title: 'pickingType.create.title',
    read: 'stock.listPickingTypes',
    save: 'stock.savePickingType',
    fields: [
      { name: 'name', label: 'pickingType.field.name', required: true },
      {
        name: 'code',
        label: 'pickingType.field.code',
        required: true,
        defaultValue: 'internal',
        choices: ['incoming', 'outgoing', 'internal'],
        choiceLabel: 'pickingType',
      },
      { name: 'warehouseId', label: 'field.warehouse', lookup: 'warehouses' },
      { name: 'defaultLocationSrcId', label: 'field.sourceLocation', lookup: 'locations' },
      { name: 'defaultLocationDestId', label: 'field.destinationLocation', lookup: 'locations' },
      {
        name: 'createBackorder',
        label: 'field.backorder',
        defaultValue: 'ask',
        choices: ['ask', 'always', 'never'],
        choiceLabel: 'backorder',
      },
    ],
  },
  lot: {
    kind: 'stock.lot',
    title: 'lot.create.title',
    read: 'stock.listLots',
    save: 'stock.saveLot',
    fields: [
      { name: 'productId', label: 'lot.field.product', lookup: 'products', required: true },
      { name: 'name', label: 'field.lotSerial', required: true },
      { name: 'ref', label: 'lot.field.reference', span: 'full' },
      { name: 'note', label: 'lot.field.description', type: 'textarea', span: 'full' },
      { name: 'manufacturingDate', label: 'lot.field.manufacturingDate', type: 'date' },
      { name: 'expirationDate', label: 'lot.field.expirationDate', type: 'date' },
      { name: 'bestBeforeDate', label: 'lot.field.bestBeforeDate', type: 'date' },
      { name: 'removalDate', label: 'lot.field.removalDate', type: 'date' },
      { name: 'alertDate', label: 'lot.field.alertDate', type: 'date' },
      {
        name: 'quarantined',
        label: 'lot.field.quarantined',
        choices: ['false', 'true'],
        choiceLabel: 'lot.quarantined',
        defaultValue: 'false',
      },
      { name: 'reason', label: 'lot.field.reason', type: 'textarea', span: 'full' },
    ],
  },
  route: {
    kind: 'stock.route',
    title: 'stockRoute.create.title',
    read: 'stock.listRoutes',
    save: 'stock.saveRoute',
    fields: [
      { name: 'name', label: 'stockRoute.field.name', required: true },
      { name: 'sequence', label: 'field.sequence', type: 'number', defaultValue: '10' },
    ],
  },
  // K45: a carrier the company ships with: its fixed code, its name, its tariff and whether it is the default.
  carrier: {
    kind: 'stock.carrier',
    title: 'carrier.create.title',
    read: 'stock.listCarriers',
    readInput: { includeArchived: true },
    save: 'stock.saveCarrier',
    fields: [
      { name: 'code', label: 'carrier.code', required: true, fixed: true, help: 'carrier.codeHelp' },
      { name: 'name', label: 'carrier.name', required: true },
      { name: 'baseFee', label: 'carrier.baseFee', type: 'decimal', required: true, defaultValue: '0' },
      {
        name: 'extraKgFee',
        label: 'carrier.extraKgFee',
        type: 'decimal',
        required: true,
        defaultValue: '0',
        help: 'carrier.tariffHelp',
      },
      {
        name: 'codFeeRate',
        label: 'carrier.codFeeRate',
        type: 'decimal',
        required: true,
        defaultValue: '0',
        help: 'carrier.codFeeRateHelp',
      },
      {
        name: 'isDefault',
        label: 'carrier.isDefault',
        choices: ['false', 'true'],
        choiceLabel: 'carrier.default',
        defaultValue: 'false',
        help: 'carrier.isDefaultHelp',
      },
    ],
  },
  replenishment: {
    kind: 'stock.replenishment',
    title: 'replenishment.create.title',
    read: 'stock.listOrderpoints',
    save: 'stock.saveOrderpoint',
    fields: [
      { name: 'productId', label: 'field.product', lookup: 'products', required: true },
      { name: 'warehouseId', label: 'field.warehouse', lookup: 'warehouses', required: true },
      { name: 'locationId', label: 'field.location', lookup: 'locations', required: true },
      {
        name: 'trigger',
        label: 'field.trigger',
        choices: ['auto', 'manual'],
        choiceLabel: 'trigger',
        defaultValue: 'manual',
      },
      { name: 'minQuantity', label: 'field.minQuantity', type: 'decimal', defaultValue: '0', required: true },
      { name: 'maxQuantity', label: 'field.maxQuantity', type: 'decimal', defaultValue: '0', required: true },
      { name: 'replenishmentUomId', label: 'field.replenishmentUom', lookup: 'units' },
      { name: 'routeId', label: 'field.route', lookup: 'routes' },
    ],
  },
}
