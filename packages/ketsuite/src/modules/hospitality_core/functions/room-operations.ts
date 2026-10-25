import { randomUUID } from 'node:crypto'
import { defineFn, eq, from, inArray, lt, gte, desc } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn, zonedMidnight, zonedDateTime } from '../calendar.ts'
import { ensureLedgerRows, adjustBlockedRooms, recordInventoryChange } from '../inventory.ts'
import {
  claimVersion,
  hasPropertyScope,
  propertyAccess,
  readRecord,
  recordChange,
  reject,
  runCommand,
} from './command.ts'

const date = (value: unknown): string => {
  const text = String(value ?? '')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().slice(0, 10) !== text
  )
    reject('dateFrom', 'date')
  return text
}
const nights = (first: string, last: string) => {
  const result: string[] = []
  for (let key = first; key < last && result.length <= 90; key = addCalendarDays(key, 1)) result.push(key)
  if (!result.length || result.length > 90) reject('dateTo', 'room_block_range')
  return result
}
const room = async (ctx: Ctx, id: unknown): Promise<Row> => {
  const found = await readRecord(ctx, 'hospitality_core.Room', id)
  if (!found || !found.active) reject('roomId', 'room_missing')
  await propertyAccess(ctx, found.propertyId)
  return found
}
/** A room's operational history is its blocks, reopenings, inspections and cleanings; catalogue edits are not. */
const ROOM_EVENTS = ['room-block', 'room-reopen', 'room-inspect', 'room-cleaned']

export const blockRoomHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'blockRoom', async (tx) => {
    const target = await room(tx, args.roomId),
      property = await propertyAccess(tx, target.propertyId)
    await claimVersion(tx, 'hospitality_core.Room', target, args.expectedVersion)
    const today = dateKeyIn(new Date(), String(property.timezone))
    const first = date(args.dateFrom),
      last = date(args.dateTo),
      dates = nights(first, last)
    if (first < today || (property.businessDate && first < String(property.businessDate)))
      reject('dateFrom', 'date_locked')
    if (
      args.kind === 'ooo' &&
      property.closingDate &&
      first <= String(property.closingDate) &&
      last > String(property.closingDate)
    )
      reject('dateFrom', 'date_locked')
    if (!['ooo', 'oos'].includes(String(args.kind))) reject('kind', 'room_block_kind')
    if (args.kind === 'oos' && dates.length !== 1) reject('dateTo', 'room_block_short')
    let plannedBackAt = args.backAt ? new Date(String(args.backAt)) : null
    if (args.backLocal) {
      const time = String(args.backLocal)
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) reject('backAt', 'room_block_back')
      plannedBackAt = zonedDateTime(
        first,
        Number(time.slice(0, 2)),
        Number(time.slice(3, 5)),
        String(property.timezone),
      )
    }
    if (
      args.kind === 'oos' &&
      (!plannedBackAt ||
        !Number.isFinite(plannedBackAt.getTime()) ||
        plannedBackAt.getTime() <= Date.now() ||
        dateKeyIn(plannedBackAt, String(property.timezone)) !== first)
    )
      reject('backAt', 'room_block_back')
    const reason = String(args.reason ?? '').trim()
    if (!reason || reason.length > 300) reject('reason', 'room_block_reason')
    const start = zonedMidnight(first, String(property.timezone)).toISOString(),
      end = zonedMidnight(last, String(property.timezone)).toISOString()
    const A = tx.table('hospitality_core.RoomAssignment')
    const assignments = await tx.db.all(
      from(A).where(eq(A.roomId, target.id), inArray(A.state, ['held', 'active'])),
    )
    if (
      target.status === 'occupied' ||
      assignments.some((a) => String(a.startAt) < end && (!a.endAt || String(a.endAt) > start))
    )
      reject('roomId', 'room_held')
    const S = tx.table('hospitality_core.Stay')
    if (
      await tx.db.count(
        from(S).where(
          eq(S.currentRoomId, target.id),
          inArray(S.state, ['draft', 'checked_in']),
          lt(S.checkIn, end),
          gte(S.checkOut, start),
        ),
      )
    )
      reject('roomId', 'room_held')
    const B = tx.table('hospitality_core.RoomBlock')
    const existing = await tx.db.count(from(B).where(eq(B.roomId, target.id), eq(B.state, 'active')))
    if (existing > 0) reject('dateFrom', 'room_block_overlap')
    await tx.db.update('hospitality_core.Room', { id: target.id }, { status: 'dirty' })
    if (args.kind === 'ooo') {
      await ensureLedgerRows(tx, target.propertyId, target.roomTypeId, dates)
      for (const night of dates) await adjustBlockedRooms(tx, target.propertyId, target.roomTypeId, night, 1)
    }
    const id = randomUUID()
    await tx.db.insert('hospitality_core.RoomBlock', {
      id,
      propertyId: target.propertyId,
      roomTypeId: target.roomTypeId,
      roomId: target.id,
      kind: args.kind,
      dateFrom: first,
      dateTo: last,
      reason,
      state: 'active',
      plannedBackAt: plannedBackAt?.toISOString() ?? null,
      actorId: tx.actor,
      createdAt: new Date().toISOString(),
    })
    await recordChange(tx, target.propertyId, target.id, 'room-block', {
      blockId: id,
      kind: args.kind,
      dateFrom: first,
      dateTo: last,
      reason,
    })
    if (args.kind === 'ooo')
      await recordInventoryChange(tx, {
        propertyId: target.propertyId,
        roomTypeId: target.roomTypeId,
        kind: 'availability',
        dateFrom: first,
        dateTo: last,
      })
    return { ok: true, id, version: Number(target.version ?? 0) + 1, errors: [] }
  })

