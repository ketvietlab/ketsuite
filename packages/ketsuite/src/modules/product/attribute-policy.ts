import type { Ctx, Row } from '@ketvietlab/ketjs'
import { KetError } from '@ketvietlab/ketjs'

/** Lock definitions before either editing their policy or attaching product values. */
export async function lockAttributes(ctx: Ctx, ids: unknown[]) {
  const records = new Map<string, Row>()
  for (const id of [...new Set(ids.map(String))].sort()) {
    const current = (await ctx.db.select('product.Attribute', { id }))[0]
    if (!current) continue
    const result = await ctx.db.compareAndSet(
      'product.Attribute',
      { id },
      {
        name: current.name,
        createVariant: current.createVariant,
        displayType: current.displayType,
        active: current.active,
        sequence: current.sequence,
      },
      { createVariant: current.createVariant },
    )
    if (!('dryRun' in result) && !result.matched)
      throw new KetError({ code: 'conflict', message: 'The attribute changed; reload before editing.' })
    records.set(id, current)
  }
  return records
}

export const attributeNameKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .normalize('NFC')
    .toLowerCase()
export const attributeRefusal = (field: string, reason: string) => ({
  ok: false as const,
  errors: [{ field, code: `product.error.attribute.${reason}` }],
})

export const attributePrice = (value: unknown) => {
  const text = String(value ?? '').trim() || '0'
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null
}

export function attributeFailure(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 6; depth += 1) {
    const message = current instanceof Error ? current.message : String(current)
    if (/unique.*product_attribute.*name_?key|duplicate.*product_attribute.*name_?key/i.test(message))
      return attributeRefusal('name', 'duplicateName')
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return null
}

/** All attribute writers preserve the meaning of values already attached to products. */
export async function attributePolicyIssue(ctx: Ctx, current: Row | undefined, next: Row) {
  if (!String(next.name ?? '').trim()) return attributeRefusal('name', 'required')
  if (!['radio', 'pills', 'select', 'color', 'multi'].includes(String(next.displayType)))
    return attributeRefusal('displayType', 'displayType')
  if (!['always', 'no_variant'].includes(String(next.createVariant)))
    return attributeRefusal('createVariant', 'createVariant')
  if (next.displayType === 'multi' && next.createVariant !== 'no_variant')
    return attributeRefusal('createVariant', 'multiPolicy')
  const attributes = await ctx.db.select('product.Attribute')
  if (
    attributes.some((row) => row.id !== next.id && attributeNameKey(row.name) === attributeNameKey(next.name))
  )
    return attributeRefusal('name', 'duplicateName')
  if (current && (next.createVariant !== current.createVariant || next.active === false)) {
    const used = await ctx.db.select('product.TemplateAttributeLine', { attributeId: current.id })
    if (used.length)
      return attributeRefusal(
        next.active === false ? 'active' : 'createVariant',
        next.active === false ? 'archiveInUse' : 'policyInUse',
      )
  }
  return null
}
