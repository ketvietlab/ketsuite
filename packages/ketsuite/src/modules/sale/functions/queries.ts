import { invoiceQuantities } from '../invoice-quantities.ts'
import { lineInvoicePolicy } from '../configuration.ts'
import { orderSalesWarnings, warningReadEffects } from '../warnings.ts'
import { expectedDeliveryDate, deliveryDay } from '../delivery-promise.ts'
import { describeVariantName, VARIANT_NAME_EFFECTS } from '../../product/functions/variants.ts'
import { orderPage, ordersSelling } from '../order-page.ts'
import { ordersTagged, withTagNames } from '../tags.ts'
import { ordersInTeams, withSalesNames } from '../teams.ts'
import { companyScoped } from '../../product/import-catalogue.ts'
import {
  dateBucket,
  defineFn,
  desc,
  eq,
  from,
  gte,
  ilike,
  inArray,
  localDayRange,
  lt,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, GroupRow, Row } from '@ketvietlab/ketjs'
import { minorText, moneyMinor, scaleOf } from '../../account/money.ts'
import { company, ours } from '../scope.ts'
import { depositsOf } from './deposits.ts'
import { now, wildcard, companyCurrency, movesOf, invoiceLinesOf } from './shared.ts'

export async function listOrdersHandler(ctx: Ctx, args: Row) {
  if (args.listState) return orderPage(ctx, args)
  const O = ctx.table('sale.Order')
  const states = Array.isArray(args.states) ? args.states.map(String) : []
  const limit = Math.max(1, Math.min(Math.trunc(Number(args.limit) || 500), 2_000))
  const rows = await ctx.db.all(
    from(O)
      .where(
        eq(O.companyId, company(ctx)),
        ...(args.state ? [eq(O.state, String(args.state))] : []),
        ...(states.length ? [inArray(O.state, states)] : []),
        ...(args.partnerId ? [eq(O.partnerId, String(args.partnerId))] : []),
        ...(args.productId ? [inArray(O.id, await ordersSelling(ctx, args.productId))] : []),
        ...(args.dateFrom ? [gte(O.dateOrder, String(args.dateFrom))] : []),
        ...(args.dateTo ? [lt(O.dateOrder, String(args.dateTo))] : []),
        ...(args.search
          ? [
              or(
                ilike(O.name, `%${wildcard(args.search)}%`, true),
                ilike(O.clientOrderRef, `%${wildcard(args.search)}%`, true),
                inArray(O.id, await ordersTagged(ctx, String(args.search))),
                inArray(O.id, await ordersInTeams(ctx, String(args.search))),
              ),
            ]
          : []),
      )
      .orderBy(desc(O.dateOrder), desc(O.id))
      .limit(limit)
      .offset(Math.max(0, Math.trunc(Number(args.offset) || 0))),
  )
  return withSalesNames(ctx, await withTagNames(ctx, rows))
}

