// The record-modal context for a product template (KetSuite record-modal contract).
//
// The catalogue collection opens a template — and its create action — in a
// client-side modal. One permission-checked read hands that modal the General and
// Variants tabs need: the record or its defaults, the option lists their fields
// offer, the template's attributes-and-variants setup, and what the viewer may do.
// Media (the gallery, uploads) and the description's rich-text controller stay on
// the server-rendered detail page for now — this context does not answer for them.

import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { recordIslandsFor, recordTabsFor } from './product-record-tabs.ts'
import { TEMPLATE_RECORD_LABELS } from './template-record-labels.ts'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../user/authorization.ts'
import { PRODUCT_TYPES } from './types.ts'
import { variantSetupOf } from './variant-setup.ts'
import { hasProductMedia, templateImagesOf } from './record-images.ts'

type Lang = 'vi' | 'en'
type Can = (fn: string) => boolean

/** Message prefixes the product views read. */
const MESSAGE_PREFIXES = ['product_backend.', 'product.', 'backend.relation.']

const messagesFor = (ctx: Ctx, lang: Lang): Record<string, string> => {
  const catalog = ctx.manifest.messages?.[lang] ?? {}
  const out: Record<string, string> = {}
  for (const [key, message] of Object.entries(catalog)) {
    if (!MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    out[key] =
      typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key)
  }
  return out
}

const readEffects = AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:'))

/** What the actor may call. A superuser (null) may call everything; no actor, nothing. */
const permissionCheck = async (ctx: Ctx): Promise<Can> => {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  return (fn) => allowed === null || allowed.includes(fn)
}

const byName = (a: Row, b: Row) =>
  String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id))

const options = (rows: Row[]): Row[] =>
  rows.map((row) => ({ value: String(row.id), label: String(row.name ?? row.id) })).sort(byName)

const newTemplateRecord = (): Row => ({
  id: '',
  name: '',
  type: 'goods',
  categoryId: null,
  brandId: null,
  uomId: null,
  origin: null,
  description: null,
  listPrice: '0',
  saleOk: true,
  purchaseOk: true,
  defaultCode: null,
  barcode: null,
  active: true,
  isStorable: false,
  tracking: 'none',
  compareAtPrice: null,
  hsCode: null,
  weight: null,
  volume: null,
  costPrice: null,
})

const decimalOrNull = (value: unknown): string | null =>
  value === null || value === undefined || String(value).trim() === '' ? null : String(value)

/** A measure reads empty until someone sets it: a stored 0 is the column's default, not a weight. */
const measureOf = (value: unknown): string | null => {
  const text = decimalOrNull(value)
  return text === null || Number(text) === 0 ? null : text
}

type UnitRow = { id: string; name: string; parentPath: string; absoluteFactor: number; active: boolean }

const unitRowsOf = (rows: Row[]): UnitRow[] =>
  rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? row.id),
    parentPath: String(row.parentPath ?? ''),
    absoluteFactor: Number(row.absoluteFactor ?? 1) || 1,
    active: row.active !== false,
  }))

const rootOf = (unit: UnitRow): string => unit.parentPath.split('/').filter(Boolean)[0] ?? unit.id

/**
 * Unit choices name what a derived unit counts (Hộp 6 · 6 Chai); an archived unit stays
 * offered while the product still uses it, so the select keeps the stored value.
 */
const unitChoices = (units: UnitRow[], current: string | null, lang: Lang) => {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const format = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'vi-VN', { maximumFractionDigits: 3 })
  return units
    .filter((unit) => unit.active || unit.id === current)
    .map((unit) => {
      const root = byId.get(rootOf(unit))
      return {
        value: unit.id,
        label:
          root && root.id !== unit.id
            ? `${unit.name} · ${format.format(unit.absoluteFactor / root.absoluteFactor)} ${root.name}`
            : unit.name,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
}

/**
 * The product's packagings: the units linked to it, which sales, purchases and the
 * till offer besides its own unit (`sellableProduct`). Each counts in the product's
 * unit (Hộp 6 chai = 6 Chai); `barcode` is the default variant's in that unit.
 */
const packagingsOf = (
  units: UnitRow[],
  uomId: string | null,
  linked: string[],
  barcodeOf: (uomId: string) => string | null,
) => {
  const unit = units.find((row) => row.id === uomId)
  if (!unit) return []
  return units
    .filter((row) => linked.includes(row.id) && row.id !== unit.id && rootOf(row) === rootOf(unit))
    .map((row) => ({
      id: row.id,
      name: row.name,
      quantity: row.absoluteFactor / unit.absoluteFactor,
      active: row.active,
      barcode: barcodeOf(row.id),
    }))
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name))
}

