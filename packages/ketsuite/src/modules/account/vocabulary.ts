export const ACCOUNT_TYPES = [
  'asset_receivable',
  'asset_cash',
  'asset_current',
  'asset_non_current',
  'asset_prepayments',
  'asset_fixed',
  'liability_payable',
  'liability_credit_card',
  'liability_current',
  'liability_non_current',
  'equity',
  'equity_unaffected',
  'income',
  'income_other',
  'expense',
  'expense_other',
  'expense_depreciation',
  'expense_direct_cost',
  'off_balance',
] as const

export const JOURNAL_TYPES = ['sale', 'purchase', 'cash', 'bank', 'general'] as const

export const MOVE_TYPES = [
  'entry',
  'out_invoice',
  'out_refund',
  'in_invoice',
  'in_refund',
  'out_receipt',
  'in_receipt',
] as const

export const MOVE_STATES = ['draft', 'posted', 'cancel'] as const

/**
 * The four a document can actually be in.
 *
 * Three more were carried over from the ERP this vocabulary came from, and
 * nothing in this ledger ever wrote them — so a filter offering them returned an
 * empty list however the books were kept. Same reason `group` left
 * TAX_AMOUNT_TYPES: a choice that cannot be reached only wastes the reader's
 * time.
 */
export const PAYMENT_STATES = ['not_paid', 'paid', 'partial', 'reversed'] as const

export const TAX_USES = ['sale', 'purchase', 'none'] as const

/**
 * Group taxes are deliberately absent: a line takes a list of taxes and applies
 * them in sequence, which is what a group would have expressed anyway. Offering
 * `group` as a saveable amount type only produced taxes that threw on first use.
 */
export const TAX_AMOUNT_TYPES = ['fixed', 'percent', 'division'] as const

export const PAYMENT_TYPES = ['outbound', 'inbound'] as const

export const PARTNER_TYPES = ['customer', 'supplier'] as const

export const PAYMENT_SETTLEMENT_KINDS = ['liquidity', 'stored_value'] as const

export const PAYMENT_TERM_VALUES = ['percent', 'fixed'] as const

export const PAYMENT_TERM_DELAY_TYPES = [
  'days_after',
  'days_after_end_of_month',
  'days_after_end_of_next_month',
  'days_end_of_month_on_the',
] as const
