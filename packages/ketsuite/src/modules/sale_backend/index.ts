import { saleRecordBack } from './record/routes.ts'
import {
  warningPreviewIsland,
  warningPreviewRoute,
  customerWarningIsland,
  customerWarningRoute,
} from './record/warning-routes.tsx'
import { copyMessages } from './copy-messages.ts'
import { customerMessages } from './customers/messages.ts'
import { tagMessages } from './tags/messages.ts'
import { saleTagIslands } from './tags/islands.ts'
import { tagRoutes } from './tags/routes.ts'
import { teamMessages } from './teams/messages.ts'
import { saleTeamIslands } from './teams/islands.ts'
import { teamRoutes } from './teams/routes.ts'
import { policyMessages } from './policies/messages.ts'
import { reportingMessages } from './reporting/messages.ts'
import { analysisPage, overviewPart } from './reporting/routes.ts'
import { salePolicyIslands } from './policies/islands.ts'
import { policyRoutes } from './policies/routes.ts'
import { customerIslands } from './customers/islands.ts'
import { customerPageIsland } from './customers/record-island.ts'
import { customerRoutes } from './customers/routes.ts'
import { benefitMessages } from './benefit-messages.ts'
import { matrixMessages } from './matrix-messages.ts'
import { variantMatrixContext } from './modal/matrix-context.ts'
import { saleCatalogueRoute, saleCatalogueIsland } from './record/catalogue-route.tsx'
import { catalogueMessages } from './catalogue-messages.ts'
import {
  salesConfigurationIsland,
  salesConfigurationContext,
  salesConfigurationRoute,
} from './record/configuration-routes.tsx'
import { saleOrderCommand } from './record/workflow.ts'
import { listSearchChrome } from '../backend/search-filter.ts'
import { loadListGroups } from '../backend/list-search.ts'
import { pager } from '../backend/paging.ts'
import { defineRecordModalIsland } from '../../ui/record-modal.tsx'
import { saleOrderContext } from './modal/context.ts'
import { optionalRead } from '../backend/optional-read.ts'
import { loadSaleOrderCollection, loadSalePartnerNames } from './order-collection.ts'
import { rowListSearch } from '../backend/row-list.ts'
import { quotationListSearch, saleOrderListSearch } from './search.ts'
import { searchFilterFunctions } from './search-functions.ts'
import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { backendPage } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { islands } from './islands.ts'
import {
  orderPageScreen,
  overviewScreen,
  quotationsListScreen,
  salesOrdersListScreen,
} from './screens/index.ts'
import type { SaleCounts } from './screens/index.ts'
import { adminPage, frameOf, inLocale, localeQuery, optional, timezoneOf } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { productPageLink } from '../backend/product-page.ts'
import { salesAnalysisScreen } from './screens/sales-analysis.tsx'

/** How many sales orders the overview shows before handing over to the list. */
const RECENT_ORDERS = 5
/** The analysis window, the same as the product page's Sold card. */
const ANALYSIS_DAYS = 30

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

/**
 * A cross-origin POST carries the signed-in user's session cookie without their
 * intent, and every write behind these routes acts on money, stock or customer
 * records. Refused the way user_backend, company_backend, oauth_backend,
 * product_backend and stock_backend already refuse it.
 */

type Translator = ReturnType<ServeContext['translate']>
const redirect = (result: unknown, ok: string) =>
  (result as AnyRow).ok ? seeOther(ok) : seeOther(`${ok}${ok.includes('?') ? '&' : '?'}invalid=1`)
const quotationListQuery = (url: URL): string => {
  const query = new URLSearchParams(url.searchParams)
  query.delete('invalid')
  const value = query.toString()
  return value ? `?${value}` : ''
}
const quotationListPath = (url: URL): string => `/admin/sales/quotations${quotationListQuery(url)}`
const quotationCreatePath = (url: URL): string => `/admin/sales/quotations/new${quotationListQuery(url)}`
/** The choices the list's filter bar names (D19): salespeople, teams, customers and products. */
const orderFilterChoices = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  _: Translator,
  quotations: boolean,
) => {
  const choices = await optionalRead<AnyRow | null>(
    ctx,
    'sale.getOrderFilterChoices',
    { quotations },
    url,
    req,
    null,
  )
  if (!choices) return undefined
  const pick = (rows: unknown) =>
    ((rows as AnyRow[] | undefined) ?? []).map((row) => ({ value: String(row.id), label: String(row.name) }))
  return {
    userId: pick(choices.salespeople),
    teamId: ((choices.teams as AnyRow[] | undefined) ?? []).map((row) => ({
      value: String(row.id),
      label:
        row.active === false ? `${String(row.name)} (${_('sale_backend.team.archived')})` : String(row.name),
    })),
    partnerId: pick(choices.customers),
    ...(quotations ? {} : { templateId: pick(choices.products) }),
  }
}
const createQuotation = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]): Promise<unknown> => {
  const form = await readForm(req)
  return ctx.call(
    'sale.createOrder',
    {
      id: randomUUID(),
      partnerId: form.partnerId ?? '',
      warehouseId: form.warehouseId ?? '',
      ...optional(form, 'clientOrderRef'),
      ...optional(form, 'pricelistId'),
      ...optional(form, 'paymentTermId'),
      ...optional(form, 'validityDate'),
      ...optional(form, 'notes'),
    },
    url,
    req,
  )
}
const callIfInstalled = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  preferred: string,
  fallback: string,
  input: Record<string, unknown>,
) => ctx.call((await ctx.live(req)).functions[preferred] ? preferred : fallback, input, url, req)
const orderPath = (order: AnyRow, url: URL) =>
  `${['draft', 'sent', 'cancel'].includes(String(order.state)) ? '/admin/sales/quotations' : '/admin/sales/orders'}/${String(order.id)}${localeQuery(url)}`
const partnerNames = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  rows: AnyRow[],
): Promise<Map<string, unknown>> => {
  const ids = [...new Set(rows.map((r) => String(r.partnerId)).filter(Boolean))]
  if (!ids.length || !(await ctx.allows('partner.listPartners', url, req))) return new Map()
  // Explicit-ID lookups are bounded too; resolve every order's customer before
  // visible-field search, including customers beyond the first lookup batch.
  return loadSalePartnerNames(
    ids,
    (batch) =>
      ctx.call('partner.listPartners', { ids: batch, includeArchived: true }, url, req) as Promise<AnyRow[]>,
  )
}
/** Where a list returns to from an order: the list it opened from, filters and all. */
/** An order's page, opened from a list that its Back returns to. */
const orderPageHref = (url: URL, order: AnyRow | null): string => {
  const target = new URL(
    order ? orderPath(order, url) : `/admin/sales/quotations/new${localeQuery(url)}`,
    url,
  )
  target.searchParams.set('returnTo', `${url.pathname}${url.search}`)
  return `${target.pathname}${target.search}`
}
/**
 * A quotation or order is a page (`/admin/sales/quotations/{id}`, `/admin/sales/orders/{id}`,
 * `new` to create). The server renders the RecordPage loading; the record runtime reads
 * `/admin/sales/record/{id}/context` and renders the order (modal/order-modal-view.tsx).
 */
const orderPage =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const creating = params.id === 'new'
    const order = creating
      ? null
      : ((await ctx.call('sale.getOrder', { id: params.id }, url, req)) as AnyRow | null)
    if (!creating && !order) return text('not found', { status: 404 })
    const title = order ? String(order.name) : _('sale_backend.action.create')
    const island = await ctx.joint(url, req, 'sale_backend:order.page', {
      id: params.id,
      title,
      loading: _('backend.relation.loading'),
      back: saleRecordBack(
        url,
        url.pathname.startsWith('/admin/sales/orders/') ? '/admin/sales/orders' : '/admin/sales/quotations',
      ),
      // Saved orders are wide for their lines table, so loading does not shift the page.
      width: creating ? 'default' : 'wide',
    })
    return backendPage(ctx, req, {
      lang,
      title,
      body: orderPageScreen(_, title, island, await frameOf(ctx, url, req), lang === 'en' ? 'en' : 'vi'),
    })
  }
