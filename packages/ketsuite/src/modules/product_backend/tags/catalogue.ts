import { inArray, not } from '@ketvietlab/ketjs'
import type { Ctx, FilterRule } from '@ketvietlab/ketjs'
import { fold } from '../units.ts'

/** Scoped tag assignments are shared by product and SKU search; archived links remain searchable. */
export async function catalogueTags(ctx: Ctx) {
  const [tags, assignments] = await Promise.all([
    ctx.db.select('product.Tag'),
    ctx.db.select('product.TemplateTag'),
  ])
  const visible = new Set(tags.map((tag) => String(tag.id)))
  const links = assignments.filter((link) => visible.has(String(link.tagId)))
  const templates = (ids: readonly string[]) => {
    const selected = new Set(ids)
    return new Set(
      links.filter((link) => selected.has(String(link.tagId))).map((link) => String(link.templateId)),
    )
  }
  return {
    templates,
    choices: tags
      .map((tag) => ({ id: String(tag.id), name: String(tag.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id)),
    search: (query: string) =>
      query.trim()
        ? templates(
            tags
              .filter((tag) => fold(String(tag.name)).includes(fold(query.trim())))
              .map((tag) => String(tag.id)),
          )
        : new Set<string>(),
    filter: (column: Parameters<typeof inArray>[0], rule: FilterRule) => {
      if (rule.field !== 'tagId') return null
      const ids =
        rule.operator === 'isSet' || rule.operator === 'isNotSet'
          ? [...visible]
          : (Array.isArray(rule.value) ? rule.value : [rule.value]).map(String)
      const matched = inArray(column, [...templates(ids)])
      return rule.operator === 'notEquals' || rule.operator === 'isNotSet' ? not(matched) : matched
    },
  }
}
