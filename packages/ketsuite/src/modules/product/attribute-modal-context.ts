import { ATTRIBUTE_RECORD_MODAL_LABELS } from './attribute-modal-labels.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../user/authorization.ts'

export async function attributeModalContextHandler(ctx: Ctx, args: Row) {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  const can = (fn: string): boolean => allowed === null || allowed.includes(fn)
  const save = can('product.saveAttributeDraft')
  const creating = !args.id
  if (creating ? !save : !can('product.listAttributes')) return null
  const record = creating
    ? { id: '', name: '', displayType: 'select', createVariant: 'always', sequence: 10 }
    : (await ctx.db.select('product.Attribute', { id: args.id }))[0]
  if (!record) return null
  const values = creating ? [] : await ctx.db.select('product.AttributeValue', { attributeId: args.id })
  values.sort(
    (a, b) => Number(a.sequence ?? 10) - Number(b.sequence ?? 10) || String(a.id).localeCompare(String(b.id)),
  )
  const lang = args.locale === 'en' ? 'en' : 'vi'
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[lang] ?? {})
      .filter(([key]) => key.startsWith('product_backend.') || key.startsWith('product.'))
      .map(([key, message]) => [
        key,
        typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key),
      ]),
  )
  return {
    data: {
      record: {
        id: String(record.id),
        name: String(record.name ?? ''),
        displayType: String(record.displayType ?? 'select'),
        createVariant: String(record.createVariant ?? 'always'),
        sequence: Number(record.sequence ?? 10),
        active: record.active !== false,
        values: values.map((value) => ({
          id: String(value.id),
          name: String(value.name ?? ''),
          htmlColor: value.htmlColor == null ? null : String(value.htmlColor),
          defaultPriceExtra: String(value.defaultPriceExtra ?? '0'),
          sequence: Number(value.sequence ?? 10),
        })),
      },
      usageCount: creating
        ? 0
        : new Set(
            (await ctx.db.select('product.TemplateAttributeLine', { attributeId: args.id })).map(
              (line) => line.templateId,
            ),
          ).size,
      permissions: { save, archive: can('product.saveAttribute') },
      lang,
    },
    messages: { ...messages, ...ATTRIBUTE_RECORD_MODAL_LABELS[lang] },
  }
}

/** The attribute editor reads one record and its ordered values through the same permissions as its list. */
export const attributeModalContextFunctions: Record<string, FnSpec> = {
  attributeModalContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: [
      ...AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
      'read:product.Attribute',
      'read:product.AttributeValue',
      'read:product.TemplateAttributeLine',
    ],
    handler: attributeModalContextHandler,
  }),
}
