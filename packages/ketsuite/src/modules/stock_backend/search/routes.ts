import { text } from '@ketvietlab/ketjs'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { stockSearchScreen } from './screen.tsx'
import { SEARCH_PATH } from './shared.ts'
export const searchRoutes: Record<string, RouteEntry> = {
  [SEARCH_PATH]: (ctx) => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('stock_backend.searchStock', url, req))) return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'stock_backend.search.title',
      body: (_, frame) => stockSearchScreen(_, frame, url),
    })
  },
}
