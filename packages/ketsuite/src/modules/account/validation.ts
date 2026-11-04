import type { Ctx, Row } from '@ketvietlab/ketjs'

/**
 * Every way this module can say no, in one place.
 *
 * A refusal travels as a code, because the words belong to whoever is reading:
 * a backend screen translates it, and a ledger read in Vietnamese must not grow
 * English prose. The sentence here is the same reason for an API client or a log
 * that has no translator, and `{name}` placeholders are filled from `params`.
 */
export const REFUSALS = {
  moveMissing: 'journal entry does not exist',
  moveDraftOnly: 'only a draft entry can be posted',
  movePostedOnly: 'only a posted entry can be reversed',
  moveNotCancellable: 'a posted entry is corrected with account.reverseMove, not cancelled',
  moveConcurrent: 'the invoice changed concurrently; review it and retry',
  moveIdReused: 'a different journal entry already uses this id',
  moveTypeUnsupported: 'unsupported move type',
  linesTooFew: 'a journal entry needs at least two lines',
  lineSideBoth: 'each line must have a non-negative debit or credit, never both',
  lineAmountRequired: 'each journal item needs a non-zero debit or credit',
  lineBalanceInvalid: 'journal item balance must equal debit minus credit',
  lineResidualInvalid: 'journal item residual is inconsistent with its account and balance',
  entryUnbalanced: 'entry is not balanced: debit {debit}, credit {credit}',
  moveTotalInvalid: 'document totals do not match its open-item counterparts',
  reversalNoLines: 'the entry has no journal items to reverse',
  reversalIdReused: 'a different reversal already uses this id',
  moveAlreadyReversed: 'the entry already has a different reversal',
  moveSourceOwned: 'the entry belongs to another module; correct it from that document',
  lineDraftOnly: 'lines can only be added to a draft entry',
  lineIdTaken: 'a different journal item already uses this id',
  moneyExactString: 'money values must be canonical decimal strings without exponent notation',
  accountingDateInvalid: 'accounting and document dates must be valid civil dates',
  moveCurrencyMismatch: 'journal entry currency must match the active company ledger',
  periodLocked: 'the {scope} books are locked through {through}',
  periodConcurrent: 'the accounting period policy changed; review and retry',
  periodKindLocked: 'this kind of document is locked ahead in the period {dateFrom} – {dateTo}',

  accountMissing: 'account does not exist',
  accountInactive: 'inactive accounts cannot receive new journal items',
  accountTypeUnsupported: 'unsupported account type',
  accountCodeFormat: 'account code may contain only letters, numbers, and dots',
  offBalanceReconcile: 'off-balance accounts cannot be reconciled',
  defaultAccountMissing: 'default account does not exist',

  journalMissing: 'journal does not exist',
  journalInactive: 'inactive journals cannot post new entries',
  journalTypeUnsupported: 'unsupported journal type',
  journalCodeFormat: 'journal code must be alphanumeric',
  journalMustBeSale: 'a customer document requires a sale journal',
  journalMustBePurchase: 'a vendor document requires a purchase journal',
  journalLiquidityMissing: 'payment journal needs a default liquidity account',
  journalLiquidityAccount: 'a bank or cash journal must default to a cash account',
  journalNotLiquidity: 'payments require a bank or cash journal',
  journalNotStoredValue: 'stored value settlements require a general journal',
  journalStoredValueAccount: 'stored value settlements require a liability default account',

  taxMissing: 'tax does not exist',
  taxUseUnsupported: 'unsupported tax use',
  taxComputationUnsupported: 'unsupported tax computation',
  taxScopeUnsupported: 'tax scope must be service or consu',
  taxAccountMissing: 'tax account does not exist',
  taxAccountRoot: 'this tax posts to an account under {roots}',
  taxAccountRootFormat: 'tax account branches are a list of account codes',
  taxDirectionMismatch: 'tax "{name}" does not match the invoice direction',
  taxOutOfEffect: 'tax "{name}" is not in effect on {date}',
  taxEffectRange: 'a tax cannot stop applying before it starts',
  taxPostingAccountMissing: 'tax "{name}" needs a valid posting account',
  taxMixedPriceInclude: 'a line cannot mix price-included and price-excluded taxes',
  taxManyPriceInclude: 'a line supports at most one price-included tax',
  taxDivisionFull: 'a division tax of 100% or more has no finite base',
  productMissing: 'product template does not exist',
  taxFixedExceedsLine: 'a price-included fixed tax cannot be larger than the line it is inside',
  taxQuantityPositive: 'line quantity must be positive',
  taxPriceInvalid: 'unit price and discount are invalid',

  partnerMissing: 'partner does not exist',
  paymentTermMissing: 'payment term does not exist',
  termValueUnsupported: 'value must be percent or fixed',
  termDelayUnsupported: 'unsupported delay type',
  termPercentRange: 'percentage must be between 0 and 100',

  invoiceTypeRequired: 'createInvoice requires an invoice, refund, or receipt type',
  invoiceIdReused: 'a different invoice already uses this id',
  invoiceAccountsMissing: 'invoice accounts do not exist',
  invoiceLinesAndSingle: 'give either lines or a single description, not both',
  invoiceLinesEmpty: 'an invoice needs at least one line',
  invoiceLineRequired: 'every invoice line needs a description',
  lineAccountUndecided:
    'no revenue or expense account was given, and neither the product category nor the company has a default',
  counterpartAccountUndecided:
    'no receivable or payable account was given, and neither the partner nor the company has a default',
  categoryMissing: 'the product category does not exist',
  defaultAccountType: 'that account type cannot serve as this default',
  defaultPinned: 'the accounting standard fixes this default',
  dueBeforeInvoice: 'the due date cannot be before the invoice date',
  counterpartMustBeReceivable: 'the counterpart account must be a receivable account',
  counterpartMustBePayable: 'the counterpart account must be a payable account',

  paymentTypeUnsupported: 'payment type must be inbound or outbound',
  paymentIdReused: 'a different payment already uses this id',
  partnerTypeUnsupported: 'partner type must be customer or supplier',
  paymentSettlementKindUnsupported: 'settlement kind must be liquidity or stored value',
  storedValueOperationUnsupported: 'stored value balance operation must be issue or expire',
  storedValueCounterpart: 'stored value issue needs an asset counterpart and expiry needs income',
  amountPositive: 'payment amount must be positive',
  destinationMissing: 'destination account does not exist',
  destinationMustBeReceivable: 'a customer payment must settle a receivable account',
  destinationMustBePayable: 'a supplier payment must settle a payable account',
  openItemMissing: 'open item does not exist',
  openItemAccountMismatch: 'open item uses another destination account',
  openItemDirection: 'open item has the wrong debit or credit direction',
  amountExceedsOpenItem: 'payment amount exceeds the selected open item',
  invoicePaymentType: 'only a customer invoice can collect a payment',
  invoicePaymentState: 'only a posted customer invoice can collect a payment',
  invoicePaymentResidual: 'the customer invoice has no amount left to collect',
  invoicePaymentAccounts: 'one mobile payment cannot settle several receivable accounts',

  reconcileAmountPositive: 'reconciliation amount must be positive',
  reconcileSides: 'reconciliation needs one debit and one credit line',
  reconcileAccountMismatch: 'reconciled lines must use the same account',
  reconcilePostedOnly: 'only posted journal items can be reconciled',
  reconcileNotAllowed: 'this account does not allow reconciliation',
  reconcileAmountExceeds: 'amount exceeds a residual balance',
  reconcileConcurrent: 'residual balance changed concurrently; retry reconciliation',
} as const

