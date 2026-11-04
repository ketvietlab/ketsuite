import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { InventoryRefused } from '../inventory-validation.ts'
import { ours } from '../scope.ts'
import { isStorable, lotKey, mutateQuant, trackingOf } from '../stock-ledger.ts'
import { productUnitId } from '../units.ts'
import { deliveredValue, primeValuation, VALUATION_EFFECTS, valueOperation } from '../valuation.ts'
import type { SupplierReplenishment } from '../replenishment-policy.ts'
import { orderpointRunner, orderpointWriteEffects } from './orderpoints.ts'

import { SCRAP_REASONS } from '../scrap-reasons.ts'

const refusal = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, messageKey: `stock.error.${key}` }],
})

class ScrapRefused extends Error {
  readonly result: ReturnType<typeof refusal>
  constructor(field: string, key: string) {
    super(key)
    this.result = refusal(field, key)
  }
}

const EPSILON = 0.000001
const now = () => new Date().toISOString()

/** Where a warehouse keeps its goods, and where its scrapped goods go. */
const stockOf = (warehouseId: unknown) => `${String(warehouseId)}:stock`
const scrapOf = (warehouseId: unknown) => `${String(warehouseId)}:scrap`

/** What a location holds of the goods that no transfer has reserved: the most a scrap may take. */
async function unreserved(ctx: Ctx, locationId: unknown, productId: unknown, lotId: unknown) {
  const quant = (await ours(ctx, 'stock.Quant', { productId, locationId, lotKey: lotKey(lotId) }))[0]
  return Math.max(0, Number(quant?.quantity ?? 0) - Number(quant?.reservedQuantity ?? 0))
}

/**
 * The warehouse location an operation's goods may be scrapped from (K59): where it takes them from until it
 * is done, where it brought them after. None for a draft or cancelled operation, a scrap, or goods outside a
 * warehouse.
 */
export async function pickingScrapLocation(ctx: Ctx, picking: Row | undefined): Promise<Row | undefined> {
  if (
    !picking ||
    !['confirmed', 'assigned', 'partially_available', 'waiting', 'done'].includes(String(picking.state))
  )
    return undefined
  // Scrap transfers, their undoing and count adjustments are not operations goods are scrapped from.
  if (['scrap', 'adjustment', 'count'].includes(String(picking.pickingTypeId).split(':').at(-1) ?? ''))
    return undefined
  const location = (
    await ours(ctx, 'stock.Location', {
      id: picking.state === 'done' ? picking.locationDestId : picking.locationId,
    })
  )[0]
  return location?.usage === 'internal' && location.warehouseId ? location : undefined
}

/** The rule that orders the product again in the warehouse, if it has one. */
const ruleOf = async (ctx: Ctx, warehouseId: unknown, productId: unknown) =>
  (await ours(ctx, 'stock.Orderpoint', { warehouseId, productId })).find((row) => row.active !== false)

/** The next scrap order of a warehouse: HN/HH/0002. Callers hold the warehouse, so two cannot take one number. */
async function nextName(ctx: Ctx, warehouse: Row) {
  const prefix = `${String(warehouse.code || 'WH')}/HH/`
  let last = 0
  for (const row of await ours(ctx, 'stock.Scrap', { warehouseId: warehouse.id }))
    if (String(row.name).startsWith(prefix))
      last = Math.max(last, Number(String(row.name).slice(prefix.length)) || 0)
  return `${prefix}${String(last + 1).padStart(4, '0')}`
}

async function holdWarehouse(ctx: Ctx, id: unknown) {
  const warehouse = id ? (await ours(ctx, 'stock.Warehouse', { id }))[0] : undefined
  if (!warehouse || warehouse.active === false) throw new ScrapRefused('warehouseId', 'scrapWarehouse')
  const lock = await ctx.db.compareAndSet(
    'stock.Warehouse',
    { id: warehouse.id },
    { active: true },
    { active: true },
  )
  if (!('dryRun' in lock) && !lock.matched) throw new ScrapRefused('warehouseId', 'scrapWarehouse')
  return warehouse
}

