import { createHash, randomUUID } from 'node:crypto'
import { isDateText } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { civilDate, companyCivilDate } from '../company/civil-date.ts'
import { zonedToUtc } from '../calendar/recurrence.ts'
import { claimStockConfiguration } from '../product/stock-policy.ts'
import { addShelfLifeMonths, lotDatePatch } from './lot-policy.ts'
import { InventoryRefused, PickingConflict } from './inventory-validation.ts'
import { ours } from './scope.ts'

export const RECEIPT_LOT_EFFECTS = [
  'read:stock.Picking',
  'write:stock.Picking',
  'read:stock.PickingType',
  'read:stock.Move',
  'read:stock.MoveLine',
  'write:stock.MoveLine',
  'read:stock.Location',
  'read:stock.Lot',
  'write:stock.Lot',
  'read:product.Product',
  'read:product.Template',
  'write:product.Template',
  'read:company.Company',
]
export const allowsReceiptLot = (code: unknown, source: unknown, destination: unknown, tracking: unknown) =>
  code === 'incoming' &&
  ['supplier', 'production'].includes(String(source)) &&
  ['internal', 'transit'].includes(String(destination)) &&
  tracking === 'lot'
const refuse = (field: string, key: string) =>
  new InventoryRefused({ ok: false, errors: [{ field, messageKey: `stock.error.${key}` }] })
// Drivers differ in decimal scale and datetime shape; the revision compares values, not text.
const instantOf = (value: unknown) =>
  value == null || value === '' ? null : new Date(String(value)).toISOString()
export const receiptLineRevision = (line: Row) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        line.id,
        line.moveId,
        line.productId,
        Number(line.quantity),
        line.productUomId,
        line.locationId,
        line.locationDestId,
        line.lotId ?? null,
        line.receiptLotName ?? null,
        instantOf(line.receiptExpirationDate),
        line.picked === true,
      ]),
    )
    .digest('hex')
