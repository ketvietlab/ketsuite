import { asc, defineFn, eq, from, gt, gte, inArray, lt } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { compareDecimals } from '../../account/money.ts'
import { addCalendarDays, zonedMidnight } from '../../hospitality_core/calendar.ts'
import {
  hasPropertyScope,
  propertyAccess,
  readRecord,
  reject,
} from '../../hospitality_core/functions/command.ts'
import { folioBalances } from './folio-balances.ts'

export const getFrontDeskBillingSummaryHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) reject('propertyId', 'property_missing')
  const property = await propertyAccess(ctx, args.propertyId),
    day = String(args.day)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ||
    new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day
  )
    reject('day', 'date_locked')
  const start = zonedMidnight(day, String(property.timezone)).toISOString(),
    end = zonedMidnight(addCalendarDays(day, 1), String(property.timezone)).toISOString()
  const S = ctx.table('hospitality_core.Stay'),
    F = ctx.table('hospitality_core.Folio')
  const base = from(S).where(
    eq(S.companyId!, ctx.scope.company),
    eq(S.propertyId, property.id),
    eq(S.state, 'checked_in'),
    gte(S.checkOut, start),
    lt(S.checkOut, end),
  )
  let owing = 0,
    unknown = 0,
    after: unknown = null
  while (true) {
    const query = after ? base.where(gt(S.id, after)) : base
    const stays = await ctx.db.all(query.select(S.id, S.folioId).orderBy(asc(S.id)).limit(100))
    if (!stays.length) break
    const folios = await ctx.db.all(
      from(F)
        .where(
          eq(F.companyId!, ctx.scope.company),
          eq(F.propertyId, property.id),
          inArray(
            F.id,
            stays.map((stay) => stay.folioId),
          ),
        )
        .limit(100),
    )
    const balances = await folioBalances(ctx, folios)
    for (const stay of stays) {
      const balance = balances.get(String(stay.folioId))
      if (!balance?.balanceKnown) unknown++
      else if (compareDecimals(balance.due, '0') > 0) owing++
    }
    if (stays.length < 100) break
    after = stays.at(-1)!.id
  }
  return { owing, unknown }
}
/**
 * What one folio still owes, for a desk peek: the same evidence as the departure count (a posted invoice's
 * residual, or charges less valid payments before invoicing). `known: false` when that evidence is missing or
 * reversed; a folio outside the reader's company or branches answers as unknown, never as zero.
 */
export const getFolioDueHandler: FnSpec['handler'] = async (ctx, args) => {
  const unknown = { due: null, known: false }
  if (!ctx.scope.company) return unknown
  const folio = await readRecord(ctx, 'hospitality_core.Folio', args.id)
  if (!folio) return unknown
  const property = await readRecord(ctx, 'hospitality_core.Property', folio.propertyId)
  if (!property || !hasPropertyScope(ctx, property)) return unknown
  const balance = (await folioBalances(ctx, [folio])).get(String(folio.id))
  return balance?.balanceKnown ? { due: balance.due, known: true } : unknown
}

/** The stays one in-house page asks about at once. */
export const STAY_DUE_BATCH = 100
// The stays that share a folio's due: every room the purchase took, before, during or after the stay.
const SHARING = ['draft', 'checked_in', 'checked_out']

/**
 * What the stays an in-house page shows still owe (HOS-DEC-031): each stay's folio due, on the same evidence as
 * `getFolioDue`, and how many rooms share that folio. Rows come back in the order asked. A stay outside the reader's
 * company or branches, or whose folio lacks the evidence, answers `known: false`, never zero.
 */
