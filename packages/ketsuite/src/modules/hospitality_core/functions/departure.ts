import { asc, eq, from, gt, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { dateKeyIn } from '../calendar.ts'
import { commandIssue, hasPropertyScope, readRecord, reject } from './command.ts'

export const DEPARTURE_CHECKS = ['keys', 'charges'] as const
/** Read stock obligations in bounded batches; retain only a small preview. */
export async function departurePending(ctx: Ctx, stay: Row) {
  const E = ctx.table('hospitality_core.ExtraLine'),
    C = ctx.table('hospitality_core.Charge')
  let after = '',
    total = 0
  const rows: Row[] = []
  while (true) {
    let query = from(E)
      .select(E.id, E.description, E.quantity)
      .where(
        eq(E.companyId!, ctx.scope.company),
        eq(E.folioId, stay.folioId),
        eq(E.propertyId, stay.propertyId),
        eq(E.active, true),
        eq(E.fulfillmentKind, 'external_stock'),
      )
    if (after) query = query.where(gt(E.id, after))
    const lines = await ctx.db.all(query.orderBy(asc(E.id)).limit(100))
    if (!lines.length) break
    const posted = await ctx.db.group(
      from(C)
        .where(
          eq(C.companyId!, ctx.scope.company),
          eq(C.folioId, stay.folioId),
          eq(C.state, 'active'),
          inArray(
            C.extraLineId!,
            lines.map((line) => line.id),
          ),
        )
        .groupBy({ col: C.extraLineId! }),
    )
    const charged = new Set(posted.map((row) => row.key[0]))
    for (const line of lines)
      if (!charged.has(line.id)) {
        total++
        if (rows.length < 20) rows.push(line)
      }
    after = String(lines.at(-1)!.id)
  }
  return { total, rows }
}
export async function departureBlockers(ctx: Ctx, stay: Row, property: Row, at: Date) {
  const blockers = []
  if (!ctx.scope.company || !hasPropertyScope(ctx, property))
    blockers.push(commandIssue('stayId', 'stay_missing'))
  if (stay.state !== 'checked_in' || !stay.currentRoomId)
    return {
      blockers: [
        commandIssue(
          'state',
          stay.state === 'checked_out' ? 'stay_already_checked_out' : 'stay_cannot_check_out',
        ),
      ],
      pending: { total: 0, rows: [] as Row[] },
    }
  if (
    dateKeyIn(at, String(property.timezone)) !==
    dateKeyIn(new Date(String(stay.checkOut)), String(property.timezone))
  )
    blockers.push(commandIssue('checkOut', 'departure_day_required'))
  const A = ctx.table('hospitality_core.RoomAssignment')
  const assignment = await ctx.db.one(
    from(A).where(
      eq(A.companyId!, ctx.scope.company),
      eq(A.stayId, stay.id),
      eq(A.propertyId, property.id),
      eq(A.state, 'active'),
    ),
  )
  if (!assignment || assignment.roomId !== stay.currentRoomId)
    blockers.push(commandIssue('stayId', 'active_assignment_missing'))
  else if (at <= new Date(String(assignment.startAt))) blockers.push(commandIssue('at', 'assignment_order'))
  const folio = await readRecord(ctx, 'hospitality_core.Folio', stay.folioId)
  if (!folio || folio.propertyId !== property.id || folio.state !== 'open')
    blockers.push(commandIssue('folioId', 'folio_not_open'))
  const pending = await departurePending(ctx, stay)
  if (pending.total) blockers.push(commandIssue('stayId', 'departure_pending_stock'))
  return { blockers, pending }
}
export async function validateDeparture(
  ctx: Ctx,
  stay: Row,
  property: Row,
  args: Record<string, unknown>,
  at: Date,
) {
  const { blockers } = await departureBlockers(ctx, stay, property, at)
  if (blockers.length) reject(blockers[0]!.field, blockers[0]!.code)
  if (
    !Array.isArray(args.handover) ||
    args.handover.length !== DEPARTURE_CHECKS.length ||
    !DEPARTURE_CHECKS.every((key) => (args.handover as unknown[]).includes(key))
  )
    reject('handover', 'departure_handover_required')
  if (String(args.departureNotes ?? '').trim().length > 2000) reject('departureNotes', 'cleaning_note_length')
}
export const getDepartureReadinessHandler: FnSpec['handler'] = async (ctx, args) => {
  const missing = {
    stayId: args.stayId,
    stayVersion: 0,
    state: 'missing',
    ready: false,
    late: false,
    lateReasonRequired: false,
    blockers: [commandIssue('stayId', 'stay_missing')],
  }
  if (!ctx.scope.company) return missing
  const stay = await readRecord(ctx, 'hospitality_core.Stay', args.stayId)
  const property = stay ? await readRecord(ctx, 'hospitality_core.Property', stay.propertyId) : null
  if (!stay || !property || !hasPropertyScope(ctx, property)) return missing
  const room = await readRecord(ctx, 'hospitality_core.Room', stay.currentRoomId)
  const guest = await readRecord(ctx, 'partner.Partner', stay.partnerId)
  const folio = await readRecord(ctx, 'hospitality_core.Folio', stay.folioId)
  if (!folio || folio.propertyId !== property.id) return missing
  const now = new Date(),
    late = now > new Date(String(stay.checkOut))
  const { blockers, pending } = await departureBlockers(ctx, stay, property, now)
  const C = ctx.table('hospitality_core.Charge')
  const query = from(C).where(
    eq(C.companyId!, ctx.scope.company),
    eq(C.folioId, folio.id),
    eq(C.state, 'active'),
  )
  const total = await ctx.db.count(query),
    pages = Math.max(1, Math.ceil(total / 24))
  const page = Math.min(pages, Math.max(1, Math.trunc(Number(args.page) || 1)))
  const charges = await ctx.db.all(
    query
      .select(C.id, C.description, C.amount, C.quantity, C.unitPrice, C.type, C.occurredAt)
      .orderBy(asc(C.occurredAt), asc(C.id))
      .limit(24)
      .offset((page - 1) * 24),
  )
  return {
    stayId: stay.id,
    stayVersion: Number(stay.version ?? 0),
    state: stay.state,
    ready: blockers.length === 0,
    roomId: room?.id ?? null,
    roomName: room?.name ?? null,
    guestName: guest?.name ?? null,
    checkIn: stay.checkIn,
    dueOut: stay.checkOut,
    late,
    lateReasonRequired: property.enforceTimes === true && late,
    folioId: folio.id,
    folioState: folio.state,
    balance: folio.amountTotal,
    charges,
    chargesPage: { page, pages, total },
    awaitingFulfilment: pending.rows,
    pendingCount: pending.total,
    issuedKeys: Number(stay.issuedKeys ?? 1),
    blockers,
  }
}
