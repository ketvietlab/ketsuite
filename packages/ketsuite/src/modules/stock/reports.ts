import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, ReportDef, Row } from '@ketvietlab/ketjs'
import { minorText } from '../account/money.ts'
import { civilDate } from '../company/civil-date.ts'
import { defaultAddressFor, presentationOf } from '../partner/functions/helpers.ts'
import { ours } from './scope.ts'
import { moneyMinor, scaleFor, share, units, unitsText } from './valuation.ts'

/**
 * A stock operation's printed copy (K65): what was asked and what moved, line by line and lot by
 * lot with each lot's expiry date, laid out as the receipt and delivery vouchers of Vietnamese
 * bookkeeping (templates 01-VT and 02-VT, for reference in Appendix I of Circular 99/2025/TT-BTC),
 * with room for who prepares, hands over, keeps and checks the goods to sign.
 *
 * The report grammar spreads a table's cells evenly and does not wrap inside one, so a product
 * reads on its own line and its lots follow in a narrow table: a long name never runs into the
 * next column. Each kind has a second copy with unit costs, amounts and the total in words; its
 * source needs the stock valuation grant, so the menu offers it only to who may read stock value.
 */
const template = `<report paper="A4" margin="36">
  <header><row gap="4"><text size="9" weight="bold" tone="accent">{{ company.name }}</text><text size="8" weight="semibold" tone="muted" align="right">{% if voucher.form %}{{ voucher.form | _ }}{% endif %}</text></row></header>
  {% if company.address %}<text size="8" tone="muted" gap="2">{{ company.address }}</text>{% endif %}
  {% if company.vat %}<text size="8" tone="muted" gap="2">{{ 'stock.report.vat' | _ }} · {{ company.vat }}</text>{% endif %}
  {% if voucher.form %}<text size="7" tone="muted" align="right" gap="10">{{ 'stock.report.formReference' | _ }}</text>{% endif %}
  <text size="18" weight="bold" align="center" gap="4">{{ voucher.title | _ }}</text>
  <text size="9" align="center" gap="2">{{ 'stock.report.date' | _ }} · {{ date | date }}</text>
  <text size="9" weight="semibold" align="center" gap="14">{{ 'stock.report.number' | _ }} · {{ name }}</text>
  {% if voucher.partner %}{% if partner.name %}<text size="9" gap="3">{{ voucher.partner | _ }}: {{ partner.name }}</text>{% endif %}{% endif %}
  {% if partner.address %}<text size="9" gap="3">{{ 'stock.report.address' | _ }}: {{ partner.address }}</text>{% endif %}
  {% if origin %}<text size="9" gap="3">{{ 'stock.report.origin' | _ }}: {{ origin }}</text>{% endif %}
  <text size="9" gap="3">{{ voucher.place | _ }}: {{ warehouse }}</text>
  <row gap="14"><text size="9" tone="muted">{{ 'stock.report.from' | _ }} · {{ source.name }}</text><text size="9" tone="muted" align="right">{{ 'stock.report.to' | _ }} · {{ destination.name }}</text></row>
  {% for line in lines %}
  <text size="10" weight="semibold" gap="3">{{ line.no }}. {% if line.code %}{{ line.code }} · {% endif %}{{ line.product }} · {{ line.uom }}</text>
  <table>{% if line.first %}<thead><tr><th>{{ 'stock.report.lot' | _ }}</th><th>{{ 'stock.report.expiry' | _ }}</th><th>{{ voucher.demand | _ }}</th>{% if showHeld %}<th>{{ 'stock.report.held' | _ }}</th>{% endif %}<th>{{ voucher.done | _ }}</th>{% if valued %}<th>{{ 'stock.report.unitCost' | _ }}</th><th>{{ 'stock.report.amount' | _ }}</th>{% endif %}</tr></thead>{% endif %}
  <tbody>{% for row in line.rows %}<tr><td>{{ row.lot }}</td><td>{{ row.expiry | date }}</td><td>{{ row.demand }}</td>{% if showHeld %}<td>{{ row.held }}</td>{% endif %}<td>{{ row.quantity }}</td>{% if valued %}<td>{{ row.unitCost | amount: currency }}</td><td>{{ row.amount | amount: currency }}</td>{% endif %}</tr>{% endfor %}</tbody></table>
  {% endfor %}
  {% if valued %}<text size="11" weight="bold" align="right" gap="4">{{ 'stock.report.total' | _ }} · {{ total | amount: currency }}</text>
  <text size="9" gap="16">{{ 'stock.report.inWords' | _ }}: {{ total | words: currency }}</text>{% endif %}
  <row gap="2">{% for signer in voucher.signers %}<text size="9" weight="semibold" align="center">{{ signer | _ }}</text>{% endfor %}</row>
  <row gap="56">{% for signer in voucher.signers %}<text size="8" tone="muted" align="center">{{ 'stock.report.signHint' | _ }}</text>{% endfor %}</row>
  <footer><row gap="0"><text size="8" weight="semibold" tone="muted">{{ company.name }} · {{ name }}</text><text size="8" tone="muted" align="right">{page} / {pages}</text></row></footer>
</report>`

