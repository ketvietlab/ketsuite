import { KetError } from '@ketvietlab/ketjs'
import { createHash } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { categoryDescendants } from './category-tree.ts'

export const categoryRefusal = (field: string, reason: string) => ({
  ok: false as const,
  errors: [{ field, code: `product.error.category.${reason}` }],
})

export const categoryRevision = (row: Row, accounts?: Row) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        row.id,
        row.name,
        row.parentId ?? null,
        row.active !== false,
        accounts?.incomeAccountId ?? null,
        accounts?.expenseAccountId ?? null,
      ]),
    )
    .digest('hex')

export class CategoryPolicyRefused extends Error {
  readonly result: ReturnType<typeof categoryRefusal>
  constructor(field: string, reason: string) {
    super(reason)
    this.result = categoryRefusal(field, reason)
  }
}

export const categoryNameKey = (parentId: unknown, name: unknown) =>
  JSON.stringify([
    parentId || '',
    String(name ?? '')
      .trim()
      .normalize('NFC')
      .toLowerCase(),
  ])

/** Caller owns the transaction. All tree edits lock existing nodes in the same order. */
export async function lockCategories(ctx: Ctx, ids?: readonly string[]): Promise<Row[]> {
  const selected = ids ? new Set(ids) : null
  const rows = (await ctx.db.select('product.Category'))
    .filter((row) => !selected || selected.has(String(row.id)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  for (const row of rows) {
    const held = await ctx.db.compareAndSet(
      'product.Category',
      { id: row.id },
      { name: row.name, parentId: row.parentId ?? null, active: row.active ?? null },
      { parentId: row.parentId ?? null },
    )
    if (!('dryRun' in held) && !held.matched)
      throw new KetError({ code: 'conflict', message: 'The category changed; reload before saving.' })
  }
  return rows
}

/** New assignments and reactivation share the archive lock; historical references stay intact. */
export async function requireActiveCategory(ctx: Ctx, id: unknown, field = 'categoryId') {
  if (!id) return
  const rows = await lockCategories(ctx, [String(id)])
  if (!rows.length) throw new CategoryPolicyRefused(field, 'missing')
  if (rows[0]!.active === false) throw new CategoryPolicyRefused(field, 'inactive')
}

export async function categoryInUse(ctx: Ctx, id: string, rows: readonly Row[]) {
  const subtree = categoryDescendants(rows, [id])
  if (rows.some((row) => row.parentId === id && row.active !== false)) return true
  if (
    (await ctx.db.select('product.Template')).some(
      (row) => row.active !== false && subtree.has(String(row.categoryId)),
    )
  )
    return true
  if (ctx.manifest.models['pricing.PricelistItem']) {
    const activeLists = new Set(
      (await ctx.db.select('pricing.Pricelist'))
        .filter((row) => row.active !== false)
        .map((row) => String(row.id)),
    )
    return (await ctx.db.select('pricing.PricelistItem')).some(
      (row) =>
        row.appliedOn === '2_product_category' &&
        activeLists.has(String(row.pricelistId)) &&
        subtree.has(String(row.categoryId)),
    )
  }
  return false
}

export function categoryFailure(error: unknown) {
  if (error instanceof CategoryPolicyRefused) return error.result
  let current = error
  for (let depth = 0; current && depth < 6; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (
      /category_name_key_unique|UNIQUE constraint failed: product_category\.(?:companyId, product_category\.)?nameKey/i.test(
        message,
      )
    )
      return categoryRefusal('name', 'duplicateName')
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return null
}
