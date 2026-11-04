---
title: Accounting ledger
description: How KetSuite posts, corrects and settles journal entries, and the currency arithmetic underneath.
---

# Accounting ledger

The `account` module holds the jurisdiction-neutral double-entry ledger: journals,
entries, invoices, payments, reconciliation, period controls and books. A deployment
must install or configure its own chart, taxes and statutory reporting localization.

## Sale orders managed outside KetSuite

Trusted integrations may pin `sale.Order.orderAuthority` (`local`/`external`), `stockAuthority`
(`local`/`external`), `invoiceAuthority` (`local`/`disabled`) and an `executionPolicyVersion`.
Null fields preserve existing native behavior. Ordinary order-edit inputs do not expose these fields.
External order authority refuses local edits, confirmation, cancellation, reset and unlock. External
stock authority prevents delivery generation and preserves externally supplied delivered quantities
when `sale.syncDeliveries` runs. Disabled invoice authority reports `no` and refuses `sale.createInvoice`
before it writes a journal entry. These are per-order decisions, not mutable company defaults.

Integrations restore imported state without replaying lifecycle commands. A later cutover applies to
new orders; changing an existing order's authority requires a separately reviewed handover. The core
does not reinterpret old orders, manufacture completed pickings, or invent tax treatment for them.

An external order can retain `externalAmountAdjustment`, the difference between its provider total
and the sum of item subtotals. This is informational shipping/discount/rounding reconciliation, not
a product, a tax classification, or permission to post accounting entries.

## Currency arithmetic

Every stored amount is rounded to the minor unit of the currency that owns it, not to
a fixed two decimals. VND, JPY and KRW have no minor unit; BHD, KWD and TND have
three; everything else defaults to two.

This is not a display concern. A 1,234,567 VND invoice with 10% VAT rounded to two
decimals leaves an open item of 1,358,023.7 đồng, while the screen — which formats VND
with no decimals — prints 1,358,024 ₫. Paying the amount the screen shows is then
rejected for exceeding the open item, and the invoice can never be settled. Rounding
at the currency's own scale makes the number on the screen the number in the ledger.

The same scale governs the balance check when an entry is posted, the residual left
after a reconciliation, and the tolerance each comparison allows.

## Posting

`account.postMove` is the only way an entry enters the books. It refuses an entry with
fewer than two lines, a line carrying both a debit and a credit, a negative amount, or
a debit total that does not meet the credit total. On success it assigns the journal's
next sequence number through a compare-and-set retry, so concurrent posts produce
consecutive names with no gaps and no duplicates.

A manual entry has no totals of its own, so posting records them from the balanced
lines. An invoice keeps the totals its line builder computed.

## Correcting a posted entry

A posted entry is never edited and never deleted. `account.cancelMove` applies to
drafts only; the correction for anything already in the books is
`account.reverseMove`, which posts a second entry whose debits and credits are the
first one's, swapped.

```ts
// File: examples/accounting/reverse.ts
const result = await ctx.call('account.reverseMove', {
  id: postedMoveId,
  reversalId: crypto.randomUUID(),
})
// result.reversalId names the new entry; both stay in the ledger.
```

Where the original opened an item on a reconcilable account, the reversal closes it
against the original, so the document stops appearing in open items and in the partner
ledger. An invoice or bill that has been reversed carries `paymentState: 'reversed'`,
and later residual math leaves that label alone.

Both entries remain in the ledger and in every report — the trial balance nets to
zero rather than losing a row. Passing the same `reversalId` again returns the existing
reversal instead of posting a second one.

In the backend, a posted document offers **Reverse entry** on its own screen and takes
the reader to the resulting journal entry.

## Payments and reconciliation

`account.registerPayment` writes the liquidity and counterpart lines, posts them, and
optionally reconciles the counterpart against a chosen open item. The payment amount
is rounded to the currency scale before it is compared with the residual, so an amount
copied from the screen matches.

The same command supports `settlementKind: 'stored_value'` for gift cards and money
wallets. That kind requires a general journal whose default account is a liability;
an inbound customer settlement debits the liability and credits receivable, while a
refund does the reverse. It cannot be marked as cash and does not pass through a bank
or cash account. POS payment methods carry the same settlement kind, so Retail and
private verticals use the canonical invoice/payment/reconciliation path rather than
posting a second payment ledger.

