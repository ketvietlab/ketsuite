import { defineFn, deleteFrom, eq, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { minorText } from '../../account/money.ts'
import { civilDate } from '../../company/civil-date.ts'
import { holdsFunction } from '../../product/functions/shared.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { InventoryRefused } from '../inventory-validation.ts'
import { ours } from '../scope.ts'
import { COUNT_REASONS } from '../count-reasons.ts'
import { isStorable, lotKey, mutateQuant, trackingOf } from '../stock-ledger.ts'
import { productUnitId } from '../units.ts'
import {
  primeValuation,
  VALUATION_EFFECTS,
  valueOperation,
  scaleFor,
  moneyMinor,
  share,
  units,
  priced,
} from '../valuation.ts'

type Params = Record<string, unknown>

const refusal = (field: string, key: string, params: Params = {}) => ({
  ok: false,
  errors: [{ field, messageKey: `stock.error.${key}`, params }],
})

class CountRefused extends Error {
  readonly result: ReturnType<typeof refusal>
  constructor(field: string, key: string, params: Params = {}) {
    super(key)
    this.result = refusal(field, key, params)
  }
}

const EPSILON = 0.000001
const MAX_LINES = 200
const OPEN = ['counting', 'review']
const now = () => new Date().toISOString()
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Where a warehouse keeps its goods, and where its count differences come from and go to. */
const stockOf = (warehouseId: unknown) => `${String(warehouseId)}:stock`
const adjustmentOf = (warehouseId: unknown) => `${String(warehouseId)}:adjustment`

const run = async (body: () => Promise<Row>) => {
  try {
    return await body()
  } catch (error) {
    if (error instanceof CountRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}

async function sessionOf(ctx: Ctx, id: unknown) {
  const session = id ? (await ours(ctx, 'stock.CountSession', { id }))[0] : undefined
  if (!session) throw new CountRefused('id', 'countMissing')
  return session
}

const linesOf = async (ctx: Ctx, sessionId: unknown) =>
  (await ours(ctx, 'stock.CountLine', { sessionId })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
  )

/** Moves a session from one state to the next, or refuses when someone moved it first. */
async function claim(ctx: Ctx, session: Row, from: string, to: Row) {
  const changed = await ctx.db.compareAndSet('stock.CountSession', { id: session.id }, { state: from }, to)
  if (!('dryRun' in changed) && !changed.matched) throw new CountRefused('id', 'countChanged')
}

/** Lines may change only while the session is being counted; holding its state keeps a submit out meanwhile. */
async function holdCounting(ctx: Ctx, id: unknown) {
  const session = await sessionOf(ctx, id)
  if (session.state !== 'counting') throw new CountRefused('id', 'countNotCounting')
  await claim(ctx, session, 'counting', { state: 'counting' })
  return session
}

async function holdWarehouse(ctx: Ctx, id: unknown) {
  const warehouse = id ? (await ours(ctx, 'stock.Warehouse', { id }))[0] : undefined
  if (!warehouse || warehouse.active === false) throw new CountRefused('warehouseId', 'countWarehouse')
  const lock = await ctx.db.compareAndSet(
    'stock.Warehouse',
    { id: warehouse.id },
    { active: true },
    { active: true },
  )
  if (!('dryRun' in lock) && !lock.matched) throw new CountRefused('warehouseId', 'countWarehouse')
  return warehouse
}

/** The next count of a warehouse: HN/KK/0002. Callers hold the warehouse, so two cannot take one number. */
async function nextName(ctx: Ctx, warehouse: Row) {
  const prefix = `${String(warehouse.code || 'WH')}/KK/`
  let last = 0
  for (const row of await ours(ctx, 'stock.CountSession', { warehouseId: warehouse.id }))
    if (String(row.name).startsWith(prefix))
      last = Math.max(last, Number(String(row.name).slice(prefix.length)) || 0)
  return `${prefix}${String(last + 1).padStart(4, '0')}`
}

/** A product's name and code, for ordering lines and for naming it in a refusal. */
async function describe(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product
    ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    : undefined
  return {
    code: String(product?.defaultCode ?? ''),
    name: String(template?.name ?? productId),
  }
}

/** The products a partial count is kept to (K62); a full count is kept to none. */
const scopeOf = (session: Row): string[] => {
  const raw = typeof session.productIds === 'string' ? JSON.parse(session.productIds) : session.productIds
  return Array.isArray(raw) ? raw.map(String) : []
}

/** Two counts of one warehouse overlap unless both are partial and share no product. */
const overlaps = (a: string[], b: string[]) => !a.length || !b.length || a.some((id) => b.includes(id))

/** Whether a product may be counted: a stocked product whose template and variant are still active. */
async function countable(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product
    ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    : undefined
  return Boolean(template?.isStorable) && template?.active !== false && product?.active !== false
}

/** The products a new count is kept to, once each, all countable; none for a full count. */
async function chosenProducts(ctx: Ctx, value: unknown) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map((id) => String(id).trim()).filter(Boolean))]
  for (const id of ids)
    if (!(await countable(ctx, id))) throw new CountRefused('productIds', 'countProductsInvalid')
  return ids
}

