import { KetError, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
export const MAX_PRODUCT_TAGS = 10
export const tagRefusal = (field: string, reason: string) => ({
  ok: false as const,
  errors: [{ field, code: `product.error.tag.${reason}` }],
})
export class TagPolicyRefused extends Error {
  readonly result: ReturnType<typeof tagRefusal>
  constructor(field: string, reason: string) {
    super(reason)
    this.result = tagRefusal(field, reason)
  }
}
export const tagNameKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('vi')
export const tagIdsOf = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim()))
    throw new TagPolicyRefused('tagIds', 'invalid')
  const ids = [...new Set(value.map((id) => String(id).trim()))]
  if (ids.length > MAX_PRODUCT_TAGS) throw new TagPolicyRefused('tagIds', 'tooMany')
  return ids
}
export async function templateTagIds(ctx: Ctx, templateId: unknown): Promise<string[]> {
  return (await ctx.db.select('product.TemplateTag', { templateId }))
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
    .map((row) => String(row.tagId))
}
/** Assignment and archival share row locks. Historical attached tags may remain archived. */
export async function lockTags(ctx: Ctx, ids: readonly string[]): Promise<Row[]> {
  if (!ids.length) return []
  const Tag = ctx.table('product.Tag')
  const rows = (await ctx.db.all(from(Tag).where(inArray(Tag.id, [...ids])))).sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  )
  for (const row of rows) {
    const held = await ctx.db.compareAndSet(
      'product.Tag',
      { id: row.id },
      { revisionId: row.revisionId, active: row.active },
      { revisionId: row.revisionId },
    )
    if (!('dryRun' in held) && !held.matched)
      throw new KetError({ code: 'conflict', message: 'The tag changed; reload before saving.' })
  }
  return rows
}
export async function validateTemplateTags(ctx: Ctx, templateId: unknown, value: unknown) {
  const ids = tagIdsOf(value),
    held = new Set(await templateTagIds(ctx, templateId))
  const rows = await lockTags(ctx, ids)
  if (ids.some((id) => !rows.some((row) => row.id === id && (row.active !== false || held.has(id)))))
    throw new TagPolicyRefused('tagIds', 'invalid')
  return ids
}
/** Caller has validated/locked the choices and owns the product transaction. */
export async function writeTemplateTags(ctx: Ctx, templateId: unknown, ids: readonly string[]) {
  const Assignment = ctx.table('product.TemplateTag')
  await ctx.db.del(deleteFrom(Assignment).where(eq(Assignment.templateId, templateId)))
  for (const [sequence, tagId] of ids.entries())
    await ctx.db.insert('product.TemplateTag', {
      id: JSON.stringify([String(ctx.scope.company ?? ''), String(templateId), tagId]),
      templateId,
      tagId,
      sequence,
    })
}
export function tagFailure(error: unknown) {
  if (error instanceof TagPolicyRefused) return error.result
  let current = error
  for (let depth = 0; current && depth < 6; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (
      /tag_name_key_unique|UNIQUE constraint failed: product_tag\.(?:companyId, product_tag\.)?nameKey/i.test(
        message,
      )
    )
      return tagRefusal('name', 'duplicateName')
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return null
}
