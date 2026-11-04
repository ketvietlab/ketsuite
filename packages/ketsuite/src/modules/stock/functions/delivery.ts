import { randomUUID } from 'node:crypto'
import { and, defineFn, deleteFrom, eq, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { minorText } from '../../account/money.ts'
import { companyCivilDate } from '../../company/civil-date.ts'
import { InventoryRefused } from '../inventory-validation.ts'
import { ours } from '../scope.ts'
import {
  moneyMinor,
  postStockEntry,
  scaleFor,
  share,
  stockJournalSetting,
  VALUATION_EFFECTS,
} from '../valuation.ts'
import { completePickingHandler, pickingsFunctions } from './pickings.ts'
import { createReturnHandler, returnFunctions } from './returns.ts'

/**
 * K7, K45–K49: shipping on the books. The company deals with its carriers itself: it keeps their rates,
 * books each parcel and types the code the carrier gave (or takes the next of the carrier's own). A carrier the
 * hosting provider books for the company (`management: 'platform'`) is a later phase; the field is there so
 * carriers need not change shape for it.
 */
export const CARRIER_MANAGEMENTS = ['tenant'] as const
const RESERVED_MANAGEMENTS = ['platform']
export const SHIPMENT_STATES = [
  'draft',
  'booked',
  'shipping',
  'delivered',
  'failed',
  'returned',
  'cancel',
] as const
// The order the list works parcels in: what failed needs a decision, what is booked waits to be handed over.
const SHIPMENT_QUEUE = ['failed', 'booked', 'draft', 'shipping', 'delivered', 'returned', 'cancel']
export const DISPATCH_STATUSES = ['toHandOver', 'toBook', 'noShipment', 'waiting'] as const
export const STATEMENT_STATES = ['draft', 'posted', 'paid', 'cancel'] as const
const MAX_WEIGHT_HUNDREDTHS = 5000n
const MAX_COD = '100000000'
const MAX_TICKED = 100
const OPEN_PICKING = ['waiting', 'confirmed', 'assigned']

class DeliveryRefused extends Error {
  result: Row
  constructor(result: Row) {
    super('delivery refused')
    this.result = result
  }
}
const refusal = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, messageKey: `stock.error.${key}` }],
})
const refuse = (field: string, key: string) => new DeliveryRefused(refusal(field, key))
const run = async (body: () => Promise<Row>) => {
  try {
    return await body()
  } catch (error) {
    // A locked period or a refused draft entry refuses the step; nothing is written.
    if (error instanceof DeliveryRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}
const matched = (result: unknown) => 'dryRun' in (result as Row) || (result as Row).matched === true
const reasonOf = (args: Row) => {
  const reason = String(args.reason ?? '').trim()
  if (!reason) throw refuse('reason', 'deliveryReasonRequired')
  return reason.slice(0, 500)
}
const validDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
const currencyOf = async (ctx: Ctx) =>
  ((await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency as string | undefined) ??
  null
const nameOf = async (ctx: Ctx, model: string, id: unknown) =>
  id ? ((await ctx.db.select(model, { id }))[0]?.name ?? null) : null

// ---------------------------------------------------------------------------------------------- what it costs

/** A parcel's weight in hundredths of a kilogram, from its text ("1.25"). */
const hundredths = (weight: unknown) => {
  const [whole, fraction = ''] = String(weight ?? '0').split('.')
  return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2))
}
const weightText = (value: bigint) =>
  `${value / 100n}${value % 100n ? `.${String(value % 100n).padStart(2, '0')}`.replace(/0$/, '') : ''}`

/** What a carrier charges to carry a parcel (K46): its first kilogram, and each kilogram begun after it. */
export const carryingFee = (carrier: Row, weight: unknown, scale: number) => {
  const over = hundredths(weight) - 100n
  const extra = over > 0n ? (over + 99n) / 100n : 0n
  return moneyMinor(carrier.baseFee, scale) + extra * moneyMinor(carrier.extraKgFee, scale)
}
/** What a carrier charges to collect cash on delivery: its rate, a percentage, of the amount. */
export const collectionFee = (carrier: Row, cod: bigint) =>
  share(cod, moneyMinor(carrier.codFeeRate, 2), 10000n)

// ---------------------------------------------------------------------------------------------- carriers

const carrierView = (carrier: Row): Row => ({
  ...carrier,
  state: carrier.active === false ? 'archived' : 'active',
})

export async function listCarriersHandler(ctx: Ctx, args: Row = {}) {
  const currency = await currencyOf(ctx)
  return (await ours(ctx, 'stock.Carrier'))
    .filter((row) => args.includeArchived === true || row.active !== false || row.id === args.withId)
    .sort(
      (a, b) =>
        Number(b.active !== false) - Number(a.active !== false) ||
        Number(b.isDefault === true) - Number(a.isDefault === true) ||
        String(a.name).localeCompare(String(b.name), 'vi'),
    )
    .map((row): Row => ({ ...carrierView(row), currency }))
}

export async function getCarrierHandler(ctx: Ctx, args: Row) {
  const carrier = (await ours(ctx, 'stock.Carrier', { id: args.id }))[0]
  return carrier ? carrierView(carrier) : null
}

/** K45: a carrier's code (fixed once made), name and rates, and whether new parcels start with it. */
export async function saveCarrierHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const scale = await scaleFor(tx)
      const existing = (await ours(tx, 'stock.Carrier', { id: args.id }))[0]
      const all = await ours(tx, 'stock.Carrier')
      const management = String(args.management ?? existing?.management ?? 'tenant')
      if (RESERVED_MANAGEMENTS.includes(management))
        throw refuse('management', 'carrierManagementUnavailable')
      if (!(CARRIER_MANAGEMENTS as readonly string[]).includes(management))
        throw refuse('management', 'carrierManagementUnavailable')
      const code = String(args.code ?? existing?.code ?? '')
        .trim()
        .toUpperCase()
      if (existing && code !== existing.code) throw refuse('code', 'carrierCodeFixed')
      if (!/^[A-Z0-9]{2,10}$/.test(code)) throw refuse('code', 'carrierCode')
      if (all.some((row) => row.id !== args.id && row.code === code)) throw refuse('code', 'carrierCodeTaken')
      const name = String(args.name ?? existing?.name ?? '').trim()
      if (!name || name.length > 100) throw refuse('name', 'carrierName')
      if (all.some((row) => row.id !== args.id && String(row.name).toLowerCase() === name.toLowerCase()))
        throw refuse('name', 'carrierNameTaken')
      const amount = new RegExp(`^\\d{1,9}${scale ? `(\\.\\d{1,${scale}})?` : ''}$`)
      const fees: Row = {}
      for (const field of ['baseFee', 'extraKgFee']) {
        const value = String(args[field] ?? existing?.[field] ?? '').trim()
        if (!amount.test(value)) throw refuse(field, 'carrierFee')
        fees[field] = minorText(moneyMinor(value, scale), scale)
      }
      const rate = String(args.codFeeRate ?? existing?.codFeeRate ?? '').trim()
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(rate) || moneyMinor(rate, 2) > 1000n)
        throw refuse('codFeeRate', 'carrierCodRate')
      const active = existing ? existing.active !== false : true
      const others = all.filter((row) => row.id !== args.id)
      // The first carrier is the default; there is always exactly one, and it is in use.
      const wasDefault = existing?.isDefault === true
      // The default stops being one only when another becomes it.
      if (wasDefault && args.isDefault === false) throw refuse('isDefault', 'carrierDefaultRequired')
      // A company with no other default makes this one the default, whatever the form says.
      const isDefault = wasDefault || !others.some((row) => row.isDefault) || args.isDefault === true
      if (isDefault && !active) throw refuse('isDefault', 'carrierDefaultArchived')
      const values = {
        code,
        name,
        ...fees,
        codFeeRate: rate.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
        isDefault,
        management,
      }
      if (existing) {
        const done = await tx.db.compareAndSet(
          'stock.Carrier',
          { id: existing.id },
          { revision: existing.revision },
          { ...values, revision: Number(existing.revision ?? 0) + 1 },
        )
        if (!matched(done)) throw refuse('id', 'deliveryChanged')
        if (existing.name !== name)
          await tx.db.update('partner.Partner', { id: existing.partnerId }, { name })
      } else {
        // The carrier is the counterparty of its own debts: the cash it holds and the fees it is owed.
        const partnerId = `${String(args.id)}:partner`
        await tx.db.insert('partner.Partner', {
          id: partnerId,
          kind: 'company',
          name,
          parentId: null,
          vat: null,
          ref: code,
          email: null,
          phone: null,
          lang: null,
          active: true,
        })
        await tx.db.insert('stock.Carrier', {
          id: args.id,
          ...values,
          partnerId,
          active: true,
          revision: 1,
          createdAt: new Date().toISOString(),
          createdBy: tx.actor ?? null,
        })
      }
      if (isDefault && !wasDefault)
        for (const row of others.filter((other) => other.isDefault))
          await tx.db.update(
            'stock.Carrier',
            { id: row.id },
            { isDefault: false, revision: Number(row.revision) + 1 },
          )
      return { ok: true, id: args.id }
    }),
  )
}

