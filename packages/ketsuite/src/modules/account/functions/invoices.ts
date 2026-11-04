import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { accountingDateText } from '../date.ts'
import {
  canonicalDecimalText,
  compareDecimals,
  decimalSign,
  minorText,
  MONEY_POLICY_VERSION,
  moneyMinor,
  sumMoneyMinor,
} from '../money.ts'
import {
  invalid,
  Refusal,
  refused,
  rowMatches,
  instantText,
  MOVE_LINE_CREATE_FIELDS,
  today,
} from '../validation.ts'
import { ledgerOf, accountOf } from '../ledger.ts'
import { ACCOUNT_RESOLUTION_EFFECTS, resolveAccounts } from '../account-resolution.ts'
import { dueDate } from '../payment-terms.ts'
import {
  type TaxShare,
  type LineAmounts,
  taxAmounts,
  discountTaxes,
  settlesEarlierDocument,
  taxInEffect,
} from '../tax-quote.ts'

export async function createInvoiceHandler(ctx: Ctx, args: Row) {
  if (
    !['out_invoice', 'out_refund', 'in_invoice', 'in_refund', 'out_receipt', 'in_receipt'].includes(
      String(args.moveType),
    )
  )
    return invalid('moveType', 'invoiceTypeRequired')
  const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
  if (!journal) return invalid('journalId', 'journalMissing')
  const customerDocument = ['out_invoice', 'out_refund', 'out_receipt'].includes(String(args.moveType))
  if (journal.type !== (customerDocument ? 'sale' : 'purchase'))
    return invalid('journalId', customerDocument ? 'journalMustBeSale' : 'journalMustBePurchase')

  // One shape or the other. Accepting both would leave the shorthand's line
  // either silently dropped or silently appended, and neither is obvious
  // from the call site.
  const many = args.lines !== undefined && args.lines !== null
  if (many && args.description !== undefined) return invalid('lines', 'invoiceLinesAndSingle')
  const given: unknown[] = many ? (Array.isArray(args.lines) ? args.lines : []) : [args]
  if (many && !given.length) return invalid('lines', 'invoiceLinesEmpty')
  if (!many && (args.description === undefined || args.description === null))
    return invalid('description', 'invoiceLineRequired')

  const { currency, scale, timezone } = await ledgerOf(ctx)
  const invoiceDate = instantText(args.invoiceDate ?? today())
  const accountingDate = accountingDateText(args.accountingDate ?? invoiceDate, timezone)
  const documentDate = accountingDateText(args.documentDate ?? invoiceDate, timezone)
  const settles = settlesEarlierDocument(args)

  /** A line as it will be written, with its taxes already applied. */
  type Priced = {
    spec: Record<string, unknown>
    accountId: unknown
    amounts: LineAmounts
    firstTaxId: unknown
  }
  const priced: Priced[] = []
  // Tax shares are accumulated across the whole document: two lines at the
  // same rate post one tax line, as a paper invoice shows one VAT figure per
  // rate rather than one per row.
  const shares = new Map<string, TaxShare & { accountId: unknown }>()

  for (const [at, entry] of given.entries()) {
    const spec = (entry ?? {}) as Record<string, unknown>
    const where = many ? `lines.${at}` : 'description'
    if (spec.description === undefined || spec.description === null)
      return invalid(where, 'invoiceLineRequired')

    const resolved = await resolveAccounts(
      ctx,
      { moveType: String(args.moveType), partnerId: args.partnerId, productId: spec.productId },
      { lineAccountId: spec.lineAccountId },
    )
    if (!resolved.lineAccountId) return invalid(many ? where : 'lineAccountId', 'lineAccountUndecided')
    if (!(await accountOf(ctx, resolved.lineAccountId)))
      return invalid(many ? where : 'lineAccountId', 'invoiceAccountsMissing')

    // `taxId` stays accepted so existing callers keep working; `taxIds` is how a
    // line carries the sequence of taxes that compound into one another.
    const wanted = [
      ...(Array.isArray(spec.taxIds) ? spec.taxIds.map(String) : []),
      ...(spec.taxId ? [String(spec.taxId)] : []),
    ].filter((id, index, all) => all.indexOf(id) === index)
    const taxes: Row[] = []
    for (const id of wanted) {
      const tax = (await ctx.db.select('account.Tax', { id }))[0]
      if (!tax) return invalid(many ? where : 'taxIds', 'taxMissing')
      if (![customerDocument ? 'sale' : 'purchase', 'none'].includes(String(tax.typeTaxUse)))
        return invalid(many ? where : 'taxIds', 'taxDirectionMismatch', { name: tax.name })
      if (!settles && !taxInEffect(tax, documentDate))
        return invalid(many ? where : 'taxIds', 'taxOutOfEffect', { name: tax.name, date: documentDate })
      taxes.push(tax)
    }

    let amounts: LineAmounts
    try {
      const quantity = canonicalDecimalText(spec.quantity ?? '1')
      const priceUnit = canonicalDecimalText(spec.priceUnit ?? '0')
      const discount = canonicalDecimalText(spec.discount ?? '0')
      if (
        decimalSign(quantity) <= 0 ||
        (spec.lineKind === 'discount' ? decimalSign(priceUnit) > 0 : decimalSign(priceUnit) < 0) ||
        decimalSign(discount) < 0 ||
        compareDecimals(discount, '100') > 0
      )
        return invalid(where, 'taxPriceInvalid')
      amounts = taxAmounts(
        spec.lineKind === 'discount' ? discountTaxes(taxes) : taxes,
        quantity,
        priceUnit,
        discount,
        scale,
      )
      spec.quantity = quantity
      spec.priceUnit = priceUnit
      spec.discount = discount
    } catch (error) {
      return refused(many ? where : 'taxIds', error)
    }

    // Each tax posts to its own account. A single override stays meaningful only
    // while there is one tax to override.
    for (const held of amounts.shares) {
      if (moneyMinor(held.amount, scale) === 0n) continue
      const accountId = (amounts.shares.length === 1 ? spec.taxAccountId : null) ?? held.accountId
      if (!accountId || !(await accountOf(ctx, accountId)))
        return invalid(many ? where : 'taxAccountId', 'taxPostingAccountMissing', { name: held.name })
      const key = `${String(held.taxId)}:${String(accountId)}`
      const running = shares.get(key)
      if (running)
        running.amount = minorText(moneyMinor(running.amount, scale) + moneyMinor(held.amount, scale), scale)
      else shares.set(key, { ...held, accountId })
    }

    priced.push({
      spec,
      accountId: resolved.lineAccountId,
      amounts,
      firstTaxId: taxes[0]?.id ?? null,
    })
  }

  // After the lines, so a document with nothing to post still reports the
  // revenue account it could not decide before the receivable one.
  const resolvedCounterpart = await resolveAccounts(
    ctx,
    { moveType: String(args.moveType), partnerId: args.partnerId },
    { counterpartAccountId: args.counterpartAccountId },
  )
  if (!resolvedCounterpart.counterpartAccountId)
    return invalid('counterpartAccountId', 'counterpartAccountUndecided')
  const counterpart = await accountOf(ctx, resolvedCounterpart.counterpartAccountId)
  if (!counterpart) return invalid('counterpartAccountId', 'invoiceAccountsMissing')
  if (counterpart.accountType !== (customerDocument ? 'asset_receivable' : 'liability_payable'))
    return invalid(
      'counterpartAccountId',
      customerDocument ? 'counterpartMustBeReceivable' : 'counterpartMustBePayable',
    )

  const untaxed = sumMoneyMinor(
    priced.map((line) => line.amounts.untaxed),
    scale,
  )
  const tax = sumMoneyMinor(
    [...shares.values()].map((held) => held.amount),
    scale,
  )
  const total = untaxed + tax
  if (total < 0n || !priced.some((line) => line.spec.lineKind !== 'discount'))
    return invalid('lines', 'taxPriceInvalid')
  const posting = [...shares.values()]

  // A term sets the due date (D15); without one the document may carry its own, never
  // before the day it was issued.
  const typedDue =
    !args.paymentTermId && args.invoiceDateDue ? String(args.invoiceDateDue).slice(0, 10) : null
  if (typedDue && typedDue < invoiceDate.slice(0, 10)) return invalid('invoiceDateDue', 'dueBeforeInvoice')
  const due = typedDue
    ? new Date(`${typedDue}T00:00:00.000Z`).toISOString()
    : await dueDate(ctx, args.paymentTermId, new Date(invoiceDate))
  const mainDebit = ['in_invoice', 'in_receipt', 'out_refund'].includes(String(args.moveType))
  const moveRow: Row = {
    id: args.id,
    name: String(args.id),
    ref: args.ref ?? null,
    date: invoiceDate,
    accountingDate,
    documentDate,
    moveType: args.moveType,
    state: 'draft',
    journalId: args.journalId,
    partnerId: args.partnerId,
    invoiceDate,
    invoiceDateDue: due,
    paymentTermId: args.paymentTermId ?? null,
    paymentState: 'not_paid',
    currency,
    amountUntaxed: minorText(untaxed, scale),
    amountTax: minorText(tax, scale),
    amountTotal: minorText(total, scale),
    moneyPolicyVersion: MONEY_POLICY_VERSION,
    postedAt: null,
    revision: 0,
  }
  const lineRows: Row[] = []
  const line = (
    id: string,
    accountId: unknown,
    amount: unknown,
    debitSide: boolean,
    name: string,
    reconcilable: boolean,
    extra: Row = {},
  ): void => {
    const minor = typeof amount === 'bigint' ? amount : moneyMinor(amount, scale)
    lineRows.push({
      id,
      moveId: args.id,
      name,
      accountId,
      partnerId: args.partnerId,
      productId: null,
      productUomId: null,
      quantity: '1',
      priceUnit: minorText(minor, scale),
      discount: '0',
      taxId: null,
      debit: debitSide ? minorText(minor, scale) : minorText(0n, scale),
      credit: debitSide ? minorText(0n, scale) : minorText(minor, scale),
      balance: minorText(debitSide ? minor : -minor, scale),
      dateMaturity: null,
      displayType: null,
      reconciled: false,
      amountResidual: minorText(reconcilable ? minor : 0n, scale),
      sequence: 10,
      ...extra,
    })
  }
  for (const [at, held] of priced.entries())
    line(
      // The first line keeps the historical id, so a single-line document
      // written through either shape lands on exactly the same row.
      at === 0 ? `${String(args.id)}:base` : `${String(args.id)}:base:${at}`,
      held.accountId,
      held.amounts.untaxed,
      mainDebit,
      String(held.spec.description),
      false,
      {
        productId: held.spec.productId ?? null,
        productUomId: held.spec.productUomId ?? null,
        quantity: held.spec.quantity,
        lineKind: held.spec.lineKind === 'discount' ? 'discount' : null,
        priceUnit: held.spec.priceUnit,
        discount: held.spec.discount,
        taxId: held.firstTaxId,
        sequence: 10 + at,
      },
    )
  for (const [at, held] of posting.entries())
    line(
      // The first tax line keeps the historical id so an existing document
      // reprocessed by id lands on the same rows.
      at === 0 ? `${String(args.id)}:tax` : `${String(args.id)}:tax:${String(held.taxId)}`,
      held.accountId,
      held.amount,
      mainDebit,
      held.name,
      false,
      { taxId: held.taxId, sequence: 10 + priced.length + at },
    )
  line(
    `${String(args.id)}:counterpart`,
    resolvedCounterpart.counterpartAccountId,
    total,
    !mainDebit,
    String(args.ref ?? priced[0]?.spec.description ?? args.id),
    true,
    { dateMaturity: due, sequence: 10 + priced.length + posting.length },
  )

  try {
    const amountTotal = await ctx.tx(async (tx) => {
      const inserted = await tx.db.insertIfAbsent('account.Move', moveRow)
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const existing = (await tx.db.select('account.Move', { id: args.id }))[0]
        const moveFields = [
          'journalId',
          'moveType',
          'ref',
          'partnerId',
          'paymentTermId',
          'currency',
          'amountUntaxed',
          'amountTax',
          'amountTotal',
          'moneyPolicyVersion',
          ...(args.invoiceDate == null ? [] : ['date', 'invoiceDate']),
          ...(args.invoiceDate == null && args.invoiceDateDue == null && args.paymentTermId == null
            ? []
            : ['invoiceDateDue']),
          ...(args.accountingDate == null && args.invoiceDate == null ? [] : ['accountingDate']),
          ...(args.documentDate == null && args.invoiceDate == null ? [] : ['documentDate']),
        ]
        const storedLines = await tx.db.select('account.MoveLine', { moveId: args.id })
        const lineFields =
          args.invoiceDate == null
            ? MOVE_LINE_CREATE_FIELDS.filter((field) => field !== 'dateMaturity')
            : MOVE_LINE_CREATE_FIELDS
        const byLineId = new Map(storedLines.map((held) => [String(held.id), held]))
        const sameLines =
          storedLines.length === lineRows.length &&
          lineRows.every((wanted) => {
            const held = byLineId.get(String(wanted.id))
            return Boolean(held && rowMatches(held, wanted, lineFields))
          })
        if (!existing || !rowMatches(existing, moveRow, moveFields) || !sameLines)
          throw new Refusal('invoiceIdReused')
        return String(existing.amountTotal)
      }
      for (const row of lineRows) await tx.db.insert('account.MoveLine', row)
      return minorText(total, scale)
    })
    return { ok: true, id: args.id, amountTotal }
  } catch (error) {
    return refused('id', error)
  }
}

