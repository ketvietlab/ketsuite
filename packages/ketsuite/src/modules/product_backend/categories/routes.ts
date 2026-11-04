import { text } from '@ketvietlab/ketjs'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { categoriesScreen } from '../screens/categories.tsx'
import { CATEGORY_PATH } from './shared.ts'
export const categoryRoutes: Record<string, RouteEntry> = {
  [CATEGORY_PATH]: (ctx) => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('product_backend.searchCategories', url, req)))
      return text('Forbidden', { status: 403 })
    const create =
      (await ctx.allows('product.saveCategory', url, req)) &&
      (await ctx.allows('product.saveCategoryRecord', url, req))
    return adminPage(ctx, url, req, {
      title: 'product_backend.category.title',
      body: (_, frame) => categoriesScreen(_, frame, url, create),
    })
  },
}
