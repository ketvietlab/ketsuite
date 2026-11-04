import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'
import { saleLineGridConfig } from '../packages/ketsuite/src/modules/sale_backend/modal/line-grid.tsx'
import {
  discountAction,
  discountDialog,
  discountCommand,
} from '../packages/ketsuite/src/modules/sale_backend/modal/discount-dialog.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
const context = () =>
  ({
    kind: 'sale.order',
    id: 'order',
    busy: false,
    recordChanged: false,
    data: {
      record: {
        id: 'order',
        state: 'draft',
        revision: 3,
        currency: 'VND',
        invoices: [],
        lines: [
          {
            id: 'discount',
            lineKind: 'discount',
            name: 'Order discount',
            productId: null,
            productUomId: null,
            productUomQty: '1',
            priceUnit: '-10',
            discount: '0',
          },
        ],
      },
      choices: {},
      permissions: { applyDiscount: true, getLineCosts: true },
      lang: 'en',
    },
    tab: 'lines',
    href: (tab: string) => '/admin/sales/quotations/order?tab=' + tab,
    t: (key: string) => key,
    draft: (_key: string, fallback: string) => fallback,
    fieldError: () => undefined,
  }) as unknown as RecordModalContext<SaleOrderModalData>
test('D31a native discount dialog gates grants and pending parent drafts', () => {
  const c = context()
  // Giảm tay is the menu's link to this dialog (C21).
  assert.match(renderToString(html`${discountAction(c)}`), /dialog=discount"/)
  c.data.permissions.applyDiscount = false
  assert.equal(discountAction(c), null)
  c.data.permissions.applyDiscount = true
  c.recordChanged = true
  const pending = renderToString(html`${discountDialog.view(c)}`)
  assert.match(pending, /discount.saveFirst/)
  assert.doesNotMatch(pending, /name="value"/)
  c.recordChanged = false
  const ready = renderToString(html`${discountDialog.view(c)}`)
  assert.match(ready, /name="mode"/)
  assert.match(ready, /name="value"/)
  const form = new FormData()
  form.set('mode', 'amount')
  form.set('value', '9007199254740993')
  assert.deepEqual(discountCommand.input!(form, c, {}), {
    id: 'order',
    expectedRevision: 3,
    mode: 'amount',
    value: '9007199254740993',
    label: 'sale_backend.discount.line',
  })
})
test('D31a a quotation with deliveries or invoices does not offer the manual discount', () => {
  // A manual discount rewrites every line; the server refuses it once a line has history.
  const c = context()
  c.data.record.moves = [{ id: 'move' }] as never
  assert.doesNotMatch(renderToString(html`${discountAction(c)}`), /dialog=discount"/)
  c.data.record.moves = []
  c.data.record.invoices = [{ id: 'invoice' }] as never
  assert.doesNotMatch(renderToString(html`${discountAction(c)}`), /dialog=discount"/)
  c.data.record.invoices = []
  assert.match(renderToString(html`${discountAction(c)}`), /dialog=discount"/)
})
test('D31a every discount grid cell is locked while ordinary cells stay editable', () => {
  const c = context()
  const config = saleLineGridConfig(c),
    options = ketGridOptions(config),
    row = config.rows[0]!
  for (const column of options.columns)
    assert.equal(
      typeof column.editable === 'function' ? column.editable(row) : column.editable,
      false,
      column.key,
    )
  c.data.record.lines[0]!.lineKind = null
  const ordinary = saleLineGridConfig(c),
    editable = ketGridOptions(ordinary).columns.find((column) => column.key === 'name')!
  assert.equal(
    typeof editable.editable === 'function' ? editable.editable(ordinary.rows[0]!) : editable.editable,
    true,
  )
})
