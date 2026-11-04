import { randomUUID } from 'node:crypto'
import { json, text, type Route, type Row, type ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { formatMoney } from '../../../ui/format.ts'
import { customerRecordScreen, customersScreen } from './screens.tsx'
import { creditSummary } from './credit-summary.ts'
import { customerRead, listLabels, searchConfig } from './read.ts'
import { LIST_PATH, queryFromUrl, recordBack } from './shared.ts'
import { salesOrderPath } from '../order-path.ts'

const scoped = (url: URL, path: string) => {
  const next = new URL(path, url)
  for (const key of ['lang', 'company', 'branch'])
    if (url.searchParams.has(key)) next.searchParams.set(key, url.searchParams.get(key)!)
  return next.pathname + next.search
}

const day = (value: unknown) => (value ? String(value).slice(0, 10) : '—')

export const customerContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new',
      save = await ctx.allows('sale.saveCustomer', url, req),
      credit = await ctx.allows('sale.saveCustomerCredit', url, req)
    if (!(await ctx.allows('sale.getCustomer', url, req)) || (creating && !save))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', kind: 'person', name: '', revision: 0 }
      : ((await ctx.call('sale.getCustomer', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const _ = ctx.translate(lang)
    const choices = await optionalRead<Row>(ctx, 'sale.getCustomerChoices', {}, url, req, {
      salespeople: [],
      pricelists: [],
      terms: [],
    })
    // A chosen value the reader may no longer pick (an archived pricelist, a former member) still shows.
    const keep = (rows: Row[], id: unknown, name: unknown) =>
      id && !rows.some((row) => row.id === id) ? [...rows, { id, name: name || id }] : rows
    const creditRow = (record.credit as Row | undefined) ?? {}
    const terms = keep(choices.terms as Row[], record.paymentTermId, record.paymentTermId)
    const summary = creditSummary(_, creditRow)
    const manifest = await ctx.live(req)
    const money = (value: unknown, currency: unknown) => formatMoney(_, value, currency)
    return json({
      data: {
        record: { ...record, creditLimit: creditRow.creditLimit ?? '' },
        draftId: randomUUID(),
        save,
        credit,
        lang,
        choices: {
          salespeople: keep(choices.salespeople as Row[], record.salespersonId, record.salespersonName),
          pricelists: keep(choices.pricelists as Row[], record.pricelistId, record.pricelistId),
          terms,
        },
        summary: {
          ...summary,
          paymentTermName: String(
            terms.find((row) => row.id === record.paymentTermId)?.name ?? _('sale_backend.customers.none'),
          ),
        },
        orders: ((record.recentOrders as Row[] | undefined) ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          href: scoped(url, salesOrderPath(row.state, row.id)),
          date: day(row.dateOrder),
          state: _.resolves(`sale_backend.state.${row.state}`)
            ? _(`sale_backend.state.${row.state}`)
            : row.state,
          amount: money(row.amountTotal, row.currency),
        })),
        invoices: ((record.openInvoices as Row[] | undefined) ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          date: day(row.invoiceDate),
          due: day(row.invoiceDateDue),
          state: _.resolves(`sale_backend.customers.paymentState.${row.paymentState}`)
            ? _(`sale_backend.customers.paymentState.${row.paymentState}`)
            : row.paymentState,
          amount: money(row.amountTotal, row.currency),
        })),
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) =>
              key.startsWith('sale_backend.customers.') ||
              key.startsWith('sale.error.') ||
              key.startsWith('partner.error.') ||
              key.startsWith('backend.relation.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }

export const customerRecord =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows(params.id === 'new' ? 'sale.saveCustomer' : 'sale.getCustomer', url, req)))
      return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'sale_backend.customers.title',
      active: LIST_PATH,
      body: (_, frame) =>
        customerRecordScreen(_, frame, {
          id: params.id!,
          title: _('sale_backend.customers.title'),
          loading: _('backend.relation.loading'),
          back: recordBack(url),
        }),
    })
  }

export const customerList =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.listCustomers', url, req))) return text('Forbidden', { status: 403 })
    const save = await ctx.allows('sale.saveCustomer', url, req)
    return adminPage(ctx, url, req, {
      title: 'sale_backend.customers.title',
      active: LIST_PATH,
      body: (_, frame) =>
        customersScreen(_, frame, {
          createHref: save ? scoped(url, LIST_PATH + '/new') : null,
          props: {
            key: randomUUID(),
            source: scoped(url, LIST_PATH + '/read'),
            query: queryFromUrl(url),
            search: searchConfig(url, _),
            labels: listLabels(_),
          },
        }),
    })
  }

export const customerRoutes = {
  '/admin/sales/customers': customerList,
  '/admin/sales/customers/read': customerRead,
  '/admin/sales/customers/{id}': customerRecord,
  '/admin/sales/customers/{id}/context': customerContext,
}
