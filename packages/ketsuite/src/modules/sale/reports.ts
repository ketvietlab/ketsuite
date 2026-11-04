import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, ReportDef, Row } from '@ketvietlab/ketjs'
import { ours } from './scope.ts'

/**
 * The printed face of an order.
 *
 * Quotation, sales order and pro-forma are one layout under three titles, so
 * the three cannot drift apart in the details a customer reads first: how long
 * the price holds, what the reference is, which unit a quantity is counted in,
 * and how the customer is expected to pay.
 */
const template = (title: string) => `<report paper="A4" margin="42">
  <header><row gap="6"><text size="10" weight="bold" tone="accent">{{ company.name }}</text><text size="8" weight="semibold" tone="muted" align="right">KETSUITE · SALES</text></row></header>
  <text size="9" weight="semibold" tone="accent" gap="12">{{ '${title}' | _ }}</text>
  <text size="24" weight="bold" gap="14">{{ name }}</text>
  <row gap="6"><text size="9" weight="semibold">{{ 'sale.report.number' | _ }} · {{ name }}</text><text size="9" tone="muted" align="right">{{ 'sale.report.date' | _ }} · {{ dateOrder | date }}</text></row>
  <row gap="12">{% if validityDate %}<text size="9" tone="muted">{{ 'sale.report.validity' | _ }} · {{ validityDate | date }}</text>{% endif %}{% if clientOrderRef %}<text size="9" tone="muted" align="right">{{ 'sale.report.reference' | _ }} · {{ clientOrderRef }}</text>{% endif %}</row>
  <text size="8" weight="semibold" tone="muted" gap="3">{{ 'sale.report.customer' | _ }}</text>
  <text size="12" weight="semibold" gap="18">{{ partner.name }}</text>
  {% for block in blocks %}
  {% if block.kind == 'section' %}<text size="11" weight="semibold" gap="8">{{ block.name }}{% if block.optional %} · {{ 'sale.report.optional' | _ }}{% endif %}</text>
  {% else %}{% if block.kind == 'note' %}<text size="9" tone="muted" gap="6">{{ block.name }}</text>
  {% else %}
  <table>{% if block.header %}<thead><tr><th>{{ 'sale.report.description' | _ }}</th><th>{{ 'sale.report.quantity' | _ }}</th><th>{{ 'sale.report.uom' | _ }}</th><th>{{ 'sale.report.unitPrice' | _ }}</th><th>{{ 'sale.report.discount' | _ }}</th><th>{{ 'sale.report.subtotal' | _ }}</th></tr></thead>{% endif %}
  <tbody>{% for line in block.lines %}<tr><td>{{ line.name }}</td><td>{{ line.productUomQty }}</td><td>{{ line.uomName }}</td><td>{{ line.priceUnit | amount: currency }}</td><td>{{ line.discount }}</td><td>{{ line.priceSubtotal | amount: currency }}</td></tr>{% endfor %}</tbody></table>
  {% endif %}{% endif %}
  {% endfor %}
  <text size="9" tone="muted" align="right" gap="5">{{ 'sale.report.untaxed' | _ }} · {{ amountUntaxed | amount: currency }}</text>
  <text size="9" tone="muted" align="right" gap="7">{{ 'sale.report.tax' | _ }} · {{ amountTax | amount: currency }}</text>
  <text size="15" weight="bold" tone="accent" align="right" gap="4">{{ 'sale.report.total' | _ }} · {{ amountTotal | amount: currency }}</text>
  {% if paymentTermName %}<text size="8" weight="semibold" tone="muted" gap="10">{{ 'sale.report.paymentTerm' | _ }}</text><text size="9" gap="4">{{ paymentTermName }}</text>{% endif %}
  {% if notes %}<text size="8" weight="semibold" tone="muted" gap="8">{{ 'sale.report.notes' | _ }}</text><text size="9" gap="4">{{ notes }}</text>{% endif %}
  <footer><row gap="0"><text size="8" weight="semibold" tone="muted">{{ company.name }}</text><text size="8" tone="muted" align="right">{page} / {pages}</text></row></footer>
</report>`

