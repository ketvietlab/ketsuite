// "Configure attributes" on the product page, as one form action.
//
// The dialog lists the product's attribute lines; a row is an existing attribute or one
// named in the dialog, and each row may add values in place. Applying writes the new
// attributes and values, the lines and the variants they make in one transaction, or
// nothing at all, and returns the ids it created. A combination that already exists keeps
// its variant (id, codes, stock). An attribute added to a product extends the
// variants it already has with the attribute's first value; the other combinations are
// new variants, and a variant whose combination left the setup is archived, never deleted.

import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { applyVariantSetup, variantSetupOf } from './variant-setup.ts'

type Issue = { field: string; code: string; params?: Record<string, unknown> }

type ValueInput = { valueId: string | null; name: string; priceExtra: string }
type LineInput = { attributeId: string | null; name: string; values: ValueInput[] }
type PlannedValue = { valueId: string | null; name: string; priceExtra: string; position: number }

/** Most attribute lines one product may carry, and most variants one apply may make. */
export const ATTRIBUTE_LINE_LIMIT = 10
export const COMBINATION_LIMIT = 256
const NAME_LIMIT = 60

class Refused extends Error {
  readonly errors: Issue[]
  constructor(errors: Issue[]) {
    super('refused')
    this.errors = errors
  }
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const nameKey = (value: string): string => value.normalize('NFC').toLocaleLowerCase('vi')
const signedAmount = (value: unknown): string | null => {
  const raw = String(value ?? '').trim()
  if (raw === '') return '0'
  return /^-?\d+(\.\d+)?$/.test(raw) ? raw : null
}

const readLines = (raw: unknown): LineInput[] | null => {
  if (!Array.isArray(raw) || raw.length > ATTRIBUTE_LINE_LIMIT) return null
  const lines: LineInput[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const line = entry as Record<string, unknown>
    if (!Array.isArray(line.values) || line.values.length > 100) return null
    const values: ValueInput[] = []
    for (const item of line.values) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const value = item as Record<string, unknown>
      values.push({
        valueId: clean(value.valueId) || null,
        name: clean(value.name),
        priceExtra: String(value.priceExtra ?? '').trim(),
      })
    }
    lines.push({ attributeId: clean(line.attributeId) || null, name: clean(line.name), values })
  }
  return lines
}

/** Plan the dialog's rows against the catalogue: what to create, and every line's values. */
const planLines = (lines: LineInput[], attributes: Row[], values: Row[]) => {
  const errors: Issue[] = []
  const seen = new Set<string>()
  const newNames = new Map<string, number>()
  const plan = lines.map((line, index) => {
    const field = `lines.${index}`
    const attribute = line.attributeId ? attributes.find((row) => String(row.id) === line.attributeId) : null
    if (line.attributeId && !attribute)
      errors.push({ field: `${field}.attributeId`, code: 'product.error.configure.attributeGone' })
    if (line.attributeId && seen.has(line.attributeId))
      errors.push({ field: `${field}.attributeId`, code: 'product.error.configure.lines' })
    if (line.attributeId) seen.add(line.attributeId)
    const name = attribute ? String(attribute.name) : line.name
    if (!line.attributeId) {
      if (!name || name.length > NAME_LIMIT)
        errors.push({ field: `${field}.name`, code: 'product.error.configure.attributeName' })
      else {
        const taken = attributes.find((row) => nameKey(String(row.name)) === nameKey(name))
        const repeated = newNames.get(nameKey(name))
        if (taken || repeated !== undefined)
          errors.push({
            field: `${field}.name`,
            code: 'product.error.configure.attributeExists',
            params: { name: taken ? String(taken.name) : name },
          })
        newNames.set(nameKey(name), index)
      }
    }
    const own = attribute ? values.filter((row) => String(row.attributeId) === String(attribute.id)) : []
    const known = new Set(own.map((row) => nameKey(String(row.name))))
    const chosen = new Set<string>()
    const planned = line.values.flatMap((value, position): PlannedValue[] => {
      const at = `${field}.values.${position}`
      const priceExtra = signedAmount(value.priceExtra)
      if (priceExtra === null)
        errors.push({ field: `${at}.priceExtra`, code: 'product.error.configure.extra' })
      if (value.valueId) {
        // An existing value must belong to this row's attribute; ticking it twice is one value.
        if (!own.some((row) => String(row.id) === value.valueId)) {
          errors.push({ field: at, code: 'product.error.configure.lines' })
          return []
        }
        if (chosen.has(value.valueId)) return []
        chosen.add(value.valueId)
        return [{ valueId: value.valueId, name: '', priceExtra: priceExtra ?? '0', position }]
      }
      if (!value.name) return []
      if (value.name.length > NAME_LIMIT)
        errors.push({ field: `${at}.name`, code: 'product.error.configure.valueName' })
      else if (known.has(nameKey(value.name)))
        errors.push({
          field: `${at}.name`,
          code: 'product.error.configure.valueExists',
          params: { name: value.name },
        })
      known.add(nameKey(value.name))
      return [{ valueId: null, name: value.name, priceExtra: priceExtra ?? '0', position }]
    })
    if (!planned.length)
      errors.push({ field: `${field}.values`, code: 'product.error.configure.noValue', params: { name } })
    return { index, attribute: attribute ?? null, name, own, values: planned }
  })
  return { plan, errors }
}

