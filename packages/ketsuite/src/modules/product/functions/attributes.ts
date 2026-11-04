import { comboRefusal } from '../combo-policy.ts'
import { asc, defineFn, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { narrow } from './shared.ts'
import {
  assertVariantCanRetire,
  lockVariantTemplate,
  variantRetirementEffects,
} from '../variant-lifecycle.ts'
import {
  attributePolicyIssue,
  attributeRefusal,
  lockAttributes,
  attributeNameKey,
  attributePrice,
  attributeFailure,
} from '../attribute-policy.ts'

/** Shared with `templateModalContext`: a template's attribute lines, named and valued. */
export const attributeLinesOf = async (ctx: Ctx, templateId: unknown): Promise<Row[]> => {
  const lines = await ctx.db.select('product.TemplateAttributeLine', { templateId })
  if (!lines.length) return []
  const attributes = new Map((await ctx.db.select('product.Attribute')).map((row) => [String(row.id), row]))
  const values = new Map((await ctx.db.select('product.AttributeValue')).map((row) => [String(row.id), row]))
  const templateValues = await ctx.db.select('product.TemplateAttributeValue')
  const byLine = new Map<string, Row[]>()
  for (const templateValue of templateValues) {
    const value = values.get(String(templateValue.valueId))
    if (!value) continue
    const held = byLine.get(String(templateValue.lineId)) ?? []
    held.push({
      id: String(value.id),
      name: String(value.name),
      sequence: Number(value.sequence ?? 10),
      priceExtra: templateValue.priceExtra ?? '0',
    })
    byLine.set(String(templateValue.lineId), held)
  }
  return lines
    .map((line) => {
      const attribute = attributes.get(String(line.attributeId))
      return {
        id: String(line.id),
        templateId: String(line.templateId),
        attributeId: String(line.attributeId),
        attribute: attribute ? String(attribute.name) : null,
        sequence: Number(attribute?.sequence ?? 10),
        values: (byLine.get(String(line.id)) ?? []).sort(
          (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.name).localeCompare(String(b.name)),
        ),
      }
    })
    .sort(
      (a, b) => a.sequence - b.sequence || String(a.attribute ?? '').localeCompare(String(b.attribute ?? '')),
    )
}

export async function listAttributesHandler(ctx: Ctx, args: Record<string, unknown>) {
  const A = ctx.table('product.Attribute')
  const rows = await ctx.db.all(from(A).orderBy(asc(A.sequence), asc(A.name)).preload('values'))
  const lines = await ctx.db.select('product.TemplateAttributeLine')
  const withUsage: Row[] = rows.map((row) => ({
    ...row,
    usageCount: new Set(lines.filter((line) => line.attributeId === row.id).map((line) => line.templateId))
      .size,
  }))
  return narrow(
    args.variantsOnly === true
      ? withUsage.filter(
          (attribute) => attribute.createVariant !== 'no_variant' && attribute.active !== false,
        )
      : withUsage,
    args,
    ['name'],
  )
}

export async function listAttributeValuesHandler(ctx: Ctx, args: Record<string, unknown>) {
  const V = ctx.table('product.AttributeValue')
  const base = from(V).orderBy(asc(V.sequence), asc(V.name))
  const rows = await ctx.db.all(
    args.attributeId == null ? base : base.where(eq(V.attributeId, args.attributeId)),
  )
  return narrow(rows, args, ['name'])
}

export async function saveAttributeHandler(ctx: Ctx, args: Record<string, unknown>) {
  try {
    return await ctx.tx(async (tx) => {
      const existing = (await lockAttributes(tx, [args.id])).get(String(args.id))
      const values = {
        ...args,
        name: String(args.name ?? '').trim(),
        nameKey: attributeNameKey(args.name),
        sequence: args.sequence ?? existing?.sequence ?? 10,
        displayType: args.displayType ?? existing?.displayType ?? 'select',
        createVariant: args.createVariant ?? existing?.createVariant ?? 'always',
        active: args.active ?? existing?.active ?? true,
      }
      const issue = await attributePolicyIssue(tx, existing, values)
      if (issue) return issue
      const cs = tx
        .change('product.Attribute', values, existing ?? null)
        .cast(['id', 'name', 'nameKey', 'sequence', 'displayType', 'createVariant', 'active'])
        .required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await tx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    })
  } catch (error) {
    const refused = attributeFailure(error)
    if (refused) return refused
    throw error
  }
}

export async function saveAttributeValueHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    const initial = (await tx.db.select('product.AttributeValue', { id: args.id }))[0]
    await lockAttributes(tx, [args.attributeId, ...(initial ? [initial.attributeId] : [])])
    if (!(await tx.db.select('product.Attribute', { id: args.attributeId }))[0])
      return {
        ok: false,
        errors: [{ field: 'attributeId', message: 'không có thuộc tính nào mang id này' }],
      }
    const existing = (await tx.db.select('product.AttributeValue', { id: args.id }))[0]
    if (existing?.attributeId !== initial?.attributeId)
      return attributeRefusal('attributeId', 'valueAttributeInUse')
    if (
      existing &&
      existing.attributeId !== args.attributeId &&
      (await tx.db.select('product.TemplateAttributeValue', { valueId: args.id })).length
    )
      return attributeRefusal('attributeId', 'valueAttributeInUse')
    const defaultPriceExtra = attributePrice(args.defaultPriceExtra ?? existing?.defaultPriceExtra)
    if (defaultPriceExtra == null) return attributeRefusal('defaultPriceExtra', 'price')
    const values = { ...args, defaultPriceExtra, sequence: args.sequence ?? existing?.sequence ?? 10 }
    const cs = tx
      .change('product.AttributeValue', values, existing ?? null)
      .cast(['id', 'attributeId', 'name', 'sequence', 'defaultPriceExtra'])
      .required(['name', 'attributeId'])
    if (!cs.valid) return { ok: false, errors: cs.errors }
    await tx.db.commit(cs, existing ? { id: args.id } : undefined)
    return { ok: true, id: args.id }
  })
}

