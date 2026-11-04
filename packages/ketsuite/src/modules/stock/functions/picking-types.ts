import { PICKING_TYPE_CODES } from '../types.ts'
import { invalid } from '../inventory-validation.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'

export async function listPickingTypesHandler(ctx: Ctx) {
  return ours(ctx, 'stock.PickingType', { active: true })
}

export async function savePickingTypeHandler(ctx: Ctx, args: Row) {
  if (!PICKING_TYPE_CODES.includes(args.code as never))
    return invalid('code', `phải là: ${PICKING_TYPE_CODES.join(', ')}`)
  const createBackorder = String(args.createBackorder ?? 'ask')
  if (!['ask', 'always', 'never'].includes(createBackorder))
    return invalid('createBackorder', 'phải là ask, always hoặc never')
  const existing = (await ours(ctx, 'stock.PickingType', { id: args.id }))[0]
  const values = { ...args, createBackorder, active: true }
  const cs = ctx
    .change('stock.PickingType', values, existing ?? null)
    .cast([
      'id',
      'name',
      'code',
      'warehouseId',
      'defaultLocationSrcId',
      'defaultLocationDestId',
      'createBackorder',
      'active',
    ])
    .required(['name', 'code'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}

export const pickingTypesFunctions: Record<string, FnSpec> = {
  listPickingTypes: defineFn({
    input: {},
    effects: ['read:stock.PickingType'],
    agent: true,
    handler: listPickingTypesHandler,
  }),

  savePickingType: defineFn({
    input: {
      id: 'id',
      name: 'text',
      code: 'text',
      warehouseId: 'id?',
      defaultLocationSrcId: 'id?',
      defaultLocationDestId: 'id?',
      createBackorder: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.PickingType', 'write:stock.PickingType'],
    idempotent: true,
    agent: true,
    handler: savePickingTypeHandler,
  }),
}