/** GET is the page; POST keeps the form actions of an order for clients without the page's script. */
const detail = (ctx: ServeContext): Route => {
  const page = orderPage(ctx)
  return async (url, req, params) => {
    if (req.method === 'GET') return page(url, req, params)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    if (crossSite(req)) return text('Forbidden', { status: 403 })
    const form = await readForm(req)
    let result: unknown
    if (form.action === 'add-line')
      result = await ctx.call(
        'sale.addLine',
        {
          id: randomUUID(),
          orderId: params.id,
          productId: form.productId ?? '',
          productUomQty: form.productUomQty || '1',
          productUomId: form.productUomId ?? '',
          ...optional(form, 'priceUnit'),
          ...optional(form, 'discount'),
          ...optional(form, 'taxId'),
        },
        url,
        req,
      )
    else if (form.action === 'remove-line')
      result = await ctx.call('sale.removeLine', { id: form.lineId ?? '' }, url, req)
    else if (form.action === 'reset') result = await ctx.call('sale.resetOrder', { id: params.id }, url, req)
    else if (form.action === 'send')
      result = await ctx.call('sale.sendQuotation', { id: params.id }, url, req)
    else if (form.action === 'confirm')
      result = await callIfInstalled(ctx, url, req, 'loyalty_sale.confirmOrder', 'sale.confirmOrder', {
        id: params.id,
      })
    else if (form.action === 'sync')
      result = await ctx.call('sale.syncDeliveries', { id: params.id }, url, req)
    else if (form.action === 'lock' || form.action === 'unlock')
      result = await ctx.call('sale.lockOrder', { id: params.id, locked: form.action === 'lock' }, url, req)
    else if (form.action === 'cancel')
      result = await callIfInstalled(ctx, url, req, 'loyalty_sale.cancelOrder', 'sale.cancelOrder', {
        id: params.id,
      })
    else if (form.action === 'invoice')
      result = await ctx.call(
        'sale.createInvoice',
        {
          id: randomUUID(),
          orderId: params.id,
          journalId: form.journalId ?? '',
          revenueAccountId: form.revenueAccountId ?? '',
          receivableAccountId: form.receivableAccountId ?? '',
          ...optional(form, 'taxAccountId'),
          ...optional(form, 'invoiceDate'),
        },
        url,
        req,
      )
    else return text('unknown action', { status: 400 })
    if (!(result as AnyRow).ok) return redirect(result, `${url.pathname}${url.search}`)
    const current = (await ctx.call('sale.getOrder', { id: params.id }, url, req)) as AnyRow | null
    return current ? seeOther(orderPath(current, url)) : text('not found', { status: 404 })
  }
}
const vi = {
  ...benefitMessages.vi,
  ...copyMessages.vi,
  ...customerMessages.vi,
  ...tagMessages.vi,
  ...teamMessages.vi,
  ...policyMessages.vi,
  ...reportingMessages.vi,
  'discount.title': 'Giảm giá',
  'discount.manual': 'Giảm tay',
  'discount.mode': 'Cách giảm',
  'discount.value': 'Giá trị',
  'discount.order_percent': 'Phần trăm trên đơn',
  'discount.amount': 'Số tiền trước thuế',
  'discount.line_percent': 'Phần trăm cho từng dòng',
  'discount.saveFirst': 'Lưu các thay đổi của báo giá trước khi giảm giá.',
  'discount.beforeTax': 'Giảm trên tiền hàng trước thuế',
  'discount.replace':
    'Giảm trên đơn thay khoản giảm trước đó và chia theo nhóm thuế. Dòng giảm chỉ được xóa, không sửa tay.',
  'discount.apply': 'Áp dụng',
  'discount.line': 'Chiết khấu đơn hàng',
  'prices.action': 'Cập nhật giá',
  'prices.title': 'Áp lại bảng giá',
  'prices.apply': 'Cập nhật giá',
  'prices.message':
    'Mọi dòng chưa giao, chưa xuất hoá đơn lấy lại đơn giá và chiết khấu theo bảng giá đã chọn; giá sửa tay trên các dòng đó được thay. Dòng combo, ưu đãi và dòng đã giao giữ nguyên.',

  ...matrixMessages.vi,
  ...Object.fromEntries(
    Object.entries(catalogueMessages.vi).map(([key, value]) => [`catalogue.${key}`, value]),
  ),
  'grid.description': 'Diễn giải',
  'grid.freeDescription': 'Nhập diễn giải nếu không chọn sản phẩm',
  'grid.noTax': 'Không thuế',
  'customerWarning.hint': 'Tối đa 300 ký tự; áp dụng riêng trong công ty đang chọn. Không chặn giao dịch.',
  'customerWarning.save': 'Lưu',
  'customerWarning.edit': 'Sửa cảnh báo',
  'customerWarning.empty': 'Chưa có cảnh báo cho khách này.',
  'warning.title': 'Lưu ý về {name}',
  'configuration.warnings': 'Cảnh báo khi bán',
  'configuration.warningsHint': 'Hiện lưu ý của khách hàng và sản phẩm trên đơn bán. Không chặn giao dịch.',
  'configuration.title': 'Cấu hình bán hàng',
  'configuration.requireProduct': 'Bắt buộc sản phẩm',
  'configuration.hint':
    'Khi bật, mọi dòng phải gắn sản phẩm trước khi xác nhận. Báo giá vẫn lưu được dòng tự do.',
  'configuration.quotations': 'Báo giá mới',
  'configuration.orders': 'Đơn đã xác nhận',
  'configuration.validity': 'Hiệu lực báo giá (ngày)',
  'configuration.validityHint': 'Từ 1 đến 365 ngày, tính từ ngày đặt. Để trống: báo giá không có hạn.',
  'configuration.signature': 'Yêu cầu ký trực tuyến',
  'configuration.payment': 'Yêu cầu thanh toán trực tuyến',
  'configuration.prepayment': 'Trả trước (%)',
  'configuration.prepaymentHint': 'Phần trăm tổng tiền khách trả trước khi bật thanh toán trực tuyến.',
  'configuration.newOnly': 'Chỉ áp cho báo giá tạo sau khi lưu; mẫu báo giá giữ giá trị riêng.',
  'configuration.lock': 'Khoá đơn khi xác nhận',
  'configuration.lockHint': 'Đơn đã xác nhận bị khoá ngay; trưởng bán hàng mở khoá khi cần sửa.',
  'configuration.invoicePolicy': 'Xuất hoá đơn hàng hoá theo',
  'configuration.invoicePolicyHint':
    'Mặc định cho hàng hoá chưa đặt riêng; dịch vụ luôn theo số lượng đặt. Báo giá lấy chính sách lúc xác nhận; đơn đã xác nhận giữ chính sách của từng dòng.',
  'dashboard.awaiting': 'Báo giá đang chờ phản hồi',
  'dashboard.queueEmpty': 'Không có báo giá đang chờ phản hồi.',
  'app.title': 'Bán hàng trong quản trị',
  'app.summary': 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
  'app.category': 'Hệ thống',
  'menu.app': 'Bán hàng',
  'menu.dashboard': 'Tổng quan',
  'menu.ordersGroup': 'Đơn hàng',
  'menu.quotations': 'Báo giá',
  'menu.orders': 'Đơn bán hàng',
  'menu.toInvoice': 'Cần xuất hoá đơn',
  'menu.products': 'Sản phẩm',
  'dashboard.title': 'Tổng quan bán hàng',
  'dashboard.draft': 'Báo giá',
  'dashboard.sent': 'Báo giá đã gửi',
  'dashboard.toInvoice': 'Chờ lập hoá đơn',
  'dashboard.records': 'Bản ghi',
  'dashboard.subtitle': 'Theo dõi báo giá, đơn bán và công việc cần xử lý.',
  'dashboard.draftToday': '{count} mới hôm nay',
  'dashboard.sentValue': '{amount} chờ phản hồi',
  'dashboard.saleValue': '{amount} tổng giá trị',
  'dashboard.toInvoiceValue': '{amount} cần xử lý',
  'dashboard.flow.title': 'Dòng bán hàng',
  'dashboard.flow.hint': 'Tiến độ từ báo giá đến lập hoá đơn',
  'dashboard.recent.title': 'Đơn gần đây',
  'dashboard.recent.hint': 'Các đơn bán được cập nhật mới nhất',
  'dashboard.recent.all': 'Xem tất cả',
  'quotations.title': 'Báo giá',
  'quotation.kicker': 'Báo giá khách hàng',
  'quotation.title': 'Báo giá',
  'quotation.subtitle': 'Soạn, gửi và theo dõi báo giá trước khi xác nhận thành đơn bán hàng.',
  'quotation.summary.total': 'Tổng báo giá',
  'setup.account': 'Chưa có tài khoản phù hợp. Tạo trong Kế toán › Hệ thống tài khoản.',
  'setup.journal': 'Chưa có sổ nhật ký bán hàng. Tạo trong Kế toán › Sổ nhật ký.',
  'setup.uom': 'Chưa có đơn vị tính. Tạo trong Cấu hình › Đơn vị tính.',
  'setup.warehouse': 'Chưa có kho. Tạo trong Kho vận › Kho.',
  'quotation.summary.cancelled': 'Đã huỷ',
  'quotation.summary.draft': 'Bản nháp',
  'quotation.summary.sent': 'Đã gửi',
  'quotation.create.title': 'Tạo báo giá',
  'quotation.create.hint': 'Chọn khách hàng, kho giao hàng và các điều kiện thương mại.',
  'quotation.list.title': 'Báo giá hiện có',
  'quotation.list.hint': 'Mở một báo giá để thêm sản phẩm, gửi hoặc xác nhận đơn hàng.',
  'quotation.empty': 'Chưa có báo giá',
  'quotation.emptyHint': 'Tạo báo giá đầu tiên để bắt đầu quy trình bán hàng.',
  'error.invalid': 'Dữ liệu chưa hợp lệ. Kiểm tra các trường bắt buộc và thử lại.',
  'orders.title': 'Đơn bán hàng',
  'orderList.kicker': 'Vận hành bán hàng',
  'orderList.title': 'Đơn bán hàng',
  'orderList.subtitle': 'Theo dõi đơn đã xác nhận, trạng thái lập hoá đơn và tổng giá trị.',
  'orderList.summary.total': 'Tổng đơn bán',
  'orderList.summary.toInvoice': 'Chờ lập hoá đơn',
  'orderList.summary.invoiced': 'Đã lập đủ',
  'orderList.summary.locked': 'Đã khoá',
  'orderList.records.title': 'Đơn bán đã xác nhận',
  'orderList.records.hint': 'Mở một đơn để đồng bộ giao hàng, khoá đơn hoặc tạo hoá đơn.',
  'orderList.empty': 'Chưa có đơn bán hàng',
  'orderList.emptyHint': 'Xác nhận một báo giá để tạo đơn bán hàng đầu tiên.',
  'orderList.byVariant.title': 'Đơn có {variant}',
  'orderList.byVariant.message': 'Chỉ hiện các đơn bán có dòng của biến thể này.',
  'orderList.byVariant.clear': 'Xem mọi đơn',
  'analysis.title': 'Phân tích bán hàng',
  'analysis.context': '{product} · {days} ngày gần đây',
  'analysis.col.variant': 'Biến thể',
  'analysis.col.code': 'Mã',
  'analysis.col.quantity': 'Đã bán',
  'analysis.col.revenue': 'Doanh thu chưa thuế',
  'analysis.col.orders': 'Số đơn',
  'analysis.col.lastAt': 'Bán gần nhất',
  'analysis.empty': 'Chưa bán được trong kỳ này',
  'analysis.emptyHint': 'Đơn bán đã xác nhận trong kỳ sẽ hiện ở đây, mỗi biến thể một dòng.',
  'analysis.missing': 'Chọn một sản phẩm',
  'analysis.missingHint': 'Mở phân tích từ thẻ Đã bán 30 ngày trên trang sản phẩm.',
  'analysis.back': 'Về trang sản phẩm',
  'detail.title': 'Chi tiết đơn bán',
  'order.kicker': 'Đơn bán hàng',
  'order.locked': 'Đã khoá',
  'order.unlocked': 'Đang mở',
  'order.actions.label': 'Hành động trên báo giá hoặc đơn bán',
  'order.information.title': 'Thông tin đơn hàng',
  'order.information.hint': 'Khách hàng, thời hạn và điều kiện thương mại của đơn.',
  'order.collaboration.label': 'Trao đổi và hoạt động của đơn bán',
  'order.aside.label': 'Kế hoạch giao hàng, trao đổi và hoạt động của đơn bán',
  'lines.title': 'Dòng sản phẩm',
  'lines.hint': 'Số lượng, giao hàng, lập hoá đơn và thành tiền theo từng sản phẩm.',
  'lines.add': 'Thêm sản phẩm',
  'lines.addHint': 'Chọn biến thể, đơn vị tính, số lượng và điều kiện giá bán.',
  'lines.empty': 'Chưa có dòng sản phẩm',
  'lines.emptyHint': 'Thêm sản phẩm đầu tiên trước khi xác nhận báo giá.',
  'invoice.title': 'Tạo hoá đơn khách hàng',
  'invoice.hint': 'Tạo hoá đơn cho số lượng hiện đang đủ điều kiện lập hoá đơn.',
  'deliveries.title': 'Phiếu giao hàng',
  'invoices.title': 'Hoá đơn khách hàng',
  empty: 'Chưa có dữ liệu.',
  emptyHint: 'Tạo bản ghi đầu tiên để bắt đầu.',
  'modal.lines': 'Sản phẩm',
  'cost.margin': 'Lợi nhuận dòng',
  'cost.saved': 'Giá vốn của các dòng đã lưu',
  'cost.perUnit': 'Giá vốn / đơn vị',
  'cost.currency': 'Tiền tệ',
  'cost.unknown': 'Chưa có giá vốn',
  'cost.noSnapshot': 'Chưa có snapshot giá vốn cho các dòng đã lưu.',
  'grid.save': 'Lưu các dòng',
  'grid.addSection': 'Thêm nhóm hàng',
  'grid.addNote': 'Thêm ghi chú',
  'grid.optional': 'Tùy chọn',
  'grid.margin': 'Lợi nhuận',
  'grid.orderMargin': 'Lợi nhuận đã lưu',
  'grid.marginPercent': 'Lợi nhuận %',
  'grid.optionalSections': 'Nhóm hàng tùy chọn',
  'grid.saveBeforeSections': 'Đóng hộp thoại và lưu các dòng đang sửa trước khi chọn nhóm hàng tùy chọn.',
  'grid.automaticPrice': 'Theo bảng giá',
  'modal.deliveries': 'Giao hàng',
  'modal.invoices': 'Hoá đơn',
  'modal.deposits': 'Tiền đặt cọc',
  'action.collectDeposit': 'Thu đặt cọc',
  'action.applyDeposit': 'Trừ vào hoá đơn',
  'deposit.empty': 'Chưa thu đặt cọc',
  'deposit.emptyHint':
    'Tiền đặt cọc ghi thành phiếu thu của khách, không lập hoá đơn; khi hoá đơn đã ghi sổ thì trừ tiền cọc vào đó.',
  'deposit.mode': 'Tính theo',
  'deposit.mode.percent': 'Phần trăm tổng đơn',
  'deposit.mode.amount': 'Số tiền',
  'deposit.value': 'Giá trị',
  'deposit.notInvoice': 'Không lập hoá đơn cho tiền đặt cọc',
  'deposit.notInvoiceHint':
    'Phiếu thu ghi vào tài khoản phải thu của khách. Hoá đơn lập khi giao hàng, rồi trừ tiền cọc vào hoá đơn.',
  'field.depositJournal': 'Sổ thu tiền',
  'field.depositDate': 'Ngày thu',
  'field.memo': 'Ghi chú',
  'field.deposit': 'Khoản đặt cọc',
  'field.invoice': 'Hoá đơn',
  'field.unapplied': 'Chưa trừ',
  'field.receipt': 'Số phiếu',
  'delivery.empty': 'Chưa có phiếu giao hàng',
  'delivery.emptyHint': 'Phiếu giao hàng có khi đơn có hàng cần giao.',
  'delivery.state.draft': 'Nháp',
  'delivery.state.waiting': 'Đang chờ',
  'delivery.state.confirmed': 'Đã xác nhận',
  'delivery.state.partially_available': 'Có hàng một phần',
  'delivery.state.assigned': 'Đã giữ hàng',
  'delivery.state.done': 'Hoàn tất',
  'delivery.state.cancel': 'Đã hủy',
  'invoice.empty': 'Chưa có hoá đơn',
  'invoice.emptyHint': 'Hoá đơn của đơn này hiện ở đây sau khi tạo.',
  'modal.history': 'Lịch sử thay đổi',
  'history.when': 'Thời điểm',
  'history.actor': 'Người thực hiện',
  'history.action': 'Thao tác',
  'history.detail': 'Chi tiết',
  'history.empty': 'Chưa có thay đổi nào được ghi',
  'history.emptyHint': 'Mỗi thao tác trên đơn được ghi ở đây cùng tên người thực hiện.',
  'history.system': 'Hệ thống',
  'history.action.create': 'Tạo báo giá',
  'history.action.createFromTemplate': 'Tạo từ báo giá mẫu',
  'history.action.copy': 'Nhân bản báo giá',
  'history.action.save': 'Lưu báo giá',
  'history.action.reset': 'Đưa về nháp',
  'history.action.send': 'Gửi báo giá',
  'history.action.confirm': 'Xác nhận đơn',
  'history.action.cancel': 'Huỷ',
  'history.action.lock': 'Khoá đơn',
  'history.action.unlock': 'Mở khoá đơn',
  'history.action.addLine': 'Thêm dòng',
  'history.action.updateLine': 'Sửa dòng',
  'history.action.removeLine': 'Xoá dòng',
  'history.action.editLines': 'Lưu các dòng',
  'history.action.variantMatrix': 'Chọn biến thể',
  'history.action.catalogue': 'Thêm hàng từ danh mục',
  'history.action.updatePrices': 'Cập nhật giá',
  'history.action.discount': 'Giảm giá',
  'history.action.optionalSections': 'Chọn nhóm hàng tùy chọn',
  'history.action.deliveryPromise': 'Đổi ngày giao',
  'history.action.salesperson': 'Đổi người bán',
  'history.action.tags': 'Đổi thẻ',
  'history.action.syncDeliveries': 'Đồng bộ giao hàng',
  'history.action.invoice': 'Tạo hoá đơn',
  'history.action.deposit': 'Thu đặt cọc',
  'history.action.applyDeposit': 'Cấn trừ đặt cọc',
  'history.action.applyCode': 'Nhập mã ưu đãi',
  'history.action.applyReward': 'Áp khuyến mãi',
  'history.action.removeReward': 'Bỏ khuyến mãi',
  'history.action.addSection': 'Thêm nhóm hàng mẫu',
  'history.action.applyTemplate': 'Dùng báo giá mẫu',
  'invoice.state.draft': 'Nháp',
  'invoice.state.posted': 'Đã ghi sổ',
  'invoice.state.cancel': 'Đã hủy',
  'modal.confirmCancel': 'Huỷ đơn bán hàng này?',
  'action.create': 'Tạo báo giá',
  'action.addLine': 'Thêm dòng',
  'action.reset': 'Đưa về nháp',
  'action.send': 'Đánh dấu đã gửi',
  'action.confirm': 'Xác nhận',
  'action.sync': 'Đồng bộ giao hàng',
  'action.lock': 'Khoá đơn',
  'action.unlock': 'Mở khoá',
  'action.cancel': 'Huỷ',
  'action.createInvoice': 'Tạo hoá đơn',
  'field.shippingPolicy': 'Chính sách giao hàng',
  'field.commitmentDate': 'Ngày cam kết giao',
  'field.expectedDate': 'Ngày dự kiến giao',
  'shippingPolicy.direct': 'Giao ngay phần có sẵn',
  'shippingPolicy.one': 'Giao một lần',
  'delivery.plan': 'Kế hoạch giao hàng',
  'delivery.dates': 'Ngày giao',
  'action.saveDeliveryPromise': 'Lưu kế hoạch giao',
  'action.savePolicy': 'Lưu chính sách',
  'action.back': 'Về danh sách',
  'order.print': 'In',
  'field.name': 'Số đơn',
  'field.customer': 'Khách hàng',
  'field.customerName': 'Tên khách hàng',
  'relation.customers': 'Quản lý khách hàng',
  'field.clientOrderRef': 'Tham chiếu khách hàng',
  'field.state': 'Trạng thái',
  'field.dateOrder': 'Ngày đặt hàng',
  'field.validityDate': 'Hạn báo giá',
  'field.warehouse': 'Kho hàng',
  'field.pricelist': 'Bảng giá',
  'field.paymentTerm': 'Điều khoản thanh toán',
  'field.invoiceStatus': 'Trạng thái lập hoá đơn',
  'field.locked': 'Khoá đơn',
  'field.amountUntaxed': 'Chưa thuế',
  'field.amountTax': 'Thuế',
  'field.amountTotal': 'Tổng tiền',
  'field.notes': 'Điều khoản và ghi chú',
  'field.product': 'Sản phẩm',
  'field.sku': 'Mã SKU',
  'field.category': 'Nhóm sản phẩm',
  'field.quantity': 'Số lượng đặt',
  'field.delivered': 'Đã giao',
  'field.invoiced': 'Đã lập hoá đơn',
  'field.uom': 'Đơn vị tính',
  'field.priceUnit': 'Đơn giá',
  'field.discount': 'Chiết khấu',
  'field.tax': 'Thuế bán hàng',
  'field.actions': 'Thao tác',
  'field.subtotal': 'Thành tiền',
  'field.invoicePolicy': 'Cơ sở lập hoá đơn',
  'field.journal': 'Sổ nhật ký bán hàng',
  'field.revenueAccount': 'Tài khoản doanh thu',
  'field.receivableAccount': 'Tài khoản phải thu',
  'field.taxAccount': 'Tài khoản thuế',
  'field.invoiceDate': 'Ngày hoá đơn',
  'help.pricelist': 'Để trống để dùng bảng giá hoặc giá niêm yết.',
  'state.draft': 'Báo giá',
  'state.sent': 'Báo giá đã gửi',
  'state.sale': 'Đơn bán hàng',
  'state.cancel': 'Đã huỷ',
  'invoiceStatus.upselling': 'Cơ hội bán thêm',
  'invoicePreview.title': 'Số lượng lập hoá đơn',
  'invoicePreview.quantity': 'Lập hoá đơn lần này',
  'invoicePreview.extraTitle': 'Có hàng giao vượt số đặt',
  'invoicePreview.extraHint':
    'Hàng xuất hoá đơn theo số giao tính cả phần giao vượt. Kiểm tra trước khi tạo hoá đơn nháp.',
  'invoicePreview.extra': 'Gồm {quantity} giao vượt (đặt {ordered})',
  'invoicePreview.noInvoices': 'Chưa có hoá đơn',
  'invoicePreview.noInvoicesHint': 'Tạo hoá đơn nháp từ số lượng đủ điều kiện của đơn bán.',
  'invoicePreview.empty': 'Chưa có số lượng để lập hoá đơn',
  'invoicePreview.emptyHint': 'Kiểm tra số đã giao, số đã xuất hoá đơn và chính sách của sản phẩm.',
  'invoiceStatus.invoiced': 'Đã lập đủ',
  'invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'invoiceStatus.no': 'Chưa cần lập hoá đơn',
  'invoicePolicy.order': 'Theo số lượng đặt',
  'invoicePolicy.delivery': 'Theo số lượng giao',
}
const en = {
  ...benefitMessages.en,
  ...copyMessages.en,
  ...customerMessages.en,
  ...tagMessages.en,
  ...teamMessages.en,
  ...policyMessages.en,
  ...reportingMessages.en,
  'discount.title': 'Discount',
  'discount.manual': 'Manual discount',
  'discount.mode': 'Method',
  'discount.value': 'Value',
  'discount.order_percent': 'Percentage on order',
  'discount.amount': 'Untaxed fixed amount',
  'discount.line_percent': 'Percentage on each line',
  'discount.saveFirst': 'Save quotation changes before applying a discount.',
  'discount.beforeTax': 'Discount on untaxed merchandise',
  'discount.replace':
    'Order discounts replace the previous adjustment and split by tax group. Discount rows can be removed but cannot be edited.',
  'discount.apply': 'Apply',
  'discount.line': 'Order discount',
  'prices.action': 'Update prices',
  'prices.title': 'Apply the pricelist again',
  'prices.apply': 'Update prices',
  'prices.message':
    'Every line not yet delivered or invoiced takes its unit price and discount from the chosen pricelist again; prices typed by hand on those lines give way. Combo items, rewards and delivered lines stay as they are.',

  ...matrixMessages.en,
  ...Object.fromEntries(
    Object.entries(catalogueMessages.en).map(([key, value]) => [`catalogue.${key}`, value]),
  ),
  'grid.description': 'Description',
  'grid.freeDescription': 'Describe a line without a product',
  'grid.noTax': 'No tax',
  'customerWarning.hint': 'Up to 300 characters, for the active company only. Does not block transactions.',
  'customerWarning.save': 'Save',
  'customerWarning.edit': 'Edit warning',
  'customerWarning.empty': 'No warning for this customer yet.',
  'warning.title': 'Note about {name}',
  'configuration.warnings': 'Sales warnings',
  'configuration.warningsHint':
    'Show customer and product notes on sales orders without blocking transactions.',
  'configuration.title': 'Sales configuration',
  'configuration.requireProduct': 'Require a product',
  'configuration.hint':
    'When enabled, every line needs a product before confirmation. Quotations may still keep free lines.',
  'configuration.quotations': 'New quotations',
  'configuration.orders': 'Confirmed orders',
  'configuration.validity': 'Quotation validity (days)',
  'configuration.validityHint': 'From 1 to 365 days after the order date. Empty: quotations do not expire.',
  'configuration.signature': 'Ask for an online signature',
  'configuration.payment': 'Ask for an online payment',
  'configuration.prepayment': 'Prepayment (%)',
  'configuration.prepaymentHint':
    'The share of the total the customer pays up front when online payment is on.',
  'configuration.newOnly':
    'Applies to quotations created after saving; quotation templates keep their own values.',
  'configuration.lock': 'Lock orders when confirmed',
  'configuration.lockHint': 'A confirmed order is locked at once; a sales manager unlocks it to edit.',
  'configuration.invoicePolicy': 'Invoice goods by',
  'configuration.invoicePolicyHint':
    "The default for goods without their own policy; services are always invoiced by ordered quantities. A quotation takes the policy in force when confirmed; a confirmed order keeps each line's policy.",
  'dashboard.awaiting': 'Quotations awaiting a response',
  'dashboard.queueEmpty': 'No quotations are awaiting a response.',
  'app.title': 'Sales administration',
  'app.summary': 'Quotations, sales orders, deliveries, and customer invoices.',
  'app.category': 'System',
  'menu.app': 'Sales',
  'menu.dashboard': 'Overview',
  'menu.ordersGroup': 'Orders',
  'menu.quotations': 'Quotations',
  'menu.orders': 'Sales Orders',
  'menu.toInvoice': 'To invoice',
  'menu.products': 'Products',
  'dashboard.title': 'Sales Overview',
  'dashboard.draft': 'Quotations',
  'dashboard.sent': 'Quotation Sent',
  'dashboard.toInvoice': 'To Invoice',
  'dashboard.records': 'Records',
  'dashboard.subtitle': 'Quotations, sales orders, and the work waiting on you.',
  'dashboard.draftToday': '{count} new today',
  'dashboard.sentValue': '{amount} awaiting a reply',
  'dashboard.saleValue': '{amount} in total',
  'dashboard.toInvoiceValue': '{amount} to handle',
  'dashboard.flow.title': 'Sales flow',
  'dashboard.flow.hint': 'From quotation through to invoicing',
  'dashboard.recent.title': 'Recent orders',
  'dashboard.recent.hint': 'The sales orders updated most recently',
  'dashboard.recent.all': 'View all',
  'quotations.title': 'Quotations',
  'quotation.kicker': 'Customer quotations',
  'quotation.title': 'Quotations',
  'quotation.subtitle': 'Draft, send and track quotations before confirming a sales order.',
  'quotation.summary.total': 'Total quotations',
  'setup.account': 'No matching account yet. Create one in Accounting \u203a Chart of accounts.',
  'setup.journal': 'No sales journal yet. Create one in Accounting \u203a Journals.',
  'setup.uom': 'No unit of measure yet. Create one in Configuration \u203a Units of measure.',
  'setup.warehouse': 'No warehouse yet. Create one in Inventory \u203a Warehouses.',
  'quotation.summary.cancelled': 'Cancelled',
  'quotation.summary.draft': 'Draft',
  'quotation.summary.sent': 'Sent',
  'quotation.create.title': 'Create quotation',
  'quotation.create.hint': 'Choose the customer, delivery warehouse and commercial terms.',
  'quotation.list.title': 'Current quotations',
  'quotation.list.hint': 'Open a quotation to add products, send it or confirm the sales order.',
  'quotation.empty': 'No quotations yet',
  'quotation.emptyHint': 'Create the first quotation to start the sales flow.',
  'error.invalid': 'The form is invalid. Check the required fields and try again.',
  'orders.title': 'Sales Orders',
  'orderList.kicker': 'Sales operations',
  'orderList.title': 'Sales Orders',
  'orderList.subtitle': 'Track confirmed orders, invoicing status and total value.',
  'orderList.summary.total': 'Total sales orders',
  'orderList.summary.toInvoice': 'To invoice',
  'orderList.summary.invoiced': 'Fully invoiced',
  'orderList.summary.locked': 'Locked',
  'orderList.records.title': 'Confirmed sales orders',
  'orderList.records.hint': 'Open an order to sync deliveries, lock it or create an invoice.',
  'orderList.empty': 'No sales orders yet',
  'orderList.emptyHint': 'Confirm a quotation to create the first sales order.',
  'orderList.byVariant.title': 'Orders with {variant}',
  'orderList.byVariant.message': 'Only sales orders with a line for this variant are shown.',
  'orderList.byVariant.clear': 'Show every order',
  'analysis.title': 'Sales analysis',
  'analysis.context': '{product} · last {days} days',
  'analysis.col.variant': 'Variant',
  'analysis.col.code': 'Code',
  'analysis.col.quantity': 'Sold',
  'analysis.col.revenue': 'Untaxed revenue',
  'analysis.col.orders': 'Orders',
  'analysis.col.lastAt': 'Last sold',
  'analysis.empty': 'Nothing sold in this period',
  'analysis.emptyHint': 'Confirmed sales orders in the period appear here, one row per variant.',
  'analysis.missing': 'Choose a product',
  'analysis.missingHint': "Open the analysis from the Sold in 30 days card on a product's page.",
  'analysis.back': 'Back to the product',
  'detail.title': 'Sales Order Detail',
  'order.kicker': 'Sales order',
  'order.locked': 'Locked',
  'order.unlocked': 'Open',
  'order.actions.label': 'Quotation or sales order actions',
  'order.information.title': 'Order information',
  'order.information.hint': 'Customer, deadline and commercial terms for this order.',
  'order.collaboration.label': 'Sales order conversation and activities',
  'order.aside.label': 'Sales order delivery plan, conversation and activities',
  'lines.title': 'Order Lines',
  'lines.hint': 'Ordered, delivered and invoiced quantities with each product subtotal.',
  'lines.add': 'Add a product',
  'lines.addHint': 'Choose a variant, unit, quantity and selling terms.',
  'lines.empty': 'No order lines yet',
  'lines.emptyHint': 'Add the first product before confirming the quotation.',
  'invoice.title': 'Create Customer Invoice',
  'invoice.hint': 'Create an invoice for the quantities currently eligible for invoicing.',
  'deliveries.title': 'Deliveries',
  'invoices.title': 'Customer Invoices',
  empty: 'No data yet.',
  emptyHint: 'Create the first record to get started.',
  'modal.lines': 'Products',
  'cost.margin': 'Line margin',
  'cost.saved': 'Saved line costs',
  'cost.perUnit': 'Cost / unit',
  'cost.currency': 'Currency',
  'cost.unknown': 'Cost unavailable',
  'cost.noSnapshot': 'No cost snapshots for the saved lines yet.',
  'grid.save': 'Save lines',
  'grid.addSection': 'Add section',
  'grid.addNote': 'Add note',
  'grid.optional': 'Optional',
  'grid.margin': 'Margin',
  'grid.orderMargin': 'Saved order margin',
  'grid.marginPercent': 'Margin %',
  'grid.optionalSections': 'Optional sections',
  'grid.saveBeforeSections': 'Close this dialog and save edited lines before choosing optional sections.',
  'grid.automaticPrice': 'Pricelist price',
  'modal.deliveries': 'Deliveries',
  'modal.invoices': 'Invoices',
  'modal.deposits': 'Deposits',
  'action.collectDeposit': 'Collect deposit',
  'action.applyDeposit': 'Set off against invoice',
  'deposit.empty': 'No deposit yet',
  'deposit.emptyHint':
    "A deposit is recorded as the customer's receipt, not invoiced; once the invoice is posted, set the deposit off against it.",
  'deposit.mode': 'Based on',
  'deposit.mode.percent': "Percent of the order's total",
  'deposit.mode.amount': 'Amount',
  'deposit.value': 'Value',
  'deposit.notInvoice': 'No invoice for a deposit',
  'deposit.notInvoiceHint':
    "The receipt goes to the customer's receivable account. The invoice is made on delivery; then the deposit is set off against it.",
  'field.depositJournal': 'Received into',
  'field.depositDate': 'Received on',
  'field.memo': 'Note',
  'field.deposit': 'Deposit',
  'field.invoice': 'Invoice',
  'field.unapplied': 'Not set off',
  'field.receipt': 'Receipt',
  'delivery.empty': 'No deliveries yet',
  'delivery.emptyHint': 'A delivery appears once the order has goods to ship.',
  'delivery.state.draft': 'Draft',
  'delivery.state.waiting': 'Waiting',
  'delivery.state.confirmed': 'Confirmed',
  'delivery.state.partially_available': 'Partially available',
  'delivery.state.assigned': 'Reserved',
  'delivery.state.done': 'Done',
  'delivery.state.cancel': 'Cancelled',
  'invoice.empty': 'No invoices yet',
  'invoice.emptyHint': 'This order’s invoices appear here once created.',
  'modal.history': 'Change history',
  'history.when': 'Time',
  'history.actor': 'By',
  'history.action': 'Action',
  'history.detail': 'Details',
  'history.empty': 'No changes recorded yet',
  'history.emptyHint': 'Every action on the order is recorded here with the person who took it.',
  'history.system': 'System',
  'history.action.create': 'Created quotation',
  'history.action.createFromTemplate': 'Created from quotation template',
  'history.action.copy': 'Duplicated quotation',
  'history.action.save': 'Saved quotation',
  'history.action.reset': 'Set to draft',
  'history.action.send': 'Sent quotation',
  'history.action.confirm': 'Confirmed order',
  'history.action.cancel': 'Cancelled',
  'history.action.lock': 'Locked order',
  'history.action.unlock': 'Unlocked order',
  'history.action.addLine': 'Added line',
  'history.action.updateLine': 'Edited line',
  'history.action.removeLine': 'Removed line',
  'history.action.editLines': 'Saved lines',
  'history.action.variantMatrix': 'Chose variants',
  'history.action.catalogue': 'Added from catalogue',
  'history.action.updatePrices': 'Updated prices',
  'history.action.discount': 'Discount',
  'history.action.optionalSections': 'Chose optional sections',
  'history.action.deliveryPromise': 'Changed delivery date',
  'history.action.salesperson': 'Changed salesperson',
  'history.action.tags': 'Changed tags',
  'history.action.syncDeliveries': 'Synced deliveries',
  'history.action.invoice': 'Created invoice',
  'history.action.deposit': 'Collected deposit',
  'history.action.applyDeposit': 'Applied deposit',
  'history.action.applyCode': 'Entered benefit code',
  'history.action.applyReward': 'Applied promotion',
  'history.action.removeReward': 'Removed promotion',
  'history.action.addSection': 'Added section template',
  'history.action.applyTemplate': 'Used quotation template',
  'invoice.state.draft': 'Draft',
  'invoice.state.posted': 'Posted',
  'invoice.state.cancel': 'Cancelled',
  'modal.confirmCancel': 'Cancel this sales order?',
  'action.create': 'Create Quotation',
  'action.addLine': 'Add line',
  'action.reset': 'Set to draft',
  'action.send': 'Mark as Sent',
  'action.confirm': 'Confirm',
  'action.sync': 'Sync Deliveries',
  'action.lock': 'Lock',
  'action.unlock': 'Unlock',
  'action.cancel': 'Cancel',
  'action.createInvoice': 'Create Invoice',
  'field.shippingPolicy': 'Delivery policy',
  'field.commitmentDate': 'Committed delivery date',
  'field.expectedDate': 'Expected delivery date',
  'shippingPolicy.direct': 'Deliver available items',
  'shippingPolicy.one': 'Deliver once',
  'delivery.plan': 'Delivery plan',
  'delivery.dates': 'Delivery dates',
  'action.saveDeliveryPromise': 'Save delivery plan',
  'action.savePolicy': 'Save Policy',
  'action.back': 'Back to list',
  'order.print': 'Print',
  'field.name': 'Order Reference',
  'field.customer': 'Customer',
  'field.customerName': 'Customer name',
  'relation.customers': 'Manage customers',
  'field.clientOrderRef': 'Customer Reference',
  'field.state': 'Status',
  'field.dateOrder': 'Order Date',
  'field.validityDate': 'Expiration',
  'field.warehouse': 'Warehouse',
  'field.pricelist': 'Pricelist',
  'field.paymentTerm': 'Payment Terms',
  'field.invoiceStatus': 'Invoice Status',
  'field.locked': 'Locked',
  'field.amountUntaxed': 'Untaxed Amount',
  'field.amountTax': 'Taxes',
  'field.amountTotal': 'Total',
  'field.notes': 'Terms and Conditions',
  'field.product': 'Product',
  'field.sku': 'SKU',
  'field.category': 'Category',
  'field.quantity': 'Ordered',
  'field.delivered': 'Delivered',
  'field.invoiced': 'Invoiced',
  'field.uom': 'Unit',
  'field.priceUnit': 'Unit Price',
  'field.discount': 'Discount',
  'field.tax': 'Sales Tax',
  'field.actions': 'Actions',
  'field.subtotal': 'Subtotal',
  'field.invoicePolicy': 'Invoicing Policy',
  'field.journal': 'Sales Journal',
  'field.revenueAccount': 'Revenue Account',
  'field.receivableAccount': 'Receivable Account',
  'field.taxAccount': 'Tax Account',
  'field.invoiceDate': 'Invoice Date',
  'help.pricelist': 'Leave blank to use the pricelist or list price.',
  'state.draft': 'Quotation',
  'state.sent': 'Quotation Sent',
  'state.sale': 'Sales Order',
  'state.cancel': 'Cancelled',
  'invoiceStatus.upselling': 'Upselling Opportunity',
  'invoicePreview.title': 'Invoice quantities',
  'invoicePreview.quantity': 'Invoice now',
  'invoicePreview.extraTitle': 'Some items exceed the ordered quantity',
  'invoicePreview.extraHint':
    'Delivery-based invoicing includes overdelivered quantities. Review before creating the draft invoice.',
  'invoicePreview.extra': 'Includes {quantity} overdelivered (ordered {ordered})',
  'invoicePreview.noInvoices': 'No invoices yet',
  'invoicePreview.noInvoicesHint': 'Create a draft invoice from the eligible sales order quantities.',
  'invoicePreview.empty': 'No quantity to invoice yet',
  'invoicePreview.emptyHint': 'Check delivered and invoiced quantities and the product invoicing policy.',
  'invoiceStatus.invoiced': 'Fully Invoiced',
  'invoiceStatus.to invoice': 'To Invoice',
  'invoiceStatus.no': 'Nothing to Invoice',
  'invoicePolicy.order': 'Ordered quantities',
  'invoicePolicy.delivery': 'Delivered quantities',
}
/** Every sales list shares one set of functions; see `search-functions.ts`. */
const saleSearchFunctions = {
  apply: 'sale_backend.applySearchFilter',
  saveFavorite: 'sale_backend.saveSearchFavorite',
  deleteFavorite: 'sale_backend.deleteSearchFavorite',
  setDefaultFavorite: 'sale_backend.setDefaultSearchFavorite',
}

