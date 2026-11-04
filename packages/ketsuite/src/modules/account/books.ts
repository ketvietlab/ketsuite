import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { ledgerOf } from './functions.ts'
import { minorText, moneyMinor } from './money.ts'

export const ACCOUNT_BOOKS = [
  'general_journal',
  'general_ledger',
  'account_detail',
  'cash',
  'bank',
  'partner',
] as const

const issue = (field: string, code: string, message: string) => ({
  field,
  code: `account.error.${code}`,
  message,
})

/**
 * The accounts a book is kept for.
 *
 * Every book but the general journal is the book of one account. A cash or bank
 * book is the book of an account a cash or bank journal pays through, whichever
 * journal the entry was written in; a partner book, of an account kept per
 * partner. Taking every line of an entry written in a cash journal instead put
 * the revenue beside the cash and closed the book on zero.
 */
const accountsOf = (book: string, accounts: Map<string, Row>, journals: Map<string, Row>): Row[] => {
  if (book === 'general_journal') return []
  const paidThrough = new Set(
    [...journals.values()]
      .filter((journal) => journal.type === book && journal.defaultAccountId)
      .map((journal) => String(journal.defaultAccountId)),
  )
  return [...accounts.values()]
    .filter((account) =>
      book === 'cash' || book === 'bank'
        ? paidThrough.has(String(account.id))
        : book === 'partner'
          ? account.reconcile === true
          : true,
    )
    .sort((a, b) => (String(a.code) < String(b.code) ? -1 : String(a.code) > String(b.code) ? 1 : 0))
}