export const createInvoiceFunction = defineFn({
  input: {
    id: 'id',
    journalId: 'id',
    moveType: 'text',
    partnerId: 'id',
    invoiceDate: 'datetime?',
    accountingDate: 'date?',
    documentDate: 'date?',
    paymentTermId: 'id?',
    /** The due date of a document without a payment term; a term computes its own. */
    invoiceDateDue: 'date?',
    ref: 'text?',
    /**
     * The lines of the document, when there is more than one.
     *
     * `{ description, quantity, priceUnit, productId?, productUomId?,
     * discount?, taxId?, taxIds?, lineAccountId?, taxAccountId? }` — the same
     * fields as the shorthand below, per line. Give this or the shorthand,
     * never both.
     */
    lines: 'json?',
    description: 'text?',
    lineKind: 'text?',
    productId: 'id?',
    productUomId: 'id?',
    quantity: 'decimal?',
    priceUnit: 'decimal?',
    discount: 'decimal?',
    // Optional: left out, they come from the product's category, the partner,
    // and the company's defaults, in that order.
    lineAccountId: 'id?',
    counterpartAccountId: 'id?',
    taxId: 'id?',
    taxIds: 'json?',
    taxAccountId: 'id?',
  },
  output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
  effects: [
    'read:account.Journal',
    'read:account.Tax',
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.PaymentTermLine',
    'read:company.Company',
    ...ACCOUNT_RESOLUTION_EFFECTS,
    'write:account.Move',
    'write:account.MoveLine',
  ],
  idempotent: true,
  agent: true,
  handler: createInvoiceHandler,
})

export const invoicesFunctions: Record<string, FnSpec> = {
  createInvoice: createInvoiceFunction,
}
