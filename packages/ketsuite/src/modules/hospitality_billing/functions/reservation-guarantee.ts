import { isExactCurrencyValue } from '../../hospitality_core/functions/currency-value.ts'
import { folioMoney } from './financial-commands.ts'
import { paymentCommitments, GUARANTEE_READS } from '../../hospitality_core/functions/guarantee-source.ts'
import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { addDecimals, canonicalDecimalText, subtractDecimals, compareDecimals } from '../../account/money.ts'
import {
  claimVersion,
  propertyAccess,
  readRecord,
  recordChange,
  reject,
  runCommand,
} from '../../hospitality_core/functions/command.ts'

/** Guarantee evidence is shared by standalone writes and atomic arrival; caller owns the transaction. */
export async function setReservationGuaranteeInTransaction(tx: Ctx, args: Record<string, unknown>) {
  const booking = await readRecord(tx, 'hospitality_core.Reservation', args.reservationId)
  if (!booking || !['draft', 'confirmed'].includes(String(booking.state)))
    reject('reservationId', 'reservation_transition')
  const property = await propertyAccess(tx, booking.propertyId)
  const currency = booking.currency ?? (await readRecord(tx, 'company.Company', tx.scope.company))?.currency
  if (property.closingDate) reject('reservationId', 'date_locked')
  const kind = String(args.kind)
  if (!['none', 'card', 'agent', 'deposit', 'prepaid'].includes(kind)) reject('kind', 'guarantee_kind')
  let guaranteeAmount: string | null = null
  let reference: string | null = null
  if (['card', 'agent'].includes(kind)) {
    reference = String(args.reference ?? '').trim()
    if (!/^[a-zA-Z0-9._:/-]{1,80}$/.test(reference)) reject('reference', 'guarantee_reference')
    if (kind === 'card' && /\d{12,19}/.test(reference.replace(/[ -]/g, '')))
      reject('reference', 'guarantee_reference')
    if (kind === 'agent' && ['direct', 'walk_in', 'website', ''].includes(String(booking.provider ?? '')))
      reject('kind', 'guarantee_agent')
  }
  if (kind === 'card') {
    try {
      guaranteeAmount = canonicalDecimalText(String(args.amount ?? '0'))
    } catch {
      reject('amount', 'guarantee_amount')
    }
    if (
      !isExactCurrencyValue(guaranteeAmount, currency) ||
      compareDecimals(guaranteeAmount, '0') <= 0 ||
      compareDecimals(guaranteeAmount, String(booking.amountTotal)) > 0
    )
      reject('amount', 'guarantee_amount')
  }
  if (['deposit', 'prepaid'].includes(kind)) {
    const payment = await readRecord(tx, 'account.Payment', args.paymentId)
    if (
      !payment ||
      !['in_process', 'paid'].includes(String(payment.state)) ||
      payment.paymentType !== 'inbound' ||
      payment.partnerType !== 'customer' ||
      payment.partnerId !== booking.partnerId
    )
      reject('paymentId', 'guarantee_payment')
    const move = await readRecord(tx, 'account.Move', payment.moveId)
    if (!move || move.state !== 'posted' || !!move.reversedById) reject('paymentId', 'guarantee_payment')
    const counterpart = await readRecord(tx, 'account.MoveLine', `${move.id}:counterpart`)
    if (!counterpart || counterpart.partnerId !== booking.partnerId) reject('paymentId', 'guarantee_payment')
    const available = String(counterpart.amountResidual ?? '0')
    const company = await readRecord(tx, 'company.Company', tx.scope.company)
    if (String(payment.currency) !== String(booking.currency ?? company?.currency))
      reject('paymentId', 'guarantee_currency')
    let amount: string
    try {
      amount = canonicalDecimalText(String(args.amount ?? '0'))
    } catch {
      reject('amount', 'non_negative')
    }
    if (
      !isExactCurrencyValue(amount, currency) ||
      compareDecimals(amount, '0') <= 0 ||
      compareDecimals(amount, String(payment.amount)) > 0
    )
      reject('amount', 'guarantee_amount')
    if (kind === 'prepaid' && compareDecimals(amount, String(booking.amountTotal)) < 0)
      reject('amount', 'guarantee_prepaid')
    const lockId = String(payment.id)
    await tx.db.insertIfAbsent('hospitality_billing.GuaranteePaymentLock', {
      id: lockId,
      paymentId: payment.id,
      version: 0,
    })
    const lock = await readRecord(tx, 'hospitality_billing.GuaranteePaymentLock', lockId)
    if (!lock) reject('paymentId', 'transition_conflict')
    await claimVersion(tx, 'hospitality_billing.GuaranteePaymentLock', lock, lock.version)
    const otherTotal = await paymentCommitments(tx, payment.id, booking)
    if (compareDecimals(addDecimals(otherTotal, amount), available) > 0)
      reject('amount', 'guarantee_allocated')
    const id = `${booking.id}:${payment.id}`,
      previous = await readRecord(tx, 'hospitality_billing.GuaranteeAllocation', id)
    const values = {
      reservationId: booking.id,
      paymentId: payment.id,
      amount,
      active: true,
      allocatedAt: new Date().toISOString(),
    }
    if (previous) await tx.db.update('hospitality_billing.GuaranteeAllocation', { id }, values)
    else await tx.db.insert('hospitality_billing.GuaranteeAllocation', { id, ...values })
    if (compareDecimals(amount, String(booking.amountTotal)) > 0) reject('amount', 'guarantee_amount')
    const folio = await readRecord(tx, 'hospitality_core.Folio', booking.folioId)
    if (!folio || folio.propertyId !== booking.propertyId) reject('folioId', 'folio_missing')
    const money = await folioMoney(tx, folio)
    const assigned = money.payments
      .filter((row) => row.paymentId === payment.id && row.posted && row.active !== false)
      .reduce((sum, row) => addDecimals(sum, String(row.amount)), '0')
    if (
      compareDecimals(
        addDecimals(subtractDecimals(money.paid, assigned), amount),
        String(booking.amountTotal),
      ) > 0
    )
      reject('amount', 'guarantee_amount')
    const links = await tx.db.select('hospitality_billing.FolioPayment', {
      folioId: folio.id,
      paymentId: payment.id,
      companyId: tx.scope.company,
    })
    const linked = links[0]
    if (!linked)
      await tx.db.insert('hospitality_billing.FolioPayment', {
        id: `${folio.id}:${payment.id}`,
        folioId: folio.id,
        paymentId: payment.id,
        kind: 'guarantee',
        active: true,
        amount,
        appliedAt: null,
        recordedAt: new Date().toISOString(),
      })
    else if (linked.kind === 'guarantee')
      await tx.db.update('hospitality_billing.FolioPayment', { id: linked.id }, { active: true, amount })
    await claimVersion(tx, 'hospitality_core.Folio', folio, folio.version)
    reference = String(payment.id)
    guaranteeAmount = amount
  }
  await claimVersion(tx, 'hospitality_core.Property', property, property.version)
  await claimVersion(tx, 'hospitality_core.Reservation', booking, args.expectedVersion)
  const A = tx.table('hospitality_billing.GuaranteeAllocation')
  const previous = await tx.db.all(from(A).where(eq(A.reservationId, booking.id), eq(A.active, true)))
  for (const allocation of previous)
    if (allocation.paymentId !== reference) {
      await tx.db.update('hospitality_billing.GuaranteeAllocation', { id: allocation.id }, { active: false })
      const link = await readRecord(
        tx,
        'hospitality_billing.FolioPayment',
        `${booking.folioId}:${allocation.paymentId}`,
      )
      if (link?.kind === 'guarantee' && !link.appliedAt)
        await tx.db.update('hospitality_billing.FolioPayment', { id: link.id }, { active: false })
    }
  await tx.db.update(
    'hospitality_core.Reservation',
    { id: booking.id },
    {
      ...(booking.unsecuredHold === true && kind !== 'none'
        ? { unsecuredHold: false, auditHoldUntil: null }
        : {}),
      guaranteeKind: kind,
      guaranteeAmount,
      guaranteeReference: reference,
      guaranteeVerifiedAt: kind === 'none' ? null : new Date().toISOString(),
    },
  )
  await recordChange(tx, property.id, booking.id, 'reservation-guarantee', {
    kind,
    paymentId: ['deposit', 'prepaid'].includes(kind) ? reference : null,
  })
  return { ok: true, id: booking.id, errors: [] }
}
export const setReservationGuaranteeHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'setReservationGuarantee', (tx) => setReservationGuaranteeInTransaction(tx, args))

export const reservationGuaranteeFunctions: Record<string, FnSpec> = {
  setReservationGuarantee: defineFn({
    input: {
      reservationId: 'id',
      kind: 'text',
      paymentId: 'id?',
      amount: 'decimal?',
      reference: 'text?',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    idempotent: true,
    effects: [
      ...GUARANTEE_READS,
      'read:hospitality_core.Folio',
      'write:hospitality_core.Folio',
      'read:hospitality_billing.FolioBill',
      'read:account.Journal',
      'write:hospitality_billing.FolioPayment',
      'read:hospitality_core.Property',
      'write:hospitality_core.Property',
      'read:hospitality_core.Reservation',
      'write:hospitality_core.Reservation',
      'read:hospitality_core.CommandReceipt',
      'write:hospitality_core.CommandReceipt',
      'write:hospitality_core.OperationalChange',
      'read:account.Payment',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'read:hospitality_billing.GuaranteePaymentLock',
      'write:hospitality_billing.GuaranteePaymentLock',
      'read:hospitality_billing.GuaranteeAllocation',
      'write:hospitality_billing.GuaranteeAllocation',
    ],
    handler: setReservationGuaranteeHandler,
  }),
}