export const bookFunctions: Record<string, FnSpec> = {
  accountingBook: defineFn({
    input: {
      book: 'text',
      dateFrom: 'date',
      dateTo: 'date',
      accountId: 'id?',
      journalId: 'id?',
      partnerId: 'id?',
    },
    output: {
      book: 'text?',
      /** The form the book follows under the company's accounting standard, when it names one. */
      form: 'text?',
      currency: 'text?',
      dateFrom: 'date?',
      dateTo: 'date?',
      /** The account the book is kept for: the one asked for, else the first with movement in the period. */
      accountId: 'id?',
      /** The accounts this book can be kept for, by code. */
      accounts: 'json?',
      /** The partners with an entry on the account up to the period end, by name. */
      partners: 'json?',
      opening: 'decimal?',
      debit: 'decimal?',
      credit: 'decimal?',
      closing: 'decimal?',
      rows: 'json?',
      errors: 'json?',
    },
    effects: [
      'read:company.Company',
      'read:account.Setup',
      'read:account.Account',
      'read:account.Journal',
      'read:account.Move',
      'read:account.MoveLine',
      'read:partner.Partner',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const book = String(args.book)
      if (!ACCOUNT_BOOKS.includes(book as (typeof ACCOUNT_BOOKS)[number]))
        return { errors: [issue('book', 'accountBookUnsupported', 'unsupported accounting book')] }
      if (String(args.dateFrom) > String(args.dateTo))
        return { errors: [issue('dateTo', 'accountBookPeriod', 'book period end precedes its start')] }

      const { currency, scale } = await ledgerOf(ctx)
      const accounts = new Map(
        (await ctx.db.select('account.Account')).map((account) => [String(account.id), account]),
      )
      const journals = new Map(
        (await ctx.db.select('account.Journal')).map((journal) => [String(journal.id), journal]),
      )
      if (args.accountId && !accounts.has(String(args.accountId)))
        return { errors: [issue('accountId', 'accountMissing', 'account does not exist')] }
      if (args.journalId && !journals.has(String(args.journalId)))
        return { errors: [issue('journalId', 'journalMissing', 'journal does not exist')] }
      const choices = accountsOf(book, accounts, journals)
      const kept = new Set(choices.map((account) => String(account.id)))
      if (args.accountId && book !== 'general_journal' && !kept.has(String(args.accountId)))
        return {
          errors: [issue('accountId', 'accountBookAccountOutside', 'this book is not kept for that account')],
        }

      const moves = new Map(
        (await ctx.db.select('account.Move'))
          .filter((move) => move.state === 'posted')
          .map((move) => [String(move.id), move]),
      )
      const dateOf = (move: Row): string => String(move.accountingDate ?? move.date).slice(0, 10)
      const lines = (await ctx.db.select('account.MoveLine')).filter((line) => {
        const move = moves.get(String(line.moveId))
        return Boolean(move && accounts.has(String(line.accountId)) && journals.has(String(move.journalId)))
      })
      const inPeriod = (line: Row): boolean => {
        const date = dateOf(moves.get(String(line.moveId))!)
        return date >= String(args.dateFrom) && date <= String(args.dateTo)
      }
      const accountId =
        book === 'general_journal'
          ? null
          : args.accountId
            ? String(args.accountId)
            : (choices.find((account) =>
                lines.some((line) => String(line.accountId) === String(account.id) && inPeriod(line)),
              )?.id ?? null)
      const setup = (await ctx.db.select('account.Setup'))[0]
      const form = (setup?.bookForms as Record<string, unknown> | null | undefined)?.[book]
      const summary = {
        book,
        form: typeof form === 'string' ? form : null,
        currency,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
        accountId,
        accounts: choices.map((account) => ({ id: account.id, code: account.code, name: account.name })),
      }

      const onAccount = (line: Row): boolean =>
        book === 'general_journal' || (accountId !== null && String(line.accountId) === accountId)
      const partnerNames =
        book === 'partner'
          ? new Map(
              (await ctx.db.select('partner.Partner')).map((partner) => [String(partner.id), partner.name]),
            )
          : new Map<string, unknown>()
      const partnerIds = new Set(
        lines
          .filter(
            (line) =>
              book === 'partner' &&
              onAccount(line) &&
              line.partnerId &&
              dateOf(moves.get(String(line.moveId))!) <= String(args.dateTo),
          )
          .map((line) => String(line.partnerId)),
      )
      const partners = [...partnerIds]
        .map((id) => ({ id, name: partnerNames.get(id) ?? id }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))
      if (book !== 'general_journal' && accountId === null)
        return { ...summary, partners, opening: null, debit: '0', credit: '0', closing: null, rows: [] }

      const byMove = new Map<string, Row[]>()
      for (const line of lines) {
        const held = byMove.get(String(line.moveId)) ?? []
        held.push(line)
        byMove.set(String(line.moveId), held)
      }
      // The accounts on the other side of a line in its own entry, as a ledger prints them:
      // a debit line names the accounts credited, a credit line the accounts debited.
      const contraOf = (line: Row): string => {
        const side = moneyMinor(line.debit, scale) > 0n ? 'credit' : 'debit'
        const codes = (byMove.get(String(line.moveId)) ?? [])
          .filter(
            (other) =>
              other.id !== line.id &&
              String(other.accountId) !== String(line.accountId) &&
              moneyMinor(other[side], scale) > 0n,
          )
          .map((other) => String(accounts.get(String(other.accountId))?.code ?? ''))
          .filter(Boolean)
        return [...new Set(codes)].sort().join(', ')
      }
      const accepted = (line: Row): boolean => {
        const move = moves.get(String(line.moveId))!
        if (!onAccount(line)) return false
        if (args.journalId && String(move.journalId) !== String(args.journalId)) return false
        if (args.partnerId && String(line.partnerId ?? '') !== String(args.partnerId)) return false
        return true
      }
      let opening = 0n
      let debit = 0n
      let credit = 0n
      const rows: Row[] = []
      for (const line of lines) {
        if (!accepted(line)) continue
        const move = moves.get(String(line.moveId))!
        const date = dateOf(move)
        const lineDebit = moneyMinor(line.debit, scale)
        const lineCredit = moneyMinor(line.credit, scale)
        if (date < String(args.dateFrom)) {
          opening += lineDebit - lineCredit
          continue
        }
        if (date > String(args.dateTo)) continue
        debit += lineDebit
        credit += lineCredit
        const account = accounts.get(String(line.accountId))!
        const journal = journals.get(String(move.journalId))!
        rows.push({
          id: line.id,
          moveId: move.id,
          moveName: move.name,
          accountingDate: date,
          documentDate: move.documentDate,
          reference: move.ref,
          journalId: journal.id,
          journalCode: journal.code,
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          partnerId: line.partnerId,
          ...(book === 'partner' && line.partnerId
            ? { partnerName: partnerNames.get(String(line.partnerId)) ?? line.partnerId }
            : {}),
          contraAccountCodes: contraOf(line),
          description: line.name,
          debit: minorText(lineDebit, scale),
          credit: minorText(lineCredit, scale),
          balance: minorText(lineDebit - lineCredit, scale),
          residual: line.amountResidual,
        })
      }
      rows.sort(
        (a, b) =>
          String(a.accountingDate).localeCompare(String(b.accountingDate)) ||
          String(a.moveId).localeCompare(String(b.moveId)) ||
          String(a.id).localeCompare(String(b.id)),
      )
      // The general journal lists every account at once: a balance run across all of
      // them is always the zero of double entry, so it has none to carry.
      if (book === 'general_journal')
        return {
          ...summary,
          partners,
          opening: null,
          debit: minorText(debit, scale),
          credit: minorText(credit, scale),
          closing: null,
          rows,
        }
      let running = opening
      for (const row of rows) {
        running += moneyMinor(row.balance, scale)
        row.runningBalance = minorText(running, scale)
      }
      return {
        ...summary,
        partners,
        opening: minorText(opening, scale),
        debit: minorText(debit, scale),
        credit: minorText(credit, scale),
        closing: minorText(opening + debit - credit, scale),
        rows,
      }
    },
  }),
}
