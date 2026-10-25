import { asc, eq, from, gt } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { dateKeyIn } from '../calendar.ts'
import { readRecord as record, reject } from './command.ts'
import {
  addDecimals,
  canonicalDecimalText,
  compareDecimals,
  moneyMinor,
  minorText,
  percentOfMinor,
  roundedQuotient,
  scaleOf,
} from '../../account/money.ts'

/** The cancellation terms in force for a room type, resolved once at booking. */
export const cancellationTerms = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  selectedPolicyId?: unknown,
): Promise<Row> => {
  const roomType = await record(ctx, 'hospitality_core.RoomType', roomTypeId)
  const property = await record(ctx, 'hospitality_core.Property', propertyId)
  const policyId = selectedPolicyId ?? roomType?.cancellationPolicyId ?? property?.defaultCancellationPolicyId
  const policy = policyId ? await record(ctx, 'hospitality_core.CancellationPolicy', policyId) : null
  return {
    cancellationPolicyId: policy?.id,
    cancellationPolicyType: policy?.type,
    cancellationFeeRule: policy?.feeRule ?? 'percentage',
    freeCancellationHours: policy ? Number(policy.freeCancellationHours ?? 0) : undefined,
    penaltyPercent: policy ? String(policy.penaltyPercent ?? '0') : undefined,
  }
}

/**
 * The fee a policy charges for cancelling now. `penaltyPercent` was stored,
 * validated and shown for a long time without anything ever reading it, so a
 * strict or non-refundable rate cancelled exactly like a flexible one.
 */
export const cancellationFee = async (
  ctx: Ctx,
  reservation: Row,
  at: Date,
): Promise<{ amount: string; code: string; requiresAgreement?: boolean }> => {
  // Reservations booked before the snapshot existed fall back to the live
  // policy; new ones carry their own terms and are immune to later edits.
  const terms =
    reservation.cancellationPolicyType || reservation.cancellationFeeRule
      ? reservation
      : await cancellationTerms(ctx, reservation.propertyId, reservation.roomTypeId)
  if (!terms.cancellationPolicyType) return { amount: '0', code: 'policy' }
  const total = canonicalDecimalText(String(reservation.amountTotal ?? '0'))
  if (compareDecimals(total, '0') <= 0) return { amount: '0', code: 'policy' }
  const code = String(terms.cancellationPolicyType)
  if (code === 'contract') return { amount: '0', code, requiresAgreement: true }
  if (terms.cancellationFeeRule === 'template') {
    const property = await record(ctx, 'hospitality_core.Property', reservation.propertyId)
    const timezone = String(property?.timezone ?? 'UTC')
    const daysBefore =
      (Date.parse(dateKeyIn(new Date(String(reservation.checkIn)), timezone)) -
        Date.parse(dateKeyIn(at, timezone))) /
      86400000
    const freeDays: Record<string, number> = { flexible: 2, moderate: 7, strict: 14, peak: 30 }
    if (code in freeDays && daysBefore >= freeDays[code]!) return { amount: '0', code }
    const company = await record(ctx, 'company.Company', ctx.scope.company)
    const currency = String(reservation.currency ?? company?.currency ?? 'VND')
    const scale = scaleOf(currency)
    const totalMinor = moneyMinor(total, scale)
    const nights = Math.max(
      1,
      (Date.parse(dateKeyIn(new Date(String(reservation.checkOut)), timezone)) -
        Date.parse(dateKeyIn(new Date(String(reservation.checkIn)), timezone))) /
        86400000,
    )
    const first =
      reservation.bookingType === 'nightly'
        ? moneyMinor(String(reservation.rate), scale)
        : roundedQuotient(totalMinor, BigInt(nights))
    const firstNight = first > totalMinor ? totalMinor : first
    // The accepted VND templates round a half-stay penalty to the nearest 10,000 VND.
    // Other currencies retain their smallest accounting unit.
    const quantum = currency === 'VND' ? 10000n : 1n
    const half = (amount: bigint) => roundedQuotient(amount, 2n * quantum) * quantum
    const amount =
      code === 'flexible'
        ? firstNight
        : code === 'moderate'
          ? half(totalMinor)
          : code === 'strict'
            ? firstNight + half(totalMinor - firstNight)
            : totalMinor
    return { amount: minorText(amount > totalMinor ? totalMinor : amount, scale), code }
  }
  const percent = canonicalDecimalText(
    terms.cancellationPolicyType === 'non_refundable'
      ? '100'
      : at.getTime() >
          new Date(String(reservation.checkIn)).getTime() -
            Number(terms.freeCancellationHours ?? 0) * 3_600_000
        ? String(terms.penaltyPercent ?? '0')
        : '0',
  )
  if (compareDecimals(percent, '0') <= 0) return { amount: '0', code }
  const bounded = compareDecimals(percent, '100') > 0 ? '100' : percent
  const company = await record(ctx, 'company.Company', ctx.scope.company)
  const scale = scaleOf(company?.currency)
  return { amount: minorText(percentOfMinor(moneyMinor(total, scale), bounded), scale), code }
}

/** Same no-show amount for previews, desk commands and the night worker; bounded scans. */
export async function noShowFeePlan(ctx: Ctx, reservation: Row, at: Date) {
  const fee = ['none', 'prepaid'].includes(String(reservation.guaranteeKind ?? 'none'))
    ? { amount: '0', code: 'guarantee' }
    : await cancellationFee(ctx, reservation, at)
  const N = ctx.table('hospitality_core.RoomNightSnapshot')
  const base = from(N)
    .select(N.id, N.amount)
    .where(eq(N.companyId!, ctx.scope.company), eq(N.reservationId, reservation.id), eq(N.kind, 'held'))
  let after: string | null = null,
    retainedRoomAmount = '0'
  while (true) {
    const batch = await ctx.db.all((after ? base.where(gt(N.id, after)) : base).orderBy(asc(N.id)).limit(100))
    for (const night of batch) retainedRoomAmount = addDecimals(retainedRoomAmount, String(night.amount))
    if (batch.length < 100) break
    after = String(batch.at(-1)!.id)
  }
  return {
    code: fee.code,
    requiresAgreement: 'requiresAgreement' in fee && fee.requiresAgreement === true,
    retainedRoomAmount,
    amount: compareDecimals(retainedRoomAmount, fee.amount) > 0 ? retainedRoomAmount : fee.amount,
  }
}

/** A contract amount is an explicit settlement decision, never an implicit zero. */
export async function confirmCancellationAmount(
  ctx: Ctx,
  reservation: Row,
  fee: { amount: string; code: string; requiresAgreement?: boolean; retainedRoomAmount?: string },
  raw: unknown,
): Promise<string> {
  if (!fee.requiresAgreement) return fee.amount
  if (raw == null || String(raw).trim() === '') reject('contractCancellationFee', 'contract_fee_required')
  let amount: string
  try {
    amount = canonicalDecimalText(String(raw))
  } catch {
    reject('contractCancellationFee', 'contract_fee_amount')
  }
  const company = await record(ctx, 'company.Company', ctx.scope.company)
  const scale = scaleOf(reservation.currency ?? company?.currency)
  if (
    compareDecimals(amount, '0') < 0 ||
    compareDecimals(amount, String(reservation.amountTotal)) > 0 ||
    compareDecimals(amount, minorText(moneyMinor(amount, scale), scale)) !== 0
  )
    reject('contractCancellationFee', 'contract_fee_amount')
  return fee.retainedRoomAmount && compareDecimals(fee.retainedRoomAmount, amount) > 0
    ? fee.retainedRoomAmount
    : amount
}
