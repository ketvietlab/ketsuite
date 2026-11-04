import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { ComboRefused, lockCombos } from './combo-policy.ts'

export const TEMPLATE_COMBO_EFFECTS = [
  'read:product.Combo',
  'write:product.Combo',
  'read:product.TemplateCombo',
  'write:product.TemplateCombo',
]

export function comboIdsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim()))
    throw new ComboRefused('comboIds', 'choicesInvalid')
  const ids = value.map((id) => String(id).trim())
  if (ids.length < 1 || ids.length > 10) throw new ComboRefused('comboIds', 'choicesCount')
  if (new Set(ids).size !== ids.length) throw new ComboRefused('comboIds', 'choicesInvalid')
  return ids
}

export async function templateComboIds(ctx: Ctx, templateId: unknown): Promise<string[]> {
  return (await ctx.db.select('product.TemplateCombo', { templateId }))
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
    .map((row) => String(row.comboId))
}

/** Combo locks precede tag, category and template locks in every assignment/lifecycle path. */
export async function validateTemplateCombos(
  ctx: Ctx,
  templateId: unknown,
  value: unknown,
  allowHeldArchived = false,
) {
  const ids = comboIdsOf(value)
  const held = await templateComboIds(ctx, templateId)
  const rows = await lockCombos(ctx, [...new Set([...held, ...ids])].sort())
  if (
    ids.some(
      (id) =>
        !rows.some(
          (row) => row.id === id && (row.active !== false || (allowHeldArchived && held.includes(id))),
        ),
    )
  )
    throw new ComboRefused('comboIds', 'choicesInvalid')
  return ids
}

export async function writeTemplateCombos(ctx: Ctx, templateId: unknown, ids: readonly string[]) {
  const Link = ctx.table('product.TemplateCombo')
  await ctx.db.del(deleteFrom(Link).where(eq(Link.templateId, templateId)))
  for (const [sequence, comboId] of ids.entries())
    await ctx.db.insert('product.TemplateCombo', {
      id: JSON.stringify([String(ctx.scope.company ?? ''), String(templateId), comboId]),
      templateId,
      comboId,
      sequence,
    })
}
