import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { saveOrderDeliveryPromise } from '../delivery-promise-write.ts'

export async function saveDeliveryPromiseHandler(ctx: Ctx, args: Row) {
  return saveOrderDeliveryPromise(ctx, args)
}

export const deliveryPromiseFunctions: Record<string, FnSpec> = {
  saveDeliveryPromise: defineFn({
    input: { id: 'id', expectedRevision: 'int', shippingPolicy: 'text?', commitmentDate: 'datetime?' },
    output: { ok: 'bool', id: 'id?', expectedDate: 'text?', errors: 'json?' },
    effects: [
      'read:company.Company',
      'read:sale.Order',
      'write:sale.Order',
      'read:sale.OrderLine',
      'read:product.Product',
      'read:product.Template',
      'read:stock.Move',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.PickingType',
    ],
    idempotent: true,
    agent: true,
    handler: saveDeliveryPromiseHandler,
  }),
}
