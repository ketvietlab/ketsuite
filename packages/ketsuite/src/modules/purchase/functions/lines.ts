import { insertPurchaseLine } from '../draft-write.ts'
import { defineFn, deleteFrom, eq, type Ctx, type FnSpec } from '@ketvietlab/ketjs'
import { invalid } from './shared.ts'
import { totals } from '../order-amounts.ts'
import { lineEffects, editableOrder, planLine } from '../line-plan.ts'

export function addLineHandler(ctx: Ctx, args: Record<string, unknown>) {
  return insertPurchaseLine(ctx, args)
}

export async function updateLineHandler(ctx: Ctx, args: Record<string, unknown>) {
  const line = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
  if (!line) return invalid('id', 'order line does not exist')
  const editable = await editableOrder(ctx, line.orderId)
  if (!editable) return invalid('id', 'lines can only be changed on an unlocked RFQ')
  const planned = await planLine(ctx, {
    ...args,
    orderId: line.orderId,
    productId: line.productId,
    productUomId: args.productUomId ?? line.productUomId,
    name: args.name ?? line.name,
    priceUnit: args.priceUnit ?? line.priceUnit,
    discount: args.discount ?? line.discount,
    taxId: args.taxId === undefined ? line.taxId : args.taxId,
    datePlanned: args.datePlanned ?? line.datePlanned,
  })
  if ('error' in planned) return planned.error
  await ctx.db.update(
    'purchase.OrderLine',
    { id: args.id },
    {
      ...planned.values,
      ...(args.sequence === undefined ? {} : { sequence: args.sequence }),
    },
  )
  await totals(ctx, line.orderId)
  return { ok: true, id: args.id, priceUnit: planned.values.priceUnit }
}

export async function removeLineHandler(ctx: Ctx, args: Record<string, unknown>) {
  const line = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
  if (!line) return { ok: true, id: args.id }
  if (!(await editableOrder(ctx, line.orderId)))
    return invalid('id', 'lines can only be removed from an unlocked RFQ')
  const table = ctx.table('purchase.OrderLine')
  await ctx.db.del(deleteFrom(table).where(eq(table.id, args.id)))
  await totals(ctx, line.orderId)
  return { ok: true, id: args.id }
}

export const linesFunctions: Record<string, FnSpec> = {
  addLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      productId: 'id',
      name: 'text?',
      productQty: 'decimal',
      productUomId: 'id',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      datePlanned: 'datetime?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', existing: 'bool?', errors: 'json?' },
    effects: [...lineEffects],
    idempotent: true,
    agent: true,
    handler: addLineHandler,
  }),
  updateLine: defineFn({
    input: {
      id: 'id',
      productQty: 'decimal',
      name: 'text?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      productUomId: 'id?',
      datePlanned: 'datetime?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', errors: 'json?' },
    effects: [...lineEffects],
    idempotent: true,
    agent: true,
    handler: updateLineHandler,
  }),
  removeLine: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'write:purchase.Order',
      'read:account.Tax',
    ],
    idempotent: true,
    agent: true,
    handler: removeLineHandler,
  }),
}
