import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { actor } from './shared.ts'

export async function saveAliasHandler(ctx: Ctx, args: Record<string, unknown>) {
  actor(ctx)
  const localPart = String(args.localPart).trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(localPart)) throw new Error('alias local part is invalid')
  const bridge = String(args.bridge).trim()
  if (!bridge) throw new Error('alias bridge cannot be empty')
  const A = ctx.table('mail_inbound.Alias')
  const existing = await ctx.db.one(from(A).where(eq(A.id, args.id)))
  const now = new Date().toISOString()
  const row = {
    id: args.id,
    localPart,
    name: String(args.name).trim(),
    bridge,
    defaults: args.defaults,
    active: args.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (existing) await ctx.db.update('mail_inbound.Alias', { id: args.id }, row)
  else await ctx.db.insert('mail_inbound.Alias', row)
  return { id: args.id }
}

export const aliasesFunctions: Record<string, FnSpec> = {
  saveAlias: defineFn({
    input: { id: 'id', localPart: 'text', name: 'text', bridge: 'text', defaults: 'json', active: 'bool' },
    output: { id: 'id' },
    effects: ['read:mail_inbound.Alias', 'write:mail_inbound.Alias'],
    idempotent: true,
    agent: true,
    handler: saveAliasHandler,
  }),
}
