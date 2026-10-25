import { folioBalanceEvidence } from './folio-balances.ts'
import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as accountFunctions } from '../../account/functions.ts'
import { addDecimals, canonicalDecimalText, compareDecimals, subtractDecimals } from '../../account/money.ts'
import { isExactCurrencyValue } from '../../hospitality_core/functions/currency-value.ts'
import { dateKeyIn } from '../../hospitality_core/calendar.ts'
import {
  claimVersion,
  propertyAccess,
  readRecord,
  recordChange,
  reject,
  runCommand,
} from '../../hospitality_core/functions/command.ts'
import { billingFolio } from './accounting.ts'

export const transactionContext = (ctx: Ctx): Ctx => {
  const nested: Ctx = { ...ctx, tx: async (run) => run(nested) }
  return nested
}
const primary = (ctx: Ctx, model: string, values: Record<string, unknown> = {}) =>
  ctx.db.select(model, { ...values, companyId: ctx.scope.company })
const resultOf = (value: unknown) => value as { ok: boolean; errors?: unknown; [key: string]: unknown }
const evidenceEffects = [
  'read:hospitality_core.Reservation',
  'read:hospitality_billing.GuaranteePaymentLock',
  'write:hospitality_billing.GuaranteePaymentLock',
  'read:hospitality_billing.GuaranteeAllocation',
  'write:hospitality_billing.GuaranteeAllocation',
  'read:hospitality_billing.FolioPayment',
  'write:hospitality_billing.FolioPayment',
  'read:account.Payment',
  'read:account.Move',
  'read:account.MoveLine',
  'read:account.Journal',
  'read:account.Defaults',
  'read:partner.CompanyTerms',
  'read:partner.Partner',
  'read:company.Company',
  'read:hospitality_core.Property',
  'write:hospitality_core.Property',
  'read:hospitality_core.Folio',
  'write:hospitality_core.Folio',
  'read:hospitality_core.CommandReceipt',
  'write:hospitality_core.CommandReceipt',
  'write:hospitality_core.OperationalChange',
]

/** Only posted ledger entries count as money received. A pending or reversed entry cannot reduce a folio's balance. */
export async function folioPayments(ctx: Ctx, folioId: unknown): Promise<Row[]> {
  const links = await primary(ctx, 'hospitality_billing.FolioPayment', { folioId })
  if (!links.length) return []
  const P = ctx.table('account.Payment'),
    M = ctx.table('account.Move'),
    J = ctx.table('account.Journal')
  const payments = await ctx.db.all(
    from(P).where(
      eq(P.companyId!, ctx.scope.company),
      inArray(
        P.id,
        links.map((row) => row.paymentId),
      ),
    ),
  )
  const moves = payments.length
    ? await ctx.db.all(
        from(M).where(
          eq(M.companyId!, ctx.scope.company),
          inArray(M.id, payments.map((row) => row.moveId).filter(Boolean)),
        ),
      )
    : []
  const journals = payments.length
    ? await ctx.db.all(
        from(J).where(
          eq(J.companyId!, ctx.scope.company),
          inArray(
            J.id,
            payments.map((row) => row.journalId),
          ),
        ),
      )
    : []
  const byId = new Map(payments.map((row) => [row.id, row])),
    byMove = new Map(moves.map((row) => [row.id, row])),
    byJournal = new Map(journals.map((row) => [row.id, row]))
  return links.map((link) => {
    const payment = byId.get(link.paymentId),
      move = payment ? byMove.get(payment.moveId) : null
    return {
      id: link.id,
      paymentId: link.paymentId,
      kind: link.kind,
      amount: link.amount,
      active: link.active !== false,
      appliedAt: link.appliedAt ?? null,
      recordedAt: link.recordedAt,
      date: payment?.date ?? link.recordedAt,
      reference: payment?.paymentReference ?? null,
      journal: payment ? (byJournal.get(payment.journalId)?.name ?? null) : null,
      posted:
        !!payment &&
        ['in_process', 'paid'].includes(String(payment.state)) &&
        move?.state === 'posted' &&
        !move.reversedById,
      moveId: move?.id ?? null,
    }
  })
}

