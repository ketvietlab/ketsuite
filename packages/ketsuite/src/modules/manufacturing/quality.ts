import { and, defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

/**
 * Quality templates (#1947): what a finished product's lots are checked for. A template is a set
 * of criteria, each a reading within a range or a pass/fail, and a lot passes only when every
 * required criterion passes. A product without an active template keeps the default check its BOM
 * has carried since P11, pH within the BOM's range and a sensory pass, so the checks already
 * recorded read as they did.
 */

const clean = (value: unknown): string => String(value ?? '').trim()
const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('manufacturing requires an active company')
  return ctx.scope.company
}
const ours = async (ctx: Ctx, model: string, where: Row = {}): Promise<Row[]> =>
  ctx.db.select(model, { ...where, companyId: company(ctx) })
type Issue = { field: string; code: string; params?: Row }
const invalid = (...errors: Issue[]) => ({ ok: false, errors })

export const QUALITY_KINDS = ['range', 'passFail'] as const

/** One criterion a lot is checked for; `id` is `ph` or `sensory` for the default check. */
export type QualityCriterionRow = {
  id: string
  name: string
  kind: (typeof QUALITY_KINDS)[number]
  min: string | null
  max: string | null
  unit: string | null
  required: boolean
}

/** A typed reading as a number: a decimal comma reads as a point. */
export const reading = (value: unknown): number | null => {
  const typed = clean(value).replace(',', '.')
  if (!typed) return null
  const number = Number(typed)
  return Number.isFinite(number) ? number : Number.NaN
}

/** The active template a product's lots are checked against, if it has one. */
export async function templateForProduct(ctx: Ctx, productId: unknown): Promise<Row | undefined> {
  if (productId == null) return undefined
  return (await ours(ctx, 'manufacturing.QualityTemplate', { productId })).find((row) => row.active !== false)
}

export async function templateCriteria(ctx: Ctx, templateId: unknown): Promise<QualityCriterionRow[]> {
  return (await ours(ctx, 'manufacturing.QualityCriterion', { templateId }))
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: row.kind === 'passFail' ? 'passFail' : 'range',
      min: row.min == null ? null : String(row.min),
      max: row.max == null ? null : String(row.max),
      unit: row.unit == null ? null : String(row.unit),
      required: row.required !== false,
    }))
}

/** The default check: pH within the BOM's range and a sensory pass, both required. */
export const defaultCriteria = (bom: Row | undefined): QualityCriterionRow[] => [
  {
    id: 'ph',
    name: 'pH',
    kind: 'range',
    min: bom?.phMin == null ? null : String(bom.phMin),
    max: bom?.phMax == null ? null : String(bom.phMax),
    unit: null,
    required: true,
  },
  { id: 'sensory', name: 'sensory', kind: 'passFail', min: null, max: null, unit: null, required: true },
]

/** What a check is checked for: its template's criteria, or the default ones of its order's BOM. */
export async function criteriaOfCheck(ctx: Ctx, check: Row, bom: Row | undefined) {
  return check.templateId ? templateCriteria(ctx, check.templateId) : defaultCriteria(bom)
}

/** Whether one reading passes its criterion; a range with neither bound passes nothing. */
export const passes = (criterion: QualityCriterionRow, value: string): boolean => {
  if (criterion.kind === 'passFail') return value === 'pass'
  const number = reading(value)
  if (number == null || Number.isNaN(number)) return false
  if (criterion.min == null && criterion.max == null) return false
  return (
    (criterion.min == null || number >= Number(criterion.min) - 1e-9) &&
    (criterion.max == null || number <= Number(criterion.max) + 1e-9)
  )
}

/**
 * Readings checked against their criteria. Every required criterion needs a reading, a range a
 * number and a pass/fail `pass` or `fail`; a blank optional one is left out. The default pH also
 * stays within 0–14.
 */
export function evaluate(criteria: QualityCriterionRow[], posted: Map<string, string>, isDefault: boolean) {
  const errors: Issue[] = []
  const rows: Array<QualityCriterionRow & { value: string | null; passed: boolean | null }> = []
  for (const criterion of criteria) {
    const value = clean(posted.get(criterion.id))
    const label = { criterion: criterion.name }
    if (!value) {
      if (criterion.required)
        errors.push(
          isDefault && criterion.id === 'ph'
            ? { field: 'ph', code: 'manufacturing.error.phReading' }
            : isDefault
              ? { field: 'sensory', code: 'manufacturing.error.invalid' }
              : { field: 'results', code: 'manufacturing.error.qualityMissing', params: label },
        )
      rows.push({ ...criterion, value: null, passed: null })
      continue
    }
    if (criterion.kind === 'passFail' && !['pass', 'fail'].includes(value)) {
      errors.push(
        isDefault
          ? { field: 'sensory', code: 'manufacturing.error.invalid' }
          : { field: 'results', code: 'manufacturing.error.qualityValue', params: label },
      )
      continue
    }
    if (criterion.kind === 'range') {
      const number = reading(value)
      if (
        number == null ||
        Number.isNaN(number) ||
        (isDefault && criterion.id === 'ph' && (number < 0 || number > 14))
      ) {
        errors.push(
          isDefault && criterion.id === 'ph'
            ? { field: 'ph', code: 'manufacturing.error.phReading' }
            : { field: 'results', code: 'manufacturing.error.qualityValue', params: label },
        )
        continue
      }
    }
    const kept = criterion.kind === 'range' ? String(reading(value)) : value
    rows.push({ ...criterion, value: kept, passed: passes(criterion, kept) })
  }
  const passed = rows.length > 0 && rows.filter((row) => row.required).every((row) => row.passed === true)
  return { errors, rows, passed }
}