export async function listAttributeLinesHandler(ctx: Ctx, args: Record<string, unknown>) {
  return attributeLinesOf(ctx, args.templateId)
}

export async function removeAttributeLineHandler(ctx: Ctx, args: Record<string, unknown>) {
  const line = (await ctx.db.select('product.TemplateAttributeLine', { id: args.id }))[0]
  if (!line) return { ok: true }
  await ctx.tx(async (tx) => {
    const template = await lockVariantTemplate(tx, String(line.templateId))
    if (!template) return
    await lockAttributes(tx, [line.attributeId])
    await assertValueRemoval(tx, template, String(line.id), [])
    const TAV = tx.table('product.TemplateAttributeValue')
    const PV = tx.table('product.ProductValue')
    for (const value of await tx.db.select('product.TemplateAttributeValue', { lineId: args.id })) {
      await tx.db.del(deleteFrom(PV).where(eq(PV.templateAttributeValueId, value.id)))
      await tx.db.del(deleteFrom(TAV).where(eq(TAV.id, value.id)))
    }
    const TAL = tx.table('product.TemplateAttributeLine')
    await tx.db.del(deleteFrom(TAL).where(eq(TAL.id, args.id)))
  })
  return { ok: true, id: String(args.id) }
}

async function assertValueRemoval(ctx: Ctx, template: Row, lineId: string, retained: string[]) {
  const leaving = (await ctx.db.select('product.TemplateAttributeValue', { lineId })).filter(
    (row) => !retained.includes(String(row.valueId)),
  )
  if (!leaving.length) return
  const values = new Set(leaving.map((row) => String(row.valueId)))
  const rows = new Set(leaving.map((row) => String(row.id)))
  const linked = new Set(
    (await ctx.db.select('product.ProductValue'))
      .filter((row) => rows.has(String(row.templateAttributeValueId)))
      .map((row) => String(row.productId)),
  )
  for (const product of await ctx.db.select('product.Product', { templateId: template.id }))
    if (
      linked.has(String(product.id)) ||
      String(product.combinationKey)
        .split(',')
        .some((id) => values.has(id))
    )
      await assertVariantCanRetire(ctx, template, product)
}

export async function saveAttributeLineHandler(ctx: Ctx, args: Record<string, unknown>) {
  const valueIds = Array.isArray(args.valueIds) ? [...new Set(args.valueIds.map(String))] : []
  return ctx.tx(async (tx) => {
    const template = await lockVariantTemplate(tx, String(args.templateId))
    if (!template) return { ok: false, errors: [{ field: 'templateId', message: 'template không tồn tại' }] }
    if (template.type === 'combo') return comboRefusal('templateId', 'noVariants')
    const attribute = (await lockAttributes(tx, [args.attributeId])).get(String(args.attributeId))
    if (!attribute || attribute.active === false)
      return {
        ok: false,
        errors: [{ field: 'attributeId', message: 'thuộc tính không tồn tại hoặc đã lưu trữ' }],
      }
    for (const valueId of valueIds) {
      const value = (await tx.db.select('product.AttributeValue', { id: valueId }))[0]
      if (!value || value.attributeId !== args.attributeId)
        return {
          ok: false,
          errors: [{ field: 'valueIds', message: `${valueId} không thuộc thuộc tính đã chọn` }],
        }
    }
    await tx.db.insertIfAbsent('product.TemplateAttributeLine', {
      id: args.id,
      templateId: args.templateId,
      attributeId: args.attributeId,
    })
    // Company catalogue copies have opaque line IDs: preserve the row found by its natural key.
    const line = (
      await tx.db.select('product.TemplateAttributeLine', {
        templateId: args.templateId,
        attributeId: args.attributeId,
      })
    )[0]
    if (!line)
      return {
        ok: false,
        errors: [{ field: 'id', message: 'dòng thuộc tính đã thuộc template hoặc thuộc tính khác' }],
      }
    const lineId = String(line.id)
    await assertValueRemoval(tx, template, lineId, valueIds)
    for (const valueId of valueIds) {
      const value = (await tx.db.select('product.AttributeValue', { id: valueId }))[0]!
      await tx.db.insertIfAbsent('product.TemplateAttributeValue', {
        id: `${lineId}:${valueId}`,
        lineId,
        valueId,
        priceExtra: value.defaultPriceExtra ?? '0',
      })
    }
    const wanted = new Set(valueIds)
    const current = await tx.db.select('product.TemplateAttributeValue', { lineId })
    const TAV = tx.table('product.TemplateAttributeValue')
    const PV = tx.table('product.ProductValue')
    for (const value of current)
      if (!wanted.has(String(value.valueId))) {
        await tx.db.del(deleteFrom(PV).where(eq(PV.templateAttributeValueId, value.id)))
        await tx.db.del(deleteFrom(TAV).where(eq(TAV.id, value.id)))
      }
    return { ok: true, id: lineId }
  })
}

