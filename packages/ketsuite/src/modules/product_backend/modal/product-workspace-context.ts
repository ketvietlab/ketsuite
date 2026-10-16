// The product page's read: the template record (`product.templateModalContext`) with
// what other modules know about it, composed here because `product` depends on none
// of them. Each fact is its module's own function, read only when that module is
// composed and the viewer may call it; a missing one leaves its card out rather than
// refusing the page. From the facts the page also gets the figures it leads with, the
// problems worth acting on and how complete the product is.

import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { RECORD_NEW_ID } from '../../../ui/record-modal.tsx'
import { inLocale } from '../../backend/screen.ts'

type Rule = {
  id: string
  productId: string
  locationId: string
  minQuantity: number
  maxQuantity: number
  available: number
}
type Figures = {
  onHand: number
  reserved: number
  available: number
  incoming: number
  outgoing: number
  forecasted: number
}
type StockFacts = {
  tracked: boolean
  tracking: string
  warehouses: Array<
    Figures & { id: string; name: string; code: string; locationId: string | null; orderpoints: Rule[] }
  >
  totals: Figures
  variants: Record<string, number>
  inUse: boolean
}
type SalesFacts = {
  days: number
  quantity: number
  revenue: number | null
  orders: number
  lastAt: string | null
}
type VendorRow = {
  id: string
  vendor: string
  vendorCode: string | null
  price: string | null
  minQty: number
  delay: number
  dateEnd: string | null
}
type Variant = {
  id: string
  label: string
  barcode: string | null
  defaultCode: string | null
  active: boolean
  price: string
  costPrice: string | null
}
type Base = {
  data: {
    record: Record<string, unknown> & {
      id: string
      name: string
      type: string
      listPrice: string
      saleOk: boolean
      active: boolean
      isStorable: boolean
      costPrice: string | null
      defaultVariantId: string | null
    }
    images: unknown[]
    variants: Variant[]
    hasVariants: boolean
    permissions: Record<string, boolean>
  } & Record<string, unknown>
  messages: Record<string, string>
}

export type ProductIssue = {
  code: string
  tone: 'critical' | 'warning' | 'info'
  params?: Record<string, unknown>
}
export type ProductCompleteness = { score: number; items: Array<{ key: string; done: boolean }> }

const SALES_DAYS = 30
const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * Gross profit per unit and margin on the saved prices. With variants, over the selling
 * variants whose cost is known; a price of zero has no margin.
 */
export const productMargin = (
  base: Pick<Base['data'], 'record' | 'variants' | 'hasVariants'>,
): { profit: number; percent: number } | null => {
  const pairs = base.hasVariants
    ? base.variants
        .filter((variant) => variant.active && variant.costPrice !== null)
        .map((variant) => [Number(variant.price), Number(variant.costPrice)] as const)
    : base.record.costPrice === null
      ? []
      : [[Number(base.record.listPrice), Number(base.record.costPrice)] as const]
  const priced = pairs.filter(([price]) => price > 0)
  if (!priced.length || base.record.saleOk === false) return null
  const price = priced.reduce((sum, [value]) => sum + value, 0) / priced.length
  const cost = priced.reduce((sum, [, value]) => sum + value, 0) / priced.length
  return { profit: Math.round(price - cost), percent: round1(((price - cost) / price) * 100) }
}

/** Things to act on, most serious first; codes and parameters, the page words them. */
export const productIssues = (facts: {
  saleOk: boolean
  active: boolean
  stock: StockFacts | null
  margin: { profit: number } | null
  variants: Variant[]
}): ProductIssue[] => {
  const issues: ProductIssue[] = []
  const stock = facts.stock?.tracked ? facts.stock : null
  if (stock && facts.saleOk && facts.active && stock.totals.available <= 0)
    issues.push({ code: 'outOfStock', tone: 'critical' })
  else if (stock) {
    // The rule furthest below its minimum names the warehouse to look at.
    const short = stock.warehouses
      .flatMap((warehouse) =>
        warehouse.orderpoints.map((rule) => ({
          warehouse: warehouse.name,
          rule,
          gap: rule.minQuantity - rule.available,
        })),
      )
      .filter((row) => row.gap > 0)
      .sort((a, b) => b.gap - a.gap)
    if (short[0])
      issues.push({
        code: 'belowMinimum',
        tone: 'warning',
        params: {
          warehouse: short[0].warehouse,
          available: short[0].rule.available,
          minimum: short[0].rule.minQuantity,
          // The furthest-below warehouse is named; the rest are only counted.
          others: short.length - 1,
        },
      })
  }
  if (facts.margin && facts.margin.profit < 0) issues.push({ code: 'belowCost', tone: 'critical' })
  const missing = facts.variants.filter((variant) => variant.active && !variant.barcode).length
  if (missing) issues.push({ code: 'variantBarcodes', tone: 'warning', params: { count: missing } })
  return issues
}

