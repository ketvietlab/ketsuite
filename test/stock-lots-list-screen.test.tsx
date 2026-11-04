import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  lotCondition,
  lotsListScreen,
} from '../packages/ketsuite/src/modules/stock_backend/screens/lots-list.tsx'

const messages: Record<string, string> = {
  'stock_backend.lots': 'Lô / Sê-ri',
  'stock_backend.lot.list.title': 'Lô và số sê-ri',
  'stock_backend.lot.list.subtitle': 'Theo dõi định danh, sản phẩm và tồn thực tế của từng lô hoặc số sê-ri.',
  'stock_backend.lot.list.summary.total': 'Tổng số',
  'stock_backend.lot.list.col.name': 'Lô / Sê-ri',
  'stock_backend.lot.list.col.product': 'Sản phẩm',
  'stock_backend.lot.list.col.reference': 'Tham chiếu nội bộ',
  'stock_backend.lot.list.col.onHand': 'Tồn thực tế',
  'stock_backend.lot.list.col.status': 'Trạng thái',
  'stock_backend.lot.list.empty': 'Chưa có lô hoặc số sê-ri',
  'stock_backend.lot.list.emptyHint': 'Tạo định danh đầu tiên để bắt đầu truy xuất hàng hóa.',
  'stock_backend.lot.status.active': 'Đang hoạt động',
  'stock_backend.lot.status.archived': 'Đã lưu trữ',
  'stock_backend.lot.list.col.expiry': 'Hạn dùng',
  'stock_backend.lot.condition.expiring': 'Sắp hết hạn',
  'stock_backend.action.create': 'Tạo mới',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả dòng',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string, params?: Record<string, unknown>) => {
  let value = messages[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {}))
    value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock lots list: follows ListPage hierarchy and sends creation to the localized new form', () => {
  const html = renderToString(
    lotsListScreen(
      translate,
      {
        createHref: '/admin/stock/lots/new?lang=vi',
        total: 18,
        rows: [
          {
            id: 'lot-denim-2026',
            name: 'DENIM-2026-08',
            product: 'Vải denim xanh',
            reference: 'LOT-0082',
            onHand: '1.250',
            onHandValue: 1250,
            active: true,
            condition: 'expiring',
            expiry: '15/12/26',
            href: '/admin/stock/lots/lot-denim-2026?lang=vi',
          },
        ],
      },
      {
        extras: { 'topbar.end': '<span data-evidence="joint">joint</span>' },
      },
    ),
  )

  assert.match(html, /data-ui="ket-table"/)
  assert.ok(html.indexOf('data-ui="page-context"') < html.indexOf('data-ui="ket-table"'))
  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/stock\/lots\/new\?lang=vi"/,
  )
  assert.match(html, /data-variant="primary"/)
  assert.match(html, /data-ui="list-page-footer"[\s\S]*?Tổng số: 18/)
  assert.match(html, /data-col="name"[\s\S]*?DENIM-2026-08/)
  assert.match(html, /href="\/admin\/stock\/lots\/lot-denim-2026\?lang=vi"/)
  assert.doesNotMatch(html, /lot-create-form/)
  // The list carries its own guide, once.
  assert.equal(html.match(/id="stock-lots-help"/g)?.length, 1)
  // K28: each lot says when it expires and what it is fit for today.
  assert.match(html, /data-col="expiry"[\s\S]*?15\/12\/26/)
  assert.match(html, /data-col="condition"[\s\S]*?Sắp hết hạn/)
})

test('K28 a lot reads archived, quarantined, depleted, expired, expiring, in date or without expiry', () => {
  const now = Date.parse('2026-10-08T05:00:00.000Z')
  const lot = (dates: Record<string, unknown> = {}) => ({ active: true, quarantined: false, ...dates })
  // A day before and after `now`, and as many days ahead as given.
  const ahead = (days: number) => new Date(now + days * 86_400_000).toISOString()
  assert.equal(lotCondition({ ...lot({ expirationDate: ahead(-30) }), active: false }, 5, now), 'archived')
  assert.equal(
    lotCondition({ ...lot({ expirationDate: ahead(-30) }), quarantined: true }, 5, now),
    'quarantined',
  )
  assert.equal(lotCondition(lot({ expirationDate: ahead(-30) }), 0, now), 'depleted')
  assert.equal(lotCondition(lot({ expirationDate: ahead(0) }), 6, now), 'expired')
  assert.equal(lotCondition(lot({ expirationDate: ahead(-1) }), 6, now), 'expired')
  // Without an alert date, 90 days before it expires.
  assert.equal(lotCondition(lot({ expirationDate: ahead(90) }), 6, now), 'expiring')
  assert.equal(lotCondition(lot({ expirationDate: ahead(91) }), 6, now), 'valid')
  // An alert date says when, sooner or later than that.
  assert.equal(lotCondition(lot({ expirationDate: ahead(300), alertDate: ahead(-1) }), 6, now), 'expiring')
  assert.equal(lotCondition(lot({ expirationDate: ahead(60), alertDate: ahead(10) }), 6, now), 'valid')
  assert.equal(lotCondition(lot(), 6, now), 'noExpiry')
})

test('stock lots list: keeps the empty state within the same list baseline', () => {
  const html = renderToString(
    lotsListScreen(translate, {
      createHref: '/admin/stock/lots/new?lang=vi',
      rows: [],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /Chưa có lô hoặc số sê-ri/)
  assert.match(html, /Tổng số: 0/)
  assert.match(html, /href="\/admin\/stock\/lots\/new\?lang=vi"/)
})
