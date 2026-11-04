import { text } from '@ketvietlab/ketjs'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { combosScreen } from '../screens/combos.tsx'
import { COMBO_PATH } from './shared.ts'
export const comboRoutes: Record<string, RouteEntry> = {
  [COMBO_PATH]: (ctx) => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('product_backend.searchCombos', url, req)))
      return text('Forbidden', { status: 403 })
    const create = await ctx.allows('product.saveCombo', url, req)
    return adminPage(ctx, url, req, {
      title: 'product_backend.combo.title',
      body: (_, frame) => combosScreen(_, frame, url, create),
    })
  },
}
