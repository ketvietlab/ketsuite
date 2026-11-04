import { pricelistRuleCommand, pricelistRecordCommand } from './record/command.ts'
import { pricelistPageIsland, pricelistPageRoute } from './record/routes.ts'
import { pricelistContext } from './record/context.ts'
import { randomUUID } from 'node:crypto'
import { pricelistIslands } from './list/islands.ts'
import { pricelistRead, searchConfig, listLabels } from './list/read.ts'
import { queryFromUrl, LIST_PATH } from './list/shared.ts'
import { searchFilterFunctions } from './search-functions.ts'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route } from '@ketvietlab/ketjs'
import { modalWorkspace } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { Req } from '../backend/screen.ts'
import { pricelistCreateModal, pricelistDetailScreen, pricelistsScreen } from './screens/index.ts'
import type { PricelistItemValues, PricelistValues } from './screens/index.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const validCreateId = (value?: string): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const errorsOf = (result: unknown): string[] =>
  ((result as { errors?: unknown[] } | null)?.errors ?? []).map((error) => {
    if (typeof error === 'string') return error
    const row = error as { field?: unknown; message?: unknown; code?: unknown }
    const message = String(row.message ?? row.code ?? 'invalid')
    return row.field ? `${String(row.field)}: ${message}` : message
  })

const pathWith = (url: URL, path: string, values: Record<string, string> = {}): string => {
  const target = new URL(inLocale(url, path), url)
  for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value)
  return `${target.pathname}${target.search}`
}