`account.postStoredValueBalance` owns the two liability movements that are not customer
invoice settlements. `issue` debits an asset/clearing account and credits the liability;
`expire` debits the liability and credits income. Its `id` is the source identity, so a
retry with the same financial content returns the posted move and reuse with different
content fails. The command never accepts a wallet code or provider token.

`account.reconcile` is the primitive underneath: it takes one debit line and one credit
line on the same reconcilable account, both posted, and records a partial reconcile for
an amount neither residual can be exceeded by. Both residuals move under
compare-and-set inside one transaction; a concurrent change fails the call rather than
producing a residual that does not match its reconciles. The documents on both sides
then have their payment state recomputed.

`account.receivableAging` ages receivable or payable lines as they stood on `cutoff`,
not as they stand today. A line's open amount is its balance less the partial
reconciles whose entry on the other side is posted on or before the cutoff; a match
that was undone stops counting from the accounting date of the reversing entry (the
undo time only when there is none). A payment posted after the cutoff therefore leaves
the item open on the report. Rows carry `moveName` beside `moveId` so a screen names
the document rather than its id.

## Reports

`trialBalance`, `generalLedger` and `partnerStatement` read posted entries only. The
date window narrows the move query in the database, and journal items are fetched for
the moves that survive it, in chunks — a reporting window does not scan the whole
ledger and does not build a parameter list no driver will accept.

`generalLedger`, `partnerStatement`, `listMoves`, `listPayments` and `listOpenItems`
accept `limit` and `offset`. Paging is opt-in: a screen asks for a page, while an
export or a report asks for everything and gets it, rather than a silently truncated
list that reads as complete. `countMoves` answers the totals a dashboard needs without
fetching the rows.

`trialBalance` with `balances: true` is the trial balance a period is closed with: per
account the opening balance (everything posted before `dateFrom`), the period's debits
and credits, and the closing balance, the two balances split into a debit or a credit
column by their sign. Accounts with no balance and no movement are left out unless
`includeEmpty: true`; a window without movement still lists the accounts that hold a
balance. Without `balances` it keeps returning the period's movement only. The
Trial balance screen reads it this way, checks that all three pairs of columns are
equal and toggles the hidden accounts with `?all=1`.

`generalLedger` rows and `accountingBook` rows carry `contraAccountCodes`: the codes
of the accounts on the other side of the same entry (a debit line names the accounts
credited), as a printed ledger shows them. The book screens show it as a column and
lead with the entry number, because a row opens its entry from the first column.

`accountingBook` keeps every book but the general journal for one account. The cash and
bank books are kept for the accounts a cash or bank journal pays through
(`defaultAccountId`), whichever journal an entry was written in; the partner book for
accounts with `reconcile`; the general ledger and account detail for any account. The
answer lists the book's `accounts`, and without `accountId` the book opens the first of
them, by code, that moved in the period (`accountId` in the answer says which). An
account the book is not kept for is refused with `accountBookAccountOutside`; the
screen re-reads the book on its own account instead, because switching books carries
the previous account along in the form. `partnerId` is optional on the partner book:
without it the rows carry `partnerName` and `partners` lists who has entries on the
account. A book kept for one account carries `runningBalance` on each row from the
opening balance; the general journal has no `opening`, `closing` or running balance.

`account.Setup.bookForms` names the form each book follows under the company's
standard, by book (`{ cash: 'S07-DN' }`); `accountingBook` returns it as `form`, and the
book, general ledger and partner statement screens print it under their title. The core
leaves it empty; a localisation fills it when it installs its chart. `?format=csv` on
the books screen downloads the book on screen in the form's column order — accounting
date, document number and date, description, contra account (the account itself in the
general journal), debit, credit, balance — opening on the opening balance and ending on
the period totals and the closing balance. Computed amounts stay plain decimals; typed
text is defused against spreadsheet formulas.

## Analytics

`performance`, `position`, `revenueTimeline`, `openItemSummary` and `cashFlow` are the
aggregates behind the accounting overview. They read the same posted moves the reports
do, so a headline figure and a trial balance run over the same window agree.
Each headline card on the overview links to that trial balance, so the reader can see
the accounts that add up to the figure.

