import { reservationEarlyBenefit } from './guest-benefits.ts'
import { createHash } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { moneyText, multiplyDecimals, moneyMinor, scaleOf } from '../../account/money.ts'
import { postChargeInTransaction } from '../services.ts'
import { dateKeyIn, zonedDateTime } from '../calendar.ts'
import { readRecord, recordChange, reject } from './command.ts'

/** Exact decimal arithmetic; VND follows the desk's half-night / nearest-thousand policy. */
export function earlyArrivalAmount(rate: string, currency: string): string {
  if (currency === 'VND') return String(moneyMinor(multiplyDecimals(rate, '0.0005'), 0) * 1000n)
  return moneyText(multiplyDecimals(rate, '0.5'), scaleOf(currency))
}

/** Nightly policy follows the property's standard clock, independently of a guest's ETA. */
export function beforeArrivalTime(stay: Row, property: Row, at: Date): boolean {
  const scheduled = new Date(String(stay.checkIn))
  if (stay.bookingType !== 'nightly') return at < scheduled
  const timezone = String(property.timezone)
  const [hour, minute] = String(property.defaultCheckIn).split(':').map(Number)
  return at < zonedDateTime(dateKeyIn(scheduled, timezone), hour!, minute!, timezone)
}

export async function arrivalFeePlan(ctx: Ctx, stay: Row, property: Row, at = new Date()) {
  const company = await readRecord(ctx, 'company.Company', ctx.scope.company)
  const booking = stay.reservationId
    ? await readRecord(ctx, 'hospitality_core.Reservation', stay.reservationId)
    : null
  const currency = String(booking?.currency ?? company?.currency ?? 'VND')
  const scheduled = new Date(String(stay.checkIn))
  return {
    benefit: reservationEarlyBenefit(booking),
    early: stay.bookingType === 'nightly' && beforeArrivalTime(stay, property, at),
    amount: earlyArrivalAmount(String(booking?.rate ?? stay.rate), currency),
    currency,
    arrivalDate: dateKeyIn(scheduled, String(property.timezone)),
  }
}

/** Caller owns the arrival transaction and its command receipt. */
export async function applyArrivalFee(
  ctx: Ctx,
  stay: Row,
  property: Row,
  choice: unknown,
  reason: unknown,
  at: Date,
) {
  const plan = await arrivalFeePlan(ctx, stay, property, at)
  if (!plan.early) return
  if (choice == null && plan.benefit) choice = 'waived'
  if (choice === 'waived' && !String(reason ?? '').trim() && plan.benefit)
    reason = `guest_benefit:${plan.benefit}`
  if (choice !== 'waived' && choice !== 'charged') reject('earlyFee', 'arrival_fee_choice')
  if (choice === 'waived' && !String(reason ?? '').trim()) reject('earlyReason', 'arrival_fee_reason')
  if (choice === 'charged' && moneyMinor(plan.amount, scaleOf(plan.currency)) > 0n) {
    const key = createHash('sha256')
      .update(JSON.stringify([ctx.scope.company, stay.id, 'early-arrival']))
      .digest('hex')
    const result = await postChargeInTransaction(ctx, {
      id: `early-arrival:${key}`,
      sourceKey: `early-arrival:${key}`,
      folioId: stay.folioId,
      stayId: stay.id,
      type: 'room',
      description: 'Early check-in fee',
      quantity: '1',
      unitPrice: plan.amount,
      occurredAt: at.toISOString(),
      serviceDate: dateKeyIn(at, String(property.timezone)),
    })
    if (result.ok !== true) reject('earlyFee', 'arrival_fee_posting')
  }
  await recordChange(
    ctx,
    property.id,
    stay.id,
    choice === 'charged' ? 'chargeEarlyArrival' : 'waiveEarlyArrival',
    {
      amount: choice === 'charged' ? plan.amount : '0',
      currency: plan.currency,
      reason: String(reason ?? '').trim(),
    },
  )
}