/** Reads and checks what a draft names: the goods, where from, how many, why and whether to order them again. */
async function draftValues(ctx: Ctx, args: Row, existing: Row | undefined) {
  // An order opened from an operation scraps from where that operation holds the goods.
  const from =
    !existing && args.pickingId
      ? await pickingScrapLocation(ctx, (await ours(ctx, 'stock.Picking', { id: args.pickingId }))[0])
      : undefined
  if (!existing && args.pickingId && !from) throw new ScrapRefused('pickingId', 'scrapPicking')
  const warehouse = await holdWarehouse(ctx, existing?.warehouseId ?? args.warehouseId ?? from?.warehouseId)
  if (from && from.warehouseId !== warehouse.id) throw new ScrapRefused('pickingId', 'scrapPicking')
  const locationId = existing?.locationId ?? from?.id ?? stockOf(warehouse.id)
  const pickingId = existing?.pickingId ?? (from ? args.pickingId : null)
  const productId = args.productId ?? existing?.productId
  if (!productId || !(await isStorable(ctx, productId))) throw new ScrapRefused('productId', 'scrapProduct')
  if (pickingId && !(await ours(ctx, 'stock.Move', { pickingId, productId })).length)
    throw new ScrapRefused('productId', 'scrapPickingProduct')
  let lotId: unknown = null
  if ((await trackingOf(ctx, productId)) !== 'none') {
    lotId = args.lotId === undefined ? existing?.lotId : args.lotId
    const lot = lotId ? (await ours(ctx, 'stock.Lot', { id: lotId }))[0] : undefined
    if (!lot || lot.productId !== productId) throw new ScrapRefused('lotId', 'scrapLot')
  }
  const quantity = Number(args.quantity ?? existing?.quantity)
  if (!Number.isFinite(quantity) || quantity <= EPSILON) throw new ScrapRefused('quantity', 'scrapQuantity')
  const reason = String(args.reason ?? existing?.reason ?? '')
  if (!(SCRAP_REASONS as readonly string[]).includes(reason)) throw new ScrapRefused('reason', 'scrapReason')
  return {
    warehouse,
    values: {
      warehouseId: warehouse.id,
      locationId,
      pickingId,
      productId,
      lotId,
      quantity: String(quantity),
      reason,
      replenish: args.replenish === undefined ? (existing?.replenish ?? false) : args.replenish === true,
      note:
        args.note === undefined ? (existing?.note ?? null) : String(args.note ?? '').slice(0, 2000) || null,
    },
  }
}

/**
 * Takes a draft's goods out of its warehouse today (K59): a done transfer to the warehouse's scrap location,
 * valued at the average cost and posted to the stock journal like any other issue, inside the caller's
 * transaction.
 */
async function carryOut(ctx: Ctx, scrap: Row) {
  const quantity = Number(scrap.quantity)
  if ((await unreserved(ctx, scrap.locationId, scrap.productId, scrap.lotId)) + EPSILON < quantity)
    throw new ScrapRefused('quantity', 'scrapExceedsHeld')
  const at = now()
  const destination = scrapOf(scrap.warehouseId)
  await ctx.db.insertIfAbsent('stock.Location', {
    id: destination,
    name: 'Scrap',
    usage: 'scrap',
    parentId: null,
    parentPath: `${destination}/`,
    warehouseId: scrap.warehouseId,
    active: true,
  })
  const pickingTypeId = `${String(scrap.warehouseId)}:scrap`
  await ctx.db.insertIfAbsent('stock.PickingType', {
    id: pickingTypeId,
    name: 'Scrap',
    code: 'internal',
    warehouseId: scrap.warehouseId,
    defaultLocationSrcId: stockOf(scrap.warehouseId),
    defaultLocationDestId: destination,
    createBackorder: 'never',
    // Scrap transfers come from scrap orders only; nobody opens one by hand.
    active: false,
  })
  const ids = {
    picking: `${String(scrap.id)}:scrap`,
    move: `${String(scrap.id)}:move`,
    line: `${String(scrap.id)}:line`,
  }
  const moved = await move(ctx, scrap, ids, scrap.locationId, destination, pickingTypeId, at, null)
  return { ...moved, at }
}

