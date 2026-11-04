import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { purchaseOverviewScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/overview.tsx'

const messages: Record<string, string> = {
  'purchase_backend.action.createRfq': 'Tạo yêu cầu báo giá',
  'purchase_backend.dashboard.records': 'Bản ghi',
  'purchase_backend.dashboard.title': 'Tổng quan mua hàng',
  'purchase_backend.dashboard.toApprove': 'Chờ duyệt',
  'purchase_backend.dashboard.toBill': 'Chờ lập hóa đơn',
  'purchase_backend.dashboard.toSend': 'Chờ gửi',
  'purchase_backend.dashboard.waiting': 'Chờ phản hồi',
  'purchase_backend.menu.orders': 'Đơn mua',
  'purchase_backend.setup.hint': 'Cần cấu hình: {missing}.',
  'purchase_backend.setup.openInventory': 'Mở kho vận',
  'purchase_backend.setup.openPartners': 'Mở đối tác',
  'purchase_backend.setup.pickingTypes': 'loại hoạt động nhận hàng',
  'purchase_backend.setup.title': 'Chưa thể tạo yêu cầu báo giá',
  'purchase_backend.setup.vendors': 'nhà cung cấp',
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

test('purchase overview stays specialized: preserves workflow counts, locale links and setup guidance', () => {
  const html = renderToString(
    purchaseOverviewScreen(
      translate,
      [
        { state: 'draft', invoiceStatus: 'no' },
        { state: 'draft', invoiceStatus: 'no' },
        { state: 'sent', invoiceStatus: 'no' },
        { state: 'to approve', invoiceStatus: 'no' },
        { state: 'purchase', invoiceStatus: 'to invoice' },
        { state: 'purchase', invoiceStatus: 'invoiced' },
      ],
      {},
      '?lang=vi',
      { pickingTypes: 1, vendors: 0, createHref: '/admin/purchase/rfqs?lang=vi&record=purchase.order%3Anew' },
    ),
  )

  assert.match(html, /data-ui="dashboard-page"[^>]*data-variant="operational"/)
  assert.doesNotMatch(html, /data-ui="dashboard-page-context"|data-ui="breadcrumbs"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="record-workspace"/)
  assert.match(html, /data-ui="notice" data-tone="warning"/)
  assert.match(html, /Cần cấu hình: nhà cung cấp\./)
  assert.match(html, /href="\/admin\/partner\/partners"/)
  // The primary action opens the RFQ create modal over the RFQ list.
  assert.match(html, /href="\/admin\/purchase\/rfqs\?lang=vi&amp;record=purchase\.order%3Anew"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?preset=draft&amp;lang=vi"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?preset=sent&amp;lang=vi"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?preset=to-approve&amp;lang=vi"/)
  assert.match(html, /href="\/admin\/purchase\/orders\?lang=vi"/)
  assert.match(html, /href="\/admin\/purchase\/orders\?preset=to-invoice&amp;lang=vi"/)
  assert.match(html, /Chờ gửi[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?2/)
  assert.match(html, /Chờ phản hồi[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?1/)
  assert.match(html, /Chờ duyệt[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?1/)
  assert.match(html, /Đơn mua[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?2/)
  assert.match(html, /Chờ lập hóa đơn[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?1/)
  assert.doesNotMatch(html, /mail\.chatter|data-ui="form-page-aside"/)
})

test('purchase overview omits setup rejection when prerequisites exist', () => {
  const html = renderToString(purchaseOverviewScreen(translate, [], {}, '', { pickingTypes: 1, vendors: 1 }))

  assert.doesNotMatch(html, /data-ui="notice"/)
  // Without purchase.createOrder the route passes no createHref, so there is no create action.
  assert.doesNotMatch(html, /record=purchase\.order|\/rfqs\/new/)
  assert.match(html, /data-ui="metric-value"[^>]*>[\s\S]*?0/)
})

test('#1737 purchase overview lists the open requests stock reorder rules drafted, and only those', () => {
  const words = {
    ...messages,
    'purchase_backend.dashboard.replenishment': 'Nhu cầu bổ sung từ kho',
    'purchase_backend.dashboard.replenishmentEmpty': 'Không có nhu cầu bổ sung đang chờ.',
    'purchase_backend.dashboard.warehouse': 'Kho nhận',
    'purchase_backend.state.draft': 'RFQ',
    'purchase_backend.state.sent': 'RFQ đã gửi',
  }
  const _ = ((key: string) => words[key as keyof typeof words] ?? key) as Translator
  _.locale = 'vi'
  _.has = (key) => key in words
  _.resolves = _.has
  const group = '["acme","wh","wh:stock","wh:incoming","lotus"]'
  const html = renderToString(
    purchaseOverviewScreen(
      _,
      [
        {
          id: 'asked',
          name: 'PO00001',
          state: 'draft',
          replenishmentGroup: group,
          partnerName: 'Lotus',
          warehouseName: 'Kho HCM',
          amountTotal: '3600000',
          currency: 'VND',
        },
        {
          id: 'sent',
          name: 'PO00002',
          state: 'sent',
          replenishmentGroup: group,
          partnerName: 'Lotus',
          warehouseName: 'Kho HCM',
        },
        { id: 'manual', name: 'PO00003', state: 'draft', partnerName: 'East' },
        {
          id: 'confirmed',
          name: 'PO00004',
          state: 'purchase',
          replenishmentGroup: group,
          partnerName: 'Lotus',
        },
      ],
      {},
      '?lang=vi',
      { pickingTypes: 1, vendors: 1, rowHref: (row) => `/admin/purchase/rfqs/${String(row.id)}` },
    ),
  ).replace(/<!--k\[?-->/g, '')
  const section = html.slice(html.indexOf('Nhu cầu bổ sung từ kho'))
  assert.match(section, /PO00001[\s\S]*?Lotus[\s\S]*?Kho HCM[\s\S]*?RFQ/)
  assert.match(section, /PO00002[\s\S]*?RFQ đã gửi/)
  assert.match(section, /href="\/admin\/purchase\/rfqs\/asked"/)
  // A request someone drafted by hand, and one already confirmed, are not stock demands.
  assert.doesNotMatch(section, /PO00003|PO00004/)
  assert.match(html, /id="purchase-overview-help"/)
  const empty = renderToString(purchaseOverviewScreen(_, [], {}, '', { pickingTypes: 1, vendors: 1 }))
  assert.match(empty, /Không có nhu cầu bổ sung đang chờ\./)
})