/** A carrier no longer used takes no new parcels and is not offered; what it carries goes on. */
async function setCarrierActive(ctx: Ctx, args: Row, active: boolean) {
  return run(async () => {
    const carrier = (await ours(ctx, 'stock.Carrier', { id: args.id }))[0]
    if (!carrier) throw refuse('id', 'carrierMissing')
    if ((carrier.active !== false) === active) return { ok: true, id: carrier.id }
    if (!active && carrier.isDefault === true) throw refuse('id', 'carrierDefaultArchive')
    const done = await ctx.db.compareAndSet(
      'stock.Carrier',
      { id: carrier.id },
      { revision: carrier.revision },
      { active, revision: Number(carrier.revision ?? 0) + 1 },
    )
    if (!matched(done)) throw refuse('id', 'deliveryChanged')
    return { ok: true, id: carrier.id }
  })
}

export const archiveCarrierHandler = (ctx: Ctx, args: Row) => setCarrierActive(ctx, args, false)
export const activateCarrierHandler = (ctx: Ctx, args: Row) => setCarrierActive(ctx, args, true)

// ---------------------------------------------------------------------------------------------- deliveries

/** The warehouse of a transfer, through its operation type. */
async function warehouseOf(ctx: Ctx, picking: Row) {
  const type = (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
  return type?.warehouseId ? (await ours(ctx, 'stock.Warehouse', { id: type.warehouseId }))[0] : undefined
}

/** Whether a transfer takes goods to a customer: a delivery a carrier may carry, not a return of one. */
async function toCustomer(ctx: Ctx, picking: Row, moves?: Row[]) {
  const destination = (await ours(ctx, 'stock.Location', { id: picking.locationDestId }))[0]
  if (destination?.usage !== 'customer') return false
  const own = moves ?? (await ours(ctx, 'stock.Move', { pickingId: picking.id }))
  return !own.some((move) => move.originReturnedMoveId)
}

/** Handing over completes the delivery whole, so every good of it must be held (no backorder is split off). */
const fullyHeld = (moves: Row[]) => {
  const live = moves.filter((move) => move.state !== 'cancel')
  return live.length > 0 && live.every((move) => move.state === 'assigned' || move.state === 'done')
}

/**
 * The sales order a delivery serves, read only where sales is installed: what it totals and whether it is
 * paid on delivery (every line of its payment term due at once).
 */
async function orderOf(ctx: Ctx, moves: Row[], scale: number) {
  if (!ctx.manifest.models['sale.Order']) return null
  const lineId = moves.find((move) => move.saleLineId)?.saleLineId
  const line = lineId ? (await ctx.db.select('sale.OrderLine', { id: lineId }))[0] : undefined
  const order = line ? (await ctx.db.select('sale.Order', { id: line.orderId }))[0] : undefined
  if (!order) return null
  const terms = order.paymentTermId
    ? await ctx.db.select('account.PaymentTermLine', { paymentId: order.paymentTermId })
    : []
  return {
    id: String(order.id),
    name: String(order.name),
    total: moneyMinor(order.amountTotal, scale),
    onDelivery:
      terms.length > 0 &&
      terms.every((row) => Number(row.nbDays ?? 0) === 0 && !Number(row.daysNextMonth ?? 0)),
  }
}

/**
 * The most a parcel may collect (K46): its order's total less what its other parcels collect; a delivery
 * without an order collects what the warehouse says, up to a ceiling.
 */
async function codLimit(
  ctx: Ctx,
  order: Awaited<ReturnType<typeof orderOf>>,
  except: unknown,
  scale: number,
) {
  if (!order) return moneyMinor(MAX_COD, scale)
  let left = order.total
  for (const row of await ours(ctx, 'stock.Shipment', { saleOrderId: order.id }))
    if (row.state !== 'cancel' && row.id !== except) left -= moneyMinor(row.cod, scale)
  return left > 0n ? left : 0n
}

/** The delivery a parcel is for and what it needs, or a refusal of it. */
async function deliveryFor(ctx: Ctx, pickingId: unknown, scale: number) {
  const picking = (await ours(ctx, 'stock.Picking', { id: pickingId }))[0]
  if (!picking) throw refuse('pickingId', 'shipmentPicking')
  const moves = await ours(ctx, 'stock.Move', { pickingId: picking.id })
  if (!(await toCustomer(ctx, picking, moves))) throw refuse('pickingId', 'shipmentPicking')
  const warehouse = await warehouseOf(ctx, picking)
  if (!warehouse) throw refuse('pickingId', 'shipmentPicking')
  return { picking, moves, warehouse, order: await orderOf(ctx, moves, scale) }
}

const defaultCarrier = async (ctx: Ctx) => {
  const active = (await ours(ctx, 'stock.Carrier')).filter((row) => row.active !== false)
  return active.find((row) => row.isDefault === true) ?? active[0]
}
async function activeCarrier(ctx: Ctx, id: unknown) {
  const carrier = id ? (await ours(ctx, 'stock.Carrier', { id }))[0] : undefined
  if (!carrier || carrier.active === false) throw refuse('carrierId', 'shipmentCarrier')
  if (carrier.management !== 'tenant') throw refuse('carrierId', 'carrierManagementUnavailable')
  return carrier
}

/** The next parcel of a warehouse: HCM/VD/0003. Callers write inside one transaction. */
async function nextShipmentName(ctx: Ctx, warehouse: Row) {
  const prefix = `${String(warehouse.code ?? 'VD')}/VD/`
  let last = 0
  for (const row of await ours(ctx, 'stock.Shipment'))
    if (String(row.name).startsWith(prefix))
      last = Math.max(last, Number(String(row.name).slice(prefix.length)) || 0)
  return `${prefix}${String(last + 1).padStart(4, '0')}`
}

/** A new draft parcel of a delivery: the default carrier, a kilogram, and what its order collects. */
async function insertShipment(
  ctx: Ctx,
  id: string,
  delivery: Awaited<ReturnType<typeof deliveryFor>>,
  scale: number,
) {
  const { picking, warehouse, order } = delivery
  if (!OPEN_PICKING.includes(String(picking.state))) throw refuse('pickingId', 'shipmentPickingClosed')
  const open = (await ours(ctx, 'stock.Shipment', { openPickingId: picking.id }))[0]
  if (open) throw refuse('pickingId', 'shipmentHasParcel')
  const carrier = await defaultCarrier(ctx)
  if (!carrier) throw refuse('carrierId', 'shipmentCarrier')
  const cod = order?.onDelivery ? await codLimit(ctx, order, null, scale) : 0n
  await ctx.db.insert('stock.Shipment', {
    id,
    name: await nextShipmentName(ctx, warehouse),
    pickingId: picking.id,
    openPickingId: picking.id,
    warehouseId: warehouse.id,
    partnerId: picking.partnerId ?? null,
    saleOrderId: order?.id ?? null,
    carrierId: carrier.id,
    weight: '1',
    cod: minorText(cod, scale),
    note: null,
    state: 'draft',
    trackingCode: null,
    shippingFee: null,
    codFee: null,
    attempts: 0,
    revision: 1,
    createdAt: new Date().toISOString(),
    createdBy: ctx.actor ?? null,
  })
}

/** What a parcel's carrier, weight, cash and note become, checked against its delivery's order. */
async function parcelValues(ctx: Ctx, row: Row, args: Row, scale: number) {
  const carrier = await activeCarrier(ctx, args.carrierId ?? row.carrierId)
  const weight = String(args.weight ?? row.weight).trim()
  const exact = /^\d{1,3}(\.\d{1,2})?$/.test(weight) ? hundredths(weight) : 0n
  if (exact <= 0n || exact > MAX_WEIGHT_HUNDREDTHS) throw refuse('weight', 'shipmentWeightInvalid')
  const codText = String(args.cod ?? minorText(moneyMinor(row.cod, scale), scale)).trim()
  const moves = await ours(ctx, 'stock.Move', { pickingId: row.pickingId })
  const limit = await codLimit(ctx, await orderOf(ctx, moves, scale), row.id, scale)
  const exactCod = new RegExp(`^\\d{1,12}${scale ? `(\\.\\d{1,${scale}})?` : ''}$`)
  const cod = exactCod.test(codText) ? moneyMinor(codText, scale) : -1n
  if (cod < 0n || cod > limit) throw refuse('cod', 'shipmentCodInvalid')
  const note =
    args.note === undefined
      ? (row.note ?? null)
      : String(args.note ?? '')
          .trim()
          .slice(0, 500) || null
  return {
    carrier,
    values: { carrierId: carrier.id, weight: weightText(exact), cod: minorText(cod, scale), note },
  }
}

/** Moves a parcel on from the state it was read in; a parcel someone else moved first refuses. */
async function advance(ctx: Ctx, row: Row, patch: Row) {
  const done = await ctx.db.compareAndSet(
    'stock.Shipment',
    { id: row.id },
    { state: row.state, revision: row.revision },
    { ...patch, revision: Number(row.revision ?? 0) + 1 },
  )
  if (!matched(done)) throw refuse('id', 'deliveryChanged')
}

async function shipmentIn(ctx: Ctx, id: unknown, states: string[]) {
  const row = (await ours(ctx, 'stock.Shipment', { id }))[0]
  if (!row) throw refuse('id', 'shipmentMissing')
  if (!states.includes(String(row.state))) throw refuse('id', 'shipmentState')
  return row
}

/** What a parcel costs now: what booking would charge a draft, or what booking charged. */
const parcelFees = (row: Row, carrier: Row | undefined, scale: number) => {
  if (row.state !== 'draft')
    return {
      shipping: moneyMinor(row.shippingFee, scale),
      cod: moneyMinor(row.codFee, scale),
    }
  return carrier
    ? {
        shipping: carryingFee(carrier, row.weight, scale),
        cod: collectionFee(carrier, moneyMinor(row.cod, scale)),
      }
    : { shipping: 0n, cod: 0n }
}

async function partnerNames(ctx: Ctx, ids: unknown[]) {
  const names = new Map<string, string>()
  for (const id of new Set(ids.filter(Boolean).map(String))) {
    const name = await nameOf(ctx, 'partner.Partner', id)
    if (name) names.set(id, String(name))
  }
  return names
}

export async function listShipmentsHandler(ctx: Ctx, args: Row = {}) {
  const scale = await scaleFor(ctx)
  const currency = await currencyOf(ctx)
  const carriers = new Map((await ours(ctx, 'stock.Carrier')).map((row) => [String(row.id), row]))
  const warehouses = new Map((await ours(ctx, 'stock.Warehouse')).map((row) => [String(row.id), row]))
  const rows = (await ours(ctx, 'stock.Shipment'))
    .filter((row) => !args.warehouseId || row.warehouseId === args.warehouseId)
    .filter((row) => !args.state || row.state === args.state)
    .filter((row) => !args.pickingId || row.pickingId === args.pickingId)
    .filter((row) => !args.carrierId || row.carrierId === args.carrierId)
  const pickings = new Map<string, string>()
  for (const row of rows)
    if (!pickings.has(String(row.pickingId)))
      pickings.set(String(row.pickingId), String((await nameOf(ctx, 'stock.Picking', row.pickingId)) ?? ''))
  const partners = await partnerNames(
    ctx,
    rows.map((row) => row.partnerId),
  )
  return rows
    .sort(
      (a, b) =>
        SHIPMENT_QUEUE.indexOf(String(a.state)) - SHIPMENT_QUEUE.indexOf(String(b.state)) ||
        String(a.name).localeCompare(String(b.name)),
    )
    .map((row) => {
      const carrier = carriers.get(String(row.carrierId))
      const fees = parcelFees(row, carrier, scale)
      return {
        ...row,
        carrierName: carrier?.name ?? null,
        warehouseName: warehouses.get(String(row.warehouseId))?.name ?? null,
        pickingName: pickings.get(String(row.pickingId)) || null,
        partnerName: partners.get(String(row.partnerId)) ?? null,
        totalFee: minorText(fees.shipping + fees.cod, scale),
        currency,
      }
    })
}

/** A parcel's page (K46): its delivery, order, carrier and fees, the cash it collects and where that went. */
export async function getShipmentHandler(ctx: Ctx, args: Row) {
  const row = (await ours(ctx, 'stock.Shipment', { id: args.id }))[0]
  if (!row) return null
  const scale = await scaleFor(ctx)
  const carrier = (await ours(ctx, 'stock.Carrier', { id: row.carrierId }))[0]
  const picking = (await ours(ctx, 'stock.Picking', { id: row.pickingId }))[0]
  const moves = picking ? await ours(ctx, 'stock.Move', { pickingId: picking.id }) : []
  const order = await orderOf(ctx, moves, scale)
  const back = row.returnPickingId
    ? (await ours(ctx, 'stock.Picking', { id: row.returnPickingId }))[0]
    : undefined
  const line = (await ours(ctx, 'stock.DeliveryStatementLine', { openShipmentId: row.id }))[0]
  const statement = line
    ? (await ours(ctx, 'stock.DeliveryStatement', { id: line.statementId }))[0]
    : undefined
  const entry = row.codEntryId ? (await ctx.db.select('account.Move', { id: row.codEntryId }))[0] : undefined
  const fees = parcelFees(row, carrier, scale)
  const carriers = await listCarriersHandler(ctx, { withId: row.carrierId })
  return {
    ...row,
    currency: (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null,
    carrierName: carrier?.name ?? null,
    warehouseName: await nameOf(ctx, 'stock.Warehouse', row.warehouseId),
    partnerName: await nameOf(ctx, 'partner.Partner', row.partnerId),
    picking: picking ? { id: picking.id, name: picking.name, state: picking.state } : null,
    returnPicking: back ? { id: back.id, name: back.name, state: back.state } : null,
    saleOrder: order ? { id: order.id, name: order.name } : null,
    statement: statement ? { id: statement.id, name: statement.name, state: statement.state } : null,
    codEntry: entry ? { id: entry.id, name: entry.name } : null,
    fees: {
      shipping: minorText(fees.shipping, scale),
      cod: minorText(fees.cod, scale),
      total: minorText(fees.shipping + fees.cod, scale),
    },
    codLimit: minorText(await codLimit(ctx, order, row.id, scale), scale),
    // Handing over waits for every good of the delivery to be held.
    ready: Boolean(picking && (picking.state === 'done' || fullyHeld(moves))),
    pickingOpen: Boolean(picking && OPEN_PICKING.includes(String(picking.state))),
    carriers: carriers.map((value) => ({ id: value.id, name: value.name, state: value.state })),
  }
}

/**
 * The delivery queue (K48): every open customer delivery not yet handed to a carrier, with its parcel. A row
 * with a parcel opens it; one without opens its delivery.
 */
export async function listDispatchQueueHandler(ctx: Ctx, args: Row = {}) {
  const scale = await scaleFor(ctx)
  const currency = await currencyOf(ctx)
  const open = new Map(
    (await ours(ctx, 'stock.Shipment'))
      .filter((row) => row.openPickingId)
      .map((row) => [String(row.pickingId), row]),
  )
  const carriers = new Map((await ours(ctx, 'stock.Carrier')).map((row) => [String(row.id), row]))
  const rows: Row[] = []
  for (const picking of await ours(ctx, 'stock.Picking')) {
    if (!OPEN_PICKING.includes(String(picking.state))) continue
    const parcel = open.get(String(picking.id))
    if (parcel && !['draft', 'booked'].includes(String(parcel.state))) continue
    const moves = await ours(ctx, 'stock.Move', { pickingId: picking.id })
    if (!(await toCustomer(ctx, picking, moves))) continue
    const warehouse = await warehouseOf(ctx, picking)
    if (!warehouse || (args.warehouseId && warehouse.id !== args.warehouseId)) continue
    const order = await orderOf(ctx, moves, scale)
    const status = !parcel
      ? 'noShipment'
      : parcel.state === 'draft'
        ? 'toBook'
        : fullyHeld(moves)
          ? 'toHandOver'
          : 'waiting'
    rows.push({
      id: picking.id,
      name: picking.name,
      state: picking.state,
      partnerId: picking.partnerId ?? null,
      saleOrderName: order?.name ?? null,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      scheduledDate: picking.scheduledDate ?? null,
      shipmentId: parcel?.id ?? null,
      shipmentName: parcel?.name ?? null,
      carrierName: parcel ? (carriers.get(String(parcel.carrierId))?.name ?? null) : null,
      cod: parcel
        ? minorText(moneyMinor(parcel.cod, scale), scale)
        : minorText(order?.onDelivery ? await codLimit(ctx, order, null, scale) : 0n, scale),
      status,
      currency,
    })
  }
  const partners = await partnerNames(
    ctx,
    rows.map((row) => row.partnerId),
  )
  return rows
    .map((row): Row => ({ ...row, partnerName: partners.get(String(row.partnerId)) ?? null }))
    .sort(
      (a, b) =>
        DISPATCH_STATUSES.indexOf(a.status as never) - DISPATCH_STATUSES.indexOf(b.status as never) ||
        String(a.scheduledDate ?? '').localeCompare(String(b.scheduledDate ?? '')) ||
        String(a.name).localeCompare(String(b.name)),
    )
}

/**
 * The carriers as the delivery overview reads them (K48): what waits to be handed over, is on its way or
 * failed, what is not on a statement yet, the cash on parcels under way and the cash a carrier holds.
 */
export async function getDeliveryOverviewHandler(ctx: Ctx) {
  const scale = await scaleFor(ctx)
  const parcels = await ours(ctx, 'stock.Shipment')
  const lines = await ours(ctx, 'stock.DeliveryStatementLine')
  const statements = new Map((await ours(ctx, 'stock.DeliveryStatement')).map((row) => [String(row.id), row]))
  const statementOf = new Map(
    lines
      .filter((line) => line.openShipmentId)
      .map((line) => [String(line.shipmentId), statements.get(String(line.statementId))]),
  )
  const carriers = (await listCarriersHandler(ctx, { includeArchived: true })).map((carrier) => {
    const own = parcels.filter((row) => row.carrierId === carrier.id)
    const count = (states: string[]) => own.filter((row) => states.includes(String(row.state))).length
    const total = (rows: Row[]) =>
      minorText(
        rows.reduce((sum, row) => sum + moneyMinor(row.cod, scale), 0n),
        scale,
      )
    return {
      id: carrier.id,
      code: carrier.code,
      name: carrier.name,
      state: carrier.state,
      toHandOver: count(['booked']),
      shipping: count(['shipping']),
      failed: count(['failed']),
      toSettle: own.filter(
        (row) => ['delivered', 'returned'].includes(String(row.state)) && !statementOf.has(String(row.id)),
      ).length,
      codShipping: total(own.filter((row) => ['shipping', 'failed'].includes(String(row.state)))),
      codHeld: total(
        own.filter((row) => row.state === 'delivered' && statementOf.get(String(row.id))?.state !== 'paid'),
      ),
    }
  })
  return {
    currency: (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null,
    carriers: carriers.filter(
      (row) =>
        row.state === 'active' ||
        row.toHandOver ||
        row.shipping ||
        row.failed ||
        row.toSettle ||
        row.codHeld !== minorText(0n, scale),
    ),
  }
}

/** A draft parcel for one delivery, from its page. */
export async function createShipmentHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const existing = (await ours(tx, 'stock.Shipment', { id: args.id }))[0]
      // A replay of the same request opens the parcel it made.
      if (existing)
        return existing.pickingId === args.pickingId
          ? { ok: true, id: existing.id }
          : refusal('id', 'deliveryChanged')
      const scale = await scaleFor(tx)
      await insertShipment(tx, String(args.id), await deliveryFor(tx, args.pickingId, scale), scale)
      return { ok: true, id: args.id }
    }),
  )
}

