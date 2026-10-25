import { and, asc, defineFn, desc, eq, from, gte, inArray, isNull, ne, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../../account/money.ts'
import { addCalendarDays, dateKeyIn, zonedMidnight } from '../../hospitality_core/calendar.ts'
import { readRecord } from '../../hospitality_core/functions/command.ts'
import {
  bookProperties,
  getReservationBookFrameHandler,
} from '../../hospitality_core/functions/reservation-book.ts'
import type { BookProperty } from '../../hospitality_core/functions/reservation-book.ts'
import { readByIds } from '../../hospitality_core/functions/stay-book.ts'
import { foldText } from '../../hospitality_core/stay-book-query.ts'
import { BILLING_BOOK_VIEWS, billingBookQuery } from '../billing-book-query.ts'
import type { BillingBookQuery, BillingBookSort, BillingBookView } from '../billing-book-query.ts'
import { chargeRuleConfigured } from './accounting.ts'
import { enrichBillingRows } from './billing-list-evidence.ts'

/** One read weighs at most this many folios (in batches of 100); past it the answer is partial (HOS-DEC-033). */
export const BILLING_BOOK_LIMIT = 2000
const BATCH = 100
// "Cần xử lý trước": what needs doing first, in the order a row's state is decided.
const ATTENTION = ['unverified', 'missing-rule', 'uninvoiced', 'owing', 'paid'] as const
type BillingState = (typeof ATTENTION)[number]

export type BillingBookRow = {
  id: string
  code: string
  guest: string
  property: { id: string }
  state: 'open' | 'closed'
  billing: BillingState
  total: { amount: string; currency: string }
  /** As the folio register reads it (`getFolioDues`): `void` once reversed or cancelled. */
  invoice: { name: string; status: 'posted' | 'draft' | 'void' } | null
  /** What is still owed; null when the evidence cannot say (never zero for unknown). */
  due: { amount: string; currency: string } | null
  next: 'rule' | 'invoice' | 'payment' | 'view'
  /** The first charge type no rule covers, which `rule` opens. */
  rule: string | null
  /** Property-local civil date. */
  closed: string | null
}
type Held = BillingBookRow & { folded: string; views: BillingBookView[]; closedAt: number }

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' })
const slices = <T>(list: T[]) =>
  Array.from({ length: Math.ceil(list.length / BATCH) }, (_, index) =>
    list.slice(index * BATCH, (index + 1) * BATCH),
  )
const FOLIO_COLUMNS = [
  'id',
  'code',
  'propertyId',
  'partnerId',
  'state',
  'amountTotal',
  'openedAt',
  'closedAt',
]

const empty = (query: BillingBookQuery) => ({
  // An empty answer has one page, so the query it applied asks for that one.
  query: { ...query, page: 1 },
  total: 0,
  page: 1,
  pages: 1,
  rows: [],
  counts: { view: Object.fromEntries(BILLING_BOOK_VIEWS.map((id) => [id, 0])) },
  isEmpty: true,
  partial: false,
})

/**
 * Billing's work whatever its age, from the ledger: folios whose posted invoice is still owed (not settled, not
 * reversed) or whose invoice is not posted yet. Accounting holds every company invoice, so the scan is bounded and
 * `partial` says it stopped short.
 */
async function invoicedWork(ctx: Ctx) {
  const M = ctx.table('account.Move'),
    B = ctx.table('hospitality_billing.FolioBill')
  const moves = await ctx.db.all(
    from(M)
      .select(M.id)
      .where(
        eq(M.companyId!, ctx.scope.company),
        eq(M.moveType, 'out_invoice'),
        or(
          and(
            eq(M.state, 'posted'),
            inArray(M.paymentState, ['not_paid', 'partial']),
            isNull(M.reversedById!),
          ),
          eq(M.state, 'draft'),
        ),
      )
      .orderBy(asc(M.id))
      .limit(BILLING_BOOK_LIMIT + 1),
  )
  const folios: unknown[] = []
  for (const slice of slices(moves.slice(0, BILLING_BOOK_LIMIT)))
    for (const bill of await ctx.db.all(
      from(B)
        .select(B.folioId)
        .where(
          eq(B.companyId!, ctx.scope.company),
          inArray(
            B.moveId,
            slice.map((move) => move.id),
          ),
        )
        .limit(slice.length),
    ))
      folios.push(bill.folioId)
  return { folios, partial: moves.length > BILLING_BOOK_LIMIT }
}

/** Open folios holding a charge whose type no configured rule covers: they cannot be invoiced at departure. */
async function heldByRule(ctx: Ctx, propertyIds: string[]) {
  const F = ctx.table('hospitality_core.Folio'),
    C = ctx.table('hospitality_core.Charge'),
    R = ctx.table('hospitality_billing.ChargeRule')
  const open = await ctx.db.all(
    from(F)
      .select(F.id)
      .where(eq(F.companyId!, ctx.scope.company), inArray(F.propertyId, propertyIds), eq(F.state, 'open'))
      .orderBy(asc(F.id))
      .limit(BILLING_BOOK_LIMIT + 1),
  )
  const groups: Awaited<ReturnType<Ctx['db']['group']>> = []
  for (const slice of slices(open.slice(0, BILLING_BOOK_LIMIT)))
    groups.push(
      ...(await ctx.db.group(
        from(C)
          .where(
            eq(C.companyId!, ctx.scope.company),
            inArray(
              C.folioId,
              slice.map((folio) => folio.id),
            ),
            eq(C.state, 'active'),
            ne(C.amount, '0'),
          )
          .groupBy({ col: C.folioId }, { col: C.type }),
      )),
    )
  const types = [...new Set(groups.map((group) => String(group.key[1])))]
  const configured = new Set(
    (types.length
      ? await ctx.db.all(from(R).where(eq(R.companyId!, ctx.scope.company), inArray(R.chargeType, types)))
      : []
    )
      .filter(chargeRuleConfigured)
      .map((rule) => String(rule.chargeType)),
  )
  return {
    folios: [
      ...new Set(
        groups.filter((group) => !configured.has(String(group.key[1]))).map((group) => group.key[0]),
      ),
    ],
    partial: open.length > BILLING_BOOK_LIMIT,
  }
}

/** Folios closed in the period, the last closed first; each property counts its days back from its business date. */
async function closedInPeriod(ctx: Ctx, shown: BookProperty[], days: number) {
  const F = ctx.table('hospitality_core.Folio')
  const since = (property: BookProperty) =>
    zonedMidnight(addCalendarDays(property.businessDate, 1 - days), property.timezone).toISOString()
  const rows = await ctx.db.all(
    from(F)
      .select(...FOLIO_COLUMNS.map((name) => F[name]!))
      .where(
        eq(F.companyId!, ctx.scope.company),
        eq(F.state, 'closed'),
        or(...shown.map((property) => and(eq(F.propertyId, property.id), gte(F.closedAt!, since(property))))),
      )
      .orderBy(desc(F.closedAt!), desc(F.id))
      .limit(BILLING_BOOK_LIMIT + 1),
  )
  return { folios: rows.slice(0, BILLING_BOOK_LIMIT), partial: rows.length > BILLING_BOOK_LIMIT }
}

/** The book of one read: its folios with their billing state, guest and facets, before the search and the view. */
async function billingBook(ctx: Ctx, shown: BookProperty[], query: BillingBookQuery, currency: string) {
  const propertyIds = shown.map((property) => property.id)
  const [invoiced, held, closed] = [
    await invoicedWork(ctx),
    await heldByRule(ctx, propertyIds),
    await closedInPeriod(ctx, shown, query.period),
  ]
  // The work whatever its age comes first; the period's closed folios fill the rest of the bound.
  const work = await readByIds(
    ctx,
    'hospitality_core.Folio',
    [...invoiced.folios, ...held.folios],
    FOLIO_COLUMNS,
  )
  const byId = new Map<string, Row>()
  for (const folio of [...work.values(), ...closed.folios])
    if (propertyIds.includes(String(folio.propertyId)) && ['open', 'closed'].includes(String(folio.state)))
      byId.set(String(folio.id), folio)
  const folios = [...byId.values()]
  const partial = invoiced.partial || held.partial || closed.partial || folios.length > BILLING_BOOK_LIMIT
  const kept = folios.slice(0, BILLING_BOOK_LIMIT)
  const enriched: Row[] = []
  for (const slice of slices(kept)) enriched.push(...(await enrichBillingRows(ctx, slice)))
  const guests = await readByIds(
    ctx,
    'partner.Partner',
    kept.map((folio) => folio.partnerId),
    ['id', 'name'],
  )
  const timezone = new Map(shown.map((property) => [property.id, property.timezone]))
  const rows = enriched.map((folio): Held => {
    const known = folio.balanceKnown === true
    const owed = known && compareDecimals(String(folio.amountDue ?? '0'), '0') > 0
    const invoice = folio.invoice as { name?: unknown; state?: unknown; reversed?: unknown } | null
    const missing = (folio.missingRules as string[] | undefined) ?? []
    const closedAt = folio.state === 'closed' && folio.closedAt ? new Date(String(folio.closedAt)) : null
    const guest = String(guests.get(folio.partnerId)?.name ?? '')
    return {
      id: String(folio.id),
      code: String(folio.code),
      guest,
      property: { id: String(folio.propertyId) },
      state: folio.state === 'closed' ? 'closed' : 'open',
      billing: folio.billingState as BillingState,
      total: { amount: String(folio.amountTotal ?? '0'), currency },
      invoice: invoice
        ? {
            name: String(invoice.name ?? ''),
            status:
              invoice.reversed || invoice.state === 'cancel'
                ? 'void'
                : invoice.state === 'posted'
                  ? 'posted'
                  : 'draft',
          }
        : null,
      due: known ? { amount: String(folio.amountDue ?? '0'), currency } : null,
      next: folio.nextAction as BillingBookRow['next'],
      rule: missing[0] ?? null,
      closed: closedAt ? dateKeyIn(closedAt, timezone.get(String(folio.propertyId))!) : null,
      // Facets overlap: a folio with no invoice may still owe, one a rule holds is not invoiced either.
      views: [
        'all',
        ...(missing.length ? (['missing-rule'] as const) : []),
        ...(invoice ? [] : (['uninvoiced'] as const)),
        ...(known ? [owed ? ('owing' as const) : ('paid' as const)] : (['unverified'] as const)),
      ],
      // An open folio is today's, ahead of every closed one.
      closedAt: closedAt?.getTime() ?? Number.POSITIVE_INFINITY,
      folded: foldText(`${folio.code} ${invoice?.name ?? ''} ${guest}`),
    }
  })
  return { rows, partial }
}

const byCode = (a: Held, b: Held) => collator.compare(a.code, b.code) || collator.compare(a.id, b.id)
const byDue = (direction: 1 | -1) => (a: Held, b: Held) =>
  // What the evidence cannot say comes last either way.
  Number(!a.due) - Number(!b.due) ||
  (a.due && b.due ? direction * compareDecimals(a.due.amount, b.due.amount) : 0) ||
  byCode(a, b)
const ORDERS: Record<BillingBookSort, (a: Held, b: Held) => number> = {
  attention: (a, b) =>
    ATTENTION.indexOf(a.billing) - ATTENTION.indexOf(b.billing) || b.closedAt - a.closedAt || byCode(a, b),
  '-balance': byDue(-1),
  balance: byDue(1),
  title: byCode,
  '-title': (a, b) => byCode(b, a),
  '-total': (a, b) => compareDecimals(b.total.amount, a.total.amount) || byCode(a, b),
  total: (a, b) => compareDecimals(a.total.amount, b.total.amount) || byCode(a, b),
}

/**
 * `hospitality_billing.searchBilling`: one page of one query over billing's work, as the accepted mock reads it
 * (design/shared/hospitality-collection-book.mjs `billing`, HOS-DEC-033).
 * Input: `{ propertyId?, period?, view?, q?, sort?, page?, pageSize? }`. Output: `{ query, total, page, pages, rows,
 * counts: { view }, isEmpty, partial }`, `query` being the input as applied so the caller can correct its URL.
 * The book is the folios closed in the period, those whose invoice is still owed or not posted whatever their age,
 * and open folios a missing rule holds; it is weighed whole (up to `BILLING_BOOK_LIMIT`) so facets count it all and
 * it orders by what is still owed. The search folds accents over folio code, invoice number and guest name.
 */
export const searchBillingHandler: FnSpec['handler'] = async (ctx, args) => {
  const properties = ctx.scope.company ? await bookProperties(ctx) : []
  const query = billingBookQuery(args, properties)
  const shown = query.propertyId ? properties.filter((row) => row.id === query.propertyId) : properties
  if (!shown.length) return empty(query)
  const currency = String((await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency || 'VND')
  const book = await billingBook(ctx, shown, query, currency)
  if (!book.rows.length) return { ...empty(query), partial: book.partial }
  const needle = foldText(query.q)
  const scope = needle ? book.rows.filter((row) => row.folded.includes(needle)) : book.rows
  const view = Object.fromEntries(
    BILLING_BOOK_VIEWS.map((id) => [id, scope.filter((row) => row.views.includes(id)).length]),
  )
  const matching = scope.filter((row) => row.views.includes(query.view)).sort(ORDERS[query.sort])
  const pages = Math.max(1, Math.ceil(matching.length / query.pageSize))
  const page = Math.min(pages, query.page)
  return {
    query: { ...query, page },
    total: matching.length,
    page,
    pages,
    rows: matching
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map(({ folded: _f, views: _v, closedAt: _c, ...row }): BillingBookRow => row),
    counts: { view },
    isEmpty: false,
    partial: book.partial,
  }
}

export const billingBookFunctions = {
  getBillingBookFrame: defineFn({
    input: {},
    output: { properties: 'json' },
    effects: ['read:hospitality_core.Property'],
    handler: getReservationBookFrameHandler,
  }),
  searchBilling: defineFn({
    input: {
      propertyId: 'id?',
      period: 'int?',
      view: 'text?',
      q: 'text?',
      sort: 'text?',
      page: 'int?',
      pageSize: 'int?',
    },
    output: {
      query: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      rows: 'json',
      counts: 'json',
      isEmpty: 'bool',
      partial: 'bool',
    },
    effects: [
      'read:hospitality_core.Folio',
      'read:hospitality_core.Property',
      'read:hospitality_core.Charge',
      'read:partner.Partner',
      'read:company.Company',
      'read:hospitality_billing.FolioBill',
      'read:hospitality_billing.ChargeRule',
      'read:hospitality_billing.FolioPayment',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Payment',
    ],
    handler: searchBillingHandler,
  }),
}
