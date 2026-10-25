import {
  and,
  asc,
  defineFn,
  desc,
  eq,
  from,
  ilike,
  inArray,
  isNotNull,
  likeLiteral,
  lt,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compareDecimals, subtractDecimals } from '../../account/money.ts'
import {
  hasPropertyScope,
  propertyAccess,
  readRecord,
  reject,
} from '../../hospitality_core/functions/command.ts'
import { GUARANTEE_READS, paymentCommitmentBatch } from '../../hospitality_core/functions/guarantee-source.ts'

export async function reservationFinancialContext(ctx: Ctx, id: unknown) {
  if (!ctx.scope.company) reject('reservationId', 'record_missing')
  const booking = await readRecord(ctx, 'hospitality_core.Reservation', id)
  if (!booking) reject('reservationId', 'record_missing')
  const property = await propertyAccess(ctx, booking.propertyId)
  return { booking, property }
}

/** Find usable credits in bounded batches; older usable money is not hidden behind invalid recent entries. */
export async function reservationPaymentChoices(ctx: Ctx, booking: Row, args: Record<string, unknown>) {
  const currency = booking.currency ?? (await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency
  if (!currency) return []
  const P = ctx.table('account.Payment'),
    M = ctx.table('account.Move'),
    L = ctx.table('account.MoveLine')
  let base = from(P)
    .select(P.id, P.name, P.paymentReference, P.date, P.moveId)
    .where(
      eq(P.companyId!, ctx.scope.company),
      eq(P.partnerId!, booking.partnerId),
      eq(P.paymentType, 'inbound'),
      eq(P.partnerType, 'customer'),
      eq(P.currency, currency),
      inArray(P.state, ['in_process', 'paid']),
    )
  if (args.id) base = base.where(eq(P.id, args.id))
  if (args.search) {
    const pattern = `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`
    base = base.where(or(ilike(P.name, pattern, true), ilike(P.paymentReference, pattern, true)))
  }
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(args.limit) || 20))),
    result: Row[] = []
  let after: Row | null = null
  while (result.length < limit) {
    const query = after
      ? base.where(or(lt(P.date, after.date), and(eq(P.date, after.date), lt(P.id, after.id))))
      : base
    const payments = await ctx.db.all(query.orderBy(desc(P.date), desc(P.id)).limit(50))
    if (!payments.length) break
    const ids = payments.map((row) => row.id),
      moves = payments.map((row) => row.moveId).filter(Boolean)
    const entries = moves.length
      ? await ctx.db.all(
          from(M)
            .select(M.id, M.state, M.reversedById)
            .where(eq(M.companyId!, ctx.scope.company), inArray(M.id, moves)),
        )
      : []
    const lines = moves.length
      ? await ctx.db.all(
          from(L)
            .select(L.moveId, L.amountResidual)
            .where(
              eq(L.companyId!, ctx.scope.company),
              inArray(
                L.id,
                moves.map((id) => `${id}:counterpart`),
              ),
            ),
        )
      : []
    const commitments = await paymentCommitmentBatch(ctx, ids, booking)
    const byMove = new Map(entries.map((row) => [row.id, row])),
      byLine = new Map(lines.map((row) => [row.moveId, row]))
    for (const payment of payments) {
      if (result.length >= limit) break
      const move = byMove.get(payment.moveId)
      if (move?.state !== 'posted' || move.reversedById) continue
      const available = subtractDecimals(
        String(byLine.get(payment.moveId)?.amountResidual ?? '0'),
        commitments.get(payment.id) ?? '0',
      )
      if (compareDecimals(available, '0') <= 0) continue
      const reference = String(payment.paymentReference ?? payment.name ?? payment.id)
      result.push({ id: payment.id, reference, name: reference, available, date: payment.date })
    }
    if (args.id || payments.length < 50) break
    after = payments.at(-1)!
  }
  return result
}

async function lookupBooking(ctx: Ctx, id: unknown) {
  if (!ctx.scope.company) return null
  const booking = await readRecord(ctx, 'hospitality_core.Reservation', id)
  const property = booking ? await readRecord(ctx, 'hospitality_core.Property', booking.propertyId) : null
  return property && hasPropertyScope(ctx, property) ? booking : null
}

export const lookupReservationGuaranteePaymentsHandler: FnSpec['handler'] = async (ctx, args) => {
  const booking = await lookupBooking(ctx, args.reservationId)
  if (!booking) return []
  return reservationPaymentChoices(ctx, booking, { ...args, limit: Math.min(50, Number(args.limit) || 20) })
}
export const lookupReservationGuaranteeJournalsHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!(await lookupBooking(ctx, args.reservationId))) return []
  const J = ctx.table('account.Journal')
  let query = from(J)
    .select(J.id, J.code, J.name, J.type)
    .where(
      eq(J.companyId!, ctx.scope.company),
      eq(J.active, true),
      inArray(J.type, ['cash', 'bank']),
      isNotNull(J.defaultAccountId),
    )
  if (args.id) query = query.where(eq(J.id, args.id))
  if (args.search) {
    const pattern = `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`
    query = query.where(or(ilike(J.code, pattern, true), ilike(J.name, pattern, true)))
  }
  return ctx.db.all(
    query
      .orderBy(asc(J.name), asc(J.id))
      .limit(Math.min(50, Math.max(1, Math.trunc(Number(args.limit) || 20)))),
  )
}
const input = { reservationId: 'id', search: 'text?', id: 'id?', limit: 'int?' }
export const guaranteeLookupFunctions = {
  lookupReservationGuaranteePayments: defineFn({
    input,
    effects: [...GUARANTEE_READS, 'read:hospitality_core.Property'],
    handler: lookupReservationGuaranteePaymentsHandler,
  }),
  lookupReservationGuaranteeJournals: defineFn({
    input,
    effects: ['read:hospitality_core.Reservation', 'read:hospitality_core.Property', 'read:account.Journal'],
    handler: lookupReservationGuaranteeJournalsHandler,
  }),
}
