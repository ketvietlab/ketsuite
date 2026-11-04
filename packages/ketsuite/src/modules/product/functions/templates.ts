import { defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'
import { tagFailure, templateTagIds, validateTemplateTags, writeTemplateTags } from '../tag-policy.ts'
import { BARCODE_EFFECTS, barcodeFailure, claimBarcode } from '../barcodes.ts'
import { categoryFailure, requireActiveCategory } from '../category-policy.ts'
import { randomUUID } from 'node:crypto'
import { productCodeFailure, productCodePatch } from '../codes.ts'
import { hsCodeDigits, hsCodeValid } from '../hs-code.ts'
import { liveDocument } from '../../../ui/live-document.ts'
import {
  KetError,
  asc,
  bucketEq,
  compileListFilter,
  defineFn,
  deleteFrom,
  desc,
  eq,
  from,
  ilike,
  inArray,
  isNull,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, ListState, Row } from '@ketvietlab/ketjs'
import { PRODUCT_TYPES } from '../types.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { barcodeOf, requireFieldGroup } from './shared.ts'
import { emptyProductListState, productListSearch } from '../search.ts'
import { lockVariantTemplate } from '../variant-lifecycle.ts'
import { comboFailure, comboRefusal } from '../combo-policy.ts'
import {
  TEMPLATE_COMBO_EFFECTS,
  templateComboIds,
  validateTemplateCombos,
  writeTemplateCombos,
} from '../template-combos.ts'

/**
 * The same escape the framework applies to `state.q`, so a term containing `%`
 * or `_` is matched literally rather than as a wildcard. Paired with the escape
 * flag on `ilike`, which is what puts `ESCAPE '\'` on the statement.
 */
const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

/**
 * A caller's list state is JSON, so it may be partial or the wrong shape entirely.
 * Filling every field from the empty state keeps `compileListFilter` and the group
 * walk working on the arrays they are typed to expect: `{ state: {} }` is a
 * reasonable thing for an agent to send, and it should narrow nothing rather than
 * throw a TypeError from inside the framework.
 */
const listStateOf = (value: unknown): ListState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ListState>
  const empty = emptyProductListState()
  const page = Number(raw.page)
  return {
    ...empty,
    ...raw,
    presets: Array.isArray(raw.presets) ? raw.presets : empty.presets,
    filters: Array.isArray(raw.filters) ? raw.filters : empty.filters,
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy : empty.groupBy,
    sort: Array.isArray(raw.sort) && raw.sort.length ? raw.sort : empty.sort,
    openGroups: Array.isArray(raw.openGroups) ? raw.openGroups : empty.openGroups,
    groupPages: raw.groupPages && typeof raw.groupPages === 'object' ? raw.groupPages : empty.groupPages,
    page: Number.isInteger(page) && page > 0 ? page : empty.page,
    includeArchived: raw.includeArchived === true,
  }
}

const templateQuery = (
  ctx: Ctx,
  args: {
    type?: string | null
    search?: string | null
    state?: unknown
    path?: unknown
    timezone?: string | null
  },
) => {
  const T = ctx.table('product.Template')
  const state = listStateOf(args.state)
  const normalized = state ?? emptyProductListState()
  let query = from(T)
  if (!normalized.includeArchived) query = query.where(eq(T.active, true))
  if (args.type != null) query = query.where(eq(T.type, args.type))
  if (args.search) query = query.where(ilike(T.name, `%${wildcard(args.search)}%`, true))
  const compiled = compileListFilter(productListSearch(T), normalized, { timezone: args.timezone ?? 'UTC' })
  if (compiled) query = query.where(compiled)
  const path = Array.isArray(args.path) ? args.path : []
  const spec = productListSearch(T)
  for (let index = 0; index < path.length; index++) {
    const selected = normalized.groupBy[index]
    const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
    if (!field) continue
    const value = path[index]
    query = query.where(
      value == null
        ? isNull(field.col)
        : selected?.interval
          ? bucketEq(field.col, selected.interval, args.timezone ?? 'UTC', String(value))
          : eq(field.col, value),
    )
  }
  const sorts = normalized.sort.length ? normalized.sort : [{ key: 'name', dir: 'asc' as const }]
  const sortable = new Map((spec.sortable ?? []).map((field) => [field.key, field.col]))
  for (const sort of sorts) {
    const col = sortable.get(sort.key)
    if (col) query = query.orderBy(sort.dir === 'desc' ? desc(col) : asc(col))
  }
  return query
}