/**
 * The order behind a printed document, or nothing.
 *
 * The read is narrowed to the active company. `/reports/{report}/{id}` calls a
 * report's source with only the record id and enforces nothing itself, so an
 * unnarrowed select here hands a user who holds two companies the other
 * company's document for any id they can guess. `ours` is the same helper the
 * rest of `sale` reads through.
 */
async function data(ctx: Parameters<FnSpec['handler']>[0], id: unknown, states: string[]) {
  const order = (await ours(ctx, 'sale.Order', { id }))[0]
  if (!order || !states.includes(String(order.state))) return null
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  const companyParty = company ? (await ctx.db.select('partner.Partner', { id: company.partnerId }))[0] : null
  const partner = (await ctx.db.select('partner.Partner', { id: order.partnerId }))[0]
  const paymentTerm = order.paymentTermId
    ? (await ctx.db.select('account.PaymentTerm', { id: order.paymentTermId }))[0]
    : null
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId: id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
  )
  // A quantity without its unit is not a quantity a customer can check.
  const units = new Map((await ctx.db.select('uom.Unit')).map((unit) => [String(unit.id), String(unit.name)]))
  const printableLines: Row[] = lines.map((line) => ({
    ...line,
    uomName: units.get(String(line.productUomId)) ?? '',
  }))
  // The public report grammar has no merged table cells. Compose structural text
  // blocks and contiguous commercial tables with the same six-column layout.
  const blocks: Row[] = []
  for (const line of printableLines) {
    if (line.displayType === 'section' || line.displayType === 'note') {
      blocks.push({
        kind: line.displayType,
        name: line.name,
        optional: line.displayType === 'section' && line.optionalSection === true,
      })
    } else {
      let block = blocks.at(-1)
      if (block?.kind !== 'lines') {
        block = { kind: 'lines', header: !blocks.some((held) => held.kind === 'lines'), lines: [] }
        blocks.push(block)
      }
      ;(block.lines as Row[]).push(line)
    }
  }
  return {
    ...order,
    company: companyParty ?? { name: '' },
    partner: partner ?? { name: '' },
    paymentTermName: paymentTerm ? String(paymentTerm.name) : null,
    lines: printableLines,
    blocks,
  }
}

const effects = [
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:company.Company',
  'read:partner.Partner',
  'read:account.PaymentTerm',
  'read:uom.Unit',
]
const output = {
  id: 'id',
  name: 'text',
  dateOrder: 'datetime',
  validityDate: 'datetime?',
  clientOrderRef: 'text?',
  notes: 'text?',
  currency: 'text',
  amountUntaxed: 'decimal',
  amountTax: 'decimal',
  amountTotal: 'decimal',
  paymentTermName: 'text?',
  company: 'json',
  partner: 'json',
  lines: 'json',
  blocks: 'json',
}
export const reportFunctions: Record<string, FnSpec> = {
  // A cancelled order prints as a quotation: it is listed with the quotations
  // and `resetOrder` returns it to draft, so that is the document it is. It used
  // to print nothing at all, which left no record of what was cancelled.
  getQuotationReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, ['draft', 'sent', 'cancel']),
  }),
  getSalesOrderReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, ['sale']),
  }),
  // A pro-forma is how an order asks to be paid before there is an invoice to
  // pay against. It is not an accounting document and never posts.
  getProformaReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, ['sent', 'sale']),
  }),
}

export const reports: Record<string, ReportDef> = {
  quotation: {
    title: 'sale.report.quotation',
    target: 'sale.Order',
    source: 'sale.getQuotationReport',
    template: template('sale.report.quotation'),
    filename: 'quotation',
  },
  salesOrder: {
    title: 'sale.report.salesOrder',
    target: 'sale.Order',
    source: 'sale.getSalesOrderReport',
    template: template('sale.report.salesOrder'),
    filename: 'sales-order',
  },
  proforma: {
    title: 'sale.report.proforma',
    target: 'sale.Order',
    source: 'sale.getProformaReport',
    template: template('sale.report.proforma'),
    filename: 'proforma-invoice',
  },
}