/** A sales state or status in the reader's language; the value survives as data. */
const saleGroupLabel = (_: Translator, key: string, value: unknown): string => {
  const raw = value == null ? '' : String(value)
  if (!raw) return _('backend.chrome.groupEmpty')
  const message = `sale_backend.${key}.${raw}`
  return _.resolves(message) ? _(message) : raw
}

export default defineModule({
  name: 'sale_backend',
  version: '0.1.0',
  depends: ['sale', 'backend', 'partner_backend'],
  assets: new URL('./client/', import.meta.url),
  islands: {
    'sale.customer-warning': customerWarningIsland,
    'sale.warning-preview': warningPreviewIsland,
    'sale.catalogue': saleCatalogueIsland,
    'sale.variant-matrix-modal': defineRecordModalIsland({
      kind: 'sale.variantMatrix',
      client: 'sale-variant-matrix.mjs',
      export: 'variantMatrixModal',
    }),
    'sale.configuration-page': salesConfigurationIsland,
    ...salePolicyIslands,
    'sale.invoice-policy-modal': defineRecordModalIsland({
      kind: 'sale.invoicePolicy',
      client: 'sale-policy-modal.mjs',
      export: 'salePolicyModal',
    }),
    ...customerIslands,
    'sale.customer-page': customerPageIsland,
    ...saleTagIslands,
    'sale.tag-modal': defineRecordModalIsland({
      kind: 'sale.tag',
      client: 'sale-tag-modal.mjs',
      export: 'saleTagModal',
    }),
    ...saleTeamIslands,
    'sale.team-modal': defineRecordModalIsland({
      kind: 'sale.team',
      client: 'sale-team-modal.mjs',
      export: 'saleTeamModal',
    }),
    ...islands,
  },
  joints: {
    'order.loyalty': { props: { orderId: 'id', locale: 'text?' } },
    'order.collaboration': {
      props: { resModel: 'text', resId: 'id', lang: 'text', may: 'json?' },
      multiple: true,
    },
    'order.page': {
      props: { id: 'text', title: 'text', loading: 'text', back: 'text', width: 'text?' },
    },
  },
  functions: searchFilterFunctions,
  title: 'Bán hàng trong quản trị',
  summary: 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
  category: 'Hệ thống',
  menus: {
    sale: { label: 'menu.app', icon: 'shopping-bag', sequence: 22 },
    'sale.dashboard': {
      parent: 'sale',
      label: 'menu.dashboard',
      path: '/admin/sales',
      sequence: 1,
      needs: 'sale.listOrders',
    },
    'sale.quotations': {
      parent: 'sale',
      label: 'menu.quotations',
      path: '/admin/sales/quotations',
      needs: 'sale.listOrders',
      sequence: 1010,
    },
    'sale.orders': {
      parent: 'sale',
      label: 'menu.orders',
      path: '/admin/sales/orders',
      needs: 'sale.listOrders',
      sequence: 1020,
    },
    // The orders waiting for an invoice: daily work, so on the sidebar (D6).
    'sale.toInvoice': {
      parent: 'sale',
      label: 'menu.toInvoice',
      path: '/admin/sales/orders?preset=to%20invoice',
      needs: 'sale.listOrders',
      sequence: 1025,
    },
    // Sales by period, salesperson, team, customer or product (D19).
    'sale.analysis': {
      parent: 'sale',
      label: 'menu.analysis',
      path: '/admin/sales/analysis',
      needs: 'sale.analyzeSales',
      sequence: 1040,
    },
    // Customers as Sales keeps them: contact, salesperson, pricelist and credit (D11, D12).
    'sale.customers': {
      parent: 'sale',
      label: 'menu.customers',
      path: '/admin/sales/customers',
      needs: 'sale.listCustomers',
      sequence: 1030,
    },
    // Configuration is behind the gear (D6): the module's own block on the settings page, beside
    // Product and Stock, rather than among the organisation's system settings.
    'admin.sale': { parent: 'admin', label: 'menu.app', icon: 'shopping-bag', sequence: 22 },
    'sale.configuration': {
      parent: 'admin.sale',
      label: 'configuration.title',
      path: '/admin/sales/configuration',
      needs: 'sale.getConfiguration',
      for: ['sale.saveConfiguration'],
      sequence: 2000,
    },
    // Tags are configuration: behind the gear, beside quotation templates (D15).
    'sale.tags': {
      parent: 'admin.sale',
      label: 'tag.title',
      path: '/admin/sales/tags',
      needs: 'sale.listTags',
      for: ['sale.saveTag'],
      sequence: 2003,
    },
    // ...and so are sales teams (D16).
    'sale.teams': {
      parent: 'admin.sale',
      label: 'team.title',
      path: '/admin/sales/teams',
      needs: 'sale.listTeams',
      for: ['sale.saveTeam'],
      sequence: 2004,
    },
    // Product invoicing policies are configuration: behind the gear, after sales teams (D21).
    'sale.policies': {
      parent: 'admin.sale',
      label: 'policy.title',
      path: '/admin/sales/invoicing-policies',
      needs: 'sale.listInvoicePolicies',
      for: ['sale.setInvoicePolicy'],
      sequence: 2005,
    },
  },
  routes: {
    '/admin/sales/catalogue/{id}': saleCatalogueRoute,
    '/admin/sales/variant-matrix/{id}/context': variantMatrixContext,
    '/admin/sales/customers/{id}/warning': customerWarningRoute,
    ...customerRoutes,
    ...tagRoutes,
    ...teamRoutes,
    '/admin/sales/warnings/preview': warningPreviewRoute,
    '/admin/sales/configuration': salesConfigurationRoute,
    '/admin/sales/configuration/context': salesConfigurationContext,
    '/admin/sales/order-command': saleOrderCommand,
    ...policyRoutes,
    '/admin/sales/record/{id}/context': saleOrderContext,
    '/admin/sales':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        // "New today" is the reader's today, so the counting happens in their
        // timezone rather than the server's.
        const [counts, recent, awaiting] = await Promise.all([
          ctx.call(
            'sale.countOrders',
            { timezone: await timezoneOf(ctx, url, req) },
            url,
            req,
          ) as Promise<SaleCounts>,
          // The last few, not a page of them: the overview links to the list for
          // the rest, and a dashboard that loads five hundred rows to show five
          // is the same mistake the counters were moved into the database to fix.
          ctx.call('sale.listOrders', { state: 'sale', limit: RECENT_ORDERS }, url, req) as Promise<AnyRow[]>,
          ctx.call('sale.listOrders', { state: 'sent', limit: 10 }, url, req) as Promise<AnyRow[]>,
        ])
        const names = await partnerNames(ctx, url, req, [...recent, ...awaiting])
        // The month's figures (D18); a quotation about to expire opens like any other.
        const report = await overviewPart(ctx, url, req, (id) => orderPageHref(url, { id, state: 'sent' }))
        const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
        return adminPage(ctx, url, req, {
          title: 'sale_backend.dashboard.title',
          body: async (_, shell) =>
            overviewScreen(_, {
              frame: shell,
              counts,
              createHref: (await ctx.allows('sale.createOrder', url, req)) ? orderPageHref(url, null) : null,
              rowHref: (row) => orderPageHref(url, row),
              awaiting: awaiting.map((row) => ({ ...row, partnerName: names.get(String(row.partnerId)) })),
              recent: recent.map((row) => ({ ...row, partnerName: names.get(String(row.partnerId)) })),
              localeQuery: localeQuery(url),
              report: report?.(_) ?? null,
              lang,
            }),
        })
      },
    '/admin/sales/quotations':
      (ctx): Route =>
      async (url, req) => {
        const detailSuffix = localeQuery(url)
        const listPath = quotationListPath(url)
        const createPath = quotationCreatePath(url)
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const result = await createQuotation(ctx, url, req)
          return (result as AnyRow).ok
            ? seeOther(listPath)
            : seeOther(`${createPath}${createPath.includes('?') ? '&' : '?'}invalid=1`)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const state = url.searchParams.get('state')
        const rows = await loadSaleOrderCollection(
          (page) =>
            ctx.call(
              'sale.listOrders',
              { ...(state ? { state } : { states: ['draft', 'sent', 'cancel'] }), ...page },
              url,
              req,
            ) as Promise<AnyRow[]>,
        )
        const names = await partnerNames(ctx, url, req, rows)
        return adminPage(ctx, url, req, {
          title: 'sale_backend.quotations.title',
          body: async (_, shell) => {
            const search = await rowListSearch(ctx, url, req, {
              spec: quotationListSearch,
              rows: rows
                .filter((r) => ['draft', 'sent', 'cancel'].includes(String(r.state)))
                .map((r) => ({ ...r, partnerName: names.get(String(r.partnerId)) })),
              frame: shell,
              name: 'sale-quotation-filter',
              bodyId: 'sale-quotation-list',
              functions: saleSearchFunctions,
              labels: { searchPlaceholder: _('sale_backend.quotations.title') },
              fieldChoices: await orderFilterChoices(ctx, url, req, _, true),
              groupLabel: (key, value) => saleGroupLabel(_, key, value),
            })
            return quotationsListScreen(
              _,
              {
                createHref: (await ctx.allows('sale.createOrder', url, req))
                  ? orderPageHref(url, null)
                  : null,
                printReport: (await ctx.reportsOf(url, req, 'sale.Order')).find(
                  (report) => report.id === 'sale.quotation',
                ),
                rows: search.rows,
                table: {
                  ...(search.groups ? { groups: search.groups } : {}),
                  rowHref: (row) => orderPageHref(url, row),
                },
                detailSuffix,
                lang: ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
              },
              search.frame,
            )
          },
        })
      },
    '/admin/sales/quotations/new':
      (ctx): Route =>
      async (url, req) => {
        const listPath = quotationListPath(url)
        const createPath = quotationCreatePath(url)
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const result = await createQuotation(ctx, url, req)
          return (result as AnyRow).ok
            ? seeOther(listPath)
            : seeOther(`${createPath}${createPath.includes('?') ? '&' : '?'}invalid=1`)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return orderPage(ctx)(url, req, { id: 'new' })
      },
    '/admin/sales/orders':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const detailSuffix = localeQuery(url)
        return adminPage(ctx, url, req, {
          title: 'sale_backend.orders.title',
          body: async (_, shell) => {
            const search = await listSearchChrome(ctx, url, req, {
              spec: saleOrderListSearch,
              frame: shell,
              name: 'sale-order-filter',
              bodyId: 'sale-order-list',
              functions: saleSearchFunctions,
              labels: { searchPlaceholder: _('sale_backend.orders.title') },
              fieldChoices: await orderFilterChoices(ctx, url, req, _, false),
            })
            const grouped = search.state.groupBy.length > 0
            // The analysis on a product page opens the orders that sold one variant (P32).
            const productId = url.searchParams.get('productId') || null
            const narrowed = productId ? { productId } : {}
            const result = (await ctx.call(
              'sale.listOrders',
              {
                state: 'sale',
                listState: search.state,
                listMode: grouped ? 'count' : 'rows',
                ...narrowed,
              },
              url,
              req,
            )) as { rows: AnyRow[]; total: number }
            const groups = grouped
              ? await loadListGroups(ctx, url, req, search.state, 'Asia/Ho_Chi_Minh', {
                  groupFunction: 'sale.listOrders',
                  listFunction: 'sale.listOrders',
                  listArgs: { state: 'sale', ...narrowed },
                  groupArgs: { listMode: 'groups' },
                  label: (key, value) => saleGroupLabel(_, key, value),
                })
              : undefined
            const variant = productId
              ? (
                  (await optionalRead<AnyRow[]>(
                    ctx,
                    'product.listVariants',
                    { ids: [productId], includeArchived: true },
                    url,
                    req,
                    [],
                  )) as AnyRow[]
                )[0]
              : undefined
            const without = new URL(url)
            without.searchParams.delete('productId')
            // Group keys stay stable partner IDs; labels remain customer names.
            if (groups) {
              const flatten = (items: ReadonlyArray<(typeof groups)[number]>): typeof groups =>
                items.flatMap((item) => [item, ...flatten(item.children ?? [])])
              const customerGroups = flatten(groups).filter(
                (item) => search.state.groupBy[item.depth ?? 0]?.key === 'partnerName',
              )
              const ids = customerGroups.map((item) => String(JSON.parse(item.id).at(-1)))
              const names = await loadSalePartnerNames(
                ids,
                (ids) => ctx.call('partner.listPartners', { ids }, url, req) as Promise<AnyRow[]>,
              )
              for (const item of customerGroups)
                item.label = String(names.get(String(JSON.parse(item.id).at(-1))) ?? '—')
            }
            return salesOrdersListScreen(
              _,
              {
                printReport: (await ctx.reportsOf(url, req, 'sale.Order')).find(
                  (report) => report.id === 'sale.salesOrder',
                ),
                rows: result.rows,
                total: result.total,
                table: {
                  ...(groups ? { groups } : {}),
                  rowHref: (row) => orderPageHref(url, row),
                },
                lang: ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
                ...(productId
                  ? {
                      narrowedTo: {
                        label: String(variant?.displayName ?? variant?.defaultCode ?? productId),
                        clearHref: `${without.pathname}${without.search}`,
                      },
                    }
                  : {}),
                detailSuffix,
              },
              {
                ...search.frame,
                chrome: {
                  ...search.frame.chrome,
                  pager: grouped ? null : pager(url, search.state.page, result.rows.length, result.total),
                },
              },
            )
          },
        })
      },
    // What one product sold, a row per variant (P32), opened from the product page; without one, D19.
    '/admin/sales/analysis':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const templateId = url.searchParams.get('templateId') || null
        // Without a product it is the analysis of the company's sales (D19).
        if (!templateId) return analysisPage(ctx, url, req)
        if (!(await ctx.allows('sale.productSales', url, req))) return text('Forbidden', { status: 403 })
        const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
        const sales = templateId
          ? ((await ctx.call('sale.productSales', { templateId, days: ANALYSIS_DAYS }, url, req)) as {
              days: number
              variants: Array<{
                productId: string
                quantity: number
                revenue: number
                orders: number
                lastAt: string | null
              }>
            } | null)
          : null
        const variants = sales
          ? ((await optionalRead<AnyRow[]>(
              ctx,
              'product.listVariants',
              { templateId, includeArchived: true },
              url,
              req,
              [],
            )) as AnyRow[])
          : []
        const named = new Map(variants.map((row) => [String(row.id), row]))
        const live = await ctx.live(req)
        // Revenue follows the product's money rule (P16): who may read costs may read it.
        const money =
          Boolean(live.functions?.['product.listVariantCosts']) &&
          (await ctx.allows('product.listVariantCosts', url, req))
        const productHref = await productPageLink(ctx, url, req)
        const product = sales
          ? {
              name: String(variants[0]?.templateName ?? templateId),
              href: productHref(templateId),
            }
          : null
        return adminPage(ctx, url, req, {
          title: 'sale_backend.analysis.title',
          active: '/admin/sales/orders',
          body: (_, frame) =>
            salesAnalysisScreen(
              _,
              {
                product,
                days: sales?.days ?? ANALYSIS_DAYS,
                money,
                lang,
                rows: (sales?.variants ?? []).map((row) => {
                  const variant = named.get(row.productId)
                  return {
                    id: row.productId,
                    variant: String(variant?.displayName ?? row.productId),
                    code: String(variant?.defaultCode ?? ''),
                    quantity: row.quantity,
                    revenue: money ? row.revenue : null,
                    orders: row.orders,
                    lastAt: row.lastAt,
                    href: inLocale(url, `/admin/sales/orders?productId=${encodeURIComponent(row.productId)}`),
                  }
                }),
              },
              frame,
            ),
        })
      },
    '/admin/sales/quotations/{id}': detail,
    '/admin/sales/orders/{id}': detail,
  },
  messages: { vi, en },
  fills: {
    'partner_backend:record.salesProfile': `{% if may.sale.getPartnerWarning %}{% island "sale.customer-warning" %}{% endif %}`,
    'backend:runtime': `{% island "sale.invoice-policy-modal" %}{% island "sale.variant-matrix-modal" %}{% island "sale.tag-modal" %}{% island "sale.team-modal" %}`,
    // A quotation or order opens on its own page, rendered client side by the KetSuite
    // record runtime in its page presentation.
    'sale_backend:order.page': `{% island "sale.order-page" %}`,
  },
})