/** What a location holds now, by product and lot: the book a count is compared with. */
async function holdings(ctx: Ctx, locationId: unknown) {
  return (await ours(ctx, 'stock.Quant', { locationId })).filter(
    (quant) => Math.abs(Number(quant.quantity)) > EPSILON,
  )
}

const bookOf = async (ctx: Ctx, locationId: unknown, productId: unknown, lotId: unknown) =>
  (await ours(ctx, 'stock.Quant', { locationId, productId, lotKey: lotKey(lotId) }))[0]

/**
 * The goods a count starts with (K33): every product and lot the location holds, products by code and a
 * product's lots soonest expiring first.
 */
async function bookLines(ctx: Ctx, locationId: unknown) {
  const rows = await Promise.all(
    (await holdings(ctx, locationId)).map(async (quant) => {
      const lot = quant.lotId ? (await ours(ctx, 'stock.Lot', { id: quant.lotId }))[0] : undefined
      return {
        quant,
        product: await describe(ctx, quant.productId),
        expiry: String(lot?.expirationDate ?? '9999'),
        lotName: String(lot?.name ?? ''),
      }
    }),
  )
  return rows.sort(
    (a, b) =>
      a.product.code.localeCompare(b.product.code) ||
      a.product.name.localeCompare(b.product.name) ||
      String(a.quant.productId).localeCompare(String(b.quant.productId)) ||
      a.expiry.localeCompare(b.expiry) ||
      a.lotName.localeCompare(b.lotName),
  )
}

async function insertLine(ctx: Ctx, session: Row, id: string, values: Row) {
  await ctx.db.insert('stock.CountLine', {
    id,
    sessionId: session.id,
    lotId: null,
    counted: null,
    countedBy: null,
    countedAt: null,
    reason: null,
    found: false,
    ...values,
    lotKey: lotKey(values.lotId),
  })
}

/** Reads one counted figure: a quantity of zero or more, a serial at most one. */
async function countedValue(ctx: Ctx, productId: unknown, value: unknown) {
  const counted = Number(value)
  if (value === '' || value == null || !Number.isFinite(counted) || counted < 0)
    throw new CountRefused('counted', 'countQuantity')
  if ((await trackingOf(ctx, productId)) === 'serial' && counted > 1 + EPSILON)
    throw new CountRefused('counted', 'countSerial')
  return counted
}

const QUALITY = ['qualityGood', 'qualityPoor', 'qualityLost'] as const
/** Older clients classify a newly saved count as good; an explicit breakdown must balance. */
function qualityOf(entry: Row, counted: number): Row {
  if (QUALITY.every((key) => entry[key] === undefined))
    return { qualityGood: String(counted), qualityPoor: '0', qualityLost: '0' }
  const values = QUALITY.map((key) => Number(entry[key] ?? 0))
  if (
    values.some((value) => !Number.isFinite(value) || value < 0) ||
    Math.abs(values.reduce((a, b) => a + b, 0) - counted) > EPSILON
  )
    throw new CountRefused('lines', 'countQualityTotal')
  return Object.fromEntries(QUALITY.map((key, i) => [key, String(values[i])]))
}

const reasonOf = (value: unknown) =>
  String(value ?? '')
    .trim()
    .slice(0, 500) || null

/** Whether the counting so far hides the book and the differences (K34). */
const hidden = (session: Row) => session.blind === true && session.state === 'counting'

function present(session: Row, lines: Row[]) {
  const hide = hidden(session)
  const differing = lines.filter(
    (line) => line.counted != null && Math.abs(Number(line.counted) - Number(line.expected)) > EPSILON,
  )
  return {
    settlementState:
      session.state !== 'done'
        ? null
        : differing.every((line) => line.settlementId)
          ? 'done'
          : differing.some((line) => line.settlementId)
            ? 'partial'
            : 'pending',
    lineCount: lines.length,
    countedLines: lines.filter((line) => line.counted != null).length,
    differingLines: hide ? null : differing.length,
    lines: lines.map(({ countBookValue: _book, countPhysicalValue: _physical, ...line }) => ({
      ...line,
      expected: hide ? null : line.expected,
      difference: hide || line.counted == null ? null : String(Number(line.counted) - Number(line.expected)),
    })),
  }
}

