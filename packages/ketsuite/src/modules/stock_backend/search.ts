// What the search-filter bar offers on each stock list.
//
// These lists read a complete, authorised collection and narrow it in memory,
// so a preset is a predicate rather than an expression — see `row-list.ts`. A
// spec describes only the columns its list actually shows, because a filter on
// a column the reader cannot see explains nothing about the rows that remain.
//
// Labels are message keys: the bar resolves one when the catalogue has it and
// otherwise shows the text as written.
import { defineRowList } from '../backend/row-list.ts'
import { TRANSFER_STATUSES } from './transfer-status.ts'

const RECEPTION_STEPS = ['one_step', 'two_steps', 'three_steps'] as const
const DELIVERY_STEPS = ['ship_only', 'pick_ship', 'pick_pack_ship'] as const

export const warehouseListSearch = defineRowList({
  key: 'stock.warehouses',
  searchable: [{ key: 'name' }, { key: 'code' }],
  filterable: [
    { key: 'name', label: 'stock_backend.warehouse.col.name', type: 'text' },
    { key: 'code', label: 'stock_backend.warehouse.col.code', type: 'text' },
    {
      key: 'receptionSteps',
      label: 'stock_backend.warehouse.col.reception',
      type: 'selection',
      choices: RECEPTION_STEPS,
    },
    {
      key: 'deliverySteps',
      label: 'stock_backend.warehouse.col.delivery',
      type: 'selection',
      choices: DELIVERY_STEPS,
    },
  ],
  groupable: [
    { key: 'receptionSteps', label: 'stock_backend.warehouse.col.reception' },
    { key: 'deliverySteps', label: 'stock_backend.warehouse.col.delivery' },
  ],
  sortable: [
    { key: 'locationCount', label: 'stock_backend.warehouse.col.locations' },
    { key: 'transferCount', label: 'stock_backend.warehouse.col.transfers' },
    { key: 'name', label: 'stock_backend.warehouse.col.name' },
    { key: 'code', label: 'stock_backend.warehouse.col.code' },
  ],
  presets: [
    // The step counts a warehouse is configured for, which is the question the
    // list is opened to answer far more often than any single warehouse's name.
    {
      key: 'directReception',
      label: 'stock_backend.receptionSteps.one_step',
      group: 'reception',
      match: (row) => row.receptionSteps === 'one_step',
    },
    {
      key: 'stagedReception',
      label: 'stock_backend.warehouse.filter.stagedReception',
      group: 'reception',
      match: (row) => row.receptionSteps !== 'one_step',
    },
    {
      key: 'directDelivery',
      label: 'stock_backend.deliverySteps.ship_only',
      group: 'delivery',
      match: (row) => row.deliverySteps === 'ship_only',
    },
    {
      key: 'stagedDelivery',
      label: 'stock_backend.warehouse.filter.stagedDelivery',
      group: 'delivery',
      match: (row) => row.deliverySteps !== 'ship_only',
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

/** The preset of each operation kind, which its sidebar entry opens (K21). */
export const TRANSFER_KINDS = { incoming: 'receipts', outgoing: 'deliveries', internal: 'internal' } as const

export const transferListSearch = defineRowList({
  key: 'stock.transfers',
  searchable: [
    { key: 'name' },
    { key: 'operationType' },
    { key: 'source' },
    { key: 'destination' },
    { key: 'scheduledDate' },
    { key: 'state' },
  ],
  filterable: [
    { key: 'name', label: 'stock_backend.transfer.list.col.reference', type: 'text' },
    { key: 'operationType', label: 'stock_backend.transfer.list.col.operationType', type: 'text' },
    { key: 'warehouse', label: 'stock_backend.field.warehouse', type: 'text' },
    { key: 'source', label: 'stock_backend.transfer.list.col.source', type: 'text' },
    { key: 'destination', label: 'stock_backend.transfer.list.col.destination', type: 'text' },
    { key: 'scheduledDate', label: 'stock_backend.transfer.list.col.scheduledDate', type: 'text' },
    {
      key: 'state',
      label: 'stock_backend.transfer.list.col.state',
      type: 'selection',
      choices: TRANSFER_STATUSES,
    },
  ],
  groupable: [
    { key: 'state', label: 'stock_backend.transfer.list.col.state' },
    { key: 'operationType', label: 'stock_backend.transfer.list.col.operationType' },
    { key: 'source', label: 'stock_backend.transfer.list.col.source' },
    { key: 'destination', label: 'stock_backend.transfer.list.col.destination' },
  ],
  sortable: [
    { key: 'name', label: 'stock_backend.transfer.list.col.reference' },
    { key: 'scheduledDate', label: 'stock_backend.transfer.list.col.scheduledDate' },
    { key: 'state', label: 'stock_backend.transfer.list.col.state' },
    // K18: the warehouse's work order, which the list opens on.
    { key: 'queue', label: 'stock_backend.transfer.list.col.queue' },
  ],
  presets: [
    // What a warehouse team opens the list for: what is still to do, what is
    // waiting on stock, and what is finished.
    // Receipts, deliveries and internal transfers each have a sidebar entry (K21).
    ...(['incoming', 'outgoing', 'internal'] as const).map((code) => ({
      key: TRANSFER_KINDS[code],
      label: `stock_backend.transfer.kind.${code}`,
      group: 'kind',
      match: (row: Record<string, unknown>) => row.kind === code,
    })),
    {
      key: 'ready',
      label: 'stock_backend.state.assigned',
      group: 'state',
      match: (row) => row.state === 'assigned',
    },
    {
      key: 'waiting',
      label: 'stock_backend.state.waiting',
      group: 'state',
      match: (row) => row.state === 'waiting',
    },
    {
      key: 'draft',
      label: 'stock_backend.state.draft',
      group: 'state',
      match: (row) => row.state === 'draft',
    },
    { key: 'done', label: 'stock_backend.state.done', group: 'state', match: (row) => row.state === 'done' },
    {
      key: 'cancelled',
      label: 'stock_backend.state.cancel',
      group: 'state',
      match: (row) => row.state === 'cancel',
    },
  ],
  defaultSort: [{ key: 'queue', dir: 'asc' }],
})

const LOCATION_USAGES = [
  'internal',
  'view',
  'supplier',
  'customer',
  'inventory',
  'production',
  'transit',
  'scrap',
] as const

export const locationListSearch = defineRowList({
  key: 'stock.locations',
  searchable: [{ key: 'parentLocation' }, { key: 'completeName' }, { key: 'usage' }, { key: 'warehouse' }],
  filterable: [
    { key: 'completeName', label: 'stock_backend.location.col.location', type: 'text' },
    {
      key: 'usage',
      label: 'stock_backend.location.col.usage',
      type: 'selection',
      choices: LOCATION_USAGES,
    },
    { key: 'warehouse', label: 'stock_backend.location.col.warehouse', type: 'text' },
  ],
  groupable: [
    { key: 'usage', label: 'stock_backend.location.col.usage' },
    { key: 'warehouse', label: 'stock_backend.location.col.warehouse' },
  ],
  sortable: [
    { key: 'parentLocation', label: 'stock_backend.location.col.parent' },
    { key: 'productCount', label: 'stock_backend.location.col.products' },

    { key: 'completeName', label: 'stock_backend.location.col.location' },
    { key: 'usage', label: 'stock_backend.location.col.usage' },
  ],
  presets: [
    // Internal and transit locations are the ones that hold company stock; the
    // rest are counterparties and accounting destinations.
    {
      key: 'stockHolding',
      label: 'stock_backend.location.filter.stockHolding',
      group: 'usage',
      match: (row) => ['internal', 'transit'].includes(String(row.usage)),
    },
    {
      key: 'counterparty',
      label: 'stock_backend.location.filter.counterparty',
      group: 'usage',
      match: (row) => ['supplier', 'customer'].includes(String(row.usage)),
    },
    {
      key: 'virtual',
      label: 'stock_backend.location.filter.virtual',
      group: 'usage',
      match: (row) => ['view', 'inventory', 'production'].includes(String(row.usage)),
    },
  ],
  defaultSort: [{ key: 'completeName', dir: 'asc' }],
})

const PICKING_CODES = ['incoming', 'outgoing', 'internal'] as const
const BACKORDER_POLICIES = ['ask', 'always', 'never'] as const

export const pickingTypeListSearch = defineRowList({
  key: 'stock.picking-types',
  searchable: [
    { key: 'name' },
    { key: 'code' },
    { key: 'warehouse' },
    { key: 'source' },
    { key: 'destination' },
  ],
  filterable: [
    { key: 'name', label: 'stock_backend.pickingType.col.name', type: 'text' },
    { key: 'code', label: 'stock_backend.pickingType.col.code', type: 'selection', choices: PICKING_CODES },
    { key: 'warehouse', label: 'stock_backend.pickingType.col.warehouse', type: 'text' },
    {
      key: 'createBackorder',
      label: 'stock_backend.pickingType.col.backorder',
      type: 'selection',
      choices: BACKORDER_POLICIES,
    },
  ],
  groupable: [
    { key: 'code', label: 'stock_backend.pickingType.col.code' },
    { key: 'warehouse', label: 'stock_backend.pickingType.col.warehouse' },
    { key: 'createBackorder', label: 'stock_backend.pickingType.col.backorder' },
  ],
  sortable: [
    { key: 'name', label: 'stock_backend.pickingType.col.name' },
    { key: 'code', label: 'stock_backend.pickingType.col.code' },
  ],
  presets: PICKING_CODES.map((code) => ({
    key: code,
    label: `stock_backend.pickingType.${code}`,
    group: 'code',
    match: (row: Record<string, unknown>) => row.code === code,
  })),
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

const LOT_CONDITIONS = ['quarantined', 'depleted', 'expired', 'expiring', 'valid', 'noExpiry'] as const
export const lotListSearch = defineRowList({
  key: 'stock.lots',
  searchable: [{ key: 'name' }, { key: 'product' }, { key: 'reference' }],
  filterable: [
    { key: 'name', label: 'stock_backend.lot.list.col.name', type: 'text' },
    { key: 'product', label: 'stock_backend.lot.list.col.product', type: 'text' },
    { key: 'reference', label: 'stock_backend.lot.list.col.reference', type: 'text' },
    { key: 'onHandValue', label: 'stock_backend.lot.list.col.onHand', type: 'number' },
    // Naming `active` is what offers the reader archived lots at all.
    { key: 'active', label: 'stock_backend.lot.list.col.status', type: 'boolean' },
    // K51: the warehouses holding some of the lot.
    { key: 'warehouses', label: 'stock_backend.field.warehouse', type: 'text' },
  ],
  groupable: [{ key: 'product', label: 'stock_backend.lot.list.col.product' }],
  sortable: [
    { key: 'name', label: 'stock_backend.lot.list.col.name' },
    { key: 'product', label: 'stock_backend.lot.list.col.product' },
    { key: 'onHandValue', label: 'stock_backend.lot.list.col.onHand' },
  ],
  presets: [
    {
      key: 'inStock',
      label: 'stock_backend.lot.filter.inStock',
      group: 'onHand',
      match: (row) => Number(row.onHandValue ?? 0) > 0,
    },
    {
      key: 'empty',
      label: 'stock_backend.lot.filter.empty',
      group: 'onHand',
      match: (row) => Number(row.onHandValue ?? 0) <= 0,
    },
    // K28: what each lot is fit for today.
    ...LOT_CONDITIONS.map((condition) => ({
      key: condition,
      label: `stock_backend.lot.condition.${condition}`,
      group: 'condition',
      match: (row: Record<string, unknown>) => row.condition === condition,
    })),
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

export const stockRouteListSearch = defineRowList({
  key: 'stock.routes',
  searchable: [{ key: 'sources' }, { key: 'destinations' }, { key: 'ruleActions' }, { key: 'name' }],
  filterable: [
    { key: 'name', label: 'stock_backend.stockRoute.list.col.name', type: 'text' },
    { key: 'sequence', label: 'stock_backend.stockRoute.list.col.sequence', type: 'number' },
    { key: 'ruleCount', label: 'stock_backend.stockRoute.list.col.rules', type: 'number' },
  ],
  sortable: [
    { key: 'sources', label: 'stock_backend.stockRoute.list.col.sources' },
    { key: 'destinations', label: 'stock_backend.stockRoute.list.col.destinations' },
    { key: 'ruleActions', label: 'stock_backend.stockRoute.list.col.actions' },

    { key: 'sequence', label: 'stock_backend.stockRoute.list.col.sequence' },
    { key: 'name', label: 'stock_backend.stockRoute.list.col.name' },
  ],
  presets: [
    {
      key: 'configured',
      label: 'stock_backend.stockRoute.filter.configured',
      group: 'rules',
      match: (row) => Number(row.ruleCount ?? 0) > 0,
    },
    {
      key: 'unconfigured',
      label: 'stock_backend.stockRoute.filter.unconfigured',
      group: 'rules',
      match: (row) => Number(row.ruleCount ?? 0) === 0,
    },
  ],
  defaultSort: [{ key: 'sequence', dir: 'asc' }],
})

const TRIGGERS = ['auto', 'manual'] as const

export const replenishmentListSearch = defineRowList({
  key: 'stock.replenishment',
  searchable: [
    { key: 'product' },
    { key: 'warehouse' },
    { key: 'location' },
    { key: 'triggerLabel' },
    { key: 'replenishmentUom' },
  ],
  filterable: [
    { key: 'product', label: 'stock_backend.replenishment.col.product', type: 'text' },
    { key: 'warehouse', label: 'stock_backend.field.warehouse', type: 'text' },
    { key: 'location', label: 'stock_backend.field.location', type: 'text' },
    { key: 'trigger', label: 'stock_backend.field.trigger', type: 'selection', choices: TRIGGERS },
    { key: 'minQuantity', label: 'stock_backend.field.minQuantity', type: 'number' },
    { key: 'maxQuantity', label: 'stock_backend.field.maxQuantity', type: 'number' },
    { key: 'toOrder', label: 'stock_backend.replenishment.col.toOrder', type: 'number' },
  ],
  groupable: [
    { key: 'warehouse', label: 'stock_backend.field.warehouse' },
    { key: 'trigger', label: 'stock_backend.field.trigger' },
    { key: 'location', label: 'stock_backend.field.location' },
  ],
  sortable: [
    { key: 'product', label: 'stock_backend.replenishment.col.product' },
    { key: 'toOrder', label: 'stock_backend.replenishment.col.toOrder' },
  ],
  presets: [
    // A replenishment list is read to find what must be ordered now.
    {
      key: 'toOrder',
      label: 'stock_backend.replenishment.filter.toOrder',
      group: 'order',
      match: (row) => Number(row.toOrder ?? 0) > 0,
    },
    {
      key: 'covered',
      label: 'stock_backend.replenishment.filter.covered',
      group: 'order',
      match: (row) => Number(row.toOrder ?? 0) <= 0,
    },
    ...TRIGGERS.map((trigger) => ({
      key: trigger,
      label: `stock_backend.trigger.${trigger}`,
      group: 'trigger',
      match: (row: Record<string, unknown>) => row.trigger === trigger,
    })),
  ],
  defaultSort: [{ key: 'product', dir: 'asc' }],
})

const FORECAST_STATUSES = ['short', 'belowMin', 'ok'] as const

// K40: what runs short first, by the day it does, then what falls below its minimum, then the rest.
export const forecastListSearch = defineRowList({
  key: 'stock.forecast',
  searchable: [{ key: 'product' }, { key: 'warehouse' }],
  filterable: [
    { key: 'product', label: 'stock_backend.forecast.col.product', type: 'text' },
    { key: 'warehouse', label: 'stock_backend.field.warehouse', type: 'text' },
    { key: 'forecast', label: 'stock_backend.forecast.value', type: 'number' },
  ],
  groupable: [
    { key: 'warehouse', label: 'stock_backend.field.warehouse' },
    { key: 'status', label: 'stock_backend.forecast.col.status' },
  ],
  sortable: [
    { key: 'queue', label: 'stock_backend.forecast.col.status' },
    { key: 'product', label: 'stock_backend.forecast.col.product' },
    { key: 'forecast', label: 'stock_backend.forecast.value' },
  ],
  presets: FORECAST_STATUSES.map((status) => ({
    key: status,
    label: `stock_backend.forecast.status.${status}`,
    group: 'status',
    match: (row: Record<string, unknown>) => row.status === status,
  })),
  defaultSort: [{ key: 'queue', dir: 'asc' }],
})

export const inventoryListSearch = defineRowList({
  key: 'stock.inventory',
  searchable: [{ key: 'product' }, { key: 'reference' }, { key: 'location' }, { key: 'lot' }],
  filterable: [
    { key: 'product', label: 'stock_backend.inventory.col.product', type: 'text' },
    { key: 'location', label: 'stock_backend.inventory.col.location', type: 'text' },
    { key: 'available', label: 'stock_backend.inventory.col.available', type: 'number' },
  ],
  groupable: [{ key: 'location', label: 'stock_backend.inventory.col.location' }],
  sortable: [
    { key: 'product', label: 'stock_backend.inventory.col.product' },
    { key: 'available', label: 'stock_backend.inventory.col.available' },
  ],
  presets: [
    // K13: whether anything is left to sell, all of it is held, or nothing is left.
    {
      key: 'available',
      label: 'stock_backend.inventory.filter.available',
      group: 'availability',
      match: (row) => Number(row.available) > 0,
    },
    {
      key: 'reserved',
      label: 'stock_backend.inventory.col.reserved',
      group: 'availability',
      match: (row) => Number(row.reserved) > 0,
    },
    {
      key: 'fullyReserved',
      label: 'stock_backend.inventory.filter.fullyReserved',
      group: 'availability',
      match: (row) => Number(row.quantity) > 0 && Number(row.available) <= 0 && row.blocked !== true,
    },
    {
      key: 'outOfStock',
      label: 'stock_backend.inventory.filter.outOfStock',
      group: 'availability',
      match: (row) => Number(row.quantity) <= 0,
    },
    // K28: expired, removed or quarantined lots still counted on hand.
    {
      key: 'blocked',
      label: 'stock_backend.inventory.filter.blocked',
      group: 'availability',
      match: (row) => row.blocked === true,
    },
  ],
})

// K26: one row per product held. The warehouse is not a row filter: a warehouse shows its own quantity
// at the company average, so the read is asked again rather than narrowed.
export const valuationListSearch = defineRowList({
  key: 'stock.valuation',
  searchable: [{ key: 'code' }, { key: 'name' }],
  filterable: [
    { key: 'name', label: 'stock_backend.valuation.col.name', type: 'text' },
    { key: 'value', label: 'stock_backend.valuation.col.value', type: 'number' },
  ],
  groupable: [],
  sortable: [
    { key: 'code', label: 'stock_backend.valuation.col.code' },
    { key: 'name', label: 'stock_backend.valuation.col.name' },
    { key: 'quantity', label: 'stock_backend.valuation.col.quantity' },
    { key: 'averageCost', label: 'stock_backend.valuation.col.averageCost' },
    { key: 'value', label: 'stock_backend.valuation.col.value' },
  ],
  presets: [],
})

// K59: scrap orders, drafts first. The warehouse narrows the read like a filter menu, not a column.
export const scrapListSearch = defineRowList({
  key: 'stock.scraps',
  searchable: [{ key: 'name' }, { key: 'product' }, { key: 'lot' }, { key: 'warehouse' }],
  filterable: [
    { key: 'name', label: 'stock_backend.scrap.col.name', type: 'text' },
    { key: 'product', label: 'stock_backend.scrap.col.product', type: 'text' },
    {
      key: 'state',
      label: 'stock_backend.scrap.col.state',
      type: 'selection',
      choices: ['draft', 'done', 'reversed', 'cancel'],
    },
    {
      key: 'reason',
      label: 'stock_backend.scrap.col.reason',
      type: 'selection',
      choices: ['expired', 'damaged', 'failedTest', 'lost', 'other'],
    },
  ],
  groupable: [],
  sortable: [
    { key: 'name', label: 'stock_backend.scrap.col.name' },
    { key: 'date', label: 'stock_backend.scrap.col.date' },
    { key: 'product', label: 'stock_backend.scrap.col.product' },
    { key: 'quantity', label: 'stock_backend.scrap.col.quantity' },
  ],
  presets: [],
})

/** K64: landed costs, searched by number, vendor and the receipts they land on. */
export const landedCostListSearch = defineRowList({
  key: 'stock.landed-costs',
  searchable: [{ key: 'name' }, { key: 'vendor' }, { key: 'receipts' }],
  filterable: [
    { key: 'name', label: 'stock_backend.landedCost.col.name', type: 'text' },
    { key: 'vendor', label: 'stock_backend.landedCost.col.vendor', type: 'text' },
    {
      key: 'state',
      label: 'stock_backend.landedCost.col.state',
      type: 'selection',
      choices: ['draft', 'posted', 'cancel'],
    },
  ],
  groupable: [],
  sortable: [
    { key: 'name', label: 'stock_backend.landedCost.col.name' },
    { key: 'date', label: 'stock_backend.landedCost.col.date' },
    { key: 'vendor', label: 'stock_backend.landedCost.col.vendor' },
    { key: 'total', label: 'stock_backend.landedCost.col.total' },
  ],
  presets: [],
})

/** K48: the delivery queue, searched by delivery, customer and order. */
export const dispatchListSearch = defineRowList({
  key: 'stock.delivery-dispatch',
  searchable: [{ key: 'name' }, { key: 'partner' }, { key: 'order' }, { key: 'shipment' }],
  filterable: [
    { key: 'warehouse', label: 'stock_backend.delivery.warehouse', type: 'text' },
    {
      key: 'status',
      label: 'stock_backend.delivery.status',
      type: 'selection',
      choices: ['toHandOver', 'toBook', 'noShipment', 'waiting'],
    },
  ],
  groupable: [],
  sortable: [
    { key: 'name', label: 'stock_backend.delivery.picking' },
    { key: 'scheduled', label: 'stock_backend.delivery.scheduled' },
    { key: 'partner', label: 'stock_backend.delivery.customer' },
  ],
  presets: [],
})

/** K48: the parcels, searched by number, tracking code, customer and delivery. */
export const shipmentListSearch = defineRowList({
  key: 'stock.delivery-shipments',
  searchable: [{ key: 'name' }, { key: 'tracking' }, { key: 'partner' }, { key: 'picking' }],
  filterable: [
    { key: 'warehouse', label: 'stock_backend.delivery.warehouse', type: 'text' },
    { key: 'carrier', label: 'stock_backend.delivery.carrier', type: 'text' },
    {
      key: 'status',
      label: 'stock_backend.delivery.status',
      type: 'selection',
      choices: ['draft', 'booked', 'shipping', 'delivered', 'failed', 'returned', 'cancel'],
    },
  ],
  groupable: [],
  sortable: [
    { key: 'name', label: 'stock_backend.shipment.name' },
    { key: 'partner', label: 'stock_backend.delivery.customer' },
    { key: 'cod', label: 'stock_backend.delivery.cod' },
  ],
  presets: [],
})

/** K47: carriers' statements, searched by number and carrier. */
export const deliveryStatementListSearch = defineRowList({
  key: 'stock.delivery-statements',
  searchable: [{ key: 'name' }, { key: 'carrier' }],
  filterable: [
    { key: 'carrier', label: 'stock_backend.delivery.carrier', type: 'text' },
    {
      key: 'status',
      label: 'stock_backend.delivery.status',
      type: 'selection',
      choices: ['draft', 'posted', 'paid', 'cancel'],
    },
  ],
  groupable: [],
  sortable: [
    { key: 'name', label: 'stock_backend.statement.name' },
    { key: 'date', label: 'stock_backend.statement.date' },
    { key: 'net', label: 'stock_backend.statement.net' },
  ],
  presets: [],
})

/** K45: carriers, searched by code and name. */
export const carrierListSearch = defineRowList({
  key: 'stock.delivery-carriers',
  searchable: [{ key: 'code' }, { key: 'name' }],
  filterable: [
    {
      key: 'status',
      label: 'stock_backend.delivery.status',
      type: 'selection',
      choices: ['active', 'archived'],
    },
  ],
  groupable: [],
  sortable: [
    { key: 'code', label: 'stock_backend.carrier.code' },
    { key: 'name', label: 'stock_backend.carrier.name' },
  ],
  presets: [],
})

/** K38: physical counts, searched by number and warehouse. */
export const countListSearch = defineRowList({
  key: 'stock.counts',
  searchable: [{ key: 'name' }, { key: 'warehouse' }],
  filterable: [
    { key: 'name', label: 'stock_backend.count.col.name', type: 'text' },
    { key: 'warehouse', label: 'stock_backend.count.col.warehouse', type: 'text' },
    {
      key: 'state',
      label: 'stock_backend.count.col.state',
      type: 'selection',
      choices: ['counting', 'review', 'done', 'cancel'],
    },
  ],
  groupable: [],
  sortable: [
    { key: 'name', label: 'stock_backend.count.col.name' },
    { key: 'warehouse', label: 'stock_backend.count.col.warehouse' },
    { key: 'date', label: 'stock_backend.count.col.date' },
    { key: 'lines', label: 'stock_backend.count.col.lines' },
  ],
  // K51: counts waiting for the manager's approval.
  presets: [
    {
      key: 'unsettled',
      label: 'stock_backend.count.pendingSettlement',
      group: 'state',
      match: (row) => row.state === 'done' && row.settlementState !== 'done',
    },
    {
      key: 'review',
      label: 'stock_backend.count.state.review',
      group: 'state',
      match: (row) => row.state === 'review',
    },
  ],
})

// K63: every line of every transfer, done or not. A date column narrows the period; the state presets keep
// what the reader asks about, which is usually what was done.
export const MOVE_KINDS = [
  'receipt',
  'delivery',
  'internal',
  'return',
  'adjustment',
  'scrap',
  'scrapUndo',
] as const
/** The states a stock move is stored in, which the move analysis shows as they are. */
const MOVE_STATES = [
  'draft',
  'waiting',
  'confirmed',
  'partially_available',
  'assigned',
  'done',
  'cancel',
] as const

export const moveAnalysisListSearch = defineRowList({
  key: 'stock.move-analysis',
  searchable: [{ key: 'pickingName' }, { key: 'code' }, { key: 'product' }],
  filterable: [
    { key: 'date', label: 'stock_backend.analysis.col.date', type: 'date' },
    { key: 'pickingName', label: 'stock_backend.analysis.col.picking', type: 'text' },
    { key: 'product', label: 'stock_backend.analysis.col.product', type: 'text' },
    { key: 'kind', label: 'stock_backend.analysis.col.kind', type: 'selection', choices: MOVE_KINDS },
    { key: 'state', label: 'stock_backend.analysis.col.state', type: 'selection', choices: MOVE_STATES },
    { key: 'value', label: 'stock_backend.analysis.col.value', type: 'number' },
  ],
  groupable: [
    { key: 'date', label: 'stock_backend.analysis.col.date', intervals: ['month', 'week', 'day'] },
    { key: 'product', label: 'stock_backend.analysis.col.product' },
    { key: 'kind', label: 'stock_backend.analysis.col.kind' },
    { key: 'state', label: 'stock_backend.analysis.col.state' },
  ],
  sortable: [
    { key: 'date', label: 'stock_backend.analysis.col.date' },
    { key: 'pickingName', label: 'stock_backend.analysis.col.picking' },
    { key: 'product', label: 'stock_backend.analysis.col.product' },
    { key: 'value', label: 'stock_backend.analysis.col.value' },
    { key: 'remaining', label: 'stock_backend.analysis.col.remaining' },
  ],
  defaultSort: [{ key: 'date', dir: 'desc' }],
  presets: [
    { key: 'done', label: 'stock_backend.state.done', group: 'state', match: (row) => row.state === 'done' },
    {
      key: 'open',
      label: 'stock_backend.analysis.filter.open',
      group: 'state',
      match: (row) => !['done', 'cancel'].includes(String(row.state)),
    },
    {
      key: 'cancel',
      label: 'stock_backend.state.cancel',
      group: 'state',
      match: (row) => row.state === 'cancel',
    },
    {
      key: 'left',
      label: 'stock_backend.analysis.filter.left',
      group: 'left',
      match: (row) => Number(row.remaining ?? 0) > 0,
    },
  ],
})

// K52: every line a finished transfer moved, one a lot, newest first. The period presets read the company's
// month; the menu opens the current one.
export const moveHistoryListSearch = defineRowList({
  key: 'stock.move-history',
  searchable: [{ key: 'pickingName' }, { key: 'code' }, { key: 'name' }, { key: 'lot' }],
  filterable: [
    { key: 'date', label: 'stock_backend.history.col.date', type: 'date' },
    { key: 'pickingName', label: 'stock_backend.history.col.picking', type: 'text' },
    { key: 'product', label: 'stock_backend.history.col.product', type: 'text' },
    { key: 'lot', label: 'stock_backend.history.col.lot', type: 'text' },
    { key: 'from', label: 'stock_backend.history.col.from', type: 'text' },
    { key: 'to', label: 'stock_backend.history.col.to', type: 'text' },
    { key: 'kind', label: 'stock_backend.history.col.kind', type: 'selection', choices: MOVE_KINDS },
  ],
  groupable: [
    { key: 'date', label: 'stock_backend.history.col.date', intervals: ['month', 'week', 'day'] },
    { key: 'product', label: 'stock_backend.history.col.product' },
    { key: 'kind', label: 'stock_backend.history.col.kind' },
  ],
  sortable: [
    { key: 'doneAt', label: 'stock_backend.history.col.date' },
    { key: 'pickingName', label: 'stock_backend.history.col.picking' },
    { key: 'product', label: 'stock_backend.history.col.product' },
    { key: 'quantity', label: 'stock_backend.history.col.quantity' },
  ],
  defaultSort: [{ key: 'doneAt', dir: 'desc' }],
  presets: [
    {
      key: 'thisMonth',
      label: 'stock_backend.history.filter.thisMonth',
      group: 'period',
      match: (row) => row.period === 'current',
    },
    {
      key: 'lastMonth',
      label: 'stock_backend.history.filter.lastMonth',
      group: 'period',
      match: (row) => row.period === 'previous',
    },
    ...MOVE_KINDS.map((kind) => ({
      key: kind,
      label: `stock_backend.analysis.kind.${kind}`,
      group: 'kind',
      match: (row: Record<string, unknown>) => row.kind === kind,
    })),
  ],
})

// K63: a row a product a warehouse holds, split by how long ago it came in.
export const agingListSearch = defineRowList({
  key: 'stock.aging',
  searchable: [{ key: 'code' }, { key: 'name' }, { key: 'warehouse' }],
  filterable: [
    { key: 'name', label: 'stock_backend.aging.col.name', type: 'text' },
    { key: 'warehouse', label: 'stock_backend.aging.col.warehouse', type: 'text' },
    { key: 'oldest', label: 'stock_backend.aging.col.oldest', type: 'date' },
    { key: 'ageOlder', label: 'stock_backend.aging.col.ageOlder', type: 'number' },
    { key: 'value', label: 'stock_backend.aging.col.value', type: 'number' },
  ],
  groupable: [
    { key: 'warehouse', label: 'stock_backend.aging.col.warehouse' },
    { key: 'name', label: 'stock_backend.aging.col.name' },
  ],
  sortable: [
    { key: 'code', label: 'stock_backend.aging.col.code' },
    { key: 'name', label: 'stock_backend.aging.col.name' },
    { key: 'quantity', label: 'stock_backend.aging.col.quantity' },
    { key: 'ageOlder', label: 'stock_backend.aging.col.ageOlder' },
    { key: 'oldest', label: 'stock_backend.aging.col.oldest' },
    { key: 'value', label: 'stock_backend.aging.col.value' },
  ],
  presets: [
    {
      key: 'older',
      label: 'stock_backend.aging.filter.older',
      group: 'age',
      match: (row) => Number(row.ageOlder ?? 0) > 0,
    },
  ],
})
