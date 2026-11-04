import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import {
  saleOrderModalDefinition as definition,
  type SaleOrderModalData,
} from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const context = (history: SaleOrderModalData['history']) =>
  ({
    id: 'order',
    kind: 'sale.order',
    creating: false,
    tab: 'info',
    presentation: 'page',
    data: {
      record: { id: 'order', name: 'S00024', state: 'sale', lines: [], pickings: [], invoices: [] },
      permissions: {},
      choices: {},
      lang: 'vi',
      draftId: 'order',
      ...(history ? { history } : {}),
    },
    t: (key: string) => key,
    outcome: () => null,
    fieldError: () => null,
    draft: (_name: string, fallback = '') => fallback,
    draftChecked: (_name: string, _value: unknown, fallback = false) => fallback,
    busy: false,
    dialog: null,
    href: () => '',
    state: (_key: string, fallback = '') => fallback,
  }) as unknown as RecordModalContext<SaleOrderModalData>
const page = (history: SaleOrderModalData['history']) =>
  renderToString(definition.body!(context(history)) as TemplateResult)

test('D7 the order page ends with its change history: time, person, action and the document', () => {
  const html = page([
    {
      id: 'e2',
      when: '27 thg 10, 2026 14:05',
      actor: 'Nguyễn Hải Yến',
      action: 'Tạo hoá đơn',
      detail: 'INV/2026/00001',
      detailHref: '/admin/accounting/customer-invoices/inv-1?lang=vi',
    },
    {
      id: 'e1',
      when: '27 thg 10, 2026 14:00',
      actor: 'Owner',
      action: 'Xác nhận đơn',
      detail: '—',
      detailHref: null,
    },
  ])
  const at = html.lastIndexOf('sale_backend.modal.history')
  assert.ok(at > html.lastIndexOf('sale_backend.modal.lines'), 'history is after the lines')
  const card = html.slice(at)
  for (const heading of ['history.when', 'history.actor', 'history.action', 'history.detail'])
    assert.ok(card.includes(`sale_backend.${heading}`), heading)
  assert.ok(card.indexOf('Nguyễn Hải Yến') < card.indexOf('Owner'), 'newest first')
  assert.match(
    card,
    /href="\/admin\/accounting\/customer-invoices\/inv-1\?lang=vi"[^>]*>[\s\S]*?INV\/2026\/00001/,
  )
  assert.ok(!/href="[^"]*"[^>]*>[\s\S]{0,200}?—</.test(card), 'no link without a document')
})

test('D7 an order without events says so; a viewer without the history sees no card', () => {
  assert.ok(page([]).includes('sale_backend.history.empty'))
  assert.ok(!page(undefined).includes('sale_backend.modal.history'))
})