/**
 * Makes a draft parcel for each delivery ticked in the queue (K48); deliveries that have one or left the queue
 * are listed with why.
 */
export async function createShipmentsHandler(ctx: Ctx, args: Row) {
  const ids = [...new Set(((args.ids as unknown[] | null) ?? []).map(String))]
  if (!ids.length) return refusal('ids', 'deliverySelectionRequired')
  if (ids.length > MAX_TICKED) return refusal('ids', 'deliveryTooMany')
  const done: Row[] = []
  const skipped: Row[] = []
  for (const pickingId of ids) {
    const name = await nameOf(ctx, 'stock.Picking', pickingId)
    const id = randomUUID()
    const result = await run(() =>
      ctx.tx(async (tx) => {
        const scale = await scaleFor(tx)
        await insertShipment(tx, id, await deliveryFor(tx, pickingId, scale), scale)
        return { ok: true }
      }),
    )
    if (result.ok === true) done.push({ id: pickingId, name, shipmentId: id })
    else {
      const key = String((result.errors as Row[])[0]?.messageKey ?? '')
      if (key === 'stock.error.shipmentCarrier') return result
      skipped.push({
        id: pickingId,
        name,
        reason: key === 'stock.error.shipmentHasParcel' ? 'hasShipment' : 'closed',
      })
    }
  }
  return { ok: true, done, skipped }
}

