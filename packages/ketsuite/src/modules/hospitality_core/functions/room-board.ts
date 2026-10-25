import { dateKeyIn } from '../calendar.ts'
import { roomBoardArrivals } from './room-board-arrivals.ts'
import { asc, desc, defineFn, eq, from, inArray, gt, and, or, ilike, likeLiteral } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row, Query } from '@ketvietlab/ketjs'
import { auditActorNames } from './audit-actors.ts'
import { hasPropertyScope, readRecord } from './command.ts'
import { currentRoomBlocks, effectiveRoomStatus, roomStatusDay } from './room-blocks.ts'
import {
  hospitalityCollections,
  projectHospitalityCollectionRow,
  normalizeHospitalityCollectionQuery,
} from './collection-search.ts'

const roomDefinition = hospitalityCollections.find((item) => item.name === 'searchRooms')!
const definition = { ...roomDefinition, states: [...roomDefinition.states, 'priority'] }

type BoardRow = { id: unknown; code: string; status: string; arrivingAt: string | null }

async function* roomBoardBatches(ctx: Ctx, property: Row, base: Query, day: string) {
  const R = ctx.table('hospitality_core.Room')
  let cursor: Row | undefined
  for (;;) {
    const batch = await ctx.db.all(
      (cursor
        ? base.where(or(gt(R.code, cursor.code), and(eq(R.code, cursor.code), gt(R.id, cursor.id))))
        : base
      )
        .select(R.id, R.code, R.status)
        .orderBy(asc(R.code), asc(R.id))
        .limit(100),
    )
    if (!batch.length) break
    const blocks = await currentRoomBlocks(
      ctx,
      property,
      batch.map((row) => row.id),
      roomStatusDay(property),
    )
    const arrivals = await roomBoardArrivals(
      ctx,
      property,
      batch.map((row) => row.id),
      day,
    )
    yield batch.map((row) => ({
      id: row.id,
      code: String(row.code),
      status: effectiveRoomStatus(row.status, blocks.get(row.id)?.kind),
      arrivingAt: arrivals.get(row.id) ?? null,
    }))
    cursor = batch.at(-1)
    if (batch.length < 100) break
  }
}

/** The query API has no joins/subqueries; derived counts fold 100 scoped rooms at a time.
 * Priority uses at most 1440 clock buckets then a second bounded pass for exactly the requested page,
 * preserving global arrival-time order without retaining the property's entire room collection.
 */
