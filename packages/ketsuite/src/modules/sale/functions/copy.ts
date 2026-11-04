import type { Ctx, Row } from '@ketvietlab/ketjs'
import { defineFn } from '@ketvietlab/ketjs'
import { copyOrder } from '../copy-order.ts'
import { ordersFunctions } from './orders.ts'
import { linesFunctions } from './lines.ts'
import { configurationEffects } from '../configuration.ts'
import { saleRecordResult } from '../record-result.ts'
export async function copyOrderHandler(ctx: Ctx, args: Row) {
  return saleRecordResult(await copyOrder(ctx, args))
}
export const copyFunctions = {
  copyOrder: defineFn({
    input: { id: 'id', sourceId: 'id', expectedRevision: 'int' },
    effects: [
      ...new Set([
        ...(ordersFunctions.createOrder!.effects ?? []),
        ...(linesFunctions.addLine!.effects ?? []),
        ...configurationEffects,
        'read:sale.OrderCopy',
        'write:sale.OrderCopy',
      ]),
    ],
    idempotent: true,
    agent: true,
    handler: copyOrderHandler,
  }),
}
