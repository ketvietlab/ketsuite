import { json, text, type Route, type Row, type ServeContext } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { defineRecordPageIsland, type RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import { shell } from '../../../ui/index.ts'
import { adminPage, inLocale } from '../../backend/screen.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'

export const salesConfigurationIsland = defineRecordPageIsland({
  kind: 'sale.configuration',
  client: 'sales-configuration-page.mjs',
  export: 'salesConfigurationPage',
})
export const salesConfigurationContext =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.getConfiguration', url, req))) return text('Forbidden', { status: 403 })
    const record = (await ctx.call('sale.getConfiguration', {}, url, req)) as Row
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: { record, lang, save: await ctx.allows('sale.saveConfiguration', url, req) },
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
export const salesConfigurationRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.getConfiguration', url, req))) return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'sale_backend.configuration.title',
      active: '/admin/sales/configuration',
      body: (_, frame) =>
        shell(
          _,
          _('sale_backend.configuration.title'),
          html`${trustedMarkup(
            renderIsland(
              'sale.configuration-page',
              (props) => salesConfigurationIsland.view!(props as unknown as RecordPageIslandProps),
              {
                id: 'sales',
                title: _('sale_backend.configuration.title'),
                loading: _('backend.relation.loading'),
                back: inLocale(url, '/admin/sales/quotations'),
              },
            ),
          )}`,
          {
            ...frame,
            topbar: false,
            titled: false,
            ...(frame.applications
              ? {
                  applications: {
                    ...frame.applications,
                    helpLabel: HELP[_.locale === 'en' ? 'en' : 'vi'].trigger,
                  },
                }
              : {}),
          },
        ),
    })
  }
