import { dateKeyIn } from '../calendar.ts'
import { asc, defineFn, desc, eq, from } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { hasPropertyScope, readRecord } from './command.ts'

const project = (row: Row, fields: readonly string[]) =>
  Object.fromEntries(fields.map((key) => [key, row[key] ?? null]))
const chargeFields = [
  'id',
  'stayId',
  'description',
  'type',
  'fulfillmentKind',
  'quantity',
  'unitPrice',
  'amount',
  'occurredAt',
  'serviceDate',
  'state',
  'voidReason',
  'voidedAt',
  'adjustsChargeId',
  'adjustmentReason',
] as const
const pageNumber = (value: unknown, total: number, size: number) =>
  Math.min(Math.max(1, Math.ceil(total / size)), Math.max(1, Math.trunc(Number(value) || 1)))

/** Bounded operational read; ledger and payment information retain their separate permission. */
export const getFolioWorkspaceHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return { record: null }
  const folio = await readRecord(ctx, 'hospitality_core.Folio', args.id)
  const property = folio ? await readRecord(ctx, 'hospitality_core.Property', folio.propertyId) : null
  if (!folio || !property || !hasPropertyScope(ctx, property)) return { record: null }
  const partner = await readRecord(ctx, 'partner.Partner', folio.partnerId)
  const company = await readRecord(ctx, 'company.Company', ctx.scope.company)
  const C = ctx.table('hospitality_core.Charge'),
    S = ctx.table('hospitality_core.Stay')
  const chargesQuery = from(C).where(eq(C.companyId!, ctx.scope.company), eq(C.folioId, folio.id))
  const staysQuery = from(S).where(
    eq(S.companyId!, ctx.scope.company),
    eq(S.propertyId, property.id),
    eq(S.folioId, folio.id),
  )
  const chargeTotal = await ctx.db.count(chargesQuery),
    stayTotal = await ctx.db.count(staysQuery)
  const chargePage = pageNumber(args.chargePage, chargeTotal, 24),
    stayPage = pageNumber(args.stayPage, stayTotal, 10)
  const charges = await ctx.db.all(
    chargesQuery
      .select(...chargeFields.map((key) => C[key]))
      .orderBy(desc(C.occurredAt), asc(C.id))
      .limit(24)
      .offset((chargePage - 1) * 24),
  )
  const stays = await ctx.db.all(
    staysQuery
      .select(S.id, S.code, S.reservationId, S.state, S.checkIn, S.checkOut, S.currentRoomId)
      .orderBy(desc(S.checkIn), asc(S.id))
      .limit(10)
      .offset((stayPage - 1) * 10),
  )
  const selected = args.chargeId ? await readRecord(ctx, 'hospitality_core.Charge', args.chargeId) : null
  const currentDay = String(property.businessDate ?? dateKeyIn(new Date(), String(property.timezone)))
  const chargeView = (charge: Row) => {
    const day = String(
      charge.serviceDate ?? dateKeyIn(new Date(String(charge.occurredAt)), String(property.timezone)),
    )
    const editable = folio.state === 'open' && charge.state === 'active' && !property.closingDate
    return {
      ...project(charge, chargeFields),
      canVoid: editable && (!property.businessDate || day >= String(property.businessDate)),
      canAdjust: editable && day < currentDay && !charge.adjustsChargeId,
    }
  }
  return {
    record: {
      ...project(folio, [
        'id',
        'code',
        'propertyId',
        'partnerId',
        'state',
        'version',
        'amountTotal',
        'openedAt',
        'closedAt',
      ]),
      property: project(property, ['id', 'name', 'timezone', 'businessDate', 'closingDate']),
      partner: partner ? project(partner, ['id', 'name']) : null,
      currency: company?.currency ?? 'VND',
      charges: {
        rows: charges.map(chargeView),
        page: chargePage,
        pages: Math.max(1, Math.ceil(chargeTotal / 24)),
        total: chargeTotal,
      },
      stays: { rows: stays, page: stayPage, pages: Math.max(1, Math.ceil(stayTotal / 10)), total: stayTotal },
      selectedCharge: selected && selected.folioId === folio.id ? chargeView(selected) : null,
    },
  }
}

export const folioWorkspaceFunctions = {
  getFolioWorkspace: defineFn({
    input: { id: 'id', chargePage: 'int?', stayPage: 'int?', chargeId: 'id?' },
    output: { record: 'json?' },
    effects: [
      'read:hospitality_core.Folio',
      'read:hospitality_core.Property',
      'read:hospitality_core.Charge',
      'read:hospitality_core.Stay',
      'read:partner.Partner',
      'read:company.Company',
    ],
    handler: getFolioWorkspaceHandler,
  }),
}