export const attributesFunctions: Record<string, FnSpec> = {
  listAttributes: defineFn({
    input: { search: 'text?', limit: 'int?', variantsOnly: 'bool?' },
    effects: ['read:product.Attribute', 'read:product.AttributeValue', 'read:product.TemplateAttributeLine'],
    agent: true,
    handler: listAttributesHandler,
  }),
  /**
   * Attribute values on their own, rather than nested inside their attribute.
   *
   * A picker asks for the values of one attribute and narrows them as the user
   * types; reaching them through `listAttributes` would mean shipping every
   * attribute's values to filter one attribute's worth in the browser.
   */
  listAttributeValues: defineFn({
    input: { attributeId: 'id?', search: 'text?', limit: 'int?' },
    output: {
      id: 'id',
      attributeId: 'id',
      name: 'text',
      sequence: 'int',
      htmlColor: 'text?',
      defaultPriceExtra: 'decimal?',
    },
    effects: ['read:product.AttributeValue'],
    agent: true,
    handler: listAttributeValuesHandler,
  }),
  saveAttribute: defineFn({
    input: {
      id: 'id',
      name: 'text',
      sequence: 'int?',
      displayType: 'text?',
      createVariant: 'text?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Attribute', 'write:product.Attribute', 'read:product.TemplateAttributeLine'],
    idempotent: true,
    agent: true,
    handler: saveAttributeHandler,
  }),
  saveAttributeValue: defineFn({
    input: { id: 'id', attributeId: 'id', name: 'text', sequence: 'int?', defaultPriceExtra: 'decimal?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Attribute',
      'read:product.AttributeValue',
      'write:product.AttributeValue',
      'write:product.Attribute',
      'read:product.TemplateAttributeValue',
    ],
    idempotent: true,
    agent: true,
    handler: saveAttributeValueHandler,
  }),
  /**
   * The attribute lines of a template, each with the values it allows.
   *
   * `getTemplate` preloads the lines but not what is on them, and a line without
   * its values says nothing a reader can act on — "Màu sắc" is not an answer to
   * "which colours does this product come in".
   */
  listAttributeLines: defineFn({
    input: { templateId: 'id' },
    output: { id: 'id', templateId: 'id', attributeId: 'id', attribute: 'text?', values: 'json?' },
    effects: [
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.AttributeValue',
      'read:product.Attribute',
    ],
    agent: true,
    handler: listAttributeLinesHandler,
  }),
  /**
   * Take an attribute off a template, with the values it carried.
   *
   * Variants already generated from it are left alone: they are real records
   * that may be on documents. Regenerating is what prunes them, and that is a
   * decision the reader makes rather than a side effect of this one.
   */
  removeAttributeLine: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?' },
    effects: [
      ...variantRetirementEffects,
      'read:product.Template',
      'write:product.Template',
      'read:product.Attribute',
      'write:product.Attribute',
      'read:product.AttributeValue',
      'read:product.Product',
      'read:product.ProductValue',
      'write:product.ProductValue',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
    ],
    idempotent: true,
    agent: true,
    handler: removeAttributeLineHandler,
  }),
  saveAttributeLine: defineFn({
    input: { id: 'id', templateId: 'id', attributeId: 'id', valueIds: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...variantRetirementEffects,
      'write:product.Template',
      'read:product.Product',
      'read:product.ProductValue',
      'write:product.ProductValue',
      'read:product.Template',
      'read:product.Attribute',
      'write:product.Attribute',
      'read:product.AttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
    ],
    idempotent: true,
    agent: true,
    handler: saveAttributeLineHandler,
  }),
}