/** What is still to fill before the product is ready to sell everywhere. */
export const productCompleteness = (base: Base['data'], money: boolean): ProductCompleteness => {
  const record = base.record
  const selling = base.variants.filter((variant) => variant.active)
  const items: Array<[string, boolean]> = [
    ['image', base.images.length > 0],
    ['description', String(record.description ?? '').trim() !== ''],
    [
      'defaultCode',
      base.hasVariants ? selling.every((variant) => variant.defaultCode) : Boolean(record.defaultCode),
    ],
    ['barcode', base.hasVariants ? selling.every((variant) => variant.barcode) : Boolean(record.barcode)],
    ['categoryId', Boolean(record.categoryId)],
    // Cost is a fact only money readers can see, so it only counts for them.
    ...(money
      ? [
          [
            'costPrice',
            base.hasVariants
              ? selling.every((variant) => Number(variant.costPrice ?? 0) > 0)
              : Number(record.costPrice ?? 0) > 0,
          ] as [string, boolean],
        ]
      : []),
    ...(record.type === 'goods' ? [['weight', Number(record.weight ?? 0) > 0] as [string, boolean]] : []),
  ]
  return {
    score: Math.round((items.filter(([, done]) => done).length / items.length) * 100),
    items: items.map(([key, done]) => ({ key, done })),
  }
}

export const productWorkspaceContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('product.templateModalContext', url, req)))
      return text('Forbidden', { status: 403 })
    const lang = (url.searchParams.get('lang') ?? ctx.localeOf(url, req)) === 'en' ? 'en' : 'vi'
    const creating = params.id === RECORD_NEW_ID
    // The base read answers null both without the right and without the product: say which.
    if (!(await ctx.allows(creating ? 'product.saveTemplate' : 'product.getTemplate', url, req)))
      return text('Forbidden', { status: 403 })
    const base = (await ctx.call(
      'product.templateModalContext',
      creating ? { locale: lang } : { id: params.id, locale: lang },
      url,
      req,
    )) as Base | null
    if (!base) return text('Not found', { status: 404 })
    const manifest = await ctx.live(req)
    // `allows` says yes to every name for an unrestricted viewer, composed or not.
    const usable = async (fn: string): Promise<boolean> =>
      Boolean(manifest.functions?.[fn]) && (await ctx.allows(fn, url, req))
    const read = async <T>(fn: string, input: Record<string, unknown>): Promise<T | null> =>
      (await usable(fn)) ? ((await ctx.call(fn, input, url, req)) as T | null) : null
    const templateId = base.data.record.id
    const units = await usable('uom.listUnits')
    const [stock, sales, vendors, orderpoints] = creating
      ? [null, null, null, false]
      : await Promise.all([
          read<StockFacts>('stock.productWorkspace', { templateId }),
          read<SalesFacts>('sale.productSales', { templateId, days: SALES_DAYS }),
          read<VendorRow[]>('purchase.listProductVendors', { templateId }),
          usable('stock.saveProductOrderpoints'),
        ])
    const money = base.data.permissions.money === true
    const margin = creating || !money ? null : productMargin(base.data)
    const variants = base.data.variants.map((variant) => ({
      ...variant,
      available: stock?.tracked ? (stock.variants[variant.id] ?? 0) : null,
    }))
    const name = base.data.record.name
    const forecastFor = base.data.hasVariants ? null : base.data.record.defaultVariantId
    return json({
      data: {
        ...base.data,
        variants,
        stock,
        // Revenue is money: a reader without costs and prices sees how many, not how much.
        sales: sales ? { ...sales, revenue: money ? sales.revenue : null } : null,
        vendors: vendors ? vendors.map((row) => ({ ...row, price: money ? row.price : null })) : null,
        margin,
        uomLocked: !creating && stock?.inUse === true,
        issues: creating
          ? []
          : productIssues({
              saleOk: base.data.record.saleOk !== false,
              active: base.data.record.active !== false,
              stock,
              margin,
              variants: base.data.variants,
            }),
        completeness: creating ? null : productCompleteness(base.data, money),
        permissions: {
          ...base.data.permissions,
          orderpoints: orderpoints === true && stock?.tracked === true,
        },
        links: {
          forecast:
            stock && forecastFor
              ? inLocale(url, `/admin/stock/forecast?productId=${encodeURIComponent(forecastFor)}`)
              : stock
                ? inLocale(url, '/admin/stock/forecast')
                : null,
          orders: sales ? inLocale(url, `/admin/sales/orders?q=${encodeURIComponent(name)}`) : null,
          vendorPricelists: vendors
            ? inLocale(url, `/admin/purchase/vendor-pricelists?q=${encodeURIComponent(name)}`)
            : null,
          list: inLocale(url, '/admin/product/templates'),
          uoms: units ? inLocale(url, '/admin/product/uoms') : null,
        },
      },
      messages: {
        ...base.messages,
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {})
            .filter(([key]) => key.startsWith('stock.error.orderpoint.'))
            .map(([key, value]) => [key, String(value)]),
        ),
      },
    })
  }
