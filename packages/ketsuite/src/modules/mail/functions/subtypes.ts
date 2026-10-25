import { asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { subtypeOutput } from './shared.ts'

export function listSubtypesHandler(ctx: Ctx) {
  const S = ctx.table('mail.Subtype')
  return ctx.db.all(from(S).where(eq(S.active, true)).orderBy(asc(S.name)))
}

export async function saveSubtypeHandler(ctx: Ctx, args: Record<string, unknown>) {
  const S = ctx.table('mail.Subtype')
  const existing = await ctx.db.one(from(S).where(eq(S.id, args.id)))
  if (!existing && (await ctx.db.one(from(S).where(eq(S.code, args.code)))))
    return { ok: false, errors: [{ field: 'code', message: 'mã loại thông báo đã tồn tại' }] }
  const cs = ctx
    .change('mail.Subtype', args, existing)
    .cast(['id', 'code', 'name', 'defaultFollower', 'internalOnly', 'active'])
    .required(['code', 'name'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}

export const subtypesFunctions: Record<string, FnSpec> = {
  listSubtypes: defineFn({
    output: subtypeOutput,
    effects: ['read:mail.Subtype'],
    handler: listSubtypesHandler,
  }),
  saveSubtype: defineFn({
    input: subtypeOutput,
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:mail.Subtype', 'write:mail.Subtype'],
    idempotent: true,
    agent: true,
    handler: saveSubtypeHandler,
  }),
}