export type RefusalCode = keyof typeof REFUSALS

export const fill = (sentence: string, params?: Record<string, unknown>): string =>
  params ? sentence.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)) : sentence

export const invalid = (field: string, code: RefusalCode, params?: Record<string, unknown>) => ({
  ok: false as const,
  errors: [{ field, code: `account.error.${code}`, message: fill(REFUSALS[code], params), params }],
})

/** A refusal raised from inside a helper or a transaction, carrying its code out. */
export class Refusal extends Error {
  code: RefusalCode
  params?: Record<string, unknown>
  constructor(code: RefusalCode, params?: Record<string, unknown>) {
    super(fill(REFUSALS[code], params))
    this.code = code
    this.params = params
  }
}

/** Turn whatever a guarded block threw into a refusal the caller can act on. */
export const refused = (field: string, error: unknown) =>
  error instanceof Refusal
    ? invalid(field, error.code, error.params)
    : { ok: false as const, errors: [{ field, message: (error as Error).message }] }

export const n = (value: unknown): number => Number(value ?? 0)

/** Exact numeric identity without routing ledger values through JavaScript Number. */
export const decimalIdentity = (value: unknown): string => {
  let source = String(value).trim().replace(/^\+/, '')
  const exponent = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(source)
  if (exponent) {
    const sign = exponent[1] ?? ''
    const whole = exponent[2] ?? '0'
    const fraction = exponent[3] ?? ''
    const digits = whole + fraction
    const shift = Number(exponent[4])
    if (Number.isSafeInteger(shift) && Math.abs(shift) <= 4096) {
      const point = whole.length + shift
      source =
        point <= 0
          ? `${sign}0.${'0'.repeat(-point)}${digits}`
          : point >= digits.length
            ? `${sign}${digits}${'0'.repeat(point - digits.length)}`
            : `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
    }
  }
  const parsed = /^(-?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(source)
  if (!parsed) return source
  const negative = parsed[1] === '-'
  const whole = (parsed[2] ?? '0').replace(/^0+(?=\d)/, '')
  const fraction = (parsed[3] ?? parsed[4] ?? '').replace(/0+$/, '')
  if (!/[1-9]/.test(`${whole}${fraction}`)) return '0'
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export const DECIMAL_CREATE_FIELDS = new Set([
  'quantity',
  'priceUnit',
  'discount',
  'debit',
  'credit',
  'balance',
  'amountUntaxed',
  'amountTax',
  'amountTotal',
  'amountResidual',
])

/** Compare the values a command owns without being confused by adapter scalar types. */
export const sameStored = (field: string, held: unknown, wanted: unknown): boolean => {
  if (held == null || wanted == null) return (held ?? null) === (wanted ?? null)
  if (DECIMAL_CREATE_FIELDS.has(field)) return decimalIdentity(held) === decimalIdentity(wanted)
  return String(held) === String(wanted)
}

/**
 * Idempotency means equal normalized financial semantics, not byte-identical JSON:
 * immutable fields and line structure must match, while mutable posting state does not.
 */
export const rowMatches = (held: Row, wanted: Row, fields: readonly string[]): boolean =>
  fields.every((field) => sameStored(field, held[field], wanted[field]))

/** Datetimes have one persisted spelling on both SQLite and PostgreSQL. */
export const instantText = (value: unknown): string => {
  const at = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(at.getTime()) ? String(value) : at.toISOString()
}

export const MOVE_CREATE_FIELDS = [
  'journalId',
  'moveType',
  'ref',
  'partnerId',
  'invoiceDate',
  'invoiceDateDue',
  'paymentTermId',
  'currency',
  'moneyPolicyVersion',
] as const

export const MOVE_LINE_CREATE_FIELDS = [
  'moveId',
  'lineKind',
  'name',
  'accountId',
  'partnerId',
  'productId',
  'productUomId',
  'quantity',
  'priceUnit',
  'discount',
  'taxId',
  'debit',
  'credit',
  'balance',
  'dateMaturity',
  'displayType',
  'sequence',
] as const

export const claimMoveRevision = async (
  ctx: Ctx,
  move: Row,
  expectedRevision?: unknown,
): Promise<boolean> => {
  const revision = n(move.revision)
  if (expectedRevision !== undefined && revision !== n(expectedRevision)) return false
  const changed = await ctx.db.compareAndSet(
    'account.Move',
    { id: move.id },
    { revision: move.revision ?? null },
    { revision: revision + 1 },
  )
  return 'dryRun' in changed || changed.matched
}

export const today = (): string => new Date().toISOString()

export const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')