export const configureAttributesFunctions: Record<string, FnSpec> = {
  /**
   * Apply the attribute rows of the product page's "Configure attributes" dialog.
   *
   * `lines` is ordered as the dialog shows it: `{ attributeId, name, values }` where an
   * existing attribute names its id and a new one only its name; a value is an existing
   * `valueId` or a new `name`, each with a signed `priceExtra`. Field refusals name input
   * paths (`lines.0.values.2.name`); the page maps them back to its controls.
   */
  configureAttributes: defineFn({
    input: { templateId: 'id', lines: 'json' },
    output: {
      ok: 'bool',
      created: 'json?',
      variants: 'int?',
      createdVariants: 'int?',
      archivedVariants: 'int?',
      errors: 'json?',
    },
    effects: [
      'read:product.Template',
      'read:product.Attribute',
      'write:product.Attribute',
      'read:product.AttributeValue',
      'write:product.AttributeValue',
      'read:product.TemplateAttributeLine',
      'write:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'write:product.TemplateAttributeValue',
      'read:product.Product',
      'write:product.Product',
      'read:product.ProductValue',
      'write:product.ProductValue',
      'read:product_media.Media',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const templateId = String(args.templateId)
      const lines = readLines(args.lines)
      if (!lines) return { ok: false, errors: [{ field: 'lines', code: 'product.error.configure.lines' }] }
      try {
        return await ctx.tx(async (tx) => configure(tx, templateId, lines))
      } catch (error) {
        if (error instanceof Refused) return { ok: false, errors: error.errors }
        throw error
      }
    },
  }),
}

