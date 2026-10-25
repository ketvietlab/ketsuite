import { isExactCurrencyValue } from './currency-value.ts'
import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addDecimals, compareDecimals } from '../../account/money.ts'
import { readRecord } from './command.ts'

// Optional tables are read only when Billing is installed in the current deployment.
export const GUARANTEE_READS = [
  'read:hospitality_billing.GuaranteeAllocation',
  'read:hospitality_billing.FolioPayment',
  'read:hospitality_core.Reservation',
  'read:account.Payment',
  'read:account.Move',
  'read:account.MoveLine',
  'read:company.Company',
]

/** A deposit linked to its own folio and used as its booking guarantee is one commitment, not two. */
export async function paymentCommitmentBatch(
  ctx: Ctx,
  paymentIds: unknown[],
  excluding?: Row,
): Promise<Map<unknown, string>> {
  const A = ctx.table('hospitality_billing.GuaranteeAllocation'),
    R = ctx.table('hospitality_core.Reservation'),
    F = ctx.table('hospitality_billing.FolioPayment')
  const allocations: Row[] = [],
    links: Row[] = []
  for (let index = 0; index < paymentIds.length; index += 100) {
    const ids = paymentIds.slice(index, index + 100)
    allocations.push(
      ...(await ctx.db.all(
        from(A).where(eq(A.companyId!, ctx.scope.company), inArray(A.paymentId, ids), eq(A.active, true)),
      )),
    )
    if (ctx.manifest.models['hospitality_billing.FolioPayment'])
      links.push(
        ...(await ctx.db.all(from(F).where(eq(F.companyId!, ctx.scope.company), inArray(F.paymentId, ids)))),
      )
  }
  const bookingIds = [...new Set(allocations.map((row) => row.reservationId))],
    folios = new Map<unknown, unknown>()
  for (let index = 0; index < bookingIds.length; index += 100)
    for (const row of await ctx.db.all(
      from(R)
        .select(R.id, R.folioId)
        .where(eq(R.companyId!, ctx.scope.company), inArray(R.id, bookingIds.slice(index, index + 100))),
    ))
      folios.set(row.id, row.folioId)
  const amounts = new Map<unknown, Map<unknown, string>>(),
    cash = new Map<unknown, Map<unknown, string>>()
  const add = (map: typeof amounts, payment: unknown, key: unknown, amount: string) => {
    const group = map.get(payment) ?? new Map<unknown, string>()
    group.set(key, addDecimals(group.get(key) ?? '0', amount))
    map.set(payment, group)
  }
  for (const row of allocations)
    if (row.reservationId !== excluding?.id)
      add(
        amounts,
        row.paymentId,
        folios.get(row.reservationId) ?? `reservation:${row.reservationId}`,
        String(row.amount),
      )
  for (const row of links)
    if (row.kind === 'advance' && !row.appliedAt && row.folioId !== excluding?.folioId)
      add(cash, row.paymentId, row.folioId, String(row.amount))
  for (const [payment, group] of cash) {
    const reserved = amounts.get(payment) ?? new Map<unknown, string>()
    for (const [folio, amount] of group)
      if (compareDecimals(amount, reserved.get(folio) ?? '0') > 0) reserved.set(folio, amount)
    amounts.set(payment, reserved)
  }
  return new Map(
    [...amounts].map(([payment, group]) => [
      payment,
      [...group.values()].reduce((sum, amount) => addDecimals(sum, amount), '0'),
    ]),
  )
}
export async function paymentCommitments(ctx: Ctx, paymentId: unknown, excluding?: Row): Promise<string> {
  return (await paymentCommitmentBatch(ctx, [paymentId], excluding)).get(paymentId) ?? '0'
}