const templateRead = async (ctx: Ctx, row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  productId: row.productId == null ? null : String(row.productId),
  active: row.active !== false,
  version: Number(row.version),
  criteria: await templateCriteria(ctx, row.id),
})

const TEMPLATE_READS = ['read:manufacturing.QualityTemplate', 'read:manufacturing.QualityCriterion']

export const qualityTemplateFunctions: Record<string, FnSpec> = {
  listQualityTemplates: defineFn({
    input: { includeArchived: 'bool?' },
    effects: TEMPLATE_READS,
    agent: true,
    handler: async (ctx, args) => {
      const rows = (await ours(ctx, 'manufacturing.QualityTemplate'))
        .filter((row) => args.includeArchived === true || row.active !== false)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))
      return Promise.all(rows.map((row) => templateRead(ctx, row)))
    },
  }),

  getQualityTemplate: defineFn({
    input: { id: 'id' },
    effects: TEMPLATE_READS,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.QualityTemplate', { id: args.id }))[0]
      return row ? templateRead(ctx, row) : null
    },
  }),

  /**
   * Saves a template whole: its name, the product whose lots it checks, whether it is in use and its
   * criteria in order. A product has one active template. Checks already made keep the criteria
   * they were checked against; a check still pending reads the template as it is now.
   */
  saveQualityTemplate: defineFn({
    input: {
      id: 'id',
      name: 'text',
      productId: 'id?',
      active: 'bool?',
      version: 'int?',
      criteria: 'json',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      ...TEMPLATE_READS,
      'write:manufacturing.QualityTemplate',
      'write:manufacturing.QualityCriterion',
      'read:product.Product',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const id = clean(args.id)
      const name = clean(args.name)
      const productId = clean(args.productId) || null
      const active = args.active !== false
      const posted = Array.isArray(args.criteria) ? (args.criteria as Row[]) : null
      const errors: Issue[] = []
      if (!id) errors.push({ field: 'id', code: 'manufacturing.error.required' })
      if (!name) errors.push({ field: 'name', code: 'manufacturing.error.required' })
      if (productId && !(await ctx.db.select('product.Product', { id: productId }))[0])
        errors.push({ field: 'productId', code: 'manufacturing.error.invalid' })
      if (!posted || !posted.length || posted.length > 50)
        errors.push({ field: 'criteria', code: 'manufacturing.error.qualityCriteria' })
      const criteria: QualityCriterionRow[] = []
      for (const [index, entry] of (posted ?? []).entries()) {
        const at = { row: String(index + 1) }
        const kind = clean(entry?.kind)
        const min = reading(entry?.min)
        const max = reading(entry?.max)
        if (!clean(entry?.name))
          errors.push({ field: 'criteria', code: 'manufacturing.error.criterionName', params: at })
        else if (!(QUALITY_KINDS as readonly string[]).includes(kind))
          errors.push({ field: 'criteria', code: 'manufacturing.error.criterionKind', params: at })
        else if (
          kind === 'range' &&
          (Number.isNaN(min) ||
            Number.isNaN(max) ||
            (min == null && max == null) ||
            (min != null && max != null && min > max))
        )
          errors.push({ field: 'criteria', code: 'manufacturing.error.criterionRange', params: at })
        else
          criteria.push({
            id: `${id}:criterion:${index + 1}`,
            name: clean(entry.name),
            kind: kind as QualityCriterionRow['kind'],
            min: kind === 'range' && min != null ? String(min) : null,
            max: kind === 'range' && max != null ? String(max) : null,
            unit: kind === 'range' ? clean(entry.unit) || null : null,
            required: entry.required !== false && entry.required !== 'false',
          })
      }
      const existing = id ? (await ours(ctx, 'manufacturing.QualityTemplate', { id }))[0] : undefined
      if (existing && Number(existing.version) !== Number(args.version))
        errors.push({ field: 'version', code: 'manufacturing.error.version' })
      if (
        active &&
        productId &&
        (await ours(ctx, 'manufacturing.QualityTemplate', { productId })).some(
          (row) => row.id !== id && row.active !== false,
        )
      )
        errors.push({ field: 'productId', code: 'manufacturing.error.qualityTemplateProduct' })
      if (errors.length) return invalid(...errors)
      const version = existing ? Number(existing.version) + 1 : 1
      const saved = await ctx.tx(async (tx) => {
        const values = { name, productId, active, version }
        if (existing) {
          const changed = await tx.db.compareAndSet(
            'manufacturing.QualityTemplate',
            { id },
            { version: Number(args.version) },
            values,
          )
          if (!changed) return false
        } else await tx.db.insert('manufacturing.QualityTemplate', { id, ...values })
        const C = tx.table('manufacturing.QualityCriterion')
        await tx.db.del(deleteFrom(C).where(and(eq(C.templateId, id), eq(C.companyId, company(tx)))))
        for (const [index, { id: criterionId, ...criterion }] of criteria.entries())
          await tx.db.insert('manufacturing.QualityCriterion', {
            id: criterionId,
            templateId: id,
            sequence: index + 1,
            ...criterion,
          })
        return true
      })
      if (!saved) return invalid({ field: 'version', code: 'manufacturing.error.version' })
      return { ok: true, id, version }
    },
  }),
}
