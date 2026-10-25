import { asc, defineFn, eq, from, gte, inArray, lte, not } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn } from '../calendar.ts'
import { OUT_OF_SERVICE_ROOM_STATUSES } from '../types.ts'
import {
  changeLedger,
  ensureLedgerRows,
  InventoryConflict,
  recordInventoryChange,
  sellableRooms,
} from '../inventory.ts'
import {
  claimVersion,
  CommandRejected,
  hasPropertyScope,
  propertyAccess,
  readRecord,
  recordChange,
  reject,
  runCommand,
} from './command.ts'

const issue = (field: string, code: string, params?: Record<string, unknown>): never => {
  throw new CommandRejected({
    ok: false,
    errors: [
      { field, code, messageKey: `hospitality_core.validation.${code}`, ...(params ? { params } : {}) },
    ],
  })
}
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const positive = (value: unknown, fallback: number) =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
const reads = ['Property', 'RoomType', 'Room', 'AvailabilityLedger', 'Restriction'].map(
  (model) => `read:hospitality_core.${model}`,
)
const restrictionKeys = ['minLos', 'maxLos', 'stopSell', 'closedToArrival', 'closedToDeparture'] as const

/** One room-type page and seven nights; all related rows are read in batches. */
async function readWorkbench(ctx: Ctx, args: Record<string, unknown>) {
  const property = await readRecord(ctx, 'hospitality_core.Property', args.propertyId)
  if (!property || !hasPropertyScope(ctx, property)) return { record: null }
  const today = dateKeyIn(new Date(), String(property.timezone))
  const latest = addCalendarDays(today, 358)
  const start = validDate(args.from)
    ? args.from < today
      ? today
      : args.from > latest
        ? latest
        : args.from
    : today
  const days = Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index))
  const T = ctx.table('hospitality_core.RoomType'),
    R = ctx.table('hospitality_core.Room')
  const L = ctx.table('hospitality_core.AvailabilityLedger'),
    C = ctx.table('hospitality_core.Restriction')
  const types = from(T).where(
    eq(T.companyId!, ctx.scope.company),
    eq(T.propertyId, property.id),
    eq(T.active, true),
  )
  const total = await ctx.db.count(types),
    pages = Math.max(1, Math.ceil(total / 25)),
    page = Math.min(positive(args.page, 1), pages)
  const rows = await ctx.db.all(
    types
      .select(T.id, T.code, T.name)
      .orderBy(asc(T.name), asc(T.id))
      .limit(25)
      .offset((page - 1) * 25),
  )
  const ids = rows.map((row) => row.id)
  const [physical, ledgers, restrictions] = ids.length
    ? await Promise.all([
        ctx.db.group(
          from(R)
            .where(
              eq(R.companyId!, ctx.scope.company),
              eq(R.propertyId, property.id),
              inArray(R.roomTypeId, ids),
              eq(R.active, true),
              not(inArray(R.status, [...OUT_OF_SERVICE_ROOM_STATUSES])),
            )
            .groupBy({ col: R.roomTypeId }),
        ),
        ctx.db.all(
          from(L)
            .where(
              eq(L.companyId!, ctx.scope.company),
              eq(L.propertyId, property.id),
              inArray(L.roomTypeId, ids),
              gte(L.date, start),
              lte(L.date, days[6]),
            )
            .limit(175),
        ),
        ctx.db.all(
          from(C)
            .where(
              eq(C.companyId!, ctx.scope.company),
              eq(C.propertyId, property.id),
              inArray(C.roomTypeId, ids),
              gte(C.date, start),
              lte(C.date, days[6]),
            )
            .limit(175),
        ),
      ])
    : [[], [], []]
  const counts = new Map(physical.map((group) => [group.key[0], group.count]))
  const ledgerById = new Map(ledgers.map((row) => [String(row.id), row])),
    restrictionById = new Map(restrictions.map((row) => [String(row.id), row]))
  const roomTypes = rows.map((row) => ({
    ...row,
    physical: counts.get(row.id) ?? 0,
    nights: days.map((date) => {
      const key = `${row.id}:${date}`,
        ledger = ledgerById.get(key),
        restriction = restrictionById.get(key)
      const total = Number(ledger?.total ?? counts.get(row.id) ?? 0),
        sold = Number(ledger?.sold ?? 0),
        blocked = Number(ledger?.blocked ?? 0)
      return {
        date,
        total,
        sold,
        blocked,
        available: total - sold - blocked,
        totalManual: ledger?.totalManual === true,
        minLos: Number(restriction?.minLos ?? 0),
        maxLos: Number(restriction?.maxLos ?? 0),
        stopSell: restriction?.stopSell === true,
        closedToArrival: restriction?.closedToArrival === true,
        closedToDeparture: restriction?.closedToDeparture === true,
      }
    }),
  }))
  return {
    record: {
      property: {
        id: property.id,
        name: property.name,
        timezone: property.timezone,
        version: Number(property.version ?? 0),
        active: property.active,
        businessDate: property.businessDate,
        closingDate: property.closingDate,
      },
      today,
      from: start,
      to: days[6],
      days,
      roomTypes,
      total,
      page,
      pages,
    },
  }
}

