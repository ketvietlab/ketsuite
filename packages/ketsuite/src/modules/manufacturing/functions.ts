import { and, defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as stockFunctions } from '../stock/functions.ts'
import { quantityText } from '../stock/quantity-text.ts'
import { toProductUnit } from '../stock/units.ts'
import { InventoryRefused } from '../stock/inventory-validation.ts'
import { MOVE_DEMAND_EFFECTS, resizeMoveDemand } from '../stock/move-demand.ts'
import {
  moneyMinor,
  postStockEntry,
  scaleFor,
  share,
  stockJournalSetting,
  units,
} from '../stock/valuation.ts'
import { revaluePickingHandler } from '../stock/functions/revaluation.ts'
import { minorText } from '../account/money.ts'
import { BOM_TYPES } from './types.ts'
import { criteriaOfCheck, evaluate, qualityTemplateFunctions, templateForProduct } from './quality.ts'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../user/authorization.ts'

type InputRow = Record<string, unknown>

const now = () => new Date().toISOString()
const clean = (value: unknown): string => String(value ?? '').trim()
const issue = (field: string, code: string) => ({ field, code })
const invalid = (...errors: Array<{ field: string; code: string }>) => ({ ok: false, errors })
const WORK_CENTER_CODE = /^[A-Z0-9-]{1,10}$/
/** A row of a grid, numbered as people read it (from 1), for refusals that name it. */
const lineIssue = (field: string, code: string, line: number) => ({ field, code, params: { line } })
const CONSUMPTION = ['flexible', 'warning', 'strict'] as const
const TIME_MODES = ['quantity', 'fixed'] as const
/** A quantity to six decimals, so 0.25 × 1.02 stores as 0.255 rather than its binary neighbour. */
const exact = (value: number): string => String(Math.round(value * 1e6) / 1e6)
/** A BOM saved before versions has no state, and reads as the one in use. */
const bomState = (row: Row): string => String(row.state ?? (row.active === false ? 'archived' : 'active'))

const setWorkCenterActive = async (ctx: Ctx, id: unknown, active: boolean) => {
  const center = (await ours(ctx, 'manufacturing.WorkCenter', { id }))[0]
  if (!center) return invalid(issue('id', 'manufacturing.error.missing'))
  if (center.active !== active) await ctx.db.update('manufacturing.WorkCenter', { id: center.id }, { active })
  return { ok: true, id: String(center.id) }
}

const positive = (value: unknown): boolean => Number(value) > 0 && Number.isFinite(Number(value))
const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('manufacturing requires an active company')
  return ctx.scope.company
}
/**
 * Rows belonging to the company being written to, and no other.
 *
 * The company goes into the query rather than into a filter afterwards. Both
 * answer the same set, but the filter form reads every other company's rows
 * first and discards them — and on a shared table like `stock.Move` that is the
 * whole tenant's history to answer for one production order.
 */
const ours = async (ctx: Ctx, model: string, where: InputRow = {}): Promise<Row[]> =>
  ctx.db.select(model, { ...where, companyId: company(ctx) })

const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]

const productUnit = async (
  ctx: Ctx,
  productId: unknown,
  uomId: unknown,
  quantity: unknown,
): Promise<{ uomId: string; quantity: number } | null> => {
  if (!positive(quantity)) return null
  return toProductUnit(ctx, productId, uomId, Number(quantity))
}

const bomDetail = async (ctx: Ctx, row: Row): Promise<Row> => ({
  ...row,
  lines: (await ours(ctx, 'manufacturing.BomLine', { bomId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  ),
  operations: (await ours(ctx, 'manufacturing.Operation', { bomId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  ),
  byproducts: (await ours(ctx, 'manufacturing.Byproduct', { bomId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  ),
})

const productionDetail = async (ctx: Ctx, row: Row): Promise<Row> => {
  const links = (await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  )
  // The moves this production actually links to. Reading the whole move table
  // to find a handful was the detail screen doing work proportional to
  // everything the factory has ever moved.
  const moveIds = links.map((link) => String(link.moveId))
  const M = ctx.table('stock.Move')
  const moves = new Map(
    (moveIds.length
      ? ((await ctx.db.all(
          from(M).where(and(eq(M.companyId, company(ctx)), inArray(M.id, moveIds))),
        )) as Row[])
      : []
    ).map((move) => [String(move.id), move]),
  )
  return {
    ...row,
    moves: links.map((link) => ({ ...link, move: moves.get(String(link.moveId)) ?? null })),
    workOrders: (await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.id })).sort(
      (a, b) => Number(a.sequence) - Number(b.sequence),
    ),
  }
}

const validateBomParts = async (
  ctx: Ctx,
  bomId: string,
  lines: InputRow[],
  operations: InputRow[],
  byproducts: InputRow[],
): Promise<Array<{ field: string; code: string; params?: { line: number } }>> => {
  const errors: Array<{ field: string; code: string; params?: { line: number } }> = []
  const operationIds = new Set<string>()
  for (const [index, operation] of operations.entries()) {
    const id = clean(operation.id) || `${bomId}:operation:${index + 1}`
    operation.id = id
    const at = (field: string, code: string) =>
      errors.push(lineIssue(`operations.${index}.${field}`, code, index + 1))
    if (!clean(operation.name)) at('name', 'manufacturing.error.required')
    if (!clean(operation.workCenterId)) at('workCenterId', 'manufacturing.error.operationCenter')
    else if (!(await ours(ctx, 'manufacturing.WorkCenter', { id: operation.workCenterId }))[0])
      at('workCenterId', 'manufacturing.error.missing')
    if (Number(operation.durationExpected ?? 0) < 0) at('durationExpected', 'manufacturing.error.invalid')
    if (operation.timeMode != null && !TIME_MODES.includes(operation.timeMode as never))
      at('timeMode', 'manufacturing.error.invalid')
    operationIds.add(id)
  }
  const validateMaterial = async (part: InputRow, index: number, prefix: string) => {
    const at = (field: string, code: string) =>
      errors.push(lineIssue(`${prefix}.${index}.${field}`, code, index + 1))
    if (!clean(part.productId)) return at('productId', 'manufacturing.error.lineProduct')
    const converted = await productUnit(ctx, part.productId, part.productUomId, part.productQty)
    if (!converted) at('productQty', 'manufacturing.error.invalid')
    const loss = Number(part.lossPercent ?? 0)
    if (!Number.isFinite(loss) || loss < 0 || loss > 50) at('lossPercent', 'manufacturing.error.lineLoss')
    if (part.operationId && !operationIds.has(String(part.operationId)))
      at('operationId', 'manufacturing.error.missing')
  }
  for (const [index, line] of lines.entries()) await validateMaterial(line, index, 'lines')
  for (const [index, byproduct] of byproducts.entries())
    await validateMaterial(byproduct, index, 'byproducts')
  return errors
}

const transition = async (
  ctx: Ctx,
  model: string,
  row: Row,
  expectedVersion: number,
  expectedState: string | string[],
  values: InputRow,
) => {
  const states = Array.isArray(expectedState) ? expectedState : [expectedState]
  if (Number(row.version) !== expectedVersion) return false
  if (!states.includes(String(row.state))) return false
  const changed = await ctx.db.compareAndSet(
    model,
    { id: row.id },
    { version: expectedVersion, state: row.state },
    { ...values, version: expectedVersion + 1 },
  )
  return 'dryRun' in changed || changed.matched
}

const saveBomEffects = [
  'read:manufacturing.Bom',
  'write:manufacturing.Bom',
  'read:manufacturing.BomLine',
  'write:manufacturing.BomLine',
  'read:manufacturing.Byproduct',
  'write:manufacturing.Byproduct',
  'read:manufacturing.Operation',
  'write:manufacturing.Operation',
  'read:manufacturing.WorkCenter',
  // A BOM cannot be edited while an order is built on it, and a rule that
  // cannot read the orders cannot enforce that.
  'read:manufacturing.Production',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
]

/**
 * Orders that are still living off this BOM.
 *
 * Saving a BOM deletes its lines, operations and by-products and writes them
 * again. That is fine while nothing has been built from it, and destructive the
 * moment something has: a confirmed order's work orders point at operation rows
 * by id, and an edit that drops or reorders an operation leaves them pointing
 * at a row that no longer exists — a reference the schema says cannot be null
 * and now cannot be resolved either.
 *
 * A finished or cancelled order is not in the way. Its work orders still name
 * operations that may vanish, but nothing will act on them again, and refusing
 * to ever edit a BOM that once produced something would make BOMs write-once.
 */
const productionsHolding = async (ctx: Ctx, bomId: string): Promise<Row[]> =>
  (await ours(ctx, 'manufacturing.Bom', { id: bomId }))[0]
    ? (await ours(ctx, 'manufacturing.Production', { bomId })).filter((row) =>
        ['confirmed', 'in_progress', 'to_close'].includes(String(row.state)),
      )
    : []

const confirmEffects = [
  'read:stock.Picking',
  'read:manufacturing.OperatorSkill',
  'read:manufacturing.WorkCenter',
  'read:manufacturing.WorkOrder',
  'read:manufacturing.Bom',
  'read:manufacturing.BomLine',
  'read:manufacturing.Byproduct',
  'read:manufacturing.Operation',
  'read:manufacturing.Production',
  'write:manufacturing.Production',
  'read:manufacturing.ProductionMove',
  'write:manufacturing.ProductionMove',
  'read:manufacturing.WorkOrder',
  'write:manufacturing.WorkOrder',
  'read:stock.PickingType',
  'write:stock.PickingType',
  ...effectsOf(
    stockFunctions.createPicking,
    stockFunctions.addMove,
    stockFunctions.confirmPicking,
    stockFunctions.assignPicking,
  ),
]

/**
 * What this production is still short of, asked of the reservation itself.
 *
 * Reserving is idempotent, so asking again is how a caller finds out where it
 * stands. The alternative — answering an already-confirmed order with an empty
 * list — reports "nothing missing" to whoever presses confirm a second time,
 * and reports it most confidently in exactly the case where the first attempt
 * failed after the transaction committed and nothing was ever reserved.
 */
const shortagesOf = async (ctx: Ctx, rawPickingId: unknown): Promise<Row[]> => {
  if (!rawPickingId) return []
  const picking = (await ours(ctx, 'stock.Picking', { id: rawPickingId }))[0]
  if (!picking || ['draft', 'done', 'cancel'].includes(String(picking.state))) return []
  const allocation = (await stockFunctions.assignPicking!.handler(ctx, { id: rawPickingId })) as Row
  return (allocation.shortages as Row[] | undefined) ?? []
}

const consumeEffects = [
  ...new Set([
    'read:manufacturing.Production',
    'write:manufacturing.Production',
    'read:manufacturing.ProductionMove',
    'write:manufacturing.ProductionMove',
    'read:manufacturing.Bom',
    'read:stock.Location',
    'read:stock.Quant',
    'read:stock.MoveLine',
    'read:product.Product',
    'read:product.Template',
    ...MOVE_DEMAND_EFFECTS,
    'read:stock.Picking',
    ...effectsOf(
      stockFunctions.createPicking,
      stockFunctions.addMove,
      stockFunctions.confirmPicking,
      stockFunctions.assignPicking,
      stockFunctions.unreservePicking,
      stockFunctions.completePicking,
    ),
  ]),
]

type ConsumptionEntry = {
  productId: string
  uomId: string
  /** The open component move this order reserved, if any is left. */
  moveId: string | null
  need: string
  /** Used, net of what was returned. */
  consumed: string
  returned: string
  scrapped: string
  /** What the component move still asks for; a completion takes this as used. */
  remaining: string
}

/** Each component of an order: what it needs, what is recorded as used, and what is left to take. */
const consumptionOf = async (ctx: Ctx, productionId: string): Promise<ConsumptionEntry[]> => {
  const links = (await ours(ctx, 'manufacturing.ProductionMove', { productionId })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  )
  const entries = new Map<
    string,
    ConsumptionEntry & {
      needValue: number
      consumedValue: number
      returnedValue: number
      scrappedValue: number
    }
  >()
  for (const link of links) {
    if (!['component', 'consumed', 'returned', 'scrapped'].includes(String(link.kind))) continue
    const move = (await ours(ctx, 'stock.Move', { id: link.moveId }))[0]
    if (!move) continue
    const productId = String(move.productId)
    const entry =
      entries.get(productId) ??
      ({
        productId,
        uomId: String(move.productUomId),
        moveId: null,
        need: '0',
        consumed: '0',
        returned: '0',
        scrapped: '0',
        remaining: '0',
        needValue: 0,
        consumedValue: 0,
        returnedValue: 0,
        scrappedValue: 0,
      } as ConsumptionEntry & {
        needValue: number
        consumedValue: number
        returnedValue: number
        scrappedValue: number
      })
    if (link.kind === 'component') {
      // An order confirmed before demand was kept reads its move as confirmed.
      entry.needValue += Number(link.demand ?? move.productUomQty)
      if (!['done', 'cancel'].includes(String(move.state))) {
        entry.moveId = String(move.id)
        entry.remaining = String(Number(entry.remaining) + Number(move.productUomQty))
      }
    } else if (move.state === 'done') {
      if (link.kind === 'consumed') entry.consumedValue += Number(move.productUomQty)
      else if (link.kind === 'returned') entry.returnedValue += Number(move.productUomQty)
      else entry.scrappedValue += Number(move.productUomQty)
    }
    // A scrapped product that is not a component of the order is not part of its use.
    if (entry.needValue > 0 || link.kind !== 'scrapped') entries.set(productId, entry)
  }
  return [...entries.values()].map(
    ({ needValue, consumedValue, returnedValue, scrappedValue, ...entry }) => ({
      ...entry,
      need: exact(needValue),
      consumed: exact(consumedValue - returnedValue),
      returned: exact(returnedValue),
      scrapped: exact(scrappedValue),
      remaining: exact(Number(entry.remaining)),
    }),
  )
}

const outputEffects = [
  ...new Set([
    'read:manufacturing.Production',
    'write:manufacturing.Production',
    'read:manufacturing.ProductionMove',
    'write:manufacturing.ProductionMove',
    'read:stock.Lot',
    'read:stock.Picking',
    'read:product.Product',
    'read:product.Template',
    ...MOVE_DEMAND_EFFECTS,
    ...effectsOf(
      stockFunctions.createLot,
      stockFunctions.createPicking,
      stockFunctions.addMove,
      stockFunctions.confirmPicking,
      stockFunctions.saveMoveLine,
      stockFunctions.completePicking,
    ),
  ]),
]

const UNIT = 1_000_000n

const costEffects = [
  'read:company.Company',
  'read:stock.ProductValuation',
  'read:product.Cost',
  'read:stock.Move',
  'read:stock.MoveLine',
  'read:manufacturing.Production',
  'read:manufacturing.ProductionMove',
]

/**
 * What a unit of an order's product costs provisionally: the components its BOM asks for (the
 * demand kept at confirmation) at their running average now, or their catalogue cost when none is
 * held, over the order's quantity, in whole minor units of the company currency.
 */
const provisionalCost = async (ctx: Ctx, row: Row): Promise<string> => {
  const scale = await scaleFor(ctx)
  let total = 0n
  for (const entry of await consumptionOf(ctx, String(row.id))) {
    const held = (await ours(ctx, 'stock.ProductValuation', { productId: entry.productId }))[0]
    const heldUnits = held ? units(held.quantity) : 0n
    const average =
      heldUnits > 0n
        ? share(moneyMinor(held!.value, scale), UNIT, heldUnits)
        : moneyMinor(
            (await ours(ctx, 'product.Cost', { productId: entry.productId }))[0]?.standardPrice ?? 0,
            scale,
          )
    total += share(average, units(entry.need), UNIT)
  }
  const planned = units(row.productQty)
  return minorText(planned > 0n ? share(total, UNIT, planned) : 0n, scale)
}

/**
 * What the components an order kept were worth: its issue transfers' value when they left, less
 * what came back. Scrap is a cost of goods of its own and stays out.
 */
const issuedValue = async (ctx: Ctx, orderId: string): Promise<bigint> => {
  const scale = await scaleFor(ctx)
  let value = 0n
  for (const link of await ours(ctx, 'manufacturing.ProductionMove', { productionId: orderId })) {
    const sign =
      link.kind === 'component' || link.kind === 'consumed' ? 1n : link.kind === 'returned' ? -1n : 0n
    if (sign !== 0n)
      for (const line of await ours(ctx, 'stock.MoveLine', { moveId: link.moveId }))
        if (line.value != null) value += sign * moneyMinor(line.value, scale)
  }
  return value
}

/** A done transfer of an order's own: one picking, its moves, each linked to the order as `kind`. */
const bookTransfer = async (
  ctx: Ctx,
  row: Row,
  step: string,
  from: unknown,
  to: unknown,
  lines: Array<{ productId: unknown; uomId: unknown; quantity: number; priceUnit?: string | null }>,
  link: Row,
): Promise<Row> => {
  const links = await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })
  const pickingId = nextRecordOf(String(row.id), links, step)
  await stockFunctions.createPicking!.handler(ctx, {
    id: pickingId,
    name: `${String(row.name)} · ${new Date().toISOString().slice(0, 10)}`,
    pickingTypeId: `${company(ctx)}:manufacturing:components`,
    locationId: from,
    locationDestId: to,
    moveType: 'direct',
    scheduledDate: now(),
  })
  for (const [index, line] of lines.entries()) {
    const moveId = `${pickingId}:${String(line.productId)}`
    await stockFunctions.addMove!.handler(ctx, {
      id: moveId,
      name: `${String(row.name)} · ${step} ${index + 1}`,
      pickingId,
      productId: line.productId,
      productUomId: line.uomId,
      productUomQty: exact(line.quantity),
      origin: String(row.name),
    })
    if (line.priceUnit != null)
      await ctx.db.update('stock.Move', { id: moveId }, { priceUnit: line.priceUnit })
    await ctx.db.insertIfAbsent('manufacturing.ProductionMove', {
      id: `${String(row.id)}:move:${String(link.kind)}:${moveId}`,
      productionId: row.id,
      moveId,
      sequence: links.length + index + 1,
      ...link,
    })
  }
  await stockFunctions.confirmPicking!.handler(ctx, { id: pickingId })
  const source = (await ours(ctx, 'stock.Location', { id: from }))[0]
  if (source?.usage === 'internal') await stockFunctions.assignPicking!.handler(ctx, { id: pickingId })
  // Nothing is held at the production location: the lines are what comes back.
  else
    for (const line of lines) {
      const moveId = `${pickingId}:${String(line.productId)}`
      const saved = (await stockFunctions.saveMoveLine!.handler(ctx, {
        id: `${moveId}:line`,
        moveId,
        quantity: exact(line.quantity),
        picked: true,
      })) as Row
      if (saved?.ok === false) return saved
    }
  const completed = (await stockFunctions.completePicking!.handler(ctx, {
    id: pickingId,
    createBackorder: false,
  })) as Row
  if (completed?.ok === false) return completed
  return { ok: true, id: row.id, pickingId }
}

/** The company's place for goods scrapped on the floor, made the first time it is needed. */
const scrapLocationOf = async (ctx: Ctx): Promise<string> => {
  const id = `${company(ctx)}:manufacturing:scrap`
  if (!(await ours(ctx, 'stock.Location', { id })).length)
    await stockFunctions.saveLocation!.handler(ctx, { id, name: 'Production scrap', usage: 'scrap' })
  return id
}

/**
 * By-products come in at no cost when an order closes, as much of each as the share of the plan
 * that was made; a lot-tracked one gets a lot named after the order.
 */
const receiveByproducts = async (ctx: Ctx, row: Row, share: number): Promise<void> => {
  const lines: Array<{ productId: unknown; uomId: unknown; quantity: number; priceUnit: string }> = []
  for (const link of await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })) {
    if (link.kind !== 'byproduct') continue
    const move = (await ours(ctx, 'stock.Move', { id: link.moveId }))[0]
    if (!move || move.state === 'done') continue
    const quantity = Number(exact(Number(move.productUomQty) * share))
    if (quantity > 0)
      lines.push({ productId: move.productId, uomId: move.productUomId, quantity, priceUnit: '0' })
  }
  if (!lines.length) return
  const links = await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })
  const pickingId = nextRecordOf(String(row.id), links, 'byproducts')
  await stockFunctions.createPicking!.handler(ctx, {
    id: pickingId,
    name: `${String(row.name)} · by-products`,
    pickingTypeId: `${company(ctx)}:manufacturing:outputs`,
    locationId: row.productionLocationId,
    locationDestId: row.destinationLocationId,
    moveType: 'direct',
    scheduledDate: now(),
  })
  for (const [index, line] of lines.entries()) {
    const moveId = `${pickingId}:${String(line.productId)}`
    await stockFunctions.addMove!.handler(ctx, {
      id: moveId,
      name: `${String(row.name)} · by-product ${index + 1}`,
      pickingId,
      productId: line.productId,
      productUomId: line.uomId,
      productUomQty: exact(line.quantity),
      origin: String(row.name),
    })
    await ctx.db.update('stock.Move', { id: moveId }, { priceUnit: line.priceUnit })
    await ctx.db.insertIfAbsent('manufacturing.ProductionMove', {
      id: `${String(row.id)}:move:byproduct_output:${moveId}`,
      productionId: row.id,
      moveId,
      kind: 'byproduct_output',
      sequence: links.length + index + 1,
    })
  }
  await stockFunctions.confirmPicking!.handler(ctx, { id: pickingId })
  for (const line of lines) {
    const moveId = `${pickingId}:${String(line.productId)}`
    const product = (await ctx.db.select('product.Product', { id: line.productId }))[0]
    const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    let lotId: string | null = null
    if (template?.tracking === 'lot') {
      lotId = `${moveId}:lot`
      await stockFunctions.createLot!.handler(ctx, {
        id: lotId,
        productId: line.productId,
        name: String(row.name),
        ref: String(row.name),
      })
    }
    await stockFunctions.saveMoveLine!.handler(ctx, {
      id: `${moveId}:line`,
      moveId,
      quantity: exact(line.quantity),
      lotId,
      picked: true,
    })
  }
  await stockFunctions.completePicking!.handler(ctx, { id: pickingId, createBackorder: false })
}