/**
 * The template values a changeset cannot judge: a compare-at price above the sale price,
 * an HS code of 4 to 10 digits, and non-negative measures. Codes are message keys of this
 * module, so the record page words them in the reader's language.
 */
export const deliveryLeadFormSchema = defineFormSchema({
  fields: { saleDelay: { type: 'int', nullable: true, min: 0, max: 365 } },
  unknown: 'drop',
})

export const templateValueIssues = (args: Record<string, unknown>, existing: Row | undefined) => {
  const issues: Array<{ field: string; code: string }> = []
  if (args.saleWarning != null && (typeof args.saleWarning !== 'string' || args.saleWarning.length > 300))
    issues.push({ field: 'saleWarning', code: 'product.error.template.saleWarning' })
  const amount = (value: unknown): number | null =>
    value === null || value === undefined || String(value).trim() === '' ? null : Number(value)
  const listPrice = amount(args.listPrice ?? existing?.listPrice ?? 0) ?? 0
  for (const field of ['listPrice', 'compareAtPrice'] as const) {
    const value = amount(args[field])
    if (value !== null && (!Number.isFinite(value) || value < 0))
      issues.push({ field, code: 'product.error.template.money' })
  }
  if (!validateForm(deliveryLeadFormSchema, args).valid)
    issues.push({ field: 'saleDelay', code: 'product.error.template.saleDelay' })
  const compareAt = amount(args.compareAtPrice)
  if (compareAt !== null && Number.isFinite(compareAt) && compareAt <= listPrice)
    issues.push({ field: 'compareAtPrice', code: 'product.error.template.compareAt' })
  const hsCode = hsCodeDigits(args.hsCode)
  if (hsCode !== null && !hsCodeValid(hsCode))
    issues.push({ field: 'hsCode', code: 'product.error.template.hsCode' })
  for (const field of ['weight', 'volume'] as const) {
    const value = amount(args[field])
    if (value !== null && (!Number.isFinite(value) || value < 0))
      issues.push({ field, code: 'product.error.template.measure' })
  }
  return issues
}

