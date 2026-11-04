// What the search-filter bar offers on the manufacturing lists.
//
// All three read a bounded collection the route already holds, so each spec
// covers exactly the columns its table renders. Production orders are the one
// list read by status, and so the one list with presets over a state.
import { defineRowList } from '../backend/row-list.ts'

const PRODUCTION_STATES = ['draft', 'confirmed', 'in_progress', 'to_close', 'done', 'cancelled'] as const

/** Where an order came from: a sale, a reorder rule, or someone's hands. */
export const ORDER_SOURCES = ['sale', 'rule', 'manual'] as const

export const productionListSearch = defineRowList({
  key: 'manufacturing.orders',
  searchable: [{ key: 'name' }, { key: 'product' }],
  filterable: [
    { key: 'name', label: 'manufacturing_backend.field.name', type: 'text' },
    { key: 'product', label: 'manufacturing_backend.field.product', type: 'text' },
    { key: 'quantity', label: 'manufacturing_backend.field.quantity', type: 'number' },
    {
      key: 'state',
      label: 'manufacturing_backend.field.state',
      type: 'selection',
      choices: PRODUCTION_STATES,
    },
    {
      key: 'material',
      label: 'manufacturing_backend.field.material',
      type: 'selection',
      choices: ['ready', 'waiting', 'short'],
    },
    // P12: a filter, not a column; one more column overflows the list at 1440 (Q8).
    {
      key: 'orderSource',
      label: 'manufacturing_backend.field.orderSource',
      type: 'selection',
      choices: ORDER_SOURCES,
    },
  ],
  groupable: [
    { key: 'state', label: 'manufacturing_backend.field.state' },
    { key: 'product', label: 'manufacturing_backend.field.product' },
    { key: 'material', label: 'manufacturing_backend.field.material' },
    { key: 'orderSource', label: 'manufacturing_backend.field.orderSource' },
  ],
  sortable: [
    { key: 'queue', label: 'manufacturing_backend.field.queue' },
    { key: 'name', label: 'manufacturing_backend.field.name' },
    { key: 'product', label: 'manufacturing_backend.field.product' },
  ],
  presets: PRODUCTION_STATES.map((state) => ({
    key: state,
    label: `manufacturing_backend.state.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  // The floor's order: in progress, confirmed, drafts, then the rest (`manufacturing.productionQueue`).
  defaultSort: [{ key: 'queue', dir: 'asc' }],
})

const WORK_STATES = ['pending', 'ready', 'in_progress', 'paused', 'done'] as const

export const workOrderListSearch = defineRowList({
  key: 'manufacturing.work',
  searchable: [{ key: 'order' }, { key: 'name' }, { key: 'operator' }],
  filterable: [
    { key: 'order', label: 'manufacturing_backend.work.order', type: 'text' },
    { key: 'name', label: 'manufacturing_backend.field.operation', type: 'text' },
    { key: 'workCenter', label: 'manufacturing_backend.work.center', type: 'text' },
    { key: 'operator', label: 'manufacturing_backend.work.operator', type: 'text' },
    { key: 'minutes', label: 'manufacturing_backend.work.minutes', type: 'number' },
    { key: 'state', label: 'manufacturing_backend.field.state', type: 'selection', choices: WORK_STATES },
  ],
  groupable: [
    { key: 'workCenter', label: 'manufacturing_backend.work.center' },
    { key: 'operator', label: 'manufacturing_backend.work.operator' },
    { key: 'state', label: 'manufacturing_backend.field.state' },
  ],
  sortable: [
    { key: 'queue', label: 'manufacturing_backend.field.queue' },
    { key: 'order', label: 'manufacturing_backend.work.order' },
    { key: 'minutes', label: 'manufacturing_backend.work.minutes' },
  ],
  presets: WORK_STATES.map((state) => ({
    key: state,
    label: `manufacturing_backend.workState.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  // Open operations as a worker takes them (`manufacturing.listWorkOrders`).
  defaultSort: [{ key: 'queue', dir: 'asc' }],
})

export const varianceListSearch = defineRowList({
  key: 'manufacturing.consumption-variance',
  searchable: [{ key: 'order' }, { key: 'component' }],
  filterable: [
    { key: 'order', label: 'manufacturing_backend.variance.order', type: 'text' },
    { key: 'component', label: 'manufacturing_backend.field.component', type: 'text' },
    { key: 'difference', label: 'manufacturing_backend.variance.difference', type: 'number' },
    {
      key: 'standing',
      label: 'manufacturing_backend.variance.standing',
      type: 'selection',
      choices: ['over', 'within', 'under'],
    },
  ],
  groupable: [
    { key: 'order', label: 'manufacturing_backend.variance.order' },
    { key: 'component', label: 'manufacturing_backend.field.component' },
    { key: 'standing', label: 'manufacturing_backend.variance.standing' },
  ],
  sortable: [
    { key: 'rank', label: 'manufacturing_backend.variance.rank' },
    { key: 'difference', label: 'manufacturing_backend.variance.difference' },
    { key: 'order', label: 'manufacturing_backend.variance.order' },
  ],
  presets: (['over', 'within', 'under'] as const).map((standing) => ({
    key: standing,
    label: `manufacturing_backend.variance.${standing}`,
    group: 'standing',
    match: (row: Record<string, unknown>) => row.standing === standing,
  })),
  // Used past the BOM first, then by how far (`manufacturing.consumptionVariance`).
  defaultSort: [{ key: 'rank', dir: 'asc' }],
})

export const bomListSearch = defineRowList({
  key: 'manufacturing.boms',
  searchable: [{ key: 'code' }, { key: 'product' }],
  filterable: [
    { key: 'code', label: 'manufacturing_backend.field.code', type: 'text' },
    { key: 'product', label: 'manufacturing_backend.field.product', type: 'text' },
    { key: 'quantity', label: 'manufacturing_backend.field.quantity', type: 'number' },
    {
      key: 'state',
      label: 'manufacturing_backend.field.state',
      type: 'selection',
      choices: ['draft', 'review', 'active', 'archived'],
    },
  ],
  groupable: [
    { key: 'product', label: 'manufacturing_backend.field.product' },
    { key: 'state', label: 'manufacturing_backend.field.state' },
  ],
  sortable: [
    { key: 'code', label: 'manufacturing_backend.field.code' },
    { key: 'product', label: 'manufacturing_backend.field.product' },
  ],
  defaultSort: [{ key: 'code', dir: 'asc' }],
})

export const workCenterListSearch = defineRowList({
  key: 'manufacturing.work-centers',
  searchable: [{ key: 'name' }, { key: 'code' }],
  filterable: [
    { key: 'name', label: 'manufacturing_backend.field.name', type: 'text' },
    { key: 'code', label: 'manufacturing_backend.field.code', type: 'text' },
    { key: 'capacity', label: 'manufacturing_backend.field.capacity', type: 'number' },
    { key: 'timeEfficiency', label: 'manufacturing_backend.field.efficiency', type: 'number' },
    { key: 'costPerHour', label: 'manufacturing_backend.field.cost', type: 'number' },
    { key: 'active', label: 'manufacturing_backend.field.state', type: 'boolean' },
  ],
  groupable: [{ key: 'active', label: 'manufacturing_backend.field.state' }],
  sortable: [
    { key: 'name', label: 'manufacturing_backend.field.name' },
    { key: 'capacity', label: 'manufacturing_backend.field.capacity' },
    { key: 'costPerHour', label: 'manufacturing_backend.field.cost' },
  ],
  // `active` being filterable is what gives the bar its archived toggle, and an
  // archived work center is hidden until the reader asks for it — so a preset
  // over the same field would only ever repeat what the toggle already decides.
  defaultSort: [{ key: 'name', dir: 'asc' }],
})
