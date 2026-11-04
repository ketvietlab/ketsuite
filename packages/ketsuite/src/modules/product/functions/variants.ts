import { comboRefusal } from '../combo-policy.ts'
import { applyVariantSetup, variantSetupOf } from '../variant-setup.ts'
import { lockVariantTemplate, variantRetirementEffects } from '../variant-lifecycle.ts'
import { VARIANT_LIMIT, variantLimitRefusal, VariantPolicyRefused } from '../variant-policy.ts'
import { BARCODE_EFFECTS, barcodeFailure, barcodeKey, claimBarcode } from '../barcodes.ts'
import { claimProductCodeRevision, productCodeFailure, productCodeOf, productCodePatch } from '../codes.ts'
import { defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { barcodeOf, narrow, requireFieldGroup } from './shared.ts'
import { compareNames, fold } from '../text-fold.ts'
import { hsCodeDigits, hsCodeValid } from '../hs-code.ts'

/**
 * Purchase cost is its own bundle (`product.cost`), so a role that reads a
 * variant does not read what it cost. An internal call has no actor and is
 * trusted; a superuser has no function list and holds everything.
 */
const mayReadCost = async (ctx: Ctx): Promise<boolean> => {
  if (!ctx.actor) return true
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  return allowed === null || allowed.includes('product.listVariantCosts')
}

/**
 * What an order line calls a variant (P29): the product's name and the values that make
 * it ("Áo thun Lớn"), or its code when neither says anything.
 */
export const variantDisplayName = (templateName: unknown, variant: Row): string =>
  [templateName, variant.name].filter(Boolean).join(' ') || String(variant.defaultCode ?? variant.id)

/** Effects a reader of `describeVariantName` (or `describeVariants`) declares. */
export const VARIANT_NAME_EFFECTS = [
  'read:product.ProductValue',
  'read:product.TemplateAttributeValue',
  'read:product.TemplateAttributeLine',
  'read:product.AttributeValue',
  'read:product.Attribute',
]

/** One variant's display name, for a caller that holds the raw rows rather than a listing. */
export const describeVariantName = async (ctx: Ctx, product: Row, template: Row): Promise<string> =>
  variantDisplayName(template.name, (await describeVariants(ctx, [product]))[0] ?? product)

/**
 * What a variant is called, spelled out from the values that define it.
 *
 * `product.Product` has no name of its own — a variant *is* its combination, and
 * storing a copy of that would be a second source of truth to keep in step. So
 * the name is derived: "Đỏ · L" for a variant of colour and size. Callers that
 * only need one variant still pay one pass, which is why the whole set is
 * resolved at once rather than per row.
 */
/** Shared with `templateModalContext`: the same attribute-value decoration every variant list needs. */
export const describeVariants = async (ctx: Ctx, products: Row[]): Promise<Row[]> => {
  if (!products.length) return products
  const wanted = new Set(products.map((product) => String(product.id)))
  const links = (await ctx.db.select('product.ProductValue')).filter((link) =>
    wanted.has(String(link.productId)),
  )
  if (!links.length && products.every((product) => !product.combinationKey))
    return products.map((product) => ({ ...product, values: [], name: null }))
  const templateValues = new Map(
    (await ctx.db.select('product.TemplateAttributeValue')).map((row) => [String(row.id), row]),
  )
  const attributeValues = new Map(
    (await ctx.db.select('product.AttributeValue')).map((row) => [String(row.id), row]),
  )
  const lines = new Map(
    (await ctx.db.select('product.TemplateAttributeLine')).map((row) => [String(row.id), row]),
  )
  const attributes = new Map((await ctx.db.select('product.Attribute')).map((row) => [String(row.id), row]))
  const byProduct = new Map<string, Row[]>()
  for (const link of links) {
    const templateValue = templateValues.get(String(link.templateAttributeValueId))
    const value = templateValue ? attributeValues.get(String(templateValue.valueId)) : undefined
    if (!value) continue
    const line = templateValue ? lines.get(String(templateValue.lineId)) : undefined
    const attribute = line ? attributes.get(String(line.attributeId)) : undefined
    const held = byProduct.get(String(link.productId)) ?? []
    held.push({
      valueId: String(value.id),
      value: String(value.name),
      attributeId: attribute ? String(attribute.id) : null,
      attribute: attribute ? String(attribute.name) : null,
      sequence: Number(attribute?.sequence ?? 10),
      valueSequence: Number(value.sequence ?? 10),
    })
    byProduct.set(String(link.productId), held)
  }
  return products.map((product) => {
    const held = byProduct.get(String(product.id)) ?? []
    if (!held.length && !/^(manual|archived|pending):/.test(String(product.combinationKey ?? '')))
      for (const id of String(product.combinationKey ?? '').split(',')) {
        const value = attributeValues.get(id)
        const attribute = value ? attributes.get(String(value.attributeId)) : null
        if (value && attribute)
          held.push({
            valueId: String(value.id),
            value: String(value.name),
            attributeId: String(attribute.id),
            attribute: String(attribute.name),
            sequence: Number(attribute.sequence ?? 10),
            valueSequence: Number(value.sequence ?? 10),
          })
      }
    // Attributes in the order the product's lines read (sequence, then name), so every
    // variant of a product names them the same way round.
    const values = held.sort(
      (a, b) =>
        Number(a.sequence) - Number(b.sequence) ||
        String(a.attribute ?? '').localeCompare(String(b.attribute ?? '')) ||
        String(a.attributeId ?? '').localeCompare(String(b.attributeId ?? '')) ||
        Number(a.valueSequence) - Number(b.valueSequence) ||
        String(a.value).localeCompare(String(b.value)),
    )
    return {
      ...product,
      values,
      name: values.length ? values.map((entry) => String(entry.value)).join(' · ') : null,
    }
  })
}

const templateSummary = (template: Row) => ({
  id: String(template.id),
  name: String(template.name),
  type: String(template.type),
  categoryId: template.categoryId == null ? null : String(template.categoryId),
  brandId: template.brandId == null ? null : String(template.brandId),
  uomId: template.uomId == null ? null : String(template.uomId),
  listPrice: String(template.listPrice),
  origin: template.origin == null ? null : String(template.origin),
  saleOk: template.saleOk === true,
  purchaseOk: template.purchaseOk === true,
  saleDelay: Number(template.saleDelay ?? 0),
  active: template.active !== false,
})

export function listVariantsHandler(ctx: Ctx, args: Record<string, unknown>) {
  return queryVariants(ctx, args)
}

/** Shared catalogue query for product lists and price-free template pickers. */
export async function queryVariants(ctx: Ctx, args: Record<string, unknown>) {
  const wanted = Array.isArray(args.ids) ? [...new Set(args.ids.map(String))].slice(0, 2_000) : null
  if (wanted && !wanted.length) return []
  const P = ctx.table('product.Product')
  const rows = wanted
    ? await ctx.db.all(from(P).where(inArray(P.id, wanted)))
    : await ctx.db.select('product.Product', args.templateId == null ? {} : { templateId: args.templateId })
  const templates = new Map((await ctx.db.select('product.Template')).map((row) => [String(row.id), row]))
  const eligible = rows.filter((row) => {
    const template = templates.get(String(row.templateId))
    if (!template) return false
    const active = row.active !== false && template.active !== false
    if (args.includeArchived !== true && !active) return false
    if (args.active === true && !active) return false
    if (args.active === false && active) return false
    if (args.type && template.type !== args.type) return false
    if (args.saleOk === true && template.saleOk !== true) return false
    if (args.purchaseOk === true && template.purchaseOk !== true) return false
    if (args.requireUom === true && template.uomId == null) return false
    return true
  })
  const described = await describeVariants(ctx, eligible)
  // The template's name is what makes a variant recognisable in a list that
  // spans the catalogue: "Xanh nghiệp vụ" alone says nothing about which
  // product it belongs to.
  const labelled: Row[] = described.map((variant) => {
    const template = templates.get(String(variant.templateId))
    const templateName = template?.name == null ? null : String(template.name)
    return {
      ...variant,
      templateName,
      // The unit a new order line takes for this variant: its product's own, as a grid's search fills it.
      uomId: template?.uomId == null ? null : String(template.uomId),
      saleDelay: Number(template?.saleDelay ?? 0),
      // What an order line shows (P29): the product's name and the values that make the
      // variant, read live, so new, archived and renamed variants follow the catalogue.
      displayName: variantDisplayName(templateName, variant),
      template: templateSummary(template!),
    }
  })
  const q = String(args.search ?? '')
    .trim()
    .toLowerCase()
  const needle = fold(q)
  const packaging = q ? await ctx.db.select('product.ProductUom') : []
  const matching = new Set(
    packaging
      .filter(
        (row) =>
          String(row.barcode ?? '')
            .toLowerCase()
            .includes(q) || barcodeKey(row.barcode) === barcodeKey(q),
      )
      .map((row) => String(row.productId)),
  )
  const searched = q
    ? labelled.filter(
        (row) =>
          matching.has(String(row.id)) ||
          // Accents optional: "ao thun lon" finds "Áo thun Lớn".
          ['displayName', 'defaultCode', 'barcode'].some((field) =>
            fold(String(row[field] ?? '')).includes(needle),
          ) ||
          barcodeKey(row.barcode) === barcodeKey(q),
      )
    : labelled
  // A picker shows the first few and "More…": products by name as Vietnamese reads them, then
  // each product's variants in its attributes' value order (S, M, L), not by stored id.
  const valueOrder = (row: Row): number[] =>
    ((row.values as Row[] | undefined) ?? []).flatMap((value) => [
      Number(value.sequence ?? 10),
      Number(value.valueSequence ?? 10),
    ])
  const byValues = (left: Row, right: Row): number => {
    const [a, b] = [valueOrder(left), valueOrder(right)]
    for (let index = 0; index < Math.min(a.length, b.length); index += 1)
      if (a[index] !== b[index]) return a[index]! - b[index]!
    return a.length - b.length
  }
  return narrow(
    searched.sort(
      (left, right) =>
        compareNames(String(left.templateName ?? ''), String(right.templateName ?? '')) ||
        String(left.templateId).localeCompare(String(right.templateId)) ||
        byValues(left, right) ||
        compareNames(String(left.defaultCode ?? ''), String(right.defaultCode ?? '')) ||
        String(left.id).localeCompare(String(right.id)),
    ),
    { ...args, search: null },
    ['name', 'templateName', 'defaultCode', 'barcode'],
  )
}

export async function getVariantSummaryHandler(ctx: Ctx, args: Record<string, unknown>) {
  const found = (await ctx.db.select('product.Product', { id: args.id }))[0]
  if (!found) return null
  const template = (await ctx.db.select('product.Template', { id: found.templateId }))[0]
  if (!template) return null
  const product = (await describeVariants(ctx, [found]))[0]!
  return { ...product, template: templateSummary(template) }
}

export async function getVariantHandler(ctx: Ctx, args: Record<string, unknown>) {
  const found = (await ctx.db.select('product.Product', { id: args.id }))[0]
  if (!found) return null
  const product = (await describeVariants(ctx, [found]))[0]!
  // Cost and ProductUom are company-scoped, and a read spans every readable
  // company — so both are narrowed to the active one. Otherwise the variant
  // screen shows a sibling company's cost and unit, and saving the form
  // writes those values into this company.
  const company = ctx.scope.company
  const uoms = await ctx.db.select('product.ProductUom', { productId: args.id })
  const mine = (rows: Row[]): Row[] =>
    company ? rows.filter((row) => String(row.companyId) === company) : []
  // Without `product.cost` the key is absent rather than null, so the screen
  // can tell "not allowed" from "never set".
  const cost = (await mayReadCost(ctx))
    ? { cost: mine(await ctx.db.select('product.Cost', { productId: args.id }))[0] ?? null }
    : {}
  return {
    ...product,
    saleDelay: Number(
      (await ctx.db.select('product.Template', { id: product.templateId }))[0]?.saleDelay ?? 0,
    ),
    ...cost,
    // Ordered, because the variant form renders `uoms[0]` and `select` has no
    // ORDER BY of its own.
    uoms: mine(uoms).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  }
}

export async function listVariantCostsHandler(ctx: Ctx, args: Record<string, unknown>) {
  const productIds = [
    ...new Set(Array.isArray(args.productIds) ? args.productIds.map(String).slice(0, 2_000) : []),
  ]
  if (!productIds.length || !ctx.scope.company) return []
  const C = ctx.table('product.Cost')
  return ctx.db.all(from(C).where(eq(C.companyId, ctx.scope.company), inArray(C.productId, productIds)))
}

export async function saveVariantHandler(ctx: Ctx, args: Record<string, unknown>) {
  if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
    return { ok: false, errors: [{ field: 'templateId', message: 'không có template nào mang id này' }] }
  const existing = (await ctx.db.select('product.Product', { id: args.id }))[0]
  const implicitDefault =
    !existing && args.combinationKey === ''
      ? (await ctx.db.select('product.Product', { templateId: args.templateId })).find(
          (product) => String(product.combinationKey) === '',
        )
      : null
  if (
    Object.hasOwn(args, 'barcode') &&
    barcodeOf(args.barcode) !== barcodeOf((existing ?? implicitDefault)?.barcode)
  )
    await requireFieldGroup(ctx, 'stock', ['barcode'])
  const values = {
    ...args,
    defaultCode: Object.hasOwn(args, 'defaultCode')
      ? args.defaultCode
      : Object.hasOwn(args, 'sku')
        ? args.sku
        : ((existing ?? implicitDefault)?.defaultCode ?? null),
    combinationKey: args.combinationKey ?? `manual:${args.id}`,
  }
  // combinationKey is the variant's identity, so it is only ever set on the way
  // in — never rewritten by an edit that did not name it. Casting it every time
  // meant setting a barcode on a generated variant replaced its attribute
  // combination with "manual:<id>" and silently unhooked it from its values.
  const codeSpecified = Object.hasOwn(args, 'defaultCode') || Object.hasOwn(args, 'sku')
  const changesBarcode =
    Object.hasOwn(args, 'barcode') &&
    barcodeOf(args.barcode) !== barcodeOf((existing ?? implicitDefault)?.barcode)
  const fields = ['id', 'templateId', 'weight', 'volume']
  if (!existing || codeSpecified) fields.push('defaultCode')
  if (!existing || args.combinationKey != null) fields.push('combinationKey')
  let changes = ctx
    .change('product.Product', values, existing ?? null)
    .cast(fields)
    .required(['templateId'])
  if (!existing)
    changes = changes
      .put('weight', args.weight ?? '0')
      .put('volume', args.volume ?? '0')
      .put('active', true)
  if (!changes.valid) return { ok: false, errors: changes.errors }
  try {
    await ctx.tx(async (tx) => {
      const template = (await tx.db.select('product.Template', { id: args.templateId }))[0]!
      if (template.type === 'combo') throw new VariantPolicyRefused(comboRefusal('templateId', 'noVariants'))
      const heldId = existing?.id ?? implicitDefault?.id
      const held = heldId ? (await tx.db.select('product.Product', { id: heldId }))[0] : null
      const changesCode =
        codeSpecified && productCodeOf(held?.defaultCode) !== productCodeOf(values.defaultCode)
      const code =
        existing && !changesCode
          ? {}
          : await productCodePatch(
              tx,
              held,
              codeSpecified ? values.defaultCode : (held?.defaultCode ?? values.defaultCode),
            )
      if (!existing || changesCode || changesBarcode) await claimProductCodeRevision(tx, template)
      if (!existing && !implicitDefault) {
        const activeCount = (await tx.db.select('product.Product', { templateId: args.templateId })).filter(
          (row) => row.active !== false,
        ).length
        if (activeCount >= VARIANT_LIMIT) throw new VariantPolicyRefused(variantLimitRefusal(activeCount + 1))
      }
      if (!existing || changesBarcode) {
        const patch = await claimBarcode(
          tx,
          { kind: 'variant', id: String(args.id) },
          held,
          Object.hasOwn(args, 'barcode') ? args.barcode : held?.barcode,
        )
        for (const [field, value] of Object.entries(patch)) changes = changes.put(field, value)
      }
      for (const [field, value] of Object.entries(code)) changes = changes.put(field, value)
      if (changesCode && template.variantCodeBase && template.variantCodeBase === held?.defaultCode)
        await tx.db.update('product.Template', { id: template.id }, { variantCodeBase: values.defaultCode })
      if (implicitDefault && held?.codeKey && !Object.hasOwn(code, 'codeKey'))
        changes = changes.put('codeKey', held.codeKey)
      // Older integrations create the no-combination variant under their own
      // business id immediately after saving a template. Replace the fresh,
      // deterministic implicit row before anything can reference it, keeping
      // that public workflow compatible with the new default-variant model.
      if (implicitDefault) {
        const Product = tx.table('product.Product')
        await tx.db.del(deleteFrom(Product).where(eq(Product.id, implicitDefault.id)))
      }
      await tx.db.commit(changes, existing ? { id: args.id } : undefined)
    })
  } catch (error) {
    if (error instanceof VariantPolicyRefused) return error.result
    const refused = productCodeFailure(error) ?? barcodeFailure(error)
    if (refused) return refused
    throw error
  }
  return { ok: true, id: args.id }
}

/**
 * Set one variant's barcode: the stock field group on its own, for a role that
 * sets stock up without editing the rest of the product. The template's revision
 * moves with it, so a record page opened before this change cannot save over it.
 */
export async function setBarcodeHandler(ctx: Ctx, args: Record<string, unknown>) {
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
  if (!product) return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
  const barcode = barcodeOf(args.barcode)
  if (barcode === barcodeOf(product.barcode)) return { ok: true, id: product.id }
  try {
    await ctx.tx(async (tx) => {
      const template = (await tx.db.select('product.Template', { id: product.templateId }))[0]!
      await claimProductCodeRevision(tx, template)
      const patch = await claimBarcode(tx, { kind: 'variant', id: String(product.id) }, product, barcode)
      await tx.db.update('product.Product', { id: product.id }, patch)
    })
  } catch (error) {
    const refused = barcodeFailure(error)
    if (refused) return refused
    throw error
  }
  return { ok: true, id: product.id }
}

/**
 * P28: one variant's stock setup, its barcode and HS code, written together. It is what a
 * stock manager edits on a variant; a value the call leaves out stays as saved.
 */
export async function saveVariantStockHandler(ctx: Ctx, args: Record<string, unknown>) {
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
  if (!product) return { ok: false, errors: [{ field: 'productId', code: 'not_found' }] }
  const savedHs = product.hsCode == null ? null : String(product.hsCode)
  const barcode = Object.hasOwn(args, 'barcode') ? barcodeOf(args.barcode) : barcodeOf(product.barcode)
  const hsCode = Object.hasOwn(args, 'hsCode') ? hsCodeDigits(args.hsCode) : savedHs
  if (hsCode !== null && !hsCodeValid(hsCode))
    return { ok: false, errors: [{ field: 'hsCode', code: 'product.error.variant.hsCode' }] }
  const barcodeChanged = barcode !== barcodeOf(product.barcode)
  if (!barcodeChanged && hsCode === savedHs) return { ok: true, id: product.id }
  try {
    await ctx.tx(async (tx) => {
      const template = (await tx.db.select('product.Template', { id: product.templateId }))[0]!
      await claimProductCodeRevision(tx, template)
      const patch = barcodeChanged
        ? await claimBarcode(tx, { kind: 'variant', id: String(product.id) }, product, barcode)
        : {}
      await tx.db.update('product.Product', { id: product.id }, { ...patch, hsCode })
    })
  } catch (error) {
    const refused = barcodeFailure(error)
    if (refused) return refused
    throw error
  }
  return { ok: true, id: product.id }
}

export async function generateVariantsHandler(ctx: Ctx, args: Record<string, unknown>) {
  try {
    return await ctx.tx(async (tx) => {
      const templateId = String(args.templateId)
      const template = await lockVariantTemplate(tx, templateId)
      if (!template) return { ok: false, errors: [{ field: 'templateId', code: 'not_found' }] }
      if (template.type === 'combo') return comboRefusal('templateId', 'noVariants')
      const setup = await variantSetupOf(tx, templateId)
      if (!setup) return { ok: false, errors: [{ field: 'templateId', code: 'not_found' }] }
      const lines = setup.lines.filter((line) => line.createVariant !== 'no_variant' && line.values.length)
      const count = lines.reduce((total, line) => total * line.values.length, 1)
      if (count > VARIANT_LIMIT) return variantLimitRefusal(count)
      const current = await tx.db.select('product.Product', { templateId })
      const combinations = lines.length
        ? lines.reduce<Array<Record<string, string>>>(
            (rows, line) =>
              rows.flatMap((row) =>
                line.values.map((value) => ({ ...row, [line.attributeId]: value.valueId })),
              ),
            [{}],
          )
        : []
      const keyOf = (values: Record<string, string>) =>
        JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))
      const held = new Map(setup.variants.map((variant) => [keyOf(variant.valueIds), variant]))
      // P27, as configureAttributes: a variant archived because one of its values left the
      // product lost its value links then, and sells again once its combination is back. One
      // someone stopped selling kept its links, and stays stopped.
      const unlinked = new Set<string>()
      for (const variant of setup.variants)
        if (
          variant.id &&
          variant.active === false &&
          !(await tx.db.select('product.ProductValue', { productId: variant.id })).length
        )
          unlinked.add(String(variant.id))
      const variants = combinations.map((valueIds) => {
        const existing = held.get(keyOf(valueIds))
        return existing
          ? { ...existing, valueIds, active: existing.active !== false || unlinked.has(String(existing.id)) }
          : { id: null, valueIds, active: true }
      })
      const applied = await applyVariantSetup(tx, templateId, setup.lines, variants, {
        lockedTemplate: template,
        preserveManual: true,
      })
      if (!applied.ok) return applied
      const products = await tx.db.select('product.Product', { templateId })
      const manual = new Set(
        current
          .filter((row) => /^(manual|archived|pending):/.test(String(row.combinationKey)))
          .map((row) => String(row.id)),
      )
      return {
        ok: true,
        created: applied.created,
        ids: products
          .filter((row) => row.active !== false && !manual.has(String(row.id)))
          .map((row) => String(row.id)),
      }
    })
  } catch (error) {
    if (error instanceof VariantPolicyRefused) return error.result
    const refused = productCodeFailure(error) ?? barcodeFailure(error)
    if (refused) return refused
    throw error
  }
}

