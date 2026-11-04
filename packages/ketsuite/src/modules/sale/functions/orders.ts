import { resetOrder } from '../reset-order.ts'
import { cancelOrder } from '../cancel-order.ts'
import { reserveFreedEffects } from '../../stock/reservation-policy.ts'
import { createOrder } from '../create-order.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'
import { ORDER_SALES_EFFECTS } from '../teams.ts'
import { type QuotationSendInput, quotationSendEffects, sendQuotationTo } from './quotation-send.ts'
import { invalid, externalOrder, authorityRefusal, n } from './shared.ts'

export function createOrderHandler(ctx: Ctx, args: Row) {
  return createOrder(ctx, args)
}

export function resetOrderHandler(ctx: Ctx, args: Row) {
  return resetOrder(ctx, args)
}

export function sendQuotationHandler(ctx: Ctx, args: Row) {
  return ctx.tx((tx) => sendQuotationTo(tx, args as QuotationSendInput))
}

export async function lockOrderHandler(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (order?.state !== 'sale') return invalid('state', 'only a sales order can be locked')
  if (externalOrder(order)) return authorityRefusal()
  await ctx.db.update('sale.Order', { id: args.id }, { locked: args.locked, revision: n(order.revision) + 1 })
  return { ok: true, id: args.id }
}

export function cancelOrderHandler(ctx: Ctx, args: Row) {
  return cancelOrder(ctx, args)
}

export const ordersFunctions: Record<string, FnSpec> = {
  createOrder: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      clientOrderRef: 'text?',
      warehouseId: 'id',
      pricelistId: 'id?',
      paymentTermId: 'id?',
      userId: 'id?',
      teamId: 'id?',
      dateOrder: 'datetime?',
      validityDate: 'datetime?',
      commitmentDate: 'datetime?',
      shippingPolicy: 'text?',
      notes: 'text?',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:sale.Sequence',
      'write:sale.Sequence',
      'read:sale.Order',
      'write:sale.Order',
      'read:partner.Partner',
      'read:stock.Warehouse',
      'read:pricing.Pricelist',
      'read:sale.CustomerTerms',
      ...ORDER_SALES_EFFECTS,
      // A new quotation is valid for the company's default number of days (D20).
      'read:sale.Configuration',
      'read:account.PaymentTerm',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: createOrderHandler,
  }),
  resetOrder: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    // Cancelling was terminal: a cancelled order rendered no actions at all, so
    // one mis-click spent an order number and stranded its lines forever. Only a
    // cancelled order comes back, and it comes back as a draft — a confirmed
    // order has deliveries behind it and must be cancelled first.
    handler: resetOrderHandler,
  }),
  sendQuotation: defineFn({
    input: {
      id: 'id',
      channel: 'text?',
      recipient: 'text?',
      message: 'text?',
      expectedRevision: 'int?',
      idempotencyKey: 'text?',
    },
    output: { ok: 'bool', id: 'id?', sendId: 'text?', revision: 'int?', errors: 'json?' },
    effects: [...quotationSendEffects],
    idempotent: true,
    agent: true,
    handler: sendQuotationHandler,
  }),
  lockOrder: defineFn({
    input: { id: 'id', locked: 'bool' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: lockOrderHandler,
  }),
  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...reserveFreedEffects,
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Location',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
      'write:product.Template',
      'read:account.MoveLine',
      'write:sale.Order',
      'read:sale.OrderLifecycleEvent',
      'write:sale.OrderLifecycleEvent',
    ],
    idempotent: true,
    agent: true,
    handler: cancelOrderHandler,
  }),
}