export async function listCountSessionsHandler(ctx: Ctx, args: Row) {
  const sessions = await ours(
    ctx,
    'stock.CountSession',
    args.warehouseId ? { warehouseId: args.warehouseId } : {},
  )
  return Promise.all(
    sessions.map(async (session) => {
      const { lines: _lines, ...summary } = present(session, await linesOf(ctx, session.id))
      return { ...session, ...summary }
    }),
  )
}

export async function getCountSessionHandler(ctx: Ctx, args: Row) {
  const session = (await ours(ctx, 'stock.CountSession', { id: args.id }))[0]
  if (!session) return null
  const lines = await linesOf(ctx, session.id)
  const actor = ctx.actor == null ? null : String(ctx.actor)
  return {
    ...session,
    ...present(session, lines),
    // K35: whoever counted a line or sent the session for approval does not approve it.
    selfCounted:
      actor !== null && (session.submittedBy === actor || lines.some((line) => line.countedBy === actor)),
  }
}

async function createCountSession(tx: Ctx, args: Row) {
  const replay = (await ours(tx, 'stock.CountSession', { id: args.id }))[0]
  if (replay) {
    if (replay.warehouseId !== args.warehouseId) throw new CountRefused('id', 'countIdTaken')
    return { ok: true, id: replay.id }
  }
  const warehouse = await holdWarehouse(tx, args.warehouseId)
  const scope = await chosenProducts(tx, args.productIds)
  // K62: a full count stands alone; partial counts run beside each other while they share no product.
  const open = (await ours(tx, 'stock.CountSession', { warehouseId: warehouse.id })).find(
    (row) => OPEN.includes(String(row.state)) && overlaps(scopeOf(row), scope),
  )
  if (open) throw new CountRefused('warehouseId', 'countOverlap', { name: open.name })
  const locationId = stockOf(warehouse.id)
  const book = (await bookLines(tx, locationId)).filter(
    (row) => !scope.length || scope.includes(String(row.quant.productId)),
  )
  if (!book.length && args.allowEmpty !== true)
    throw scope.length
      ? new CountRefused('productIds', 'countProductsEmpty')
      : new CountRefused('warehouseId', 'countNothingHeld')
  if (book.length > MAX_LINES) throw new CountRefused('warehouseId', 'countTooMany', { max: MAX_LINES })
  const session = {
    id: args.id,
    name: await nextName(tx, warehouse),
    warehouseId: warehouse.id,
    locationId,
    blind: args.blind !== false,
    productIds: scope.length ? scope : null,
    state: 'counting',
    startedAt: now(),
    startedBy: tx.actor ?? null,
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    returnReason: null,
    returnedBy: null,
    cancelReason: null,
    cancelledBy: null,
    shortagePickingId: null,
    excessPickingId: null,
  }
  await tx.db.insert('stock.CountSession', session)
  let sequence = 0
  for (const row of book)
    await insertLine(tx, session, `${String(session.id)}:${String(sequence + 1)}`, {
      productId: row.quant.productId,
      lotId: row.quant.lotId ?? null,
      sequence: (sequence += 10),
      expected: String(row.quant.quantity),
    })
  return { ok: true, id: session.id, name: session.name }
}

export async function startCountSessionHandler(ctx: Ctx, args: Row) {
  return run(() => ctx.tx((tx) => createCountSession(tx, args)))
}

/** A single-product count records evidence only; approval owns all stock and accounting writes. */
export async function requestInventoryCountHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const replay = (await ours(tx, 'stock.CountSession', { id: args.id }))[0]
      if (replay) {
        if (replay.locationId !== args.locationId || scopeOf(replay).join() !== String(args.productId))
          throw new CountRefused('id', 'countIdTaken')
        return { ok: true, id: replay.id }
      }
      const location = (await ours(tx, 'stock.Location', { id: args.locationId }))[0]
      if (!location?.warehouseId || location.id !== stockOf(location.warehouseId))
        throw new CountRefused('locationId', 'countWarehouse')
      const result = await createCountSession(tx, {
        id: args.id,
        warehouseId: location.warehouseId,
        productIds: [args.productId],
        blind: true,
        allowEmpty: true,
      })
      if (result.ok !== true) return result
      let held = await linesOf(tx, args.id)
      if (!held.length) {
        const tracking = await trackingOf(tx, args.productId)
        const lot = args.lotId ? (await ours(tx, 'stock.Lot', { id: args.lotId }))[0] : null
        if ((tracking === 'none' && args.lotId) || (tracking !== 'none' && lot?.productId !== args.productId))
          throw new CountRefused('lotId', 'countLot')
        const session = await sessionOf(tx, args.id)
        await insertLine(tx, session, `${String(args.id)}:1`, {
          productId: args.productId,
          lotId: args.lotId ?? null,
          expected: '0',
          sequence: 10,
        })
        held = await linesOf(tx, args.id)
      }
      if (args.countedQuantity != null) {
        const line = held.find((row) => row.lotKey === lotKey(args.lotId))
        if (!line) throw new CountRefused('lotId', 'countLot')
        const counted = await countedValue(tx, args.productId, args.countedQuantity)
        if (
          args.reasonCode &&
          !COUNT_REASONS.includes(String(args.reasonCode) as (typeof COUNT_REASONS)[number])
        )
          throw new CountRefused('reasonCode', 'countDifferenceReason')
        await tx.db.update(
          'stock.CountLine',
          { id: line.id },
          {
            counted: String(counted),
            ...qualityOf({}, counted),
            countedBy: ctx.actor ?? null,
            countedAt: now(),
            reasonCode: args.reasonCode || null,
            reason: reasonOf(args.reason),
          },
        )
      }
      return result
    }),
  )
}

