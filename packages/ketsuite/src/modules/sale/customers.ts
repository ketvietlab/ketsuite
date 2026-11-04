import { desc, eq, from, inArray, type Ctx, type Row } from '@ketvietlab/ketjs'
import { savePartnerRecord } from '../partner/functions/partners.ts'
import { ledgerOf } from '../account/ledger.ts'
import { minorText, moneyMinor } from '../account/money.ts'
import { company, companyKey, ours } from './scope.ts'
import { invalid } from './functions/shared.ts'

/**
 * Customers as Sales sees them (D11) and the credit they are carrying (D12).
 *
 * A customer is a party holding the customer role, or holding no role yet; a party
 * that is only a supplier is not one, nor is a company's own legal entity. The contact is the shared party; the salesperson,
 * pricelist and payment term are this company's `sale.CustomerTerms`; the credit limit is
 * this company's `partner.CompanyTerms.creditLimit`.
 */

const CONFIRMED = ['sale', 'done']
const QUOTATION = ['draft', 'sent']

export const CUSTOMER_READ_EFFECTS = [
  'read:partner.Partner',
  'read:partner.Role',
  'read:partner.CompanyTerms',
  'read:sale.CustomerTerms',
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:user.User',
  'read:pricing.Pricelist',
  'read:account.PaymentTerm',
  'read:account.Account',
  'read:account.Move',
  'read:account.MoveLine',
  'read:company.Company',
] as const

const text = (value: unknown) => (value == null ? '' : String(value))

async function customerIds(ctx: Ctx, ids?: string[]): Promise<Set<string>> {
  const R = ctx.table('partner.Role')
  const roles = await ctx.db.all(
    from(R)
      .select(R.partnerId, R.role)
      .where(inArray(R.role, ['customer', 'supplier']), ...(ids ? [inArray(R.partnerId, ids)] : [])),
  )
  const customers = new Set(
    roles.filter((row) => row.role === 'customer').map((row) => String(row.partnerId)),
  )
  const suppliers = new Set(
    roles.filter((row) => row.role === 'supplier').map((row) => String(row.partnerId)),
  )
  const P = ctx.table('partner.Partner')
  const parties = await ctx.db.all(
    from(P)
      .select(P.id)
      .where(eq(P.active, true), ...(ids ? [inArray(P.id, ids)] : [])),
  )
  // The companies' own legal entities are parties too, and never customers of themselves.
  const own = new Set((await ctx.db.select('company.Company')).map((row) => String(row.partnerId)))
  return new Set(
    parties
      .map((row) => String(row.id))
      .filter((id) => !own.has(id) && (customers.has(id) || !suppliers.has(id))),
  )
}

const byPartner = (rows: Row[]) => new Map(rows.map((row) => [String(row.partnerId), row]))