export const reopenRoomHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'reopenRoom', async (tx) => {
    const block = await readRecord(tx, 'hospitality_core.RoomBlock', args.id)
    if (!block || block.state !== 'active') reject('id', 'room_block_missing')
    if (args.roomId && block.roomId !== args.roomId) reject('roomId', 'property_mismatch')
    const target = await room(tx, block.roomId),
      property = await propertyAccess(tx, target.propertyId)
    if (block.kind === 'ooo' && property.closingDate) reject('id', 'date_locked')
    await claimVersion(tx, 'hospitality_core.Room', target, args.expectedVersion)
    const today = dateKeyIn(new Date(), String(property.timezone))
    const first = [String(block.dateFrom), today, String(property.businessDate ?? today)].sort().at(-1)!
    if (block.kind === 'ooo' && first < String(block.dateTo))
      for (const night of nights(first, String(block.dateTo)))
        await adjustBlockedRooms(tx, target.propertyId, target.roomTypeId, night, -1)
    await tx.db.update(
      'hospitality_core.RoomBlock',
      { id: block.id },
      { state: 'reopened', reopenedAt: new Date().toISOString() },
    )
    await tx.db.update('hospitality_core.Room', { id: target.id }, { status: 'dirty' })
    await recordChange(tx, target.propertyId, target.id, 'room-reopen', { blockId: block.id })
    if (block.kind === 'ooo')
      await recordInventoryChange(tx, {
        propertyId: target.propertyId,
        roomTypeId: target.roomTypeId,
        kind: 'availability',
        dateFrom: first,
        dateTo: String(block.dateTo),
      })
    return { ok: true, id: target.id, errors: [] }
  })

export const inspectRoomHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'inspectRoom', async (tx) => {
    const target = await room(tx, args.roomId)
    if (target.status !== 'inspection') reject('roomId', 'room_inspection_state')
    await claimVersion(tx, 'hospitality_core.Room', target, args.expectedVersion)
    if (args.passed !== true && !String(args.reason ?? '').trim()) reject('reason', 'required')
    await tx.db.update(
      'hospitality_core.Room',
      { id: target.id },
      { status: args.passed ? 'available' : 'dirty' },
    )
    await recordChange(tx, target.propertyId, target.id, 'room-inspect', {
      passed: args.passed,
      reason: String(args.reason ?? '').trim(),
    })
    return { ok: true, id: target.id, errors: [] }
  })

