import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { quoteTaxLine } from '../../account/functions.ts'
import { compareDecimals } from '../../account/money.ts'
import { functions as pricingFunctions } from '../../pricing/functions.ts'
import { sellableProduct } from '../../product/sellable.ts'
import { functions as stockFunctions } from '../../stock/functions.ts'
import { appendAudit, claimDraftRevision, invalid, n, recompute, trackingAvailability } from './helpers.ts'

const trackingAvailabilityEffects = stockFunctions.trackedAvailability!.effects ?? []

export async function getLineTrackingAvailabilityHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  const line = (await ctx.db.select('pos.OrderLine', { id: args.lineId }))[0]
  return order && line?.orderId === order.id ? trackingAvailability(ctx, order, line) : null
}

export async function setLineLotSelectionsHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  const line = (await ctx.db.select('pos.OrderLine', { id: args.lineId }))[0]
  if (!order || !line || line.orderId !== order.id)
    return invalid('lineId', 'line does not belong to this order')
  if (order.state !== 'draft' || order.isRefund)
    return invalid('orderId', 'lot/serial selection is only editable on a new sale')
  if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
  if (!Array.isArray(args.selections)) return invalid('selections', 'selections must be an array')
  const availability = await trackingAvailability(ctx, order, line)
  const tracking = String(availability.tracking)
  if (tracking === 'none') return invalid('lineId', 'this product does not use lot/serial tracking')
  if (String(line.tracking ?? 'none') !== tracking)
    return invalid('tracking', 'product tracking changed; remove and add the line again')
  const selections = (args.selections as Row[]).map((selection) => ({
    lotId: String(selection.lotId ?? ''),
    quantity: n(selection.quantity),
    stockRevision: String(selection.stockRevision ?? ''),
  }))
  if (
    selections.some((selection) => !selection.lotId || !(selection.quantity > 0) || !selection.stockRevision)
  )
    return invalid('selections', 'every selection needs lotId, positive quantity and stockRevision')
  if (new Set(selections.map((selection) => selection.lotId)).size !== selections.length)
    return invalid('selections', 'a lot/serial can only be selected once per line')
  if (tracking === 'serial' && selections.some((selection) => selection.quantity !== 1))
    return invalid('selections', 'every selected serial must have quantity 1')
  if (
    Math.abs(
      selections.reduce((sum, selection) => sum + selection.quantity, 0) - n(availability.requiredQuantity),
    ) > 0.000001
  )
    return invalid('selections', 'selected quantity must equal line quantity in the product unit')
  const lots = new Map((availability.lots as Row[]).map((lot) => [String(lot.lotId), lot] as const))
  for (const selection of selections) {
    const lot = lots.get(selection.lotId)
    if (lot?.selectable !== true) return invalid('lotId', `lot/serial ${selection.lotId} is not selectable`)
    if (String(lot.stockRevision) !== selection.stockRevision)
      return invalid('stockRevision', 'stock position changed; reload lot availability')
    if (n(lot.availableQuantity) + 0.000001 < selection.quantity)
      return invalid('quantity', `insufficient stock for lot/serial ${selection.lotId}`)
  }
  const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.update('pos.OrderLine', { id: args.lineId }, { lotSelections: selections })
  return { ok: true, id: args.lineId, revision: claim.revision }
}