Each amount is reported in the direction its account is kept: revenue and liabilities as
credit minus debit, expenses and assets as debit minus credit. Every figure is therefore
positive when the books say the ordinary thing, and a negative revenue means refunds
outran sales rather than that a sign convention leaked out of the module. Equity and
off-balance accounts belong to no total — off-balance records what the company holds
without owning, and adding it to total assets is the mistake a statutory chart makes
easy.

| Function | Answers | Window |
| --- | --- | --- |
| `performance` | revenue, cost of sales, operating expense, profit, gross margin, and the accounts behind each | over `dateFrom`–`dateTo` |
| `position` | cash, total assets, total liabilities | as at `asOf` |
| `revenueTimeline` | revenue and cost of sales per bucket | over `dateFrom`–`dateTo` |
| `openItemSummary` | receivable and payable, split by due date, with the partners who owe most | as at `asOf` |
| `cashFlow` | money through cash and bank accounts, filed by counterpart | over `dateFrom`–`dateTo` |

A result is over a window and a balance is as at a date, which is why `position` takes
no `dateFrom`: a window would report the movement instead, and narrowing the date filter
would make total assets shrink.

`revenueTimeline` buckets by day for a window of two months or less and by month above
that, unless `granularity` says otherwise. Each bucket holds what was earned inside it,
not a running total, so the buckets sum to the period revenue — a caller comparing two
windows passes the same `granularity` to both, or the two lines share an axis and
nothing else.

`grossMargin` is `null` rather than zero when nothing was earned. A period with no sales
has no margin, and reporting 0% reads as one that sold at exactly cost.

`openItemSummary` reads unreconciled journal items rather than invoice totals, so a
partly paid invoice contributes what is left of it instead of all or none, and its due
date comes from the line's `dateMaturity`, falling back through the document's
`invoiceDateDue` and its date.

## Which accounts a document posts to

An invoice does not ask. `lineAccountId` and `counterpartAccountId` are optional, and
when they are absent the ledger resolves them from configuration, narrowest first:

| | Revenue / expense | Receivable / payable |
| --- | --- | --- |
| 1 | what the caller passed | what the caller passed |
| 2 | the product template override | the partner |
| 3 | the nearest category override, walking ancestors | the company defaults |
| 4 | the company defaults for the product type | — |

Nothing at any level is a refusal, not a guess: `lineAccountUndecided` and
`counterpartAccountUndecided` say which one was undecided and where it could have come
from.

Asking the person writing an invoice to name a revenue account out of a full chart is asking
them to re-answer a question the chart already answers the same way every time — and
to get it wrong occasionally. The fields remain on the form so an unusual document can
still say otherwise; they are simply no longer required.

### Where each level lives

- **Company** — `account.Defaults`, one row per company, on **Accounting → Default
  accounts**. A localization or operator may seed unset values; a company that chose
  differently keeps its choice.
- **Product** — `account.ProductAccount`, unique per company and template. Revenue and purchase
  overrides resolve independently. `account.getProductAccounts` returns the direct override, resolved
  account and source, plus allowed options; `account.setProductAccounts` sets or clears it. Editing
  requires the `account.product-accounting` bundle. Product record saves include these fields in the
  same transaction as the product draft, so invalid accounts roll back all edits. Standalone edits
  advance the product revision and inventory revision when Stock is composed.
- **Product category** — `account.CategoryAccount`, one mapping per company and category. Missing
  fields continue through the nearest ancestor, independently for revenue and purchases. Cycles
  refuse resolution. A shared catalogue can use different mappings in each company.
- **Purchase defaults** — `goodsPurchaseAccountId` and `servicePurchaseAccountId` optionally distinguish
  goods from services. Missing typed defaults fall back to the legacy `expenseAccountId`; an older
  `saveDefaults` payload preserves typed fields it omits. Migration adds nullable fields and an empty
  product mapping table without rewriting old category mappings or ledger entries. Localization
  owns its starter policy; actual account classification depends on the purchase's business purpose.
- **Partner** — `partner.CompanyTerms`, on the partner's own accounting screen, added
  by the optional `account_partner` module. The resolver reads those fields rather
  than depending on the module: without it they are simply absent and resolution falls
  through to the company default.

