import { encodeListState, parseListState, table, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { productListShape, PRODUCT_LIST_PATH, type ProductListAnswer, type ProductListRow } from './read.ts'
import { exportProductImportCsv } from '../../product/import-format.ts'
import { timezoneOf } from '../../backend/screen.ts'

/** Export the filtered collection using its existing read and its visible table columns. */
export async function exportProductList(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  if (req.method !== 'GET') return text('GET', { status: 405 })
  const live = (await ctx.live(req)).functions
  const stock =
    Boolean(live['stock_backend.searchProductTemplates']) &&
    (await ctx.allows('stock_backend.searchProductTemplates', url, req))
  const read = stock ? 'stock_backend.searchProductTemplates' : 'product_backend.searchTemplates'
  if (!(await ctx.allows(read, url, req))) return text('Forbidden', { status: 403 })
  const lang = ctx.localeOf(url, req),
    _ = ctx.translate(lang)
  const queryUrl = new URL(url)
  queryUrl.pathname = PRODUCT_LIST_PATH
  const state = parseListState(
    productListShape(table(ctx.manifest, 'product.Template'), stock),
    queryUrl,
  ).state
  state.groupBy = []
  state.openGroups = []
  state.groupPages = {}
  state.page = 1
  const rows: ProductListRow[] = [],
    seen = new Set<string>()
  let answer: ProductListAnswer
  do {
    answer = (await ctx.call(
      read,
      { href: encodeListState(state, queryUrl), pageSize: 100, timezone: await timezoneOf(ctx, url, req) },
      url,
      req,
    )) as ProductListAnswer
    for (const row of answer.rows)
      if (!seen.has(row.id)) {
        seen.add(row.id)
        rows.push(row)
      }
    state.page++
  } while (state.page <= answer.pages)
  const keys = [
    'product',
    'type',
    'category',
    ...(answer.stock ? ['available'] : []),
    'price',
    ...(answer.money ? ['margin'] : []),
    'variants',
    'status',
  ]
  const locale = lang === 'en' ? 'en-VN' : 'vi-VN'
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'VND' })
  const csv = exportProductImportCsv([
    keys.map((key) => _(`product_backend.list.col.${key}`)),
    ...rows.map((row) => {
      const price = money.format(Number(row.fromPrice ?? row.listPrice))
      const values: Record<string, unknown> = {
        product: [row.code, row.name].filter(Boolean).join(' · '),
        type: _(`product_backend.type.${row.type}`),
        category: row.category ?? '',
        available: row.available ?? '',
        price: row.priceVaries ? _('product_backend.list.priceFrom', { price }) : price,
        margin:
          row.margin == null
            ? ''
            : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(row.margin) + '%',
        variants: row.variants || '',
        status: _(
          `product_backend.list.status.${!row.active ? 'archived' : row.saleOk ? 'active' : 'notForSale'}`,
        ),
      }
      return keys.map((key) => values[key])
    }),
  ])
  return withHeaders(text(csv), {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="product-list.csv"',
    'cache-control': 'no-store',
  })
}
