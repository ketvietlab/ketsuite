import { quotationReaderFunctions } from './quotation-readers.ts'
import { quotationBenefitEffects } from '../quotation-benefits.ts'
import { programReaderFunctions } from './program-readers.ts'
import { programFunctions } from './programs.ts'
import { defineFn, type FnSpec } from '@ketvietlab/ketjs'
import { orderFunctions } from '../../loyalty/order-functions.ts'
import { functions as saleFunctions } from '../../sale/functions/index.ts'
import { effectsOf, snapshotEffects } from './shared.ts'
import { applyRewardHandler, removeRewardHandler } from './rewards.ts'
import { evaluateOrderHandler, applyCodeHandler } from './evaluation.ts'
import { backfillHandler } from './backfill.ts'
import { confirmOrderHandler, cancelOrderHandler, refundOrderHandler } from './lifecycle.ts'

export const functions: Record<string, FnSpec> = {
  evaluateOrder: defineFn({
    input: { orderId: 'id' },
    effects: [...snapshotEffects, ...effectsOf(orderFunctions.evaluateOrder), 'read:loyalty.Application'],
    agent: true,
    handler: evaluateOrderHandler,
  }),

  applyCode: defineFn({
    input: { orderId: 'id', code: 'text', expectedRevision: 'int?' },
    effects: [...quotationBenefitEffects, ...effectsOf(orderFunctions.applyCode)],
    idempotent: true,
    agent: true,
    handler: applyCodeHandler,
  }),

  applyReward: defineFn({
    input: { orderId: 'id', programId: 'id', rewardId: 'id', points: 'decimal?', expectedRevision: 'int?' },
    effects: quotationBenefitEffects,
    idempotent: true,
    agent: true,
    handler: applyRewardHandler,
  }),

  removeReward: defineFn({
    input: { orderId: 'id', programId: 'id', expectedRevision: 'int?' },
    effects: quotationBenefitEffects,
    idempotent: true,
    agent: true,
    handler: removeRewardHandler,
  }),

  confirmOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    effects: [
      ...effectsOf(saleFunctions.confirmOrder),
      'read:loyalty.ProgramNamespace',
      'write:loyalty.ProgramNamespace',
      ...snapshotEffects,
      ...effectsOf(orderFunctions['order.finalize']),
      'write:sale.Order',
    ],
    idempotent: true,
    agent: true,
    handler: confirmOrderHandler,
  }),

  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    effects: [
      ...effectsOf(saleFunctions.cancelOrder),
      'read:loyalty.ProgramNamespace',
      'write:loyalty.ProgramNamespace',
      ...effectsOf(orderFunctions['order.reverse']),
      'write:sale.Order',
    ],
    idempotent: true,
    agent: true,
    handler: cancelOrderHandler,
  }),

  refundOrder: defineFn({
    input: { id: 'id', originalOrderId: 'id' },
    effects: [...effectsOf(orderFunctions['order.reverse']), 'read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: refundOrderHandler,
  }),

  backfill: defineFn({
    input: { dryRun: 'bool?', limit: 'int?', offset: 'int?' },
    effects: [...snapshotEffects, ...effectsOf(orderFunctions['order.finalize']), 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: backfillHandler,
  }),
}

for (const group of [programFunctions, programReaderFunctions, quotationReaderFunctions])
  for (const [key, spec] of Object.entries(group)) {
    if (key in functions) throw new Error(`Duplicate loyalty_sale function: ${key}`)
    functions[key] = spec
  }