/** Saves a draft parcel's carrier, weight, cash on delivery and note. */
export async function saveShipmentHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const scale = await scaleFor(tx)
      const row = await shipmentIn(tx, args.id, ['draft'])
      const { values } = await parcelValues(tx, row, args, scale)
      await advance(tx, row, values)
      return { ok: true, id: row.id }
    }),
  )
}

/**
 * Books a draft with its carrier (K46) while its delivery is open: the code the carrier gave (or the next of
 * the carrier's own, `GHN202600005`), and the fees its rates charge now, fixed from here.
 */
export async function bookShipmentHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const scale = await scaleFor(tx)
      const row = (await ours(tx, 'stock.Shipment', { id: args.id }))[0]
      if (
        row?.state === 'booked' &&
        (!args.trackingCode || row.trackingCode === String(args.trackingCode).trim())
      )
        return { ok: true, id: row.id }
      const draft = await shipmentIn(tx, args.id, ['draft'])
      const { carrier, values } = await parcelValues(tx, draft, args, scale)
      const picking = (await ours(tx, 'stock.Picking', { id: draft.pickingId }))[0]
      if (!picking || !OPEN_PICKING.includes(String(picking.state)))
        throw refuse('id', 'shipmentPickingClosed')
      const today = await companyCivilDate(tx)
      const others = (await ours(tx, 'stock.Shipment', { carrierId: carrier.id })).filter(
        (other) => other.id !== draft.id && other.state !== 'cancel',
      )
      let trackingCode = String(args.trackingCode ?? '')
        .trim()
        .toUpperCase()
      if (trackingCode) {
        if (!/^[A-Z0-9-]{4,40}$/.test(trackingCode)) throw refuse('trackingCode', 'shipmentTrackingInvalid')
        if (others.some((other) => other.trackingCode === trackingCode))
          throw refuse('trackingCode', 'shipmentTrackingTaken')
      } else {
        const prefix = `${String(carrier.code)}${today.slice(0, 4)}`
        let last = 0
        for (const other of await ours(tx, 'stock.Shipment', { carrierId: carrier.id }))
          if (String(other.trackingCode ?? '').startsWith(prefix))
            last = Math.max(last, Number(String(other.trackingCode).slice(prefix.length)) || 0)
        trackingCode = `${prefix}${String(last + 1).padStart(5, '0')}`
      }
      await advance(tx, draft, {
        ...values,
        state: 'booked',
        bookedDate: today,
        trackingCode,
        shippingFee: minorText(carryingFee(carrier, values.weight, scale), scale),
        codFee: minorText(collectionFee(carrier, moneyMinor(values.cod, scale)), scale),
      })
      return { ok: true, id: draft.id }
    }),
  )
}