const QUALITY_EFFECTS = [
  'read:manufacturing.QualityCheck',
  'write:manufacturing.QualityCheck',
  'read:manufacturing.Production',
  'read:manufacturing.Bom',
  'read:stock.Lot',
  'read:manufacturing.QualityTemplate',
  'read:manufacturing.QualityCriterion',
  'read:manufacturing.QualityResult',
  'write:manufacturing.QualityResult',
]

const TRACE_EFFECTS = [
  'read:manufacturing.QualityCheck',
  'read:manufacturing.Production',
  'read:manufacturing.ProductionMove',
  'read:stock.Lot',
  'read:stock.Location',
  'read:stock.Move',
  'read:stock.MoveLine',
  'read:stock.Picking',
  'read:partner.Partner',
]

const settleEffects = [
  ...costEffects,
  'read:manufacturing.WorkOrder',
  'read:manufacturing.WorkCenter',
  'read:manufacturing.CostSetting',
  'read:stock.Quant',
  'read:stock.Location',
  'read:stock.Revaluation',
  'write:stock.Revaluation',
  'read:stock.ValuationLayer',
  'write:stock.ValuationLayer',
  'write:stock.ProductValuation',
  'write:product.Cost',
  'read:stock.Picking',
  'read:account.Account',
  'read:account.Journal',
  'read:account.Move',
  'write:account.Move',
  'read:account.MoveLine',
  'write:account.MoveLine',
  'read:stock.AccountingSetting',
  'write:manufacturing.Production',
]

/**
 * Settle a closed order's cost. Labour is each operation's minutes at its work center's hourly
 * cost, charged to work in progress (154) against the labour account (622). The difference between
 * what the order consumed plus labour and what its batches entered stock at is split by how much of
 * what it made is still held: that share revalues its last receipt (K63, against 154), the rest goes
 * to cost of goods (632). What cannot be revalued goes to 632 too, so work in progress ends at nought.
 */
const settleCost = async (ctx: Ctx, row: Row): Promise<void> => {
  const scale = await scaleFor(ctx)
  const setting = await stockJournalSetting(ctx)
  const labourAccount = (await ours(ctx, 'manufacturing.CostSetting'))[0]?.labourAccountId ?? null
  const centers = new Map(
    (await ours(ctx, 'manufacturing.WorkCenter')).map((center) => [String(center.id), center]),
  )
  let labour = 0n
  if (labourAccount)
    for (const work of await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.id })) {
      const hourly = moneyMinor(centers.get(String(work.workCenterId))?.costPerHour ?? 0, scale)
      labour += share(hourly, BigInt(Math.max(0, Number(work.durationActual ?? 0))), 60n)
    }
  const links = await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })
  let made = 0n
  let lastOutput: Row | null = null
  for (const link of links)
    if (link.kind === 'output')
      for (const line of await ours(ctx, 'stock.MoveLine', { moveId: link.moveId }))
        if (line.value != null) {
          made += moneyMinor(line.value, scale)
          lastOutput = link
        }
  const difference = (await issuedValue(ctx, String(row.id))) + labour - made
  const ref = String(row.name)
  const date = now()
  if (labour > 0n && setting)
    await postStockEntry(
      ctx,
      { id: `manufacturing-labour:${String(row.id)}`, ref, date },
      [
        {
          key: 'labour',
          name: `${ref} · labour`,
          productId: row.productId,
          quantity: '0',
          priceUnit: null,
          amount: labour,
          debitAccount: String(setting.productionAccountId),
          creditAccount: String(labourAccount),
        },
      ],
      scale,
    )
  // How much of what was made the company still holds, at most what was made.
  const owned = new Set(
    (await ours(ctx, 'stock.Location'))
      .filter((location) => ['internal', 'transit'].includes(String(location.usage)))
      .map((location) => String(location.id)),
  )
  const heldUnits = (await ours(ctx, 'stock.Quant', { productId: row.productId }))
    .filter((quant) => owned.has(String(quant.locationId)))
    .reduce((sum, quant) => sum + units(quant.quantity), 0n)
  const produced = units(row.quantityProduced ?? 0)
  const kept = heldUnits > produced ? produced : heldUnits < 0n ? 0n : heldUnits
  let held = produced > 0n ? share(difference, kept, produced) : 0n
  if (held !== 0n && lastOutput) {
    const move = (await ours(ctx, 'stock.Move', { id: lastOutput.moveId }))[0]
    const revalued = (await revaluePickingHandler(ctx, {
      id: move?.pickingId,
      revaluationId: `manufacturing-settle:${String(row.id)}`,
      moveId: lastOutput.moveId,
      amount: minorText(held, scale),
      account: 'production',
      reason: `${ref} · cost difference`,
    })) as Row
    if (revalued.ok === false) held = 0n
  } else held = 0n
  const sold = difference - held
  if (sold !== 0n && setting)
    await postStockEntry(
      ctx,
      { id: `manufacturing-variance:${String(row.id)}`, ref, date },
      [
        {
          key: 'variance',
          name: `${ref} · cost difference`,
          productId: row.productId,
          quantity: '0',
          priceUnit: null,
          amount: sold > 0n ? sold : -sold,
          debitAccount: String(sold > 0n ? setting.cogsAccountId : setting.productionAccountId),
          creditAccount: String(sold > 0n ? setting.productionAccountId : setting.cogsAccountId),
        },
      ],
      scale,
    )
  await ctx.db.update(
    'manufacturing.Production',
    { id: row.id },
    {
      labourCost: minorText(labour, scale),
      varianceHeld: minorText(held, scale),
      varianceSold: minorText(sold, scale),
    },
  )
}

/**
 * Each component of an order against its BOM: what the BOM asks for what was planned (or, for an
 * order closed short, for what was made), what was used, and the difference.
 */
const varianceOf = async (ctx: Ctx, row: Row) => {
  const share =
    row.closedShort && Number(row.productQty) > 0
      ? Math.min(1, Number(row.quantityProduced ?? 0) / Number(row.productQty))
      : 1
  return (await consumptionOf(ctx, String(row.id))).map((entry) => {
    const expected = Number(entry.need) * share
    const used = Number(entry.consumed)
    const difference = used - expected
    return {
      productionId: row.id,
      productionName: row.name,
      productionState: row.state,
      productId: entry.productId,
      uomId: entry.uomId,
      expected: exact(expected),
      used: exact(used),
      difference: exact(difference),
      percent: expected > 0 ? exact(Math.round((difference / expected) * 10_000) / 100) : null,
    }
  })
}

/** The skill level a person needs before a work center's work is given to them. */
export const OPERATOR_LEVEL = 2

/**
 * Who takes the next work of a center: among people skilled enough, the one whose level is
 * closest to what is needed, then the one with the least open work, workers before floor leads.
 * Nobody skilled enough leaves the work unassigned rather than guessing. Work given out in the
 * same pass counts as open, so one confirmation spreads its operations.
 */
const operatorPicker = async (ctx: Ctx) => {
  const skills = await ours(ctx, 'manufacturing.OperatorSkill')
  const open = new Map<string, number>()
  for (const work of await ours(ctx, 'manufacturing.WorkOrder'))
    if (work.operatorId && !['done', 'cancelled'].includes(String(work.state)))
      open.set(String(work.operatorId), (open.get(String(work.operatorId)) ?? 0) + 1)
  return (center: Row | undefined): string | null => {
    if (!center?.skill) return null
    const chosen = skills
      .filter((row) => row.skill === center.skill && Number(row.level) >= OPERATOR_LEVEL)
      .map((row) => ({
        id: String(row.userId),
        gap: Number(row.level) - OPERATOR_LEVEL,
        open: open.get(String(row.userId)) ?? 0,
        lead: row.lead ? 1 : 0,
      }))
      .sort((a, b) => a.gap - b.gap || a.open - b.open || a.lead - b.lead || a.id.localeCompare(b.id))[0]
    if (chosen) open.set(chosen.id, chosen.open + 1)
    return chosen?.id ?? null
  }
}

const LOG_EFFECTS = ['read:manufacturing.WorkTimeLog', 'write:manufacturing.WorkTimeLog']

/** Typed minutes for a run: a whole number from 1 to 100,000, or null when none were typed. */
const typedMinutes = (value: unknown): number | null | 'invalid' => {
  if (value == null || clean(value) === '') return null
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 100_000 ? minutes : 'invalid'
}

/** Open a run of an operation for its operator. */
const openRun = async (ctx: Ctx, work: Row, operatorId: unknown): Promise<void> => {
  const runs = await ours(ctx, 'manufacturing.WorkTimeLog', { workOrderId: work.id })
  await ctx.db.insert('manufacturing.WorkTimeLog', {
    id: `${String(work.id)}:run:${String(runs.length + 1)}`,
    workOrderId: work.id,
    operatorId: operatorId ?? null,
    startedAt: now(),
    stoppedAt: null,
    minutes: null,
  })
}

/**
 * Close the open run with the minutes typed, or the minutes clocked since it opened; with none open
 * and minutes typed, the run is recorded as it was told. Returns the operation's total minutes.
 */
const closeRun = async (ctx: Ctx, work: Row, minutes: number | null): Promise<number> => {
  const runs = await ours(ctx, 'manufacturing.WorkTimeLog', { workOrderId: work.id })
  const open = runs.find((run) => !run.stoppedAt)
  const clocked = (run: Row | undefined) =>
    run ? Math.max(0, Math.round((Date.now() - Date.parse(String(run.startedAt))) / 60_000)) : 0
  if (open)
    await ctx.db.update(
      'manufacturing.WorkTimeLog',
      { id: open.id },
      { stoppedAt: now(), minutes: minutes ?? clocked(open) },
    )
  else if (minutes != null)
    await ctx.db.insert('manufacturing.WorkTimeLog', {
      id: `${String(work.id)}:run:${String(runs.length + 1)}`,
      workOrderId: work.id,
      operatorId: work.operatorId ?? null,
      startedAt: now(),
      stoppedAt: now(),
      minutes,
    })
  return (await ours(ctx, 'manufacturing.WorkTimeLog', { workOrderId: work.id })).reduce(
    (sum, run) => sum + Number(run.minutes ?? 0),
    0,
  )
}

/**
 * When a running operation changes hands, close the current run and open the new operator's.
 * Returns a refusal, or null to go on.
 */
const handOver = async (ctx: Ctx, work: Row, operatorId: unknown, typed: unknown): Promise<Row | null> => {
  if (work.state !== 'in_progress' || work.operatorId === operatorId) return null
  const minutes = typedMinutes(typed)
  if (minutes === 'invalid') return invalid(issue('minutes', 'manufacturing.error.minutesInvalid'))
  const total = await closeRun(ctx, work, minutes)
  await ctx.db.update('manufacturing.WorkOrder', { id: work.id }, { durationActual: total })
  if (operatorId) await openRun(ctx, work, operatorId)
  return null
}

/** Whether a person may be given a center's work: anyone when it names no skill. */
const skilledFor = async (ctx: Ctx, center: Row | undefined, userId: string): Promise<boolean> =>
  !center?.skill ||
  (await ours(ctx, 'manufacturing.OperatorSkill', { userId, skill: center.skill })).some(
    (row) => Number(row.level) >= OPERATOR_LEVEL,
  )