/** The name of the goods a move carries: its product's template. */
async function goodsName(ctx: Ctx, productId: unknown) {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product
    ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    : undefined
  return String(template?.name ?? productId)
}

/** One done transfer of a scrap order's goods between two locations, valued and posted. */
async function move(
  ctx: Ctx,
  scrap: Row,
  ids: { picking: string; move: string; line: string },
  from: unknown,
  to: unknown,
  pickingTypeId: unknown,
  at: string,
  returnOf: unknown,
) {
  const quantity = Number(scrap.quantity)
  const uomId = await productUnitId(ctx, scrap.productId)
  await primeValuation(ctx, [scrap.productId])
  await mutateQuant(ctx, {
    productId: scrap.productId,
    locationId: from,
    lotId: scrap.lotId ?? undefined,
    quantity: -quantity,
    reserved: 0,
  })
  await mutateQuant(ctx, {
    productId: scrap.productId,
    locationId: to,
    lotId: scrap.lotId ?? undefined,
    quantity,
    reserved: 0,
  })
  await ctx.db.insert('stock.Picking', {
    id: ids.picking,
    name: String(scrap.name),
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
  await ctx.db.insert('stock.Move', {
    id: ids.move,
    // A move names its goods, as every other operation's moves do; the transfer carries the order's number.
    name: await goodsName(ctx, scrap.productId),
    pickingId: ids.picking,
    productId: scrap.productId,
    productUomId: uomId,
    productUomQty: String(quantity),
    quantity: String(quantity),
    locationId: from,
    locationDestId: to,
    state: 'done',
    picked: true,
    procureMethod: 'make_to_stock',
    ruleId: null,
    origin: String(scrap.name),
    originReturnedMoveId: returnOf,
  })
  await ctx.db.insert('stock.MoveLine', {
    id: ids.line,
    moveId: ids.move,
    pickingId: ids.picking,
    productId: scrap.productId,
    productUomId: uomId,
    quantity: String(quantity),
    quantityProductUom: String(quantity),
    locationId: from,
    locationDestId: to,
    lotId: scrap.lotId ?? null,
    picked: true,
  })
  const usage = async (id: unknown) => (await ours(ctx, 'stock.Location', { id }))[0]?.usage
  const [valued] = await valueOperation(ctx, { id: ids.picking, name: String(scrap.name), date: at }, [
    {
      key: ids.line,
      productId: scrap.productId,
      productUomId: uomId,
      moveId: ids.move,
      moveLineId: ids.line,
      quantity,
      sourceUsage: await usage(from),
      destinationUsage: await usage(to),
      ...(returnOf ? { returnOf: await deliveredValue(ctx, returnOf) } : {}),
    },
  ])
  if (valued)
    await ctx.db.update(
      'stock.MoveLine',
      { id: valued.key },
      { value: valued.value, unitCost: valued.unitCost },
    )
  return { pickingId: ids.picking }
}

/** A lot's history keeps what its scrap orders took and gave back (K37). */
async function lotHistory(ctx: Ctx, scrap: Row, reason: 'scrap' | 'scrapUndo', note: unknown) {
  if (!scrap.lotId) return
  await ctx.db.insert('stock.LotHistory', {
    id: `${String(scrap.id)}:${reason}`,
    lotId: scrap.lotId,
    at: now(),
    actorId: ctx.actor ?? null,
    reason,
    before: {},
    after: { scrap: scrap.name, quantity: scrap.quantity, reason: scrap.reason, note: note ?? null },
  })
}

const run = async (body: () => Promise<Row>) => {
  try {
    return await body()
  } catch (error) {
    // A locked period or a missing stock account refuses the posting; say so instead of failing.
    if (error instanceof ScrapRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}

export async function listScrapsHandler(ctx: Ctx, args: Row) {
  return ours(ctx, 'stock.Scrap', args.warehouseId ? { warehouseId: args.warehouseId } : {})
}

export async function getScrapHandler(ctx: Ctx, args: Row) {
  const scrap = (await ours(ctx, 'stock.Scrap', { id: args.id }))[0]
  if (!scrap) return null
  return {
    ...scrap,
    // What the warehouse can still give up while the order may be validated.
    held:
      scrap.state === 'draft'
        ? String(await unreserved(ctx, scrap.locationId, scrap.productId, scrap.lotId))
        : null,
    ruleReady: Boolean(await ruleOf(ctx, scrap.warehouseId, scrap.productId)),
  }
}

/** Where a new order opened from an operation scraps from, for the form to show before it is saved. */
export async function getScrapSourceHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.pickingId }))[0]
  const location = await pickingScrapLocation(ctx, picking)
  if (!picking || !location) return null
  const products = [
    ...new Set((await ours(ctx, 'stock.Move', { pickingId: picking.id })).map((row) => row.productId)),
  ]
  return {
    pickingId: picking.id,
    name: picking.name,
    warehouseId: location.warehouseId,
    locationId: location.id,
    products,
  }
}

