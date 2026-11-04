import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import {
  copyAction,
  copyDialog,
  copyCommand,
} from '../packages/ketsuite/src/modules/sale_backend/modal/copy-dialog.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const context = () =>
  ({
    kind: 'sale.order',
    id: 'source',
    creating: false,
    busy: false,
    recordChanged: false,
    data: { lang: 'en', draftId: 'fresh', permissions: { copyOrder: true }, record: { revision: 7 } },
    t: (key: string) => key,
  }) as unknown as RecordModalContext<SaleOrderModalData>

test('D31g copy respects write access and pending parent drafts', () => {
  const c = context()
  assert.match(renderToString(html`${copyAction(c)}`), /data-record-dialog="copy"/)
  c.data.permissions.copyOrder = false
  assert.equal(copyAction(c), null)
  assert.match(renderToString(html`${copyDialog.view(c)}`), /disabled/)
  c.data.permissions.copyOrder = true
  c.recordChanged = true
  const dirty = renderToString(html`${copyDialog.view(c)}`)
  assert.match(dirty, /copy.saveFirst/)
  assert.match(dirty, /disabled/)
})

test('D31g native copy pins IDs and revision, then drops old record navigation state', () => {
  const c = context(),
    form = new FormData()
  form.set('id', 'forged')
  form.set('sourceId', 'other')
  form.set('expectedRevision', '99')
  assert.deepEqual(copyCommand.input!(form, c, {}), { id: 'fresh', sourceId: 'source', expectedRevision: 7 })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      href: 'http://test/admin/sales/orders/source?company=acme&branch=west&tab=actions&dialog=copy&record=source&returnTo=old&line=source-line',
    },
  })
  try {
    assert.equal(
      copyCommand.navigate!({ id: 'fresh' }, c),
      '/admin/sales/quotations/fresh?company=acme&branch=west&lang=en',
    )
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})