/**
 * Close an order whose output was recorded: backflush what nobody recorded for the part made,
 * release the rest of the plan, and either order the remainder or close short.
 */
const closeRecorded = async (ctx: Ctx, row: Row, workOrders: Row[], rest: string): Promise<Row> => {
  if (!['backorder', 'close'].includes(rest)) return invalid(issue('rest', 'manufacturing.error.invalid'))
  if (!['confirmed', 'in_progress'].includes(String(row.state)))
    return invalid(issue('state', 'manufacturing.error.state'))
  const produced = Number(row.quantityProduced ?? 0)
  if (!(produced > 0)) return invalid(issue('quantityProduced', 'manufacturing.error.nothingMade'))
  const open = workOrders.filter((work) => !['done', 'cancelled'].includes(String(work.state)))
  if (open.length)
    return {
      ok: false,
      errors: [
        {
          field: 'workOrders',
          code: 'manufacturing.error.workLeft',
          params: { operations: open.map((work) => String(work.name)).join(', ') },
        },
      ],
    }
  // What the BOM asks for the part made, less what was recorded, is taken now.
  const share = Math.min(1, produced / Number(row.productQty))
  const totals = (await consumptionOf(ctx, String(row.id)))
    .filter((entry) => Number(entry.consumed) + 1e-9 < Number(entry.need) * share)
    .map((entry) => ({ productId: entry.productId, consumed: exact(Number(entry.need) * share) }))
  if (totals.length) {
    const used = (await functions.consumeProduction!.handler(ctx, { id: row.id, components: totals })) as Row
    if (used.ok === false) return used
  }
  await receiveByproducts(ctx, row, share)
  for (const pickingId of [row.rawPickingId, row.outputPickingId]) {
    const picking = pickingId ? (await ours(ctx, 'stock.Picking', { id: pickingId }))[0] : null
    if (picking && !['done', 'cancel'].includes(String(picking.state)))
      await stockFunctions.cancelPicking!.handler(ctx, { id: picking.id })
  }
  const current = (await ours(ctx, 'manufacturing.Production', { id: row.id }))[0]!
  const short = produced + 1e-9 < Number(row.productQty)
  let backorderId: string | null = null
  if (short && rest === 'backorder') {
    const taken = new Set((await ours(ctx, 'manufacturing.Production')).map((other) => String(other.name)))
    let suffix = 1
    const nameFor = (n: number) => `${String(row.name)}-${String(n).padStart(2, '0')}`
    while (taken.has(nameFor(suffix))) suffix++
    backorderId = `${String(row.id)}:rest:${String(suffix)}`
    const saved = (await functions.saveProduction!.handler(ctx, {
      id: backorderId,
      name: nameFor(suffix),
      bomId: row.bomId,
      productQty: exact(Number(row.productQty) - produced),
      productUomId: row.productUomId,
      sourceLocationId: row.sourceLocationId,
      productionLocationId: row.productionLocationId,
      destinationLocationId: row.destinationLocationId,
      scheduledStart: now(),
      origin: String(row.name),
      priority: row.priority ?? null,
    })) as Row
    if (saved.ok === false) return saved
    await ctx.db.update('manufacturing.Production', { id: backorderId }, { backorderOfId: row.id })
    await functions.confirmProduction!.handler(ctx, { id: backorderId, version: Number(saved.version) })
  }
  const changed = await ctx.db.compareAndSet(
    'manufacturing.Production',
    { id: row.id },
    { version: current.version },
    {
      state: 'done',
      finishedAt: now(),
      closedShort: short && rest === 'close',
      version: Number(current.version) + 1,
    },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return invalid(issue('version', 'manufacturing.error.version'))
  await settleCost(ctx, (await ours(ctx, 'manufacturing.Production', { id: row.id }))[0]!)
  return { ok: true, id: row.id, version: Number(current.version) + 1, backorderId }
}

/** `YYMMDD` of a day, the lot a batch made that day is named after unless someone names it. */
const lotDay = (at: Date): string => at.toISOString().slice(2, 10).replaceAll('-', '')

/**
 * The id of an order's next transfer of one kind (`<order>:consume:3`), numbered after the
 * highest one its links name; product ids may themselves contain colons.
 */
const nextRecordOf = (orderId: string, links: Row[], step: string): string => {
  const prefix = `${orderId}:${step}:`
  const taken = links
    .map((link) => String(link.moveId))
    .filter((moveId) => moveId.startsWith(prefix))
    .map((moveId) => Number.parseInt(moveId.slice(prefix.length), 10))
    .filter(Number.isFinite)
  return `${prefix}${String(Math.max(0, ...taken) + 1)}`
}

/** Active members of the company who may run the shop floor, by their own name. */
const operatorCandidates = async (ctx: Ctx): Promise<Array<{ id: string; name: string }>> => {
  const members = await ctx.db.select('user.Membership', { companyId: company(ctx) })
  const people: Array<{ id: string; name: string }> = []
  for (const member of members) {
    const user = (await ctx.db.select('user.User', { id: member.userId }))[0]
    if (!user || user.active === false) continue
    if (ctx.manifest.permissions.coverageRequired) {
      const keys = await effectiveFunctionKeys(ctx, String(user.id))
      if (keys && !keys.includes('manufacturing.startWorkOrder')) continue
    }
    people.push({ id: String(user.id), name: clean(user.name) || String(user.login ?? user.id) })
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id))
}

