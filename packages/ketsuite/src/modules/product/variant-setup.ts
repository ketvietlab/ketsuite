import { comboRefusal } from './combo-policy.ts'
import { VARIANT_LIMIT, variantLimitRefusal, VariantPolicyRefused } from './variant-policy.ts'
import { lockAttributes } from './attribute-policy.ts'
import {
  assertVariantCanRetire,
  deleteUnusedVariant,
  lockVariantTemplate,
  nextVariantCode,
  variantRetirementEffects,
} from './variant-lifecycle.ts'
import {
  BARCODE_EFFECTS,
  barcodeFailure,
  barcodeOwnerKey,
  barcodeKey,
  claimBarcode,
  releaseBarcodeClaims,
} from './barcodes.ts'
// A template's attributes and variants, read and saved as one editable setup.
//
// The record modal's "Attributes & variants" tab edits both halves together — the
// attribute lines with their values and price extras above, the variant rows below
// — and saves them with one button. Saving them through the per-line and
// per-variant functions would leave a half-written template whenever the third of
// five calls was refused, so `saveVariantSetup` validates the whole payload first
// and writes it in one transaction.
//
// A variant is never deleted here. It may already sit on an order line in a module
// this one cannot see, so a variant that leaves the setup is archived, the same
// way `generateVariants` retires a combination that no longer exists.

import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { type RecordImage, variantImagesOf } from './record-images.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../user/authorization.ts'
import { barcodeOf, requireFieldGroup } from './functions/shared.ts'
import { hsCodeDigits, hsCodeValid } from './hs-code.ts'
import {
  claimProductCodeRevision,
  productCodeFailure,
  productCodeOf,
  productCodePatch,
  ProductCodeRefused,
} from './codes.ts'

export type VariantSetupValue = { valueId: string; name: string; priceExtra: string }

export type VariantSetupLine = {
  attributeId: string
  name: string
  createVariant: string
  displayType: string
  values: VariantSetupValue[]
}

export type VariantSetupAttribute = {
  attributeId: string
  name: string
  createVariant: string
  values: Array<{ valueId: string; name: string; defaultPriceExtra?: string }>
}

export type VariantSetupVariant = {
  id: string
  /** The value chosen for each variant-creating attribute, by attribute id. */
  valueIds: Record<string, string>
  defaultCode: string | null
  barcode: string | null
  weight: string
  volume: string
  /** The variant's own sale price; null sells at the template price plus extras. */
  listPrice: string | null
  /** The variant's own HS code; null uses the template's. */
  hsCode: string | null
  active: boolean
  /** Primary first; empty without product_media or before the first upload. */
  images: RecordImage[]
}

export type VariantSetup = {
  templateId: string
  listPrice: string
  lines: VariantSetupLine[]
  catalogue: VariantSetupAttribute[]
  variants: VariantSetupVariant[]
}

type Issue = { field: string; message?: string; code: string; params?: Record<string, unknown> }

const bySequence = (a: Row, b: Row) =>
  Number(a.sequence ?? 10) - Number(b.sequence ?? 10) || String(a.name).localeCompare(String(b.name))

const decimalText = (value: unknown, fallback = '0'): string => {
  const raw = String(value ?? '').trim()
  return raw === '' ? fallback : raw
}

const isDecimal = (value: string): boolean => /^-?\d+(\.\d+)?$/.test(value)

const lineIdFor = (templateId: string, attributeId: string): string => `${templateId}:${attributeId}`
const templateValueIdFor = (lineId: string, valueId: string): string => `${lineId}:${valueId}`

