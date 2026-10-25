import { desc, eq, from, gte, inArray, lt } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { auditActorNames } from './audit-actors.ts'

// An explicit projection: audit details may contain identity or financial data.
const entityModels: Record<string, string> = {
  createReservation: 'Reservation',
  planArrival: 'Reservation',
  holdRoom: 'Stay',
  releaseRoom: 'Stay',
  checkIn: 'Stay',
  checkOut: 'Stay',
  moveRoom: 'Stay',
  'room-block': 'Room',
  'room-reopen': 'Room',
  'room-inspect': 'Room',
  'room-cleaned': 'Room',
}

/** Latest operational events in the already-authorized property's local day. */
export async function frontDeskActivity(ctx: Ctx, propertyId: unknown, start: string, end: string) {
  const H = ctx.table('hospitality_core.OperationalChange')
  const query = from(H).where(
    eq(H.companyId!, ctx.scope.company),
    eq(H.propertyId, propertyId),
    gte(H.occurredAt, start),
    lt(H.occurredAt, end),
    inArray(H.action, Object.keys(entityModels)),
  )
  const total = await ctx.db.count(query)
  const rows = await ctx.db.all(query.orderBy(desc(H.occurredAt), desc(H.id)).limit(20))
  const actors = await auditActorNames(ctx, rows)
  const codes = new Map<string, string>()
  for (const model of new Set(Object.values(entityModels))) {
    const ids = [
      ...new Set(rows.filter((row) => entityModels[String(row.action)] === model).map((row) => row.entityId)),
    ]
    if (!ids.length) continue
    const T = ctx.table(`hospitality_core.${model}`)
    const records = await ctx.db.all(
      from(T)
        .select(T.id, T.code!)
        .where(eq(T.companyId!, ctx.scope.company), eq(T.propertyId!, propertyId), inArray(T.id, ids))
        .limit(20),
    )
    for (const record of records) codes.set(`${model}:${record.id}`, String(record.code))
  }
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      action: row.action,
      occurredAt: row.occurredAt,
      actorName: actors.get(row.actorId) ?? null,
      code: codes.get(`${entityModels[String(row.action)]}:${row.entityId}`) ?? null,
    })),
  }
}
