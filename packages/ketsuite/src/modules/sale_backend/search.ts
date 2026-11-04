// What the search-filter bar offers on the sales lists.
//
// All three read a bounded collection and narrow it in memory, so all three are
// row lists. The presets are the states and statuses each list already shows in
// its own badge column: a quotation is draft, sent or cancelled, an order is
// invoiced or not and locked or not, a product bills on order or on delivery.
import { defineRowList } from '../backend/row-list.ts'

const QUOTATION_STATES = ['draft', 'sent', 'cancel'] as const
const INVOICE_STATUSES = ['no', 'to invoice', 'upselling', 'invoiced'] as const
// Who sold an order, in which team, to whom (D19). The screen names the choices; a team
// filter "not set" is an order outside every team.
const SALES_REFERENCES = [
  { key: 'userId', label: 'sale_backend.field.salesperson', type: 'reference' },
  { key: 'teamId', label: 'sale_backend.field.team', type: 'reference' },
  { key: 'partnerId', label: 'sale_backend.field.customer', type: 'reference' },
] as const

export const quotationListSearch = defineRowList({
  key: 'sale.quotations',
  // A tag's name finds the quotations that carry it (D15), a team's name those in it (D16).
  searchable: [{ key: 'name' }, { key: 'partnerName' }, { key: 'tagNames' }, { key: 'teamName' }],
  filterable: [
    { key: 'name', label: 'sale_backend.field.name', type: 'text' },
    { key: 'partnerName', label: 'sale_backend.field.customerName', type: 'text' },
    { key: 'dateOrder', label: 'sale_backend.field.dateOrder', type: 'datetime' },
    { key: 'validityDate', label: 'sale_backend.field.validityDate', type: 'date' },
    { key: 'state', label: 'sale_backend.field.state', type: 'selection', choices: QUOTATION_STATES },
    { key: 'amountTotal', label: 'sale_backend.field.amountTotal', type: 'number' },
    ...SALES_REFERENCES,
  ],
  groupable: [
    { key: 'state', label: 'sale_backend.field.state' },
    { key: 'partnerName', label: 'sale_backend.field.customer' },
    { key: 'dateOrder', label: 'sale_backend.field.dateOrder', intervals: ['day', 'week', 'month'] },
  ],
  sortable: [
    { key: 'name', label: 'sale_backend.field.name' },
    { key: 'dateOrder', label: 'sale_backend.field.dateOrder' },
    { key: 'validityDate', label: 'sale_backend.field.validityDate' },
    { key: 'amountTotal', label: 'sale_backend.field.amountTotal' },
  ],
  presets: QUOTATION_STATES.map((state) => ({
    key: state,
    label: `sale_backend.state.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  defaultSort: [{ key: 'dateOrder', dir: 'desc' }],
})

export const saleOrderListSearch = defineRowList({
  key: 'sale.orders',
  searchable: [{ key: 'name' }, { key: 'partnerName' }],
  filterable: [
    { key: 'name', label: 'sale_backend.field.name', type: 'text' },
    { key: 'partnerName', label: 'sale_backend.field.customerName', type: 'text' },
    { key: 'dateOrder', label: 'sale_backend.field.dateOrder', type: 'datetime' },
    {
      key: 'invoiceStatus',
      label: 'sale_backend.field.invoiceStatus',
      type: 'selection',
      choices: INVOICE_STATUSES,
    },
    { key: 'locked', label: 'sale_backend.field.locked', type: 'boolean' },
    { key: 'amountTotal', label: 'sale_backend.field.amountTotal', type: 'number' },
    ...SALES_REFERENCES,
    // Orders with a line for the product, any of its variants (D19).
    {
      key: 'templateId',
      label: 'sale_backend.field.product',
      type: 'reference',
      operators: ['equals', 'anyOf'],
    },
  ],
  groupable: [
    { key: 'invoiceStatus', label: 'sale_backend.field.invoiceStatus' },
    { key: 'partnerName', label: 'sale_backend.field.customer' },
    { key: 'dateOrder', label: 'sale_backend.field.dateOrder', intervals: ['day', 'week', 'month'] },
  ],
  sortable: [
    { key: 'name', label: 'sale_backend.field.name' },
    { key: 'dateOrder', label: 'sale_backend.field.dateOrder' },
    { key: 'amountTotal', label: 'sale_backend.field.amountTotal' },
  ],
  presets: [
    ...INVOICE_STATUSES.map((status) => ({
      key: status,
      label: `sale_backend.invoiceStatus.${status}`,
      group: 'invoiceStatus',
      match: (row: Record<string, unknown>) => row.invoiceStatus === status,
    })),
    {
      key: 'locked',
      label: 'sale_backend.order.locked',
      group: 'locked',
      match: (row) => row.locked === true,
    },
    {
      key: 'unlocked',
      label: 'sale_backend.order.unlocked',
      group: 'locked',
      match: (row) => row.locked !== true,
    },
  ],
  defaultSort: [{ key: 'dateOrder', dir: 'desc' }],
})
