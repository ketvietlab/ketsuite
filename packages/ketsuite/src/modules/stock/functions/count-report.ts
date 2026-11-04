import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { minorText, scaleOf } from '../../account/money.ts'
import { defaultAddressFor, presentationOf } from '../../partner/functions/helpers.ts'
import { ours } from '../scope.ts'
import { productUnitId } from '../units.ts'
import { moneyMinor } from '../valuation.ts'

/** Approved snapshots survive later cost changes; legacy counts leave unknown values blank. */
async function report(ctx: Ctx, args: Row, valued: boolean) {
  const session = (await ours(ctx, 'stock.CountSession', { id: args.id }))[0]
  if (!session || session.state !== 'done') return null
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const party = company?.partnerId
    ? (await ctx.db.select('partner.Partner', { id: company.partnerId }))[0]
    : null
  const address = party ? await defaultAddressFor(ctx, String(party.id), 'invoice') : null
  const warehouse = (await ours(ctx, 'stock.Warehouse', { id: session.warehouseId }))[0]
  const currency = String(session.valueCurrency ?? company?.currency ?? 'VND')
  const scale = scaleOf(currency)
  const held = (await ours(ctx, 'stock.CountLine', { sessionId: session.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
  )
  const lines: Row[] = []
  for (const line of held) {
    const product = (await ctx.db.select('product.Product', { id: line.productId }))[0]
    const template = product ? (await ctx.db.select('product.Template', { id: product.templateId }))[0] : null
    const unitId = await productUnitId(ctx, line.productId)
    const unit = unitId ? (await ctx.db.select('uom.Unit', { id: unitId }))[0] : null
    const lot = line.lotId ? (await ours(ctx, 'stock.Lot', { id: line.lotId }))[0] : null
    const known = line.countBookValue != null && line.countPhysicalValue != null
    lines.push({
      id: line.id,
      no: lines.length + 1,
      product: template?.name ?? line.productId,
      code: product?.defaultCode ?? '',
      lot: lot?.name ?? '',
      uom: unit?.name ?? '',
      expected: line.expected,
      counted: line.counted,
      difference: Number(line.counted) - Number(line.expected),
      qualityGood: line.qualityGood ?? null,
      qualityPoor: line.qualityPoor ?? null,
      qualityLost: line.qualityLost ?? null,
      ...(valued
        ? {
            bookValue: line.countBookValue ?? null,
            physicalValue: line.countPhysicalValue ?? null,
            differenceValue: known
              ? minorText(
                  moneyMinor(line.countPhysicalValue, scale) - moneyMinor(line.countBookValue, scale),
                  scale,
                )
              : null,
          }
        : {}),
    })
  }
  return {
    id: session.id,
    name: session.name,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    approvedAt: session.approvedAt,
    timezone: company?.accountingTimezone ?? 'Asia/Ho_Chi_Minh',
    warehouse: warehouse?.name ?? '',
    committee: session.committee ?? [],
    resolution: session.resolution ?? '',
    company: {
      name: party?.name ?? company?.name ?? '',
      vat: party?.vat ?? '',
      address: address ? (await presentationOf(ctx, address)).oneLine : '',
    },
    valued,
    ...(valued ? { currency } : {}),
    lines,
  }
}
export async function getCountReportHandler(ctx: Ctx, args: Row) {
  return report(ctx, args, false)
}
export async function getValuedCountReportHandler(ctx: Ctx, args: Row) {
  return report(ctx, args, true)
}
const effects = [
  'read:stock.CountSession',
  'read:stock.CountLine',
  'read:stock.Warehouse',
  'read:stock.Lot',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:company.Company',
  'read:partner.Partner',
  'read:partner.Address',
  'read:partner.AddressDefault',
  'read:address.Country',
  'read:address.CurrentCatalog',
  'read:address.Division',
]
export const countReportFunctions: Record<string, FnSpec> = {
  getCountReport: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      startedAt: 'datetime',
      submittedAt: 'datetime?',
      approvedAt: 'datetime?',
      timezone: 'text',
      warehouse: 'text',
      committee: 'json',
      resolution: 'text',
      company: 'json',
      valued: 'bool',
      currency: 'text?',
      lines: 'json',
    },
    effects,
    handler: getCountReportHandler,
  }),
  getValuedCountReport: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      startedAt: 'datetime',
      submittedAt: 'datetime?',
      approvedAt: 'datetime?',
      timezone: 'text',
      warehouse: 'text',
      committee: 'json',
      resolution: 'text',
      company: 'json',
      valued: 'bool',
      currency: 'text?',
      lines: 'json',
    },
    effects,
    handler: getValuedCountReportHandler,
  }),
}