/**
 * Hands a booked parcel to its carrier (K46): its delivery is completed whole now, unless it was already, and
 * its order counts it delivered. Completing commits on its own, so a retry finds the delivery done and only
 * moves the parcel on.
 */
export async function handOverShipmentHandler(ctx: Ctx, args: Row) {
  return run(async () => {
    const row = (await ours(ctx, 'stock.Shipment', { id: args.id }))[0]
    if (row?.state === 'shipping' && row.handedDate) return { ok: true, id: row.id }
    const booked = await shipmentIn(ctx, args.id, ['booked'])
    const picking = (await ours(ctx, 'stock.Picking', { id: booked.pickingId }))[0]
    if (!picking || picking.state === 'cancel') throw refuse('id', 'shipmentNotReady')
    if (picking.state !== 'done') {
      if (!fullyHeld(await ours(ctx, 'stock.Move', { pickingId: picking.id })))
        throw refuse('id', 'shipmentNotReady')
      const completed = (await completePickingHandler(ctx, { id: picking.id })) as Row
      if (completed.ok !== true) return completed
    }
    await advance(ctx, booked, { state: 'shipping', handedDate: await companyCivilDate(ctx), attempts: 1 })
    return { ok: true, id: booked.id }
  })
}

/** Hands the ticked parcels over (K48): each booked one whose goods are all held; the rest say why. */
export async function handOverShipmentsHandler(ctx: Ctx, args: Row) {
  const ids = [...new Set(((args.ids as unknown[] | null) ?? []).map(String))]
  if (!ids.length) return refusal('ids', 'deliverySelectionRequired')
  if (ids.length > MAX_TICKED) return refusal('ids', 'deliveryTooMany')
  const done: Row[] = []
  const skipped: Row[] = []
  for (const id of ids) {
    const row = (await ours(ctx, 'stock.Shipment', { id }))[0]
    if (!row) {
      skipped.push({ id, name: null, reason: 'missing' })
      continue
    }
    if (row.state !== 'booked') {
      skipped.push({ id, name: row.name, reason: 'notBooked' })
      continue
    }
    const result = await handOverShipmentHandler(ctx, { id })
    if (result.ok === true)
      done.push({ id, name: row.name, pickingName: await nameOf(ctx, 'stock.Picking', row.pickingId) })
    else {
      const key = String((result.errors as Row[] | undefined)?.[0]?.messageKey ?? '')
      // A locked period or a missing account is the company's to fix, not this parcel's: say so at once.
      if (!key.startsWith('stock.error.shipment') && !key.startsWith('stock.error.delivery')) return result
      skipped.push({
        id,
        name: row.name,
        reason: key === 'stock.error.shipmentNotReady' ? 'waitingGoods' : 'changed',
      })
    }
  }
  return { ok: true, done, skipped }
}

/** The carrier delivered (K46): cash it collected moves from the customer's debt to the carrier's, today. */
export async function deliverShipmentHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const row = (await ours(tx, 'stock.Shipment', { id: args.id }))[0]
      if (row?.state === 'delivered') return { ok: true, id: row.id }
      const parcel = await shipmentIn(tx, args.id, ['shipping'])
      const scale = await scaleFor(tx)
      const today = await companyCivilDate(tx)
      const cod = moneyMinor(parcel.cod, scale)
      const setting = cod > 0n ? await stockJournalSetting(tx) : null
      let codEntryId: string | null = null
      if (setting) {
        if (!setting.carrierCodAccountId || !setting.receivableAccountId)
          throw refuse('id', 'deliveryAccountMissing')
        const carrier = (await ours(tx, 'stock.Carrier', { id: parcel.carrierId }))[0]!
        codEntryId = `stock-shipment-cod:${String(parcel.id)}`
        await postStockEntry(
          tx,
          {
            id: codEntryId,
            ref: [parcel.trackingCode, parcel.name].filter(Boolean).join(' · '),
            date: new Date().toISOString(),
            accountingDate: today,
            partnerId: parcel.partnerId ?? null,
          },
          [
            {
              key: 'cod',
              name: `COD ${String(parcel.trackingCode ?? parcel.name)} · ${String(carrier.name)}`,
              productId: null,
              quantity: '0',
              priceUnit: null,
              amount: cod,
              debitAccount: String(setting.carrierCodAccountId),
              creditAccount: String(setting.receivableAccountId),
              debitPartnerId: carrier.partnerId,
              creditPartnerId: parcel.partnerId ?? null,
            },
          ],
          scale,
        )
      }
      await advance(tx, parcel, { state: 'delivered', deliveredDate: today, codEntryId })
      return { ok: true, id: parcel.id }
    }),
  )
}

/** The carrier could not deliver (K46): why, so someone decides to try again or take the goods back. */
export async function failShipmentHandler(ctx: Ctx, args: Row) {
  return run(async () => {
    const parcel = await shipmentIn(ctx, args.id, ['shipping'])
    const failReason = reasonOf(args)
    await advance(ctx, parcel, { state: 'failed', failedDate: await companyCivilDate(ctx), failReason })
    return { ok: true, id: parcel.id }
  })
}

/** Sends a failed parcel out again, one attempt more. */
export async function retryShipmentHandler(ctx: Ctx, args: Row) {
  return run(async () => {
    const parcel = await shipmentIn(ctx, args.id, ['failed'])
    await advance(ctx, parcel, {
      state: 'shipping',
      failedDate: null,
      attempts: Number(parcel.attempts ?? 1) + 1,
    })
    return { ok: true, id: parcel.id }
  })
}

/**
 * Takes a failed parcel back (K46): the goods return on a return of the delivery, confirmed today; nothing was
 * collected, so collecting costs nothing. The return commits on its own and a retry reopens the same one.
 */
