import { comboRefusal } from '../../product/combo-policy.ts'
import { LotRefused, shelfLifeFields, shelfLifeInput, shelfLifePatch } from '../lot-policy.ts'
import { BARCODE_EFFECTS, barcodeFailure, claimBarcode } from '../../product/barcodes.ts'
import {
  claimStockConfiguration,
  hasPhysicalStock,
  stockLocked,
  stockPositionEffects,
} from '../../product/stock-policy.ts'
import { changeTemplateState, lifecycleEffects } from '../../product/lifecycle.ts'
import { productCodeFailure, productCodePatch } from '../../product/codes.ts'
import { TRACKING } from '../types.ts'
import { invalid, n, companyKey, InventoryRefused, claimInventoryRevision } from '../inventory-validation.ts'
import { defineFn, KetError, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'

export async function listStorableProductsHandler(ctx: Ctx) {
  const Template = ctx.table('product.Template')
  return ctx.db.all(
    from(Template).where(eq(Template.active, true)).where(eq(Template.isStorable, true)).preload('variants'),
  )
}

export async function getProductConfigHandler(ctx: Ctx, args: Row) {
  const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
  return template
    ? {
        templateId: args.templateId,
        isStorable: Boolean(template.isStorable),
        tracking: String(template.tracking ?? 'none'),
        ...Object.fromEntries(shelfLifeFields.map((field) => [field, template[field] ?? null])),
        inventoryRevision: n(template.inventoryRevision),
        revisionId: template.revisionId ?? 'initial',
      }
    : null
}

export async function listProductConfigsHandler(ctx: Ctx, args: Row) {
  const ids = [...new Set(Array.isArray(args.templateIds) ? args.templateIds.map(String) : [])]
  if (!ids.length) return []
  // Reading every template in the tenant to answer for twenty of them is the
  // shape a batch companion exists to avoid; getProductConfig above filters
  // in the query and so does this.
  const T = ctx.table('product.Template')
  return (await ctx.db.all(from(T).where(inArray(T.id, ids)))).map((template) => ({
    templateId: String(template.id),
    isStorable: Boolean(template.isStorable),
    tracking: String(template.tracking ?? 'none'),
    ...Object.fromEntries(shelfLifeFields.map((field) => [field, template[field] ?? null])),
    inventoryRevision: n(template.inventoryRevision),
    revisionId: template.revisionId ?? 'initial',
  }))
}

export async function configureProductHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const template = (await tx.db.select('product.Template', { id: args.templateId }))[0]
      if (!template) return invalid('templateId', 'template không tồn tại')
      if (
        template.type === 'combo' &&
        (args.isStorable ||
          String(args.tracking ?? 'none') !== 'none' ||
          Object.keys(shelfLifePatch(args)).length)
      )
        return comboRefusal('templateId', 'noStock')
      const tracking = String(args.tracking ?? 'none')
      if (!TRACKING.includes(tracking as never)) return invalid('tracking', `phải là: ${TRACKING.join(', ')}`)
      if (!args.isStorable && tracking !== 'none')
        return invalid('tracking', 'sản phẩm không lưu kho phải dùng tracking none')
      const fields = [
        ...(Boolean(template.isStorable) !== args.isStorable ? ['isStorable'] : []),
        ...(String(template.tracking ?? 'none') !== tracking ? ['tracking'] : []),
      ]
      const shelfLife = shelfLifePatch(args)
      const datesChanged = Object.keys(shelfLife).some(
        (field) => shelfLife[field] !== (template[field] ?? null),
      )
      if (!fields.length && !datesChanged) return { ok: true, templateId: args.templateId }
      await claimStockConfiguration(tx, template)
      const products = await tx.db.select('product.Product', { templateId: template.id })
      if (
        fields.length &&
        (await hasPhysicalStock(
          tx,
          products.map((product) => String(product.id)),
        ))
      )
        throw new InventoryRefused(stockLocked(fields))
      await tx.db.update(
        'product.Template',
        { id: args.templateId },
        { isStorable: args.isStorable, tracking, ...shelfLife },
      )
      return { ok: true, templateId: args.templateId }
    })
  } catch (error) {
    if (error instanceof InventoryRefused || error instanceof LotRefused) return error.result
    throw error
  }
}