/** Capacity and sparse selling rules commit together, including receipt and outbound change signals. */
async function changeRules(ctx: Ctx, args: Record<string, unknown>) {
  return runCommand(ctx, args, 'changeInventoryRules', async (tx) => {
    if (!String(args.requestKey ?? '').trim()) reject('requestKey', 'request_key')
    if (!Number.isSafeInteger(args.expectedVersion)) reject('expectedVersion', 'transition_conflict')
    const property = await propertyAccess(tx, args.propertyId)
    const type = await readRecord(tx, 'hospitality_core.RoomType', args.roomTypeId)
    if (!type || type.propertyId !== property.id) reject('roomTypeId', 'property_mismatch')
    if (property.active !== true) reject('propertyId', 'property_archived')
    if (type.active !== true) reject('roomTypeId', 'room_type_archived')
    if (!validDate(args.from)) reject('from', 'date')
    if (!validDate(args.to)) reject('to', 'date')
    if (args.to < args.from) reject('to', 'date_range_order')
    const today = dateKeyIn(new Date(), String(property.timezone))
    if (args.from < today) reject('from', 'inventory_date_past')
    if (args.to > addCalendarDays(today, 364)) reject('to', 'inventory_date_horizon')
    if (
      (property.businessDate && args.from < String(property.businessDate)) ||
      (property.closingDate &&
        args.from <= String(property.closingDate) &&
        args.to >= String(property.closingDate))
    )
      reject('from', 'business_date_locked')
    if (
      !Array.isArray(args.weekdays) ||
      !args.weekdays.length ||
      args.weekdays.some((value) => !Number.isInteger(value) || value < 1 || value > 7)
    )
      reject('weekdays', 'inventory_weekdays')
    const weekdays = new Set(args.weekdays)
    const dates: string[] = []
    for (let date = args.from; date <= args.to; date = addCalendarDays(date, 1))
      if (weekdays.has(new Date(`${date}T00:00:00Z`).getUTCDay() || 7)) dates.push(date)
    if (!dates.length) reject('weekdays', 'inventory_weekdays_empty')
    if (args.followRooms === true && args.total !== undefined) reject('total', 'inventory_total_conflict')
    const physical = await sellableRooms(tx, property.id, type.id)
    if (
      args.total !== undefined &&
      (!Number.isSafeInteger(args.total) || Number(args.total) < 0 || Number(args.total) > physical)
    )
      issue('total', 'inventory_total_physical', { count: physical })
    const patch: Row = {}
    for (const field of ['minLos', 'maxLos'] as const)
      if (args[field] !== undefined) {
        if (!Number.isInteger(args[field]) || Number(args[field]) < 1 || Number(args[field]) > 30)
          reject(field, 'inventory_los_limit')
        patch[field] = args[field] === (field === 'minLos' ? 1 : 30) ? 0 : args[field]
      }
    for (const field of ['stopSell', 'closedToArrival', 'closedToDeparture'] as const)
      if (args[field] !== undefined) patch[field] = args[field]
    const capacity = args.total !== undefined || args.followRooms === true
    if (!capacity && !Object.keys(patch).length) reject('change', 'inventory_change_required')
    const T = tx.table('hospitality_core.Restriction')
    const current = await tx.db.all(
      from(T)
        .where(
          eq(T.companyId!, tx.scope.company),
          eq(T.propertyId, property.id),
          eq(T.roomTypeId, type.id),
          inArray(T.date, dates),
        )
        .limit(365),
    )
    const byDate = new Map(current.map((row) => [String(row.date), row]))
    const plans = dates.map((date) => {
      const before = byDate.get(date)
      const after = {
        minLos: 0,
        maxLos: 0,
        stopSell: false,
        closedToArrival: false,
        closedToDeparture: false,
        ...Object.fromEntries(
          restrictionKeys.map((key) => [key, before?.[key] ?? (key.endsWith('Los') ? 0 : false)]),
        ),
        ...patch,
      }
      if (Number(after.maxLos) > 0 && Number(after.minLos) > Number(after.maxLos))
        issue(patch.minLos !== undefined ? 'minLos' : 'maxLos', 'inventory_los_conflict', {
          date,
          min: after.minLos,
          max: after.maxLos,
        })
      return { date, before, after }
    })
    await claimVersion(tx, 'hospitality_core.Property', property, args.expectedVersion)
    if (capacity) {
      await ensureLedgerRows(tx, property.id, type.id, dates)
      try {
        for (const date of dates)
          await changeLedger(tx, property.id, type.id, date, (row) => {
            const total = args.followRooms === true ? physical : Number(args.total)
            const sold = Number(row.sold),
              blocked = Number(row.blocked)
            if (total < sold + blocked)
              return {
                field: 'total',
                code: 'inventory_capacity',
                messageKey: 'hospitality_core.validation.inventory_capacity',
                params: { date, total, committed: sold + blocked },
              }
            return { total, sold, blocked, totalManual: args.followRooms !== true }
          })
      } catch (error) {
        if (error instanceof InventoryConflict)
          throw new CommandRejected({ ok: false, errors: [error.problem] })
        throw error
      }
    }
    if (Object.keys(patch).length)
      for (const plan of plans) {
        const id = `${type.id}:${plan.date}`
        if (!plan.before) {
          const inserted = await tx.db.insertIfAbsent('hospitality_core.Restriction', {
            id,
            propertyId: property.id,
            roomTypeId: type.id,
            date: plan.date,
            ...plan.after,
            version: 1,
          })
          if (!('inserted' in inserted) || !inserted.inserted)
            reject('expectedVersion', 'transition_conflict')
        } else {
          const changed = await tx.db.compareAndSet(
            'hospitality_core.Restriction',
            { id },
            { version: plan.before.version },
            { ...plan.after, version: Number(plan.before.version) + 1 },
          )
          if (!('matched' in changed) || !changed.matched) reject('expectedVersion', 'transition_conflict')
        }
      }
    for (const kind of [
      ...(capacity ? ['availability' as const] : []),
      ...(Object.keys(patch).length ? ['restriction' as const] : []),
    ])
      await recordInventoryChange(tx, {
        propertyId: property.id,
        roomTypeId: type.id,
        kind,
        dateFrom: args.from,
        dateTo: args.to,
      })
    await recordChange(tx, property.id, type.id, 'changeInventoryRules', {
      dates,
      total: args.followRooms ? 'physical' : args.total,
      patch,
    })
    return { ok: true, count: dates.length, version: Number(property.version ?? 0) + 1 }
  })
}

export const inventoryWorkbenchFunctions = {
  getInventoryWorkbench: defineFn({
    input: { propertyId: 'id', from: 'date?', page: 'int?' },
    output: { record: 'json?' },
    effects: reads,
    handler: (ctx, args) => ctx.tx((tx) => readWorkbench(tx, args)),
  }),
  changeInventoryRules: defineFn({
    input: {
      propertyId: 'id',
      roomTypeId: 'id',
      expectedVersion: 'int',
      requestKey: 'text',
      from: 'date',
      to: 'date',
      weekdays: 'json',
      total: 'int?',
      followRooms: 'bool?',
      minLos: 'int?',
      maxLos: 'int?',
      stopSell: 'bool?',
      closedToArrival: 'bool?',
      closedToDeparture: 'bool?',
    },
    output: { ok: 'bool', errors: 'json?', count: 'int?', version: 'int?' },
    effects: [
      ...reads,
      'write:hospitality_core.Property',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.Restriction',
      'write:hospitality_core.InventoryChange',
      'read:hospitality_core.CommandReceipt',
      'write:hospitality_core.CommandReceipt',
      'write:hospitality_core.OperationalChange',
    ],
    handler: changeRules,
  }),
}