/**
 * Records counted figures (K34): each figure keeps who counted it, each line its reason for a difference.
 * The count sheet saves as one grid, so lines it drops (`removed`) leave in the same transaction;
 * dropping them takes `removeCountLine`, as removing one line does.
 */
export async function saveCountLinesHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await holdCounting(tx, args.id)
      if (!Array.isArray(args.lines)) throw new CountRefused('lines', 'countQuantity')
      if (args.removed != null && !Array.isArray(args.removed))
        throw new CountRefused('lineId', 'countLineMissing')
      if (
        (args.removed as unknown[] | undefined)?.length &&
        !(await holdsFunction(tx, 'stock.removeCountLine'))
      )
        throw new KetError({ code: 'E_FN_NOT_PERMITTED', message: 'this role may not remove count lines' })
      const lines = new Map((await linesOf(tx, session.id)).map((line) => [String(line.id), line]))
      const CountLine = tx.table('stock.CountLine')
      for (const id of ((args.removed as unknown[] | undefined) ?? []).map(String)) {
        if (!lines.delete(id)) throw new CountRefused('lineId', 'countLineMissing')
        await tx.db.del(deleteFrom(CountLine).where(eq(CountLine.id, id)))
      }
      for (const entry of args.lines as Row[]) {
        const line = lines.get(String(entry.lineId))
        if (!line) throw new CountRefused('lineId', 'countLineMissing')
        const counted = await countedValue(tx, line.productId, entry.counted)
        if (
          entry.reasonCode &&
          !COUNT_REASONS.includes(String(entry.reasonCode) as (typeof COUNT_REASONS)[number])
        )
          throw new CountRefused('lines', 'countDifferenceReason')
        await tx.db.update(
          'stock.CountLine',
          { id: line.id },
          {
            counted: String(counted),
            ...qualityOf(entry, counted),
            countedBy: ctx.actor ?? null,
            countedAt: now(),
            ...(entry.reason === undefined ? {} : { reason: reasonOf(entry.reason) }),
            ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode || null }),
          },
        )
      }
      return { ok: true, id: session.id }
    }),
  )
}

/** Adds goods found on the shelf that the book does not hold in this warehouse (K33). */
export async function addCountLineHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await holdCounting(tx, args.id)
      const lines = await linesOf(tx, session.id)
      if (lines.some((line) => line.id === args.lineId)) return { ok: true, id: session.id }
      if (!args.productId || !(await isStorable(tx, args.productId)))
        throw new CountRefused('productId', 'countProduct')
      // K62: a partial count finds goods of its own products only.
      const scope = scopeOf(session)
      if (scope.length && !scope.includes(String(args.productId)))
        throw new CountRefused('productId', 'countProductOutside', {
          product: (await describe(tx, args.productId)).name,
        })
      let lotId: unknown = null
      if ((await trackingOf(tx, args.productId)) === 'none') {
        if (args.lotId) throw new CountRefused('lotId', 'countLotUntracked')
      } else {
        const lot = args.lotId ? (await ours(tx, 'stock.Lot', { id: args.lotId }))[0] : undefined
        if (!lot || lot.productId !== args.productId) throw new CountRefused('lotId', 'countLot')
        lotId = lot.id
      }
      if (lines.some((line) => line.productId === args.productId && line.lotKey === lotKey(lotId)))
        throw new CountRefused('productId', 'countLineTaken')
      if (lines.length >= MAX_LINES) throw new CountRefused('productId', 'countTooMany', { max: MAX_LINES })
      const counted = await countedValue(tx, args.productId, args.counted)
      const book = await bookOf(tx, session.locationId, args.productId, lotId)
      await insertLine(tx, session, String(args.lineId), {
        productId: args.productId,
        lotId,
        sequence: Math.max(0, ...lines.map((line) => Number(line.sequence))) + 10,
        expected: String(book?.quantity ?? 0),
        counted: String(counted),
        ...qualityOf({}, counted),
        countedBy: ctx.actor ?? null,
        countedAt: now(),
        reason: reasonOf(args.reason),
        reasonCode: COUNT_REASONS.includes(String(args.reasonCode) as (typeof COUNT_REASONS)[number])
          ? args.reasonCode
          : null,
        found: true,
      })
      return { ok: true, id: session.id }
    }),
  )
}