export async function addLineHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  if (order?.state !== 'draft' || order.isRefund)
    return invalid('orderId', 'products can only be added to a new non-refund order')
  if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
  if (compareDecimals(args.qty, '0') <= 0) return invalid('qty', 'quantity must be positive')
  const sellable = await sellableProduct(ctx, args.productId, args.productUomId)
  if (!sellable.ok)
    return invalid(sellable.field === 'uomId' ? 'productUomId' : sellable.field, sellable.message)
  const product = sellable.value
  const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!,
    discount = args.discount ?? '0'
  let priceUnit: unknown = args.priceUnit
  if (priceUnit === undefined && config.pricelistId) {
    const result = (await pricingFunctions.priceFor!.handler(ctx, {
      pricelistId: config.pricelistId,
      productId: args.productId,
      quantity: args.qty,
      uomId: args.productUomId,
      date: order.dateOrder,
    })) as Row
    if (result.ok !== true) return result
    priceUnit = result.price
  }
  priceUnit ??= product.template.listPrice
  if (
    compareDecimals(discount, '0') < 0 ||
    compareDecimals(discount, '100') > 0 ||
    compareDecimals(priceUnit, '0') < 0
  )
    return invalid('discount', 'price and discount are invalid')
  const taxIds = args.taxIds !== undefined ? args.taxIds : args.taxId ? [args.taxId] : undefined
  const quote = await quoteTaxLine(ctx, {
    productId: args.productId,
    taxIds,
    quantity: args.qty,
    priceUnit,
    discount,
  })
  if (quote.ok !== true) return quote
  const existing = (await ctx.db.select('pos.OrderLine', { id: args.id }))[0]
  if (existing) {
    const same =
      existing.orderId === args.orderId &&
      existing.productId === args.productId &&
      existing.productUomId === args.productUomId &&
      compareDecimals(existing.qty, args.qty) === 0 &&
      compareDecimals(existing.priceUnit, priceUnit) === 0 &&
      compareDecimals(existing.discount, discount) === 0 &&
      JSON.stringify(existing.taxIds ?? []) === JSON.stringify(quote.taxIds)
    return same
      ? { ok: true, id: args.id, priceUnit: String(priceUnit), revision: n(order.revision) }
      : invalid('id', 'line id is already used by a different command')
  }
  const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.insert('pos.OrderLine', {
    id: args.id,
    orderId: args.orderId,
    productId: args.productId,
    productUomId: args.productUomId,
    name: product.template.name,
    qty: args.qty,
    priceUnit: String(priceUnit),
    discount: String(discount),
    taxId: quote.taxIds[0] ?? null,
    taxIds: quote.taxIds,
    taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
    quoteRevision: args.quoteRevision ?? null,
    tracking: String(product.template.tracking ?? 'none'),
    lotSelections: [],
    affectsStock: product.template.type !== 'service',
    priceSubtotal: quote.amountUntaxed,
    priceSubtotalIncl: quote.amountTotal,
    refundedOrderlineId: null,
    sequence: 10,
  })
  await recompute(ctx, args.orderId)
  return { ok: true, id: args.id, priceUnit: String(priceUnit), revision: claim.revision }
}

export async function updateLineHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  const line = (await ctx.db.select('pos.OrderLine', { id: args.id }))[0]
  if (!line || line.orderId !== args.orderId) return invalid('id', 'line does not belong to this order')
  if (order?.state !== 'draft' || order.isRefund)
    return invalid('orderId', 'only a new non-refund order can be changed')
  if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
  if (compareDecimals(args.qty, '0') <= 0) return invalid('qty', 'quantity must be positive')
  const sellable = await sellableProduct(ctx, line.productId, line.productUomId)
  if (!sellable.ok) return invalid(sellable.field, sellable.message)
  const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]!
  let priceUnit: unknown = args.priceUnit
  if (priceUnit === undefined && config.pricelistId) {
    const priced = (await pricingFunctions.priceFor!.handler(ctx, {
      pricelistId: config.pricelistId,
      productId: line.productId,
      quantity: args.qty,
      uomId: line.productUomId,
      date: order.dateOrder,
    })) as Row
    if (priced.ok !== true) return priced
    priceUnit = priced.price
  }
  priceUnit ??= sellable.value.template.listPrice
  const discount = args.discount ?? line.discount
  if (
    compareDecimals(discount, '0') < 0 ||
    compareDecimals(discount, '100') > 0 ||
    compareDecimals(priceUnit, '0') < 0
  )
    return invalid('discount', 'price and discount are invalid')
  const taxIds = args.taxIds !== undefined ? args.taxIds : (line.taxIds ?? [])
  const quote = await quoteTaxLine(ctx, {
    productId: line.productId,
    taxIds,
    quantity: args.qty,
    priceUnit,
    discount,
  })
  if (quote.ok !== true) return quote
  const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.update(
    'pos.OrderLine',
    { id: args.id },
    {
      qty: args.qty,
      priceUnit: String(priceUnit),
      discount: String(discount),
      taxId: quote.taxIds[0] ?? null,
      taxIds: quote.taxIds,
      taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
      quoteRevision: args.quoteRevision ?? line.quoteRevision ?? null,
      overrideReason:
        args.priceUnit !== undefined || args.discount !== undefined
          ? (args.overrideReason ?? line.overrideReason ?? null)
          : (line.overrideReason ?? null),
      overrideBy:
        args.priceUnit !== undefined || args.discount !== undefined
          ? (args.overrideBy ?? line.overrideBy ?? null)
          : (line.overrideBy ?? null),
      priceSubtotal: quote.amountUntaxed,
      priceSubtotalIncl: quote.amountTotal,
      sequence: args.sequence ?? line.sequence,
    },
  )
  await recompute(ctx, args.orderId)
  if (args.priceUnit !== undefined || args.discount !== undefined)
    await appendAudit(ctx, {
      id: `order-line:${String(args.id)}:adjusted:${String(claim.revision)}`,
      subjectType: 'order',
      subjectId: String(args.orderId),
      configId: order.configId,
      sessionId: order.sessionId,
      action: 'order.line_adjusted',
      actorId: args.overrideBy,
      deviceId: order.deviceId,
      reason: args.overrideReason,
      relatedId: args.id,
      details: {
        previousPriceUnit: line.priceUnit,
        priceUnit: String(priceUnit),
        previousDiscount: line.discount,
        discount: String(discount),
        revision: claim.revision,
      },
    })
  return { ok: true, id: args.id, priceUnit: String(priceUnit), revision: claim.revision }
}

