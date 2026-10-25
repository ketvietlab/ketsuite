import { and, asc, eq, from, gt, gte, inArray, lt, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { auditActorNames } from './audit-actors.ts'

/** Earliest explicitly requested early arrival whose held room still needs attention. */
export async function frontDeskAttention(ctx: Ctx, propertyId: unknown, start: string, end: string) {
  const B = ctx.table('hospitality_core.Reservation'),
    S = ctx.table('hospitality_core.Stay')
  const A = ctx.table('hospitality_core.RoomAssignment'),
    R = ctx.table('hospitality_core.Room')
  const T = ctx.table('hospitality_core.CleaningTask')
  const base = from(B).where(
    eq(B.companyId!, ctx.scope.company),
    eq(B.propertyId, propertyId),
    eq(B.state, 'confirmed'),
    eq(B.earlyArrivalRequested!, true),
    gte(B.checkIn, start),
    lt(B.checkIn, end),
  )
  let after: Row | undefined
  while (true) {
    const query = after
      ? base.where(
          or(
            gt(B.expectedArrivalTime!, after.expectedArrivalTime),
            and(eq(B.expectedArrivalTime!, after.expectedArrivalTime), gt(B.id, after.id)),
          ),
        )
      : base
    const bookings = await ctx.db.all(
      query
        .select(B.id, B.stayId, B.expectedArrivalTime!)
        .orderBy(asc(B.expectedArrivalTime!), asc(B.id))
        .limit(50),
    )
    for (const booking of bookings) {
      const stay = await ctx.db.one(
        from(S).where(
          eq(S.id, booking.stayId),
          eq(S.companyId!, ctx.scope.company),
          eq(S.propertyId, propertyId),
          eq(S.reservationId!, booking.id),
          eq(S.state, 'draft'),
        ),
      )
      if (!stay) continue
      let room: Row | undefined
      let afterAssignment: unknown = null
      while (!room) {
        let query = from(A)
          .select(A.id, A.roomId)
          .where(
            eq(A.companyId!, ctx.scope.company),
            eq(A.propertyId, propertyId),
            eq(A.stayId, stay.id),
            eq(A.state, 'held'),
          )
        if (afterAssignment) query = query.where(gt(A.id, afterAssignment))
        const held = await ctx.db.all(query.orderBy(asc(A.id)).limit(100))
        if (!held.length) break
        const rooms = await ctx.db.all(
          from(R)
            .select(R.id, R.code, R.status, R.active)
            .where(
              eq(R.companyId!, ctx.scope.company),
              eq(R.propertyId, propertyId),
              inArray(
                R.id,
                held.map((row) => row.roomId),
              ),
            )
            .orderBy(asc(R.code), asc(R.id))
            .limit(100),
        )
        room = rooms.find((row) => row.status !== 'available' || row.active !== true)
        if (held.length < 100) break
        afterAssignment = held.at(-1)!.id
      }
      if (!room) continue
      const task = await ctx.db.one(
        from(T)
          .select(T.id, T.state, T.assigneeId!, T.dueAt!)
          .where(
            eq(T.companyId!, ctx.scope.company),
            eq(T.propertyId, propertyId),
            eq(T.roomId, room.id),
            inArray(T.state, ['todo', 'in_progress']),
          )
          .orderBy(asc(T.requestedAt), asc(T.id))
          .limit(1),
      )
      const names = task?.assigneeId ? await auditActorNames(ctx, [{ actorId: task.assigneeId }]) : new Map()
      return {
        reservationId: booking.id,
        time: booking.expectedArrivalTime,
        roomCode: room.code,
        roomStatus: room.status,
        task: task
          ? {
              id: task.id,
              state: task.state,
              dueAt: task.dueAt ?? null,
              assigneeName: names.get(task.assigneeId) ?? null,
            }
          : null,
      }
    }
    if (bookings.length < 50) return null
    after = bookings.at(-1)
  }
}