export async function saveCountDetailsHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await holdCounting(tx, args.id)
      if (!Array.isArray(args.committee) || args.committee.length > 20)
        throw new CountRefused('committee', 'countCommittee')
      if (args.committee.some((member) => !member || typeof member !== 'object' || Array.isArray(member)))
        throw new CountRefused('committee', 'countCommittee')
      const committee = args.committee.map((member: Row, index: number) => ({
        id: String(member.id || index),
        name: String(member.name ?? '').trim(),
        title: String(member.title ?? '').trim(),
        role: String(member.role ?? '').trim(),
      }))
      if (
        committee.some(
          (member) =>
            !member.name ||
            !member.title ||
            !member.role ||
            [member.name, member.title, member.role].some((value) => value.length > 200),
        )
      )
        throw new CountRefused('committee', 'countCommittee')
      await tx.db.update(
        'stock.CountSession',
        { id: session.id },
        {
          committee,
          resolution: String(args.resolution ?? '')
            .trim()
            .slice(0, 4000),
        },
      )
      return { ok: true, id: session.id }
    }),
  )
}

export async function removeCountLineHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await holdCounting(tx, args.id)
      const line = (await ours(tx, 'stock.CountLine', { id: args.lineId }))[0]
      if (!line || line.sessionId !== session.id) return { ok: true, id: session.id }
      const lines = tx.table('stock.CountLine')
      await tx.db.del(deleteFrom(lines).where(eq(lines.id, line.id)))
      return { ok: true, id: session.id }
    }),
  )
}

/** Sends a fully counted session for approval (K34); a line nobody saw is counted as zero, not skipped. */
export async function submitCountSessionHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await sessionOf(tx, args.id)
      if (session.state === 'review') return { ok: true, id: session.id }
      if (session.state !== 'counting') throw new CountRefused('id', 'countNotCounting')
      await claim(tx, session, 'counting', { state: 'counting' })
      const lines = await linesOf(tx, session.id)
      const left = lines.filter((line) => line.counted == null).length
      if (!lines.length) throw new CountRefused('id', 'countEmpty')
      if (left) throw new CountRefused('id', 'countUncounted', { left })
      for (const line of lines)
        if (QUALITY.some((key) => line[key] != null)) qualityOf(line, Number(line.counted))
      if (
        lines.some(
          (line) =>
            Math.abs(Number(line.counted) - Number(line.expected)) > EPSILON &&
            !COUNT_REASONS.includes(String(line.reasonCode) as (typeof COUNT_REASONS)[number]),
        )
      )
        throw new CountRefused('lines', 'countDifferenceReason')
      await claim(tx, session, 'counting', {
        state: 'review',
        submittedAt: now(),
        submittedBy: ctx.actor ?? null,
      })
      return { ok: true, id: session.id }
    }),
  )
}