export async function folioMoney(
  ctx: Ctx,
  folio: Row,
): Promise<{ bill: Row | null; due: string; paid: string; payments: Row[]; balanceKnown: boolean }> {
  const bill = (await primary(ctx, 'hospitality_billing.FolioBill', { folioId: folio.id }))[0] ?? null
  const payments = await folioPayments(ctx, folio.id)
  const paid = payments
    .filter((row) => row.posted && row.active !== false)
    .reduce(
      (sum, row) =>
        row.kind === 'refund'
          ? subtractDecimals(sum, String(row.amount))
          : addDecimals(sum, String(row.amount)),
      '0',
    )
  const line = bill ? await readRecord(ctx, 'account.MoveLine', `${bill.moveId}:counterpart`) : null
  const invoice = bill ? await readRecord(ctx, 'account.Move', bill.moveId) : null
  return { bill, ...folioBalanceEvidence(folio, bill, invoice, line, paid), paid, payments }
}

async function claimFinancialFolio(ctx: Ctx, args: Record<string, unknown>) {
  const folio = await billingFolio(ctx, args.folioId)
  if (!folio) reject('folioId', 'folio_missing')
  const property = await propertyAccess(ctx, folio.propertyId)
  if (property.closingDate) reject('date', 'business_date_locked')
  if (
    args.accountingDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.accountingDate)) ||
      !Number.isFinite(Date.parse(`${args.accountingDate}T00:00:00Z`)) ||
      new Date(`${args.accountingDate}T00:00:00Z`).toISOString().slice(0, 10) !== args.accountingDate)
  )
    reject('accountingDate', 'date')
  if (
    args.accountingDate &&
    property.businessDate &&
    String(args.accountingDate) < String(property.businessDate)
  )
    reject('accountingDate', 'business_date_locked')
  const instant = new Date(String(args.date ?? args.invoiceDate ?? new Date().toISOString()))
  if (!Number.isFinite(instant.getTime())) reject('date', 'date')
  if (
    (args.date || args.invoiceDate) &&
    property.businessDate &&
    dateKeyIn(instant, String(property.timezone)) < String(property.businessDate)
  )
    reject('date', 'business_date_locked')
  await claimVersion(ctx, 'hospitality_core.Property', property, property.version)
  await claimVersion(ctx, 'hospitality_core.Folio', folio, args.expectedVersion)
  return { folio, property }
}

export async function receivableFor(ctx: Ctx, folio: Row): Promise<unknown> {
  const terms = (await primary(ctx, 'partner.CompanyTerms', { partnerId: folio.partnerId }))[0]
  const defaults = (await primary(ctx, 'account.Defaults'))[0]
  const id = terms?.receivableAccountId ?? defaults?.receivableAccountId
  const account = id ? await readRecord(ctx, 'account.Account', id) : null
  if (!account || account.accountType !== 'asset_receivable' || account.reconcile !== true)
    reject('journalId', 'receivable_missing')
  return id
}