export default defineModule({
  name: 'pricing_backend',
  version: '0.1.0',
  depends: ['pricing', 'backend'],
  title: 'Bảng giá trong quản trị',
  summary: 'Danh sách bảng giá theo company.',
  category: 'Hệ thống',
  functions: searchFilterFunctions,
  assets: new URL('./client/', import.meta.url),
  islands: { 'pricing.pricelist-page': pricelistPageIsland, ...pricelistIslands },
  menus: {
    // Pricelists are configuration: behind the rail's gear, with the other sales settings (D6).
    'pricing.lists': {
      parent: 'admin.config',
      label: 'menu.lists',
      path: '/admin/pricing/pricelists',
      needs: 'pricing.listPricelists',
      for: ['pricing.savePricelist'],
      sequence: 2006,
    },
  },
  routes: {
    '/admin/pricing/pricelists/read': pricelistRead,
    '/admin/pricing/rule-command': pricelistRuleCommand,
    '/admin/pricing/record-command': pricelistRecordCommand,
    '/admin/pricing/pricelists/{id}/context': pricelistContext,
    '/admin/pricing/pricelists':
      (ctx): Route =>
      async (url, req) => {
        if (!(await ctx.allows('pricing.listPricelists', url, req))) return text('Forbidden', { status: 403 })
        const canCreate = await ctx.allows('pricing.savePricelist', url, req)
        if (!canCreate && (req.method === 'POST' || url.searchParams.get('create') === '1'))
          return text('Forbidden', { status: 403 })
        let rejected: { values: PricelistValues; errors: string[] } | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          if (form.action !== 'create') return text('invalid action', { status: 400 })
          const id = validCreateId(form.id) ? form.id : randomUUID()
          const result = await ctx.call(
            'pricing.savePricelist',
            { id, name: form.name ?? '', sequence: Number(form.sequence || 16), active: true },
            url,
            req,
          )
          if ((result as { ok?: boolean }).ok) return seeOther(queryFromUrl(url).href)
          rejected = { values: { ...form, id }, errors: errorsOf(result) }
        }
        if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
        return adminPage(ctx, url, req, {
          title: 'pricing_backend.title',
          active: '/admin/pricing/pricelists',
          body: async (_, frame) => {
            const query = queryFromUrl(url)
            const closeHref = query.href
            const createUrl = new URL(closeHref, url)
            createUrl.searchParams.set('create', '1')
            const createHref = `${createUrl.pathname}${createUrl.search}`
            const source = new URL(`${LIST_PATH}/read`, url)
            for (const name of ['company', 'branch', 'lang'])
              if (url.searchParams.has(name)) source.searchParams.set(name, url.searchParams.get(name)!)
            const workspace = pricelistsScreen(_, frame, {
              props: {
                key: randomUUID(),
                source: `${source.pathname}${source.search}`,
                query,
                search: await searchConfig(ctx, new URL(query.href, url), req, _),
                labels: listLabels(_),
              },
              createHref: canCreate ? createHref : null,
            })
            if (!rejected && url.searchParams.get('create') !== '1') return workspace
            return modalWorkspace(
              workspace,
              pricelistCreateModal(_, {
                action: createHref,
                closeHref,
                values: rejected?.values ?? { id: randomUUID(), sequence: 16 },
                errors: rejected?.errors,
              }),
            )
          },
        })
      },
    '/admin/pricing/pricelists/{id}':
      (ctx): Route =>
      async (url, req, params) => {
        if (req.method === 'GET') return pricelistPageRoute(ctx)(url, req, params)
        const lists = (await ctx.call('pricing.listPricelists', {}, url, req)) as Array<
          Record<string, unknown>
        >
        const row = lists.find((list) => list.id === params.id)
        if (!row) return text('Pricelist not found', { status: 404 })
        let values: PricelistValues = {
          id: String(row.id),
          name: String(row.name),
          currency: String(row.currency),
          sequence: String(row.sequence),
          active: row.active === true,
        }
        let errors: string[] | undefined
        let itemValues: PricelistItemValues = {
          id: randomUUID(),
          appliedOn: '3_global',
          minQuantity: '0',
          base: 'list_price',
          computePrice: 'fixed',
        }
        let itemErrors: string[] | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          if (form.action === 'save-pricelist') {
            const result = await ctx.call(
              'pricing.savePricelist',
              {
                id: params.id,
                name: form.name ?? '',
                sequence: Number(form.sequence || 16),
                active: form.active === '1',
              },
              url,
              req,
            )
            if ((result as { ok?: boolean }).ok)
              return seeOther(pathWith(url, `/admin/pricing/pricelists/${encodeURIComponent(params.id)}`))
            values = { ...values, ...form, id: params.id, active: form.active === '1' }
            errors = errorsOf(result)
          } else if (form.action === 'add-item') {
            const optional = (name: string) => (form[name] ? { [name]: form[name] } : {})
            const id = validCreateId(form.id) ? form.id : randomUUID()
            const result = await ctx.call(
              'pricing.savePricelistItem',
              {
                id,
                pricelistId: params.id,
                appliedOn: form.appliedOn || '3_global',
                ...optional('categoryId'),
                ...optional('templateId'),
                ...optional('productId'),
                ...optional('uomId'),
                minQuantity: form.minQuantity || '0',
                ...optional('dateStart'),
                ...optional('dateEnd'),
                base: form.base || 'list_price',
                ...optional('basePricelistId'),
                computePrice: form.computePrice || 'fixed',
                fixedPrice: form.fixedPrice || '0',
                percentPrice: form.percentPrice || '0',
                priceDiscount: form.priceDiscount || '0',
                priceRound: form.priceRound || '0',
                priceSurcharge: form.priceSurcharge || '0',
                priceMinMargin: form.priceMinMargin || '0',
                priceMaxMargin: form.priceMaxMargin || '0',
              },
              url,
              req,
            )
            if ((result as { ok?: boolean }).ok)
              return seeOther(pathWith(url, `/admin/pricing/pricelists/${encodeURIComponent(params.id)}`))
            itemValues = { ...form, id }
            itemErrors = errorsOf(result)
          } else return text('invalid action', { status: 400 })
        }
        if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
        const items = (await ctx.call(
          'pricing.listPricelistItems',
          { pricelistId: params.id },
          url,
          req,
        )) as Array<Record<string, unknown>>
        return adminPage(ctx, url, req, {
          title: String(row.name),
          translate: false,
          active: '/admin/pricing/pricelists',
          body: (_, frame) =>
            pricelistDetailScreen(_, frame, {
              action: pathWith(url, `/admin/pricing/pricelists/${encodeURIComponent(params.id)}`),
              cancelHref: inLocale(url, '/admin/pricing/pricelists'),
              values,
              items,
              itemValues,
              errors,
              itemErrors,
            }),
        })
      },
  },
  messages: {
    vi: {
      'app.title': 'Bảng giá trong quản trị',
      'app.summary': 'Quản lý bảng giá theo công ty.',
      'app.category': 'Hệ thống',
      'menu.app': 'Bảng giá',
      'menu.lists': 'Bảng giá',
      title: 'Bảng giá',
      'col.name': 'Tên',
      'col.state': 'Trạng thái',
      'col.sequence': 'Thứ tự',
      'col.currency': 'Tiền tệ',
      'col.active': 'Đang hoạt động',
      'state.active': 'Đang hoạt động',
      'state.archived': 'Đã lưu trữ',
      'action.create': 'Tạo bảng giá',
      'action.cancel': 'Hủy',
      'action.save': 'Lưu',
      'action.back': 'Về danh sách',
      'action.add': 'Thêm quy tắc',
      'create.title': 'Tạo bảng giá',
      'create.hint': 'Đặt tên và thứ tự ưu tiên; tiền tệ được lấy từ công ty hiện tại.',
      'detail.settings': 'Thiết lập bảng giá',
      'items.title': 'Quy tắc giá',
      'items.empty': 'Chưa có quy tắc giá.',
      'items.hint': 'Thêm quy tắc để xác định giá theo sản phẩm, số lượng hoặc ngày.',
      'items.add': 'Thêm quy tắc',
      'items.formulaHint': 'Chọn phạm vi, đơn vị đóng gói và cách tính giá.',
      'field.uomId': 'Đóng gói',
      'packaging.invalidDate': 'Ngày giờ không hợp lệ trong múi giờ đang chọn.',
      'packaging.target': 'Sản phẩm / nhóm',
      'packaging.all': 'Mọi đơn vị',
      'packaging.editRule': 'Sửa quy tắc giá',
      'packaging.help': 'Để trống để áp dụng cho mọi đơn vị của sản phẩm.',
      'packaging.quantityHelp': 'Tính theo đơn vị dòng bán: 3 thùng là 3.',
      'packaging.fixedHelp': 'Có đóng gói: giá một gói. Không chọn: giá đơn vị gốc.',
      'field.appliedOn': 'Áp dụng cho',
      'field.categoryId': 'Nhóm sản phẩm',
      'field.templateId': 'Mẫu sản phẩm',
      'field.productId': 'Biến thể',
      'field.minQuantity': 'Số lượng tối thiểu',
      'field.dateStart': 'Bắt đầu',
      'field.dateEnd': 'Kết thúc',
      'field.base': 'Tính trên',
      'field.basePricelistId': 'Bảng giá gốc',
      'field.computePrice': 'Cách tính',
      'field.fixedPrice': 'Giá cố định',
      'field.percentPrice': 'Giảm giá %',
      'field.priceDiscount': 'Chiết khấu công thức %',
      'field.priceRound': 'Làm tròn',
      'round.none': 'Không làm tròn',
      'field.priceSurcharge': 'Phụ phí',
      ruleError: 'Dòng {line}: {reason}',
      'field.priceMinMargin': 'Biên tối thiểu',
      'field.priceMaxMargin': 'Biên tối đa',
      'appliedOn.3_global': 'Tất cả sản phẩm',
      'appliedOn.2_product_category': 'Nhóm sản phẩm',
      'appliedOn.1_product': 'Mẫu sản phẩm',
      'appliedOn.0_product_variant': 'Biến thể sản phẩm',
      'base.list_price': 'Giá bán',
      'base.standard_price': 'Giá vốn',
      'base.pricelist': 'Bảng giá khác',
      'compute.fixed': 'Giá cố định',
      'compute.percentage': 'Phần trăm',
      'compute.formula': 'Công thức',
      empty: 'Chưa có bảng giá.',
      emptyHint: 'Tạo bảng giá đầu tiên để bắt đầu.',
      'list.offline': 'Đang ngoại tuyến. Kết nối lại rồi thử tải danh sách.',
      'list.noMatches': 'Không có bảng giá phù hợp',
      'list.noMatchesHint': 'Đổi từ khoá hoặc bỏ bớt bộ lọc để tìm lại.',
    },
    en: {
      'app.title': 'Pricing in admin',
      'app.summary': 'Manage company pricelists.',
      'app.category': 'System',
      'menu.app': 'Pricing',
      'menu.lists': 'Pricelists',
      title: 'Pricelists',
      'col.name': 'Name',
      'col.state': 'State',
      'col.sequence': 'Sequence',
      'col.currency': 'Currency',
      'col.active': 'Active',
      'state.active': 'Active',
      'state.archived': 'Archived',
      'action.create': 'Create pricelist',
      'action.cancel': 'Cancel',
      'action.save': 'Save',
      'action.back': 'Back to list',
      'action.add': 'Add rule',
      'create.title': 'Create pricelist',
      'create.hint': 'Set its name and priority; currency comes from the active company.',
      'detail.settings': 'Pricelist settings',
      'items.title': 'Price rules',
      'items.empty': 'No price rules yet.',
      'items.hint': 'Add rules by product, quantity, or date.',
      'items.add': 'Add rule',
      'items.formulaHint': 'Choose the scope, packaging and price computation.',
      'field.uomId': 'Packaging',
      'packaging.invalidDate': 'Invalid date and time in the selected timezone.',
      'packaging.target': 'Product / category',
      'packaging.all': 'All units',
      'packaging.editRule': 'Edit pricing rule',
      'packaging.help': 'Leave empty to apply to every unit of this product.',
      'packaging.quantityHelp': 'In the sales-line unit: 3 cartons means 3.',
      'packaging.fixedHelp': 'With packaging: price per package. Otherwise: price per base unit.',
      'field.appliedOn': 'Apply on',
      'field.categoryId': 'Category',
      'field.templateId': 'Product template',
      'field.productId': 'Variant',
      'field.minQuantity': 'Minimum quantity',
      'field.dateStart': 'Start date',
      'field.dateEnd': 'End date',
      'field.base': 'Based on',
      'field.basePricelistId': 'Base pricelist',
      'field.computePrice': 'Computation',
      'field.fixedPrice': 'Fixed price',
      'field.percentPrice': 'Discount %',
      'field.priceDiscount': 'Formula discount %',
      'field.priceRound': 'Rounding',
      'round.none': 'No rounding',
      'field.priceSurcharge': 'Surcharge',
      ruleError: 'Row {line}: {reason}',
      'field.priceMinMargin': 'Minimum margin',
      'field.priceMaxMargin': 'Maximum margin',
      'appliedOn.3_global': 'All products',
      'appliedOn.2_product_category': 'Product category',
      'appliedOn.1_product': 'Product template',
      'appliedOn.0_product_variant': 'Product variant',
      'base.list_price': 'Sales price',
      'base.standard_price': 'Cost',
      'base.pricelist': 'Other pricelist',
      'compute.fixed': 'Fixed price',
      'compute.percentage': 'Percentage',
      'compute.formula': 'Formula',
      empty: 'No pricelists yet.',
      emptyHint: 'Create the first pricelist to begin.',
      'list.offline': 'You are offline. Reconnect and retry the list.',
      'list.noMatches': 'No matching pricelists',
      'list.noMatchesHint': 'Change your search or remove filters to try again.',
    },
  },
})
