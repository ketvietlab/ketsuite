import { randomUUID } from 'node:crypto'
import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { invalid, InventoryRefused } from '../inventory-validation.ts'
import { ours } from '../scope.ts'
import { claimStockConfiguration } from '../../product/stock-policy.ts'
import { lotDateFields, lotDateInput, lotDatePatch, LotRefused } from '../lot-policy.ts'
import { mutateQuant, reserveEffects, reserveMoveInContext } from '../stock-ledger.ts'

export async function listLotsHandler(ctx: Ctx, args: Row) {
  const rows = await ours(ctx, 'stock.Lot', args.productId ? { productId: args.productId } : {})
  const now = Date.now()
  return rows.filter((row) => {
    if (!args.status) return true
    if (args.status === 'quarantined') return row.quarantined === true
    const field = { alert: 'alertDate', removed: 'removalDate', expired: 'expirationDate' }[
      String(args.status)
    ]
    return field ? row[field] && new Date(String(row[field])).getTime() <= now : false
  })
}

/** The same product lock serializes date edits with reservations and stock movements. */
async function saveLot(ctx: Ctx, args: Row, createOnly = false) {
  try {
    return await ctx.tx(async (tx) => {
      const product = (await tx.db.select('product.Product', { id: args.productId }))[0]
      if (!product) return invalid('productId', 'biến thể không tồn tại')
      const template = (await tx.db.select('product.Template', { id: product.templateId }))[0]!
      await claimStockConfiguration(tx, template)
      const existing = (await ours(tx, 'stock.Lot', { id: args.id }))[0]
      if (createOnly && existing) throw new InventoryRefused(invalid('id', 'lot/serial đã tồn tại'))
      if (existing && args.expectedRevisionId != null && args.expectedRevisionId !== existing.revisionId)
        throw new LotRefused('expectedRevisionId', 'lotConflict')
      if (
        existing &&
        existing.productId !== args.productId &&
        (await ours(tx, 'stock.MoveLine', { lotId: args.id })).length
      )
        throw new LotRefused('productId', 'lotProductUsed')
      const dates = lotDatePatch(args, existing, template)
      const quarantined = args.quarantined ?? existing?.quarantined ?? false
      const quarantineChanged = Boolean(existing?.quarantined) !== quarantined
      const reason = String(args.reason ?? '').trim()
      if (quarantineChanged && !reason) throw new LotRefused('reason', 'lotReason')
      const active = args.active ?? existing?.active ?? true
      const policyChanged =
        !existing ||
        quarantineChanged ||
        active !== existing.active ||
        lotDateFields.some(
          (field) => Object.hasOwn(dates, field) && dates[field] !== (existing[field] ?? null),
        )
      const moves = policyChanged
        ? (await ours(tx, 'stock.Move', { productId: args.productId })).filter(
            (move) => !['done', 'cancel', 'draft'].includes(String(move.state)),
          )
        : []
      const pending: Array<{ move: Row; lines: Row[] }> = []
      for (const move of moves) {
        const lines = await ours(tx, 'stock.MoveLine', { moveId: move.id })
        if (lines.some((line) => line.picked)) {
          if (lines.some((line) => line.lotId === args.id))
            throw new LotRefused('expirationDate', 'lotPicked')
          continue
        }
        if (lines.length) pending.push({ move, lines })
      }
      const values: Row = { ...args, ...dates, active, quarantined, revisionId: randomUUID() }
      const changes = tx
        .change('stock.Lot', values, existing ?? null)
        .cast([
          'id',
          'productId',
          'name',
          'ref',
          'note',
          'active',
          'quarantined',
          'revisionId',
          'automaticDates',
          ...lotDateFields,
        ])
        .required(['productId', 'name'])
      if (!changes.valid) throw new InventoryRefused({ ok: false, errors: changes.errors })
      await tx.db.commit(changes, existing ? { id: args.id } : undefined)
      if ((existing && policyChanged) || (!existing && quarantined))
        await tx.db.insert('stock.LotHistory', {
          id: randomUUID(),
          lotId: args.id,
          at: new Date().toISOString(),
          actorId: tx.actor ?? null,
          reason: reason || 'dates',
          before: Object.fromEntries(
            [...lotDateFields, 'quarantined', 'active'].map((field) => [field, existing?.[field] ?? null]),
          ),
          after: Object.fromEntries(
            [...lotDateFields, 'quarantined', 'active'].map((field) => [
              field,
              Object.hasOwn(values, field) ? values[field] : (existing?.[field] ?? null),
            ]),
          ),
        })
      // Release first, then reassign in deterministic move order against the new FEFO dates.
      const Line = tx.table('stock.MoveLine')
      for (const { lines } of pending)
        for (const line of lines) {
          await mutateQuant(tx, {
            productId: line.productId,
            locationId: line.locationId,
            lotId: line.lotId,
            quantity: 0,
            reserved: -Number(line.quantity),
          })
          await tx.db.del(deleteFrom(Line).where(eq(Line.id, line.id)))
        }
      for (const { move } of pending.sort((a, b) => String(a.move.id).localeCompare(String(b.move.id)))) {
        const result = await reserveMoveInContext(tx, move)
        if (result.ok === false) throw new LotRefused('expirationDate', 'lotReservation')
      }
      return { ok: true, id: args.id }
    })
  } catch (error) {
    if (error instanceof LotRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}

export async function createLotHandler(ctx: Ctx, args: Row) {
  return saveLot(ctx, args, true)
}
export async function saveLotHandler(ctx: Ctx, args: Row) {
  return saveLot(ctx, args)
}
export async function listLotHistoryHandler(ctx: Ctx, args: Row) {
  return (await ours(ctx, 'stock.LotHistory', { lotId: args.lotId })).sort((a, b) =>
    String(b.at).localeCompare(String(a.at)),
  )
}
const effects = [...new Set([...reserveEffects, 'write:stock.Lot', 'write:stock.LotHistory'])]
const input = {
  id: 'id',
  productId: 'id',
  name: 'text',
  ref: 'text?',
  note: 'text?',
  ...lotDateInput,
  quarantined: 'bool?',
  reason: 'text?',
}
export const lotsFunctions: Record<string, FnSpec> = {
  listLots: defineFn({
    input: { productId: 'id?', status: 'text?' },
    effects: ['read:stock.Lot'],
    agent: true,
    handler: listLotsHandler,
  }),
  createLot: defineFn({
    input,
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects,
    idempotent: true,
    agent: true,
    handler: createLotHandler,
  }),
  saveLot: defineFn({
    input: { ...input, active: 'bool?', expectedRevisionId: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects,
    idempotent: true,
    agent: true,
    handler: saveLotHandler,
  }),
  listLotHistory: defineFn({
    input: { lotId: 'id' },
    effects: ['read:stock.LotHistory'],
    agent: true,
    handler: listLotHistoryHandler,
  }),
}
