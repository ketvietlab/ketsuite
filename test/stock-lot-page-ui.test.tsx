import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

type Row = Record<string, unknown>
const lot = stockConfigurationDefinition('lot')
/** The markup without the view's hydration markers, so text sits next to its tag. */
const html = (node: unknown) => renderToString(<>{node}</>).replace(/<!--k\[?-->/g, '')

const context = (data: Row): RecordModalContext<never> =>
  ({
    kind: lot.kind,
    id: 'A',
    creating: false,
    tab: 'info',
    busy: false,
    dialog: null,
    data: {
      record: { id: 'A', name: 'A', productId: 'goods', expirationDate: '2030-03-01T00:00:00Z' },
      draftId: 'draft-1',
      choices: { locations: [], products: [] },
      rules: [],
      save: false,
      rule: false,
      run: false,
      quants: [],
      history: [],
      ...data,
    },
    t: (key: string) => key,
    fieldError: () => null,
    draft: (_name: string, value = '') => value,
    draftChecked: (_name: string, _value: string, fallback = false) => fallback,
    state: (_name: string, value = '') => value,
    href: () => '',
    outcome: () => null,
  }) as unknown as RecordModalContext<never>

const trace = [
  {
    id: 'l2',
    date: '2030-01-10',
    pickingName: 'WH/XK/0001',
    pickingHref: '/admin/stock/transfers/order:delivery?lang=vi',
    from: 'WH/Tồn kho',
    to: 'WH/Khách hàng',
    quantity: '10',
    uomName: 'Cái',
    kind: 'delivery',
    partner: 'Buyer',
    origin: 'S00001',
    originHref: '/admin/sales/orders/order?lang=vi',
  },
  {
    id: 'l1',
    date: '2030-01-05',
    pickingName: 'WH/NK/0001',
    pickingHref: '/admin/stock/transfers/count?lang=vi',
    from: 'Count',
    to: 'WH/Tồn kho',
    quantity: '10',
    uomName: 'Cái',
    kind: 'adjustment',
    partner: null,
    origin: null,
    originHref: null,
  },
]

test('K32 the lot page heads an expiring or quarantined lot with a notice', () => {
  const body = (data: Row) => html(lot.body!(context(data)))
  const expiring = body({ condition: 'expiring' })
  assert.match(
    expiring,
    /data-ui="notice"[^>]*data-tone="warning"[\s\S]*?stock_backend\.lot\.notice\.expiring/,
  )
  assert.match(expiring, /stock_backend\.lot\.field\.expirationDate: 1\/3\/2030</)
  assert.match(body({ condition: 'expired' }), /data-ui="notice"[^>]*data-tone="danger"/)
  const held = body({ condition: 'quarantined', record: { id: 'A', name: 'A', reason: 'Chờ kiểm nghiệm' } })
  assert.match(held, /stock_backend\.lot\.notice\.quarantined[\s\S]*?Chờ kiểm nghiệm/)
  assert.doesNotMatch(body({ condition: 'valid' }), /data-ui="notice"/)
})

test('K32 the lot page traces each finished line and links the order only when given', () => {
  const page = html(lot.body!(context({ trace })))
  assert.match(page, /stock_backend\.lot\.trace\.title/)
  // Days print as the lot's own date fields do, in the reader's language.
  assert.match(page, />10\/1\/2030<[\s\S]*?>5\/1\/2030</)
  assert.match(page, /href="\/admin\/stock\/transfers\/order:delivery\?lang=vi"[^>]*>WH\/XK\/0001</)
  assert.match(page, /href="\/admin\/sales\/orders\/order\?lang=vi"[^>]*>S00001</)
  assert.match(
    page,
    /WH\/Tồn kho[\s\S]*?WH\/Khách hàng[\s\S]*?10 Cái[\s\S]*?stock_backend\.analysis\.kind\.delivery/,
  )
  // A reader of the lot without the trace read meets no empty section.
  assert.doesNotMatch(html(lot.body!(context({}))), /stock_backend\.lot\.trace\.title/)
})

test('K32 the lot page rail adds up received, on hand, held, delivered and customers', () => {
  const figures = { received: 14, onHand: 6, held: 2, delivered: 8, customers: 1 }
  const rail = html(lot.pageAside!(context({ trace, figures })))
  const values = [...rail.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((match) => [
    match[1]!.replace(/<[^>]*>/g, '').trim(),
    match[2]!.replace(/<[^>]*>/g, '').trim(),
  ])
  assert.deepEqual(values, [
    ['stock_backend.lot.figures.received', '14'],
    ['stock_backend.lot.figures.onHand', '6'],
    ['stock_backend.lot.figures.held', '2'],
    ['stock_backend.lot.figures.delivered', '8'],
    ['stock_backend.lot.figures.customers', '1'],
  ])
  assert.equal(lot.pageAside!(context({})), undefined)
  assert.equal(lot.pageAsideLabel!(context({})), 'stock_backend.lot.figures.title')
})
