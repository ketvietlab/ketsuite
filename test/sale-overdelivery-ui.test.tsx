import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { invoicePreview } from '../packages/ketsuite/src/modules/sale_backend/modal/invoice-preview.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
test('D33 invoice preview distinguishes remaining excess from total historical overdelivery', () => {
  const c = {
    data: {
      record: {
        lines: [
          {
            id: 'partial',
            name: 'Partial invoice',
            invoicePolicy: 'delivery',
            qtyToInvoice: '1',
            qtyOverDelivered: '3',
            qtyOverToInvoice: '1',
            productUomQty: '2',
            productUomName: 'Each',
          },
          {
            id: 'settled',
            name: 'Already invoiced',
            invoicePolicy: 'order',
            qtyToInvoice: '0',
            qtyOverDelivered: '5',
            qtyOverToInvoice: '0',
          },
        ],
      },
    },
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${params.quantity}/${params.ordered}` : key,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const view = renderToString(invoicePreview(c))
  assert.match(view, /Partial invoice/)
  assert.doesNotMatch(view, /Already invoiced/)
  assert.match(view, /invoicePreview.extra:1\/2/)
  assert.doesNotMatch(view, /invoicePreview.extra:3\/2/)
  assert.match(view, /invoicePreview.extraTitle/)
})
