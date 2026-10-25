import {
  guaranteeLookupFunctions,
  reservationFinancialContext as contextBooking,
  reservationPaymentChoices,
} from './guarantee-lookups.ts'
import { isExactCurrencyValue } from '../../hospitality_core/functions/currency-value.ts'
import { createHash } from 'node:crypto'
import { defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as accountFunctions } from '../../account/functions.ts'
import { canonicalDecimalText, compareDecimals, subtractDecimals } from '../../account/money.ts'
import { claimVersion, readRecord, reject, runCommand } from '../../hospitality_core/functions/command.ts'
import {
  GUARANTEE_READS,
  reservationGuaranteeValid,
} from '../../hospitality_core/functions/guarantee-source.ts'
import { folioMoney, receivableFor, transactionContext } from './financial-commands.ts'
import {
  reservationGuaranteeFunctions,
  setReservationGuaranteeInTransaction,
} from './reservation-guarantee.ts'

export const getReservationGuaranteeContextHandler: FnSpec['handler'] = async (ctx, args) => {
  const { booking, property } = await contextBooking(ctx, args.reservationId)
  const credits =
    args.includeChoices === false ? [] : await reservationPaymentChoices(ctx, booking, { limit: 100 })
  const J = ctx.table('account.Journal')
  const journals =
    args.includeChoices === false
      ? []
      : (
          await ctx.db.all(
            from(J).where(eq(J.companyId!, ctx.scope.company), inArray(J.type, ['cash', 'bank'])),
          )
        )
          .filter((row) => row.defaultAccountId)
          .map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type }))
  return {
    booking: {
      id: booking.id,
      code: booking.code,
      version: Number(booking.version ?? 0),
      amountTotal: String(booking.amountTotal),
      state: booking.state,
      guaranteeKind: booking.guaranteeKind ?? 'none',
      guaranteeReference: booking.guaranteeReference ?? null,
      guaranteeAmount: booking.guaranteeAmount ?? null,
    },
    valid: await reservationGuaranteeValid(ctx, booking),
    timezone: property.timezone,
    payments: credits,
    journals,
  }
}

/** Register and allocate a deposit in the caller-owned transaction. */
export async function takeReservationGuaranteeInTransaction(tx: Ctx, args: Record<string, unknown>) {
  const { booking, property } = await contextBooking(tx, args.reservationId)
  if (!['draft', 'confirmed'].includes(String(booking.state))) reject('reservationId', 'reservation_state')
  if (Number(args.expectedVersion) !== Number(booking.version ?? 0))
    reject('expectedVersion', 'transition_conflict')
  if (String(booking.guaranteeKind ?? 'none') !== 'none' && (await reservationGuaranteeValid(tx, booking)))
    reject('reservationId', 'guarantee_exists')
  if (property.closingDate) reject('date', 'business_date_locked')
  const folio = await readRecord(tx, 'hospitality_core.Folio', booking.folioId)
  if (!folio || folio.state !== 'open') reject('folioId', 'folio_not_open')
  const money = await folioMoney(tx, folio)
  let amount: string
  try {
    amount = canonicalDecimalText(String(args.amount))
  } catch {
    reject('amount', 'guarantee_amount')
  }
  if (
    !isExactCurrencyValue(
      amount,
      booking.currency ?? (await readRecord(tx, 'company.Company', tx.scope.company))?.currency,
    ) ||
    compareDecimals(amount, '0') <= 0 ||
    compareDecimals(amount, subtractDecimals(String(booking.amountTotal), money.paid)) > 0
  )
    reject('amount', 'guarantee_amount')
  const journal = await readRecord(tx, 'account.Journal', args.journalId)
  if (
    !journal ||
    journal.active !== true ||
    !['cash', 'bank'].includes(String(journal.type)) ||
    !journal.defaultAccountId ||
    !(await readRecord(tx, 'account.Account', journal.defaultAccountId))
  )
    reject('journalId', 'journal_missing')
  await claimVersion(tx, 'hospitality_core.Property', property, property.version)
  await claimVersion(tx, 'hospitality_core.Folio', folio, folio.version)
  const digest = createHash('sha256')
      .update(`${tx.scope.company}:${booking.id}:${args.requestKey}`)
      .digest('hex'),
    paymentId = `reservation-deposit:${digest}`
  const nested = transactionContext(tx)
  const paid = (await accountFunctions.registerPayment!.handler(nested, {
    id: paymentId,
    name: `deposit:${booking.code}`,
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: booking.partnerId,
    journalId: journal.id,
    destinationAccountId: await receivableFor(tx, folio),
    amount,
    accountingDate: property.businessDate ?? undefined,
    memo: args.memo ?? null,
    paymentReference: args.reference ?? null,
  })) as Row
  if (paid.ok !== true) return { ...paid, ok: false }
  await tx.db.insert('hospitality_billing.FolioPayment', {
    id: paymentId,
    folioId: folio.id,
    paymentId,
    kind: 'advance',
    amount,
    appliedAt: null,
    recordedAt: new Date().toISOString(),
  })
  const guaranteed = (await setReservationGuaranteeInTransaction(tx, {
    reservationId: booking.id,
    kind: 'deposit',
    paymentId,
    amount,
    expectedVersion: args.expectedVersion,
    requestKey: `deposit-guarantee:${digest}`,
  })) as Row
  return { ...guaranteed, ok: guaranteed.ok === true, paymentId }
}
export const takeReservationGuaranteeHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'takeReservationGuarantee', (tx) => takeReservationGuaranteeInTransaction(tx, args))

export const guaranteeWorkbenchFunctions: Record<string, FnSpec> = {
  ...guaranteeLookupFunctions,
  getReservationGuaranteeContext: defineFn({
    input: { reservationId: 'id', includeChoices: 'bool?' },
    effects: [
      ...GUARANTEE_READS,
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Property',
      'read:account.Journal',
    ],
    handler: getReservationGuaranteeContextHandler,
  }),
  takeReservationGuarantee: defineFn({
    input: {
      reservationId: 'id',
      amount: 'decimal',
      journalId: 'id',
      reference: 'text?',
      memo: 'text?',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', paymentId: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        ...(reservationGuaranteeFunctions.setReservationGuarantee!.effects ?? []),
        ...(accountFunctions.registerPayment!.effects ?? []),
        'read:hospitality_core.Folio',
        'write:hospitality_core.Folio',
        'read:hospitality_billing.FolioBill',
        'read:hospitality_billing.FolioPayment',
        'write:hospitality_billing.FolioPayment',
        'read:account.Defaults',
        'read:partner.CompanyTerms',
      ]),
    ],
    idempotent: true,
    handler: takeReservationGuaranteeHandler,
  }),
}