async function roomBoardPage(ctx: Ctx, args: Record<string, unknown>, property: Row, day: string) {
  const query = normalizeHospitalityCollectionQuery(
    { ...args, propertyId: property.id, pageSize: 48 },
    definition,
  )
  const R = ctx.table('hospitality_core.Room')
  let base = from(R).where(
    eq(R.companyId!, ctx.scope.company),
    eq(R.propertyId, property.id),
    eq(R.active, true),
  )
  if (query.floorId) base = base.where(eq(R.floorId, query.floorId))
  if (query.q)
    base = base.where(
      or(ilike(R.code, `%${likeLiteral(query.q)}%`, true), ilike(R.name, `%${likeLiteral(query.q)}%`, true)),
    )
  const counts: Record<string, number> = Object.fromEntries(definition.states.map((state) => [state, 0]))
  const clockCounts = new Map<string, number>()
  let total = 0,
    requested: BoardRow[] = [],
    last: BoardRow[] = []
  let first: { code: string; time: string } | null = null
  for await (const batch of roomBoardBatches(ctx, property, base, day))
    for (const row of batch) {
      const waiting = row.arrivingAt !== null && row.status !== 'available'
      counts.all!++
      counts[row.status] = (counts[row.status] ?? 0) + 1
      if (waiting) {
        counts.priority!++
        clockCounts.set(row.arrivingAt!, (clockCounts.get(row.arrivingAt!) ?? 0) + 1)
        if (!first || row.arrivingAt! < first.time) first = { code: row.code, time: row.arrivingAt! }
      }
      if (query.state === 'priority' ? !waiting : query.state !== 'all' && query.state !== row.status)
        continue
      if (query.state !== 'priority') {
        const page = Math.floor(total / 48) + 1
        if (total % 48 === 0) last = []
        last.push(row)
        if (page === query.page) requested.push(row)
      }
      total++
    }
  const pages = Math.max(1, Math.ceil(total / 48)),
    page = Math.min(query.page, pages)
  let selected = query.page > pages ? last : requested
  if (query.state === 'priority' && total) {
    const offsets = new Map<string, number>(),
      seen = new Map<string, number>()
    let position = 0
    for (const [clock, count] of [...clockCounts].sort(([a], [b]) => a.localeCompare(b))) {
      offsets.set(clock, position)
      position += count
    }
    const ranked: Array<BoardRow & { rank: number }> = [],
      start = (page - 1) * 48
    for await (const batch of roomBoardBatches(ctx, property, base, day))
      for (const row of batch) {
        if (!row.arrivingAt || row.status === 'available') continue
        const index = seen.get(row.arrivingAt) ?? 0
        seen.set(row.arrivingAt, index + 1)
        const offset = offsets.get(row.arrivingAt)
        if (offset === undefined) continue
        const rank = offset + index
        if (rank >= start && rank < start + 48) {
          ranked.push({ ...row, rank })
          if (ranked.length > 48) {
            ranked.sort((a, b) => a.rank - b.rank)
            ranked.length = 48
          }
        }
      }
    selected = ranked.sort((a, b) => a.rank - b.rank).slice(0, 48)
  }
  const records = selected.length
    ? await ctx.db.all(
        base
          .where(
            inArray(
              R.id,
              selected.map((row) => row.id),
            ),
          )
          .limit(48)
          .preload(...definition.preloads!),
      )
    : []
  const byId = new Map(records.map((row) => [row.id, row]))
  const rows = selected
    .filter((row) => byId.has(row.id))
    .map((row) => ({
      ...projectHospitalityCollectionRow(byId.get(row.id)!, definition),
      status: row.status,
      arrivingAt: row.arrivingAt,
    }))
  return {
    rows,
    page,
    pages,
    total,
    counts: { state: counts },
    query: { ...query, page },
    priority: { count: counts.priority ?? 0, first },
  }
}