export async function saveScrapHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const existing = (await ours(tx, 'stock.Scrap', { id: args.id }))[0]
      if (existing && existing.state !== 'draft') throw new ScrapRefused('id', 'scrapNotDraft')
      if (existing) {
        const lock = await tx.db.compareAndSet(
          'stock.Scrap',
          { id: args.id },
          { state: 'draft' },
          { state: 'draft' },
        )
        if (!('dryRun' in lock) && !lock.matched) throw new ScrapRefused('id', 'scrapNotDraft')
      }
      const { warehouse, values } = await draftValues(tx, args, existing)
      if (existing) await tx.db.update('stock.Scrap', { id: args.id }, values)
      else
        await tx.db.insert('stock.Scrap', {
          id: args.id,
          ...values,
          name: await nextName(tx, warehouse),
          state: 'draft',
          date: now(),
          createdBy: tx.actor ?? null,
        })
      return { ok: true, id: args.id }
    }),
  )
}

export async function cancelScrapHandler(ctx: Ctx, args: Row) {
  return run(async () => {
    const scrap = (await ours(ctx, 'stock.Scrap', { id: args.id }))[0]
    if (!scrap) throw new ScrapRefused('id', 'scrapMissing')
    if (scrap.state === 'cancel') return { ok: true, id: scrap.id }
    const done = await ctx.db.compareAndSet(
      'stock.Scrap',
      { id: args.id },
      { state: 'draft' },
      { state: 'cancel' },
    )
    if (!('dryRun' in done) && !done.matched) throw new ScrapRefused('id', 'scrapNotDraft')
    return { ok: true, id: scrap.id }
  })
}

/**
 * Builds the functions that validate scrap orders. Replenishing asks the product's reorder rule to order the
 * scrapped quantity again, through the same supplier provider the rules use in this composition.
 */
