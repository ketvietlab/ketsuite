import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { VariantMatrixData } from './matrix-view.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { salesOrderPath } from '../order-path.ts'
export const variantMatrixContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.getVariantMatrix', url, req))) return text('Forbidden', { status: 403 })
    const orderId = url.searchParams.get('matrixOrderId')
    if (!orderId) return text('Not found', { status: 404 })
    const result = (await ctx.call(
      'sale.getVariantMatrix',
      { id: orderId, templateId: params.id },
      url,
      req,
    )) as Omit<VariantMatrixData, 'save' | 'orderHref' | 'lang'> | null
    if (!result) return text('Not found', { status: 404 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const orderHref = new URL(salesOrderPath(result.order.state, orderId), url)
    for (const key of ['lang', 'company', 'branch'])
      if (url.searchParams.has(key)) orderHref.searchParams.set(key, url.searchParams.get(key)!)
    const save =
      (await ctx.allows('sale.setVariantMatrix', url, req)) &&
      !result.order.locked &&
      ['draft', 'sent', 'sale'].includes(String(result.order.state)) &&
      (!result.order.orderAuthority || result.order.orderAuthority === 'local')
    const manifest = await ctx.live(req)
    return json({
      data: { ...result, save, orderHref: orderHref.pathname + orderHref.search, lang },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) => key.startsWith('sale_backend.') || key.startsWith('sale.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
