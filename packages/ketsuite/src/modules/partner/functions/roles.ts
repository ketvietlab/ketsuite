import { defineFn, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { PARTNER_ROLES } from '../types.ts'
import { issue, invalid, invalidatePartnerCountCache } from './helpers.ts'

export async function grantRoleHandler(ctx: Ctx, a: Row) {
  if (!PARTNER_ROLES.includes(String(a.role) as never))
    return invalid([issue('role', 'partner.error.role', { allowed: PARTNER_ROLES })])
  const P = ctx.table('partner.Partner')
  if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId)))))
    return invalid([issue('partnerId', 'partner.error.partnerMissing')])
  const inserted = await ctx.db.insertIfAbsent('partner.Role', {
    id: a.id,
    partnerId: a.partnerId,
    role: a.role,
  })
  if ('dryRun' in inserted) return { ok: true, id: a.id }
  if (inserted.inserted) {
    await invalidatePartnerCountCache()
    return { ok: true, id: a.id }
  }
  return { ok: true }
}

export async function revokeRoleHandler(ctx: Ctx, a: Row) {
  const R = ctx.table('partner.Role')
  const { changes } = await ctx.db.del(deleteFrom(R).where(eq(R.partnerId, a.partnerId), eq(R.role, a.role)))
  if (changes) await invalidatePartnerCountCache()
  return { ok: true, removed: changes }
}

export const rolesFunctions: Record<string, FnSpec> = {
  grantRole: defineFn({
    input: { id: 'id', partnerId: 'id', role: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:partner.Role', 'write:partner.Role'],
    idempotent: true,
    agent: true,
    handler: grantRoleHandler,
  }),
  revokeRole: defineFn({
    input: { partnerId: 'id', role: 'text' },
    output: { ok: 'bool', removed: 'int' },
    effects: ['read:partner.Role', 'write:partner.Role'],
    idempotent: true,
    agent: true,
    handler: revokeRoleHandler,
  }),
}