export function saveTemplateFunction(options: { inTransaction?: boolean } = {}) {
  async function saveTemplateHandler(ctx: Ctx, args: Record<string, unknown>) {
    args = { ...args }
    if (!PRODUCT_TYPES.includes(args.type as never))
      return {
        ok: false,
        errors: [{ field: 'type', message: `phải là một trong: ${PRODUCT_TYPES.join(', ')}` }],
      }
    if (args.uomId && !(await ctx.db.select('uom.Unit', { id: args.uomId }))[0])
      return { ok: false, errors: [{ field: 'uomId', message: 'không có đơn vị nào mang id này' }] }
    if (args.brandId && !(await ctx.db.select('product.Brand', { id: args.brandId }))[0])
      return { ok: false, errors: [{ field: 'brandId', message: 'thương hiệu không tồn tại' }] }
    if (
      args.saleVariantMode != null &&
      (!['inline', 'matrix'].includes(String(args.saleVariantMode)) ||
        (args.type === 'combo' && args.saleVariantMode !== 'inline'))
    )
      return {
        ok: false,
        errors: [{ field: 'saleVariantMode', code: 'product.error.template.saleVariantMode' }],
      }
    const existing = (await ctx.db.select('product.Template', { id: args.id }))[0]
    if (args.type === 'combo' && !(args.uomId ?? existing?.uomId))
      return comboRefusal('uomId', 'unitRequired')
    if (
      args.type !== 'combo' &&
      Object.hasOwn(args, 'comboIds') &&
      (!Array.isArray(args.comboIds) || args.comboIds.length)
    )
      return comboRefusal('comboIds', 'onlyCombo')
    if (existing && ctx.manifest.modules.website_catalog && args.expectedRevisionId == null)
      return {
        ok: false,
        errors: [{ field: 'expectedRevisionId', message: 'Conflict: Tải lại sản phẩm trước khi lưu.' }],
      }
    // Type and unit are chosen at creation and then fixed: orders, moves and stock
    // already counted in them would read differently afterwards.
    if (existing && args.type !== existing.type)
      return { ok: false, errors: [{ field: 'type', code: 'product.error.template.typeLocked' }] }
    if (existing?.uomId && Object.hasOwn(args, 'uomId') && (args.uomId ?? null) !== String(existing.uomId))
      return { ok: false, errors: [{ field: 'uomId', code: 'product.error.template.uomLocked' }] }
    const refused = templateValueIssues(args, existing)
    if (refused.length) return { ok: false, errors: refused }
    if (Object.hasOwn(args, 'hsCode')) args.hsCode = hsCodeDigits(args.hsCode)
    if (args.description != null && args.summaryDoc == null)
      args.summaryDoc = JSON.stringify([
        { id: 'summary', type: 'p', delta: [{ insert: String(args.description) }] },
      ])
    if (args.expectedRevisionId != null && args.expectedRevisionId !== (existing?.revisionId ?? 'initial'))
      return {
        ok: false,
        errors: [{ field: 'expectedRevisionId', message: 'Conflict: sản phẩm đã thay đổi.' }],
      }
    for (const key of ['summaryDoc', 'descriptionDoc']) {
      if (args[key] != null)
        args[key] = liveDocument(typeof args[key] === 'string' ? args[key] : JSON.stringify(args[key]), {
          images: false,
        }).doc
    }
    if (Object.hasOwn(args, 'saleWarning')) args.saleWarning = String(args.saleWarning ?? '').trim() || null
    const revisionId = randomUUID()
    const products = await ctx.db.select('product.Product', { templateId: args.id })
    const defaultVariant = products.find((product) => String(product.combinationKey) === '')
    // The barcode is a stock field: a role without stock setup may resubmit it
    // unchanged, and is refused when it differs.
    if (Object.hasOwn(args, 'barcode') && barcodeOf(args.barcode) !== barcodeOf(defaultVariant?.barcode))
      await requireFieldGroup(ctx, 'stock', ['barcode'])
    // So is the HS code, which a variant also keeps in the stock setup.
    if (Object.hasOwn(args, 'hsCode') && args.hsCode !== hsCodeDigits(existing?.hsCode))
      await requireFieldGroup(ctx, 'stock', ['hsCode'])
    let changes = ctx
      .change('product.Template', args, existing ?? null)
      .cast([
        'id',
        'name',
        'type',
        'categoryId',
        'brandId',
        'uomId',
        'origin',
        'description',
        'summaryDoc',
        'descriptionDoc',
        'listPrice',
        'compareAtPrice',
        'hsCode',
        'saleOk',
        'saleVariantMode',
        'purchaseOk',
        'saleDelay',
        'saleWarning',
      ])
      .required(['name', 'type'])
    if (!existing) {
      changes = changes
        .put('listPrice', args.listPrice ?? '0')
        .put('saleOk', args.saleOk ?? true)
        .put('purchaseOk', args.purchaseOk ?? true)
        .put('active', true)
    }
    changes = changes.put('revisionId', revisionId)
    if (ctx.manifest.modules.stock)
      changes = changes.put('inventoryRevision', Number(existing?.inventoryRevision ?? 0) + 1)
    if (!changes.valid) return { ok: false, errors: changes.errors }
    const save = async (tx: Ctx) => {
      const comboIds =
        args.type === 'combo'
          ? await validateTemplateCombos(
              tx,
              args.id,
              Object.hasOwn(args, 'comboIds') ? args.comboIds : await templateComboIds(tx, args.id),
              existing?.active === false,
            )
          : null
      const tagIds = Object.hasOwn(args, 'tagIds')
        ? await validateTemplateTags(tx, args.id, args.tagIds)
        : null
      const categoryId = Object.hasOwn(args, 'categoryId') ? args.categoryId : existing?.categoryId
      if (existing?.active !== false || categoryId !== existing?.categoryId)
        await requireActiveCategory(tx, categoryId)
      const code = await productCodePatch(
        tx,
        defaultVariant,
        Object.hasOwn(args, 'defaultCode') ? args.defaultCode : defaultVariant?.defaultCode,
      )
      if (existing) {
        const cas = await tx.db.compareAndSet(
          'product.Template',
          { id: args.id },
          {
            revisionId: existing.revisionId ?? null,
            ...(ctx.manifest.modules.stock ? { inventoryRevision: existing.inventoryRevision ?? null } : {}),
          },
          { revisionId },
        )
        if (!('dryRun' in cas) && !cas.matched) return false
      }
      await tx.db.commit(changes, existing ? { id: args.id } : undefined)
      if (comboIds) await writeTemplateCombos(tx, args.id, comboIds)
      if (tagIds) await writeTemplateTags(tx, args.id, tagIds)
      // Once the original SKU has become a combination, every SKU is a variant that owns
      // its code and barcode; the template has no default row to write or create.
      const ownsDefault = Boolean(defaultVariant) || products.length === 0
      const barcodePatch =
        ownsDefault && (Object.hasOwn(args, 'barcode') || !defaultVariant)
          ? await claimBarcode(
              tx,
              { kind: 'variant', id: String(defaultVariant?.id ?? `${String(args.id)}:default`) },
              defaultVariant,
              args.barcode,
            )
          : {}
      const generated = products.some(
        (product) => String(product.combinationKey) !== '' && product.active !== false,
      )
      const identity = {
        ...code,
        ...barcodePatch,
        ...(Object.hasOwn(args, 'weight') ? { weight: args.weight ?? '0' } : {}),
        ...(Object.hasOwn(args, 'volume') ? { volume: args.volume ?? '0' } : {}),
        active: existing?.active !== false && !generated,
      }
      if (defaultVariant) await tx.db.update('product.Product', { id: defaultVariant.id }, identity)
      else if (ownsDefault)
        await tx.db.insert('product.Product', {
          id: `${String(args.id)}:default`,
          templateId: args.id,
          ...code,
          ...barcodePatch,
          weight: args.weight ?? '0',
          volume: args.volume ?? '0',
          combinationKey: '',
          active: existing?.active !== false && !generated,
        })
      if (args.uomId) await tx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
      return true
    }
    let saved: boolean
    try {
      saved = options.inTransaction ? await save(ctx) : await ctx.tx(save)
    } catch (error) {
      const refused =
        productCodeFailure(error) ??
        barcodeFailure(error) ??
        categoryFailure(error) ??
        tagFailure(error) ??
        comboFailure(error)
      if (refused) return refused
      throw error
    }
    if (!saved)
      return {
        ok: false,
        errors: [{ field: 'expectedRevisionId', message: 'Conflict: sản phẩm đã thay đổi.' }],
      }
    return { ok: true, id: args.id }
  }

  return defineFn({
    input: {
      id: 'id',
      name: 'text',
      type: 'text',
      categoryId: 'id?',
      tagIds: 'json?',
      comboIds: 'json?',
      brandId: 'id?',
      uomId: 'id?',
      origin: 'text?',
      description: 'text?',
      summaryDoc: 'text?',
      descriptionDoc: 'text?',
      expectedRevisionId: 'text?',
      listPrice: 'decimal?',
      compareAtPrice: 'decimal?',
      hsCode: 'text?',
      saleOk: 'bool?',
      saleVariantMode: 'text?',
      purchaseOk: 'bool?',
      saleDelay: 'int?',
      saleWarning: 'text?',
      defaultCode: 'text?',
      barcode: 'text?',
      // The default variant's measures: a product without variants is weighed as a whole.
      weight: 'decimal?',
      volume: 'decimal?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...TEMPLATE_COMBO_EFFECTS,
      'read:product.Template',
      'write:product.Template',
      'read:product.Product',
      'write:product.Product',
      ...BARCODE_EFFECTS,
      'read:product.Tag',
      'write:product.Tag',
      'read:product.TemplateTag',
      'write:product.TemplateTag',
      'read:product.Brand',
      'read:product.Category',
      'write:product.Category',
      'read:uom.Unit',
      'write:uom.Unit',
      ...AUTHORIZATION_READ_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: saveTemplateHandler,
  })
}

export async function listTemplatesHandler(ctx: Ctx, args: Record<string, unknown>) {
  let query = templateQuery(ctx, args)
  if (args.limit != null) query = query.limit(Number(args.limit))
  if (args.offset != null) query = query.offset(Number(args.offset))
  const rows = await ctx.db.all(args.withVariants === true ? query.preload('variants') : query)
  return rows
}

export async function countTemplatesHandler(ctx: Ctx, args: Record<string, unknown>) {
  return { count: await ctx.db.count(templateQuery(ctx, args)) }
}

export async function groupTemplatesHandler(ctx: Ctx, args: Record<string, unknown>) {
  const state = listStateOf(args.state)
  if (!state) return []
  const path = Array.isArray(args.path) ? args.path : []
  const T = ctx.table('product.Template')
  const spec = productListSearch(T)
  let query = templateQuery(ctx, { state, path, timezone: String(args.timezone ?? 'UTC') })
  const selected = state.groupBy[path.length]
  const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
  if (!field) return []
  query = query
    .groupBy({ col: field.col, interval: selected?.interval, timezone: String(args.timezone ?? 'UTC') })
    .orderGroupsBy({ by: 'key', dir: 'asc' })
  if (args.limit != null) query = query.limit(Number(args.limit))
  if (args.offset != null) query = query.offset(Number(args.offset))
  return ctx.db.group(query)
}

export async function getTemplateHandler(ctx: Ctx, args: Record<string, unknown>) {
  const T = ctx.table('product.Template')
  const row = await ctx.db.one(
    from(T).where(eq(T.id, args.id)).preload('variants', 'category', 'brand', 'uoms', 'attributeLines'),
  )
  return row
    ? { ...row, tagIds: await templateTagIds(ctx, args.id), comboIds: await templateComboIds(ctx, args.id) }
    : row
}

export async function deleteTemplatesHandler(ctx: Ctx, args: Record<string, unknown>) {
  const ids = [...new Set(Array.isArray(args.ids) ? args.ids.map(String).filter(Boolean) : [])]
  if (!ids.length) return { deleted: 0 }
  return ctx.tx(async (tx) => {
    // Serialize the reference check with combo assignment before deleting any SKU.
    for (const id of [...ids].sort()) await lockVariantTemplate(tx, id)
    const Template = tx.table('product.Template')
    const Product = tx.table('product.Product')
    const Cost = tx.table('product.Cost')
    const TemplateUom = tx.table('product.TemplateUom')
    const TemplateTag = tx.table('product.TemplateTag')
    const ProductUom = tx.table('product.ProductUom')
    const Line = tx.table('product.TemplateAttributeLine')
    const Value = tx.table('product.TemplateAttributeValue')
    const ProductValue = tx.table('product.ProductValue')
    const products = await tx.db.all(from(Product).where(inArray(Product.templateId, ids)))
    const productIds = products.map((row) => String(row.id))
    const ComboItem = tx.table('product.ComboItem')
    if (
      productIds.length &&
      (await tx.db.one(from(ComboItem).where(inArray(ComboItem.productId, productIds))))
    )
      throw new KetError({
        code: 'conflict',
        message:
          'A combo choice still references this product. Archive it or remove the choice item before deleting.',
      })
    const lines = await tx.db.all(from(Line).where(inArray(Line.templateId, ids)))
    const lineIds = lines.map((row) => String(row.id))

    if (productIds.length) {
      await tx.db.del(deleteFrom(ProductValue).where(inArray(ProductValue.productId, productIds)))
      await tx.db.del(deleteFrom(ProductUom).where(inArray(ProductUom.productId, productIds)))
      await tx.db.del(deleteFrom(Cost).where(inArray(Cost.productId, productIds)))
    }
    if (lineIds.length) await tx.db.del(deleteFrom(Value).where(inArray(Value.lineId, lineIds)))
    await tx.db.del(deleteFrom(Line).where(inArray(Line.templateId, ids)))
    await tx.db.del(deleteFrom(TemplateTag).where(inArray(TemplateTag.templateId, ids)))
    const TemplateCombo = tx.table('product.TemplateCombo')
    await tx.db.del(deleteFrom(TemplateCombo).where(inArray(TemplateCombo.templateId, ids)))
    await tx.db.del(deleteFrom(TemplateUom).where(inArray(TemplateUom.templateId, ids)))
    if (productIds.length) await tx.db.del(deleteFrom(Product).where(inArray(Product.id, productIds)))
    const result = await tx.db.del(deleteFrom(Template).where(inArray(Template.id, ids)))
    return { deleted: result.changes }
  })
}

export const templatesFunctions: Record<string, FnSpec> = {
  listTemplates: defineFn({
    input: {
      withVariants: 'bool?',
      type: 'text?',
      search: 'text?',
      state: 'json?',
      path: 'json?',
      timezone: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    output: {
      id: 'id',
      name: 'text',
      type: 'text',
      categoryId: 'id?',
      uomId: 'id?',
      description: 'text?',
      listPrice: 'decimal',
      saleOk: 'bool',
      saleVariantMode: 'text?',
      purchaseOk: 'bool',
      saleDelay: 'int?',
      saleWarning: 'text?',
      active: 'bool?',
      createdAt: 'datetime?',
      updatedAt: 'datetime?',
      variants: 'json?',
    },
    effects: ['read:product.Template', 'read:product.Product', 'read:product.TemplateUom'],
    agent: true,
    handler: listTemplatesHandler,
  }),
  countTemplates: defineFn({
    input: { type: 'text?', search: 'text?', state: 'json?', timezone: 'text?' },
    output: { count: 'int' },
    effects: ['read:product.Template'],
    agent: true,
    handler: countTemplatesHandler,
  }),
  groupTemplates: defineFn({
    input: { state: 'json', path: 'json?', timezone: 'text?', limit: 'int?', offset: 'int?' },
    effects: ['read:product.Template'],
    agent: true,
    handler: groupTemplatesHandler,
  }),
  getTemplate: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      type: 'text',
      categoryId: 'id?',
      tagIds: 'json?',
      comboIds: 'json?',
      brandId: 'id?',
      uomId: 'id?',
      origin: 'text?',
      description: 'text?',
      summaryDoc: 'text?',
      descriptionDoc: 'text?',
      revisionId: 'text?',
      listPrice: 'decimal',
      saleOk: 'bool',
      saleVariantMode: 'text?',
      purchaseOk: 'bool',
      saleDelay: 'int?',
      saleWarning: 'text?',
      active: 'bool?',
      variants: 'json?',
      category: 'json?',
      uoms: 'json?',
      attributeLines: 'json?',
      brand: 'json?',
    },
    effects: [
      'read:product.Template',
      'read:product.TemplateTag',
      'read:product.TemplateCombo',
      'read:product.Product',
      'read:product.Category',
      'read:product.Brand',
      'read:product.TemplateUom',
      'read:product.TemplateAttributeLine',
    ],
    agent: true,
    handler: getTemplateHandler,
  }),
  saveTemplate: saveTemplateFunction(),
  deleteTemplates: defineFn({
    input: { ids: 'json' },
    output: { deleted: 'int' },
    effects: [
      'read:product.ComboItem',
      'read:product.TemplateCombo',
      'write:product.TemplateCombo',
      'read:product.Template',
      'read:product.TemplateTag',
      'write:product.TemplateTag',
      'read:product.Product',
      'read:product.Cost',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.ProductValue',
      'write:product.Template',
      'write:product.Product',
      'write:product.Cost',
      'write:product.TemplateUom',
      'write:product.ProductUom',
      'write:product.TemplateAttributeLine',
      'write:product.TemplateAttributeValue',
      'write:product.ProductValue',
    ],
    idempotent: true,
    agent: true,
    handler: deleteTemplatesHandler,
  }),
}
