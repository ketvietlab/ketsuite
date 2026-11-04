import { text, withHeaders } from '@ketvietlab/ketjs'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { importsScreen } from '../screens/imports.tsx'
import { IMPORT_PATH } from './shared.ts'
const EXPORT_NAMES = 5
export const importRoutes: Record<string, RouteEntry> = {
  [`${IMPORT_PATH}/export`]: (ctx) => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('product.exportImportSheet', url, req))) return text('Forbidden', { status: 403 })
    const result = (await ctx.call(
      'product.exportImportSheet',
      { locale: url.searchParams.get('lang') ?? 'vi' },
      url,
      req,
    )) as { ok: boolean; csv?: string; errors?: { product?: string }[] }
    if (!result.ok) {
      // Name the records to correct; a long catalogue shows the first few and a count.
      const t = ctx.translate(ctx.localeOf(url, req))
      const names = [...new Set((result.errors ?? []).map((issue) => issue.product).filter(Boolean))]
      const shown = names.slice(0, EXPORT_NAMES).join(', ')
      const products =
        names.length > EXPORT_NAMES
          ? t('product_backend.import.exportMore', { names: shown, count: names.length - EXPORT_NAMES })
          : shown
      return text(t('product_backend.import.exportError', { products }), { status: 422 })
    }
    return withHeaders(text(result.csv ?? ''), {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="product-import.csv"',
      'cache-control': 'no-store',
    })
  },
  [IMPORT_PATH]: (ctx) => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('product_backend.searchImports', url, req)))
      return text('Forbidden', { status: 403 })
    const create = await ctx.allows('product.importProducts', url, req)
    return adminPage(ctx, url, req, {
      title: 'product_backend.import.title',
      body: (_, frame) => importsScreen(_, frame, url, create),
    })
  },
}
