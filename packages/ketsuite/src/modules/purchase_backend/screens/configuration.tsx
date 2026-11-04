import { json, text, type Route, type Row, type ServeContext } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { defineRecordPageIsland, type RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import { shell } from '../../../ui/index.ts'
import { adminPage, inLocale } from '../../backend/screen.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'

/** The company's purchasing settings, behind the rail's gear beside the Sales and Stock settings. */
export const purchaseConfigurationIsland = defineRecordPageIsland({
  kind: 'purchase.configuration',
  client: 'purchase-configuration-page.mjs',
  export: 'purchaseConfigurationPage',
})

export const purchaseConfigurationContext =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('purchase.getConfiguration', url, req))) return text('Forbidden', { status: 403 })
    const record = (await ctx.call('purchase.getConfiguration', {}, url, req)) as Row
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: { record, lang, save: await ctx.allows('purchase.saveConfiguration', url, req) },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) => key.startsWith('purchase_backend.') || key.startsWith('purchase.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }

export const purchaseConfigurationRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('purchase.getConfiguration', url, req))) return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'purchase_backend.configuration.title',
      active: '/admin/purchase/configuration',
      body: (_, frame) =>
        shell(
          _,
          _('purchase_backend.configuration.title'),
          html`${trustedMarkup(
            renderIsland(
              'purchase.configuration-page',
              (props) => purchaseConfigurationIsland.view!(props as unknown as RecordPageIslandProps),
              {
                id: 'purchase',
                title: _('purchase_backend.configuration.title'),
                loading: _('backend.relation.loading'),
                back: inLocale(url, '/admin/purchase'),
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
