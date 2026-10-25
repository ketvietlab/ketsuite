import {
  asc,
  defineFn,
  desc,
  eq,
  from,
  ilike,
  inArray,
  isNull,
  likeLiteral,
  ne,
  not,
  or,
} from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { billingFolio, chargeRuleConfigured } from './accounting.ts'
import { folioBalances } from './folio-balances.ts'
import { readRecord } from '../../hospitality_core/functions/command.ts'

export const getFolioFinanceWorkspaceHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return { record: null }
  const folio = await billingFolio(ctx, args.folioId)
  if (!folio) return { record: null }
  const B = ctx.table('hospitality_billing.FolioBill'),
    C = ctx.table('hospitality_core.Charge'),
    R = ctx.table('hospitality_billing.ChargeRule'),
    L = ctx.table('hospitality_billing.FolioPayment'),
    P = ctx.table('account.Payment'),
    M = ctx.table('account.Move'),
    J = ctx.table('account.Journal')
  const bill = await ctx.db.one(from(B).where(eq(B.companyId!, ctx.scope.company), eq(B.folioId, folio.id)))
  const invoice = bill ? await readRecord(ctx, 'account.Move', bill.moveId) : null
  const money = (await folioBalances(ctx, [folio])).get(String(folio.id))!
  const charges = from(C).where(
    eq(C.companyId!, ctx.scope.company),
    eq(C.folioId, folio.id),
    eq(C.state, 'active'),
    ne(C.amount, '0'),
  )
  const chargeCount = await ctx.db.count(charges)
  const groups = await ctx.db.group(charges.groupBy({ col: C.type }))
  const types = groups.map((group) => String(group.key[0]))
  const rules = types.length
    ? await ctx.db.all(from(R).where(eq(R.companyId!, ctx.scope.company), inArray(R.chargeType, types)))
    : []
  const configured = new Set(rules.filter(chargeRuleConfigured).map((rule) => String(rule.chargeType)))
  const missingRules = types.filter((type) => !configured.has(type))
  const saleJournal = await ctx.db.one(
    from(J).where(eq(J.companyId!, ctx.scope.company), eq(J.type, 'sale')).orderBy(asc(J.code)),
  )
  const blockers = bill
    ? []
    : [
        ...(folio.state !== 'closed' ? [{ code: 'folio_open' }] : []),
        ...(!chargeCount ? [{ code: 'folio_without_charges' }] : []),
        ...(missingRules.length ? [{ code: 'charge_rule_missing', params: { types: missingRules } }] : []),
        ...(!saleJournal ? [{ code: 'journal_missing' }] : []),
        ...(!folio.partnerId ? [{ code: 'folio_without_guest' }] : []),
      ]
  const query = from(L).where(eq(L.companyId!, ctx.scope.company), eq(L.folioId, folio.id))
  const total = await ctx.db.count(query),
    pages = Math.max(1, Math.ceil(total / 20)),
    page = Math.min(pages, Math.max(1, Math.trunc(Number(args.page) || 1)))
  const links = await ctx.db.all(
    query
      .orderBy(desc(L.recordedAt), asc(L.id))
      .limit(20)
      .offset((page - 1) * 20),
  )
  const payments = links.length
    ? await ctx.db.all(
        from(P)
          .where(
            eq(P.companyId!, ctx.scope.company),
            inArray(
              P.id,
              links.map((link) => link.paymentId),
            ),
          )
          .limit(20),
      )
    : []
  const moveIds = payments.map((payment) => payment.moveId).filter(Boolean),
    journalIds = payments.map((payment) => payment.journalId).filter(Boolean)
  const moves = moveIds.length
    ? await ctx.db.all(from(M).where(eq(M.companyId!, ctx.scope.company), inArray(M.id, moveIds)).limit(20))
    : []
  const journals = journalIds.length
    ? await ctx.db.all(
        from(J).where(eq(J.companyId!, ctx.scope.company), inArray(J.id, journalIds)).limit(20),
      )
    : []
  const byPayment = new Map(payments.map((payment) => [payment.id, payment])),
    byMove = new Map(moves.map((move) => [move.id, move])),
    byJournal = new Map(journals.map((journal) => [journal.id, journal]))
  return {
    record: {
      version: Number(folio.version ?? 0),
      moveId: bill?.moveId ?? null,
      moveName: invoice?.name ?? null,
      paid: money.paid,
      balance: money.due,
      balanceKnown: money.balanceKnown,
      blockers,
      buyer: bill
        ? {
            type: bill.buyerType,
            name: bill.buyerName,
            taxCode: bill.buyerTaxCode,
            address: bill.buyerAddress,
            email: bill.buyerEmail,
          }
        : null,
      payments: {
        page,
        pages,
        total,
        rows: links.map((link) => {
          const payment = byPayment.get(link.paymentId),
            move = payment ? byMove.get(payment.moveId) : null
          return {
            id: link.id,
            kind: link.kind,
            amount: link.amount,
            active: link.active !== false,
            date: payment?.date ?? link.recordedAt,
            reference: payment?.paymentReference ?? null,
            journal: payment ? (byJournal.get(payment.journalId)?.name ?? null) : null,
            posted:
              !!payment &&
              ['in_process', 'paid'].includes(String(payment.state)) &&
              move?.state === 'posted' &&
              !move.reversedById,
          }
        }),
      },
    },
  }
}

export const lookupFolioJournalsHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company || !(await billingFolio(ctx, args.folioId))) return []
  const J = ctx.table('account.Journal')
  let query = from(J).where(
    eq(J.companyId!, ctx.scope.company),
    inArray(J.type, ['cash', 'bank']),
    not(isNull(J.defaultAccountId)),
  )
  if (args.id) query = query.where(eq(J.id, args.id))
  if (args.search) {
    const term = `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`
    query = query.where(or(ilike(J.code, term, true), ilike(J.name, term, true)))
  }
  const rows = await ctx.db.all(
    query
      .select(J.id, J.code, J.name)
      .orderBy(asc(J.code), asc(J.id))
      .limit(Math.min(50, Math.max(1, Math.trunc(Number(args.limit) || 20)))),
  )
  return rows.map((row) => ({ id: row.id, name: `${row.code} · ${row.name}` }))
}
const reads = ['read:hospitality_core.Folio', 'read:hospitality_core.Property']
export const folioFinanceWorkspaceFunctions = {
  getFolioFinanceWorkspace: defineFn({
    input: { folioId: 'id', page: 'int?' },
    output: { record: 'json?' },
    effects: [
      ...reads,
      'read:hospitality_core.Charge',
      'read:hospitality_billing.ChargeRule',
      'read:hospitality_billing.FolioBill',
      'read:hospitality_billing.FolioPayment',
      'read:account.Payment',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Journal',
    ],
    handler: getFolioFinanceWorkspaceHandler,
  }),
  lookupFolioJournals: defineFn({
    input: { folioId: 'id', search: 'text?', id: 'id?', limit: 'int?' },
    effects: [...reads, 'read:account.Journal'],
    handler: lookupFolioJournalsHandler,
  }),
}
