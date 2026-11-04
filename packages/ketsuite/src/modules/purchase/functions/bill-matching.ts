import { deleteFrom, eq, defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { BILL_MATCH_READS, billMatch } from '../bill-matching.ts'
import { now } from './shared.ts'

const LIST_LIMIT = 200
const REASON_LIMIT = 500

const refuse = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `purchase.error.bill.${code}` }],
})

const vendorBill = async (ctx: Ctx, id: unknown) => {
  const move = (await ctx.db.select('account.Move', { id }))[0]
  return move?.moveType === 'in_invoice' ? move : null
}

export async function getBillMatchHandler(ctx: Ctx, args: Row) {
  const move = await vendorBill(ctx, args.id)
  return move ? billMatch(ctx, move) : null
}

/** Each listed vendor bill's matching state and whether it is on hold, for the bill list. */
export async function listBillMatchesHandler(ctx: Ctx, args: Row) {
  const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).map(String))].slice(0, LIST_LIMIT)
  const rows: Row[] = []
  for (const id of ids) {
    const move = await vendorBill(ctx, id)
    if (!move) continue
    const match = await billMatch(ctx, move)
    rows.push({ id, status: match.status, held: match.hold !== null })
  }
  return rows
}

/** Puts a draft vendor bill on hold with the reason the vendor has to correct. */
export async function holdBillHandler(ctx: Ctx, args: Row) {
  const reason = String(args.reason ?? '').trim()
  if (!reason) return refuse('reason', 'reasonRequired')
  if (reason.length > REASON_LIMIT) return refuse('reason', 'reasonLength')
  return ctx.tx(async (tx) => {
    const move = await vendorBill(tx, args.id)
    if (!move) return refuse('id', 'missing')
    if (move.state !== 'draft') return refuse('id', 'notDraft')
    const values = { reason, heldBy: tx.actor ?? null, heldAt: now() }
    const inserted = await tx.db.insertIfAbsent('purchase.BillHold', {
      id: String(move.id),
      moveId: move.id,
      ...values,
    })
    if (!('dryRun' in inserted) && !inserted.inserted) {
      const held = (await tx.db.select('purchase.BillHold', { moveId: move.id }))[0]
      // Holding again with the same reason changes nothing; another reason replaces it.
      if (held && held.reason !== reason) await tx.db.update('purchase.BillHold', { id: held.id }, values)
    }
    return { ok: true, id: String(move.id) }
  })
}

export async function releaseBillHandler(ctx: Ctx, args: Row) {
  const move = await vendorBill(ctx, args.id)
  if (!move) return refuse('id', 'missing')
  const H = ctx.table('purchase.BillHold')
  await ctx.db.del(deleteFrom(H).where(eq(H.moveId, String(move.id))))
  return { ok: true, id: String(move.id) }
}

const holdEffects = ['read:account.Move', 'read:purchase.BillHold', 'write:purchase.BillHold'] as const

export const billMatchingFunctions: Record<string, FnSpec> = {
  getBillMatch: defineFn({
    input: { id: 'id' },
    effects: [...BILL_MATCH_READS],
    agent: true,
    handler: getBillMatchHandler,
  }),
  listBillMatches: defineFn({
    input: { ids: 'json' },
    effects: [...BILL_MATCH_READS],
    agent: true,
    handler: listBillMatchesHandler,
  }),
  holdBill: defineFn({
    input: { id: 'id', reason: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...holdEffects],
    idempotent: true,
    agent: true,
    handler: holdBillHandler,
  }),
  releaseBill: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...holdEffects],
    idempotent: true,
    agent: true,
    handler: releaseBillHandler,
  }),
}