/** Credit exposure per customer, in minor units of the company currency (D12). */
export async function creditExposures(ctx: Ctx, partnerIds: string[], quotationId?: string) {
  const { currency, scale } = await ledgerOf(ctx)
  const result = new Map<string, { receivable: bigint; uninvoiced: bigint; quotation: bigint }>(
    partnerIds.map((id) => [id, { receivable: 0n, uninvoiced: 0n, quotation: 0n }]),
  )
  if (!partnerIds.length) return { currency, scale, result }
  // The ledger, as accounting reads it: every open item on a receivable account. A posted
  // invoice adds what is still due; a customer payment not yet applied subtracts.
  const accounts = new Set(
    (await ctx.db.select('account.Account'))
      .filter((row) => row.accountType === 'asset_receivable')
      .map((row) => String(row.id)),
  )
  const L = ctx.table('account.MoveLine')
  const lines = (
    await ctx.db.all(from(L).where(inArray(L.partnerId, partnerIds), eq(L.reconciled, false)))
  ).filter((line) => accounts.has(String(line.accountId)) && moneyMinor(line.amountResidual, scale) !== 0n)
  const M = ctx.table('account.Move')
  const moveIds = [...new Set(lines.map((line) => String(line.moveId)))]
  const posted = new Set(
    moveIds.length
      ? (await ctx.db.all(from(M).select(M.id, M.state).where(inArray(M.id, moveIds))))
          .filter((move) => move.state === 'posted')
          .map((move) => String(move.id))
      : [],
  )
  for (const line of lines) {
    if (!posted.has(String(line.moveId))) continue
    const residual = moneyMinor(line.amountResidual, scale)
    const amount = residual < 0n ? -residual : residual
    const row = result.get(String(line.partnerId))!
    row.receivable += moneyMinor(line.balance, scale) < 0n ? -amount : amount
  }
  // Confirmed orders: what is ordered and not yet invoiced, tax included.
  const O = ctx.table('sale.Order')
  const orders = await ctx.db.all(
    from(O)
      .select(O.id, O.partnerId, O.state, O.currency, O.amountTotal)
      .where(eq(O.companyId, company(ctx)), inArray(O.partnerId, partnerIds)),
  )
  const confirmed = orders.filter(
    (order) => CONFIRMED.includes(String(order.state)) && order.currency === currency,
  )
  if (confirmed.length) {
    const partnerOf = new Map(confirmed.map((order) => [String(order.id), String(order.partnerId)]))
    const OL = ctx.table('sale.OrderLine')
    for (const line of await ctx.db.all(
      from(OL).where(eq(OL.companyId, company(ctx)), inArray(OL.orderId, [...partnerOf.keys()])),
    )) {
      if (line.displayType) continue
      const ordered = Number(line.productUomQty ?? 0)
      const open = ordered - Number(line.qtyInvoiced ?? 0)
      if (!(ordered > 0) || !(open > 0)) continue
      const total = moneyMinor(line.priceSubtotalIncl ?? line.priceSubtotal ?? 0, scale)
      result.get(partnerOf.get(String(line.orderId))!)!.uninvoiced += BigInt(
        Math.round((Number(total) * Math.min(open, ordered)) / ordered),
      )
    }
  }
  // The quotation being looked at counts as if it were confirmed.
  if (quotationId) {
    const quotation = orders.find((order) => String(order.id) === quotationId)
    if (quotation && QUOTATION.includes(String(quotation.state)) && quotation.currency === currency)
      result.get(String(quotation.partnerId))!.quotation = moneyMinor(quotation.amountTotal, scale)
  }
  return { currency, scale, result }
}

/** The credit summary a page shows, or `null` when the customer has no limit to warn about. */
export async function customerCredit(ctx: Ctx, partnerId: string, quotationId?: string) {
  const terms = (await ours(ctx, 'partner.CompanyTerms', { partnerId }))[0]
  const { currency, scale, result } = await creditExposures(ctx, [partnerId], quotationId)
  const row = result.get(partnerId)!
  const exposure = row.receivable + row.uninvoiced + row.quotation
  const limit = terms?.creditLimit == null ? null : moneyMinor(terms.creditLimit, scale)
  return {
    partnerId,
    currency,
    creditLimit: limit == null ? null : minorText(limit, scale),
    receivable: minorText(row.receivable, scale),
    uninvoiced: minorText(row.uninvoiced, scale),
    quotation: minorText(row.quotation, scale),
    exposure: minorText(exposure, scale),
    // A limit of zero is a limit: any amount owed goes over it.
    over: limit != null && exposure > limit,
  }
}

export async function userNames(ctx: Ctx, ids: unknown[]) {
  const wanted = [...new Set(ids.filter(Boolean).map(String))]
  if (!wanted.length) return new Map<string, string>()
  const U = ctx.table('user.User')
  return new Map(
    (await ctx.db.all(from(U).select(U.id, U.name).where(inArray(U.id, wanted)))).map((row) => [
      String(row.id),
      text(row.name),
    ]),
  )
}

