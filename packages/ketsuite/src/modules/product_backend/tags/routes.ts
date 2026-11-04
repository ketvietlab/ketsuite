import { text } from '@ketvietlab/ketjs'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { tagsScreen } from '../screens/tags.tsx'
import { TAG_PATH } from './shared.ts'
export const tagRoutes: Record<string, RouteEntry> = {
  [TAG_PATH]: (ctx) => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('product_backend.searchTags', url, req))) return text('Forbidden', { status: 403 })
    const create = await ctx.allows('product.saveTag', url, req)
    return adminPage(ctx, url, req, {
      title: 'product_backend.tag.title',
      body: (_, frame) => tagsScreen(_, frame, url, create),
    })
  },
}