export async function removeLineHandler(ctx: Ctx, args: Row) {
  const line = (await ctx.db.select('pos.OrderLine', { id: args.id }))[0]
  if (!line) return invalid('id', 'line does not exist')
  if (line.orderId !== args.orderId) return invalid('id', 'line does not belong to this order')
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  if (order?.isRefund) return invalid('orderId', 'return lines are immutable')
  if (order?.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
  const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
  if (claim.ok !== true) return claim
  const L = ctx.table('pos.OrderLine')
  await ctx.db.del(deleteFrom(L).where(eq(L.id, String(args.id))))
  await recompute(ctx, args.orderId)
  return { ok: true, id: args.id, revision: claim.revision }
}

export async function reorderLinesHandler(ctx: Ctx, args: Row) {
  if (!Array.isArray(args.lineIds)) return invalid('lineIds', 'lineIds must be an array')
  const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
  if (order?.isRefund) return invalid('id', 'return lines are immutable')
  if (order?.paymentLockId) return invalid('id', 'order is locked by an external payment attempt')
  const lines = await ctx.db.select('pos.OrderLine', { orderId: args.id })
  const wanted = args.lineIds.map(String)
  if (
    new Set(wanted).size !== wanted.length ||
    lines.length !== wanted.length ||
    lines.some((line) => !wanted.includes(String(line.id)))
  )
    return invalid('lineIds', 'lineIds must contain every line exactly once')
  const claim = await claimDraftRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  for (const [index, lineId] of wanted.entries())
    await ctx.db.update('pos.OrderLine', { id: lineId }, { sequence: (index + 1) * 10 })
  return { ok: true, id: args.id, revision: claim.revision }
}

export const linesFunctions: Record<string, FnSpec> = {
  getLineTrackingAvailability: defineFn({
    input: { orderId: 'id', lineId: 'id' },
    effects: [
      'read:pos.Order',
      'read:pos.OrderLine',
      'read:pos.Config',
      'read:uom.Unit',
      ...trackingAvailabilityEffects,
    ],
    agent: true,
    handler: getLineTrackingAvailabilityHandler,
  }),
  setLineLotSelections: defineFn({
    input: { orderId: 'id', lineId: 'id', expectedRevision: 'int', selections: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Config',
      'read:uom.Unit',
      ...trackingAvailabilityEffects,
    ],
    idempotent: true,
    agent: true,
    handler: setLineLotSelectionsHandler,
  }),
  addLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      productId: 'id',
      productUomId: 'id',
      qty: 'decimal',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      taxIds: 'json?',
      quoteRevision: 'text?',
      expectedRevision: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'read:pos.Config',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Payment',
      'write:pos.Order',
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:account.Tax',
      'read:account.ProductTax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: addLineHandler,
  }),
  updateLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      expectedRevision: 'int',
      qty: 'decimal',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxIds: 'json?',
      quoteRevision: 'text?',
      sequence: 'int?',
      overrideReason: 'text?',
      overrideBy: 'text?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Payment',
      'read:pos.Config',
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:account.Tax',
      'read:account.ProductTax',
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: updateLineHandler,
  }),
  removeLine: defineFn({
    input: { id: 'id', orderId: 'id', expectedRevision: 'int' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'write:pos.OrderLine',
      'read:pos.Payment',
    ],
    idempotent: true,
    agent: true,
    handler: removeLineHandler,
  }),
  reorderLines: defineFn({
    input: { id: 'id', expectedRevision: 'int', lineIds: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order', 'read:pos.OrderLine', 'write:pos.OrderLine'],
    idempotent: true,
    agent: true,
    handler: reorderLinesHandler,
  }),
}