/** The people who can be named salesperson: active users of this company (one directory, D7). */
export async function listSalespeople(ctx: Ctx, args: Row = {}) {
  const M = ctx.table('user.Membership')
  const members = (
    await ctx.db.all(
      from(M)
        .select(M.userId)
        .where(eq(M.companyId, company(ctx))),
    )
  ).map((row) => String(row.userId))
  if (!members.length) return []
  const U = ctx.table('user.User')
  const search = text(args.search).normalize('NFKC').trim().toLocaleLowerCase('vi')
  return (await ctx.db.all(from(U).select(U.id, U.name, U.active).where(inArray(U.id, members))))
    .filter((row) => row.active !== false)
    .map((row) => ({ id: String(row.id), name: text(row.name) }))
    .filter((row) => !search || row.name.toLocaleLowerCase('vi').includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
}

/** What the customer page offers to choose from: salespeople, pricelists and payment terms. */
export async function customerChoices(ctx: Ctx) {
  const named = (rows: Row[]) =>
    rows
      .filter((row) => row.active !== false)
      .map((row) => ({ id: String(row.id), name: text(row.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  return {
    salespeople: await listSalespeople(ctx),
    pricelists: named(await ours(ctx, 'pricing.Pricelist')),
    terms: named(await ours(ctx, 'account.PaymentTerm')),
  }
}

export async function listCustomers(ctx: Ctx, args: Row) {
  const P = ctx.table('partner.Partner')
  const allowed = await customerIds(ctx)
  const search = text(args.search).normalize('NFKC').trim().toLocaleLowerCase('vi')
  const parties = (
    await ctx.db.all(from(P).select(P.id, P.kind, P.name, P.ref, P.phone, P.email).where(eq(P.active, true)))
  ).filter(
    (row) =>
      allowed.has(String(row.id)) &&
      (!search ||
        [row.name, row.ref, row.phone, row.email].some((value) =>
          text(value).toLocaleLowerCase('vi').includes(search),
        )),
  )
  const terms = byPartner(await ours(ctx, 'sale.CustomerTerms'))
  const limits = byPartner(await ours(ctx, 'partner.CompanyTerms'))
  let rows = parties
  if (args.mine === true) rows = rows.filter((row) => terms.get(String(row.id))?.userId === ctx.actor)
  if (args.over === true) {
    const limited = rows
      .filter((row) => limits.get(String(row.id))?.creditLimit != null)
      .map((row) => String(row.id))
    const over = new Set<string>()
    for (const id of limited) if ((await customerCredit(ctx, id)).over) over.add(id)
    rows = rows.filter((row) => over.has(String(row.id)))
  }
  rows.sort((a, b) => text(a.name).localeCompare(text(b.name), 'vi') || text(a.id).localeCompare(text(b.id)))
  const total = rows.length
  const offset = Math.max(0, Number(args.offset ?? 0))
  const page = rows.slice(offset, offset + Math.min(100, Math.max(1, Number(args.limit ?? 25))))
  const ids = page.map((row) => String(row.id))
  const { scale, currency, result } = await creditExposures(ctx, ids)
  const names = await userNames(
    ctx,
    ids.map((id) => terms.get(id)?.userId),
  )
  const termIds = [
    ...new Set(
      ids
        .map((id) => terms.get(id)?.paymentTermId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const termNames = new Map(
    termIds.length
      ? (await ctx.db.select('account.PaymentTerm')).map((row) => [String(row.id), text(row.name)])
      : [],
  )
  const O = ctx.table('sale.Order')
  const orderCounts = new Map<string, number>()
  if (ids.length)
    for (const order of await ctx.db.all(
      from(O)
        .select(O.partnerId, O.state)
        .where(eq(O.companyId, company(ctx)), inArray(O.partnerId, ids)),
    ))
      if (CONFIRMED.includes(String(order.state)))
        orderCounts.set(String(order.partnerId), (orderCounts.get(String(order.partnerId)) ?? 0) + 1)
  return {
    total,
    currency,
    rows: page.map((row) => {
      const id = String(row.id),
        own = terms.get(id),
        credit = result.get(id)!,
        exposure = credit.receivable + credit.uninvoiced
      const limit = limits.get(id)?.creditLimit
      return {
        id,
        kind: row.kind,
        name: row.name,
        ref: row.ref ?? null,
        phone: row.phone ?? null,
        email: row.email ?? null,
        salespersonId: own?.userId ?? null,
        salespersonName: own?.userId ? (names.get(String(own.userId)) ?? '') : '',
        paymentTermName: own?.paymentTermId ? (termNames.get(String(own.paymentTermId)) ?? '') : '',
        exposure: minorText(exposure, scale),
        creditLimit: limit == null ? null : minorText(moneyMinor(limit, scale), scale),
        over: limit != null && exposure > moneyMinor(limit, scale),
        orderCount: orderCounts.get(id) ?? 0,
      }
    }),
  }
}

export async function getCustomer(ctx: Ctx, args: Row) {
  const id = text(args.id)
  if (!(await customerIds(ctx, [id])).has(id)) return null
  const party = (await ctx.db.select('partner.Partner', { id }))[0]!
  const own = (await ours(ctx, 'sale.CustomerTerms', { partnerId: id }))[0]
  const names = await userNames(ctx, [own?.userId])
  const O = ctx.table('sale.Order')
  const recentOrders = (
    await ctx.db.all(
      from(O)
        .select(O.id, O.name, O.state, O.dateOrder, O.amountTotal, O.currency, O.invoiceStatus)
        .where(eq(O.companyId, company(ctx)), eq(O.partnerId, id))
        .orderBy(desc(O.dateOrder))
        .limit(5),
    )
  ).map((row) => ({ ...row, id: String(row.id) }))
  const M = ctx.table('account.Move')
  const openInvoices = (
    await ctx.db.all(
      from(M)
        .select(
          M.id,
          M.name,
          M.moveType,
          M.invoiceDate,
          M.invoiceDateDue,
          M.amountTotal,
          M.paymentState,
          M.currency,
        )
        .where(
          eq(M.companyId, company(ctx)),
          eq(M.partnerId, id),
          eq(M.state, 'posted'),
          eq(M.moveType, 'out_invoice'),
        )
        .orderBy(desc(M.invoiceDate)),
    )
  )
    .filter((row) => row.paymentState !== 'paid' && row.paymentState !== 'reversed')
    .slice(0, 10)
    .map((row) => ({ ...row, id: String(row.id) }))
  return {
    id,
    kind: party.kind,
    name: party.name,
    ref: party.ref ?? null,
    vat: party.vat ?? null,
    phone: party.phone ?? null,
    email: party.email ?? null,
    salespersonId: own?.userId ?? null,
    salespersonName: own?.userId ? (names.get(String(own.userId)) ?? '') : '',
    pricelistId: own?.pricelistId ?? null,
    paymentTermId: own?.paymentTermId ?? null,
    revision: Number(own?.revision ?? 0),
    credit: await customerCredit(ctx, id),
    recentOrders,
    openInvoices,
  }
}

async function salespersonIssue(ctx: Ctx, userId: unknown) {
  if (!userId) return null
  return (await listSalespeople(ctx)).some((row) => row.id === String(userId))
    ? null
    : invalid('salespersonId', 'sale.error.customerSalesperson')
}

async function heldTerms(ctx: Ctx, partnerId: string, expectedRevision: unknown) {
  const row = (await ours(ctx, 'sale.CustomerTerms', { partnerId }))[0]
  const revision = Number(row?.revision ?? 0)
  return { row, revision, stale: revision !== Number(expectedRevision ?? 0) }
}

async function writeTerms(ctx: Ctx, partnerId: string, held: Row | undefined, patch: Row) {
  const revision = Number(held?.revision ?? 0) + 1
  if (held) await ctx.db.update('sale.CustomerTerms', { id: held.id }, { ...patch, revision })
  else
    await ctx.db.insert('sale.CustomerTerms', {
      id: companyKey(ctx, 'customer-terms', partnerId),
      partnerId,
      userId: null,
      pricelistId: null,
      paymentTermId: null,
      ...patch,
      revision,
    })
  return revision
}

/**
 * Contact, salesperson and pricelist: what a seller keeps up to date (D11). A new customer
 * takes the customer role; a contact with no role becomes one when first saved here.
 */
export async function saveCustomer(ctx: Ctx, args: Row) {
  const id = text(args.id)
  const existing = (await ctx.db.select('partner.Partner', { id }))[0]
  if (existing && !(await customerIds(ctx, [id])).has(id)) return invalid('id', 'sale.error.customerMissing')
  const salesperson = await salespersonIssue(ctx, args.salespersonId)
  if (salesperson) return salesperson
  if (args.pricelistId && !(await ours(ctx, 'pricing.Pricelist', { id: args.pricelistId, active: true }))[0])
    return invalid('pricelistId', 'sale.error.customerPricelist')
  return ctx.tx(async (tx) => {
    const terms = await heldTerms(tx, id, args.expectedRevision)
    if (terms.stale) return invalid('expectedRevision', 'sale.error.customerChanged')
    const saved = await savePartnerRecord(tx, {
      id,
      kind: args.kind,
      name: args.name,
      ref: args.ref || null,
      vat: args.vat || null,
      phone: args.phone || null,
      email: args.email || null,
      parentId: existing?.parentId ?? null,
      lang: existing?.lang ?? null,
      ...(args.phone || args.email ? { contactConsent: true } : {}),
    })
    if (saved.ok !== true) return saved
    if (!(await tx.db.select('partner.Role', { partnerId: id, role: 'customer' }))[0])
      await tx.db.insertIfAbsent('partner.Role', { id: `${id}:customer`, partnerId: id, role: 'customer' })
    const revision = await writeTerms(tx, id, terms.row, {
      userId: args.salespersonId || null,
      pricelistId: args.pricelistId || null,
    })
    return { ok: true, id, revision }
  })
}

/** Payment term and credit limit: credit control, kept apart from the seller's edit (D11). */
export async function saveCustomerCredit(ctx: Ctx, args: Row) {
  const id = text(args.partnerId)
  if (!(await customerIds(ctx, [id])).has(id)) return invalid('partnerId', 'sale.error.customerMissing')
  const raw = args.creditLimit == null ? '' : String(args.creditLimit).trim()
  if (raw && !/^\d+(\.\d+)?$/.test(raw)) return invalid('creditLimit', 'sale.error.customerCreditLimit')
  if (
    args.paymentTermId &&
    !(await ours(ctx, 'account.PaymentTerm', { id: args.paymentTermId, active: true }))[0]
  )
    return invalid('paymentTermId', 'sale.error.customerPaymentTerm')
  return ctx.tx(async (tx) => {
    const terms = await heldTerms(tx, id, args.expectedRevision)
    if (terms.stale) return invalid('expectedRevision', 'sale.error.customerChanged')
    const limits = (await ours(tx, 'partner.CompanyTerms', { partnerId: id }))[0]
    const creditLimit = raw || null
    if (limits) await tx.db.update('partner.CompanyTerms', { id: limits.id }, { creditLimit })
    else if (creditLimit != null)
      await tx.db.insert('partner.CompanyTerms', {
        id: companyKey(tx, 'partner-terms', id),
        partnerId: id,
        creditLimit,
        note: null,
      })
    const revision = await writeTerms(tx, id, terms.row, { paymentTermId: args.paymentTermId || null })
    return { ok: true, id, revision }
  })
}
