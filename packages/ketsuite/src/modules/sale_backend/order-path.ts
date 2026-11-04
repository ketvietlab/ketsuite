/** A sales order's page: under quotations until it is confirmed, under orders after. */
export const salesOrderPath = (state: unknown, id: unknown): string =>
  ['draft', 'sent'].includes(String(state))
    ? `/admin/sales/quotations/${encodeURIComponent(String(id))}`
    : `/admin/sales/orders/${encodeURIComponent(String(id))}`

/** The list a section of sales orders lives in. */
export const salesSectionPath = (section: 'quotations' | 'orders'): string =>
  section === 'quotations' ? '/admin/sales/quotations' : '/admin/sales/orders'