/** Everything the editor shows for one template, in the order it shows it. */
export const variantSetupOf = async (ctx: Ctx, templateId: string): Promise<VariantSetup | null> => {
  const template = (await ctx.db.select('product.Template', { id: templateId }))[0]
  if (!template) return null
  const [attributeRows, valueRows, lineRows, templateValueRows, productRows, productValueRows] =
    await Promise.all([
      ctx.db.select('product.Attribute'),
      ctx.db.select('product.AttributeValue'),
      ctx.db.select('product.TemplateAttributeLine', { templateId }),
      ctx.db.select('product.TemplateAttributeValue'),
      ctx.db.select('product.Product', { templateId }),
      ctx.db.select('product.ProductValue'),
    ])
  const attributes = new Map(attributeRows.map((row) => [String(row.id), row]))
  const values = new Map(valueRows.map((row) => [String(row.id), row]))
  const lineIds = new Set(lineRows.map((row) => String(row.id)))
  const templateValues = new Map(
    templateValueRows.filter((row) => lineIds.has(String(row.lineId))).map((row) => [String(row.id), row]),
  )
  const lineAttribute = new Map(lineRows.map((row) => [String(row.id), String(row.attributeId)]))

  const lines: VariantSetupLine[] = lineRows
    .map((line) => ({ line, attribute: attributes.get(String(line.attributeId)) }))
    .filter((entry): entry is { line: Row; attribute: Row } => Boolean(entry.attribute))
    .sort((a, b) => bySequence(a.attribute, b.attribute))
    .map(({ line, attribute }) => ({
      attributeId: String(attribute.id),
      name: String(attribute.name),
      createVariant: String(attribute.createVariant ?? 'always'),
      displayType: String(attribute.displayType ?? 'select'),
      values: [...templateValues.values()]
        .filter((row) => String(row.lineId) === String(line.id))
        .map((row) => ({ row, value: values.get(String(row.valueId)) }))
        .filter((entry): entry is { row: Row; value: Row } => Boolean(entry.value))
        .sort((a, b) => bySequence(a.value, b.value))
        .map(({ row, value }) => ({
          valueId: String(value.id),
          name: String(value.name),
          priceExtra: decimalText(row.priceExtra),
        })),
    }))

  const catalogue: VariantSetupAttribute[] = attributeRows
    .filter((row) => row.active !== false)
    .sort(bySequence)
    .map((attribute) => ({
      attributeId: String(attribute.id),
      name: String(attribute.name),
      createVariant: String(attribute.createVariant ?? 'always'),
      values: valueRows
        .filter((value) => String(value.attributeId) === String(attribute.id))
        .sort(bySequence)
        .map((value) => ({
          valueId: String(value.id),
          name: String(value.name),
          defaultPriceExtra: decimalText(value.defaultPriceExtra),
        })),
    }))

  const chosen = new Map<string, Record<string, string>>()
  for (const link of productValueRows) {
    const templateValue = templateValues.get(String(link.templateAttributeValueId))
    if (!templateValue) continue
    const attributeId = lineAttribute.get(String(templateValue.lineId))
    if (!attributeId) continue
    const held = chosen.get(String(link.productId)) ?? {}
    held[attributeId] = String(templateValue.valueId)
    chosen.set(String(link.productId), held)
  }

  const combinationRows = productRows.filter((row) => String(row.combinationKey ?? '') !== '')
  for (const row of combinationRows) {
    const id = String(row.id)
    if (chosen.has(id) || /^(manual|archived|pending):/.test(String(row.combinationKey))) continue
    const historical: Record<string, string> = {}
    for (const valueId of String(row.combinationKey).split(',')) {
      const value = values.get(valueId)
      if (value) historical[String(value.attributeId)] = valueId
    }
    chosen.set(id, historical)
  }
  const images = await variantImagesOf(
    ctx,
    combinationRows.map((row) => String(row.id)),
  )
  const variants: VariantSetupVariant[] = combinationRows
    .sort(
      (a, b) =>
        Number(b.active !== false) - Number(a.active !== false) ||
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .map((row) => ({
      id: String(row.id),
      valueIds: chosen.get(String(row.id)) ?? {},
      defaultCode: row.defaultCode == null ? null : String(row.defaultCode),
      barcode: row.barcode == null ? null : String(row.barcode),
      weight: decimalText(row.weight),
      volume: decimalText(row.volume),
      listPrice: row.listPriceOverride == null ? null : String(row.listPriceOverride),
      hsCode: row.hsCode == null ? null : String(row.hsCode),
      active: row.active !== false,
      images: images.get(String(row.id)) ?? [],
    }))

  return { templateId, listPrice: decimalText(template.listPrice), lines, catalogue, variants }
}

type LineInput = {
  attributeId: string
  values: Array<{ valueId: string; priceExtra: string; priceSpecified: boolean }>
}
type VariantInput = {
  id: string | null
  valueIds: Record<string, string>
  defaultCode: string | null
  codeSpecified: boolean
  barcode: string | null
  barcodeSpecified: boolean
  weight: string
  weightSpecified: boolean
  volume: string
  volumeSpecified: boolean
  listPrice: string | null
  listPriceSpecified: boolean
  hsCode: string | null
  hsCodeSpecified: boolean
  active: boolean
}

const text = (value: unknown): string | null => {
  const raw = String(value ?? '').trim()
  return raw === '' ? null : raw
}

const readLines = (raw: unknown): LineInput[] =>
  (Array.isArray(raw) ? raw : []).map((entry) => {
    const line = (entry ?? {}) as Record<string, unknown>
    return {
      attributeId: String(line.attributeId ?? ''),
      values: (Array.isArray(line.values) ? line.values : []).map((item) => {
        const value = (item ?? {}) as Record<string, unknown>
        return {
          valueId: String(value.valueId ?? ''),
          priceExtra: decimalText(value.priceExtra),
          priceSpecified: Object.hasOwn(value, 'priceExtra'),
        }
      }),
    }
  })

const readVariants = (raw: unknown): VariantInput[] =>
  (Array.isArray(raw) ? raw : []).map((entry) => {
    const variant = (entry ?? {}) as Record<string, unknown>
    const valueIds = (variant.valueIds ?? {}) as Record<string, unknown>
    return {
      id: text(variant.id),
      valueIds: Object.fromEntries(
        Object.entries(valueIds).map(([key, value]) => [key, String(value ?? '')]),
      ),
      defaultCode: text(variant.defaultCode),
      codeSpecified: Object.hasOwn(variant, 'defaultCode'),
      barcode: text(variant.barcode),
      barcodeSpecified: Object.hasOwn(variant, 'barcode'),
      weight: decimalText(variant.weight),
      weightSpecified: Object.hasOwn(variant, 'weight'),
      volume: decimalText(variant.volume),
      volumeSpecified: Object.hasOwn(variant, 'volume'),
      listPrice: text(variant.listPrice),
      listPriceSpecified: Object.hasOwn(variant, 'listPrice'),
      hsCode: hsCodeDigits(variant.hsCode),
      hsCodeSpecified: Object.hasOwn(variant, 'hsCode'),
      active: variant.active !== false,
    }
  })

/**
 * Validate a template's whole attribute-and-variant setup and write it, on a context the
 * caller already holds inside a transaction (the framework does not nest them). A refusal
 * returns before the first write, so a caller's transaction holds nothing of it.
 */
export const applyVariantSetup = async (
  ctx: Ctx,
  templateId: string,
  rawLines: unknown,
  rawVariants: unknown,
  options: { lockedTemplate?: Row; preserveManual?: boolean } = {},
): Promise<
  { ok: false; errors: Issue[] } | { ok: true; created: number; archived: number; deleted: number }
> => {
  const template = options.lockedTemplate ?? (await lockVariantTemplate(ctx, templateId))
  if (!template)
    return {
      ok: false,
      errors: [{ field: 'templateId', code: 'not_found', message: 'template không tồn tại' }],
    }
  if (template.type === 'combo') return comboRefusal('templateId', 'noVariants')
  const lines = readLines(rawLines)
  const variants = readVariants(rawVariants)
  const activeCount = variants.filter((variant) => variant.active).length
  if (activeCount > VARIANT_LIMIT) return variantLimitRefusal(activeCount)
  const previousLines = await ctx.db.select('product.TemplateAttributeLine', { templateId })
  await lockAttributes(ctx, [
    ...lines.map((line) => line.attributeId),
    ...previousLines.map((line) => line.attributeId),
  ])
  const [attributeRows, valueRows, productRows, lineRows] = await Promise.all([
    ctx.db.select('product.Attribute'),
    ctx.db.select('product.AttributeValue'),
    ctx.db.select('product.Product', { templateId }),
    ctx.db.select('product.TemplateAttributeLine', { templateId }),
  ])
  const manualCount = options.preserveManual
    ? productRows.filter(
        (row) => row.active !== false && /^(manual|archived|pending):/.test(String(row.combinationKey)),
      ).length
    : 0
  if (activeCount + manualCount > VARIANT_LIMIT) return variantLimitRefusal(activeCount + manualCount)
  // A line this function did not create keeps whatever id it has, and
  // `generateVariants` breaks ties on that stored id — so the order below has to
  // read it rather than assume the id this function would have minted.
  const heldLineIds = new Map(lineRows.map((row) => [String(row.attributeId), String(row.id)]))
  const lineIdOf = (attributeId: string): string =>
    heldLineIds.get(attributeId) ?? lineIdFor(templateId, attributeId)
  const attributes = new Map(attributeRows.map((row) => [String(row.id), row]))
  const values = new Map(valueRows.map((row) => [String(row.id), row]))
  const errors: Issue[] = []
  const original = productRows.find((row) => String(row.combinationKey ?? '') === '')
  const baseOwner =
    original ?? productRows.find((row) => productCodeOf(row.defaultCode) === template.variantCodeBase)
  const editedBase = variants.find((variant) => variant.id === baseOwner?.id && variant.codeSpecified)
  const baseCode = productCodeOf(editedBase?.defaultCode ?? original?.defaultCode ?? template.variantCodeBase)
  // The initial SKU already owns its stock, lots, codes and history. Give it the
  // first combination rather than creating a new identity for the same product.
  if (
    original?.active !== false &&
    original &&
    variants[0]?.id == null &&
    variants[0]?.active &&
    productRows.filter((row) => row.active !== false).length === 1
  ) {
    variants[0] = {
      ...variants[0],
      id: String(original.id),
    }
  }
  const heldValues = await ctx.db.select('product.TemplateAttributeValue')
  for (const line of lines)
    for (const entry of line.values)
      if (!entry.priceSpecified) {
        const held = heldValues.find(
          (row) => row.lineId === heldLineIds.get(line.attributeId) && row.valueId === entry.valueId,
        )
        entry.priceExtra = decimalText(held?.priceExtra ?? values.get(entry.valueId)?.defaultPriceExtra)
      }

  // ── Attribute lines ──
  const seenAttributes = new Set<string>()
  lines.forEach((line, index) => {
    const attribute = attributes.get(line.attributeId)
    if (!attribute) {
      errors.push({
        field: `lines.${index}.attributeId`,
        code: 'not_found',
        message: 'thuộc tính không tồn tại',
      })
      return
    }
    if (attribute.active === false && !heldLineIds.has(line.attributeId))
      errors.push({ field: `lines.${index}.attributeId`, code: 'product.error.attribute.inactive' })
    if (seenAttributes.has(line.attributeId))
      errors.push({
        field: `lines.${index}.attributeId`,
        code: 'duplicate',
        message: 'thuộc tính bị lặp',
      })
    seenAttributes.add(line.attributeId)
    const seenValues = new Set<string>()
    line.values.forEach((entry, position) => {
      const value = values.get(entry.valueId)
      if (!value || String(value.attributeId) !== line.attributeId)
        errors.push({
          field: `lines.${index}.values.${position}`,
          code: 'not_in_attribute',
          message: 'giá trị không thuộc thuộc tính này',
        })
      if (seenValues.has(entry.valueId))
        errors.push({
          field: `lines.${index}.values.${position}`,
          code: 'duplicate',
          message: 'giá trị bị lặp',
        })
      seenValues.add(entry.valueId)
      if (!isDecimal(entry.priceExtra))
        errors.push({
          field: `lines.${index}.values.${position}.priceExtra`,
          code: 'invalid_decimal',
          message: 'giá cộng thêm phải là số',
        })
    })
  })

  // The combination key is spelled in `generateVariants`' own order — attribute
  // sequence, then line id — so generating afterwards finds these rows instead
  // of creating the same combinations a second time.
  const variantLines = lines
    .filter((line) => {
      const attribute = attributes.get(line.attributeId)
      return attribute && attribute.createVariant !== 'no_variant' && line.values.length > 0
    })
    .sort((a, b) => {
      const aa = attributes.get(a.attributeId)
      const bb = attributes.get(b.attributeId)
      return (
        Number(aa?.sequence ?? 10) - Number(bb?.sequence ?? 10) ||
        lineIdOf(a.attributeId).localeCompare(lineIdOf(b.attributeId))
      )
    })

  // Removing all creating attributes keeps one existing SKU as the plain product.
  if (!variantLines.length && !variants.length) {
    const plain =
      original ??
      productRows.find((row) => row.id === `${templateId}:default`) ??
      productRows.find((row) => row.active !== false)
    if (plain)
      variants.push({
        id: String(plain.id),
        valueIds: {},
        codeSpecified: false,
        barcodeSpecified: false,
        weightSpecified: false,
        volumeSpecified: false,
        listPriceSpecified: false,
        hsCodeSpecified: false,
        defaultCode: productCodeOf(plain.defaultCode),
        barcode: text(plain.barcode),
        weight: decimalText(plain.weight),
        volume: decimalText(plain.volume),
        listPrice: text(plain.listPriceOverride),
        hsCode: text(plain.hsCode),
        active: true,
      })
  }
  const takenCodes = new Set(
    (await ctx.db.select('product.Product')).flatMap((row) => {
      const code = productCodeOf(row.defaultCode)
      return code ? [code.toUpperCase()] : []
    }),
  )
  for (const variant of variants) {
    if (variant.defaultCode) takenCodes.add(variant.defaultCode.toUpperCase())
  }
  for (const variant of variants)
    if (!variant.id && !variant.defaultCode) variant.defaultCode = nextVariantCode(baseCode, takenCodes)

  // ── Variants ──
  const existing = new Map(productRows.map((row) => [String(row.id), row]))
  const keys = new Map<string, number>()
  const barcodes = new Map<string, number>()
  const resolved = variants.map((variant, index) => {
    if (variant.id && !variant.codeSpecified)
      variant.defaultCode = text(existing.get(variant.id)?.defaultCode)
    if (variant.id && !variant.barcodeSpecified) variant.barcode = text(existing.get(variant.id)?.barcode)
    if (variant.id && !variant.weightSpecified) variant.weight = decimalText(existing.get(variant.id)?.weight)
    if (variant.id && !variant.volumeSpecified) variant.volume = decimalText(existing.get(variant.id)?.volume)
    if (variant.id && !variant.listPriceSpecified)
      variant.listPrice = text(existing.get(variant.id)?.listPriceOverride)
    if (variant.id && !variant.hsCodeSpecified) variant.hsCode = text(existing.get(variant.id)?.hsCode)
    if (variant.id && !existing.has(variant.id))
      errors.push({
        field: `variants.${index}.id`,
        code: 'not_found',
        message: 'biến thể không thuộc sản phẩm này',
      })
    const combination: string[] = []
    for (const line of variantLines) {
      const chosen = variant.valueIds[line.attributeId] ?? ''
      if (!line.values.some((value) => value.valueId === chosen)) {
        if (variant.active)
          errors.push({
            field: `variants.${index}.valueIds.${line.attributeId}`,
            code: 'required',
            message: 'chưa chọn giá trị',
          })
        continue
      }
      combination.push(chosen)
    }
    const key = combination.length === variantLines.length ? combination.join(',') : ''
    if (
      variant.active &&
      variantLines.length === 0 &&
      !(variants.length === 1 && variant.id && existing.has(variant.id))
    )
      errors.push({
        field: `variants.${index}`,
        code: 'no_attributes',
        message: 'chưa có thuộc tính tạo biến thể',
      })
    if (key) {
      const other = keys.get(key)
      if (other !== undefined) {
        errors.push({
          field: `variants.${index}.combination`,
          code: 'duplicate_combination',
          message: 'tổ hợp trùng',
          params: { row: other },
        })
        errors.push({
          field: `variants.${other}.combination`,
          code: 'duplicate_combination',
          message: 'tổ hợp trùng',
          params: { row: index },
        })
      } else keys.set(key, index)
    }
    if (!isDecimal(variant.weight))
      errors.push({ field: `variants.${index}.weight`, code: 'product.error.template.measure' })
    if (!isDecimal(variant.volume))
      errors.push({ field: `variants.${index}.volume`, code: 'product.error.template.measure' })
    if (variant.listPrice !== null && (!isDecimal(variant.listPrice) || variant.listPrice.startsWith('-')))
      errors.push({ field: `variants.${index}.listPrice`, code: 'product.error.variant.listPrice' })
    if (variant.hsCode !== null && !hsCodeValid(variant.hsCode))
      errors.push({ field: `variants.${index}.hsCode`, code: 'product.error.variant.hsCode' })
    if (variant.barcode) {
      const other = barcodes.get(barcodeKey(variant.barcode)!)
      if (other !== undefined)
        errors.push({ field: `variants.${index}.barcode`, code: 'product.error.variant.barcodeRepeated' })
      else barcodes.set(barcodeKey(variant.barcode)!, index)
    }
    return { ...variant, key }
  })
  // An inactive row the editor could not resolve to a full combination keeps the
  // key it already had — archiving a variant must not need its values re-picked.
  for (const [index, variant] of resolved.entries())
    if (!variant.key && !variant.active && variant.id) {
      const previous = existing.get(variant.id)
      const key = String(previous?.combinationKey ?? '')
      resolved[index] = { ...variant, key: key && !keys.has(key) ? key : `archived:${variant.id}` }
    }

  // Barcodes and HS codes are stock fields (P17/P28): changing any of them needs stock setup.
  const stockFields = [
    ...(resolved.some(
      (variant) =>
        barcodeOf(variant.barcode) !== barcodeOf(variant.id ? existing.get(variant.id)?.barcode : null),
    )
      ? ['barcode']
      : []),
    ...(resolved.some(
      (variant) => variant.hsCode !== text(variant.id ? existing.get(variant.id)?.hsCode : null),
    )
      ? ['hsCode']
      : []),
  ]
  if (stockFields.length) await requireFieldGroup(ctx, 'stock', stockFields)
  if (errors.length) return { ok: false, errors }

  const submittedActive = new Set(
    resolved.filter((variant) => variant.active && variant.id).map((variant) => variant.id),
  )
  const submittedIds = new Set(resolved.flatMap((variant) => (variant.id ? [variant.id] : [])))
  const preserve = (row: Row) =>
    options.preserveManual && /^(manual|archived|pending):/.test(String(row.combinationKey))
  if (
    !resolved.some((variant) => variant.active) &&
    !productRows.some((row) => preserve(row) && row.active !== false)
  )
    throw new VariantPolicyRefused({
      ok: false,
      errors: [
        {
          field: 'variants',
          code: 'product.error.variant.lastActive',
          params: { product: String(template.name) },
        },
      ],
    })
  const retiring = productRows.filter(
    (row) =>
      !preserve(row) &&
      !submittedActive.has(String(row.id)) &&
      (row.active !== false || !submittedIds.has(String(row.id))) &&
      (String(row.combinationKey ?? '') !== '' ||
        submittedIds.has(String(row.id)) ||
        resolved.some((variant) => variant.active)),
  )
  for (const row of retiring) await assertVariantCanRetire(ctx, template, row)

  const codeChanged = (variant: (typeof resolved)[number]) =>
    !variant.id || productCodeOf(variant.defaultCode) !== productCodeOf(existing.get(variant.id)?.defaultCode)
  const replacing = resolved.filter(codeChanged).flatMap((variant) => (variant.id ? [variant.id] : []))
  const codePatches: Row[] = []
  for (const [index, variant] of resolved.entries()) {
    const field = `variants.${index}.defaultCode`
    const key = productCodeOf(variant.defaultCode)?.toUpperCase()
    if (
      key &&
      codeChanged(variant) &&
      resolved.some((other, i) => i !== index && productCodeOf(other.defaultCode)?.toUpperCase() === key)
    )
      throw new ProductCodeRefused(field, 'codeTaken')
    codePatches.push(
      codeChanged(variant)
        ? await productCodePatch(ctx, variant.id ? existing.get(variant.id) : null, variant.defaultCode, {
            field,
            replacing,
          })
        : {},
    )
  }

  const barcodeChanged = (variant: (typeof resolved)[number]) =>
    !variant.id || barcodeOf(variant.barcode) !== barcodeOf(existing.get(variant.id)?.barcode)
  const barcodeOwners = resolved
    .filter(barcodeChanged)
    .flatMap((variant) => (variant.id ? [{ kind: 'variant' as const, id: variant.id }] : []))
  const barcodeReplacing = new Set(barcodeOwners.map(barcodeOwnerKey))
  let created = 0
  let archived = 0
  let deleted = 0
  {
    const tx = ctx
    const Line = tx.table('product.TemplateAttributeLine')
    const TemplateValue = tx.table('product.TemplateAttributeValue')
    const ProductValue = tx.table('product.ProductValue')
    await claimProductCodeRevision(tx, template)
    if (template.variantCodeBase !== baseCode && baseCode && variantLines.length)
      await tx.db.update('product.Template', { id: templateId }, { variantCodeBase: baseCode })
    await releaseBarcodeClaims(tx, barcodeOwners)
    for (const owner of barcodeOwners)
      await tx.db.update('product.Product', { id: owner.id }, { barcode: null })
    // Release changing keys together so an atomic SKU-code swap can succeed.
    for (const id of [...replacing].sort()) await tx.db.update('product.Product', { id }, { codeKey: null })

    // Lines and their values: drop what left, add what came, keep price extras current.
    const currentLines = await tx.db.select('product.TemplateAttributeLine', { templateId })
    const wantedAttributes = new Set(lines.map((line) => line.attributeId))
    for (const line of currentLines) {
      const templateValueRows = await tx.db.select('product.TemplateAttributeValue', { lineId: line.id })
      const leaving = !wantedAttributes.has(String(line.attributeId))
      // Matched by value: a company copy of the catalogue gives value rows opaque ids.
      const wanted = new Set(
        (lines.find((entry) => entry.attributeId === String(line.attributeId))?.values ?? []).map(
          (value) => value.valueId,
        ),
      )
      for (const row of templateValueRows)
        if (leaving || !wanted.has(String(row.valueId))) {
          await tx.db.del(deleteFrom(ProductValue).where(eq(ProductValue.templateAttributeValueId, row.id)))
          await tx.db.del(deleteFrom(TemplateValue).where(eq(TemplateValue.id, row.id)))
        }
      if (leaving) await tx.db.del(deleteFrom(Line).where(eq(Line.id, line.id)))
    }
    const templateValueIds = new Map<string, string>()
    for (const line of lines) {
      const held = currentLines.find((row) => String(row.attributeId) === line.attributeId)
      const lineId = held ? String(held.id) : lineIdOf(line.attributeId)
      if (!held)
        await tx.db.insert('product.TemplateAttributeLine', {
          id: lineId,
          templateId,
          attributeId: line.attributeId,
        })
      for (const value of line.values) {
        const row = (
          await tx.db.select('product.TemplateAttributeValue', { lineId, valueId: value.valueId })
        )[0]
        const id = row ? String(row.id) : templateValueIdFor(lineId, value.valueId)
        templateValueIds.set(value.valueId, id)
        if (row)
          await tx.db.update('product.TemplateAttributeValue', { id }, { priceExtra: value.priceExtra })
        else
          await tx.db.insert('product.TemplateAttributeValue', {
            id,
            lineId,
            valueId: value.valueId,
            priceExtra: value.priceExtra,
          })
      }
    }

    // Variants. Keys move in two passes — every row being written first parks on
    // a placeholder — so swapping the combinations of two rows never trips the
    // unique index halfway through.
    const submitted = new Set(resolved.flatMap((variant) => (variant.id ? [variant.id] : [])))
    const claimed = new Set(resolved.map((variant) => variant.key))
    for (const row of productRows) {
      const id = String(row.id)
      if (String(row.combinationKey ?? '') === '' || submitted.has(id) || preserve(row)) continue
      if (await deleteUnusedVariant(tx, id)) {
        deleted++
        continue
      }
      // Left the setup: archived, and moved off any key a submitted row now needs.
      const patch: Row = {}
      if (row.active !== false) {
        patch.active = false
        archived++
      }
      if (claimed.has(String(row.combinationKey))) patch.combinationKey = `archived:${id}`
      if (Object.keys(patch).length) await tx.db.update('product.Product', { id }, patch)
    }
    for (const variant of resolved)
      if (variant.id && String(existing.get(variant.id)?.combinationKey) !== variant.key)
        await tx.db.update('product.Product', { id: variant.id }, { combinationKey: `pending:${variant.id}` })

    for (const [index, variant] of resolved.entries()) {
      const fields = {
        ...codePatches[index],
        ...(barcodeChanged(variant) && variant.id
          ? await claimBarcode(
              tx,
              { kind: 'variant', id: variant.id },
              existing.get(variant.id),
              variant.barcode,
              { field: `variants.${index}.barcode`, replacing: barcodeReplacing },
            )
          : {}),
        weight: variant.weight,
        volume: variant.volume,
        listPriceOverride: variant.listPrice,
        hsCode: variant.hsCode,
        combinationKey: variant.key,
        active: variant.active,
      }
      let id = variant.id
      if (id) {
        if (existing.get(id)?.active !== false && !variant.active) archived++
        await tx.db.update('product.Product', { id }, fields)
      } else {
        const base = `${templateId}:${variant.key}`
        id = base
        for (let n = 2; (await tx.db.select('product.Product', { id }))[0]; n++) id = `${base}:${n}`
        const barcodePatch = await claimBarcode(tx, { kind: 'variant', id }, null, variant.barcode, {
          field: `variants.${index}.barcode`,
          replacing: barcodeReplacing,
        })
        await tx.db.insert('product.Product', { id, templateId, ...fields, ...barcodePatch })
        created++
      }
      await tx.db.del(deleteFrom(ProductValue).where(eq(ProductValue.productId, id)))
      if (variant.key.startsWith('archived:')) continue
      for (const valueId of Object.values(variant.valueIds)) {
        const templateAttributeValueId = templateValueIds.get(valueId)
        if (
          !templateAttributeValueId ||
          !variantLines.some((line) => line.values.some((v) => v.valueId === valueId))
        )
          continue
        await tx.db.insert('product.ProductValue', {
          id: `${id}:${templateAttributeValueId}`,
          productId: id,
          templateAttributeValueId,
        })
      }
    }

    // The no-combination variant sells only while nothing else does.
    const selling = resolved.some((variant) => variant.active)
    const defaultVariant = productRows.find((row) => String(row.combinationKey ?? '') === '')
    if (defaultVariant && !submitted.has(String(defaultVariant.id)))
      await tx.db.update('product.Product', { id: defaultVariant.id }, { active: !selling })
    else if (!selling)
      await tx.db.insert('product.Product', {
        id: `${templateId}:default`,
        templateId,
        defaultCode: null,
        barcode: null,
        weight: '0',
        volume: '0',
        combinationKey: '',
        active: true,
      })
  }

  return { ok: true, created, archived, deleted }
}

export async function saveVariantSetupHandler(ctx: Ctx, args: Row) {
  const templateId = String(args.templateId)
  let result: Row
  try {
    result = await ctx.tx((tx) => applyVariantSetup(tx, templateId, args.lines, args.variants))
  } catch (error) {
    if (error instanceof VariantPolicyRefused) return error.result
    const refused = productCodeFailure(error, 'variants') ?? barcodeFailure(error, 'variants')
    if (refused) return refused
    throw error
  }
  if (!result.ok) return result
  return { ...result, setup: await variantSetupOf(ctx, templateId) }
}

export const variantSetupFunctions: Record<string, FnSpec> = {
  /**
   * Replace a template's attribute lines and variants with the submitted setup.
   *
   * Every active variant must pick exactly one value of every variant-creating
   * line, and no two variants may share a combination — the unique index on
   * `(templateId, combinationKey)` would refuse it anyway, but only after half the
   * rows were written, and without saying which rows collided.
   */
  saveVariantSetup: defineFn({
    input: { templateId: 'id', lines: 'json', variants: 'json' },
    output: {
      ok: 'bool',
      created: 'int?',
      archived: 'int?',
      deleted: 'int?',
      setup: 'json?',
      errors: 'json?',
    },
    effects: [
      ...BARCODE_EFFECTS,
      ...variantRetirementEffects,
      'read:product.Template',
      'read:product.Attribute',
      'write:product.Attribute',
      'read:product.AttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.Product',
      'read:product.ProductValue',
      'read:product_media.Media',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
      'write:product.Product',
      'write:product.Template',
      'write:product.ProductValue',
      ...AUTHORIZATION_READ_EFFECTS,
    ],
    // The product page edits one variant through this call; a retried submit replays.
    idempotent: true,
    agent: true,
    handler: saveVariantSetupHandler,
  }),
}
