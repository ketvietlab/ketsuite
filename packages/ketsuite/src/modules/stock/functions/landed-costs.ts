import { and, defineFn, deleteFrom, eq, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { SPLIT_METHODS } from '../landed-cost-split.ts'
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
  units,
  unitsText,
  VALUATION_EFFECTS,
} from '../valuation.ts'
import { revaluableMoves } from './revaluation.ts'

/** K64: how a cost spreads over the receipts' lines. */
export { SPLIT_METHODS }
const MAX_LINES = 20

class LandedCostRefused extends Error {
  result: Row
  constructor(result: Row) {
    super('landed cost refused')
    this.result = result
  }
}
const refusal = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, messageKey: `stock.error.${key}` }],
})
const refuse = (field: string, key: string) => new LandedCostRefused(refusal(field, key))
const run = async (body: () => Promise<Row>) => {
  try {
    return await body()
  } catch (error) {
    // A locked period or a missing stock account refuses the posting; say so instead of failing.
    if (error instanceof LandedCostRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}

/** The next landed cost of the company in a year: CPMT/2026/0002. Callers write inside one transaction. */
async function nextName(ctx: Ctx, day: string) {
  const prefix = `CPMT/${day.slice(0, 4)}/`
  let last = 0
  for (const row of await ours(ctx, 'stock.LandedCost'))
    if (String(row.name).startsWith(prefix))
      last = Math.max(last, Number(String(row.name).slice(prefix.length)) || 0)
  return `${prefix}${String(last + 1).padStart(4, '0')}`
}

/**
 * The completed receipts a cost may land on: goods bought from a vendor (or made) with a value, not goods a
 * customer brought back. Each comes with the lines that brought value in, what each brought and its value.
 */
export async function landableReceipts(ctx: Ctx, only?: unknown): Promise<Row[]> {
  const scale = await scaleFor(ctx)
  const out: Row[] = []
  for (const picking of await ours(
    ctx,
    'stock.Picking',
    only ? { state: 'done', id: only } : { state: 'done' },
  )) {
    const layers = (await ours(ctx, 'stock.ValuationLayer', { pickingId: picking.id })).filter((layer) =>
      ['receipt', 'production'].includes(String(layer.kind)),
    )
    if (!layers.length) continue
    const moves = await revaluableMoves(ctx, picking)
    if (!moves.length) continue
    out.push({
      id: picking.id,
      name: picking.name,
      partnerId: picking.partnerId ?? null,
      dateDone: picking.dateDone ?? null,
      moves: moves.map((move) => {
        const own = layers.filter((layer) => layer.moveId === move.id)
        return {
          id: move.id,
          productId: move.productId,
          productUomId: move.productUomId ?? null,
          units: own.reduce((sum, layer) => sum + units(layer.quantity), 0n),
          value: own.reduce((sum, layer) => sum + moneyMinor(layer.value, scale), 0n),
        }
      }),
    })
  }
  return out
}

/**
 * What is left of each line that brought a product in, read first in, first out over the company's valued
 * stock: transfers between its own locations do not use goods up, deliveries, scraps and count losses do.
 */
async function leftOfMoves(ctx: Ctx, productId: unknown): Promise<Map<string, bigint>> {
  const layers = (await ours(ctx, 'stock.ValuationLayer', { productId }))
    .filter((layer) => units(layer.quantity) !== 0n)
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        // At one instant what came in is there before what left.
        Number(units(b.quantity) > 0n) - Number(units(a.quantity) > 0n) ||
        String(a.id).localeCompare(String(b.id)),
    )
  const open: Array<{ moveId: string; left: bigint }> = []
  for (const layer of layers) {
    const quantity = units(layer.quantity)
    if (quantity > 0n) {
      open.push({ moveId: String(layer.moveId ?? ''), left: quantity })
      continue
    }
    let rest = -quantity
    while (rest > 0n && open.length) {
      const first = open[0]!
      const used = first.left < rest ? first.left : rest
      first.left -= used
      rest -= used
      if (first.left === 0n) open.shift()
    }
  }
  const left = new Map<string, bigint>()
  for (const layer of open)
    if (layer.moveId) left.set(layer.moveId, (left.get(layer.moveId) ?? 0n) + layer.left)
  return left
}

/** Splits `amount` by `weights`, rounded to whole minor units; the last share takes what rounding left. */
export function splitAmount(amount: bigint, weights: bigint[]): bigint[] | null {
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (total <= 0n) return null
  let given = 0n
  return weights.map((weight, index) => {
    const part = index === weights.length - 1 ? amount - given : share(amount, weight, total)
    given += part
    return part
  })
}

async function draftValues(ctx: Ctx, args: Row, existing: Row | undefined, scale: number) {
  const today = await companyCivilDate(ctx)
  const date = String(args.date ?? existing?.date ?? today)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw refuse('date', 'landedCostDate')
  const vendorId = args.vendorId === undefined ? (existing?.vendorId ?? null) : args.vendorId || null
  if (vendorId && !(await ctx.db.select('partner.Partner', { id: vendorId }))[0])
    throw refuse('vendorId', 'landedCostVendor')
  const pickingIds = [
    ...new Set(
      ((args.pickingIds === undefined ? (existing?.pickingIds ?? []) : args.pickingIds) as unknown[]).map(
        String,
      ),
    ),
  ]
  const landable = new Set((await landableReceipts(ctx)).map((row) => String(row.id)))
  if (pickingIds.some((id) => !landable.has(id))) throw refuse('pickingIds', 'landedCostReceipt')
  const lines = args.lines === undefined ? undefined : ((args.lines ?? []) as Row[])
  if (lines && lines.length > MAX_LINES) throw refuse('lines', 'landedCostTooManyLines')
  const exact = new RegExp(`^\\d{1,15}${scale ? `(\\.\\d{1,${scale}})?` : ''}$`)
  const checked = lines?.map((line, index) => {
    const name = String(line.name ?? '').trim()
    if (!name) throw refuse(`lines.${index}.name`, 'landedCostLineName')
    const splitMethod = String(line.splitMethod ?? 'quantity')
    if (!(SPLIT_METHODS as readonly string[]).includes(splitMethod))
      throw refuse(`lines.${index}.splitMethod`, 'landedCostSplit')
    const text = String(line.amount ?? '')
      .trim()
      .replace(/\s/g, '')
    const amount = exact.test(text) ? moneyMinor(text, scale) : 0n
    if (amount <= 0n) throw refuse(`lines.${index}.amount`, 'landedCostAmount')
    return { name: name.slice(0, 200), splitMethod, amount: minorText(amount, scale) }
  })
  return { values: { date, vendorId, pickingIds }, lines: checked }
}

const currencyOf = async (ctx: Ctx) =>
  (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null

/** Whom a cost owes and which receipts it lands on, by name, so its readers need no other list. */
async function namesOf(ctx: Ctx, costs: Row[]) {
  const vendors = new Map<string, string>()
  for (const id of new Set(
    costs
      .map((cost) => cost.vendorId)
      .filter(Boolean)
      .map(String),
  )) {
    const partner = (await ctx.db.select('partner.Partner', { id }))[0]
    if (partner) vendors.set(id, String(partner.name))
  }
  const pickings = new Map(
    (await ours(ctx, 'stock.Picking', { state: 'done' })).map((row) => [String(row.id), String(row.name)]),
  )
  return (cost: Row) => ({
    vendorName: cost.vendorId ? (vendors.get(String(cost.vendorId)) ?? null) : null,
    receipts: ((cost.pickingIds as unknown[] | null) ?? []).map((id) => ({
      id: String(id),
      name: pickings.get(String(id)) ?? String(id),
    })),
  })
}

export async function listLandedCostsHandler(ctx: Ctx) {
  const scale = await scaleFor(ctx)
  const currency = await currencyOf(ctx)
  const lines = await ours(ctx, 'stock.LandedCostLine')
  const costs = await ours(ctx, 'stock.LandedCost')
  const named = await namesOf(ctx, costs)
  return costs.map((cost) => ({
    ...cost,
    ...named(cost),
    currency,
    total: minorText(
      lines
        .filter((line) => line.landedCostId === cost.id)
        .reduce((sum, line) => sum + moneyMinor(line.amount, scale), 0n),
      scale,
    ),
  }))
}

export async function getLandedCostHandler(ctx: Ctx, args: Row) {
  const cost = (await ours(ctx, 'stock.LandedCost', { id: args.id }))[0]
  if (!cost) return null
  const scale = await scaleFor(ctx)
  const lines = (await ours(ctx, 'stock.LandedCostLine', { landedCostId: cost.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  )
  return {
    ...cost,
    ...(await namesOf(ctx, [cost]))(cost),
    // The company's own day it was posted on, as its entry is dated.
    postedDate: cost.postedAt ? await companyCivilDate(ctx, String(cost.postedAt)) : null,
    currency: await currencyOf(ctx),
    lines,
    allocations: await ours(ctx, 'stock.LandedCostAllocation', { landedCostId: cost.id }),
    total: minorText(
      lines.reduce((sum, line) => sum + moneyMinor(line.amount, scale), 0n),
      scale,
    ),
  }
}

/** The receipts a cost may land on; `pickingId` asks of that one alone (a receipt's own page). */
export async function listLandableReceiptsHandler(ctx: Ctx, args: Row = {}) {
  const scale = await scaleFor(ctx)
  const names = new Map<string, string | null>()
  const nameOf = async (id: unknown) => {
    if (!id) return null
    if (!names.has(String(id)))
      names.set(String(id), String((await ctx.db.select('partner.Partner', { id }))[0]?.name ?? '') || null)
    return names.get(String(id)) ?? null
  }
  const rows = await landableReceipts(ctx, args.pickingId)
  const partners = await Promise.all(rows.map((row) => nameOf(row.partnerId)))
  return rows.map((row, index) => ({
    ...row,
    partnerName: partners[index],
    moves: (row.moves as Row[]).map((move) => ({
      ...move,
      units: unitsText(move.units as bigint),
      value: minorText(move.value as bigint, scale),
    })),
  }))
}

/**
 * Whom a landed cost may be owed to: any active partner (a carrier, a customs broker), not only those that
 * supply goods, read by who drafts the cost rather than through the contact book's own grants.
 */
export async function listLandedCostVendorsHandler(ctx: Ctx, args: Row) {
  const fold = (value: unknown) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[đĐ]/gu, 'd')
      .toLowerCase()
  const search = fold(args.search).trim()
  const ids = new Set(((args.ids as unknown[] | null) ?? []).map(String))
  // The company does not owe itself.
  const own = new Set((await ctx.db.select('company.Company')).map((row) => String(row.partnerId)))
  return (await ctx.db.select('partner.Partner', { active: true }))
    .filter((row) => !own.has(String(row.id)))
    .filter((row) => (ids.size ? ids.has(String(row.id)) : !search || fold(row.name).includes(search)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))
    .slice(0, Math.max(1, Math.min(50, Number(args.limit) || 20)))
    .map((row) => ({ id: String(row.id), name: String(row.name) }))
}

/** Saves a draft: its vendor, day, receipts and up to 20 costs, each with how it spreads. */
export async function saveLandedCostHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const scale = await scaleFor(tx)
      const existing = (await ours(tx, 'stock.LandedCost', { id: args.id }))[0]
      if (existing) {
        const lock = await tx.db.compareAndSet(
          'stock.LandedCost',
          { id: args.id },
          { state: 'draft' },
          { state: 'draft' },
        )
        if (!('dryRun' in lock) && !lock.matched) throw refuse('id', 'landedCostNotDraft')
      }
      const { values, lines } = await draftValues(tx, args, existing, scale)
      if (existing) await tx.db.update('stock.LandedCost', { id: args.id }, values)
      else
        await tx.db.insert('stock.LandedCost', {
          id: args.id,
          ...values,
          name: await nextName(tx, values.date),
          state: 'draft',
          createdAt: new Date().toISOString(),
          createdBy: tx.actor ?? null,
        })
      if (lines) {
        const L = tx.table('stock.LandedCostLine')
        await tx.db.del(
          deleteFrom(L).where(and(eq(L.companyId, tx.scope.company), eq(L.landedCostId, String(args.id)))),
        )
        for (const [index, line] of lines.entries())
          await tx.db.insert('stock.LandedCostLine', {
            id: `${String(args.id)}:${index + 1}`,
            landedCostId: args.id,
            ...line,
            sequence: index + 1,
          })
      }
      return { ok: true, id: args.id }
    }),
  )
}