/** The done transfer that carries one side of a count's differences, valued and posted (K36). */
async function adjust(ctx: Ctx, session: Row, side: 'shortage' | 'excess', lines: Row[], at: string) {
  if (!lines.length) return null
  const adjustment = adjustmentOf(session.warehouseId)
  await ctx.db.insertIfAbsent('stock.Location', {
    id: adjustment,
    name: 'Inventory adjustment',
    usage: 'inventory',
    parentId: null,
    parentPath: `${adjustment}/`,
    warehouseId: session.warehouseId,
    active: true,
  })
  const pickingTypeId = `${String(session.warehouseId)}:count`
  await ctx.db.insertIfAbsent('stock.PickingType', {
    id: pickingTypeId,
    name: 'Physical count',
    code: 'internal',
    warehouseId: session.warehouseId,
    defaultLocationSrcId: session.locationId,
    defaultLocationDestId: adjustment,
    createBackorder: 'never',
    // Count adjustments come from approved counts only; nobody opens one by hand.
    active: false,
  })
  const from = side === 'shortage' ? session.locationId : adjustment
  const to = side === 'shortage' ? adjustment : session.locationId
  const pickingId = `${String(session.id)}:${side}`
  const name = `${String(session.name)}/${side === 'shortage' ? 'XK' : 'NK'}`
  await ctx.db.insert('stock.Picking', {
    id: pickingId,
    name,
    pickingTypeId,
    locationId: from,
    locationDestId: to,
    moveType: 'direct',
    state: 'done',
    backorderId: null,
    partnerId: null,
    replenishmentGroup: null,
    scheduledDate: at,
    dateDone: at,
  })
  const valuation = []
  for (const line of lines) {
    const quantity = Math.abs(Number(line.counted) - Number(line.expected))
    const uomId = await productUnitId(ctx, line.productId)
    const ids = { move: `${String(line.id)}:move`, line: `${String(line.id)}:line` }
    await mutateQuant(ctx, {
      productId: line.productId,
      locationId: from,
      lotId: line.lotId ?? undefined,
      quantity: -quantity,
      reserved: 0,
    })
    await mutateQuant(ctx, {
      productId: line.productId,
      locationId: to,
      lotId: line.lotId ?? undefined,
      quantity,
      reserved: 0,
    })
    await ctx.db.insert('stock.Move', {
      id: ids.move,
      // A move names its goods, as every other operation's moves do; the transfer carries the count's number.
      name: (await describe(ctx, line.productId)).name,
      pickingId,
      productId: line.productId,
      productUomId: uomId,
      productUomQty: String(quantity),
      quantity: String(quantity),
      locationId: from,
      locationDestId: to,
      state: 'done',
      picked: true,
      procureMethod: 'make_to_stock',
      ruleId: null,
      origin: String(session.name),
    })
    await ctx.db.insert('stock.MoveLine', {
      id: ids.line,
      moveId: ids.move,
      pickingId,
      productId: line.productId,
      productUomId: uomId,
      quantity: String(quantity),
      quantityProductUom: String(quantity),
      locationId: from,
      locationDestId: to,
      lotId: line.lotId ?? null,
      picked: true,
    })
    valuation.push({
      key: ids.line,
      productId: line.productId,
      productUomId: uomId,
      moveId: ids.move,
      moveLineId: ids.line,
      quantity,
      sourceUsage: side === 'shortage' ? 'internal' : 'inventory',
      destinationUsage: side === 'shortage' ? 'inventory' : 'internal',
    })
  }
  for (const valued of await valueOperation(ctx, { id: pickingId, name, date: at }, valuation))
    await ctx.db.update(
      'stock.MoveLine',
      { id: valued.key },
      { value: valued.value, unitCost: valued.unitCost },
    )
  return pickingId
}

/**
 * Approves a counted session (K35, K36): only someone who neither counted nor submitted it, only while the
 * book still holds what it held when counted. Shortages leave and excesses come in at once on done transfers
 * against the warehouse's adjustment location, at the average cost, posted to the stock journal.
 */
export async function approveCountSessionHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await sessionOf(tx, args.id)
      if (session.state === 'done') return { ok: true, id: session.id }
      if (session.state !== 'review') throw new CountRefused('id', 'countNotReview')
      const lines = await linesOf(tx, session.id)
      const actor = ctx.actor == null ? null : String(ctx.actor)
      if (actor !== null && (session.submittedBy === actor || lines.some((line) => line.countedBy === actor)))
        throw new CountRefused('id', 'countSelfApproval')
      const at = now()
      await claim(tx, session, 'review', { state: 'done', approvedAt: at, approvedBy: ctx.actor ?? null })
      await primeValuation(tx, [...new Set(lines.map((line) => line.productId))])
      for (const line of lines) {
        const book = await bookOf(tx, session.locationId, line.productId, line.lotId)
        if (Math.abs(Number(book?.quantity ?? 0) - Number(line.expected)) > EPSILON)
          throw new CountRefused('id', 'countStockChanged', {
            product: (await describe(tx, line.productId)).name,
          })
        if (Number(line.counted) + EPSILON < Number(book?.reservedQuantity ?? 0))
          throw new CountRefused('id', 'countBelowReserved', {
            product: (await describe(tx, line.productId)).name,
          })
      }
      const scale = await scaleFor(tx)
      const bookValues = new Map<string, bigint>()
      for (const line of lines) {
        const valuation = (await ours(tx, 'stock.ProductValuation', { productId: line.productId }))[0]
        const held = units(valuation?.quantity)
        const cost = (await ours(tx, 'product.Cost', { productId: line.productId }))[0]
        bookValues.set(
          String(line.id),
          held > 0n
            ? share(moneyMinor(valuation?.value, scale), units(line.expected), held)
            : priced(cost?.standardPrice, units(line.expected), scale),
        )
      }
      const differing = (sign: number) =>
        lines.filter((line) => sign * (Number(line.counted) - Number(line.expected)) > EPSILON)
      const shortagePickingId = await adjust(tx, session, 'shortage', differing(-1), at)
      const excessPickingId = await adjust(tx, session, 'excess', differing(1), at)
      const company = (await tx.db.select('company.Company', { id: tx.scope.company }))[0]
      await tx.db.update(
        'stock.CountSession',
        { id: session.id },
        { shortagePickingId, excessPickingId, valueCurrency: company?.currency ?? 'VND' },
      )
      for (const line of lines) {
        const delta = (
          await ours(tx, 'stock.ValuationLayer', { moveLineId: `${String(line.id)}:line` })
        ).reduce((sum, layer) => sum + moneyMinor(layer.value, scale), 0n)
        const book = bookValues.get(String(line.id)) ?? 0n
        await tx.db.update(
          'stock.CountLine',
          { id: line.id },
          { countBookValue: minorText(book, scale), countPhysicalValue: minorText(book + delta, scale) },
        )
      }
      // K37: a lot's history names the count that corrected it.
      for (const line of [...differing(-1), ...differing(1)])
        if (line.lotId)
          await tx.db.insert('stock.LotHistory', {
            id: `${String(line.id)}:countAdjustment`,
            lotId: line.lotId,
            at,
            actorId: ctx.actor ?? null,
            reason: 'countAdjustment',
            before: { quantity: line.expected },
            after: { count: session.name, quantity: line.counted, reason: line.reason ?? null },
          })
      return { ok: true, id: session.id, shortagePickingId, excessPickingId }
    }),
  )
}

