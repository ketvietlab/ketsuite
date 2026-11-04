import { text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { variantInput } from './island.tsx'
import type { VariantAnswer, VariantRow } from './shape.ts'
import { exportProductImportCsv } from '../../product/import-format.ts'
export async function exportVariantList(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  if (req.method !== 'GET') return text('GET', { status: 405 })
  const live = (await ctx.live(req)).functions
  const stock =
    Boolean(live['stock_backend.searchProductVariants']) &&
    (await ctx.allows('stock_backend.searchProductVariants', url, req))
  const read = stock ? 'stock_backend.searchProductVariants' : 'product_backend.searchVariants'
  if (!(await ctx.allows(read, url, req))) return text('Forbidden', { status: 403 })
  const lang = ctx.localeOf(url, req),
    _ = ctx.translate(lang)
  const input = { ...variantInput(url.href, 100), page: 1 },
    rows: VariantRow[] = [],
    seen = new Set<string>()
  let answer: VariantAnswer
  do {
    answer = (await ctx.call(read, input, url, req)) as VariantAnswer
    for (const row of answer.rows)
      if (!seen.has(row.id)) {
        seen.add(row.id)
        rows.push(row)
      }
    input.page++
  } while (input.page <= answer.pages)
  const keys = [
    'name',
    'code',
    'barcode',
    'price',
    ...(answer.money ? ['cost'] : []),
    ...(answer.stock ? ['onHand', 'available'] : []),
  ]
  const csv = exportProductImportCsv([
    keys.map((key) => _(`product_backend.variantList.${key}`)),
    ...rows.map((row) =>
      keys.map((key) =>
        key === 'name'
          ? [row.name, row.values].filter(Boolean).join(' · ')
          : (row[key as keyof VariantRow] ?? ''),
      ),
    ),
  ])
  return withHeaders(text(csv), {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="product-variants.csv"',
    'cache-control': 'no-store',
  })
}