/**
 * K64: posts a draft. Each cost spreads over the valued lines of its receipts by quantity, value or evenly;
 * the share of what a line brought that is still held raises the goods account and the product's average
 * cost, the share of what has already left goes to the cost of sales, and the vendor of the service is owed
 * the whole, in one stock-journal entry dated today.
 */
export async function postLandedCostHandler(ctx: Ctx, args: Row) {
  return run(() =>
    ctx.tx(async (tx) => {
      const cost = (await ours(tx, 'stock.LandedCost', { id: args.id }))[0]
      if (!cost) throw refuse('id', 'landedCostMissing')
      if (cost.state === 'posted') return { ok: true, id: cost.id }
      if (cost.state !== 'draft') throw refuse('id', 'landedCostNotDraft')
      if (!cost.vendorId) throw refuse('vendorId', 'landedCostVendor')
      const scale = await scaleFor(tx)
      const lines = (await ours(tx, 'stock.LandedCostLine', { landedCostId: cost.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      if (!lines.length) throw refuse('lines', 'landedCostNoLines')
      const chosen = new Set((cost.pickingIds as unknown[] | null)?.map(String) ?? [])
      const receipts = (await landableReceipts(tx)).filter((row) => chosen.has(String(row.id)))
      // A completed receipt that was landable when the draft was saved still is.
      if (!receipts.length) throw refuse('pickingIds', 'landedCostReceipt')
      const targets = receipts.flatMap((receipt) =>
        (receipt.moves as Row[]).map(
          (move): Row => ({ ...move, pickingId: receipt.id, pickingName: receipt.name }),
        ),
      )
      const setting = await stockJournalSetting(tx)
      if (setting && (!setting.valuationAccountId || !setting.cogsAccountId || !setting.supplierAccountId))
        throw refuse('id', 'valuationAccountMissing')
      const lefts = new Map<string, Map<string, bigint>>()
      const leftOf = async (productId: string) => {
        if (!lefts.has(productId)) lefts.set(productId, await leftOfMoves(tx, productId))
        return lefts.get(productId)!
      }
      const allocations: Row[] = []
      for (const line of lines) {
        const weights = targets.map((target) =>
          line.splitMethod === 'value'
            ? (target.value as bigint)
            : line.splitMethod === 'equal'
              ? 1n
              : (target.units as bigint),
        )
        const parts = splitAmount(moneyMinor(line.amount, scale), weights)
        if (!parts) throw refuse('lines', 'landedCostSplit')
        for (const [index, target] of targets.entries()) {
          const amount = parts[index]!
          if (amount === 0n) continue
          // What is left of a line is never more than it brought.
          const left = (await leftOf(String(target.productId))).get(String(target.id)) ?? 0n
          const stockAmount = share(amount, left, target.units as bigint)
          allocations.push({
            id: `${String(cost.id)}:${String(line.id)}:${String(target.id)}`,
            landedCostId: cost.id,
            lineId: line.id,
            lineName: line.name,
            pickingId: target.pickingId,
            pickingName: target.pickingName,
            moveId: target.id,
            productId: target.productId,
            productUomId: target.productUomId,
            amount,
            stockAmount,
            cogsAmount: amount - stockAmount,
          })
        }
      }
      // The value held of each product rises by what landed on goods still held; its average follows.
      const raised = new Map<string, bigint>()
      for (const row of allocations)
        raised.set(
          String(row.productId),
          (raised.get(String(row.productId)) ?? 0n) + (row.stockAmount as bigint),
        )
      for (const [productId, amount] of raised) {
        if (amount === 0n) continue
        const held = (await ours(tx, 'stock.ProductValuation', { productId }))[0]
        if (!held) throw refuse('pickingIds', 'landedCostReceipt')
        const nextValue = moneyMinor(held.value, scale) + amount
        const changed = await tx.db.compareAndSet(
          'stock.ProductValuation',
          { id: held.id },
          { revision: held.revision },
          { value: minorText(nextValue, scale), revision: Number(held.revision ?? 0) + 1 },
        )
        if (!('dryRun' in changed) && !changed.matched) throw refuse('id', 'valuationChanged')
        const heldUnits = units(held.quantity)
        if (heldUnits > 0n) {
          const average = minorText(share(nextValue, 1_000_000n, heldUnits), scale)
          const catalogue = (await ours(tx, 'product.Cost', { productId }))[0]
          if (catalogue) await tx.db.update('product.Cost', { id: catalogue.id }, { standardPrice: average })
          else
            await tx.db.insert('product.Cost', {
              id: `${String(tx.scope.company)}:${productId}`,
              productId,
              standardPrice: average,
            })
        }
      }
      const date = new Date().toISOString()
      const accountMoveId = setting ? `stock-landed-cost:${String(cost.id)}` : null
      for (const row of allocations) {
        await tx.db.insert('stock.LandedCostAllocation', {
          id: row.id,
          landedCostId: cost.id,
          lineId: row.lineId,
          pickingId: row.pickingId,
          moveId: row.moveId,
          productId: row.productId,
          amount: minorText(row.amount as bigint, scale),
          stockAmount: minorText(row.stockAmount as bigint, scale),
          cogsAmount: minorText(row.cogsAmount as bigint, scale),
        })
        // No picking on the layer, as an adjustment: the receipt's own value and print keep what it came at.
        if ((row.stockAmount as bigint) !== 0n)
          await tx.db.insert('stock.ValuationLayer', {
            id: `landed:${String(row.id)}`,
            productId: row.productId,
            pickingId: null,
            moveId: row.moveId,
            moveLineId: null,
            kind: 'landed',
            quantity: unitsText(0n),
            value: minorText(row.stockAmount as bigint, scale),
            unitCost: null,
            accountMoveId,
            date,
          })
      }
      if (setting)
        await postStockEntry(
          tx,
          { id: accountMoveId!, ref: String(cost.name), date, partnerId: cost.vendorId },
          allocations.flatMap((row) =>
            (
              [
                ['stock', row.stockAmount, setting.valuationAccountId],
                ['cogs', row.cogsAmount, setting.cogsAccountId],
              ] as const
            )
              .filter(([, amount]) => (amount as bigint) !== 0n)
              .map(([part, amount, account]) => ({
                key: `${String(row.id)}:${part}`,
                name: `${String(row.lineName)} · ${String(row.pickingName)}`,
                productId: row.productId,
                productUomId: row.productUomId ?? null,
                quantity: unitsText(0n),
                priceUnit: null,
                amount: amount as bigint,
                debitAccount: String(account),
                creditAccount: String(setting.supplierAccountId),
              })),
          ),
          scale,
        )
      const done = await tx.db.compareAndSet(
        'stock.LandedCost',
        { id: cost.id },
        { state: 'draft' },
        { state: 'posted', postedAt: date, postedBy: tx.actor ?? null, accountMoveId },
      )
      if (!('dryRun' in done) && !done.matched) throw refuse('id', 'landedCostNotDraft')
      return { ok: true, id: cost.id }
    }),
  )
}

/** Drops a draft that will not be posted; the reason stays on it. A posted cost is reversed in accounting. */
export async function cancelLandedCostHandler(ctx: Ctx, args: Row) {
  return run(async () => {
    const cost = (await ours(ctx, 'stock.LandedCost', { id: args.id }))[0]
    if (!cost) throw refuse('id', 'landedCostMissing')
    if (cost.state === 'cancel') return { ok: true, id: cost.id }
    const reason = String(args.reason ?? '').trim()
    if (!reason) throw refuse('reason', 'landedCostCancelReason')
    const done = await ctx.db.compareAndSet(
      'stock.LandedCost',
      { id: cost.id },
      { state: 'draft' },
      { state: 'cancel', cancelReason: reason.slice(0, 500), cancelledBy: ctx.actor ?? null },
    )
    if (!('dryRun' in done) && !done.matched) throw refuse('id', 'landedCostNotDraft')
    return { ok: true, id: cost.id }
  })
}

const READ_EFFECTS = [
  'read:stock.LandedCost',
  'read:stock.LandedCostLine',
  'read:stock.LandedCostAllocation',
  'read:stock.Picking',
  'read:stock.Move',
  'read:stock.ValuationLayer',
  'read:company.Company',
  'read:partner.Partner',
]

export const landedCostFunctions: Record<string, FnSpec> = {
  listLandedCosts: defineFn({ input: {}, effects: READ_EFFECTS, handler: listLandedCostsHandler }),
  getLandedCost: defineFn({ input: { id: 'id' }, effects: READ_EFFECTS, handler: getLandedCostHandler }),
  listLandableReceipts: defineFn({
    input: { pickingId: 'id?' },
    effects: READ_EFFECTS,
    handler: listLandableReceiptsHandler,
  }),
  listLandedCostVendors: defineFn({
    input: { search: 'text?', limit: 'int?', ids: 'json?' },
    effects: ['read:partner.Partner', 'read:company.Company'],
    handler: listLandedCostVendorsHandler,
  }),
  saveLandedCost: defineFn({
    input: { id: 'id', vendorId: 'id?', date: 'text?', pickingIds: 'json?', lines: 'json?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...READ_EFFECTS, 'write:stock.LandedCost', 'write:stock.LandedCostLine'],
    // The cost's own id makes a retried save write it once.
    idempotent: true,
    handler: saveLandedCostHandler,
  }),
  postLandedCost: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        ...VALUATION_EFFECTS,
        ...READ_EFFECTS,
        'write:stock.LandedCost',
        'write:stock.LandedCostAllocation',
      ]),
    ],
    idempotent: true,
    handler: postLandedCostHandler,
  }),
  cancelLandedCost: defineFn({
    input: { id: 'id', reason: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...READ_EFFECTS, 'write:stock.LandedCost'],
    idempotent: true,
    handler: cancelLandedCostHandler,
  }),
}