/**
 * Sends a session back to be counted again (K35): lines whose book changed take the new book and wait for a
 * new figure, and lots that came into the warehouse meanwhile join the session.
 */
export async function returnCountSessionHandler(ctx: Ctx, args: Row) {
  const reason = reasonOf(args.reason)
  if (!reason) return refusal('reason', 'countReason')
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await sessionOf(tx, args.id)
      if (session.state !== 'review') throw new CountRefused('id', 'countNotReview')
      await claim(tx, session, 'review', {
        state: 'counting',
        submittedAt: null,
        submittedBy: null,
        returnReason: reason,
        returnedBy: ctx.actor ?? null,
      })
      const lines = await linesOf(tx, session.id)
      for (const line of lines) {
        const book = String((await bookOf(tx, session.locationId, line.productId, line.lotId))?.quantity ?? 0)
        if (Math.abs(Number(book) - Number(line.expected)) > EPSILON)
          await tx.db.update(
            'stock.CountLine',
            { id: line.id },
            { expected: book, counted: null, countedBy: null, countedAt: null },
          )
      }
      const known = new Set(lines.map((line) => `${String(line.productId)}|${String(line.lotKey)}`))
      let sequence = Math.max(0, ...lines.map((line) => Number(line.sequence)))
      let total = lines.length
      // A partial count takes in what came in of its own products only (K62).
      const scope = scopeOf(session)
      for (const row of await bookLines(tx, session.locationId)) {
        if (known.has(`${String(row.quant.productId)}|${lotKey(row.quant.lotId)}`)) continue
        if (scope.length && !scope.includes(String(row.quant.productId))) continue
        if ((total += 1) > MAX_LINES) throw new CountRefused('id', 'countTooMany', { max: MAX_LINES })
        await insertLine(tx, session, `${String(session.id)}:r${String(sequence + 10)}`, {
          productId: row.quant.productId,
          lotId: row.quant.lotId ?? null,
          sequence: (sequence += 10),
          expected: String(row.quant.quantity),
        })
      }
      return { ok: true, id: session.id }
    }),
  )
}

export async function cancelCountSessionHandler(ctx: Ctx, args: Row) {
  const reason = reasonOf(args.reason)
  if (!reason) return refusal('reason', 'countReason')
  return run(() =>
    ctx.tx(async (tx) => {
      const session = await sessionOf(tx, args.id)
      if (session.state === 'cancel') return { ok: true, id: session.id }
      if (!OPEN.includes(String(session.state))) throw new CountRefused('id', 'countNotOpen')
      await claim(tx, session, String(session.state), {
        state: 'cancel',
        cancelReason: reason,
        cancelledBy: ctx.actor ?? null,
      })
      return { ok: true, id: session.id }
    }),
  )
}

/**
 * Each warehouse's count cycle (K62): the last full count approved, the day the next one falls due, and the
 * full count under way. A warehouse on a cycle that was never counted in full is due at once; partial counts
 * leave the cycle where it was.
 */
export async function listCountCyclesHandler(ctx: Ctx, args: Row) {
  // Days fall in the company's accounting time zone, as receipt lots' expiry does.
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const zone = String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh')
  const today = civilDate(now(), zone)
  const warehouses = (
    await ours(ctx, 'stock.Warehouse', args.warehouseId ? { id: args.warehouseId } : {})
  ).filter((row) => row.active !== false)
  const full = (await ours(ctx, 'stock.CountSession')).filter((row) => !scopeOf(row).length)
  return warehouses.map((warehouse) => {
    const own = full.filter((row) => row.warehouseId === warehouse.id)
    const last = own
      .filter((row) => row.state === 'done')
      .map((row) => civilDate(String(row.approvedAt), zone))
      .sort()
      .at(-1)
    const counting = own.find((row) => OPEN.includes(String(row.state)))
    const days = Number(warehouse.countFrequencyDays ?? 0)
    const next = days > 0 ? (last ? addDays(last, days) : today) : null
    return {
      warehouseId: warehouse.id,
      name: warehouse.name,
      countFrequencyDays: days,
      lastCountDate: last ?? null,
      nextCountDate: next,
      countDue: Boolean(next && !counting && next <= today),
      countingId: counting?.id ?? null,
      countingName: counting?.name ?? null,
    }
  })
}

