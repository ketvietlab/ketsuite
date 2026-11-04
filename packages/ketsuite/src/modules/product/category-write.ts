import type { Ctx, Row } from '@ketvietlab/ketjs'
import { categoryNameKey, categoryRefusal, lockCategories } from './category-policy.ts'

/** One caller-owned transaction for category identity, reusable by the record command. */
export async function writeCategory(tx: Ctx, args: Row) {
  await lockCategories(tx)
  const rows = await tx.db.select('product.Category')
  const existing = rows.find((row) => row.id === args.id)
  if (existing?.active === false) return categoryRefusal('id', 'inactive')
  const name = String(args.name ?? '')
    .trim()
    .normalize('NFC')
  const parentId = Object.hasOwn(args, 'parentId') ? args.parentId || null : (existing?.parentId ?? null)
  if (!name) return categoryRefusal('name', 'required')
  if ([...name].length > 40) return categoryRefusal('name', 'nameLong')
  if (name.includes('/')) return categoryRefusal('name', 'nameSlash')
  const seen = new Set([String(args.id)])
  let cursor: string | null = parentId == null ? null : String(parentId)
  while (cursor) {
    if (seen.has(String(cursor))) return categoryRefusal('parentId', 'parentInvalid')
    seen.add(String(cursor))
    const parent = rows.find((row) => row.id === cursor)
    if (!parent || parent.active === false) return categoryRefusal('parentId', 'parentInvalid')
    cursor = parent.parentId == null ? null : String(parent.parentId)
  }
  const nameKey = categoryNameKey(parentId, name)
  if (rows.some((row) => row.id !== args.id && categoryNameKey(row.parentId, row.name) === nameKey))
    return categoryRefusal('name', 'duplicateName')
  const cs = tx
    .change('product.Category', { id: args.id, name, parentId, nameKey, active: true }, existing ?? null)
    .cast(['id', 'name', 'parentId', 'nameKey', 'active'])
    .required(['name'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await tx.db.commit(cs, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}