/** Units a product may still take as a packaging: active, in its unit's tree, not yet linked. */
const packagingChoicesOf = (units: UnitRow[], uomId: string | null, linked: string[], lang: Lang) => {
  const unit = units.find((row) => row.id === uomId)
  if (!unit) return []
  const format = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'vi-VN', { maximumFractionDigits: 3 })
  return units
    .filter(
      (row) => row.active && row.id !== unit.id && !linked.includes(row.id) && rootOf(row) === rootOf(unit),
    )
    .map((row) => ({
      value: row.id,
      label: `${row.name} · ${format.format(row.absoluteFactor / unit.absoluteFactor)} ${unit.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
}

export const productModalContextFunctions: Record<string, FnSpec> = {
  templateModalContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: [
      ...readEffects,
      'read:product.Template',
      'read:product.Product',
      'read:product.ProductValue',
      'read:product.Category',
      'read:product.Brand',
      'read:uom.Unit',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'read:product.AttributeValue',
      'read:product.Attribute',
      'read:product_media.Media',
      'read:product.Cost',
    ],
    handler: async (ctx, args) => {
      const can = await permissionCheck(ctx)
      // Stock is not a dependency of `product`, so its function may simply not be registered.
      // The sales tax is not on this page: accounting sets it.
      const hasStock = Boolean(ctx.manifest.functions['stock.configureProduct'])
      const permissions = {
        save: can('product.saveTemplate'),
        archive: can('product.archiveTemplate'),
        delete: can('product.deleteTemplates'),
        saveVariantSetup: can('product.saveVariantSetup'),
        configureAttributes: can('product.configureAttributes'),
        duplicate: can('product.duplicateTemplate'),
        saveVariant: can('product.saveVariant'),
        // Costs and margins are for whoever may read the company's costs.
        money: can('product.listVariantCosts'),
        createAttribute: can('product.saveAttributeDraft'),
        setCost: can('product.setCost'),
        setProductUom: can('product.setProductUom'),
        addPackaging: can('product.addTemplateUom'),
        removePackaging: can('product.removeTemplateUom'),
        packagingBarcodes: can('product.setPackagingBarcodes'),
        // Images are served by the product's own route, to whoever may read one there.
        viewImages: hasProductMedia(ctx) && can('product_media.getMediaAttachment'),
        // An image is two calls — the upload stores an attachment, then the gallery
        // links it — so the viewer needs both, and the gallery module composed at all.
        uploadImage:
          hasProductMedia(ctx) && can('storage.createAttachment') && can('product_media.attachMedia'),
        removeImage: hasProductMedia(ctx) && can('product_media.removeMedia'),
        configureStock: hasStock && can('stock.configureProduct'),
      }
      const creating = !args.id
      // The modal answers a create form only to whoever may save one, and an
      // existing template only to whoever may read it — the same split the
      // catalogue route enforced.
      if (creating ? !permissions.save : !can('product.getTemplate')) return null
      const record = creating
        ? newTemplateRecord()
        : (await ctx.db.select('product.Template', { id: args.id }))[0]
      if (!record) return null
      const [categoryRows, unitRows, brandRows] = await Promise.all([
        ctx.db.select('product.Category'),
        ctx.db.select('uom.Unit'),
        ctx.db.select('product.Brand', { active: true }),
      ])
      const products = creating ? [] : await ctx.db.select('product.Product', { templateId: args.id })
      const defaultVariant = products.find((product) => String(product.combinationKey ?? '') === '')
      // Archived combinations do not count: once every variant is archived the
      // default one sells again, and General shows its code and barcode.
      const sellingVariants = products.filter(
        (product) => String(product.combinationKey ?? '') !== '' && product.active !== false,
      )
      // Anyone who may not see images is shown none, rather than a broken picture for each.
      const seesImages = permissions.viewImages
      const setup = creating ? null : await variantSetupOf(ctx, String(args.id))
      const variantSetup =
        setup && !seesImages
          ? { ...setup, variants: setup.variants.map((variant) => ({ ...variant, images: [] })) }
          : setup
      const images = creating || !seesImages ? [] : await templateImagesOf(ctx, String(args.id))
      const lang: Lang = args.locale === 'en' ? 'en' : 'vi'
      const company = ctx.scope.company
      // Costs are per company; a read spans every readable company, so keep the active one's.
      const costs = new Map(
        permissions.money && company && products.length
          ? (await ctx.db.select('product.Cost'))
              .filter((row) => String(row.companyId) === company)
              .map((row) => [String(row.productId), decimalOrNull(row.standardPrice)])
          : [],
      )
      const units = unitRowsOf(unitRows)
      const uomId = record.uomId == null ? null : String(record.uomId)
      const linked = creating
        ? []
        : (await ctx.db.select('product.TemplateUom', { templateId: args.id })).map((row) =>
            String(row.uomId),
          )
      // A barcode in a packaging belongs to the active company, like costs.
      const unitBarcodes = new Map<string, Map<string, string>>()
      if (company && linked.length)
        for (const product of products)
          for (const row of await ctx.db.select('product.ProductUom', { productId: product.id }))
            if (String(row.companyId) === company && row.barcode)
              unitBarcodes.set(
                String(product.id),
                (unitBarcodes.get(String(product.id)) ?? new Map()).set(
                  String(row.uomId),
                  String(row.barcode),
                ),
              )
      const listPrice = Number(record.listPrice ?? 0)
      const extras = new Map(
        (variantSetup?.lines ?? []).flatMap((line) =>
          line.values.map((value) => [value.valueId, Number(value.priceExtra || 0)] as const),
        ),
      )
      const valueNames = new Map(
        (variantSetup?.lines ?? []).flatMap((line) =>
          line.values.map((value) => [value.valueId, value.name] as const),
        ),
      )
      const lineOrder = (variantSetup?.lines ?? []).map((line) => line.attributeId)
      const position = new Map(
        (variantSetup?.lines ?? []).flatMap((line) =>
          line.values.map((value, index) => [value.valueId, index] as const),
        ),
      )
      // Selling variants first, then in the order of the attribute lines and their values (30 ml before 50 ml).
      const rank = (valueIds: Record<string, string>) =>
        lineOrder.map((attributeId) => position.get(valueIds[attributeId] ?? '') ?? Number.MAX_SAFE_INTEGER)
      const ordered = [...(variantSetup?.variants ?? [])].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        const [left, right] = [rank(a.valueIds), rank(b.valueIds)]
        const at = left.findIndex((value, index) => value !== right[index])
        return at === -1 ? a.id.localeCompare(b.id) : left[at]! - right[at]!
      })
      const variants = ordered.map((variant) => {
        const chosen = lineOrder
          .map((attributeId) => variant.valueIds[attributeId])
          .filter(Boolean) as string[]
        return {
          id: variant.id,
          label:
            chosen.map((valueId) => valueNames.get(valueId) ?? valueId).join(' / ') ||
            variant.defaultCode ||
            variant.id,
          defaultCode: variant.defaultCode,
          barcode: variant.barcode,
          weight: measureOf(variant.weight),
          volume: measureOf(variant.volume),
          active: variant.active,
          price: String(listPrice + chosen.reduce((sum, valueId) => sum + (extras.get(valueId) ?? 0), 0)),
          costPrice: permissions.money ? (costs.get(variant.id) ?? null) : null,
          image: variant.images[0]?.attachmentId ?? null,
          packagingBarcodes: Object.fromEntries(unitBarcodes.get(variant.id) ?? []),
        }
      })
      return {
        data: {
          record: {
            id: String(record.id ?? ''),
            revisionId: String(record.revisionId ?? 'initial'),
            name: String(record.name ?? ''),
            type: String(record.type ?? 'goods'),
            categoryId: record.categoryId == null ? null : String(record.categoryId),
            brandId: record.brandId == null ? null : String(record.brandId),
            uomId: record.uomId == null ? null : String(record.uomId),
            origin: record.origin == null ? null : String(record.origin),
            description: record.description == null ? null : String(record.description),
            listPrice: String(record.listPrice ?? '0'),
            saleOk: record.saleOk !== false,
            purchaseOk: record.purchaseOk !== false,
            defaultCode: defaultVariant?.defaultCode ? String(defaultVariant.defaultCode) : null,
            barcode: defaultVariant?.barcode ? String(defaultVariant.barcode) : null,
            active: record.active !== false,
            isStorable: hasStock ? record.isStorable === true : false,
            tracking: hasStock ? String(record.tracking ?? 'none') : 'none',
            compareAtPrice: decimalOrNull(record.compareAtPrice),
            hsCode: record.hsCode == null ? null : String(record.hsCode),
            weight: measureOf(defaultVariant?.weight),
            volume: measureOf(defaultVariant?.volume),
            costPrice:
              permissions.money && defaultVariant ? (costs.get(String(defaultVariant.id)) ?? null) : null,
            defaultVariantId: defaultVariant ? String(defaultVariant.id) : null,
            updatedAt:
              record.updatedAt instanceof Date
                ? record.updatedAt.toISOString()
                : record.updatedAt == null
                  ? null
                  : String(record.updatedAt),
          },
          images,
          hasVariants: sellingVariants.length > 0,
          variantSetup,
          types: [...PRODUCT_TYPES],
          categories: options(categoryRows),
          uoms: unitChoices(units, uomId, lang),
          // The unit's own name, which quantities on the page are counted in.
          uomName: units.find((unit) => unit.id === uomId)?.name ?? null,
          packagings: creating
            ? []
            : packagingsOf(units, uomId, linked, (unit) =>
                defaultVariant ? (unitBarcodes.get(String(defaultVariant.id))?.get(unit) ?? null) : null,
              ),
          packagingChoices: creating ? [] : packagingChoicesOf(units, uomId, linked, lang),
          variants,
          brands: options(brandRows),
          stockEnabled: hasStock,
          permissions,
          lang,
          extensionTabs: creating ? [] : recordTabsFor(ctx, lang),
          collaboration: creating ? [] : recordIslandsFor(ctx, 'product_backend:template.collaboration', can),
        },
        messages: { ...messagesFor(ctx, lang), ...TEMPLATE_RECORD_LABELS[lang] },
      }
    },
  }),
}
