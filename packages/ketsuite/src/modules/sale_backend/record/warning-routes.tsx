import { json, text, type Route, type ServeContext, type Row } from '@ketvietlab/ketjs'
import { defineIsland } from '@ketvietlab/ketjs-view'
import { recordPanelLoading } from '../../../ui/record-modal.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
export const warningPreviewIsland = defineIsland<{ id: string; title: string; loading?: string }>()({
  props: { id: 'text', title: 'text', loading: 'text?' },
  key: ['id'],
  client: 'sale-warning-preview.mjs',
  export: 'saleWarningPreview',
  view: (props) => ({ view: () => recordPanelLoading(props) }),
})
export const warningPreviewRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.previewWarnings', url, req))) return text('Forbidden', { status: 403 })
    let input: Row
    try {
      input = JSON.parse(url.searchParams.get('selection') ?? '{}')
    } catch {
      return text('Invalid selection', { status: 400 })
    }
    if (
      !input ||
      !Array.isArray(input.productIds) ||
      input.productIds.length > 500 ||
      input.productIds.some((id) => typeof id !== 'string' || id.length > 200) ||
      (input.partnerId != null && typeof input.partnerId !== 'string')
    )
      return text('Invalid selection', { status: 400 })
    const data = (await ctx.call(
      'sale.previewWarnings',
      { partnerId: input.partnerId || undefined, productIds: input.productIds },
      url,
      req,
    )) as Row
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    return json({
      data: { ...data, lang },
      messages: {
        ...USER_RECORD_MODAL_LABELS[lang],
        'sale_backend.warning.title': ctx.translate(lang)('sale_backend.warning.title'),
      },
    })
  }

export const customerWarningIsland = defineIsland<{ partnerId: string; lang: string }>()({
  props: { partnerId: 'id', lang: 'text' },
  key: ['partnerId'],
  client: 'sale-customer-warning.mjs',
  export: 'customerWarningPanel',
  view: (props) => ({
    view: () =>
      recordPanelLoading({
        id: props.partnerId,
        title: '',
        loading: props.lang === 'en' ? 'Loading' : 'Đang tải',
      }),
  }),
})
export const customerWarningRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.getPartnerWarning', url, req))) return text('Forbidden', { status: 403 })
    const record = await ctx.call('sale.getPartnerWarning', { partnerId: params.id }, url, req)
    if (!record) return text('Not found', { status: 404 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: { record, lang, save: await ctx.allows('sale.savePartnerWarning', url, req) },
      messages: {
        ...USER_RECORD_MODAL_LABELS[lang],
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) => key.startsWith('sale_backend.') || key.startsWith('sale.'),
          ),
        ),
      },
    })
  }
