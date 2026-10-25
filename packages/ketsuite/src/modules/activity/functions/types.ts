import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { listTypes, validateActivityType } from '../activity-service.ts'
import { typeShape } from './shared.ts'

export function saveTypeHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    validateActivityType({
      category: String(args.category),
      chainingPolicy: String(args.chainingPolicy),
      defaultDelayDays: Number(args.defaultDelayDays),
      nextTypeId: args.nextTypeId ? String(args.nextTypeId) : null,
    })
    const T = tx.table('activity.Type')
    const existing = await tx.db.one(from(T).where(eq(T.id, args.id)))
    if (args.nextTypeId) {
      if (args.nextTypeId === args.id) throw new Error('an activity type cannot chain directly to itself')
      if (!(await tx.db.one(from(T).where(eq(T.id, args.nextTypeId), eq(T.active, true)))))
        throw new Error(`next activity type "${String(args.nextTypeId)}" does not exist`)
    }
    const row = {
      id: args.id,
      name: String(args.name).trim(),
      category: args.category,
      ...(args.icon ? { icon: args.icon } : {}),
      defaultDelayDays: args.defaultDelayDays,
      chainingPolicy: args.chainingPolicy,
      ...(args.nextTypeId ? { nextTypeId: args.nextTypeId } : {}),
      sequence: args.sequence,
      active: args.active,
    }
    if (!row.name) throw new Error('activity type name cannot be empty')
    if (existing) await tx.db.update('activity.Type', { id: args.id }, row)
    else await tx.db.insert('activity.Type', row)
    return { ok: true, id: args.id }
  })
}

export const typesFunctions: Record<string, FnSpec> = {
  listTypes: defineFn({
    output: typeShape,
    effects: ['read:activity.Type'],
    handler: listTypes,
  }),
  saveType: defineFn({
    input: typeShape,
    output: { ok: 'bool', id: 'id' },
    effects: ['read:activity.Type', 'write:activity.Type'],
    idempotent: true,
    agent: true,
    handler: saveTypeHandler,
  }),
}
