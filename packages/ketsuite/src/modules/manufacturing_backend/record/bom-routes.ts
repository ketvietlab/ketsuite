import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { defineRecordPageIsland } from '../../../ui/record-modal.tsx'
import type { RecordPageIslandProps } from '../../../ui/record-modal.tsx'
import { adminPage, inLocale } from '../../backend/screen.ts'
import { bomPageScreen } from './bom-help.tsx'

export const bomPageIsland = defineRecordPageIsland({
  kind: 'manufacturing.bom',
  client: 'bom-page.mjs',
  export: 'bomPage',
})

export const bomPageRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('manufacturing.getBom', url, req))) return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'manufacturing_backend.boms.title',
      active: '/admin/manufacturing/boms',
      body: (_, frame) =>
        bomPageScreen(
          _,
          frame,
          html`${trustedMarkup(
            renderIsland(
              'manufacturing.bom-page',
              (props) => bomPageIsland.view!(props as unknown as RecordPageIslandProps),
              {
                id: params.id,
                title: _('manufacturing_backend.boms.title'),
                loading: _('backend.relation.loading'),
                back: inLocale(url, '/admin/manufacturing/boms'),
                width: 'wide',
                dialog: url.searchParams.get('dialog'),
              },
            ),
          )}`,
        ),
    })
  }