### Product sales tax

A product can have a default sales tax. That choice lives in
`account.ProductTax`, not on the shared product template: tax configuration belongs to a legal
entity and two companies can sell the same catalogue item under different taxes. The row is unique
per `(companyId, templateId)`. `account.getProductTax` reads the mapping and
`account.setProductTax` creates, replaces or clears it after checking that the tax is a sales tax.

Setting it belongs to accounting, not to the product page: `product_backend` neither shows nor saves
the tax, so saving or duplicating a product leaves the mapping as accounting set it. Until accounting
has a screen for it, the mapping is set through `account.setProductTax`.

A default is checked when it is saved, not when an invoice fails: a receivable default
must be a receivable account, a revenue default an income account. `account.saveDefaults`
and `account.saveCategoryAccount` refuse anything else, and `account.previewAccounts`
answers what a document *would* post to, and what decided it.

```ts
// File: examples/accounting/defaults.ts
// Everything below the journal and the partner is optional.
await ctx.call('account.createInvoice', {
  id: invoiceId,
  journalId: saleJournalId,
  moveType: 'out_invoice',
  partnerId,
  productId,
  description: 'Tư vấn triển khai',
  quantity: '1',
  priceUnit: '3000000',
})
```

## Refusals

Every function answers a rejected call with `{ ok: false, errors: [{ field, code,
message }] }`. The `code` is a message key this module owns — the rule belongs to the
ledger, so the wording does too, and a screen renders it in the reader's language. The
`message` is the same reason in English, for an API client or a log with no translator.

A backend screen re-renders the form it was given rather than redirecting: the reason
appears against the field that caused it, and the values the user typed are still
there. A long invoice form is not worth re-keying because one account was the wrong
type.

## Configuration is editable

Accounts, journals, taxes and payment terms are corrected in place from their own list
screens: following a row opens `?edit=<id>`, which prefills the create form and posts
back to the same id. Clearing **In use** archives the record, which removes it from
selection lists while leaving every entry that already references it intact. Archived
rows stay visible on the configuration screen, with an `Archived` badge, so the change
can be undone.

A payment term's milestones are listed and edited the same way, through `?editLine=`.
A term is defined by them — a percentage, a due-date rule and a number of days — so
counting them without showing them left the screen unable to say what "30 days" meant.

The `save*` functions take the same shape for a correction as for a creation: an id
that already exists updates, an id that does not creates.

A localization may pin defaults. `account.Defaults.pinned` maps a default field to the
account it must hold; `saveDefaults` keeps a pinned field when it is left out and refuses
another account with `account.error.defaultPinned`, and the defaults screen shows it
read only under **Fixed by the accounting standard** instead of offering it. The
Vietnamese standard pins `receivableAccountId` and `payableAccountId` to 1311 and 3311,
only where the company still holds those accounts (or none): a company that had already
chosen another keeps that choice, editable.

An invoice without a payment term may carry its own `invoiceDateDue` (`createInvoice`),
refused with `account.error.dueBeforeInvoice` when it falls before the invoice date. A
term always sets the due date; a typed date beside a term is ignored. With neither, the
invoice is due on the day it is issued.

Accounts, journals, taxes and payment terms open as a small centred dialog
(`presentation: 'dialog'`, `size: 'small'`) over their own list (`?create=1` or
`?edit=<id>`): each is a short single-column form. None of them opens as a panel docked
to the side of the page.
The old `/admin/accounting/<collection>/new` links redirect to that modal.

Two rules keep a chart from posting money or tax to the wrong place:

- a cash or bank journal must default to an `asset_cash` account, because receipts and
  payments post their money line there (`journalLiquidityAccount`); other journals may
  leave the default empty;
- `account.Defaults.saleTaxAccountRoots` and `purchaseTaxAccountRoots` are lists of
  account-code prefixes. When a company sets them, a sale or purchase tax must post to
  an account whose code starts with one of them (`taxAccountRoot`, with the allowed
  branches in `params.roots`); a tax of use `none` is not pinned. `saveDefaults` sets
  them, and leaves them as held when the input omits them. A localisation fills them
  when it installs its chart — the Vietnamese TT99 chart pins sales to 3331, 3332, 3333
  and 3338 and purchases to 1331, 1332 and 3333 (import duty).