type Code = 'incoming' | 'outgoing' | 'internal'

// The voucher each kind of operation prints as, and who signs it.
const vouchers: Record<Code, Row> = {
  incoming: {
    title: 'stock.report.receipt',
    form: 'stock.report.receiptForm',
    partner: 'stock.report.deliverer',
    place: 'stock.report.receivedInto',
    demand: 'stock.report.expected',
    done: 'stock.report.received',
    signers: [
      'stock.report.preparedBy',
      'stock.report.deliveredBy',
      'stock.report.storekeeper',
      'stock.report.chiefAccountant',
    ],
  },
  outgoing: {
    title: 'stock.report.delivery',
    form: 'stock.report.deliveryForm',
    partner: 'stock.report.receiver',
    place: 'stock.report.shippedFrom',
    demand: 'stock.report.demand',
    done: 'stock.report.delivered',
    signers: [
      'stock.report.preparedBy',
      'stock.report.receivedBy',
      'stock.report.storekeeper',
      'stock.report.chiefAccountant',
    ],
  },
  internal: {
    title: 'stock.report.internalTransfer',
    form: null,
    partner: null,
    place: 'stock.report.shippedFrom',
    demand: 'stock.report.demand',
    done: 'stock.report.moved',
    signers: [
      'stock.report.preparedBy',
      'stock.report.deliveredBy',
      'stock.report.storekeeper',
      'stock.report.receivedBy',
    ],
  },
}

/** One line of a party's address, the delivery one first; empty when it keeps none. */
async function addressOf(ctx: Ctx, partnerId: unknown): Promise<string> {
  if (!partnerId) return ''
  for (const use of ['delivery', 'contact']) {
    const address = await defaultAddressFor(ctx, String(partnerId), use)
    if (address) return String((await presentationOf(ctx, address)).oneLine ?? '')
  }
  return ''
}

/**
 * What an operation's printed copy reads, or nothing.
 *
 * `/reports/{report}/{id}` calls a source with only the record id and enforces nothing itself,
 * so every read is narrowed to the active company: a user who holds two companies must not get
 * the other one's document for an id they can guess. `valued` copies only a completed operation,
 * whose stock value the valuation layers have booked.
 */
