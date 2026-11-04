import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import { defineRecordPageIsland } from '../../../ui/record-modal.tsx'
import { recordBack } from '../list/shared.ts'
import { adminPage } from '../../backend/screen.ts'
import { pricelistPageScreen } from '../screens/pricelist-page.tsx'

export const pricelistPageIsland = defineRecordPageIsland({
  kind: 'pricing.pricelist',
  client: 'pricelist-page.mjs',
  export: 'pricelistPage',
})
export const pricelistPageRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (
      !(await ctx.allows('pricing.listPricelists', url, req)) ||
      !(await ctx.allows('pricing.listPricelistItems', url, req))
    )
      return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'pricing_backend.title',
      active: '/admin/pricing/pricelists',
      body: (_, frame) =>
        pricelistPageScreen(
          _,
          frame,
          html`${trustedMarkup(
            renderIsland(
              'pricing.pricelist-page',
              (props) => pricelistPageIsland.view!(props as unknown as RecordPageIslandProps),
              {
                id: params.id,
                title: _('pricing_backend.title'),
                loading: _('backend.relation.loading'),
                back: recordBack(url),
                width: 'wide',
                dialog: url.searchParams.get('dialog'),
              },
            ),
          )}`,
        ),
    })
  }
