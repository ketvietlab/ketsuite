import { text, withHeaders } from '@ketvietlab/ketjs'
import type { Translator } from '@ketvietlab/ketjs'
import { csvCell, safeFilename } from '../website_backend/csv.ts'

type Row = Record<string, unknown>

/**
 * A cell the ledger computed stays a number; anything a person typed is defused.
 * A credit balance is negative, and the formula guard would otherwise turn every
 * `-1500000` into text a spreadsheet can no longer add.
 */
const cell = (value: unknown): string =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? value : csvCell(value)

/**
 * An accounting book as a spreadsheet, in the column order of the paper form.
 *
 * The screen leads with the entry number because the row's link lives there; a
 * book printed for an inspector reads the way the form does instead: date
 * recorded, document number and date, description, the account on the other
 * side, debit, credit, and then the balance. A book kept for one account opens
 * on its opening balance and closes on the period's totals and its closing
 * balance, as the form's first and last lines do. Amounts stay plain decimals,
 * so the spreadsheet adds them rather than reading text.
 */
export const bookCsv = (_: Translator, result: Row, rows: readonly Row[]) => {
  const ledger = result.opening !== null && result.opening !== undefined
  const byPartner = result.book === 'partner'
  const header = [
    _('account_backend.field.accountingDate'),
    _('account_backend.books.documentNumber'),
    _('account_backend.books.documentDate'),
    _('account_backend.books.description'),
    ...(byPartner ? [_('account_backend.field.partnerId')] : []),
    ledger ? _('account_backend.books.contra') : _('account_backend.field.accountId'),
    _('account_backend.field.debit'),
    _('account_backend.field.credit'),
    ...(ledger ? [_('account_backend.books.running')] : []),
  ]
  const blank = (label: string, values: { debit?: unknown; credit?: unknown; balance?: unknown }) => [
    '',
    '',
    '',
    label,
    ...(byPartner ? [''] : []),
    '',
    values.debit ?? '',
    values.credit ?? '',
    ...(ledger ? [values.balance ?? ''] : []),
  ]
  const lines: unknown[][] = [
    header,
    ...(ledger ? [blank(_('account_backend.books.opening'), { balance: result.opening })] : []),
    ...rows.map((row) => [
      row.accountingDate,
      row.moveName,
      row.documentDate ?? '',
      row.description ?? '',
      ...(byPartner ? [row.partnerName ?? ''] : []),
      ledger ? (row.contraAccountCodes ?? '') : row.accountCode,
      row.debit,
      row.credit,
      ...(ledger ? [row.runningBalance] : []),
    ]),
    blank(_('account_backend.books.total'), { debit: result.debit, credit: result.credit }),
    ...(ledger ? [blank(_('account_backend.books.closing'), { balance: result.closing })] : []),
  ]
  const account = (result.accounts as Row[] | undefined)?.find(
    (candidate) => String(candidate.id) === String(result.accountId),
  )
  const name = safeFilename(
    [result.form ?? result.book, account?.code, result.dateFrom, result.dateTo].filter(Boolean).join('_'),
  )
  // A byte-order mark, or a spreadsheet opens the Vietnamese in the file as Latin-1.
  return withHeaders(text(`\uFEFF${lines.map((line) => line.map(cell).join(',')).join('\r\n')}`), {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${name}.csv"`,
    'cache-control': 'no-store',
  })
}
