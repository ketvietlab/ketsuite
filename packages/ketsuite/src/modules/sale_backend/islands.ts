import { defineRecordPageIsland } from '../../ui/record-modal.tsx'

export const islands = {
  // A quotation or order's own page (`/admin/sales/quotations/{id}`, `/admin/sales/orders/{id}`,
  // `new` to create): the server renders the RecordPage loading and the client renders the
  // order (modal/order-modal-view.tsx).
  'sale.order-page': defineRecordPageIsland({
    kind: 'sale.order',
    client: 'sale-order-modal.mjs',
    export: 'saleOrderPage',
  }),
}