export const variantsFunctions: Record<string, FnSpec> = {
  /**
   * The variants of one template, or of the whole catalogue.
   *
   * `templateId` became optional so a relation picker on a sale or purchase line
   * can search every variant at once — that field holds a variant, not a template,
   * and the forms were flat-mapping the entire catalogue into a `<select>`.
   * `search` matches the derived name, the internal reference and the barcode,
   * which are the three things a person has in front of them.
   */
  listVariants: defineFn({
    input: {
      templateId: 'id?',
      ids: 'json?',
      search: 'text?',
      limit: 'int?',
      offset: 'int?',
      includeArchived: 'bool?',
      active: 'bool?',
      type: 'text?',
      saleOk: 'bool?',
      purchaseOk: 'bool?',
      requireUom: 'bool?',
    },
    effects: [
      'read:product.ProductUom',
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductValue',
      'read:product.TemplateAttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.AttributeValue',
      'read:product.Attribute',
    ],
    agent: true,
    handler: listVariantsHandler,
  }),
  /** Safe catalogue detail without company cost or barcode-unit records. */
  getVariantSummary: defineFn({
    input: { id: 'id' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductValue',
      'read:product.TemplateAttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.AttributeValue',
      'read:product.Attribute',
    ],
    agent: true,
    handler: getVariantSummaryHandler,
  }),
  getVariant: defineFn({
    input: { id: 'id' },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:product.Cost',
      'read:product.ProductUom',
      'read:product.ProductValue',
      'read:product.TemplateAttributeValue',
      'read:product.TemplateAttributeLine',
      'read:product.AttributeValue',
      'read:product.Attribute',
      ...AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
    ],
    agent: true,
    handler: getVariantHandler,
  }),
  /** Company-scoped batch cost evidence for bounded operational catalogues. */
  listVariantCosts: defineFn({
    input: { productIds: 'json' },
    output: { productId: 'id', standardPrice: 'decimal' },
    effects: ['read:product.Cost'],
    agent: true,
    handler: listVariantCostsHandler,
  }),
  saveVariant: defineFn({
    input: {
      id: 'id',
      templateId: 'id',
      defaultCode: 'text?',
      sku: 'text?',
      barcode: 'text?',
      weight: 'decimal?',
      volume: 'decimal?',
      combinationKey: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...BARCODE_EFFECTS,
      'read:product.Product',
      'read:product.Template',
      'write:product.Product',
      'write:product.Template',
      ...AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
    ],
    idempotent: true,
    agent: true,
    handler: saveVariantHandler,
  }),
  setBarcode: defineFn({
    input: { productId: 'id', barcode: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...BARCODE_EFFECTS, 'read:product.Template', 'write:product.Product', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: setBarcodeHandler,
  }),
  saveVariantStock: defineFn({
    input: { productId: 'id', barcode: 'text?', hsCode: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...BARCODE_EFFECTS, 'read:product.Template', 'write:product.Product', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: saveVariantStockHandler,
  }),
  generateVariants: defineFn({
    input: { templateId: 'id' },
    output: { ok: 'bool', created: 'int?', ids: 'json?', errors: 'json?' },
    effects: [
      ...BARCODE_EFFECTS,
      ...variantRetirementEffects,
      ...AUTHORIZATION_EFFECTS.filter((effect) => effect.startsWith('read:')),
      'write:product.Attribute',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
      'read:product_media.Media',
      'read:product.AttributeValue',
      'read:product.ProductValue',
      'read:product.Template',
      'write:product.Template',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.Attribute',
      'read:product.Product',
      'write:product.Product',
      'write:product.ProductValue',
    ],
    idempotent: true,
    agent: true,
    handler: generateVariantsHandler,
  }),
}