export async function countOrdersHandler(ctx: Ctx, args: Row) {
  const O = ctx.table('sale.Order')
  const mine = eq(O.companyId, company(ctx))
  const currency = await companyCurrency(ctx)
  // Amounts are summed for the company's own currency and no other. Every
  // order takes that currency when it is raised, so in practice this is all
  // of them; what it rules out is a company that changed currency later
  // having its old đồng added to its new dollars and shown as one figure.
  const priced = eq(O.currency, currency)
  // "Today" is the reader's today. The timezone is the viewer's, so a
  // quotation raised at nine in Ho Chi Minh City counts on the day it was
  // raised rather than on the day it was in London.
  const timezone = String(args.timezone ?? 'UTC')
  const [dayStart, dayEnd] = localDayRange(dateBucket(now(), 'day', timezone) ?? '1970-01-01', timezone)
  const scale = scaleOf(currency)
  const countOf = (rows: GroupRow[], key: string) => rows.find((row) => row.key[0] === key)?.count ?? 0
  const totalOf = (rows: GroupRow[], key: string) => {
    const amount = rows.find((row) => row.key[0] === key)?.aggregates.amount ?? '0'
    return minorText(moneyMinor(String(amount), scale), scale)
  }
  // Grouped aggregates keep this response proportional to the number of
  // states, not the number (or byte width) of imported orders. In
  // particular, never materialise six figures of full Order rows in the
  // application process just to add one decimal column.
  const [stateGroups, invoiceGroups, stateTotals, invoiceTotals, draftToday] = await Promise.all([
    ctx.db.group(from(O).where(mine).groupBy({ col: O.state })),
    ctx.db.group(from(O).where(mine).groupBy({ col: O.invoiceStatus })),
    ctx.db.group(
      from(O)
        .where(mine, priced)
        .groupBy({ col: O.state })
        .aggregate({ fn: 'sum', col: O.amountTotal, as: 'amount' }),
    ),
    ctx.db.group(
      from(O)
        .where(mine, priced)
        .groupBy({ col: O.invoiceStatus })
        .aggregate({ fn: 'sum', col: O.amountTotal, as: 'amount' }),
    ),
    ctx.db.count(
      from(O).where(mine, eq(O.state, 'draft'), gte(O.dateOrder, dayStart), lt(O.dateOrder, dayEnd)),
    ),
  ])
  return {
    draft: countOf(stateGroups, 'draft'),
    sent: countOf(stateGroups, 'sent'),
    sale: countOf(stateGroups, 'sale'),
    toInvoice: countOf(invoiceGroups, 'to invoice'),
    draftToday,
    sentTotal: totalOf(stateTotals, 'sent'),
    saleTotal: totalOf(stateTotals, 'sale'),
    toInvoiceTotal: totalOf(invoiceTotals, 'to invoice'),
    currency,
  }
}

export async function getOrderHandler(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order) return null
  const lines = await ours(ctx, 'sale.OrderLine', { orderId: args.id })
  lines.sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
  const choices = new Map<string, Row[]>()
  for (const id of new Set(
    lines.flatMap((line) => (line.comboChoiceId ? [String(line.comboChoiceId)] : [])),
  )) {
    const options: Row[] = []
    for (const item of await ctx.db.select('product.ComboItem', { comboId: id })) {
      const sku = (await ctx.db.select('product.Product', { id: item.productId }))[0]
      const template = sku && (await ctx.db.select('product.Template', { id: sku.templateId }))[0]
      if (
        !sku ||
        sku.active === false ||
        !template ||
        template.active === false ||
        template.saleOk !== true ||
        template.type === 'combo'
      )
        continue
      options.push({
        id: sku.id,
        code: sku.defaultCode ?? null,
        name: await describeVariantName(ctx, sku, template),
        uomId: template.uomId,
      })
    }
    choices.set(id, options)
  }
  const productIds = [...new Set(lines.flatMap((line) => (line.productId ? [String(line.productId)] : [])))]
  const Product = ctx.table('product.Product')
  const products = productIds.length
    ? await ctx.db.all(
        from(Product).where(
          inArray(Product.id, productIds),
          // A catalogue kept per company (Commerce) holds its own products; a shared one has none.
          ...(companyScoped(ctx, 'product.Product') ? [eq(Product.companyId, company(ctx))] : []),
        ),
      )
    : []
  const templateIds = [...new Set(products.map((product) => String(product.templateId)))]
  const T = ctx.table('product.Template')
  const templates = templateIds.length ? await ctx.db.all(from(T).where(inArray(T.id, templateIds))) : []
  const templatesById = new Map(templates.map((template) => [String(template.id), template]))
  const templateOf = new Map(
    products.map((product) => [String(product.id), templatesById.get(String(product.templateId))]),
  )
  const policyOf = (line: Row) => lineInvoicePolicy(line, templateOf.get(String(line.productId)))
  const productCodes = new Map(
    products.map((product) => [String(product.id), String(product.defaultCode ?? '')]),
  )
  const lineIds = lines.map((line) => String(line.id))
  const U = ctx.table('uom.Unit')
  const unitIds = [...new Set(lines.map((line) => String(line.productUomId)))]
  const units = unitIds.length ? await ctx.db.all(from(U).where(inArray(U.id, unitIds))) : []
  const unitNames = new Map(units.map((unit) => [String(unit.id), String(unit.name)]))
  const moves = await movesOf(ctx, lineIds)
  const pickingIds = [...new Set(moves.flatMap((move) => (move.pickingId ? [String(move.pickingId)] : [])))]
  const invoiceLines = await invoiceLinesOf(ctx, lineIds)
  const ids = [...new Set(invoiceLines.map((line) => String(line.moveId)))]
  const A = ctx.table('account.Move')
  const P = ctx.table('stock.Picking')
  return {
    ...order,
    saleWarnings: await orderSalesWarnings(ctx, order, lines),
    expectedDate: await expectedDeliveryDate(ctx, order, lines),
    commitmentDay: order.commitmentDate ? await deliveryDay(ctx, order.commitmentDate) : null,
    lines: lines.map((line) => ({
      ...line,
      invoicePolicy: policyOf(line),
      ...invoiceQuantities(line, policyOf(line)),
      productCode: line.productId ? (productCodes.get(String(line.productId)) ?? null) : null,
      ...(line.comboChoiceId ? { comboOptions: choices.get(String(line.comboChoiceId)) ?? [] } : {}),
      productUomName:
        unitNames.get(String(line.productUomId)) ?? (line.productUomId ? String(line.productUomId) : ''),
    })),
    moves,
    pickings: pickingIds.length ? await ctx.db.all(from(P).where(inArray(P.id, pickingIds))) : [],
    invoices: ids.length ? await ctx.db.all(from(A).where(inArray(A.id, ids))) : [],
    deposits: await depositsOf(ctx, String(order.id)),
  }
}