const READ = [
  'read:stock.CountSession',
  'read:stock.CountLine',
  'read:stock.Warehouse',
  'read:stock.Location',
  'read:stock.Quant',
  'read:stock.Lot',
  'read:product.Product',
  'read:product.Template',
]
const LINE_WRITE = [...READ, 'write:stock.CountSession', 'write:stock.CountLine']
const RESULT = { ok: 'bool', id: 'id?', errors: 'json?' }

export const countFunctions: Record<string, FnSpec> = {
  saveCountDetails: defineFn({
    input: { id: 'id', committee: 'json', resolution: 'text?' },
    output: RESULT,
    effects: LINE_WRITE,
    idempotent: true,
    handler: saveCountDetailsHandler,
  }),
  listCountSessions: defineFn({
    input: { warehouseId: 'id?' },
    effects: ['read:stock.CountSession', 'read:stock.CountLine'],
    handler: listCountSessionsHandler,
  }),
  listCountCycles: defineFn({
    input: { warehouseId: 'id?' },
    effects: ['read:stock.Warehouse', 'read:stock.CountSession', 'read:company.Company'],
    handler: listCountCyclesHandler,
  }),
  getCountSession: defineFn({
    input: { id: 'id' },
    effects: ['read:stock.CountSession', 'read:stock.CountLine'],
    handler: getCountSessionHandler,
  }),
  requestInventoryCount: defineFn({
    input: {
      id: 'id',
      productId: 'id',
      locationId: 'id',
      lotId: 'id?',
      countedQuantity: 'decimal?',
      reasonCode: 'text?',
      reason: 'text?',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [...LINE_WRITE, 'write:stock.Warehouse', 'read:stock.Location'],
    idempotent: true,
    handler: requestInventoryCountHandler,
  }),
  startCountSession: defineFn({
    input: { id: 'id', warehouseId: 'id', blind: 'bool?', productIds: 'json?' },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [...LINE_WRITE, 'write:stock.Warehouse'],
    idempotent: true,
    handler: startCountSessionHandler,
  }),
  saveCountLines: defineFn({
    // Optional so that a grid draft the modal could not read is refused by name, not by schema.
    input: { id: 'id', lines: 'json?', removed: 'json?' },
    output: RESULT,
    effects: [...LINE_WRITE, ...AUTHORIZATION_READ_EFFECTS],
    idempotent: true,
    handler: saveCountLinesHandler,
  }),
  addCountLine: defineFn({
    input: {
      id: 'id',
      lineId: 'id',
      productId: 'id',
      lotId: 'id?',
      counted: 'decimal',
      reason: 'text?',
      reasonCode: 'text?',
    },
    output: RESULT,
    effects: LINE_WRITE,
    idempotent: true,
    handler: addCountLineHandler,
  }),
  removeCountLine: defineFn({
    input: { id: 'id', lineId: 'id' },
    output: RESULT,
    effects: LINE_WRITE,
    idempotent: true,
    handler: removeCountLineHandler,
  }),
  submitCountSession: defineFn({
    input: { id: 'id' },
    output: RESULT,
    effects: LINE_WRITE,
    idempotent: true,
    handler: submitCountSessionHandler,
  }),
  approveCountSession: defineFn({
    input: { id: 'id' },
    output: {
      ok: 'bool',
      id: 'id?',
      shortagePickingId: 'id?',
      excessPickingId: 'id?',
      errors: 'json?',
    },
    effects: [
      ...new Set([
        ...LINE_WRITE,
        'write:stock.Quant',
        // Holding goods locks the product's stock configuration (R3).
        'write:product.Template',
        'write:stock.Location',
        'write:stock.PickingType',
        'write:stock.Picking',
        'write:stock.Move',
        'write:stock.MoveLine',
        'write:stock.LotHistory',
        'read:uom.Unit',
        ...VALUATION_EFFECTS,
      ]),
    ],
    idempotent: true,
    handler: approveCountSessionHandler,
  }),
  returnCountSession: defineFn({
    input: { id: 'id', reason: 'text' },
    output: RESULT,
    effects: LINE_WRITE,
    idempotent: true,
    handler: returnCountSessionHandler,
  }),
  cancelCountSession: defineFn({
    input: { id: 'id', reason: 'text' },
    output: RESULT,
    effects: LINE_WRITE,
    idempotent: true,
    handler: cancelCountSessionHandler,
  }),
}