const effects = [
  'read:hospitality_core.Property',
  'read:hospitality_core.Room',
  'write:hospitality_core.Room',
  'read:hospitality_core.RoomAssignment',
  'read:hospitality_core.Stay',
  'read:hospitality_core.RoomBlock',
  'write:hospitality_core.RoomBlock',
  'read:hospitality_core.AvailabilityLedger',
  'write:hospitality_core.AvailabilityLedger',
  'write:hospitality_core.InventoryChange',
  'write:hospitality_core.OperationalChange',
  'read:hospitality_core.CommandReceipt',
  'write:hospitality_core.CommandReceipt',
]
const output = { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' }
export const roomOperationFunctions: Record<string, FnSpec> = {
  getRoomOperationsRecord: defineFn({
    input: { id: 'id' },
    output: { room: 'json?', property: 'json?', blocks: 'json', history: 'json' },
    effects: [
      'read:hospitality_core.Room',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomBlock',
      'read:hospitality_core.OperationalChange',
    ],
    handler: async (ctx, args) => {
      const target = await readRecord(ctx, 'hospitality_core.Room', args.id)
      if (!target) return { room: null, property: null, blocks: [], history: [] }
      const property = await readRecord(ctx, 'hospitality_core.Property', target.propertyId),
        B = ctx.table('hospitality_core.RoomBlock'),
        H = ctx.table('hospitality_core.OperationalChange')
      if (!property || !hasPropertyScope(ctx, property))
        return { room: null, property: null, blocks: [], history: [] }
      const [blocks, history] = await Promise.all([
        ctx.db.all(
          from(B).where(eq(B.roomId, target.id), eq(B.state, 'active')).orderBy(desc(B.createdAt)).limit(30),
        ),
        ctx.db.all(
          from(H)
            .where(eq(H.propertyId, property.id), eq(H.entityId, target.id), inArray(H.action, ROOM_EVENTS))
            .orderBy(desc(H.occurredAt))
            .limit(50),
        ),
      ])
      return {
        room: Object.fromEntries(
          ['id', 'code', 'name', 'status', 'active', 'version', 'propertyId', 'lastCleanedAt'].map((key) => [
            key,
            target[key] ?? null,
          ]),
        ),
        property: Object.fromEntries(
          ['id', 'name', 'timezone', 'businessDate', 'inspectionRequired'].map((key) => [
            key,
            property[key] ?? null,
          ]),
        ),
        blocks: blocks.map((row) =>
          Object.fromEntries(
            ['id', 'kind', 'dateFrom', 'dateTo', 'reason', 'plannedBackAt', 'createdAt'].map((key) => [
              key,
              row[key] ?? null,
            ]),
          ),
        ),
        history: history.map((row) =>
          Object.fromEntries(
            ['id', 'action', 'actorId', 'details', 'occurredAt'].map((key) => [key, row[key] ?? null]),
          ),
        ),
      }
    },
  }),
  completeRoomCleaning: defineFn({
    input: { roomId: 'id', expectedVersion: 'int', requestKey: 'text' },
    output,
    effects,
    idempotent: true,
    handler: (ctx, args) =>
      runCommand(ctx, args, 'completeRoomCleaning', async (tx) => {
        const target = await room(tx, args.roomId),
          property = await propertyAccess(tx, target.propertyId)
        if (!['dirty', 'cleaning'].includes(String(target.status))) reject('roomId', 'room_inspection_state')
        const B = tx.table('hospitality_core.RoomBlock')
        if (await tx.db.count(from(B).where(eq(B.roomId, target.id), eq(B.state, 'active'))))
          reject('roomId', 'room_block_overlap')
        await claimVersion(tx, 'hospitality_core.Room', target, args.expectedVersion)
        await tx.db.update(
          'hospitality_core.Room',
          { id: target.id },
          {
            status: property.inspectionRequired === true ? 'inspection' : 'available',
            lastCleanedAt: new Date().toISOString(),
          },
        )
        await recordChange(tx, target.propertyId, target.id, 'room-cleaned', {
          inspectionRequired: property.inspectionRequired === true,
        })
        return { ok: true, id: target.id, errors: [] }
      }),
  }),
  blockRoom: defineFn({
    input: {
      roomId: 'id',
      kind: 'text',
      dateFrom: 'date',
      dateTo: 'date',
      backAt: 'datetime?',
      backLocal: 'text?',
      reason: 'text',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output,
    effects,
    idempotent: true,
    handler: blockRoomHandler,
  }),
  reopenRoom: defineFn({
    input: { id: 'id', roomId: 'id?', expectedVersion: 'int', requestKey: 'text' },
    output,
    effects,
    idempotent: true,
    handler: reopenRoomHandler,
  }),
  inspectRoom: defineFn({
    input: { roomId: 'id', passed: 'bool', reason: 'text?', expectedVersion: 'int', requestKey: 'text' },
    output,
    effects,
    idempotent: true,
    handler: inspectRoomHandler,
  }),
  listRoomBlocks: defineFn({
    input: { propertyId: 'id', from: 'date', to: 'date' },
    output: { rows: 'json' },
    effects: ['read:hospitality_core.Property', 'read:hospitality_core.RoomBlock'],
    handler: async (ctx, args) => {
      await propertyAccess(ctx, args.propertyId)
      const B = ctx.table('hospitality_core.RoomBlock')
      return {
        rows: await ctx.db.all(
          from(B)
            .where(
              eq(B.propertyId, args.propertyId),
              eq(B.state, 'active'),
              lt(B.dateFrom, args.to),
              gte(B.dateTo, args.from),
            )
            .limit(1000),
        ),
      }
    },
  }),
}
