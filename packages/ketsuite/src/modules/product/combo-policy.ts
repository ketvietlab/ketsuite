import { KetError, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export const MAX_COMBO_ITEMS = 20
export const comboRefusal = (field: string, reason: string) => ({
  ok: false as const,
  errors: [{ field, code: `product.error.combo.${reason}` }],
})
export class ComboRefused extends Error {
  readonly result: ReturnType<typeof comboRefusal>
  constructor(field: string, reason: string) {
    super(reason)
    this.result = comboRefusal(field, reason)
  }
}
export const comboNameKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('vi')

/** Assignment, edit and archive take these locks before product locks. */
export async function lockCombos(ctx: Ctx, ids: readonly string[]): Promise<Row[]> {
  if (!ids.length) return []
  const Combo = ctx.table('product.Combo')
  const rows = (await ctx.db.all(from(Combo).where(inArray(Combo.id, [...ids])))).sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  )
  for (const row of rows) {
    const held = await ctx.db.compareAndSet(
      'product.Combo',
      { id: row.id },
      { revisionId: row.revisionId, active: row.active },
      { revisionId: row.revisionId },
    )
    if (!('dryRun' in held) && !held.matched)
      throw new KetError({ code: 'conflict', message: 'The combo choice changed; reload before saving.' })
  }
  return rows
}

export async function comboItems(ctx: Ctx, comboId: unknown): Promise<Row[]> {
  return (await ctx.db.select('product.ComboItem', { comboId })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
  )
}

export async function comboUsage(ctx: Ctx, comboId: unknown): Promise<Row[]> {
  const links = await ctx.db.select('product.TemplateCombo', { comboId })
  const ids = new Set(links.map((row) => String(row.templateId)))
  return (await ctx.db.select('product.Template')).filter((row) => ids.has(String(row.id)))
}

/** Full desired list, in default-first order. Item IDs are owned by the server. */
export async function validateComboItems(ctx: Ctx, comboId: unknown, value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_COMBO_ITEMS)
    throw new ComboRefused('items', 'count')
  const seen = new Set<string>()
  const items = value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ComboRefused('items', 'invalid')
    const row = raw as Row
    if (typeof row.productId !== 'string' || !row.productId.trim()) throw new ComboRefused('items', 'invalid')
    const productId = row.productId.trim()
    if (seen.has(productId)) throw new ComboRefused('items', 'duplicate')
    seen.add(productId)
    const extra = String(row.extraPrice ?? '').trim() || '0'
    if (!/^\d{1,10}$/.test(extra)) throw new ComboRefused('items', 'price')
    return { productId, extraPrice: String(BigInt(extra)) }
  })
  const held = new Set((await comboItems(ctx, comboId)).map((row) => String(row.productId)))
  const Product = ctx.table('product.Product'),
    Template = ctx.table('product.Template')
  const products = await ctx.db.all(from(Product).where(inArray(Product.id, [...seen])))
  const templateIds = [...new Set(products.map((row) => String(row.templateId)))].sort()
  const templates = await ctx.db.all(from(Template).where(inArray(Template.id, templateIds)))
  // Product lifecycle and variant configuration also own the template revision. Locking it
  // makes a concurrent retirement/sale-policy edit serialize with a new choice assignment.
  for (const id of templateIds) {
    const row = templates.find((row) => row.id === id)
    if (!row) throw new ComboRefused('items', 'invalid')
    const lock = await ctx.db.compareAndSet(
      'product.Template',
      { id },
      { revisionId: row.revisionId ?? null },
      { revisionId: row.revisionId ?? null },
    )
    if (!('dryRun' in lock) && !lock.matched)
      throw new KetError({ code: 'conflict', message: 'A combo item changed; reload before saving.' })
  }
  for (const item of items) {
    const product = products.find((row) => row.id === item.productId)
    const template = templates.find((row) => row.id === product?.templateId)
    if (
      !product ||
      !template ||
      template.type === 'combo' ||
      (!held.has(item.productId) &&
        (product.active === false || template.active === false || template.saleOk === false))
    )
      throw new ComboRefused('items', 'invalid')
  }
  return items
}

export function comboFailure(error: unknown) {
  if (error instanceof ComboRefused) return error.result
  let current = error
  for (let depth = 0; current && depth < 6; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (
      /combo_name_key_unique|UNIQUE constraint failed: product_combo\.(?:companyId, product_combo\.)?nameKey/i.test(
        message,
      )
    )
      return comboRefusal('name', 'duplicateName')
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return null
}