export const functions: Record<string, FnSpec> = {
  ...qualityTemplateFunctions,
  listBoms: defineFn({
    input: { productId: 'id?', includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text?',
      productId: 'id',
      productQty: 'decimal',
      type: 'text',
      state: 'text',
      version: 'int',
      familyId: 'id?',
      familyCode: 'text?',
      consumption: 'text?',
    },
    effects: ['read:manufacturing.Bom'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = await ours(ctx, 'manufacturing.Bom', args.productId ? { productId: args.productId } : {})
      // Only the version in use holds the code; the others read it through their family.
      const familyCode = new Map<string, string>()
      for (const row of rows) if (row.code) familyCode.set(String(row.familyId ?? row.id), String(row.code))
      return rows
        .filter((row) => args.includeArchived === true || bomState(row) !== 'archived')
        .map(
          (row): Row => ({
            ...row,
            state: bomState(row),
            version: Number(row.version ?? 1),
            familyCode: familyCode.get(String(row.familyId ?? row.id)) ?? row.code ?? null,
          }),
        )
        .sort(
          (a, b) =>
            String(a.familyCode ?? a.id).localeCompare(String(b.familyCode ?? b.id)) ||
            Number(b.version) - Number(a.version),
        )
    },
  }),

  getBom: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      code: 'text?',
      productId: 'id',
      productQty: 'decimal',
      productUomId: 'id',
      type: 'text',
      familyId: 'id?',
      byproducts: 'json?',
      lines: 'json?',
      operations: 'json?',
      state: 'text',
      version: 'int',
      familyCode: 'text?',
      consumption: 'text?',
      unitWeight: 'decimal?',
      weightTolerance: 'decimal?',
      phMin: 'decimal?',
      phMax: 'decimal?',
      toOrder: 'bool?',
      reason: 'text?',
      versions: 'json?',
    },
    effects: [
      'read:manufacturing.Bom',
      'read:manufacturing.BomLine',
      'read:manufacturing.Operation',
      'read:manufacturing.Byproduct',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Bom', { id: args.id }))[0]
      if (!row) return null
      const familyId = String(row.familyId ?? row.id)
      const family = row.familyId
        ? [
            ...(await ours(ctx, 'manufacturing.Bom', { familyId })),
            ...(await ours(ctx, 'manufacturing.Bom', { id: familyId })),
          ].filter((other, index, all) => all.findIndex((seen) => seen.id === other.id) === index)
        : [row]
      return {
        ...(await bomDetail(ctx, row)),
        state: bomState(row),
        version: Number(row.version ?? 1),
        familyCode: family.find((other) => other.code)?.code ?? null,
        versions: family
          .map((other) => ({
            id: other.id,
            version: Number(other.version ?? 1),
            state: bomState(other),
            requestedBy: other.requestedBy ?? null,
            approvedBy: other.approvedBy ?? null,
            approvedAt: other.approvedAt ?? null,
            reason: other.reason ?? null,
          }))
          .sort((a, b) => b.version - a.version),
      }
    },
  }),

  saveBom: defineFn({
    input: {
      id: 'id',
      code: 'text?',
      productId: 'id',
      productQty: 'decimal',
      productUomId: 'id',
      type: 'text?',
      active: 'bool?',
      consumption: 'text?',
      unitWeight: 'text?',
      weightTolerance: 'text?',
      phMin: 'text?',
      phMax: 'text?',
      toOrder: 'bool?',
      /** A new BOM saved as a draft version, to be submitted and approved before use. */
      draft: 'bool?',
      lines: 'json?',
      operations: 'json?',
      byproducts: 'json?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: saveBomEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = String(args.id)
      const type = String(args.type ?? 'normal')
      const converted = await productUnit(ctx, args.productId, args.productUomId, args.productQty)
      const lines = Array.isArray(args.lines) ? (args.lines as InputRow[]).map((row) => ({ ...row })) : []
      const operations = Array.isArray(args.operations)
        ? (args.operations as InputRow[]).map((row) => ({ ...row }))
        : []
      const byproducts = Array.isArray(args.byproducts)
        ? (args.byproducts as InputRow[]).map((row) => ({ ...row }))
        : []
      const errors = await validateBomParts(ctx, id, lines, operations, byproducts)
      if (!converted) errors.push(issue('productQty', 'manufacturing.error.invalid'))
      if (!BOM_TYPES.includes(type as never)) errors.push(issue('type', 'manufacturing.error.invalid'))
      const existing = (await ours(ctx, 'manufacturing.Bom', { id }))[0]
      // Only a draft version changes; one in review, in use or archived is a record.
      if (existing?.state && existing.state !== 'draft')
        return { ok: false, errors: [issue('state', 'manufacturing.error.state')] }
      // A later version takes the family's code when it is approved, not before.
      const code =
        existing?.familyId && existing.familyId !== existing.id
          ? (existing.code ?? null)
          : clean(args.code) || null
      if (code && (await ours(ctx, 'manufacturing.Bom', { code })).some((row) => String(row.id) !== id))
        errors.push(issue('code', 'manufacturing.error.invalid'))
      const consumption =
        args.consumption == null ? (existing?.consumption ?? null) : clean(args.consumption) || null
      if (consumption && !CONSUMPTION.includes(consumption as never))
        errors.push(issue('consumption', 'manufacturing.error.invalid'))
      const decimalOr = (value: unknown, kept: unknown) =>
        value == null ? (kept ?? null) : clean(value) === '' ? null : Number(value)
      const unitWeight = decimalOr(args.unitWeight, existing?.unitWeight)
      const weightTolerance = decimalOr(args.weightTolerance, existing?.weightTolerance)
      if (unitWeight != null && !(Number(unitWeight) > 0))
        errors.push(issue('unitWeight', 'manufacturing.error.invalid'))
      if (weightTolerance != null && !(Number(weightTolerance) >= 0 && Number(weightTolerance) <= 50))
        errors.push(issue('weightTolerance', 'manufacturing.error.invalid'))
      // A pH range has both ends on the 0–14 scale, the lower first.
      const phMin = decimalOr(args.phMin, existing?.phMin)
      const phMax = decimalOr(args.phMax, existing?.phMax)
      const onScale = (value: unknown) => Number(value) >= 0 && Number(value) <= 14
      if (phMin != null && !onScale(phMin)) errors.push(issue('phMin', 'manufacturing.error.invalid'))
      if (phMax != null && !onScale(phMax)) errors.push(issue('phMax', 'manufacturing.error.invalid'))
      if ((phMin == null) !== (phMax == null))
        errors.push(issue(phMin == null ? 'phMin' : 'phMax', 'manufacturing.error.phRange'))
      else if (phMin != null && onScale(phMin) && onScale(phMax) && Number(phMin) > Number(phMax))
        errors.push(issue('phMax', 'manufacturing.error.phRange'))
      if (errors.length) return { ok: false, errors }

      if (existing && (await productionsHolding(ctx, id)).length)
        return { ok: false, errors: [issue('id', 'manufacturing.error.bomInUse')] }
      const versioned = existing ? Boolean(existing.state) : args.draft === true
      await ctx.tx(async (tx) => {
        const values = {
          code,
          productId: args.productId,
          productQty: String(converted!.quantity),
          productUomId: converted!.uomId,
          type,
          consumption,
          unitWeight: unitWeight == null ? null : String(unitWeight),
          weightTolerance: weightTolerance == null ? null : String(weightTolerance),
          phMin: phMin == null ? null : String(phMin),
          phMax: phMax == null ? null : String(phMax),
          toOrder: args.toOrder == null ? (existing?.toOrder ?? null) : args.toOrder === true,
          active: versioned ? false : (args.active ?? true),
        }
        if (existing) await tx.db.update('manufacturing.Bom', { id }, values)
        else
          await tx.db.insert('manufacturing.Bom', {
            id,
            ...values,
            ...(versioned ? { version: 1, state: 'draft', familyId: id } : {}),
          })

        const L = tx.table('manufacturing.BomLine')
        const B = tx.table('manufacturing.Byproduct')
        const O = tx.table('manufacturing.Operation')
        await tx.db.del(deleteFrom(L).where(eq(L.bomId, id)))
        await tx.db.del(deleteFrom(B).where(eq(B.bomId, id)))
        await tx.db.del(deleteFrom(O).where(eq(O.bomId, id)))

        for (const [index, operation] of operations.entries())
          await tx.db.insert('manufacturing.Operation', {
            id: operation.id,
            bomId: id,
            workCenterId: operation.workCenterId,
            name: clean(operation.name),
            sequence: Number(operation.sequence ?? (index + 1) * 10),
            durationExpected: Math.max(0, Number(operation.durationExpected ?? 0)),
            timeMode: operation.timeMode ?? null,
            instructions: clean(operation.instructions) || null,
          })
        for (const [index, line] of lines.entries()) {
          const unit = await productUnit(tx, line.productId, line.productUomId, line.productQty)
          await tx.db.insert('manufacturing.BomLine', {
            id: clean(line.id) || `${id}:line:${index + 1}`,
            bomId: id,
            productId: line.productId,
            productQty: String(unit!.quantity),
            productUomId: unit!.uomId,
            operationId: line.operationId ?? null,
            lossPercent:
              line.lossPercent == null || line.lossPercent === '' ? null : String(Number(line.lossPercent)),
            sequence: Number(line.sequence ?? (index + 1) * 10),
          })
        }
        for (const [index, byproduct] of byproducts.entries()) {
          const unit = await productUnit(
            tx,
            byproduct.productId,
            byproduct.productUomId,
            byproduct.productQty,
          )
          await tx.db.insert('manufacturing.Byproduct', {
            id: clean(byproduct.id) || `${id}:byproduct:${index + 1}`,
            bomId: id,
            productId: byproduct.productId,
            productQty: String(unit!.quantity),
            productUomId: unit!.uomId,
            sequence: Number(byproduct.sequence ?? (index + 1) * 10),
          })
        }
      })
      return { ok: true, id }
    },
  }),

  /** A draft version goes to review, with the reason it changes; it needs a line to make anything. */
  submitBom: defineFn({
    input: { id: 'id', reason: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.Bom', 'write:manufacturing.Bom', 'read:manufacturing.BomLine'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Bom', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'review') return { ok: true, id: row.id }
      if (row.state !== 'draft') return invalid(issue('state', 'manufacturing.error.state'))
      if (!(await ours(ctx, 'manufacturing.BomLine', { bomId: row.id })).length)
        return invalid(issue('lines', 'manufacturing.error.bomEmpty'))
      const reason = clean(args.reason)
      if (!reason) return invalid(issue('reason', 'manufacturing.error.required'))
      await ctx.db.update(
        'manufacturing.Bom',
        { id: row.id },
        {
          state: 'review',
          reason,
          requestedBy: ctx.actor ?? null,
          requestedAt: now(),
          approvedBy: null,
          approvedAt: null,
        },
      )
      return { ok: true, id: String(row.id) }
    },
  }),

  /**
   * Someone other than who submitted it puts a version in use. The version it replaces is
   * archived and hands over the family's code; orders already confirmed on it keep their numbers.
   */
  approveBom: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.Bom', 'write:manufacturing.Bom'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Bom', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'active') return { ok: true, id: row.id }
      if (row.state !== 'review') return invalid(issue('state', 'manufacturing.error.state'))
      if (!ctx.actor || row.requestedBy === ctx.actor)
        return invalid(issue('approvedBy', 'manufacturing.error.sameReviewer'))
      const familyId = String(row.familyId ?? row.id)
      const family = await ours(ctx, 'manufacturing.Bom', { familyId })
      const current = [...family, ...(await ours(ctx, 'manufacturing.Bom', { id: familyId }))].filter(
        (other) => other.id !== row.id && bomState(other) === 'active',
      )
      const code = row.code ?? current.find((other) => other.code)?.code ?? null
      await ctx.tx(async (tx) => {
        for (const other of current)
          await tx.db.update(
            'manufacturing.Bom',
            { id: other.id },
            { state: 'archived', active: false, code: null },
          )
        await tx.db.update(
          'manufacturing.Bom',
          { id: row.id },
          { state: 'active', active: true, code, approvedBy: ctx.actor, approvedAt: now() },
        )
      })
      return { ok: true, id: String(row.id) }
    },
  }),

  /** A version in review goes back to draft, with why. */
  rejectBom: defineFn({
    input: { id: 'id', reason: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.Bom', 'write:manufacturing.Bom'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Bom', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'draft') return { ok: true, id: row.id }
      if (row.state !== 'review') return invalid(issue('state', 'manufacturing.error.state'))
      const reason = clean(args.reason)
      if (!reason) return invalid(issue('reason', 'manufacturing.error.required'))
      await ctx.db.update('manufacturing.Bom', { id: row.id }, { state: 'draft', reason })
      return { ok: true, id: String(row.id) }
    },
  }),

  /**
   * The next draft version of a family, copied from the given one; asking again while a
   * draft is open answers that draft.
   */
  newBomVersion: defineFn({
    input: { id: 'id', newId: 'id' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: saveBomEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const source = (await ours(ctx, 'manufacturing.Bom', { id: args.id }))[0]
      if (!source) return invalid(issue('id', 'manufacturing.error.missing'))
      const familyId = String(source.familyId ?? source.id)
      const family = [
        ...(await ours(ctx, 'manufacturing.Bom', { familyId })),
        ...(source.familyId ? [] : [source]),
      ]
      const open = family.find((row) => row.state === 'draft' || row.state === 'review')
      if (open) return { ok: true, id: String(open.id), version: Number(open.version ?? 1) }
      const version = Math.max(...family.map((row) => Number(row.version ?? 1))) + 1
      const id = String(args.newId)
      const detail = await bomDetail(ctx, source)
      await ctx.tx(async (tx) => {
        // A BOM from before versions joins the family it starts.
        if (!source.familyId)
          await tx.db.update(
            'manufacturing.Bom',
            { id: source.id },
            { familyId, version: Number(source.version ?? 1), state: bomState(source) },
          )
        await tx.db.insert('manufacturing.Bom', {
          id,
          code: null,
          productId: source.productId,
          productQty: source.productQty,
          productUomId: source.productUomId,
          type: source.type,
          active: false,
          consumption: source.consumption ?? null,
          unitWeight: source.unitWeight ?? null,
          weightTolerance: source.weightTolerance ?? null,
          phMin: source.phMin ?? null,
          phMax: source.phMax ?? null,
          toOrder: source.toOrder ?? null,
          version,
          state: 'draft',
          familyId,
          reason: null,
        })
        const operationIds = new Map<string, string>()
        for (const { companyId: _company, ...operation } of detail.operations as Row[]) {
          const operationId = `${id}:operation:${String(operation.sequence)}`
          operationIds.set(String(operation.id), operationId)
          await tx.db.insert('manufacturing.Operation', { ...operation, id: operationId, bomId: id })
        }
        for (const { companyId: _company, ...line } of detail.lines as Row[])
          await tx.db.insert('manufacturing.BomLine', {
            ...line,
            id: `${id}:line:${String(line.sequence)}`,
            bomId: id,
            operationId: line.operationId ? (operationIds.get(String(line.operationId)) ?? null) : null,
          })
        for (const { companyId: _company, ...byproduct } of detail.byproducts as Row[])
          await tx.db.insert('manufacturing.Byproduct', {
            ...byproduct,
            id: `${id}:byproduct:${String(byproduct.sequence)}`,
            bomId: id,
          })
      })
      return { ok: true, id, version }
    },
  }),

  /** Any version but one in review can be archived; orders made from it are untouched. */
  archiveBom: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.Bom', 'write:manufacturing.Bom'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Bom', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (bomState(row) === 'archived') return { ok: true, id: row.id }
      if (row.state === 'review') return invalid(issue('state', 'manufacturing.error.state'))
      await ctx.db.update(
        'manufacturing.Bom',
        { id: row.id },
        { state: row.state ? 'archived' : null, active: false },
      )
      return { ok: true, id: String(row.id) }
    },
  }),

  listWorkCenters: defineFn({
    input: { includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      skill: 'text?',
      capacity: 'decimal',
      timeEfficiency: 'decimal',
      costPerHour: 'decimal',
      active: 'bool',
    },
    effects: ['read:manufacturing.WorkCenter'],
    agent: true,
    handler: async (ctx, args) =>
      (await ours(ctx, 'manufacturing.WorkCenter'))
        .filter((row) => args.includeArchived === true || row.active !== false)
        .sort((a, b) => String(a.code).localeCompare(String(b.code))),
  }),

  /** One work center with the work orders waiting at it, soonest in the queue first. */
  getWorkCenter: defineFn({
    input: { id: 'id' },
    effects: [
      'read:manufacturing.WorkCenter',
      'read:manufacturing.WorkOrder',
      'read:manufacturing.Production',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const center = (await ours(ctx, 'manufacturing.WorkCenter', { id: args.id }))[0]
      if (!center) return null
      const open = (await ours(ctx, 'manufacturing.WorkOrder', { workCenterId: center.id })).filter(
        (row) => !['done', 'cancel'].includes(String(row.state)),
      )
      const productions = new Map<string, Row>()
      for (const id of new Set(open.map((row) => String(row.productionId)))) {
        const production = (await ours(ctx, 'manufacturing.Production', { id }))[0]
        if (production) productions.set(id, production)
      }
      const RUNNING = ['in_progress', 'paused', 'ready', 'pending']
      const rank = (state: unknown) => {
        const index = RUNNING.indexOf(String(state))
        return index === -1 ? RUNNING.length : index
      }
      const queue = open
        .map((row) => {
          const production = productions.get(String(row.productionId))
          return {
            id: row.id,
            name: row.name,
            state: row.state,
            sequence: row.sequence,
            durationExpected: row.durationExpected,
            productionId: row.productionId,
            productionName: production?.name ?? null,
            scheduledStart: production?.scheduledStart ?? null,
          }
        })
        .sort(
          (a, b) =>
            rank(a.state) - rank(b.state) ||
            String(a.scheduledStart ?? '').localeCompare(String(b.scheduledStart ?? '')) ||
            Number(a.sequence) - Number(b.sequence),
        )
      return { ...center, queue }
    },
  }),

  saveWorkCenter: defineFn({
    input: {
      id: 'id',
      code: 'text',
      name: 'text',
      skill: 'text?',
      capacity: 'decimal?',
      timeEfficiency: 'decimal?',
      costPerHour: 'decimal?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.WorkCenter', 'write:manufacturing.WorkCenter'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = String(args.id)
      const code = clean(args.code).toUpperCase()
      const name = clean(args.name)
      if (!code || !name) return invalid(issue(!code ? 'code' : 'name', 'manufacturing.error.required'))
      // A short code people say and print on the floor: letters, digits and dashes.
      if (!WORK_CENTER_CODE.test(code)) return invalid(issue('code', 'manufacturing.error.codeInvalid'))
      if ((await ours(ctx, 'manufacturing.WorkCenter', { code })).some((row) => String(row.id) !== id))
        return invalid(issue('code', 'manufacturing.error.codeTaken'))
      const capacity = Number(args.capacity ?? 1)
      const efficiency = Number(args.timeEfficiency ?? 100)
      if (!(capacity > 0) || !Number.isFinite(capacity))
        return invalid(issue('capacity', 'manufacturing.error.capacityInvalid'))
      if (!(efficiency > 0) || !Number.isFinite(efficiency))
        return invalid(issue('timeEfficiency', 'manufacturing.error.invalid'))
      // An hour is costed in whole currency units, never below zero.
      const cost = Number(args.costPerHour ?? 0)
      if (!Number.isInteger(cost) || cost < 0)
        return invalid(issue('costPerHour', 'manufacturing.error.moneyInvalid'))
      const existing = (await ours(ctx, 'manufacturing.WorkCenter', { id }))[0]
      const values = {
        code,
        name,
        skill: args.skill === undefined ? (existing?.skill ?? null) : clean(args.skill) || null,
        capacity: String(capacity),
        timeEfficiency: String(efficiency),
        costPerHour: String(cost),
        active: args.active ?? existing?.active ?? true,
      }
      if (existing) await ctx.db.update('manufacturing.WorkCenter', { id }, values)
      else await ctx.db.insert('manufacturing.WorkCenter', { id, ...values })
      return { ok: true, id }
    },
  }),

  /** Archived, a work center stays on the operations that name it but takes no new ones. */
  archiveWorkCenter: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.WorkCenter', 'write:manufacturing.WorkCenter'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => setWorkCenterActive(ctx, args.id, false),
  }),

  restoreWorkCenter: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.WorkCenter', 'write:manufacturing.WorkCenter'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => setWorkCenterActive(ctx, args.id, true),
  }),

  listProductions: defineFn({
    input: { state: 'text?', productId: 'id?' },
    output: { id: 'id', name: 'text', productId: 'id', productQty: 'decimal', state: 'text' },
    effects: ['read:manufacturing.Production'],
    agent: true,
    handler: async (ctx, args) =>
      (await ours(ctx, 'manufacturing.Production'))
        .filter(
          (row) =>
            (!args.state || row.state === args.state) &&
            (!args.productId || row.productId === args.productId),
        )
        .sort((a, b) => String(b.scheduledStart).localeCompare(String(a.scheduledStart))),
  }),

  /**
   * Open orders in the order the floor works them: in progress, then confirmed, then drafts, each
   * by priority and scheduled start; then done and cancelled. Each open order says whether its
   * components are there (`ready`), covered by receipts on their way (`waiting`) or short.
   *
   * Confirmed orders take stock in queue order, so a later one sees what an earlier one left.
   * A draft reads what the confirmed orders left without taking it, so two drafts never compete.
   */
  productionQueue: defineFn({
    input: {},
    output: {
      id: 'id',
      name: 'text',
      productId: 'id',
      productQty: 'decimal',
      state: 'text',
      material: 'text?',
      shortages: 'json?',
      orderSource: 'text?',
    },
    effects: [
      'read:manufacturing.Production',
      'read:manufacturing.ProductionMove',
      'read:manufacturing.Bom',
      'read:manufacturing.BomLine',
      'read:stock.Move',
      'read:stock.Quant',
      'read:stock.Location',
    ],
    agent: true,
    handler: async (ctx) => {
      const RANK: Record<string, number> = {
        in_progress: 0,
        to_close: 0,
        confirmed: 1,
        draft: 2,
        done: 3,
        cancelled: 4,
      }
      const productions = (await ours(ctx, 'manufacturing.Production')).sort(
        (a, b) =>
          (RANK[String(a.state)] ?? 5) - (RANK[String(b.state)] ?? 5) ||
          Number(b.priority ?? 0) - Number(a.priority ?? 0) ||
          String(a.scheduledStart ?? '').localeCompare(String(b.scheduledStart ?? '')) ||
          String(a.name).localeCompare(String(b.name)),
      )
      const internal = new Set(
        (await ours(ctx, 'stock.Location'))
          .filter((row) => row.usage === 'internal')
          .map((row) => String(row.id)),
      )
      const onHand = new Map<string, number>()
      for (const quant of await ours(ctx, 'stock.Quant'))
        if (internal.has(String(quant.locationId)))
          onHand.set(
            String(quant.productId),
            (onHand.get(String(quant.productId)) ?? 0) + Number(quant.quantity),
          )
      const moves = await ours(ctx, 'stock.Move')
      const open = (move: Row) => !['draft', 'done', 'cancel'].includes(String(move.state))
      // Receipts on their way: open moves into stock from outside it.
      const incoming = new Map<string, number>()
      for (const move of moves)
        if (open(move) && internal.has(String(move.locationDestId)) && !internal.has(String(move.locationId)))
          incoming.set(
            String(move.productId),
            (incoming.get(String(move.productId)) ?? 0) + Number(move.productUomQty),
          )
      const movesById = new Map(moves.map((move) => [String(move.id), move]))
      const needOf = async (production: Row): Promise<Map<string, number>> => {
        const need = new Map<string, number>()
        const add = (productId: unknown, quantity: number) =>
          need.set(String(productId), (need.get(String(productId)) ?? 0) + quantity)
        if (production.state === 'draft') {
          const bom = (await ours(ctx, 'manufacturing.Bom', { id: production.bomId }))[0]
          if (!bom) return need
          const factor = Number(production.productQty) / Number(bom.productQty)
          for (const line of await ours(ctx, 'manufacturing.BomLine', { bomId: bom.id }))
            add(line.productId, Number(line.productQty) * (1 + Number(line.lossPercent ?? 0) / 100) * factor)
          return need
        }
        for (const link of await ours(ctx, 'manufacturing.ProductionMove', { productionId: production.id })) {
          if (link.kind !== 'component') continue
          const move = movesById.get(String(link.moveId))
          if (move && open(move)) add(move.productId, Number(move.productUomQty))
        }
        return need
      }
      const pool = new Map(onHand)
      const coming = new Map(incoming)
      const rows: Row[] = []
      for (const production of productions) {
        const state = String(production.state)
        if (!['in_progress', 'to_close', 'confirmed', 'draft'].includes(state)) {
          rows.push({ ...production, material: null, shortages: [] })
          continue
        }
        const takes = state !== 'draft'
        let material = 'ready'
        const shortages: Row[] = []
        for (const [productId, need] of await needOf(production)) {
          const have = pool.get(productId) ?? 0
          const arriving = coming.get(productId) ?? 0
          if (have + 1e-9 < need) {
            const covered = have + arriving + 1e-9 >= need
            if (!covered) material = 'short'
            else if (material === 'ready') material = 'waiting'
            shortages.push({
              productId,
              need: exact(need),
              available: exact(Math.max(0, have)),
              incoming: exact(arriving),
            })
          }
          if (takes) {
            pool.set(productId, Math.max(0, have - need))
            coming.set(productId, Math.max(0, arriving - Math.max(0, need - have)))
          }
        }
        rows.push({ ...production, material, shortages })
      }
      return rows
    },
  }),

  getProduction: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      priority: 'int?',
      cancelReason: 'text?',
      backorderOfId: 'id?',
      closedShort: 'bool?',
      orderSource: 'text?',
      saleOrderId: 'text?',
      saleLineId: 'text?',
      saleNotice: 'text?',
      orderpointId: 'text?',
      deadline: 'datetime?',
      origin: 'text?',
      bomId: 'id',
      productId: 'id',
      productQty: 'decimal',
      productUomId: 'id',
      quantityProduced: 'decimal',
      state: 'text',
      version: 'int',
      moves: 'json?',
      workOrders: 'json?',
    },
    effects: [
      'read:manufacturing.Production',
      'read:manufacturing.ProductionMove',
      'read:manufacturing.WorkOrder',
      'read:stock.Move',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      return row ? productionDetail(ctx, row) : null
    },
  }),

  saveProduction: defineFn({
    input: {
      id: 'id',
      name: 'text',
      /** Without a BOM, the product's version in use is taken; a product with none is refused. */
      bomId: 'id?',
      productId: 'id?',
      priority: 'int?',
      productQty: 'decimal',
      productUomId: 'id',
      sourceLocationId: 'id',
      productionLocationId: 'id',
      destinationLocationId: 'id',
      scheduledStart: 'datetime',
      scheduledFinish: 'datetime?',
      origin: 'text?',
      version: 'int?',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.Bom',
      'read:manufacturing.Production',
      'write:manufacturing.Production',
      'read:stock.Location',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const bom = args.bomId
        ? (await ours(ctx, 'manufacturing.Bom', { id: args.bomId }))[0]
        : (await ours(ctx, 'manufacturing.Bom', { productId: args.productId ?? null })).find(
            (row) => bomState(row) === 'active',
          )
      if (!args.bomId && !bom) return invalid(issue('productId', 'manufacturing.error.noBom'))
      if (!bom || bom.active === false) return invalid(issue('bomId', 'manufacturing.error.missing'))
      const converted = await productUnit(ctx, bom.productId, args.productUomId, args.productQty)
      if (!converted) return invalid(issue('productQty', 'manufacturing.error.invalid'))
      // The three locations named, not every location in the tenant.
      const wanted = [args.sourceLocationId, args.productionLocationId, args.destinationLocationId]
        .map((id) => String(id ?? ''))
        .filter(Boolean)
      const L = ctx.table('stock.Location')
      const locations = new Map(
        (wanted.length
          ? ((await ctx.db.all(
              from(L).where(and(eq(L.companyId, company(ctx)), inArray(L.id, wanted))),
            )) as Row[])
          : []
        ).map((location) => [String(location.id), location]),
      )
      const source = locations.get(String(args.sourceLocationId))
      const production = locations.get(String(args.productionLocationId))
      const destination = locations.get(String(args.destinationLocationId))
      if (!source || !['internal', 'transit'].includes(String(source.usage)))
        return invalid(issue('sourceLocationId', 'manufacturing.error.invalid'))
      if (production?.usage !== 'production')
        return invalid(issue('productionLocationId', 'manufacturing.error.invalid'))
      if (!destination || !['internal', 'transit'].includes(String(destination.usage)))
        return invalid(issue('destinationLocationId', 'manufacturing.error.invalid'))
      if (!clean(args.name)) return invalid(issue('name', 'manufacturing.error.required'))
      const id = String(args.id)
      const existing = (await ours(ctx, 'manufacturing.Production', { id }))[0]
      if (existing && existing.state !== 'draft') return invalid(issue('state', 'manufacturing.error.state'))
      if (existing && Number(existing.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      // Two orders may not share a name, and the check has to look past this
      // row: an edit that keeps its own name is not a clash with itself.
      if (
        (await ours(ctx, 'manufacturing.Production', { name: clean(args.name) })).some(
          (row) => String(row.id) !== id,
        )
      )
        return invalid(issue('name', 'manufacturing.error.invalid'))
      const version = existing ? Number(existing.version) + 1 : 1
      const values = {
        name: clean(args.name),
        bomId: bom.id,
        productId: bom.productId,
        productQty: String(converted.quantity),
        productUomId: converted.uomId,
        quantityProduced: '0',
        sourceLocationId: args.sourceLocationId,
        productionLocationId: args.productionLocationId,
        destinationLocationId: args.destinationLocationId,
        rawPickingId: null,
        outputPickingId: null,
        state: 'draft',
        scheduledStart: args.scheduledStart,
        scheduledFinish: args.scheduledFinish ?? null,
        startedAt: null,
        finishedAt: null,
        origin: clean(args.origin) || null,
        priority: args.priority == null ? (existing?.priority ?? null) : Number(args.priority),
        version,
      }
      if (existing) {
        await ctx.db.update('manufacturing.Production', { id }, values)
        return { ok: true, id, version }
      }
      // Two operators pressing create, or a browser resubmitting the form, both
      // read no existing row. The primary key settles it and the loser answers
      // ok — which is what `idempotent` promises and a thrown constraint is not.
      const inserted = await ctx.db.insertIfAbsent('manufacturing.Production', { id, ...values })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const winner = (await ours(ctx, 'manufacturing.Production', { id }))[0]
        return { ok: true, id, version: Number(winner?.version ?? version) }
      }
      return { ok: true, id, version }
    },
  }),

  confirmProduction: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', shortages: 'json?', errors: 'json?' },
    effects: confirmEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const production = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!production) return invalid(issue('id', 'manufacturing.error.missing'))
      if (production.state !== 'draft')
        return ['confirmed', 'in_progress', 'done'].includes(String(production.state))
          ? {
              ok: true,
              id: production.id,
              version: production.version,
              // Asked, not assumed. This is also the path a retry takes when
              // the first confirm committed and then failed to reserve, so it
              // is where the reservation finally happens.
              shortages: await shortagesOf(ctx, production.rawPickingId),
            }
          : invalid(issue('state', 'manufacturing.error.state'))
      if (Number(production.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      const bom = (await ours(ctx, 'manufacturing.Bom', { id: production.bomId }))[0]
      if (!bom || bom.active === false) return invalid(issue('bomId', 'manufacturing.error.missing'))
      const lines = (await ours(ctx, 'manufacturing.BomLine', { bomId: bom.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const byproducts = (await ours(ctx, 'manufacturing.Byproduct', { bomId: bom.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const operations = (await ours(ctx, 'manufacturing.Operation', { bomId: bom.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const factor = Number(production.productQty) / Number(bom.productQty)
      const rawPickingId = `${String(production.id)}:components`
      const outputPickingId = `${String(production.id)}:outputs`
      const rawTypeId = `${company(ctx)}:manufacturing:components`
      const outputTypeId = `${company(ctx)}:manufacturing:outputs`
      await ctx.tx(async (tx) => {
        const claimed = await transition(
          tx,
          'manufacturing.Production',
          production,
          Number(args.version),
          'draft',
          { state: 'confirmed', rawPickingId, outputPickingId },
        )
        if (!claimed) throw new Error('manufacturing production changed during confirmation')
        await tx.db.insertIfAbsent('stock.PickingType', {
          id: rawTypeId,
          name: 'Manufacturing Components',
          code: 'internal',
          warehouseId: null,
          defaultLocationSrcId: null,
          defaultLocationDestId: null,
          createBackorder: 'never',
          active: true,
        })
        await tx.db.insertIfAbsent('stock.PickingType', {
          id: outputTypeId,
          name: 'Manufacturing Outputs',
          code: 'internal',
          warehouseId: null,
          defaultLocationSrcId: null,
          defaultLocationDestId: null,
          createBackorder: 'never',
          active: true,
        })
        await stockFunctions.createPicking!.handler(tx, {
          id: rawPickingId,
          name: `${String(production.name)} · Components`,
          pickingTypeId: rawTypeId,
          locationId: production.sourceLocationId,
          locationDestId: production.productionLocationId,
          moveType: 'one',
          scheduledDate: production.scheduledStart,
        })
        await stockFunctions.createPicking!.handler(tx, {
          id: outputPickingId,
          name: `${String(production.name)} · Outputs`,
          pickingTypeId: outputTypeId,
          locationId: production.productionLocationId,
          locationDestId: production.destinationLocationId,
          moveType: 'direct',
          scheduledDate: production.scheduledFinish ?? production.scheduledStart,
        })
        for (const [index, line] of lines.entries()) {
          const moveId = `${String(production.id)}:raw:${String(line.id)}`
          await stockFunctions.addMove!.handler(tx, {
            id: moveId,
            name: `${String(production.name)} · component ${index + 1}`,
            pickingId: rawPickingId,
            productId: line.productId,
            productUomId: line.productUomId,
            productUomQty: exact(
              Number(line.productQty) * (1 + Number(line.lossPercent ?? 0) / 100) * factor,
            ),
            origin: String(production.name),
          })
          await tx.db.insertIfAbsent('manufacturing.ProductionMove', {
            id: `${String(production.id)}:move:raw:${String(line.id)}`,
            productionId: production.id,
            moveId,
            kind: 'component',
            sequence: Number(line.sequence),
            demand: exact(Number(line.productQty) * (1 + Number(line.lossPercent ?? 0) / 100) * factor),
          })
        }
        const finishedMoveId = `${String(production.id)}:finished`
        await stockFunctions.addMove!.handler(tx, {
          id: finishedMoveId,
          name: `${String(production.name)} · finished product`,
          pickingId: outputPickingId,
          productId: production.productId,
          productUomId: production.productUomId,
          productUomQty: production.productQty,
          origin: String(production.name),
        })
        await tx.db.insertIfAbsent('manufacturing.ProductionMove', {
          id: `${String(production.id)}:move:finished`,
          productionId: production.id,
          moveId: finishedMoveId,
          kind: 'finished',
          sequence: 0,
        })
        for (const [index, byproduct] of byproducts.entries()) {
          const moveId = `${String(production.id)}:byproduct:${String(byproduct.id)}`
          await stockFunctions.addMove!.handler(tx, {
            id: moveId,
            name: `${String(production.name)} · by-product ${index + 1}`,
            pickingId: outputPickingId,
            productId: byproduct.productId,
            productUomId: byproduct.productUomId,
            productUomQty: quantityText(Number(byproduct.productQty) * factor),
            origin: String(production.name),
          })
          await tx.db.insertIfAbsent('manufacturing.ProductionMove', {
            id: `${String(production.id)}:move:byproduct:${String(byproduct.id)}`,
            productionId: production.id,
            moveId,
            kind: 'byproduct',
            sequence: Number(byproduct.sequence),
          })
        }
        const operatorFor = await operatorPicker(tx)
        const centers = new Map(
          (await ours(tx, 'manufacturing.WorkCenter')).map((center) => [String(center.id), center]),
        )
        for (const [index, operation] of operations.entries())
          await tx.db.insertIfAbsent('manufacturing.WorkOrder', {
            id: `${String(production.id)}:work:${String(operation.id)}`,
            productionId: production.id,
            operationId: operation.id,
            workCenterId: operation.workCenterId,
            name: operation.name,
            sequence: operation.sequence,
            state: index === 0 ? 'ready' : 'pending',
            durationExpected:
              operation.timeMode === 'quantity'
                ? Math.round(Number(operation.durationExpected) * factor)
                : operation.durationExpected,
            durationActual: 0,
            operatorId: operatorFor(centers.get(String(operation.workCenterId))),
            startedAt: null,
            finishedAt: null,
            version: 1,
          })
        await stockFunctions.confirmPicking!.handler(tx, { id: rawPickingId })
        await stockFunctions.confirmPicking!.handler(tx, { id: outputPickingId })
      })
      // Outside the transaction on purpose: `assignPicking` reserves through
      // `reserveMove`, which opens a transaction of its own, and the framework
      // has no re-entrancy guard.
      return {
        ok: true,
        id: production.id,
        version: Number(args.version) + 1,
        shortages: await shortagesOf(ctx, rawPickingId),
      }
    },
  }),

  startProduction: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:manufacturing.Production', 'write:manufacturing.Production'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'in_progress') return { ok: true, id: row.id, version: row.version }
      const changed = await transition(
        ctx,
        'manufacturing.Production',
        row,
        Number(args.version),
        'confirmed',
        {
          state: 'in_progress',
          startedAt: now(),
        },
      )
      return changed
        ? { ok: true, id: row.id, version: Number(args.version) + 1 }
        : invalid(issue('version', 'manufacturing.error.version'))
    },
  }),

  /**
   * What each component of an order needs and has used so far. `need` is the demand recorded at
   * confirmation; `consumed` adds up the recorded uses, each a done transfer of its own.
   */
  getConsumption: defineFn({
    input: { id: 'id' },
    output: { components: 'json' },
    effects: ['read:manufacturing.Production', 'read:manufacturing.ProductionMove', 'read:stock.Move'],
    agent: true,
    handler: async (ctx, args) => ({ components: await consumptionOf(ctx, String(args.id)) }),
  }),

  /**
   * Record what the floor has used, as totals per component. Only the increase moves: it leaves
   * the source for the production location in one done transfer, oldest-expiring lots first, and
   * the order's own component demand shrinks by as much. A total below what is already recorded
   * is refused (returning the excess is its own command), a BOM set to `strict` refuses using more
   * than it needs, and stock short of any increase refuses the whole record.
   */
  consumeProduction: defineFn({
    /**
     * `confirmOveruse` lets a `warning` BOM record past its need; who confirmed is kept on the
     * record. Without it such a record is refused with `consumeWarning`.
     */
    input: { id: 'id', components: 'json', confirmOveruse: 'bool?' },
    output: { ok: 'bool', id: 'id?', pickingId: 'id?', overused: 'json?', errors: 'json?' },
    effects: consumeEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (!['confirmed', 'in_progress'].includes(String(row.state)) || !row.rawPickingId)
        return invalid(issue('state', 'manufacturing.error.state'))
      const bom = (await ours(ctx, 'manufacturing.Bom', { id: row.bomId }))[0]
      const strict = bom?.consumption === 'strict'
      const warning = bom?.consumption === 'warning' && args.confirmOveruse !== true
      let confirmed = false
      const current = new Map(
        (await consumptionOf(ctx, String(row.id))).map((entry) => [entry.productId, entry]),
      )
      const nameOf = async (productId: string) => {
        const product = (await ctx.db.select('product.Product', { id: productId }))[0]
        const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
        return String(template?.name ?? product?.defaultCode ?? productId)
      }
      const errors: Array<{ field: string; code: string; params?: Row }> = []
      const increases: Array<{ entry: ConsumptionEntry; delta: number }> = []
      for (const input of Array.isArray(args.components) ? (args.components as Row[]) : []) {
        const entry = current.get(String(input.productId))
        const total = Number(input.consumed)
        if (!entry || !Number.isFinite(total) || total < 0) {
          errors.push(issue('components', 'manufacturing.error.invalid'))
          continue
        }
        const delta = total - Number(entry.consumed)
        const params = { product: await nameOf(entry.productId), consumed: entry.consumed, need: entry.need }
        if (delta < -1e-9)
          errors.push({ field: 'components', code: 'manufacturing.error.consumeDecrease', params })
        else if (strict && total > Number(entry.need) + 1e-9)
          errors.push({ field: 'components', code: 'manufacturing.error.consumeStrict', params })
        else if (delta > 1e-9 && warning && total > Number(entry.need) + 1e-9)
          errors.push({ field: 'components', code: 'manufacturing.error.consumeWarning', params })
        else if (delta > 1e-9) {
          if (bom?.consumption === 'warning' && total > Number(entry.need) + 1e-9) confirmed = true
          increases.push({ entry, delta })
        }
      }
      if (errors.length) return { ok: false, errors }
      if (!increases.length) return { ok: true, id: row.id, pickingId: null, overused: [] }

      // Stock free at the source and below it, plus what this order already holds there.
      const source = (await ours(ctx, 'stock.Location', { id: row.sourceLocationId }))[0]
      const under = new Set(
        (await ours(ctx, 'stock.Location'))
          .filter(
            (location) =>
              location.id === source?.id ||
              (source &&
                String(location.parentPath).startsWith(String(source.parentPath)) &&
                location.id !== source.id),
          )
          .map((location) => String(location.id)),
      )
      for (const { entry, delta } of increases) {
        const quants = (await ours(ctx, 'stock.Quant', { productId: entry.productId })).filter((quant) =>
          under.has(String(quant.locationId)),
        )
        const free = quants.reduce(
          (sum, quant) => sum + Number(quant.quantity) - Number(quant.reservedQuantity),
          0,
        )
        const held = entry.moveId
          ? (await ours(ctx, 'stock.MoveLine', { moveId: entry.moveId }))
              .filter((line) => !line.picked)
              .reduce((sum, line) => sum + Number(line.quantity), 0)
          : 0
        if (free + held + 1e-9 < delta)
          errors.push({
            field: 'components',
            code: 'manufacturing.error.consumeShort',
            params: { product: await nameOf(entry.productId), available: exact(Math.max(0, free + held)) },
          })
      }
      if (errors.length) return { ok: false, errors }

      const recorded = (await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })).filter(
        (link) => link.kind === 'consumed',
      )
      // One transfer per record, numbered after the ones before it.
      const pickingId = nextRecordOf(String(row.id), recorded, 'consume')
      // The order lets go of what it holds, so the record takes the oldest-expiring lots first and
      // the order holds again for what it still needs, after.
      const rawPicking = (await ours(ctx, 'stock.Picking', { id: row.rawPickingId }))[0]
      const rawOpen = rawPicking && !['done', 'cancel'].includes(String(rawPicking.state))
      if (rawOpen) await stockFunctions.unreservePicking!.handler(ctx, { id: row.rawPickingId })
      try {
        // Shrink the order's component demand by the part now recorded as used.
        await ctx.tx(async (tx) => {
          for (const { entry, delta } of increases)
            if (entry.moveId && Number(entry.remaining) > 0)
              await resizeMoveDemand(tx, entry.moveId, Math.max(0, Number(entry.remaining) - delta))
        })
      } catch (error) {
        if (error instanceof InventoryRefused) return error.result
        throw error
      }
      const typeId = `${company(ctx)}:manufacturing:components`
      await stockFunctions.createPicking!.handler(ctx, {
        id: pickingId,
        name: `${String(row.name)} · ${new Date().toISOString().slice(0, 10)}`,
        pickingTypeId: typeId,
        locationId: row.sourceLocationId,
        locationDestId: row.productionLocationId,
        moveType: 'one',
        scheduledDate: now(),
      })
      for (const [index, { entry, delta }] of increases.entries()) {
        const moveId = `${pickingId}:${entry.productId}`
        await stockFunctions.addMove!.handler(ctx, {
          id: moveId,
          name: `${String(row.name)} · use ${index + 1}`,
          pickingId,
          productId: entry.productId,
          productUomId: entry.uomId,
          productUomQty: exact(delta),
          origin: String(row.name),
        })
        await ctx.db.insertIfAbsent('manufacturing.ProductionMove', {
          id: `${String(row.id)}:move:consumed:${moveId}`,
          productionId: row.id,
          moveId,
          kind: 'consumed',
          sequence: recorded.length + index + 1,
          confirmedBy: confirmed ? (ctx.actor ?? 'system') : null,
        })
      }
      await stockFunctions.confirmPicking!.handler(ctx, { id: pickingId })
      await stockFunctions.assignPicking!.handler(ctx, { id: pickingId })
      const completed = (await stockFunctions.completePicking!.handler(ctx, {
        id: pickingId,
        createBackorder: false,
      })) as Row
      if (completed?.ok === false) return completed
      const stillOpen = (await ours(ctx, 'stock.Picking', { id: row.rawPickingId }))[0]
      if (stillOpen && !['done', 'cancel'].includes(String(stillOpen.state)))
        await stockFunctions.assignPicking!.handler(ctx, { id: row.rawPickingId })
      if (row.state === 'confirmed')
        await ctx.db.compareAndSet(
          'manufacturing.Production',
          { id: row.id },
          { state: 'confirmed' },
          { state: 'in_progress', startedAt: row.startedAt ?? now(), version: Number(row.version) + 1 },
        )
      const after = await consumptionOf(ctx, String(row.id))
      return {
        ok: true,
        id: row.id,
        pickingId,
        overused: after
          .filter((entry) => Number(entry.consumed) > Number(entry.need) + 1e-9)
          .map((entry) => ({ productId: entry.productId, need: entry.need, consumed: entry.consumed })),
      }
    },
  }),

  /**
   * Book finished goods as they are made: each record is one done receipt from the production
   * location and, for a product tracked by lot, one lot named after the day (`YYMMDD`, then `-2`,
   * `-3` when taken) unless named. The planned output shrinks by as much, so closing books only
   * what was not recorded.
   */
  recordOutput: defineFn({
    input: { id: 'id', quantity: 'decimal', lotName: 'text?', weight: 'text?' },
    output: { ok: 'bool', id: 'id?', pickingId: 'id?', lotId: 'id?', lotName: 'text?', errors: 'json?' },
    effects: [
      ...outputEffects,
      ...costEffects,
      'write:stock.Move',
      'read:manufacturing.Bom',
      'write:manufacturing.QualityCheck',
      'read:manufacturing.QualityTemplate',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (!['confirmed', 'in_progress'].includes(String(row.state)) || !row.outputPickingId)
        return invalid(issue('state', 'manufacturing.error.state'))
      const quantity = Number(args.quantity)
      if (!(quantity > 0) || !Number.isFinite(quantity))
        return invalid(issue('quantity', 'manufacturing.error.invalid'))
      const product = (await ctx.db.select('product.Product', { id: row.productId }))[0]
      const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
      const tracking = String(template?.tracking ?? 'none')
      if (tracking === 'serial') return invalid(issue('quantity', 'manufacturing.error.invalid'))
      // A BOM that knows what a unit weighs has each batch weighed within its tolerance.
      const bom = (await ours(ctx, 'manufacturing.Bom', { id: row.bomId }))[0]
      let weight: number | null = null
      if (Number(bom?.unitWeight ?? 0) > 0) {
        weight = Number(clean(args.weight) || Number.NaN)
        const expected = quantity * Number(bom!.unitWeight)
        const tolerance = Number(bom!.weightTolerance ?? 0) / 100
        const min = exact(expected * (1 - tolerance))
        const max = exact(expected * (1 + tolerance))
        if (!Number.isFinite(weight) || weight < Number(min) - 1e-9 || weight > Number(max) + 1e-9)
          return {
            ok: false,
            errors: [{ field: 'weight', code: 'manufacturing.error.weightOutOfRange', params: { min, max } }],
          }
      }
      // A lot is checked against its product's template, or the BOM's pH range by default (#1947).
      const qualityTemplate = tracking === 'lot' ? await templateForProduct(ctx, row.productId) : undefined
      const checked =
        tracking === 'lot' && (qualityTemplate != null || (bom?.phMin != null && bom?.phMax != null))
      const links = await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })
      const pickingId = nextRecordOf(String(row.id), links, 'output')
      let lotId: string | null = null
      let lotName: string | null = null
      if (tracking === 'lot') {
        const base = clean(args.lotName) || lotDay(new Date())
        const taken = new Set(
          (await ours(ctx, 'stock.Lot', { productId: row.productId })).map((lot) => String(lot.name)),
        )
        lotName = base
        for (let suffix = 2; taken.has(lotName); suffix++) lotName = `${base}-${String(suffix)}`
        lotId = `${pickingId}:lot`
        const created = (await stockFunctions.createLot!.handler(ctx, {
          id: lotId,
          productId: row.productId,
          name: lotName,
          ref: String(row.name),
          // A BOM with a pH range holds each new lot until its quality check passes.
          ...(checked ? { quarantined: true, reason: 'qualityPending' } : {}),
        })) as Row
        if (created?.ok === false) return created
      }
      // The planned output shrinks by what is now booked.
      const finished = links.find((link) => link.kind === 'finished')
      const planned = finished ? (await ours(ctx, 'stock.Move', { id: finished.moveId }))[0] : null
      if (planned && !['done', 'cancel'].includes(String(planned.state)))
        try {
          await ctx.tx((tx) =>
            resizeMoveDemand(tx, planned.id, Math.max(0, Number(planned.productUomQty) - quantity)),
          )
        } catch (error) {
          if (error instanceof InventoryRefused) return error.result
          throw error
        }
      await stockFunctions.createPicking!.handler(ctx, {
        id: pickingId,
        name: `${String(row.name)} · ${lotName ?? new Date().toISOString().slice(0, 10)}`,
        pickingTypeId: `${company(ctx)}:manufacturing:outputs`,
        locationId: row.productionLocationId,
        locationDestId: row.destinationLocationId,
        moveType: 'direct',
        scheduledDate: now(),
      })
      const moveId = `${pickingId}:${String(row.productId)}`
      await stockFunctions.addMove!.handler(ctx, {
        id: moveId,
        name: `${String(row.name)} · output`,
        pickingId,
        productId: row.productId,
        productUomId: row.productUomId,
        productUomQty: exact(quantity),
        origin: String(row.name),
      })
      // Each batch enters stock at the provisional cost of the moment it is recorded.
      await ctx.db.update('stock.Move', { id: moveId }, { priceUnit: await provisionalCost(ctx, row) })
      await ctx.db.insertIfAbsent('manufacturing.ProductionMove', {
        id: `${String(row.id)}:move:output:${moveId}`,
        productionId: row.id,
        moveId,
        kind: 'output',
        sequence: links.length + 1,
        weight: weight == null ? null : exact(weight),
      })
      if (checked && lotId)
        await ctx.db.insertIfAbsent('manufacturing.QualityCheck', {
          id: `${lotId}:quality`,
          productionId: row.id,
          lotId,
          moveId,
          state: 'pending',
          templateId: qualityTemplate?.id ?? null,
        })
      await stockFunctions.confirmPicking!.handler(ctx, { id: pickingId })
      const line = (await stockFunctions.saveMoveLine!.handler(ctx, {
        id: `${moveId}:line`,
        moveId,
        quantity: exact(quantity),
        lotId,
        picked: true,
      })) as Row
      if (line?.ok === false) return line
      const completed = (await stockFunctions.completePicking!.handler(ctx, {
        id: pickingId,
        createBackorder: false,
      })) as Row
      if (completed?.ok === false) return completed
      const produced = exact(Number(row.quantityProduced ?? 0) + quantity)
      await ctx.db.update(
        'manufacturing.Production',
        { id: row.id },
        {
          quantityProduced: produced,
          ...(row.state === 'confirmed' ? { state: 'in_progress', startedAt: row.startedAt ?? now() } : {}),
          version: Number(row.version) + 1,
        },
      )
      return { ok: true, id: row.id, pickingId, lotId, lotName }
    },
  }),

  /**
   * Give unused components back: each comes back from the production location to the order's
   * source at what it was taken for this order, and what the order used goes down. More than was
   * used, net of what came back, is refused with `returnTooMuch`.
   */
  returnComponents: defineFn({
    input: { id: 'id', components: 'json' },
    output: { ok: 'bool', id: 'id?', pickingId: 'id?', errors: 'json?' },
    effects: [
      ...consumeEffects,
      ...outputEffects,
      'write:stock.Move',
      'read:stock.MoveLine',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (!['confirmed', 'in_progress'].includes(String(row.state)))
        return invalid(issue('state', 'manufacturing.error.state'))
      const current = new Map(
        (await consumptionOf(ctx, String(row.id))).map((entry) => [entry.productId, entry]),
      )
      const scale = await scaleFor(ctx)
      const links = await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })
      const errors: Array<{ field: string; code: string; params?: Row }> = []
      const lines: Array<{ productId: unknown; uomId: unknown; quantity: number; priceUnit: string }> = []
      for (const input of Array.isArray(args.components) ? (args.components as Row[]) : []) {
        const entry = current.get(String(input.productId))
        const quantity = Number(input.quantity)
        if (!entry || !Number.isFinite(quantity) || quantity <= 0) {
          errors.push(issue('components', 'manufacturing.error.invalid'))
          continue
        }
        if (quantity > Number(entry.consumed) + 1e-9) {
          errors.push({
            field: 'components',
            code: 'manufacturing.error.returnTooMuch',
            params: { held: entry.consumed },
          })
          continue
        }
        // What this order was charged per unit of the component, over everything it took.
        let value = 0n
        let taken = 0n
        for (const link of links)
          if (link.kind === 'consumed' || link.kind === 'component')
            for (const line of await ours(ctx, 'stock.MoveLine', { moveId: link.moveId })) {
              const move = (await ours(ctx, 'stock.Move', { id: line.moveId }))[0]
              if (move?.productId !== entry.productId || line.value == null) continue
              value += moneyMinor(line.value, scale)
              taken += units(line.quantity)
            }
        lines.push({
          productId: entry.productId,
          uomId: entry.uomId,
          quantity,
          priceUnit: minorText(taken > 0n ? share(value, UNIT, taken) : 0n, scale),
        })
      }
      if (errors.length) return { ok: false, errors }
      if (!lines.length) return invalid(issue('components', 'manufacturing.error.invalid'))
      return bookTransfer(ctx, row, 'return', row.productionLocationId, row.sourceLocationId, lines, {
        kind: 'returned',
      })
    },
  }),

  /**
   * Scrap the order's product or one of its components, with the reason why: out of the order's
   * destination (product) or source (component) to the scrap location, valued at average cost.
   */
  scrapProduction: defineFn({
    input: { id: 'id', productId: 'id', quantity: 'text', reason: 'text?' },
    output: { ok: 'bool', id: 'id?', pickingId: 'id?', errors: 'json?' },
    effects: [
      ...consumeEffects,
      ...outputEffects,
      ...effectsOf(stockFunctions.saveLocation),
      'write:stock.Move',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (!['confirmed', 'in_progress'].includes(String(row.state)))
        return invalid(issue('state', 'manufacturing.error.state'))
      const reason = clean(args.reason)
      if (!reason) return invalid(issue('reason', 'manufacturing.error.reasonRequired'))
      const quantity = Number(args.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0)
        return invalid(issue('quantity', 'manufacturing.error.invalid'))
      const component = (await consumptionOf(ctx, String(row.id))).find(
        (entry) => entry.productId === args.productId,
      )
      const finished = args.productId === row.productId
      if (!component && !finished) return invalid(issue('productId', 'manufacturing.error.scrapProduct'))
      const from = finished ? row.destinationLocationId : row.sourceLocationId
      const result = await bookTransfer(
        ctx,
        row,
        'scrap',
        from,
        await scrapLocationOf(ctx),
        [{ productId: args.productId, uomId: finished ? row.productUomId : component!.uomId, quantity }],
        { kind: 'scrapped', reason },
      )
      return result
    },
  }),

  cancelProduction: defineFn({
    /** The backend asks for a reason; the channel API keeps cancelling without one. */
    input: { id: 'id', version: 'int', reason: 'text?' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.Production',
      'write:manufacturing.Production',
      'read:manufacturing.WorkOrder',
      'write:manufacturing.WorkOrder',
      ...effectsOf(stockFunctions.cancelPicking),
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'cancelled') return { ok: true, id: row.id, version: row.version }
      if (row.state === 'done') return invalid(issue('state', 'manufacturing.error.state'))
      // Once output is booked, the order has stock history to account for; it closes, not cancels.
      if (Number(row.quantityProduced ?? 0) > 0) return invalid(issue('state', 'manufacturing.error.state'))
      if (Number(row.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      if (row.rawPickingId) await stockFunctions.cancelPicking!.handler(ctx, { id: row.rawPickingId })
      if (row.outputPickingId) await stockFunctions.cancelPicking!.handler(ctx, { id: row.outputPickingId })
      for (const work of await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.id }))
        if (work.state !== 'done')
          await ctx.db.update('manufacturing.WorkOrder', { id: work.id }, { state: 'cancelled' })
      const changed = await transition(
        ctx,
        'manufacturing.Production',
        row,
        Number(args.version),
        ['draft', 'confirmed', 'in_progress'],
        { state: 'cancelled', cancelReason: clean(args.reason) || null },
      )
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),

  /**
   * Consume the components and book the outputs.
   *
   * There is no transaction around this, and there cannot be one: every stock
   * command it calls — `assignPicking` through `reserveMove`, `saveMoveLine`,
   * `completePicking` — opens a transaction of its own, and the adapter has no
   * re-entrancy guard, so an enclosing one deadlocks rather than protecting
   * anything. Do not add one without first making those commands compose.
   *
   * What stands in for it is `to_close` plus the picking states. The order is
   * moved to `to_close` before any stock is touched, and every step afterwards
   * asks whether it has already happened, so a completion interrupted between
   * consuming the components and booking the outputs finishes correctly when it
   * is called again. That is a real property and is tested; what it is not is
   * automatic, so an interrupted order sits in `to_close` with its components
   * gone until somebody completes it again.
   */
  completeProduction: defineFn({
    /**
     * With `rest`, an order whose output was recorded closes: components nobody recorded are taken
     * as the BOM asks for what was made (backflush), what was not made is either a new confirmed
     * order (`backorder`) or closed short (`close`). Without it, as before, one call books the whole
     * output and consumption at once.
     */
    input: { id: 'id', version: 'int', producedQuantity: 'decimal?', outputs: 'json?', rest: 'text?' },
    output: { ok: 'bool', id: 'id?', version: 'int?', backorderId: 'id?', errors: 'json?' },
    effects: [
      ...consumeEffects,
      ...confirmEffects,
      'read:stock.Location',
      'read:uom.Unit',
      ...effectsOf(stockFunctions.cancelPicking),
      ...costEffects,
      ...outputEffects,
      ...settleEffects,
      'write:stock.Move',
      'read:manufacturing.Production',
      'write:manufacturing.Production',
      'read:manufacturing.ProductionMove',
      'read:manufacturing.WorkOrder',
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:stock.Lot',
      'read:product.Product',
      'read:product.Template',
      ...effectsOf(stockFunctions.assignPicking, stockFunctions.saveMoveLine, stockFunctions.completePicking),
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'done') return { ok: true, id: row.id, version: row.version }
      if (!['confirmed', 'in_progress', 'to_close'].includes(String(row.state)))
        return invalid(issue('state', 'manufacturing.error.state'))
      if (Number(row.version) !== Number(args.version))
        return invalid(issue('version', 'manufacturing.error.version'))
      const workOrders = await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.id })
      if (args.rest != null) return closeRecorded(ctx, row, workOrders, String(args.rest))
      // Booking the whole plan at once would book recorded output twice.
      if (Number(row.quantityProduced ?? 0) > 0) return invalid(issue('rest', 'manufacturing.error.invalid'))
      if (workOrders.some((work) => work.state !== 'done'))
        return invalid(issue('workOrders', 'manufacturing.error.state'))
      const produced = Number(args.producedQuantity ?? row.productQty)
      if (!(produced > 0)) return invalid(issue('producedQuantity', 'manufacturing.error.invalid'))
      if (!row.rawPickingId || !row.outputPickingId)
        return invalid(issue('state', 'manufacturing.error.state'))
      const rawPicking = (await ours(ctx, 'stock.Picking', { id: row.rawPickingId }))[0]
      const outputPicking = (await ours(ctx, 'stock.Picking', { id: row.outputPickingId }))[0]
      if (!rawPicking || !outputPicking) return invalid(issue('state', 'manufacturing.error.state'))
      // Recorded use shrinks the component moves, and using all of them cancels the transfer.
      const rawOpen = !['done', 'cancel'].includes(String(rawPicking.state))
      if (rawOpen) await stockFunctions.assignPicking!.handler(ctx, { id: row.rawPickingId })
      const rawMoves = (await ours(ctx, 'stock.Move', { pickingId: row.rawPickingId })).filter(
        (move) => move.state !== 'cancel',
      )
      for (const move of rawMoves) {
        const allocated = (await ours(ctx, 'stock.MoveLine', { moveId: move.id })).reduce(
          (sum, line) => sum + Number(line.quantity),
          0,
        )
        if (allocated + 1e-9 < Number(move.productUomQty))
          return invalid(issue('components', 'manufacturing.error.stockShortage'))
      }
      const requested = new Map<string, InputRow[]>()
      if (Array.isArray(args.outputs))
        for (const output of args.outputs as InputRow[]) {
          const held = requested.get(String(output.moveId)) ?? []
          held.push(output)
          requested.set(String(output.moveId), held)
        }
      const outputMoves = await ours(ctx, 'stock.Move', { pickingId: row.outputPickingId })
      const factor = produced / Number(row.productQty)
      for (const move of outputMoves) {
        const product = (await ctx.db.select('product.Product', { id: move.productId }))[0]
        const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
        const tracking = String(template?.tracking ?? 'none')
        const commands = requested.get(String(move.id)) ?? []
        if (tracking !== 'none' && (!commands.length || commands.some((command) => !command.lotId)))
          return invalid(issue('outputs', 'manufacturing.error.invalid'))
        for (const command of commands)
          if (command.lotId) {
            const lot = (await ours(ctx, 'stock.Lot', { id: command.lotId }))[0]
            if (!lot || lot.productId !== move.productId)
              return invalid(issue('outputs', 'manufacturing.error.invalid'))
          }
      }
      let claimedVersion = Number(row.version)
      if (row.state !== 'to_close') {
        const claimed = await transition(
          ctx,
          'manufacturing.Production',
          row,
          Number(args.version),
          ['confirmed', 'in_progress'],
          { state: 'to_close' },
        )
        if (!claimed) return invalid(issue('version', 'manufacturing.error.version'))
        claimedVersion += 1
      }
      if (rawOpen)
        await stockFunctions.completePicking!.handler(ctx, {
          id: row.rawPickingId,
          createBackorder: false,
        })
      if (outputPicking.state !== 'done') {
        for (const move of outputMoves) {
          const commands = requested.get(String(move.id)) ?? [
            { quantity: quantityText(Number(move.productUomQty) * factor), lotId: null },
          ]
          for (const [index, command] of commands.entries()) {
            const saved = (await stockFunctions.saveMoveLine!.handler(ctx, {
              id: `${String(move.id)}:output:${String(command.lotId ?? index + 1)}`,
              moveId: move.id,
              quantity: command.quantity,
              lotId: command.lotId ?? null,
              picked: true,
            })) as Row
            if (saved.ok === false) throw new Error('validated manufacturing output was rejected')
          }
        }
        const finished = (await ours(ctx, 'manufacturing.ProductionMove', { productionId: row.id })).find(
          (link) => link.kind === 'finished',
        )
        if (finished)
          await ctx.db.update(
            'stock.Move',
            { id: finished.moveId },
            { priceUnit: await provisionalCost(ctx, row) },
          )
        await stockFunctions.completePicking!.handler(ctx, {
          id: row.outputPickingId,
          createBackorder: false,
        })
      }
      const current = (await ours(ctx, 'manufacturing.Production', { id: row.id }))[0]!
      const changed = await transition(ctx, 'manufacturing.Production', current, claimedVersion, 'to_close', {
        state: 'done',
        quantityProduced: quantityText(produced),
        finishedAt: now(),
      })
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      return { ok: true, id: row.id, version: claimedVersion + 1 }
    },
  }),

  startWorkOrder: defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      ...LOG_EFFECTS,
      'read:manufacturing.WorkOrder',
      'write:manufacturing.WorkOrder',
      'read:manufacturing.Production',
      'write:manufacturing.Production',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'in_progress') return { ok: true, id: row.id, version: row.version }
      const previous = (
        await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.productionId })
      ).filter((work) => Number(work.sequence) < Number(row.sequence))
      if (previous.some((work) => work.state !== 'done'))
        return invalid(issue('state', 'manufacturing.error.state'))
      const changed = await transition(
        ctx,
        'manufacturing.WorkOrder',
        row,
        Number(args.version),
        ['ready', 'paused'],
        {
          state: 'in_progress',
          startedAt: row.startedAt ?? now(),
          operatorId: row.operatorId ?? ctx.actor ?? null,
        },
      )
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      await openRun(ctx, row, row.operatorId ?? ctx.actor ?? null)
      const production = (await ours(ctx, 'manufacturing.Production', { id: row.productionId }))[0]
      if (production?.state === 'confirmed')
        await ctx.db.update(
          'manufacturing.Production',
          { id: production.id },
          {
            state: 'in_progress',
            startedAt: production.startedAt ?? now(),
            version: Number(production.version) + 1,
          },
        )
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),

  pauseWorkOrder: defineFn({
    /** `minutes` (1–100,000) closes the run with what it took; without it the clock decides. */
    input: { id: 'id', version: 'int', minutes: 'text?' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:manufacturing.WorkOrder', 'write:manufacturing.WorkOrder', ...LOG_EFFECTS],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'paused') return { ok: true, id: row.id, version: row.version }
      const minutes = typedMinutes(args.minutes)
      if (minutes === 'invalid') return invalid(issue('minutes', 'manufacturing.error.minutesInvalid'))
      if (row.state !== 'in_progress') return invalid(issue('state', 'manufacturing.error.state'))
      const total = await closeRun(ctx, row, minutes)
      const changed = await transition(
        ctx,
        'manufacturing.WorkOrder',
        row,
        Number(args.version),
        'in_progress',
        {
          state: 'paused',
          durationActual: total,
          startedAt: null,
        },
      )
      return changed
        ? { ok: true, id: row.id, version: Number(args.version) + 1 }
        : invalid(issue('version', 'manufacturing.error.version'))
    },
  }),

  /**
   * An order's cost per unit: provisional (what batches enter stock at) while it runs, and once
   * done the actual one, what its components were worth when they left over what was made.
   */
  getProductionCost: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      currency: 'text',
      provisional: 'decimal',
      issued: 'decimal',
      produced: 'decimal',
      actual: 'decimal?',
      labour: 'decimal?',
      varianceHeld: 'decimal?',
      varianceSold: 'decimal?',
    },
    effects: costEffects,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.Production', { id: args.id }))[0]
      if (!row) return null
      const scale = await scaleFor(ctx)
      const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
      const issued = await issuedValue(ctx, String(row.id))
      const produced = units(row.quantityProduced ?? 0)
      return {
        id: row.id,
        currency: String(company?.currency ?? 'VND'),
        provisional: await provisionalCost(ctx, row),
        issued: minorText(issued, scale),
        produced: String(row.quantityProduced ?? '0'),
        // Once settled, the actual cost carries the labour the order was charged.
        actual:
          row.state === 'done' && produced > 0n
            ? minorText(share(issued + moneyMinor(row.labourCost ?? 0, scale), UNIT, produced), scale)
            : null,
        labour: row.labourCost ?? null,
        varianceHeld: row.varianceHeld ?? null,
        varianceSold: row.varianceSold ?? null,
      }
    },
  }),

  /** The labour account closing charges work in progress against. */
  saveCostSetting: defineFn({
    input: { labourAccountId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.CostSetting', 'write:manufacturing.CostSetting', 'read:account.Account'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = `${company(ctx)}:manufacturing:cost`
      const labourAccountId = clean(args.labourAccountId) || null
      if (
        labourAccountId &&
        (!ctx.manifest.models['account.Account'] ||
          !(await ctx.db.select('account.Account', { id: labourAccountId })).length)
      )
        return invalid(issue('labourAccountId', 'manufacturing.error.invalid'))
      if ((await ours(ctx, 'manufacturing.CostSetting', { id })).length)
        await ctx.db.update('manufacturing.CostSetting', { id }, { labourAccountId })
      else await ctx.db.insert('manufacturing.CostSetting', { id, labourAccountId })
      return { ok: true, id }
    },
  }),

  /**
   * Components used against the BOM on orders running or done, those used past it first, then by
   * how far; an order closed short is held to what it made.
   */
  consumptionVariance: defineFn({
    input: { productionId: 'id?' },
    effects: [...consumeEffects],
    agent: true,
    handler: async (ctx, args) => {
      const orders = (
        await ours(ctx, 'manufacturing.Production', args.productionId ? { id: args.productionId } : {})
      ).filter((row) => ['in_progress', 'to_close', 'done'].includes(String(row.state)))
      const rows = []
      for (const row of orders) rows.push(...(await varianceOf(ctx, row)))
      return rows.sort(
        (a, b) =>
          Number(b.percent ?? 0) - Number(a.percent ?? 0) ||
          String(a.productionName).localeCompare(String(b.productionName)) ||
          Number(b.difference) - Number(a.difference) ||
          String(a.productId).localeCompare(String(b.productId)),
      )
    },
  }),

  /**
   * Checks a batch's lot: a pH within its BOM's range and a sensory pass release it from
   * quarantine; anything else keeps it there, the reading recorded, to be scrapped from its page.
   */
  checkQuality: defineFn({
    /**
     * `results` are `{criterionId, value}` per criterion of the check's template (#1947); the default
     * check also takes `ph` and `sensory`, as it always has.
     */
    input: { id: 'id', ph: 'text?', sensory: 'text?', results: 'json?', note: 'text?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', failed: 'json?', errors: 'json?' },
    effects: [...new Set([...QUALITY_EFFECTS, ...effectsOf(stockFunctions.saveLot)])],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const check = (await ours(ctx, 'manufacturing.QualityCheck', { id: args.id }))[0]
      if (!check) return invalid(issue('id', 'manufacturing.error.missing'))
      if (check.state !== 'pending') return invalid(issue('id', 'manufacturing.error.qualityChecked'))
      const production = (await ours(ctx, 'manufacturing.Production', { id: check.productionId }))[0]
      const bom = production && (await ours(ctx, 'manufacturing.Bom', { id: production.bomId }))[0]
      const isDefault = !check.templateId
      const criteria = await criteriaOfCheck(ctx, check, bom)
      const posted = new Map<string, string>()
      for (const entry of Array.isArray(args.results) ? (args.results as Row[]) : [])
        posted.set(String(entry?.criterionId), String(entry?.value ?? ''))
      if (isDefault) {
        if (args.ph != null) posted.set('ph', String(args.ph))
        if (args.sensory != null) posted.set('sensory', String(args.sensory))
      }
      const { errors, rows, passed } = evaluate(criteria, posted, isDefault)
      if (errors.length) return { ok: false, errors }
      const lot = (await ours(ctx, 'stock.Lot', { id: check.lotId }))[0]
      if (passed && lot) {
        const released = (await stockFunctions.saveLot!.handler(ctx, {
          id: lot.id,
          productId: lot.productId,
          name: lot.name,
          quarantined: false,
          reason: 'qualityPassed',
        })) as Row
        if (released?.ok === false) return released
      }
      const state = passed ? 'passed' : 'failed'
      const value = (id: string) => rows.find((row) => row.id === id)?.value ?? null
      await ctx.db.update(
        'manufacturing.QualityCheck',
        { id: check.id },
        {
          state,
          ...(isDefault
            ? { ph: value('ph') == null ? null : exact(Number(value('ph'))), sensory: value('sensory') }
            : {}),
          note: clean(args.note) || null,
          checkedBy: ctx.actor ?? null,
          checkedAt: now(),
        },
      )
      for (const [index, { id: criterionId, ...row }] of rows.entries())
        await ctx.db.insertIfAbsent('manufacturing.QualityResult', {
          id: `${String(check.id)}:result:${index + 1}`,
          checkId: check.id,
          sequence: index + 1,
          criterionId,
          ...row,
        })
      const failed = rows.filter((row) => row.passed === false).map((row) => row.name)
      return { ok: true, id: check.id, state, failed }
    },
  }),

  /** The quality checks of an order or of a lot, newest batch first. */
  listQualityChecks: defineFn({
    input: { productionId: 'id?', lotId: 'id?' },
    effects: QUALITY_EFFECTS.filter((effect) => effect.startsWith('read:')),
    agent: true,
    handler: async (ctx, args) => {
      const where: InputRow = {}
      if (args.productionId) where.productionId = args.productionId
      if (args.lotId) where.lotId = args.lotId
      const [checks, lots, boms, productions, results] = await Promise.all([
        ours(ctx, 'manufacturing.QualityCheck', where),
        ours(ctx, 'stock.Lot'),
        ours(ctx, 'manufacturing.Bom'),
        ours(ctx, 'manufacturing.Production'),
        ours(ctx, 'manufacturing.QualityResult'),
      ])
      const read = await Promise.all(
        checks.map(async (check) => {
          const production = productions.find((row) => row.id === check.productionId)
          const bom = boms.find((row) => row.id === production?.bomId)
          return {
            ...check,
            productionName: production?.name ?? null,
            lotName: lots.find((lot) => lot.id === check.lotId)?.name ?? null,
            phMin: bom?.phMin ?? null,
            phMax: bom?.phMax ?? null,
            // What a pending check asks for; a checked one keeps what it was checked against.
            criteria: check.state === 'pending' ? await criteriaOfCheck(ctx, check, bom) : [],
            results: results
              .filter((row) => row.checkId === check.id)
              .sort((a, b) => Number(a.sequence) - Number(b.sequence)),
          }
        }),
      )
      return read.sort((a, b) => String(b.lotName).localeCompare(String(a.lotName)))
    },
  }),

  /**
   * Where a lot came from and went through production: the orders that made it and the lots they
   * used, the orders that used it and the lots they made, and the customers who received the lot or
   * goods made from it, two levels of production down. Only transfers to a customer location count
   * as received; issues to production do not.
   */
  traceLot: defineFn({
    input: { lotId: 'id' },
    effects: TRACE_EFFECTS,
    agent: true,
    handler: async (ctx, args) => {
      const [links, productions, lots, locations, checks] = await Promise.all([
        ours(ctx, 'manufacturing.ProductionMove'),
        ours(ctx, 'manufacturing.Production'),
        ours(ctx, 'stock.Lot'),
        ours(ctx, 'stock.Location'),
        ours(ctx, 'manufacturing.QualityCheck', { lotId: args.lotId }),
      ])
      const linesOf = async (lotId: string) =>
        (await ours(ctx, 'stock.MoveLine', { lotId })).filter((line) => Number(line.quantity) > 0)
      const doneMove = async (moveId: unknown) => {
        const move = (await ours(ctx, 'stock.Move', { id: moveId }))[0]
        return move?.state === 'done' ? move : null
      }
      const linkOf = new Map(links.map((link) => [String(link.moveId), link]))
      const lotName = (id: unknown) => String(lots.find((lot) => lot.id === id)?.name ?? id)
      const orderName = (id: unknown) => String(productions.find((row) => row.id === id)?.name ?? id)
      // The orders whose finished lines carry a lot, and those whose recorded use does.
      const making = (kind: string) => ['output', 'finished'].includes(kind)
      const using = (kind: string) => ['consumed', 'component'].includes(kind)
      const ordersOf = async (lotId: string, wanted: (kind: string) => boolean) => {
        const found = new Map<string, number>()
        for (const line of await linesOf(lotId)) {
          const link = linkOf.get(String(line.moveId))
          if (!link || !wanted(String(link.kind)) || !(await doneMove(line.moveId))) continue
          found.set(
            String(link.productionId),
            (found.get(String(link.productionId)) ?? 0) + Number(line.quantity),
          )
        }
        return found
      }
      const lotsOf = async (productionId: string, wanted: (kind: string) => boolean) => {
        const found = new Map<string, Row>()
        for (const link of links.filter(
          (row) => row.productionId === productionId && wanted(String(row.kind)),
        )) {
          if (!(await doneMove(link.moveId))) continue
          for (const line of await ours(ctx, 'stock.MoveLine', { moveId: link.moveId })) {
            if (!line.lotId || !(Number(line.quantity) > 0)) continue
            const kept = found.get(String(line.lotId))
            found.set(String(line.lotId), {
              lotId: line.lotId,
              lotName: lotName(line.lotId),
              productId: line.productId,
              quantity: exact(Number(kept?.quantity ?? 0) + Number(line.quantity)),
            })
          }
        }
        return [...found.values()]
      }
      const madeBy = []
      for (const [productionId] of await ordersOf(String(args.lotId), making))
        madeBy.push({
          productionId,
          productionName: orderName(productionId),
          used: await lotsOf(productionId, using),
        })
      const usedIn = []
      for (const [productionId, quantity] of await ordersOf(String(args.lotId), using))
        usedIn.push({
          productionId,
          productionName: orderName(productionId),
          quantity: exact(quantity),
          made: await lotsOf(productionId, making),
        })
      // The lot itself, what was made from it, and what was made from that.
      const reach: Array<{ lotId: string; level: number }> = [{ lotId: String(args.lotId), level: 0 }]
      for (let index = 0; index < reach.length; index++) {
        const { lotId, level } = reach[index]!
        if (level >= 2) continue
        for (const [productionId] of await ordersOf(lotId, using))
          for (const made of await lotsOf(productionId, making))
            if (!reach.some((entry) => entry.lotId === made.lotId))
              reach.push({ lotId: String(made.lotId), level: level + 1 })
      }
      const customer = new Set(
        locations.filter((row) => row.usage === 'customer').map((row) => String(row.id)),
      )
      const received = []
      for (const { lotId, level } of reach)
        for (const line of await linesOf(lotId)) {
          if (!customer.has(String(line.locationDestId)) || !(await doneMove(line.moveId))) continue
          const picking = line.pickingId
            ? (await ours(ctx, 'stock.Picking', { id: line.pickingId }))[0]
            : undefined
          const partner = picking?.partnerId
            ? (await ctx.db.select('partner.Partner', { id: picking.partnerId }))[0]
            : undefined
          received.push({
            lotId,
            lotName: lotName(lotId),
            level,
            productId: line.productId,
            quantity: exact(Number(line.quantity)),
            pickingId: picking?.id ?? null,
            pickingName: picking?.name ?? null,
            date: picking?.dateDone ?? null,
            partnerId: picking?.partnerId ?? null,
            partnerName: partner?.name ?? null,
          })
        }
      return {
        checks: checks.map((check) => ({ ...check, productionName: orderName(check.productionId) })),
        madeBy,
        usedIn,
        received,
      }
    },
  }),

  /** The floor's work: open operations first, as a worker takes them, then the finished ones. */
  listWorkOrders: defineFn({
    input: { state: 'text?', workCenterId: 'id?', operatorId: 'id?' },
    effects: [
      'read:manufacturing.WorkOrder',
      'read:manufacturing.Production',
      'read:manufacturing.WorkCenter',
      'read:manufacturing.OperatorSkill',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const where: InputRow = {}
      if (args.state) where.state = args.state
      if (args.workCenterId) where.workCenterId = args.workCenterId
      if (args.operatorId) where.operatorId = args.operatorId
      const [works, productions, centers, skills] = await Promise.all([
        ours(ctx, 'manufacturing.WorkOrder', where),
        ours(ctx, 'manufacturing.Production'),
        ours(ctx, 'manufacturing.WorkCenter'),
        ours(ctx, 'manufacturing.OperatorSkill'),
      ])
      const orders = new Map(productions.map((row) => [String(row.id), row]))
      const centerOf = new Map(centers.map((row) => [String(row.id), row]))
      const names = new Map(skills.map((row) => [String(row.userId), String(row.name)]))
      const rank = ['in_progress', 'paused', 'ready', 'pending', 'done', 'cancelled']
      return works
        .filter((work) => {
          const order = orders.get(String(work.productionId))
          return order && order.state !== 'draft' && (order.state !== 'cancelled' || work.state === 'done')
        })
        .map((work): Row => {
          const order = orders.get(String(work.productionId))!
          return {
            ...work,
            productionName: order.name,
            productionState: order.state,
            priority: order.priority ?? 0,
            scheduledStart: order.scheduledStart,
            workCenterName: centerOf.get(String(work.workCenterId))?.name ?? null,
            skill: centerOf.get(String(work.workCenterId))?.skill ?? null,
            operatorName: work.operatorId
              ? (names.get(String(work.operatorId)) ?? String(work.operatorId))
              : null,
          }
        })
        .sort(
          (a, b) =>
            rank.indexOf(String(a.state)) - rank.indexOf(String(b.state)) ||
            Number(b.priority) - Number(a.priority) ||
            String(a.scheduledStart ?? '').localeCompare(String(b.scheduledStart ?? '')) ||
            String(a.productionName).localeCompare(String(b.productionName)) ||
            Number(a.sequence) - Number(b.sequence),
        )
    },
  }),

  /** One operation with who may be given it: people skilled enough for its center. */
  getWorkOrder: defineFn({
    input: { id: 'id' },
    effects: [
      'read:manufacturing.WorkOrder',
      'read:manufacturing.Production',
      'read:manufacturing.WorkCenter',
      'read:manufacturing.OperatorSkill',
      'read:manufacturing.WorkTimeLog',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const work = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!work) return null
      const order = (await ours(ctx, 'manufacturing.Production', { id: work.productionId }))[0]
      const center = (await ours(ctx, 'manufacturing.WorkCenter', { id: work.workCenterId }))[0]
      const skills = await ours(ctx, 'manufacturing.OperatorSkill')
      const names = new Map(skills.map((row) => [String(row.userId), String(row.name)]))
      const operators = center?.skill
        ? skills
            .filter((row) => row.skill === center.skill && Number(row.level) >= OPERATOR_LEVEL)
            .map((row) => ({ id: row.userId, name: row.name, level: row.level }))
        : [...names].map(([id, name]) => ({ id, name, level: null }))
      return {
        ...work,
        productionName: order?.name ?? null,
        productionState: order?.state ?? null,
        workCenterName: center?.name ?? null,
        skill: center?.skill ?? null,
        operatorName: work.operatorId
          ? (names.get(String(work.operatorId)) ?? String(work.operatorId))
          : null,
        operators: operators.sort((a, b) => String(a.name).localeCompare(String(b.name))),
        runs: (await ours(ctx, 'manufacturing.WorkTimeLog', { workOrderId: work.id }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
          .map((run) => ({
            ...run,
            operatorName: run.operatorId ? (names.get(String(run.operatorId)) ?? run.operatorId) : null,
          })),
        // The last operation books the finished goods from its own page.
        last: !(await ours(ctx, 'manufacturing.WorkOrder', { productionId: work.productionId })).some(
          (other) => Number(other.sequence) > Number(work.sequence),
        ),
        productQty: order?.productQty ?? null,
        quantityProduced: order?.quantityProduced ?? null,
      }
    },
  }),

  /** Give an open operation to someone skilled enough for its center, or take it back (`null`). */
  assignWorkOrder: defineFn({
    /**
     * A running operation changes hands between runs: the current run closes with `minutes` (or
     * the clock) and the new operator's opens.
     */
    input: { id: 'id', version: 'int', operatorId: 'id?', minutes: 'text?' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.WorkOrder',
      'write:manufacturing.WorkOrder',
      'read:manufacturing.WorkCenter',
      'read:manufacturing.OperatorSkill',
      ...LOG_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (['done', 'cancelled'].includes(String(row.state)))
        return invalid(issue('state', 'manufacturing.error.state'))
      const operatorId = clean(args.operatorId) || null
      const center = (await ours(ctx, 'manufacturing.WorkCenter', { id: row.workCenterId }))[0]
      if (operatorId && !(await skilledFor(ctx, center, operatorId)))
        return invalid(issue('operatorId', 'manufacturing.error.operatorSkill'))
      const handover = await handOver(ctx, row, operatorId, args.minutes)
      if (handover) return handover
      const changed = await ctx.db.compareAndSet(
        'manufacturing.WorkOrder',
        { id: row.id },
        { version: Number(args.version) },
        { operatorId, version: Number(args.version) + 1 },
      )
      if (!('dryRun' in changed) && !changed.matched)
        return invalid(issue('version', 'manufacturing.error.version'))
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),

  /**
   * Take an operation for oneself: what a worker may do without assigning others. A running
   * operation's current run closes with `minutes` and the taker's opens.
   */
  takeWorkOrder: defineFn({
    input: { id: 'id', version: 'int', minutes: 'text?' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:manufacturing.WorkOrder',
      'write:manufacturing.WorkOrder',
      'read:manufacturing.WorkCenter',
      'read:manufacturing.OperatorSkill',
      ...LOG_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (!ctx.actor) return invalid(issue('operatorId', 'manufacturing.error.invalid'))
      if (row.operatorId === ctx.actor) return { ok: true, id: row.id, version: row.version }
      if (['done', 'cancelled'].includes(String(row.state)))
        return invalid(issue('state', 'manufacturing.error.state'))
      const center = (await ours(ctx, 'manufacturing.WorkCenter', { id: row.workCenterId }))[0]
      if (!(await skilledFor(ctx, center, ctx.actor)))
        return invalid(issue('operatorId', 'manufacturing.error.operatorSkill'))
      const handover = await handOver(ctx, row, ctx.actor, args.minutes)
      if (handover) return handover
      const changed = await ctx.db.compareAndSet(
        'manufacturing.WorkOrder',
        { id: row.id },
        { version: Number(args.version) },
        { operatorId: ctx.actor, version: Number(args.version) + 1 },
      )
      if (!('dryRun' in changed) && !changed.matched)
        return invalid(issue('version', 'manufacturing.error.version'))
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),

  /** Record how well someone does a skill; level 0 keeps the person on record without the skill. */
  saveOperatorSkill: defineFn({
    input: { userId: 'id', name: 'text', skill: 'text', level: 'int', lead: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:manufacturing.OperatorSkill', 'write:manufacturing.OperatorSkill'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const level = Number(args.level)
      if (!Number.isInteger(level) || level < 0 || level > 5)
        return invalid(issue('level', 'manufacturing.error.invalid'))
      const skill = clean(args.skill)
      const name = clean(args.name)
      if (!skill) return invalid(issue('skill', 'manufacturing.error.invalid'))
      const id = `${company(ctx)}:skill:${String(args.userId)}:${skill}`
      const existing = (await ours(ctx, 'manufacturing.OperatorSkill', { id }))[0]
      if (level === 0 && !existing) return { ok: true, id }
      if (!name) return invalid(issue('name', 'manufacturing.error.invalid'))
      const values = { name, level, lead: Boolean(args.lead) }
      if (existing) await ctx.db.update('manufacturing.OperatorSkill', { id }, values)
      else await ctx.db.insert('manufacturing.OperatorSkill', { id, userId: args.userId, skill, ...values })
      return { ok: true, id }
    },
  }),

  /**
   * The people a skill may be recorded for (#1931): active members of the company who may run the
   * shop floor, by their own name. Without a permission catalogue every member counts.
   */
  listOperatorCandidates: defineFn({
    input: {},
    output: { id: 'id', name: 'text' },
    effects: ['read:user.User', 'read:user.Membership', ...AUTHORIZATION_READ_EFFECTS],
    agent: true,
    handler: async (ctx) => operatorCandidates(ctx),
  }),

  /**
   * The skills grid saved whole (#1931): every row is a person, a skill some work center needs,
   * a level 0–5 and the lead flag; `removed` names saved rows to delete. The name comes from the
   * user, never from the form. One refusal saves nothing.
   */
  saveOperatorSkills: defineFn({
    input: { rows: 'json', removed: 'json?' },
    output: { ok: 'bool', errors: 'json?' },
    effects: [
      'read:manufacturing.OperatorSkill',
      'write:manufacturing.OperatorSkill',
      'read:manufacturing.WorkCenter',
      'read:user.User',
      'read:user.Membership',
      ...AUTHORIZATION_READ_EFFECTS,
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const rows = Array.isArray(args.rows) ? (args.rows as Row[]) : null
      const removed =
        args.removed == null ? [] : Array.isArray(args.removed) ? args.removed.map(String) : null
      if (!rows || !removed || rows.length + removed.length > 500)
        return invalid(issue('rows', 'manufacturing.error.invalid'))
      const people = new Map((await operatorCandidates(ctx)).map((person) => [person.id, person.name]))
      const skills = new Set(
        (await ours(ctx, 'manufacturing.WorkCenter'))
          .filter((center) => center.active !== false && clean(center.skill))
          .map((center) => clean(center.skill)),
      )
      const held = new Map(
        (await ours(ctx, 'manufacturing.OperatorSkill')).map((row) => [String(row.id), row]),
      )
      const errors: Array<{ field: string; code: string; params?: Row }> = []
      const seen = new Set<string>()
      const writes: Array<{
        id: string
        userId: string
        skill: string
        name: string
        level: number
        lead: boolean
      }> = []
      for (const [index, row] of rows.entries()) {
        const at = { row: String(index + 1) }
        const userId = clean(row?.userId)
        const skill = clean(row?.skill)
        const level = Number(row?.level)
        const id = `${company(ctx)}:skill:${userId}:${skill}`
        const kept = held.get(id)
        // A person who left keeps the rows already saved for them, never a new one.
        if (!people.has(userId) && !kept)
          errors.push({ ...issue('rows', 'manufacturing.error.skillPerson'), params: at })
        else if (!skills.has(skill) && !kept)
          errors.push({ ...issue('rows', 'manufacturing.error.skillUnknown'), params: at })
        else if (!Number.isInteger(level) || level < 0 || level > 5)
          errors.push({ ...issue('rows', 'manufacturing.error.skillLevel'), params: at })
        else if (seen.has(id))
          errors.push({ ...issue('rows', 'manufacturing.error.skillDuplicate'), params: at })
        else {
          seen.add(id)
          writes.push({
            id,
            userId,
            skill,
            name: people.get(userId) ?? String(kept?.name ?? userId),
            level,
            lead: row?.lead === true || row?.lead === 'true',
          })
        }
      }
      for (const id of removed)
        if (!held.has(id)) errors.push(issue('removed', 'manufacturing.error.missing'))
      if (errors.length) return { ok: false, errors }
      await ctx.tx(async (tx) => {
        const S = tx.table('manufacturing.OperatorSkill')
        for (const id of removed)
          if (!seen.has(id))
            await tx.db.del(deleteFrom(S).where(and(eq(S.id, id), eq(S.companyId, company(tx)))))
        for (const { id, userId, skill, ...values } of writes) {
          const kept = held.get(id)
          if (!kept) await tx.db.insert('manufacturing.OperatorSkill', { id, userId, skill, ...values })
          else if (
            kept.name !== values.name ||
            Number(kept.level) !== values.level ||
            Boolean(kept.lead) !== values.lead
          )
            await tx.db.update('manufacturing.OperatorSkill', { id }, values)
        }
      })
      return { ok: true }
    },
  }),

  listOperatorSkills: defineFn({
    input: { skill: 'text?' },
    effects: ['read:manufacturing.OperatorSkill'],
    agent: true,
    handler: async (ctx, args) =>
      ours(ctx, 'manufacturing.OperatorSkill', args.skill ? { skill: args.skill } : {}),
  }),

  finishWorkOrder: defineFn({
    /**
     * `actualMinutes` (1–100,000) replaces the clocked time when given; the floor types what the
     * work took, since a forgotten pause would otherwise count. `note` says what happened.
     */
    input: { id: 'id', version: 'int', actualMinutes: 'text?', note: 'text?', loss: 'text?' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:manufacturing.WorkOrder', 'write:manufacturing.WorkOrder', ...LOG_EFFECTS],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ours(ctx, 'manufacturing.WorkOrder', { id: args.id }))[0]
      if (!row) return invalid(issue('id', 'manufacturing.error.missing'))
      if (row.state === 'done') return { ok: true, id: row.id, version: row.version }
      const minutes = typedMinutes(args.actualMinutes)
      if (minutes === 'invalid') return invalid(issue('actualMinutes', 'manufacturing.error.minutesInvalid'))
      const loss = clean(args.loss) === '' ? null : Number(args.loss)
      if (loss !== null && !(Number.isFinite(loss) && loss >= 0))
        return invalid(issue('loss', 'manufacturing.error.invalid'))
      if (!['in_progress', 'paused'].includes(String(row.state)))
        return invalid(issue('state', 'manufacturing.error.state'))
      // The minutes close the last run; the operation took what all its runs took.
      const total = await closeRun(ctx, row, minutes)
      const changed = await transition(
        ctx,
        'manufacturing.WorkOrder',
        row,
        Number(args.version),
        ['in_progress', 'paused'],
        {
          state: 'done',
          durationActual: total,
          note: clean(args.note) || null,
          loss: loss === null ? null : exact(loss),
          startedAt: null,
          finishedAt: now(),
        },
      )
      if (!changed) return invalid(issue('version', 'manufacturing.error.version'))
      const next = (await ours(ctx, 'manufacturing.WorkOrder', { productionId: row.productionId }))
        .filter((work) => Number(work.sequence) > Number(row.sequence) && work.state === 'pending')
        .sort((a, b) => Number(a.sequence) - Number(b.sequence))[0]
      if (next) await ctx.db.update('manufacturing.WorkOrder', { id: next.id }, { state: 'ready' })
      return { ok: true, id: row.id, version: Number(args.version) + 1 }
    },
  }),
}