/** Resolve readiness for a bounded page using batched ledger reads. */
export async function reservationGuarantees(ctx: Ctx, bookings: Row[]): Promise<Map<unknown, boolean>> {
  const result = new Map<unknown, boolean>(bookings.map((row) => [row.id, false]))
  if (!bookings.length) return result
  const company = await readRecord(ctx, 'company.Company', ctx.scope.company)
  const funded = bookings.filter(
    (row) =>
      ['deposit', 'prepaid'].includes(String(row.guaranteeKind)) &&
      row.guaranteeVerifiedAt &&
      row.guaranteeReference,
  )
  const load = async (model: string, ids: unknown[]) => {
    if (!ids.length) return [] as Row[]
    const T = ctx.table(model)
    return ctx.db.all(from(T).where(eq(T.companyId!, ctx.scope.company), inArray(T.id, [...new Set(ids)])))
  }
  const payments = ctx.manifest.models['hospitality_billing.GuaranteeAllocation']
    ? await load(
        'account.Payment',
        funded.map((row) => row.guaranteeReference),
      )
    : []
  const moves = await load(
    'account.Move',
    payments.map((row) => row.moveId),
  )
  const lines = await load(
    'account.MoveLine',
    moves.map((row) => `${row.id}:counterpart`),
  )
  const byPayment = new Map(payments.map((row) => [row.id, row])),
    byMove = new Map(moves.map((row) => [row.id, row])),
    byLine = new Map(lines.map((row) => [row.id, row]))
  const ids = payments.map((row) => row.id)
  const allocations = ids.length
    ? await ctx.db.all(
        from(ctx.table('hospitality_billing.GuaranteeAllocation')).where(
          eq(ctx.table('hospitality_billing.GuaranteeAllocation').companyId!, ctx.scope.company),
          inArray(ctx.table('hospitality_billing.GuaranteeAllocation').paymentId, ids),
          eq(ctx.table('hospitality_billing.GuaranteeAllocation').active, true),
        ),
      )
    : []
  const commitments = ids.length ? await paymentCommitmentBatch(ctx, ids) : new Map<unknown, string>()
  for (const booking of bookings) {
    const kind = String(booking.guaranteeKind ?? 'none'),
      reference = String(booking.guaranteeReference ?? '')
    if (kind === 'none' || !booking.guaranteeVerifiedAt || !reference) continue
    if (kind === 'card') {
      result.set(
        booking.id,
        isExactCurrencyValue(String(booking.guaranteeAmount ?? '0'), booking.currency ?? company?.currency) &&
          /^[a-zA-Z0-9._:/-]{1,80}$/.test(reference) &&
          !/\d{12,19}/.test(reference.replace(/[ -]/g, '')) &&
          compareDecimals(String(booking.guaranteeAmount ?? '0'), '0') > 0 &&
          compareDecimals(String(booking.guaranteeAmount ?? '0'), String(booking.amountTotal)) <= 0,
      )
      continue
    }
    if (kind === 'agent') {
      result.set(
        booking.id,
        !['direct', 'walk_in', 'website', ''].includes(String(booking.provider ?? '')) &&
          /^[a-zA-Z0-9._:/-]{1,80}$/.test(reference),
      )
      continue
    }
    if (!['deposit', 'prepaid'].includes(kind)) continue
    const payment = byPayment.get(reference),
      move = payment && byMove.get(payment.moveId),
      line = move && byLine.get(`${move.id}:counterpart`)
    if (
      !payment ||
      payment.paymentType !== 'inbound' ||
      payment.partnerType !== 'customer' ||
      !['in_process', 'paid'].includes(String(payment.state)) ||
      payment.partnerId !== booking.partnerId ||
      !move ||
      move.state !== 'posted' ||
      move.reversedById ||
      String(payment.currency) !== String(booking.currency ?? company?.currency) ||
      !line ||
      line.partnerId !== booking.partnerId
    )
      continue
    const allocation = allocations.find(
      (row) => row.paymentId === payment.id && row.reservationId === booking.id,
    )
    if (
      !allocation ||
      compareDecimals(String(allocation.amount), '0') <= 0 ||
      (kind === 'prepaid' && compareDecimals(String(allocation.amount), String(booking.amountTotal)) < 0)
    )
      continue
    result.set(
      booking.id,
      compareDecimals(String(line.amountResidual ?? '0'), commitments.get(payment.id) ?? '0') >= 0,
    )
  }
  return result
}
export async function reservationGuaranteeValid(ctx: Ctx, booking: Row): Promise<boolean> {
  return (await reservationGuarantees(ctx, [booking])).get(booking.id) ?? false
}