A correction is audited. `saveAccount`, `saveJournal`, `saveTax`, `savePaymentTerm` and
`saveDefaults` append an `account.AuditEvent` with `action: 'updated'`, the
`subjectType` (`account`, `journal`, `tax`, `paymentTerm`, `defaults`) and
`details: { before, after }` holding only the plain fields whose value changed, at most
30 (`changedFields` in `account/audit.ts`). Row bookkeeping (`id`, `companyId`,
`revision`, timestamps) and list or object fields are not recorded. A creation, or a
save that changes nothing, appends no event, so installing a chart of accounts leaves
the log empty. The audit log's event dialog shows the changes as a **Changed fields**
table, accounts named by code and name, and links to the record's edit modal.

## What the screens promise

A few things the backend guarantees, because getting them wrong makes a screen unusable
rather than merely untidy:

- a picker only offers values the function will accept — a payment's destination lists
  receivable and payable accounts, not all 216;
- the overview reports the ledger, not the database: nothing on it moves until a
  document is posted;
- a change against the previous period is coloured by whether it is good news, not by
  which way it went — total liabilities falling is a fall and an improvement;
- the period a screen compares against is the window of equal length immediately before
  the one asked for, so narrowing the filter to ten days compares ten days;
- a named window travels by its name — `?period=last7`, not the dates that meant this
  morning — so a bookmark of "the last seven days" is still the last seven days
  tomorrow. Typed dates win over a name, and are the only thing that produces a window
  the chips do not offer;
- the years on offer are the years the ledger covers, newest first and capped at six;
- date fields appear with a year and with nothing else. A relative window is already
  exact — "the last 30 days" has nothing left to narrow — while a year is the coarse
  frame that does, and a typed range is what narrowing one produces;
- a draft has no journal number yet, so lists and titles name it by its kind and date
  rather than by the raw id it was created under;
- a payment state is shown only on documents that have one, never on a manual entry;
- creating a document opens it, because a new invoice or entry is a draft that still
  needs lines or posting;
- a figure on a report opens the rows that produced it — a trial balance line into
  the general ledger for that account, carrying the same date window; a payment and
  a partner-ledger line into the journal entry behind them;
- a close check says where to act. The `draft_moves` step's evidence counts the drafts
  dated in the period by the list they are finished from (`lists.customerInvoices`,
  `lists.vendorBills`, `lists.entries`), and the checklist gives each list still holding
  any its own line, opening that list with the `draft` preset and an `accountingDate`
  between the period's dates. The `trial_balance` step opens the trial balance of the
  same dates. A reader who may not open a list or the report sees the count without
  the link.

## Testing

`test/accounting.test.ts` covers tax computation, due dates, balanced posting, sequence
assignment under concurrency, partial payment and reconciliation, VND settlement at the
displayed amount, compounding taxes, reversal, and manual entry totals.
`test/accounting-analytics.test.ts` covers the aggregates over one ledger with two
months in it, and holds them to each other: total assets equal liabilities plus equity
plus the result, the open items add up to the receivable balance, net cash flow equals
the change in the cash balance, and no aggregate moves for a draft.
Localization repositories test their own chart installation and statutory upgrades.
`test/accounting-e2e.test.ts`
drives the real HTTP backend through the invoice, payment and report workflow, through
correcting and archiving a chart entry, and through reversing a posted document.
`test/stored-value.test.ts` proves issue/expiry posting, liability-backed POS settlement,
receivable reconciliation and retry-stable coordination with the Loyalty wallet ledger.

The accounting overview has no browser suite while the accounting module is being rebuilt;
one is written against the new module.


### Transactional function composition

The Account registry is assembled from named function groups; the compatibility entry point exports
`reconcileFunction` and `registerPaymentFunction` unchanged. `setProductAccountsFunction({ inTransaction: true })`
is for a trusted aggregate already owning a transaction, permission checks, and product revision claim.
External callers use `account.setProductAccounts`, which owns those checks and the transaction itself.
The Product record aggregate checks accounting write permission only when an override actually changes.