export async function saveInventoryProductHandler(ctx: Ctx, args: Row) {
  const name = String(args.name ?? '').trim()
  const sku = args.sku == null || String(args.sku).trim() === '' ? null : String(args.sku).trim()
  const barcode =
    args.barcode == null || String(args.barcode).trim() === '' ? null : String(args.barcode).trim()
  const kind = String(args.kind)
  const tracking = String(args.tracking)
  if (!name || name.length > 200) return invalid('name', 'name needs 1 to 200 characters')
  if (barcode && barcode.length > 100) return invalid('barcode', 'barcode cannot exceed 100 characters')
  if (!['storable', 'consumable'].includes(kind))
    return invalid('kind', 'kind must be storable or consumable')
  if (!TRACKING.includes(tracking as never))
    return invalid('tracking', `tracking must be: ${TRACKING.join(', ')}`)
  if (kind !== 'storable' && tracking !== 'none')
    return invalid('tracking', 'a consumable product must use tracking none')
  if (args.pointOfSale !== args.saleOk)
    return invalid('pointOfSale', 'point of sale currently follows sales eligibility')
  if (n(args.salePrice) < 0 || n(args.cost) < 0)
    return invalid('salePrice', 'sale price and cost cannot be negative')
  if (!(await ctx.db.select('uom.Unit', { id: args.uomId }))[0])
    return invalid('uomId', 'unit of measure does not exist')
  if (args.categoryId && !(await ctx.db.select('product.Category', { id: args.categoryId }))[0])
    return invalid('categoryId', 'product category does not exist')
  try {
    await ctx.tx(async (tx) => {
      const product = (await tx.db.select('product.Product', { id: args.id }))[0]
      const template = product
        ? (await tx.db.select('product.Template', { id: product.templateId }))[0]
        : (await tx.db.select('product.Template', { id: args.templateId }))[0]
      if (template?.type === 'combo') throw new InventoryRefused(comboRefusal('templateId', 'noStock'))
      if (args.create && product && template) return
      const code = await productCodePatch(tx, product, sku, { field: 'sku', required: Boolean(args.create) })
      const barcodePatch = await claimBarcode(tx, { kind: 'variant', id: String(args.id) }, product, barcode)
      if (args.create) {
        if (product || template)
          throw new InventoryRefused(invalid('id', 'product identity is already in use'))
        await tx.db.insert('product.Template', {
          id: args.templateId,
          name,
          type: 'goods',
          categoryId: args.categoryId ?? null,
          uomId: args.uomId,
          description: null,
          listPrice: args.salePrice,
          saleOk: args.saleOk,
          purchaseOk: args.purchaseOk,
          active: true,
          isStorable: kind === 'storable',
          tracking,
          inventoryRevision: 0,
        })
        await tx.db.insert('product.Product', {
          id: args.id,
          templateId: args.templateId,
          ...code,
          ...barcodePatch,
          weight: '0',
          volume: '0',
          combinationKey: `manual:${String(args.id)}`,
          active: true,
        })
      } else {
        if (!product || !template)
          throw new InventoryRefused(invalid('id', 'inventory product does not exist'))
        if (args.expectedRevision === undefined)
          throw new InventoryRefused(invalid('expectedRevision', 'product version is required'))
        if (!(await claimInventoryRevision(tx, template, args.expectedRevision)))
          throw new InventoryRefused(invalid('expectedRevision', 'inventory product changed'))
        const stockFields = [
          ...(Boolean(template.isStorable) !== (kind === 'storable') ? ['kind'] : []),
          ...(String(template.tracking ?? 'none') !== tracking ? ['tracking'] : []),
        ]
        if (stockFields.length) {
          const variants = await tx.db.select('product.Product', { templateId: template.id })
          if (
            await hasPhysicalStock(
              tx,
              variants.map((variant) => String(variant.id)),
            )
          )
            throw new InventoryRefused(stockLocked(stockFields))
        }
        await tx.db.update(
          'product.Template',
          { id: template.id },
          {
            name,
            categoryId: args.categoryId ?? null,
            uomId: args.uomId,
            listPrice: args.salePrice,
            saleOk: args.saleOk,
            purchaseOk: args.purchaseOk,
            isStorable: kind === 'storable',
            tracking,
          },
        )
        await tx.db.update('product.Product', { id: product.id }, { ...code, ...barcodePatch })
      }
      if (args.cost != null) {
        const costId = companyKey(tx, args.id)
        const existingCost = (await tx.db.select('product.Cost', { id: costId }))[0]
        if (
          (!existingCost || Number(existingCost.standardPrice) !== Number(args.cost)) &&
          (await hasPhysicalStock(tx, [String(args.id)]))
        )
          throw new InventoryRefused(stockLocked(['cost']))
        if (existingCost) await tx.db.update('product.Cost', { id: costId }, { standardPrice: args.cost })
        else
          await tx.db.insert('product.Cost', {
            id: costId,
            productId: args.id,
            standardPrice: args.cost,
          })
      }
      await tx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
    })
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    const refused = productCodeFailure(error, 'sku') ?? barcodeFailure(error)
    if (refused) return refused
    throw error
  }
  const product = (await ctx.db.select('product.Product', { id: args.id }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return {
    ok: true,
    id: args.id,
    templateId: template?.id ?? args.templateId,
    revision: n(template?.inventoryRevision),
  }
}

export async function setInventoryProductActiveHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const product = (await tx.db.select('product.Product', { id: args.id }))[0]
      const template = product && (await tx.db.select('product.Template', { id: product.templateId }))[0]
      if (!product || !template) throw new InventoryRefused(invalid('id', 'inventory product does not exist'))
      if (Boolean(template.active) === args.active)
        throw new InventoryRefused(invalid('active', 'inventory product is already in that state'))
      if (
        n(template.inventoryRevision) !== args.expectedRevision ||
        (args.expectedRevisionId != null && args.expectedRevisionId !== (template.revisionId ?? 'initial'))
      )
        throw new InventoryRefused(invalid('expectedRevision', 'inventory product changed'))
      const result = await changeTemplateState(tx, {
        id: template.id,
        active: args.active,
        reason: args.reason,
        locale: args.locale,
        expectedRevisionId: template.revisionId ?? 'initial',
        confirmed: true,
      })
      if (!result.ok) throw new InventoryRefused(result)
      return { ok: true, id: args.id, revision: n(template.inventoryRevision) + 1 }
    })
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    if (error instanceof KetError && ['conflict', 'notFound'].includes(error.code))
      return invalid('active', error.message)
    throw error
  }
}