async function applyAdvances(ctx: Ctx, folio: Row, invoiceId: unknown) {
  const credits = (await folioPayments(ctx, folio.id)).filter(
    (row) => row.posted && row.active !== false && !row.appliedAt && row.kind !== 'refund',
  )
  const bookings = await primary(ctx, 'hospitality_core.Reservation', { folioId: folio.id })
  for (const payment of credits) {
    await ctx.db.insertIfAbsent('hospitality_billing.GuaranteePaymentLock', {
      id: String(payment.paymentId),
      paymentId: payment.paymentId,
      version: 0,
    })
    const lock = await readRecord(ctx, 'hospitality_billing.GuaranteePaymentLock', payment.paymentId)
    if (!lock) reject('paymentId', 'transition_conflict')
    await claimVersion(ctx, 'hospitality_billing.GuaranteePaymentLock', lock, lock.version)
    const debit = await readRecord(ctx, 'account.MoveLine', `${invoiceId}:counterpart`),
      credit = await readRecord(ctx, 'account.MoveLine', `${payment.moveId}:counterpart`)
    if (
      !debit ||
      !credit ||
      compareDecimals(String(debit.amountResidual), '0') <= 0 ||
      compareDecimals(String(credit.amountResidual), '0') <= 0
    )
      continue
    if (debit.accountId !== credit.accountId || debit.partnerId !== credit.partnerId)
      reject('folioId', 'guarantee_payment')
    if (compareDecimals(String(credit.amountResidual), String(payment.amount)) < 0)
      reject('paymentId', 'guarantee_payment')
    const amount =
      compareDecimals(String(debit.amountResidual), String(payment.amount)) < 0
        ? String(debit.amountResidual)
        : String(payment.amount)
    const result = resultOf(
      await accountFunctions.reconcile!.handler(ctx, {
        id: `folio-advance:${invoiceId}:${payment.paymentId}`,
        debitMoveId: debit.id,
        creditMoveId: credit.id,
        amount,
      }),
    )
    if (!result.ok) return result
    await ctx.db.update(
      'hospitality_billing.FolioPayment',
      { id: payment.id },
      { appliedAt: new Date().toISOString() },
    )
    for (const allocation of await primary(ctx, 'hospitality_billing.GuaranteeAllocation', {
      paymentId: payment.paymentId,
      active: true,
    }))
      if (bookings.some((booking) => booking.id === allocation.reservationId))
        await ctx.db.update(
          'hospitality_billing.GuaranteeAllocation',
          { id: allocation.id },
          { active: false },
        )
  }
  return { ok: true }
}