export function createScrapFunctions(provider?: SupplierReplenishment): Record<string, FnSpec> {
  const runRule = orderpointRunner(provider)

  /** After the goods have left: the rule orders as many again, in its own transaction. */
  async function replenish(ctx: Ctx, scrap: Row) {
    const rule = await ruleOf(ctx, scrap.warehouseId, scrap.productId)
    if (!rule) return refusal('replenish', 'scrapNoRule')
    const result = await runRule(ctx, {
      id: rule.id,
      moveId: `${String(scrap.id)}:replenish`,
      quantity: Number(scrap.quantity),
    })
    if (result.ok && result.pickingId)
      await ctx.db.update('stock.Scrap', { id: scrap.id }, { replenishmentPickingId: result.pickingId })
    return result
  }

  async function validateScrapHandler(ctx: Ctx, args: Row) {
    const scrap = (await ours(ctx, 'stock.Scrap', { id: args.id }))[0]
    if (!scrap) return refusal('id', 'scrapMissing')
    if (scrap.state === 'done') return { ok: true, id: scrap.id }
    if (scrap.state !== 'draft') return refusal('id', 'scrapNotDraft')
    if (scrap.replenish && !(await ruleOf(ctx, scrap.warehouseId, scrap.productId)))
      return refusal('replenish', 'scrapNoRule')
    const validated = await run(() =>
      ctx.tx(async (tx) => {
        const lock = await tx.db.compareAndSet(
          'stock.Scrap',
          { id: args.id },
          { state: 'draft' },
          { state: 'done' },
        )
        if (!('dryRun' in lock) && !lock.matched) throw new ScrapRefused('id', 'scrapNotDraft')
        // The draft is read again under the lock: what it names is what leaves.
        const current = (await ours(tx, 'stock.Scrap', { id: args.id }))[0]!
        await holdWarehouse(tx, current.warehouseId)
        const { pickingId, at } = await carryOut(tx, current)
        await tx.db.update(
          'stock.Scrap',
          { id: args.id },
          { dateDone: at, validatedBy: tx.actor ?? null, operationId: pickingId },
        )
        await lotHistory(tx, current, 'scrap', current.note)
        return { ok: true, id: args.id }
      }),
    )
    if (!validated.ok || !scrap.replenish) return validated
    const replenishment = await replenish(ctx, scrap)
    return replenishment.ok ? validated : { ...validated, replenishment }
  }

  /**
   * Undoes a validated scrap order (K59): its goods come back today to where they left, from the scrap location,
   * worth what they left at, which posts the reverse entry. What the rule ordered stays ordered.
   */
  async function undoScrapHandler(ctx: Ctx, args: Row) {
    const reason = String(args.reason ?? '').trim()
    if (!reason) return refusal('reason', 'scrapUndoReason')
    return run(async () => {
      const scrap = (await ours(ctx, 'stock.Scrap', { id: args.id }))[0]
      if (!scrap) throw new ScrapRefused('id', 'scrapMissing')
      if (scrap.state === 'reversed') return { ok: true, id: scrap.id }
      if (scrap.state !== 'done') throw new ScrapRefused('id', 'scrapNotDone')
      return ctx.tx(async (tx) => {
        const lock = await tx.db.compareAndSet(
          'stock.Scrap',
          { id: args.id },
          { state: 'done' },
          { state: 'reversed' },
        )
        if (!('dryRun' in lock) && !lock.matched) throw new ScrapRefused('id', 'scrapNotDone')
        const out = (await ours(tx, 'stock.Picking', { id: scrap.operationId }))[0]
        if (!out) throw new ScrapRefused('id', 'scrapMissing')
        const ids = {
          picking: `${String(scrap.id)}:undo`,
          move: `${String(scrap.id)}:undo-move`,
          line: `${String(scrap.id)}:undo-line`,
        }
        const { pickingId } = await move(
          tx,
          scrap,
          ids,
          out.locationDestId,
          out.locationId,
          out.pickingTypeId,
          now(),
          `${String(scrap.id)}:move`,
        )
        await tx.db.update(
          'stock.Scrap',
          { id: args.id },
          { undoId: pickingId, undoneBy: tx.actor ?? null, undoReason: reason.slice(0, 500) },
        )
        await lotHistory(tx, scrap, 'scrapUndo', reason)
        return { ok: true, id: scrap.id }
      })
    })
  }

  /**
   * Scraps what a warehouse holds of a lot from the lot's page (K37): a scrap order validated at once, for the
   * quantity asked (empty: all it can give up) and the reason chosen or the one the lot's state suggests.
   */
  async function scrapLotHandler(ctx: Ctx, args: Row) {
    const note = String(args.note ?? '').trim()
    if (!note) return refusal('note', 'scrapNote')
    const replay = (await ours(ctx, 'stock.Scrap', { id: args.id }))[0]
    if (replay)
      return replay.lotId === args.lotId ? { ok: true, id: replay.id } : refusal('id', 'scrapIdTaken')
    const lot = (await ours(ctx, 'stock.Lot', { id: args.lotId }))[0]
    if (!lot) return refusal('lotId', 'scrapLot')
    const at = Date.now()
    const past = (field: string) => lot[field] && new Date(String(lot[field])).getTime() <= at
    const suggested =
      past('expirationDate') || past('removalDate')
        ? 'expired'
        : lot.quarantined === true
          ? 'failedTest'
          : 'damaged'
    return run(() =>
      ctx.tx(async (tx) => {
        const warehouse = await holdWarehouse(tx, args.warehouseId)
        const held = await unreserved(tx, stockOf(warehouse.id), lot.productId, lot.id)
        const typed = String(args.quantity ?? '').trim()
        const quantity = typed === '' ? held : Number(typed)
        if (held <= EPSILON) throw new ScrapRefused('warehouseId', 'scrapNothingHeld')
        const { values } = await draftValues(
          tx,
          {
            warehouseId: warehouse.id,
            productId: lot.productId,
            lotId: lot.id,
            quantity,
            reason: args.reason || suggested,
            note,
          },
          undefined,
        )
        const scrap = {
          id: args.id,
          ...values,
          replenish: false,
          name: await nextName(tx, warehouse),
          state: 'done',
          date: now(),
          createdBy: tx.actor ?? null,
          validatedBy: tx.actor ?? null,
        }
        await tx.db.insert('stock.Scrap', scrap)
        const { pickingId, at: done } = await carryOut(tx, scrap)
        await tx.db.update('stock.Scrap', { id: scrap.id }, { dateDone: done, operationId: pickingId })
        await lotHistory(tx, scrap, 'scrap', note)
        return { ok: true, id: scrap.id }
      }),
    )
  }

  const writes = [
    'read:stock.Scrap',
    'write:stock.Scrap',
    'read:stock.Warehouse',
    'write:stock.Warehouse',
    'read:stock.Location',
    'write:stock.Location',
    'read:stock.PickingType',
    'write:stock.PickingType',
    'read:stock.Picking',
    'write:stock.Picking',
    'read:stock.Move',
    'write:stock.Move',
    'read:stock.MoveLine',
    'write:stock.MoveLine',
    'read:stock.Quant',
    'write:stock.Quant',
    'read:stock.Lot',
    'write:stock.LotHistory',
    'read:stock.Orderpoint',
    'read:product.Product',
    'read:product.Template',
    'write:product.Template',
    ...VALUATION_EFFECTS,
  ]
  const result = { ok: 'bool', id: 'id?', errors: 'json?' } as const
  return {
    validateScrap: defineFn({
      input: { id: 'id' },
      output: { ...result, replenishment: 'json?' },
      effects: [...new Set([...writes, ...orderpointWriteEffects(provider)])],
      idempotent: true,
      agent: true,
      handler: validateScrapHandler,
    }),
    undoScrap: defineFn({
      input: { id: 'id', reason: 'text' },
      output: result,
      effects: [...new Set(writes)],
      idempotent: true,
      agent: true,
      handler: undoScrapHandler,
    }),
    scrapLot: defineFn({
      input: {
        id: 'id',
        lotId: 'id',
        warehouseId: 'id',
        quantity: 'text?',
        reason: 'text?',
        note: 'text',
      },
      output: result,
      effects: [...new Set(writes)],
      idempotent: true,
      agent: true,
      handler: scrapLotHandler,
    }),
  }
}

