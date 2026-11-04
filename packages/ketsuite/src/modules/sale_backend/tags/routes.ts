import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { saleTagsScreen } from './screens.tsx'
import { tagContext, tagRead } from './read.ts'
import { TAG_PATH } from './shared.ts'

const tagList =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.listTags', url, req))) return text('Forbidden', { status: 403 })
    const create = await ctx.allows('sale.saveTag', url, req)
    return adminPage(ctx, url, req, {
      title: 'sale_backend.tag.title',
      body: (_, frame) => saleTagsScreen(_, frame, url, create),
    })
  }

export const tagRoutes = {
  [TAG_PATH]: tagList,
  [`${TAG_PATH}/read`]: tagRead,
  [`${TAG_PATH}/{id}/context`]: tagContext,
}
