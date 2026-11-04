import type { Ctx, Row } from '@ketvietlab/ketjs'
import { civilDate } from '../company/civil-date.ts'
import { ours } from './scope.ts'

/** K60: when a warehouse's delivery and internal transfers take their goods. */
export const RESERVATION_METHODS = ['at_confirm', 'manual', 'by_date'] as const
export type ReservationMethod = (typeof RESERVATION_METHODS)[number]

/** Receipts take nothing from stock; only what leaves a location reserves. */
const RESERVING_CODES = ['outgoing', 'internal']
export const reservesStock = (type: Row | undefined) => RESERVING_CODES.includes(String(type?.code))

export const reservationPolicyEffects = [
  'read:stock.PickingType',
  'read:stock.Warehouse',
  'read:company.Company',
]

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Today in the company's accounting time zone, as cycle counts and receipt lots read days. */
export async function companyToday(ctx: Ctx): Promise<{ today: string; zone: string }> {
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const zone = String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh')
  return { today: civilDate(new Date(), zone), zone }
}

/**
 * The method a transfer follows and, reserving by date, the first day it may take goods: its
 * scheduled day less the warehouse's days (the priority days for a priority transfer, when set).
 * A warehouse that never chose reserves by hand, as transfers always have. A receipt, or a transfer
 * of no warehouse, has no method: nothing holds goods for it.
 */
export async function reservationPolicy(
  ctx: Ctx,
  picking: Row,
  zone?: string,
): Promise<{ method: ReservationMethod | null; reserveFrom: string | null }> {
  const type = (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
  const warehouse =
    type?.warehouseId && reservesStock(type)
      ? (await ours(ctx, 'stock.Warehouse', { id: type.warehouseId }))[0]
      : undefined
  if (!warehouse) return { method: null, reserveFrom: null }
  const method = (warehouse.reservationMethod as ReservationMethod | null) || 'manual'
  if (method !== 'by_date') return { method, reserveFrom: null }
  const days =
    picking.priority && warehouse.reservationDaysBeforePriority != null
      ? Number(warehouse.reservationDaysBeforePriority)
      : Number(warehouse.reservationDaysBefore ?? 0)
  const day = civilDate(String(picking.scheduledDate), zone ?? (await companyToday(ctx)).zone)
  return { method, reserveFrom: addDays(day, -days) }
}

/** Whether confirming takes goods at once: on confirmation, or by date once the day has come. */
export async function reservesNow(ctx: Ctx, picking: Row): Promise<boolean> {
  const { today, zone } = await companyToday(ctx)
  const policy = await reservationPolicy(ctx, picking, zone)
  return policy.method === 'at_confirm' || (policy.method === 'by_date' && policy.reserveFrom! <= today)
}

/** Transfers take goods priority first, then soonest scheduled, then by number. */
export const reservationOrder = (left: Row, right: Row) =>
  Number(Boolean(right.priority)) - Number(Boolean(left.priority)) ||
  String(left.scheduledDate).localeCompare(String(right.scheduledDate)) ||
  String(left.name).localeCompare(String(right.name))

/**
 * K60: goods a receipt or transfer brought in, or a cancellation gave back, are offered to the
 * transfers waiting for them after the change commits, in a job of the caller's company. One run per
 * transfer that freed them; the job reserves as the hourly run does.
 */
export const RESERVE_FREED_JOB = 'stock.reserveFreedTransfers'
export const reserveFreedEffects = [`enqueue:${RESERVE_FREED_JOB}`]

export async function offerFreedGoods(tx: Ctx, pickingId: unknown, productIds: unknown[]) {
  const ids = [...new Set(productIds.map(String))].sort()
  if (!ids.length) return
  await tx.jobs.enqueue(
    RESERVE_FREED_JOB,
    { productIds: ids },
    { uniqueKey: `stock.reserveFreed:${String(pickingId)}` },
  )
}

/**
 * Whether a run of its own may reserve a transfer now: its warehouse reserves on confirmation, or
 * by date once the day has come, and no person gave its goods back since.
 */
export async function reservesOnItsOwn(ctx: Ctx, picking: Row, today: string, zone: string) {
  if (picking.reservationPaused) return false
  const policy = await reservationPolicy(ctx, picking, zone)
  return policy.method === 'at_confirm' || (policy.method === 'by_date' && policy.reserveFrom! <= today)
}