const lotName = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
async function zoneOf(ctx: Ctx) {
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  return String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh')
}
const midnight = (day: string, zone: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return zonedToUtc(
    { year: year!, month: month!, day: date!, hour: 0, minute: 0, second: 0 },
    zone,
  ).toISOString()
}
export async function receiptExpiryText(ctx: Ctx, value: unknown) {
  return value ? civilDate(String(value), await zoneOf(ctx)) : ''
}
async function expiryInput(ctx: Ctx, value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!isDateText(text)) throw refuse('expirationDate', 'receiptDate')
  return midnight(text, await zoneOf(ctx))
}
async function receiptContext(ctx: Ctx, move: Row, picking: Row) {
  const type = (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
  const source = (await ours(ctx, 'stock.Location', { id: move.locationId }))[0]
  const destination = (await ours(ctx, 'stock.Location', { id: move.locationDestId }))[0]
  const product = (await ctx.db.select('product.Product', { id: move.productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (
    !template ||
    (template.companyId && template.companyId !== ctx.scope.company) ||
    !allowsReceiptLot(type?.code, source?.usage, destination?.usage, template.tracking)
  )
    throw refuse('moveId', 'receiptLotOnly')
  return { template, source: source! }
}
async function plan(ctx: Ctx, move: Row, template: Row, name: string, expirationDate: unknown) {
  const today = await companyCivilDate(ctx)
  const zone = await zoneOf(ctx)
  const known = name ? (await ours(ctx, 'stock.Lot', { productId: move.productId, name }))[0] : undefined
  if (known) {
    if (
      expirationDate &&
      (!known.expirationDate ||
        civilDate(String(expirationDate), zone) !== civilDate(String(known.expirationDate), zone))
    )
      throw refuse('expirationDate', 'receiptExpiryMismatch')
    return { known, expirationDate: known.expirationDate, today, zone }
  }
  const expiry =
    expirationDate ||
    (template.shelfLifeMonths
      ? midnight(
          addShelfLifeMonths(`${today}T00:00:00.000Z`, Number(template.shelfLifeMonths)).slice(0, 10),
          zone,
        )
      : null)
  if (!expiry) throw refuse('expirationDate', 'receiptExpiryRequired')
  if (civilDate(String(expiry), zone) <= today) throw refuse('expirationDate', 'receiptExpired')
  return { known: undefined, expirationDate: expiry, today, zone }
}

/** Store receipt intent only. Lots and physical balances are written together at completion. */
export async function prepareReceiptLot(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx((tx) => prepareReceiptLotIn(tx, args))
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    if (error instanceof PickingConflict) return refuse('moveId', 'receiptClosed').result
    throw error
  }
}

/**
 * Stores one receipt line inside the caller's transaction (`prepareReceiptLot`, and the transfer
 * grid's `savePickingLines`). Refusals throw `InventoryRefused`; a transfer that closed meanwhile
 * throws `PickingConflict`.
 */
export async function prepareReceiptLotIn(ctx: Ctx, args: Row): Promise<Row> {
  const move = (await ours(ctx, 'stock.Move', { id: args.moveId }))[0]
  const picking = move && (await ours(ctx, 'stock.Picking', { id: move.pickingId }))[0]
  if (
    !move ||
    !picking ||
    ['done', 'cancel'].includes(String(move.state)) ||
    ['done', 'cancel'].includes(String(picking.state))
  )
    throw refuse('moveId', 'receiptClosed')
  const lock = await ctx.db.compareAndSet(
    'stock.Picking',
    { id: picking.id },
    { state: picking.state },
    { state: picking.state },
  )
  if (!('dryRun' in lock) && !lock.matched) throw new PickingConflict()
  const existing = (await ours(ctx, 'stock.MoveLine', { id: args.id }))[0]
  if (existing && existing.moveId !== move.id) throw refuse('id', 'receiptLineOwnership')
  const { template } = await receiptContext(ctx, move, picking)
  const name = String(args.name ?? '').trim()
  if (name && !lotName.test(name)) throw refuse('name', 'receiptName')
  const quantity = Number(args.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number(move.productUomQty) + 0.000001)
    throw refuse('quantity', 'doneOverDemand')
  const expiry = await expiryInput(ctx, args.expirationDate)
  await plan(ctx, move, template, name, expiry)
  const values = {
    id: args.id,
    moveId: move.id,
    pickingId: picking.id,
    productId: move.productId,
    productUomId: move.productUomId,
    quantity: args.quantity,
    quantityProductUom: args.quantity,
    locationId: move.locationId,
    locationDestId: move.locationDestId,
    lotId: null,
    receiptLotName: name,
    receiptExpirationDate: expiry,
    picked: args.picked ?? true,
  }
  if (existing && receiptLineRevision(existing) === receiptLineRevision(values))
    return { ok: true, id: args.id }
  if (
    (existing && args.expectedRevision !== receiptLineRevision(existing)) ||
    (!existing && args.expectedRevision)
  )
    throw refuse('expectedRevision', 'receiptConflict')
  if (existing) await ctx.db.update('stock.MoveLine', { id: args.id }, values)
  else await ctx.db.insert('stock.MoveLine', values)
  return { ok: true, id: args.id }
}

/** Called under the picking transaction; the product lock serializes lot-name allocation. */
export async function materializeReceiptLot(ctx: Ctx, move: Row, picking: Row, line: Row) {
  const { template, source } = await receiptContext(ctx, move, picking)
  await claimStockConfiguration(ctx, template)
  let name = String(line.receiptLotName ?? '').trim()
  if (name && !lotName.test(name)) throw refuse('name', 'receiptName')
  const planned = await plan(ctx, move, template, name, line.receiptExpirationDate)
  if (planned.known) return planned.known.id
  if (!name) {
    const used = new Set(
      (await ours(ctx, 'stock.Lot', { productId: move.productId })).map((lot) => String(lot.name)),
    )
    const base = planned.today.slice(2).replaceAll('-', '')
    name = base
    for (let index = 2; used.has(name); index++) name = `${base}-${index}`
  }
  const id = randomUUID()
  const dates = lotDatePatch(
    {
      expirationDate: planned.expirationDate,
      ...(source.usage === 'production' ? { manufacturingDate: midnight(planned.today, planned.zone) } : {}),
    },
    undefined,
    template,
  )
  await ctx.db.insert('stock.Lot', {
    id,
    productId: move.productId,
    name,
    ...dates,
    active: true,
    quarantined: false,
    revisionId: randomUUID(),
  })
  return id
}