export const scrapFunctions: Record<string, FnSpec> = {
  listScraps: defineFn({
    input: { warehouseId: 'id?' },
    effects: ['read:stock.Scrap'],
    agent: true,
    handler: listScrapsHandler,
  }),
  getScrap: defineFn({
    input: { id: 'id' },
    effects: ['read:stock.Scrap', 'read:stock.Quant', 'read:stock.Orderpoint'],
    agent: true,
    handler: getScrapHandler,
  }),
  getScrapSource: defineFn({
    input: { pickingId: 'id' },
    effects: ['read:stock.Picking', 'read:stock.Scrap', 'read:stock.Location', 'read:stock.Move'],
    agent: true,
    handler: getScrapSourceHandler,
  }),
  saveScrap: defineFn({
    input: {
      id: 'id',
      warehouseId: 'id?',
      pickingId: 'id?',
      productId: 'id?',
      lotId: 'id?',
      quantity: 'decimal?',
      reason: 'text?',
      replenish: 'bool?',
      note: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Scrap',
      'write:stock.Scrap',
      'read:stock.Warehouse',
      'write:stock.Warehouse',
      'read:stock.Picking',
      'read:stock.Location',
      'read:stock.Move',
      'read:stock.Lot',
      'read:product.Product',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: saveScrapHandler,
  }),
  cancelScrap: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Scrap', 'write:stock.Scrap'],
    idempotent: true,
    agent: true,
    handler: cancelScrapHandler,
  }),
  ...createScrapFunctions(),
}
