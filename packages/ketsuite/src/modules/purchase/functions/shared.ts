import type { Ctx, Row } from '@ketvietlab/ketjs'
import { convertQty, type Unit, UomError } from '../../uom/convert.ts'

export const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

export const n = (value: unknown): number => Number(value ?? 0)

export const quantityRound = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

export const quantityText = (value: number): string => String(quantityRound(value))

export const now = (): string => new Date().toISOString()

export const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

export class PurchaseRefused extends Error {
  result: Row
  constructor(result: Row) {
    super('refused')
    this.result = result
  }
}

export const claimRevision = async (ctx: Ctx, order: Row, expectedRevision?: unknown): Promise<boolean> => {
  const revision = n(order.revision)
  if (expectedRevision !== undefined && revision !== n(expectedRevision)) return false
  const changed = await ctx.db.compareAndSet(
    'purchase.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: revision + 1 },
  )
  return 'dryRun' in changed || changed.matched
}

export async function currency(ctx: Ctx): Promise<string> {
  if (!ctx.scope.company) throw new Error('purchase requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  return String(company.currency)
}

/**
 * The next order number for this company.
 *
 * Keyed by the company because `id` is a tenant-wide primary key: the constant
 * `'purchase'` gave the whole tenant one row, so only the first company to raise
 * an order could ever own it. See sale.nextName, which had the same defect.
 */
export async function nextName(ctx: Ctx): Promise<string> {
  if (!ctx.scope.company) throw new Error('purchase requires an active company')
  const id = `${ctx.scope.company}:purchase`
  await ctx.db.insertIfAbsent('purchase.Sequence', { id, nextNumber: 1 })
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = (await ctx.db.select('purchase.Sequence', { id, companyId: ctx.scope.company }))[0]
    if (!row) throw new Error('purchase sequence row disappeared while assigning a number')
    const current = n(row.nextNumber)
    const changed = await ctx.db.compareAndSet(
      'purchase.Sequence',
      { id },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in changed || changed.matched) return `PO${String(current).padStart(5, '0')}`
  }
  throw new Error('purchase sequence did not settle after concurrent updates')
}

export const unitOf = async (ctx: Ctx, id: unknown): Promise<Unit | null> => {
  const row = (await ctx.db.select('uom.Unit', { id }))[0]
  return row
    ? {
        id: String(row.id),
        parentPath: String(row.parentPath ?? ''),
        absoluteFactor: n(row.absoluteFactor),
        rounding: n(row.rounding) || 0.01,
      }
    : null
}

/**
 * A vendor sells in their unit and the warehouse counts in the product's. Both
 * numbers are real and they are not the same number, so every quantity that
 * crosses between a purchase line and a stock move is converted rather than
 * copied. Copying is what put two pieces on the shelf for two boxes of twelve.
 */
export const inUnit = async (
  ctx: Ctx,
  quantity: number,
  fromId: unknown,
  toId: unknown,
): Promise<number | null> => {
  if (String(fromId) === String(toId)) return quantity
  const [from, to] = await Promise.all([unitOf(ctx, fromId), unitOf(ctx, toId)])
  if (!from || !to) return null
  try {
    return convertQty(quantity, from, to)
  } catch (error) {
    if (error instanceof UomError) return null
    throw error
  }
}

export async function productContext(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) return null
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return template ? { product, template } : null
}