export async function deleteInventoryProductHandler(ctx: Ctx, args: Row) {
  try {
    await ctx.tx(async (tx) => {
      const product = (await tx.db.select('product.Product', { id: args.id }))[0]
      const template = product && (await tx.db.select('product.Template', { id: product.templateId }))[0]
      if (!product || !template) throw new InventoryRefused(invalid('id', 'inventory product does not exist'))
      if (!(await claimInventoryRevision(tx, template, args.expectedRevision)))
        throw new InventoryRefused(invalid('expectedRevision', 'inventory product changed'))
      const variants = await tx.db.select('product.Product', { templateId: template.id })
      for (const variant of variants) {
        if ((await ours(tx, 'stock.Quant', { productId: variant.id })).length)
          throw new InventoryRefused(invalid('id', 'a product with stock history cannot be deleted'))
        if ((await ours(tx, 'stock.Move', { productId: variant.id })).length)
          throw new InventoryRefused(invalid('id', 'a product with movement history cannot be deleted'))
      }
      const ProductValue = tx.table('product.ProductValue')
      const ProductUom = tx.table('product.ProductUom')
      const Cost = tx.table('product.Cost')
      const Line = tx.table('product.TemplateAttributeLine')
      const Value = tx.table('product.TemplateAttributeValue')
      const TemplateUom = tx.table('product.TemplateUom')
      const Product = tx.table('product.Product')
      const Template = tx.table('product.Template')
      const productIds = variants.map((variant) => String(variant.id))
      const lines = await tx.db.select('product.TemplateAttributeLine', {
        templateId: template.id,
      })
      const lineIds = lines.map((line) => String(line.id))
      if (productIds.length) {
        await tx.db.del(deleteFrom(ProductValue).where(inArray(ProductValue.productId, productIds)))
        await tx.db.del(deleteFrom(ProductUom).where(inArray(ProductUom.productId, productIds)))
        await tx.db.del(deleteFrom(Cost).where(inArray(Cost.productId, productIds)))
      }
      if (lineIds.length) await tx.db.del(deleteFrom(Value).where(inArray(Value.lineId, lineIds)))
      await tx.db.del(deleteFrom(Line).where(eq(Line.templateId, String(template.id))))
      await tx.db.del(deleteFrom(TemplateUom).where(eq(TemplateUom.templateId, String(template.id))))
      if (productIds.length) await tx.db.del(deleteFrom(Product).where(inArray(Product.id, productIds)))
      const deleted = await tx.db.del(deleteFrom(Template).where(eq(Template.id, String(template.id))))
      if (deleted.changes !== 1)
        throw new InventoryRefused(invalid('id', 'inventory product could not be deleted'))
    })
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    throw error
  }
  return { ok: true, id: args.id, deleted: true }
}