export async function returnShipmentHandler(ctx: Ctx, args: Row) {
  return run(async () => {
    const row = (await ours(ctx, 'stock.Shipment', { id: args.id }))[0]
    if (row?.state === 'returned') return { ok: true, id: row.id, returnId: row.returnPickingId }
    const parcel = await shipmentIn(ctx, args.id, ['failed'])
    const returnId = `${String(parcel.id)}:return`
    const back = (await createReturnHandler(ctx, { id: parcel.pickingId, returnId })) as Row
    if (back.ok !== true) return back
    await advance(ctx, parcel, {
      state: 'returned',
      returnPickingId: returnId,
      returnedDate: await companyCivilDate(ctx),
      codFee: minorText(0n, await scaleFor(ctx)),
    })
    return { ok: true, id: parcel.id, returnId }
  })
}

/** Cancels a parcel not yet handed over (K46): the carrier charges nothing; the delivery goes back to the queue. */
export async function cancelShipmentHandler(ctx: Ctx, args: Row) {
  return run(async () => {
    const row = (await ours(ctx, 'stock.Shipment', { id: args.id }))[0]
    if (row?.state === 'cancel') return { ok: true, id: row.id }
    const parcel = await shipmentIn(ctx, args.id, ['draft', 'booked'])
    const cancelReason = reasonOf(args)
    const zero = minorText(0n, await scaleFor(ctx))
    await advance(ctx, parcel, {
      state: 'cancel',
      openPickingId: null,
      cancelledDate: await companyCivilDate(ctx),
      cancelReason,
      shippingFee: zero,
      codFee: zero,
    })
    return { ok: true, id: parcel.id }
  })
}

// ---------------------------------------------------------------------------------------------- statements

/** The parcels a carrier's statement up to a day takes (K47): delivered or back by then, on no other open one. */
async function statable(ctx: Ctx, carrierId: unknown, date: string, statementId: unknown) {
  const on = new Map(
    (await ours(ctx, 'stock.DeliveryStatementLine'))
      .filter((line) => line.openShipmentId)
      .map((line) => [String(line.shipmentId), String(line.statementId)]),
  )
  return (await ours(ctx, 'stock.Shipment', { carrierId }))
    .filter((row) => {
      const closed =
        row.state === 'delivered' ? row.deliveredDate : row.state === 'returned' ? row.returnedDate : null
      const statement = on.get(String(row.id))
      return closed && String(closed) <= date && (!statement || statement === String(statementId))
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

async function statementIn(ctx: Ctx, id: unknown, states: string[]) {
  const row = (await ours(ctx, 'stock.DeliveryStatement', { id }))[0]
  if (!row) throw refuse('id', 'statementMissing')
  if (!states.includes(String(row.state))) throw refuse('id', 'statementState')
  return row
}
async function moveStatement(ctx: Ctx, row: Row, patch: Row) {
  const done = await ctx.db.compareAndSet(
    'stock.DeliveryStatement',
    { id: row.id },
    { state: row.state, revision: row.revision },
    { ...patch, revision: Number(row.revision ?? 0) + 1 },
  )
  if (!matched(done)) throw refuse('id', 'deliveryChanged')
}

/**
 * Saves a carrier's statement up to a day (K47): it takes every parcel of the carrier delivered or brought back
 * by then and on no other statement; saving a draft again takes those that came since.
 */
export async function saveDeliveryStatementHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const scale = await scaleFor(tx)
      const existing = (await ours(tx, 'stock.DeliveryStatement', { id: args.id }))[0]
      if (existing && existing.state !== 'draft') throw refuse('id', 'statementState')
      const carrier = existing
        ? (await ours(tx, 'stock.Carrier', { id: existing.carrierId }))[0]!
        : (await ours(tx, 'stock.Carrier', { id: args.carrierId }))[0]
      if (!carrier || (!existing && carrier.active === false)) throw refuse('carrierId', 'statementCarrier')
      const today = await companyCivilDate(tx)
      const date = String(args.date ?? existing?.date ?? today).trim()
      if (!validDay(date) || date > today) throw refuse('date', 'statementDateInvalid')
      const parcels = await statable(tx, carrier.id, date, args.id)
      if (!parcels.length) throw refuse('date', 'statementNothing')
      const note =
        args.note === undefined
          ? (existing?.note ?? null)
          : String(args.note ?? '')
              .trim()
              .slice(0, 500) || null
      const lines = parcels.map((row, index) => ({
        id: `${String(args.id)}:${String(row.id)}`,
        statementId: args.id,
        shipmentId: row.id,
        openShipmentId: row.id,
        // A parcel brought back collected nothing; only its carrying is charged.
        cod: minorText(row.state === 'delivered' ? moneyMinor(row.cod, scale) : 0n, scale),
        shippingFee: minorText(moneyMinor(row.shippingFee, scale), scale),
        codFee: minorText(moneyMinor(row.codFee, scale), scale),
        sequence: index + 1,
      }))
      const cod = lines.reduce((sum, line) => sum + moneyMinor(line.cod, scale), 0n)
      const fees = lines.reduce(
        (sum, line) => sum + moneyMinor(line.shippingFee, scale) + moneyMinor(line.codFee, scale),
        0n,
      )
      const totals = {
        cod: minorText(cod, scale),
        fees: minorText(fees, scale),
        net: minorText(cod - fees, scale),
      }
      if (existing) {
        await moveStatement(tx, existing, { date, note, ...totals })
        const L = tx.table('stock.DeliveryStatementLine')
        await tx.db.del(
          deleteFrom(L).where(and(eq(L.companyId, tx.scope.company), eq(L.statementId, String(existing.id)))),
        )
      } else {
        const prefix = `${String(carrier.code)}/DS/`
        let last = 0
        for (const row of await ours(tx, 'stock.DeliveryStatement'))
          if (String(row.name).startsWith(prefix))
            last = Math.max(last, Number(String(row.name).slice(prefix.length)) || 0)
        await tx.db.insert('stock.DeliveryStatement', {
          id: args.id,
          name: `${prefix}${String(last + 1).padStart(4, '0')}`,
          carrierId: carrier.id,
          date,
          note,
          state: 'draft',
          ...totals,
          revision: 1,
          createdAt: new Date().toISOString(),
          createdBy: tx.actor ?? null,
        })
      }
      for (const line of lines) await tx.db.insert('stock.DeliveryStatementLine', line)
      return { ok: true, id: args.id }
    }),
  )
}

/** Posts a draft (K47): its fees are a cost of selling, owed to the carrier, on the statement's day. */
export async function postDeliveryStatementHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const row = (await ours(tx, 'stock.DeliveryStatement', { id: args.id }))[0]
      if (row && ['posted', 'paid'].includes(String(row.state))) return { ok: true, id: row.id }
      const statement = await statementIn(tx, args.id, ['draft'])
      const scale = await scaleFor(tx)
      const fees = moneyMinor(statement.fees, scale)
      const setting = fees > 0n ? await stockJournalSetting(tx) : null
      let feeEntryId: string | null = null
      if (setting) {
        if (!setting.deliveryFeeAccountId || !setting.carrierPayableAccountId)
          throw refuse('id', 'deliveryAccountMissing')
        const carrier = (await ours(tx, 'stock.Carrier', { id: statement.carrierId }))[0]!
        feeEntryId = `stock-delivery-fees:${String(statement.id)}`
        await postStockEntry(
          tx,
          {
            id: feeEntryId,
            ref: String(statement.name),
            date: new Date().toISOString(),
            accountingDate: String(statement.date),
            partnerId: carrier.partnerId,
          },
          [
            {
              key: 'fees',
              name: `${String(statement.name)} · ${String(carrier.name)}`,
              productId: null,
              quantity: '0',
              priceUnit: null,
              amount: fees,
              debitAccount: String(setting.deliveryFeeAccountId),
              creditAccount: String(setting.carrierPayableAccountId),
              debitPartnerId: null,
            },
          ],
          scale,
        )
      }
      await moveStatement(tx, statement, { state: 'posted', feeEntryId })
      return { ok: true, id: statement.id }
    }),
  )
}