export const getStayDuesHandler: FnSpec['handler'] = async (ctx, args) => {
  const ids = Array.isArray(args.ids) ? (args.ids as unknown[]) : null
  if (!ids || ids.length > STAY_DUE_BATCH || ids.some((id) => typeof id !== 'string' || !id))
    reject('ids', 'invalid')
  const asked = ids as string[]
  const unknown = (id: string) => ({ id, due: null, currency: null, known: false, shared: 1 })
  if (!ctx.scope.company || !asked.length) return { rows: asked.map(unknown) }
  const S = ctx.table('hospitality_core.Stay'),
    F = ctx.table('hospitality_core.Folio'),
    P = ctx.table('hospitality_core.Property')
  const unique = [...new Set(asked)]
  const stays = await ctx.db.all(
    from(S)
      .select(S.id, S.folioId, S.propertyId)
      .where(eq(S.companyId!, ctx.scope.company), inArray(S.id, unique))
      .limit(unique.length),
  )
  const propertyIds = [...new Set(stays.map((stay) => stay.propertyId))]
  const properties = propertyIds.length
    ? await ctx.db.all(
        from(P)
          .select(P.id, P.branchId!)
          .where(eq(P.companyId!, ctx.scope.company), inArray(P.id, propertyIds))
          .limit(propertyIds.length),
      )
    : []
  const inScope = new Set(properties.filter((row) => hasPropertyScope(ctx, row)).map((row) => row.id))
  const visible = new Map(
    stays.filter((stay) => inScope.has(stay.propertyId)).map((stay) => [String(stay.id), stay]),
  )
  const folioIds = [...new Set([...visible.values()].map((stay) => stay.folioId))]
  const folios = folioIds.length
    ? await ctx.db.all(
        from(F).where(eq(F.companyId!, ctx.scope.company), inArray(F.id, folioIds)).limit(folioIds.length),
      )
    : []
  const balances = await folioBalances(ctx, folios)
  const rooms = folioIds.length
    ? await ctx.db.group(
        from(S)
          .where(eq(S.companyId!, ctx.scope.company), inArray(S.folioId, folioIds), inArray(S.state, SHARING))
          .groupBy({ col: S.folioId }),
      )
    : []
  const sharing = new Map(rooms.map((row) => [String(row.key[0]), row.count]))
  const currency = String((await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency || 'VND')
  return {
    rows: asked.map((id) => {
      const stay = visible.get(id)
      const balance = stay ? balances.get(String(stay.folioId)) : undefined
      if (!stay || !balance?.balanceKnown) return unknown(id)
      return {
        id,
        due: balance.due,
        currency,
        known: true,
        shared: Math.max(1, sharing.get(String(stay.folioId)) ?? 1),
      }
    }),
  }
}

/**
 * What the folios a register page shows still owe, and their invoice (HOS-DEC-032): each folio's due on the same
 * evidence as `getFolioDue`, and the invoice its bill recorded — `posted`, `draft`, or `void` once reversed or
 * cancelled. Rows come back in the order asked. A folio outside the reader's company or branches answers unknown
 * with no invoice; one whose evidence is incomplete answers `known: false` with what invoice it has, never zero.
 */
export const getFolioDuesHandler: FnSpec['handler'] = async (ctx, args) => {
  const ids = Array.isArray(args.ids) ? (args.ids as unknown[]) : null
  if (!ids || ids.length > STAY_DUE_BATCH || ids.some((id) => typeof id !== 'string' || !id))
    reject('ids', 'invalid')
  const asked = ids as string[]
  const unknown = (id: string) => ({ id, due: null, currency: null, known: false, invoice: null })
  if (!ctx.scope.company || !asked.length) return { rows: asked.map(unknown) }
  const F = ctx.table('hospitality_core.Folio'),
    P = ctx.table('hospitality_core.Property'),
    B = ctx.table('hospitality_billing.FolioBill'),
    M = ctx.table('account.Move')
  const unique = [...new Set(asked)]
  const folios = await ctx.db.all(
    from(F).where(eq(F.companyId!, ctx.scope.company), inArray(F.id, unique)).limit(unique.length),
  )
  const propertyIds = [...new Set(folios.map((folio) => folio.propertyId))]
  const properties = propertyIds.length
    ? await ctx.db.all(
        from(P)
          .select(P.id, P.branchId!)
          .where(eq(P.companyId!, ctx.scope.company), inArray(P.id, propertyIds))
          .limit(propertyIds.length),
      )
    : []
  const inScope = new Set(properties.filter((row) => hasPropertyScope(ctx, row)).map((row) => row.id))
  const visible = folios.filter((folio) => inScope.has(folio.propertyId))
  const balances = await folioBalances(ctx, visible)
  const bills = visible.length
    ? await ctx.db.all(
        from(B)
          .select(B.folioId, B.moveId)
          .where(
            eq(B.companyId!, ctx.scope.company),
            inArray(
              B.folioId,
              visible.map((folio) => folio.id),
            ),
          )
          .limit(visible.length),
      )
    : []
  const moves = bills.length
    ? await ctx.db.all(
        from(M)
          .select(M.id, M.name, M.state, M.reversedById!)
          .where(
            eq(M.companyId!, ctx.scope.company),
            inArray(
              M.id,
              bills.map((bill) => bill.moveId),
            ),
          )
          .limit(bills.length),
      )
    : []
  const byMove = new Map(moves.map((move) => [move.id, move]))
  const invoices = new Map(
    bills.flatMap((bill) => {
      const move = byMove.get(bill.moveId)
      if (!move) return []
      const status =
        move.reversedById || move.state === 'cancel' ? 'void' : move.state === 'posted' ? 'posted' : 'draft'
      return [[String(bill.folioId), { name: String(move.name ?? ''), status }]]
    }),
  )
  const currency = String((await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency || 'VND')
  const shown = new Set(visible.map((folio) => String(folio.id)))
  return {
    rows: asked.map((id) => {
      if (!shown.has(id)) return unknown(id)
      const balance = balances.get(id),
        invoice = invoices.get(id) ?? null
      return balance?.balanceKnown
        ? { id, due: balance.due, currency, known: true, invoice }
        : { ...unknown(id), invoice }
    }),
  }
}

export const frontDeskBillingFunctions = {
  getFolioDues: defineFn({
    input: { ids: 'json' },
    output: { rows: 'json' },
    effects: [
      'hospitality_core.Property',
      'hospitality_core.Folio',
      'hospitality_billing.FolioBill',
      'hospitality_billing.FolioPayment',
      'account.Payment',
      'account.Move',
      'account.MoveLine',
      'company.Company',
    ].map((model) => `read:${model}`),
    handler: getFolioDuesHandler,
  }),
  getStayDues: defineFn({
    input: { ids: 'json' },
    output: { rows: 'json' },
    effects: [
      'hospitality_core.Property',
      'hospitality_core.Stay',
      'hospitality_core.Folio',
      'hospitality_billing.FolioBill',
      'hospitality_billing.FolioPayment',
      'account.Payment',
      'account.Move',
      'account.MoveLine',
      'company.Company',
    ].map((model) => `read:${model}`),
    handler: getStayDuesHandler,
  }),
  getFolioDue: defineFn({
    input: { id: 'id' },
    output: { due: 'decimal?', known: 'bool' },
    effects: [
      'hospitality_core.Property',
      'hospitality_core.Folio',
      'hospitality_billing.FolioBill',
      'hospitality_billing.FolioPayment',
      'account.Payment',
      'account.Move',
      'account.MoveLine',
    ].map((model) => `read:${model}`),
    handler: getFolioDueHandler,
  }),
  getFrontDeskBillingSummary: defineFn({
    input: { propertyId: 'id', day: 'text' },
    output: { owing: 'int', unknown: 'int' },
    effects: [
      'hospitality_core.Property',
      'hospitality_core.Stay',
      'hospitality_core.Folio',
      'hospitality_billing.FolioBill',
      'hospitality_billing.FolioPayment',
      'account.Payment',
      'account.Move',
      'account.MoveLine',
    ].map((model) => `read:${model}`),
    handler: getFrontDeskBillingSummaryHandler,
  }),
}