export const productsFunctions: Record<string, FnSpec> = {
  listStorableProducts: defineFn({
    input: {},
    effects: ['read:product.Template', 'read:product.Product'],
    agent: true,
    handler: listStorableProductsHandler,
  }),

  getProductConfig: defineFn({
    input: { templateId: 'id' },
    output: {
      templateId: 'id',
      isStorable: 'bool',
      tracking: 'text',
      ...shelfLifeInput,
      inventoryRevision: 'int',
      revisionId: 'text',
    },
    effects: ['read:product.Template'],
    agent: true,
    handler: getProductConfigHandler,
  }),

  /** Batch companion to getProductConfig for bounded catalogue projections. */

  listProductConfigs: defineFn({
    input: { templateIds: 'json' },
    effects: ['read:product.Template'],
    agent: true,
    handler: listProductConfigsHandler,
  }),

  configureProduct: defineFn({
    input: { templateId: 'id', isStorable: 'bool', tracking: 'text?', ...shelfLifeInput },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'write:product.Template',
      'read:product.Product',
      ...stockPositionEffects,
    ],
    idempotent: true,
    agent: true,
    handler: configureProductHandler,
  }),

  saveInventoryProduct: defineFn({
    input: {
      id: 'id',
      templateId: 'id',
      create: 'bool?',
      expectedRevision: 'int?',
      name: 'text',
      kind: 'text',
      uomId: 'id',
      categoryId: 'id?',
      salePrice: 'decimal',
      // Absent leaves the cost as it is, and a new product without one has no cost yet.
      cost: 'decimal?',
      saleOk: 'bool',
      purchaseOk: 'bool',
      pointOfSale: 'bool',
      tracking: 'text',
      sku: 'text?',
      barcode: 'text?',
    },
    output: { ok: 'bool', id: 'id?', templateId: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      ...BARCODE_EFFECTS,
      ...stockPositionEffects,
      'read:product.Template',
      'write:product.Template',
      'read:product.Product',
      'write:product.Product',
      'read:product.Cost',
      'write:product.Cost',
      'read:product.Category',
      'read:uom.Unit',
      'write:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: saveInventoryProductHandler,
  }),

  setInventoryProductActive: defineFn({
    input: {
      id: 'id',
      active: 'bool',
      expectedRevision: 'int',
      expectedRevisionId: 'text?',
      reason: 'text?',
      locale: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: lifecycleEffects,
    idempotent: true,
    agent: true,
    handler: setInventoryProductActiveHandler,
  }),

  /**
   * Withheld from the public surface until it can refuse a referenced product.
   *
   * The guard below sees stock history and nothing else, because this module
   * cannot read sale, purchase or account tables. A product named only by a
   * draft quotation therefore passes it, and deleting one leaves the order line
   * pointing at a row that no longer exists — proven, not supposed. Until the
   * reference check exists this stays off HTTP and off the agent surface, where
   * it would answer without even the channel's CSRF and rate limit.
   */

  deleteInventoryProduct: defineFn({
    exposure: 'internal',
    input: { id: 'id', expectedRevision: 'int' },
    output: { ok: 'bool', id: 'id?', deleted: 'bool?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'write:product.Template',
      'read:product.Product',
      'write:product.Product',
      'read:product.Cost',
      'write:product.Cost',
      'read:product.TemplateUom',
      'write:product.TemplateUom',
      'read:product.ProductUom',
      'write:product.ProductUom',
      'read:product.TemplateAttributeLine',
      'write:product.TemplateAttributeLine',
      'read:product.TemplateAttributeValue',
      'write:product.TemplateAttributeValue',
      'read:product.ProductValue',
      'write:product.ProductValue',
      'read:stock.Quant',
      'read:stock.Move',
    ],
    idempotent: true,
    handler: deleteInventoryProductHandler,
  }),
}
