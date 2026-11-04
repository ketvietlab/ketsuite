import {
  lockSupplierTemplate,
  supplierIssue,
  supplierRowsKey,
  supplierRows,
  SupplierRefused,
  touchSupplierTemplate,
} from '../product-supplier-policy.ts'
import { defineFn, type Ctx, type FnSpec } from '@ketvietlab/ketjs'
import { compareDecimals } from '../../account/money.ts'
import { PURCHASE_METHODS } from '../types.ts'
import { invalid, n, inUnit } from './shared.ts'

export function listSupplierInfoHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.db.select('purchase.SupplierInfo', {
    ...(args.partnerId ? { partnerId: args.partnerId } : {}),
    ...(args.productId ? { productId: args.productId } : {}),
  })
}

export async function saveSupplierInfoHandler(ctx: Ctx, args: Record<string, unknown>) {
  try {
    return await ctx.tx(async (tx) => {
      // The vendor first, then the product: the form reports its fields in that order.
      if (!(await tx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'vendor does not exist')
      // This form names the product `productTemplateId`; the refusal must point at that field.
      const lockedTemplate = await lockSupplierTemplate(tx, args.productTemplateId, 'productTemplateId')
      const held = (await tx.db.select('purchase.SupplierInfo', { id: args.id }))[0]
      if (held && held.productTemplateId !== args.productTemplateId) return supplierIssue('ownership')
      if (!held && (await supplierRows(tx, args.productTemplateId)).length >= 20)
        return supplierIssue('limit')

      const template = (await tx.db.select('product.Template', { id: args.productTemplateId }))[0]
      if (!template) return invalid('productTemplateId', 'product template does not exist')
      if (args.productId) {
        const product = (await tx.db.select('product.Product', { id: args.productId }))[0]
        if (!product || product.templateId !== args.productTemplateId)
          return invalid('productId', 'variant does not belong to the template')
      }
      if (!(await tx.db.select('uom.Unit', { id: args.productUomId }))[0])
        return invalid('productUomId', 'unit of measure does not exist')
      // A price per kilogram for a product counted in pieces can never be
      // applied to an order line, so the row would sit in the pricelist and
      // silently match nothing.
      if ((await inUnit(tx, 1, args.productUomId, template.uomId)) === null)
        return invalid('productUomId', 'unit does not measure the same thing as the product')
      if (
        n(args.minQty) < 0 ||
        compareDecimals(args.price, '0') < 0 ||
        compareDecimals(args.discount ?? '0', '0') < 0 ||
        compareDecimals(args.discount ?? '0', '100') > 0 ||
        n(args.delay) < 0 ||
        n(args.delay) > 365 ||
        [...String(args.productCode ?? '')].length > 40
      )
        return invalid('price', 'quantity, price, discount and lead time must be valid non-negative values')
      if (args.dateStart && args.dateEnd && String(args.dateEnd) < String(args.dateStart))
        return invalid('dateEnd', 'the validity period ends before it starts')
      const existing = (await tx.db.select('purchase.SupplierInfo', { id: args.id }))[0]
      const values = {
        ...args,
        minQty: args.minQty ?? '0',
        discount: args.discount ?? '0',
        delay: args.delay ?? 1,
        sequence: args.sequence ?? 1,
      }
      const cs = tx
        .change('purchase.SupplierInfo', values, existing ?? null)
        .cast([
          'id',
          'partnerId',
          'productTemplateId',
          'productId',
          'productUomId',
          'productName',
          'productCode',
          'minQty',
          'price',
          'discount',
          'delay',
          'sequence',
          'dateStart',
          'dateEnd',
        ])
        .required(['partnerId', 'productTemplateId', 'productUomId', 'price'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await tx.db.commit(cs, existing ? { id: args.id } : undefined)
      const after = (await tx.db.select('purchase.SupplierInfo', { id: args.id }))[0]!
      if (supplierRowsKey(held ? [held] : []) !== supplierRowsKey([after]))
        await touchSupplierTemplate(tx, lockedTemplate)
      return { ok: true, id: args.id }
    })
  } catch (error) {
    if (error instanceof SupplierRefused) return error.result
    throw error
  }
}

export async function setPurchaseMethodHandler(ctx: Ctx, args: Record<string, unknown>) {
  if (!PURCHASE_METHODS.includes(args.purchaseMethod as never))
    return invalid('purchaseMethod', 'must be purchase or receive')
  if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
    return invalid('templateId', 'product template does not exist')
  await ctx.db.update('product.Template', { id: args.templateId }, { purchaseMethod: args.purchaseMethod })
  return { ok: true, id: args.templateId }
}

export const suppliersFunctions: Record<string, FnSpec> = {
  listSupplierInfo: defineFn({
    input: { partnerId: 'id?', productId: 'id?' },
    effects: ['read:purchase.SupplierInfo'],
    agent: true,
    handler: listSupplierInfoHandler,
  }),
  saveSupplierInfo: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      productTemplateId: 'id',
      productId: 'id?',
      productUomId: 'id',
      productName: 'text?',
      productCode: 'text?',
      minQty: 'decimal?',
      price: 'decimal',
      discount: 'decimal?',
      delay: 'int?',
      sequence: 'int?',
      dateStart: 'datetime?',
      dateEnd: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:partner.Partner',
      'read:product.Template',
      'write:product.Template',
      'read:product.Product',
      'read:uom.Unit',
      'read:purchase.SupplierInfo',
      'write:purchase.SupplierInfo',
    ],
    idempotent: true,
    agent: true,
    handler: saveSupplierInfoHandler,
  }),
  setPurchaseMethod: defineFn({
    input: { templateId: 'id', purchaseMethod: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Template', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: setPurchaseMethodHandler,
  }),
}