/** Bounded room canvas; the selected room is read independently of the current page. */
export const getRoomBoardHandler: FnSpec['handler'] = async (ctx, args) => {
  const empty = {
    property: null,
    rows: [],
    selected: null,
    total: 0,
    page: 1,
    pages: 1,
    counts: {},
    priority: { count: 0, first: null },
    query: {},
  }
  if (!ctx.scope.company) return empty
  const P = ctx.table('hospitality_core.Property')
  let properties = from(P).where(eq(P.companyId!, ctx.scope.company))
  if (ctx.scope.branches) properties = properties.where(inArray(P.branchId, ctx.scope.branches))
  const property = args.propertyId
    ? await readRecord(ctx, 'hospitality_core.Property', args.propertyId)
    : await ctx.db.one(properties.orderBy(asc(P.code), asc(P.id)).limit(1))
  if (!property || !hasPropertyScope(ctx, property)) return empty
  const day = dateKeyIn(new Date(), String(property.timezone))
  const result = await roomBoardPage(ctx, args, property, day)
  const R = ctx.table('hospitality_core.Room')
  const selected = args.peek
    ? await ctx.db.one(
        from(R)
          .where(
            eq(R.id, args.peek),
            eq(R.companyId!, ctx.scope.company),
            eq(R.propertyId, property.id),
            eq(R.active, true),
          )
          .preload('roomType', 'floor', 'building'),
      )
    : null
  let preview = selected ? projectHospitalityCollectionRow(selected, definition) : null
  if (selected && preview) {
    const T = ctx.table('hospitality_core.CleaningTask'),
      B = ctx.table('hospitality_core.RoomBlock')
    const tasks = await ctx.db.all(
      from(T)
        .where(
          eq(T.companyId!, ctx.scope.company),
          eq(T.propertyId, property.id),
          eq(T.roomId, selected.id),
          inArray(T.state, ['todo', 'in_progress']),
        )
        .orderBy(desc(T.requestedAt), asc(T.id))
        .limit(3),
    )
    const H = ctx.table('hospitality_core.OperationalChange'),
      S = ctx.table('hospitality_core.Stay')
    const latest = await ctx.db.one(
      from(H)
        .select(H.action, H.occurredAt, H.actorId!)
        .where(
          eq(H.companyId!, ctx.scope.company),
          eq(H.propertyId, property.id),
          eq(H.entityId, selected.id),
          inArray(H.action, ['room-block', 'room-reopen', 'room-inspect', 'room-cleaned']),
        )
        .orderBy(desc(H.occurredAt), desc(H.id))
        .limit(1),
    )
    const occupied = await ctx.db.one(
      from(S)
        .select(S.checkOut)
        .where(
          eq(S.companyId!, ctx.scope.company),
          eq(S.propertyId, property.id),
          eq(S.currentRoomId!, selected.id),
          eq(S.state, 'checked_in'),
        )
        .orderBy(asc(S.checkOut), asc(S.id))
        .limit(1),
    )
    const actors = await auditActorNames(ctx, [
      ...tasks.map((task) => ({ actorId: task.assigneeId })),
      ...(latest ? [latest] : []),
    ])
    const block = await ctx.db.one(
      from(B)
        .where(
          eq(B.companyId!, ctx.scope.company),
          eq(B.propertyId, property.id),
          eq(B.roomId, selected.id),
          eq(B.state, 'active'),
        )
        .orderBy(desc(B.createdAt), asc(B.id))
        .limit(1),
    )
    // The preview lists a block that starts later, but the room is out only once it has begun.
    const holding = (await currentRoomBlocks(ctx, property, [selected.id], roomStatusDay(property))).get(
      selected.id,
    )
    preview = {
      ...preview,
      arrivingAt: (await roomBoardArrivals(ctx, property, [selected.id], day)).get(selected.id) ?? null,
      status: effectiveRoomStatus(selected.status, holding?.kind),
      departingAt: occupied?.checkOut ?? null,
      latestOperation: latest
        ? {
            action: latest.action,
            occurredAt: latest.occurredAt,
            actorName: actors.get(latest.actorId) ?? null,
          }
        : null,
      tasks: tasks.map((task) => ({
        id: task.id,
        code: task.code,
        taskType: task.taskType,
        state: task.state,
        assigneeName: actors.get(task.assigneeId) ?? null,
      })),
      block: block
        ? Object.fromEntries(
            ['kind', 'dateFrom', 'dateTo', 'plannedBackAt', 'reason'].map((key) => [key, block[key] ?? null]),
          )
        : null,
    }
  }
  return {
    ...result,
    property: {
      id: property.id,
      name: property.name,
      timezone: property.timezone,
      inspectionRequired: property.inspectionRequired === true,
    },
    selected: preview,
  }
}
export const roomBoardFunctions = {
  getRoomBoard: defineFn({
    input: { propertyId: 'id?', floorId: 'id?', state: 'text?', q: 'text?', page: 'int?', peek: 'id?' },
    output: {
      property: 'json?',
      rows: 'json',
      selected: 'json?',
      total: 'int',
      page: 'int',
      pages: 'int',
      counts: 'json',
      priority: 'json',
      query: 'json',
    },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Floor',
      'read:hospitality_core.Building',
      'read:hospitality_core.CleaningTask',
      'read:hospitality_core.RoomBlock',
      'read:user.User',
      'read:hospitality_core.OperationalChange',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:hospitality_core.RoomAssignment',
    ],
    handler: getRoomBoardHandler,
  }),
}
