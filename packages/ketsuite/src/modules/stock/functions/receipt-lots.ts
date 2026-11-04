import { defineFn, type Ctx, type Row } from '@ketvietlab/ketjs'
import { prepareReceiptLot, RECEIPT_LOT_EFFECTS } from '../receipt-lots.ts'

export const prepareReceiptLotHandler = (ctx: Ctx, args: Row) => prepareReceiptLot(ctx, args)
export const receiptLotFunctions = {
  prepareReceiptLot: defineFn({
    input: {
      id: 'id',
      moveId: 'id',
      quantity: 'decimal',
      name: 'text?',
      expirationDate: 'text?',
      picked: 'bool?',
      expectedRevision: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: RECEIPT_LOT_EFFECTS.filter(
      (effect) => !['write:stock.Lot', 'write:product.Template'].includes(effect),
    ),
    idempotent: true,
    agent: true,
    handler: prepareReceiptLotHandler,
  }),
}