/** Serialize financial commands with folio edits and business-day closure; the receipt commits with the ledger. */
export function financialCommands(functions: Record<string, FnSpec>): Record<string, FnSpec> {
  const invoice = functions.invoiceFolio!,
    payment = functions.recordFolioPayment!,
    read = functions.getFolioBilling!
  const effects = [
    ...new Set([
      ...evidenceEffects,
      ...(accountFunctions.registerPayment?.effects ?? []),
      ...(accountFunctions.reconcile?.effects ?? []),
    ]),
  ]
  return {
    ...functions,
    getFolioBilling: {
      ...read,
      effects: [
        ...new Set([...(read.effects ?? []), ...effects.filter((effect) => effect.startsWith('read:'))]),
      ],
      handler: async (ctx, args) => {
        const folio = await billingFolio(ctx, args.folioId)
        if (!folio) return null
        const data = (await read.handler(ctx, args)) as Row
        const money = await folioMoney(ctx, folio)
        const property = await propertyAccess(ctx, folio.propertyId)
        const journals = (await primary(ctx, 'account.Journal'))
          .filter((row) => ['cash', 'bank'].includes(String(row.type)) && row.defaultAccountId)
          .map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type }))
        return {
          ...data,
          timezone: String(property.timezone),
          version: Number(folio.version ?? 0),
          paid: money.paid,
          balance: money.due,
          balanceKnown: money.balanceKnown,
          payments: money.payments,
          buyer: money.bill
            ? {
                type: money.bill.buyerType,
                name: money.bill.buyerName,
                taxCode: money.bill.buyerTaxCode,
                address: money.bill.buyerAddress,
                email: money.bill.buyerEmail,
              }
            : null,
          journals,
        }
      },
    },
    invoiceFolio: {
      ...invoice,
      input: {
        ...invoice.input,
        expectedVersion: 'int?',
        requestKey: 'text?',
        buyerType: 'text?',
        buyerName: 'text?',
        buyerTaxCode: 'text?',
        buyerAddress: 'text?',
        buyerEmail: 'text?',
      },
      effects: [...new Set([...(invoice.effects ?? []), ...effects])],
      handler: (ctx, args) =>
        runCommand(
          ctx,
          { ...args, requestKey: args.requestKey ?? `folio-invoice:${args.folioId}` },
          'invoiceFolio',
          async (tx) => {
            const { folio, property } = await claimFinancialFolio(tx, args)
            const buyerType = String(args.buyerType ?? 'guest'),
              partner = await readRecord(tx, 'partner.Partner', folio.partnerId)
            const name = String(args.buyerName ?? partner?.name ?? '').trim(),
              taxCode = String(args.buyerTaxCode ?? '').trim(),
              address = String(args.buyerAddress ?? '').trim(),
              email = String(args.buyerEmail ?? '').trim()
            if (!['guest', 'company'].includes(buyerType) || !name || name.length > 200)
              reject('buyerName', 'invoice_buyer')
            if (buyerType === 'company' && !/^\d{10}(-?\d{3})?$/.test(taxCode))
              reject('buyerTaxCode', 'invoice_buyer')
            if ((buyerType === 'company' && !address) || address.length > 500)
              reject('buyerAddress', 'invoice_buyer')
            if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
              reject('buyerEmail', 'invoice_buyer')
            const submitted = {
              ...args,
              accountingDate: args.accountingDate ?? property.businessDate ?? undefined,
            }
            const result = resultOf(await invoice.handler(transactionContext(tx), submitted))
            if (!result.ok) return result
            const settled = await applyAdvances(transactionContext(tx), folio, result.moveId)
            if (!settled.ok) return settled
            const bill = (await primary(tx, 'hospitality_billing.FolioBill', { folioId: folio.id }))[0]
            if (bill && !bill.buyerName)
              await tx.db.update(
                'hospitality_billing.FolioBill',
                { id: bill.id },
                {
                  buyerType,
                  buyerName: name,
                  buyerTaxCode: taxCode || null,
                  buyerAddress: address || null,
                  buyerEmail: email || null,
                },
              )
            await recordChange(tx, property.id, folio.id, 'folio-invoice', { moveId: result.moveId })
            return result
          },
        ),
    },
    recordFolioPayment: {
      ...payment,
      input: { ...payment.input, expectedVersion: 'int?', requestKey: 'text?' },
      effects: [...new Set([...(payment.effects ?? []), ...effects])],
      handler: (ctx, args) =>
        runCommand(
          ctx,
          { ...args, requestKey: args.requestKey ?? `folio-payment:${args.id}` },
          'recordFolioPayment',
          async (tx) => {
            const { folio, property } = await claimFinancialFolio(tx, args)
            if (folio.state === 'cancelled') reject('folioId', 'folio_not_open')
            const money = await folioMoney(tx, folio)
            if (!money.balanceKnown) reject('folioId', 'invoice_balance_unavailable')
            let amount: string
            try {
              amount = canonicalDecimalText(String(args.amount))
            } catch {
              reject('amount', 'payment_amount')
            }
            const company = await readRecord(tx, 'company.Company', tx.scope.company)
            if (
              !isExactCurrencyValue(amount, company?.currency) ||
              compareDecimals(amount, '0') <= 0 ||
              compareDecimals(amount, money.due) > 0
            )
              reject('amount', 'payment_amount')
            const journal = await readRecord(tx, 'account.Journal', args.journalId)
            if (
              !journal ||
              !['cash', 'bank'].includes(String(journal.type)) ||
              !journal.defaultAccountId ||
              !(await readRecord(tx, 'account.Account', journal.defaultAccountId))
            )
              reject('journalId', 'journal_missing')
            const submitted = {
              ...args,
              accountingDate: args.accountingDate ?? property.businessDate ?? undefined,
            }
            const result = money.bill
              ? resultOf(await payment.handler(transactionContext(tx), submitted))
              : resultOf(
                  await accountFunctions.registerPayment!.handler(transactionContext(tx), {
                    id: args.id,
                    name: String(args.reference ?? folio.code),
                    paymentType: 'inbound',
                    partnerType: 'customer',
                    partnerId: folio.partnerId,
                    journalId: args.journalId,
                    destinationAccountId: await receivableFor(tx, folio),
                    amount,
                    date: args.date,
                    accountingDate: submitted.accountingDate,
                    memo: args.memo ?? null,
                    paymentReference: args.reference ?? null,
                  }),
                )
            if (!result.ok) return result
            await tx.db.insert('hospitality_billing.FolioPayment', {
              id: String(args.id),
              paymentId: args.id,
              folioId: folio.id,
              kind: money.bill ? 'payment' : 'advance',
              amount,
              appliedAt: money.bill ? new Date().toISOString() : null,
              recordedAt: new Date().toISOString(),
            })
            await recordChange(tx, property.id, folio.id, money.bill ? 'folio-payment' : 'folio-advance', {
              paymentId: args.id,
              amount,
            })
            return result
          },
        ),
    },
  }
}