/** The journals what a carrier pays over can come into: a bank's or the cash box's, with its account. */
export async function listSettlementJournalsHandler(ctx: Ctx) {
  if (!ctx.manifest.models['account.Journal']) return []
  return (await ctx.db.select('account.Journal', { active: true }))
    .filter((row) => ['bank', 'cash'].includes(String(row.type)) && row.defaultAccountId)
    .sort(
      (a, b) =>
        String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name), 'vi'),
    )
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      code: String(row.code),
      type: String(row.type),
    }))
}

/**
 * Settles a posted statement on a day from its own to today (K47): the carrier's fees come off what it
 * collected, so 331 and 1388 clear, and the bank takes what is left, or pays it when the fees are more.
 */
export async function settleDeliveryStatementHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const row = (await ours(tx, 'stock.DeliveryStatement', { id: args.id }))[0]
      if (row?.state === 'paid') return { ok: true, id: row.id }
      const statement = await statementIn(tx, args.id, ['posted'])
      const today = await companyCivilDate(tx)
      const paidDate = String(args.paidDate ?? '').trim()
      if (!validDay(paidDate) || paidDate < String(statement.date) || paidDate > today)
        throw refuse('paidDate', 'statementPaidDateInvalid')
      const scale = await scaleFor(tx)
      const cod = moneyMinor(statement.cod, scale)
      const fees = moneyMinor(statement.fees, scale)
      const setting = cod > 0n || fees > 0n ? await stockJournalSetting(tx) : null
      let paymentJournalId: string | null = null
      let paymentEntryId: string | null = null
      if (setting) {
        if (!setting.carrierCodAccountId || !setting.carrierPayableAccountId)
          throw refuse('id', 'deliveryAccountMissing')
        const journal = (await tx.db.select('account.Journal', { id: args.journalId }))[0]
        if (
          !journal ||
          journal.active === false ||
          !['bank', 'cash'].includes(String(journal.type)) ||
          !journal.defaultAccountId
        )
          throw refuse('journalId', 'statementJournalInvalid')
        const carrier = (await ours(tx, 'stock.Carrier', { id: statement.carrierId }))[0]!
        const bank = String(journal.defaultAccountId)
        const owed = String(setting.carrierPayableAccountId)
        const held = String(setting.carrierCodAccountId)
        const offset = cod < fees ? cod : fees
        const name = `${String(statement.name)} · ${String(carrier.name)}`
        const pair = (key: string, amount: bigint, debitAccount: string, creditAccount: string) => ({
          key,
          name,
          productId: null,
          quantity: '0',
          priceUnit: null,
          amount,
          debitAccount,
          creditAccount,
          debitPartnerId: debitAccount === bank ? null : carrier.partnerId,
          creditPartnerId: creditAccount === bank ? null : carrier.partnerId,
        })
        paymentJournalId = String(journal.id)
        paymentEntryId = `stock-delivery-settlement:${String(statement.id)}`
        await postStockEntry(
          tx,
          {
            id: paymentEntryId,
            ref: String(statement.name),
            date: new Date().toISOString(),
            accountingDate: paidDate,
            partnerId: carrier.partnerId,
            journalId: paymentJournalId,
          },
          [
            offset > 0n ? pair('offset', offset, owed, held) : null,
            cod > fees ? pair('paid', cod - fees, bank, held) : null,
            fees > cod ? pair('paying', fees - cod, owed, bank) : null,
          ].filter((line) => line !== null),
          scale,
        )
      }
      await moveStatement(tx, statement, { state: 'paid', paidDate, paymentJournalId, paymentEntryId })
      return { ok: true, id: statement.id }
    }),
  )
}

/** Drops a draft statement (K47): why stays on it, and its parcels are free for another. */
export async function cancelDeliveryStatementHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const row = (await ours(tx, 'stock.DeliveryStatement', { id: args.id }))[0]
      if (row?.state === 'cancel') return { ok: true, id: row.id }
      const statement = await statementIn(tx, args.id, ['draft'])
      const cancelReason = reasonOf(args)
      await moveStatement(tx, statement, {
        state: 'cancel',
        cancelledDate: await companyCivilDate(tx),
        cancelReason,
      })
      for (const line of await ours(tx, 'stock.DeliveryStatementLine', { statementId: statement.id }))
        await tx.db.update('stock.DeliveryStatementLine', { id: line.id }, { openShipmentId: null })
      return { ok: true, id: statement.id }
    }),
  )
}

export async function listDeliveryStatementsHandler(ctx: Ctx, args: Row = {}) {
  const currency = await currencyOf(ctx)
  const carriers = new Map((await ours(ctx, 'stock.Carrier')).map((row) => [String(row.id), row]))
  const lines = await ours(ctx, 'stock.DeliveryStatementLine')
  return (await ours(ctx, 'stock.DeliveryStatement'))
    .filter((row) => !args.carrierId || row.carrierId === args.carrierId)
    .filter((row) => !args.state || row.state === args.state)
    .sort(
      (a, b) =>
        (STATEMENT_STATES as readonly string[]).indexOf(String(a.state)) -
          (STATEMENT_STATES as readonly string[]).indexOf(String(b.state)) ||
        String(b.date).localeCompare(String(a.date)) ||
        String(a.name).localeCompare(String(b.name)),
    )
    .map((row) => ({
      ...row,
      carrierName: carriers.get(String(row.carrierId))?.name ?? null,
      shipmentCount: lines.filter((line) => line.statementId === row.id).length,
      currency,
    }))
}