export const queriesFunctions: Record<string, FnSpec> = {
  listOrders: defineFn({
    input: {
      state: 'text?',
      listState: 'json?',
      listMode: 'text?',
      path: 'json?',
      cursor: 'text?',
      timezone: 'text?',
      states: 'json?',
      partnerId: 'id?',
      // Orders with a line for this variant (P32).
      productId: 'id?',
      search: 'text?',
      // A caller reporting on a window wants that window, not the history in
      // front of it. Without these it had to page until the table ran out and
      // discard the rest in memory, which is the cost this list was bounded to
      // avoid in the first place.
      dateFrom: 'datetime?',
      dateTo: 'datetime?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:partner.Partner',
      'read:sale.Tag',
      'read:sale.OrderTag',
      // A team's name finds its orders, which list their salesperson and team (D16).
      'read:sale.Team',
      'read:user.User',
      // A product filter reads the variants of its template (D19).
      'read:product.Product',
    ],
    agent: true,
    // Bounded and newest-first. Unbounded, a tenant with an imported order
    // history handed the whole table to every caller — the quotations screen
    // was loading six figures of rows to show a page.
    handler: listOrdersHandler,
  }),
  countOrders: defineFn({
    input: { timezone: 'text?' },
    output: {
      draft: 'int',
      sent: 'int',
      sale: 'int',
      toInvoice: 'int',
      draftToday: 'int',
      sentTotal: 'decimal',
      saleTotal: 'decimal',
      toInvoiceTotal: 'decimal',
      currency: 'text',
    },
    effects: ['read:sale.Order', 'read:company.Company'],
    agent: true,
    handler: countOrdersHandler,
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: [
      ...warningReadEffects,
      'read:company.Company',
      ...VARIANT_NAME_EFFECTS,
      'read:product.ComboItem',
      'read:product.Product',
      'read:product.Template',
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:uom.Unit',
      'read:stock.Move',
      'read:stock.Picking',
      'read:account.MoveLine',
      'read:account.Move',
      // The order's deposits and what each still holds (D9).
      'read:sale.OrderDeposit',
      'read:account.Payment',
      'read:account.Journal',
    ],
    agent: true,
    handler: getOrderHandler,
  }),
}
