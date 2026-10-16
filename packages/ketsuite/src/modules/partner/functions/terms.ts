import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { issue, invalid, changeIssues } from './helpers.ts'

export async function saveTermsHandler(ctx: Ctx, a: Row) {
  const P = ctx.table('partner.Partner')
  if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId)))))
    return invalid([issue('partnerId', 'partner.error.partnerMissing')])
  return ctx.tx(async (tx) => {
    const T = tx.table('partner.CompanyTerms')
    const existing = await tx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
    const cs = tx.change('partner.CompanyTerms', a, existing).cast(['id', 'partnerId', 'creditLimit', 'note'])
    if (!cs.valid) return invalid(changeIssues(cs.errors))
    if (existing) {
      await tx.db.commit(cs, { id: existing.id })
      return { ok: true, id: existing.id }
    }
    const inserted = await tx.db.insertIfAbsent('partner.CompanyTerms', {
      id: a.id,
      partnerId: a.partnerId,
      ...(a.creditLimit === undefined ? {} : { creditLimit: a.creditLimit }),
      ...(a.note === undefined ? {} : { note: a.note }),
    })
    if ('dryRun' in inserted || inserted.inserted) return { ok: true, id: a.id }
    const held = await tx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
    if (held)
      await tx.db.update(
        'partner.CompanyTerms',
        { id: held.id },
        { creditLimit: a.creditLimit, note: a.note },
      )
    return { ok: true, id: held?.id ?? a.id }
  })
}

export async function getTermsHandler(ctx: Ctx, a: Row) {
  const T = ctx.table('partner.CompanyTerms')
  return ctx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
}

export const termsFunctions: Record<string, FnSpec> = {
  saveTerms: defineFn({
    input: { id: 'id', partnerId: 'id', creditLimit: 'decimal?', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:partner.CompanyTerms', 'write:partner.CompanyTerms'],
    idempotent: true,
    agent: true,
    handler: saveTermsHandler,
  }),
  getTerms: defineFn({
    input: { partnerId: 'id' },
    output: { id: 'id', partnerId: 'id', creditLimit: 'decimal?', note: 'text?' },
    effects: ['read:partner.CompanyTerms'],
    agent: true,
    handler: getTermsHandler,
  }),
}