/** A statement's page (K47): its parcels with what each collected and cost, and the entries it posted. */
export async function getDeliveryStatementHandler(ctx: Ctx, args: Row) {
  const row = (await ours(ctx, 'stock.DeliveryStatement', { id: args.id }))[0]
  if (!row) return null
  const scale = await scaleFor(ctx)
  const parcels = new Map(
    (await ours(ctx, 'stock.Shipment', { carrierId: row.carrierId })).map((value) => [
      String(value.id),
      value,
    ]),
  )
  const lines = (await ours(ctx, 'stock.DeliveryStatementLine', { statementId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  )
  const partners = await partnerNames(
    ctx,
    [...parcels.values()].map((value) => value.partnerId),
  )
  const entry = async (id: unknown) => {
    const move = id ? (await ctx.db.select('account.Move', { id }))[0] : undefined
    return move ? { id: String(move.id), name: String(move.name) } : null
  }
  // A draft says how many parcels a save would add, delivered or brought back since it was saved.
  const own = new Set(lines.map((line) => String(line.shipmentId)))
  const pending =
    row.state === 'draft'
      ? (await statable(ctx, row.carrierId, String(row.date), row.id)).filter(
          (value) => !own.has(String(value.id)),
        ).length
      : 0
  return {
    ...row,
    currency: (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null,
    carrierName: await nameOf(ctx, 'stock.Carrier', row.carrierId),
    lines: lines.map((line) => {
      const parcel = parcels.get(String(line.shipmentId))
      return {
        ...line,
        name: parcel?.name ?? null,
        trackingCode: parcel?.trackingCode ?? null,
        partnerName: partners.get(String(parcel?.partnerId)) ?? null,
        outcome: parcel?.state ?? null,
        closedDate: parcel?.state === 'returned' ? parcel.returnedDate : (parcel?.deliveredDate ?? null),
        fee: minorText(moneyMinor(line.shippingFee, scale) + moneyMinor(line.codFee, scale), scale),
      }
    }),
    pending,
    today: await companyCivilDate(ctx),
    feeEntry: await entry(row.feeEntryId),
    paymentEntry: await entry(row.paymentEntryId),
    paymentJournalName: await nameOf(ctx, 'account.Journal', row.paymentJournalId),
  }
}

// ---------------------------------------------------------------------------------------------- functions

const OUTPUT = { ok: 'bool', id: 'id?', errors: 'json?' } as const
const BULK_OUTPUT = { ok: 'bool', done: 'json?', skipped: 'json?', errors: 'json?' } as const
const CARRIER_READ = ['read:stock.Carrier', 'read:company.Company']
const SHIPMENT_READ = [
  ...CARRIER_READ,
  'read:stock.Shipment',
  'read:stock.DeliveryStatement',
  'read:stock.DeliveryStatementLine',
  'read:stock.Picking',
  'read:stock.PickingType',
  'read:stock.Move',
  'read:stock.Location',
  'read:stock.Warehouse',
  'read:partner.Partner',
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:account.PaymentTermLine',
  'read:account.Move',
]
const SHIPMENT_WRITE = [...SHIPMENT_READ, 'write:stock.Shipment']
const POSTING = [...new Set([...VALUATION_EFFECTS, ...SHIPMENT_WRITE])]
const STATEMENT_WRITE = [...POSTING, 'write:stock.DeliveryStatement', 'write:stock.DeliveryStatementLine']

export const deliveryFunctions: Record<string, FnSpec> = {
  listCarriers: defineFn({
    input: { includeArchived: 'bool?', withId: 'id?' },
    effects: CARRIER_READ,
    handler: listCarriersHandler,
  }),
  getCarrier: defineFn({ input: { id: 'id' }, effects: CARRIER_READ, handler: getCarrierHandler }),
  saveCarrier: defineFn({
    input: {
      id: 'id',
      code: 'text?',
      name: 'text?',
      baseFee: 'text?',
      extraKgFee: 'text?',
      codFeeRate: 'text?',
      isDefault: 'bool?',
      management: 'text?',
    },
    output: OUTPUT,
    effects: [...CARRIER_READ, 'write:stock.Carrier', 'write:partner.Partner'],
    idempotent: true,
    handler: saveCarrierHandler,
  }),
  archiveCarrier: defineFn({
    input: { id: 'id' },
    output: OUTPUT,
    effects: [...CARRIER_READ, 'write:stock.Carrier'],
    idempotent: true,
    handler: archiveCarrierHandler,
  }),
  activateCarrier: defineFn({
    input: { id: 'id' },
    output: OUTPUT,
    effects: [...CARRIER_READ, 'write:stock.Carrier'],
    idempotent: true,
    handler: activateCarrierHandler,
  }),
  listShipments: defineFn({
    input: { warehouseId: 'id?', state: 'text?', pickingId: 'id?', carrierId: 'id?' },
    effects: SHIPMENT_READ,
    handler: listShipmentsHandler,
  }),
  getShipment: defineFn({ input: { id: 'id' }, effects: SHIPMENT_READ, handler: getShipmentHandler }),
  listDispatchQueue: defineFn({
    input: { warehouseId: 'id?' },
    effects: SHIPMENT_READ,
    handler: listDispatchQueueHandler,
  }),
  getDeliveryOverview: defineFn({ input: {}, effects: SHIPMENT_READ, handler: getDeliveryOverviewHandler }),
  createShipment: defineFn({
    input: { id: 'id', pickingId: 'id' },
    output: OUTPUT,
    effects: SHIPMENT_WRITE,
    // The parcel's own id makes a retried create make it once.
    idempotent: true,
    handler: createShipmentHandler,
  }),
  createShipments: defineFn({
    input: { ids: 'json' },
    output: BULK_OUTPUT,
    effects: SHIPMENT_WRITE,
    // A retry finds the deliveries it served with a parcel and skips them.
    idempotent: true,
    handler: createShipmentsHandler,
  }),
  saveShipment: defineFn({
    input: { id: 'id', carrierId: 'id?', weight: 'text?', cod: 'text?', note: 'text?' },
    output: OUTPUT,
    effects: SHIPMENT_WRITE,
    idempotent: true,
    handler: saveShipmentHandler,
  }),
  bookShipment: defineFn({
    input: {
      id: 'id',
      carrierId: 'id?',
      weight: 'text?',
      cod: 'text?',
      note: 'text?',
      trackingCode: 'text?',
    },
    output: OUTPUT,
    effects: SHIPMENT_WRITE,
    idempotent: true,
    handler: bookShipmentHandler,
  }),
  handOverShipment: defineFn({
    input: { id: 'id' },
    output: OUTPUT,
    effects: [...new Set([...SHIPMENT_WRITE, ...(pickingsFunctions.completePicking!.effects ?? [])])],
    idempotent: true,
    handler: handOverShipmentHandler,
  }),
  handOverShipments: defineFn({
    input: { ids: 'json' },
    output: BULK_OUTPUT,
    effects: [...new Set([...SHIPMENT_WRITE, ...(pickingsFunctions.completePicking!.effects ?? [])])],
    idempotent: true,
    handler: handOverShipmentsHandler,
  }),
  deliverShipment: defineFn({
    input: { id: 'id' },
    output: OUTPUT,
    effects: POSTING,
    idempotent: true,
    handler: deliverShipmentHandler,
  }),
  failShipment: defineFn({
    input: { id: 'id', reason: 'text' },
    output: OUTPUT,
    effects: SHIPMENT_WRITE,
    idempotent: true,
    handler: failShipmentHandler,
  }),
  retryShipment: defineFn({
    input: { id: 'id' },
    output: OUTPUT,
    effects: SHIPMENT_WRITE,
    idempotent: true,
    handler: retryShipmentHandler,
  }),
  returnShipment: defineFn({
    input: { id: 'id' },
    output: { ...OUTPUT, returnId: 'id?' },
    effects: [...new Set([...SHIPMENT_WRITE, ...(returnFunctions.createReturn!.effects ?? [])])],
    idempotent: true,
    handler: returnShipmentHandler,
  }),
  cancelShipment: defineFn({
    input: { id: 'id', reason: 'text' },
    output: OUTPUT,
    effects: SHIPMENT_WRITE,
    idempotent: true,
    handler: cancelShipmentHandler,
  }),
  listDeliveryStatements: defineFn({
    input: { carrierId: 'id?', state: 'text?' },
    effects: SHIPMENT_READ,
    handler: listDeliveryStatementsHandler,
  }),
  getDeliveryStatement: defineFn({
    input: { id: 'id' },
    effects: [...SHIPMENT_READ, 'read:account.Journal'],
    handler: getDeliveryStatementHandler,
  }),
  listSettlementJournals: defineFn({
    input: {},
    effects: ['read:account.Journal'],
    handler: listSettlementJournalsHandler,
  }),
  saveDeliveryStatement: defineFn({
    input: { id: 'id', carrierId: 'id?', date: 'text?', note: 'text?' },
    output: OUTPUT,
    effects: STATEMENT_WRITE,
    idempotent: true,
    handler: saveDeliveryStatementHandler,
  }),
  postDeliveryStatement: defineFn({
    input: { id: 'id' },
    output: OUTPUT,
    effects: STATEMENT_WRITE,
    idempotent: true,
    handler: postDeliveryStatementHandler,
  }),
  settleDeliveryStatement: defineFn({
    input: { id: 'id', paidDate: 'text', journalId: 'id?' },
    output: OUTPUT,
    effects: STATEMENT_WRITE,
    idempotent: true,
    handler: settleDeliveryStatementHandler,
  }),
  cancelDeliveryStatement: defineFn({
    input: { id: 'id', reason: 'text' },
    output: OUTPUT,
    effects: STATEMENT_WRITE,
    idempotent: true,
    handler: cancelDeliveryStatementHandler,
  }),
}