const configure = async (tx: Ctx, templateId: string, lines: LineInput[]) => {
  const setup = await variantSetupOf(tx, templateId)
  if (!setup) return { ok: false, errors: [{ field: 'templateId', code: 'product.error.duplicate.missing' }] }
  const [attributes, values] = await Promise.all([
    tx.db.select('product.Attribute'),
    tx.db.select('product.AttributeValue'),
  ])
  // Attributes that only describe the product (no variant) are not in the dialog; their lines stay.
  const describing = setup.lines.filter((line) => line.createVariant === 'no_variant')
  const { plan, errors } = planLines(
    lines,
    attributes.filter((row) => row.createVariant !== 'no_variant'),
    values,
  )
  if (errors.length) return { ok: false, errors }
  const combinations = plan.reduce((total, line) => total * line.values.length, 1)
  if (plan.length && combinations > COMBINATION_LIMIT)
    return {
      ok: false,
      errors: [{ field: 'lines', code: 'product.error.configure.tooMany', params: { count: combinations } }],
    }

  // Write the new attributes and values; every row now has ids.
  const created: { attributes: Record<string, string>; values: Record<string, string> } = {
    attributes: {},
    values: {},
  }
  const resolved: Array<{ attributeId: string; values: Array<{ valueId: string; priceExtra: string }> }> = []
  for (const line of plan) {
    let attributeId = line.attribute ? String(line.attribute.id) : ''
    if (!line.attribute) {
      attributeId = randomUUID()
      await tx.db.insert('product.Attribute', {
        id: attributeId,
        name: line.name,
        displayType: 'select',
        createVariant: 'always',
        sequence: 10,
        active: true,
      })
      created.attributes[String(line.index)] = attributeId
    }
    let sequence = Math.max(0, ...line.own.map((row) => Number(row.sequence ?? 0)))
    const rowValues: Array<{ valueId: string; priceExtra: string }> = []
    for (const value of line.values) {
      let valueId = value.valueId
      if (!valueId) {
        valueId = randomUUID()
        sequence += 1
        await tx.db.insert('product.AttributeValue', {
          id: valueId,
          attributeId,
          name: value.name,
          sequence,
          htmlColor: null,
        })
        created.values[`${line.index}.${value.position}`] = valueId
      }
      rowValues.push({ valueId, priceExtra: value.priceExtra })
    }
    resolved.push({ attributeId, values: rowValues })
  }

  // Derive the variants: an existing combination keeps its row; a row of the previous
  // setup carries over when every added attribute takes its first value. The product's
  // own variant (no combination) is not one of them: it rests while variants sell and
  // comes back if every attribute is removed (`applyVariantSetup`).
  const key = (valueIds: Record<string, string>) =>
    JSON.stringify(Object.entries(valueIds).sort(([a], [b]) => a.localeCompare(b)))
  const before = new Set(
    setup.lines.filter((line) => line.createVariant !== 'no_variant').map((line) => line.attributeId),
  )
  const kept = new Map(setup.variants.map((variant) => [key(variant.valueIds), variant]))
  const added = resolved.filter((line) => !before.has(line.attributeId))
  const extended = (valueIds: Record<string, string>) =>
    before.size && added.every((line) => valueIds[line.attributeId] === line.values[0]?.valueId)
      ? kept.get(
          key(
            Object.fromEntries(Object.entries(valueIds).filter(([attributeId]) => before.has(attributeId))),
          ),
        )
      : undefined
  const combos = resolved.length
    ? resolved.reduce<Array<Record<string, string>>>(
        (rows, line) =>
          rows.flatMap((row) => line.values.map((value) => ({ ...row, [line.attributeId]: value.valueId }))),
        [{}],
      )
    : []
  // A variant someone stopped selling stays stopped while its combination was possible all
  // along; one archived because its value had left the product sells again when it returns.
  const offered = new Set(setup.lines.flatMap((line) => line.values.map((value) => value.valueId)))
  const wasPossible = (valueIds: Record<string, string>) =>
    Object.keys(valueIds).length > 0 && Object.values(valueIds).every((valueId) => offered.has(valueId))
  const taken = new Set<string>()
  const variants = combos.map((valueIds) => {
    const variant = kept.get(key(valueIds)) ?? extended(valueIds)
    if (variant && !taken.has(variant.id)) {
      taken.add(variant.id)
      return { ...variant, valueIds, active: variant.active || !wasPossible(variant.valueIds) }
    }
    return { id: null, valueIds, defaultCode: null, barcode: null, weight: '0', volume: '0', active: true }
  })
  const setupLines = [
    ...resolved,
    ...describing.map((line) => ({
      attributeId: line.attributeId,
      values: line.values.map((value) => ({ valueId: value.valueId, priceExtra: value.priceExtra })),
    })),
  ]
  const applied = await applyVariantSetup(tx, templateId, setupLines, variants)
  // Refused after the new attributes were written: roll them back with the rest.
  if (!applied.ok)
    throw new Refused(
      // A refusal that names its own message key is worded by it; free text is quoted.
      applied.errors.map((issue) =>
        issue.message
          ? { field: 'lines', code: 'product.error.configure.variants', params: { message: issue.message } }
          : { field: 'lines', code: issue.code, params: issue.params },
      ),
    )
  return {
    ok: true,
    created,
    variants: variants.length,
    createdVariants: applied.created,
    archivedVariants: applied.archived,
  }
}