async function data(ctx: Ctx, id: unknown, code: Code, valued: boolean) {
  if (!ctx.scope.company) return null
  const picking = (await ours(ctx, 'stock.Picking', { id }))[0]
  if (!picking) return null
  const type = (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
  if (!type || type.code !== code) return null
  const done = picking.state === 'done'
  if (valued && !done) return null
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  // Dates print as the company's calendar day: an expiry is stored as that day's midnight there.
  const zone = String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh')
  const date = (value: unknown) => (value ? civilDate(String(value), zone) : '')
  const companyParty = company
    ? (await ctx.db.select('partner.Partner', { id: company.partnerId }))[0]
    : undefined
  const partner = picking.partnerId
    ? (await ctx.db.select('partner.Partner', { id: picking.partnerId }))[0]
    : undefined
  const warehouse = type.warehouseId
    ? (await ours(ctx, 'stock.Warehouse', { id: type.warehouseId }))[0]
    : undefined
  const source = (await ours(ctx, 'stock.Location', { id: picking.locationId }))[0]
  const destination = (await ours(ctx, 'stock.Location', { id: picking.locationDestId }))[0]
  const moves = (await ours(ctx, 'stock.Move', { pickingId: picking.id })).filter(
    (move) => move.state !== 'cancel',
  )
  const unitNames = new Map(
    (await ctx.db.select('uom.Unit')).map((row) => [String(row.id), String(row.name)]),
  )
  const currency = String(company?.currency ?? 'VND')
  const scale = await scaleFor(ctx)
  // What each completed line moved is worth, as the valuation layers booked it.
  const worth = new Map<string, bigint>()
  if (valued)
    for (const layer of await ours(ctx, 'stock.ValuationLayer', { pickingId: picking.id })) {
      if (!layer.moveLineId) continue
      const value = moneyMinor(layer.value, scale)
      const key = String(layer.moveLineId)
      worth.set(key, (worth.get(key) ?? 0n) + (value < 0n ? -value : value))
    }
  let total = 0n
  const lines: Row[] = []
  for (const move of moves) {
    const product = (await ours(ctx, 'product.Product', { id: move.productId }))[0]
    const moveLines = await ours(ctx, 'stock.MoveLine', { moveId: move.id })
    const parts: Row[] = []
    for (const line of moveLines) {
      const lot = line.lotId ? (await ours(ctx, 'stock.Lot', { id: line.lotId }))[0] : undefined
      // Before it is done, a delivery's or transfer's line is what is held for it; a receipt's is the lot
      // it was given, its quantity written in on arrival.
      const quantity = unitsText(units(line.quantity))
      const amount = worth.get(String(line.id))
      if (amount !== undefined) total += amount
      parts.push({
        lot: String(lot?.name ?? line.receiptLotName ?? ''),
        expiry: date(lot?.expirationDate ?? line.receiptExpirationDate),
        held: !done && code !== 'incoming' ? quantity : '',
        quantity: done ? quantity : '',
        unitCost:
          amount !== undefined && units(line.quantity) > 0n
            ? minorText(share(amount, 1_000_000n, units(line.quantity)), scale)
            : '',
        amount: amount === undefined ? '' : minorText(amount, scale),
      })
    }
    if (!parts.length)
      parts.push({
        lot: '',
        expiry: '',
        held: '',
        quantity: done ? unitsText(units(move.quantity)) : '',
        unitCost: '',
        amount: '',
      })
    lines.push({
      no: lines.length + 1,
      first: lines.length === 0,
      code: String(product?.defaultCode ?? ''),
      product: String(move.name ?? ''),
      uom: unitNames.get(String(move.productUomId)) ?? '',
      // What was asked reads once, on a line's first lot.
      rows: parts.map((part, index) => ({
        ...part,
        demand: index === 0 ? unitsText(units(move.productUomQty)) : '',
      })),
    })
  }
  const origins = [...new Set(moves.map((move) => String(move.origin ?? '')).filter(Boolean))]
  return {
    ...picking,
    date: date(picking.dateDone ?? picking.scheduledDate),
    done,
    valued,
    currency,
    voucher: vouchers[code],
    company: {
      name: String(companyParty?.name ?? ''),
      vat: String(companyParty?.vat ?? ''),
      address: await addressOf(ctx, companyParty?.id),
    },
    partner: { name: String(partner?.name ?? ''), address: await addressOf(ctx, partner?.id) },
    origin: origins.join(', '),
    warehouse: String(warehouse?.name ?? source?.name ?? ''),
    source: source ?? { name: '' },
    destination: destination ?? { name: '' },
    operationType: type,
    // Kept for templates a tenant customised before K65.
    moves,
    lines,
    showHeld: !done && lines.some((line) => (line.rows as Row[]).some((row) => row.held)),
    total: valued ? minorText(total, scale) : '',
  }
}

const effects = [
  'read:stock.Picking',
  'read:stock.PickingType',
  'read:stock.Warehouse',
  'read:stock.Location',
  'read:stock.Move',
  'read:stock.MoveLine',
  'read:stock.Lot',
  'read:product.Product',
  'read:uom.Unit',
  'read:company.Company',
  'read:partner.Partner',
  'read:partner.Address',
  'read:partner.AddressDefault',
  'read:address.Country',
  'read:address.CurrentCatalog',
  'read:address.Division',
]
const output = {
  id: 'id',
  name: 'text',
  scheduledDate: 'datetime',
  date: 'text',
  done: 'bool',
  valued: 'bool',
  currency: 'text',
  voucher: 'json',
  company: 'json',
  partner: 'json',
  origin: 'text',
  warehouse: 'text',
  operationType: 'json',
  source: 'json',
  destination: 'json',
  moves: 'json',
  lines: 'json',
  showHeld: 'bool',
  total: 'text',
}
const source = (code: Code, valued: boolean) =>
  defineFn({
    input: { id: 'id' },
    output,
    effects: valued ? [...effects, 'read:stock.ValuationLayer'] : effects,
    handler: (ctx, args) => data(ctx, args.id, code, valued),
  })

export const reportFunctions: Record<string, FnSpec> = {
  getReceiptReport: source('incoming', false),
  getDeliveryReport: source('outgoing', false),
  getInternalTransferReport: source('internal', false),
  getValuedReceiptReport: source('incoming', true),
  getValuedDeliveryReport: source('outgoing', true),
  getValuedInternalTransferReport: source('internal', true),
}

const report = (title: string, source: string, filename: string): ReportDef => ({
  title,
  target: 'stock.Picking',
  source,
  template,
  filename,
})
export const reports: Record<string, ReportDef> = {
  receipt: report('stock.report.receipt', 'stock.getReceiptReport', 'receipt'),
  delivery: report('stock.report.delivery', 'stock.getDeliveryReport', 'delivery-slip'),
  internalTransfer: report(
    'stock.report.internalTransfer',
    'stock.getInternalTransferReport',
    'internal-transfer',
  ),
  receiptValued: report('stock.report.receiptValued', 'stock.getValuedReceiptReport', 'receipt-valued'),
  deliveryValued: report(
    'stock.report.deliveryValued',
    'stock.getValuedDeliveryReport',
    'delivery-slip-valued',
  ),
  internalTransferValued: report(
    'stock.report.internalTransferValued',
    'stock.getValuedInternalTransferReport',
    'internal-transfer-valued',
  ),
}

/**
 * The printed copies each kind of operation offers: the plain one and, once it is done, the one with
 * values. Each names the function that reads it, the one its reader must be allowed.
 */
export const PICKING_PRINTS: Record<string, { plain: Print; valued: Print }> = {
  incoming: {
    plain: { title: 'stock.report.receipt', source: 'stock.getReceiptReport' },
    valued: { title: 'stock.report.receiptValued', source: 'stock.getValuedReceiptReport' },
  },
  outgoing: {
    plain: { title: 'stock.report.delivery', source: 'stock.getDeliveryReport' },
    valued: { title: 'stock.report.deliveryValued', source: 'stock.getValuedDeliveryReport' },
  },
  internal: {
    plain: { title: 'stock.report.internalTransfer', source: 'stock.getInternalTransferReport' },
    valued: { title: 'stock.report.internalTransferValued', source: 'stock.getValuedInternalTransferReport' },
  },
}
type Print = { title: string; source: string }
