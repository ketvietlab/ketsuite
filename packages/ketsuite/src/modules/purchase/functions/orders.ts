import { createPurchaseDraft, insertPurchaseLine } from '../draft-write.ts'
import { defineFn, deleteFrom, eq, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { VARIANT_NAME_EFFECTS } from '../../product/functions/variants.ts'
import { invalid, n, PurchaseRefused, claimRevision } from './shared.ts'

export function createOrderHandler(ctx: Ctx, args: Record<string, unknown>) {
  return createPurchaseDraft(ctx, args)
}

export async function saveDraftHandler(ctx: Ctx, args: Record<string, unknown>) {
  const lines = Array.isArray(args.lines) ? (args.lines as Row[]) : []
  if (!args.create && args.expectedRevision === undefined)
    return invalid('expectedRevision', 'purchase order version is required')
  if (!lines.length || lines.length > 100) return invalid('lines', 'an RFQ needs 1 to 100 lines')
  if (
    lines.some(
      (line) =>
        !line ||
        typeof line !== 'object' ||
        !line.id ||
        !line.productId ||
        !line.productUomId ||
        !(n(line.productQty) > 0),
    )
  )
    return invalid('lines', 'every line needs a product, unit and positive quantity')

  try {
    await ctx.tx(async (tx) => {
      let order = (await tx.db.select('purchase.Order', { id: args.id }))[0]
      if (args.create && order) return
      if (!order) {
        if (!args.create) throw new PurchaseRefused(invalid('id', 'purchase order does not exist'))
        if (!args.pickingTypeId)
          throw new PurchaseRefused(invalid('pickingTypeId', 'receipt operation type is required'))
        const created = (await createPurchaseDraft(tx, {
          id: args.id,
          partnerId: args.partnerId,
          pickingTypeId: args.pickingTypeId,
        })) as Row
        if (created.ok !== true) throw new PurchaseRefused(created)
        order = (await tx.db.select('purchase.Order', { id: args.id }))[0]
      } else {
        if (order.state !== 'draft' || order.locked)
          throw new PurchaseRefused(invalid('state', 'only an unlocked RFQ can be updated'))
        if (!(await claimRevision(tx, order, args.expectedRevision)))
          throw new PurchaseRefused(invalid('expectedRevision', 'purchase order changed'))
      }
      if (!order) throw new PurchaseRefused(invalid('id', 'purchase order does not exist'))
      if (!(await tx.db.select('partner.Partner', { id: args.partnerId }))[0])
        throw new PurchaseRefused(invalid('partnerId', 'vendor does not exist'))
      if (!(await tx.db.select('partner.Role', { partnerId: args.partnerId, role: 'supplier' }))[0])
        throw new PurchaseRefused(invalid('partnerId', 'partner is not an active vendor'))

      await tx.db.update('purchase.Order', { id: args.id }, { partnerId: args.partnerId })
      const L = tx.table('purchase.OrderLine')
      await tx.db.del(deleteFrom(L).where(eq(L.orderId, String(args.id))))
      for (const [index, line] of lines.entries()) {
        const added = (await insertPurchaseLine(tx, {
          id: line.id,
          orderId: args.id,
          productId: line.productId,
          productQty: line.productQty,
          productUomId: line.productUomId,
          sequence: (index + 1) * 10,
        })) as Row
        if (added.ok !== true) throw new PurchaseRefused(added)
      }
    })
  } catch (error) {
    if (error instanceof PurchaseRefused) return error.result
    throw error
  }
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  return { ok: true, id: args.id, revision: n(order?.revision) }
}

export const ordersFunctions: Record<string, FnSpec> = {
  createOrder: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      partnerRef: 'text?',
      pickingTypeId: 'id',
      dateOrder: 'datetime?',
      datePlanned: 'datetime?',
      notes: 'text?',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:purchase.Sequence',
      'write:purchase.Sequence',
      'read:purchase.Order',
      'write:purchase.Order',
      'read:partner.Partner',
      'read:stock.PickingType',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: createOrderHandler,
  }),
  saveDraft: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      pickingTypeId: 'id?',
      lines: 'json',
      create: 'bool?',
      expectedRevision: 'int?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:purchase.Sequence',
      'write:purchase.Sequence',
      'read:purchase.Order',
      'write:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'read:purchase.SupplierInfo',
      'read:partner.Partner',
      'read:partner.Role',
      'read:stock.PickingType',
      'read:product.Product',
      'read:product.Template',
      ...VARIANT_NAME_EFFECTS,
      'read:uom.Unit',
      'read:account.Tax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: saveDraftHandler,
  }),
}
