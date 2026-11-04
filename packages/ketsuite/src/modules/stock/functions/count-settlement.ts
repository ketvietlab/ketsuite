import { createHash } from 'node:crypto'
import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { claimPostingPeriod } from '../../account/period.ts'
import { InventoryRefused } from '../inventory-validation.ts'
import { ours } from '../scope.ts'
import {
  moneyMinor,
  postStockEntry,
  scaleFor,
  stockJournalSetting,
  VALUATION_EFFECTS,
  type StockPosting,
} from '../valuation.ts'

class SettlementRefused extends Error {
  readonly key: string
  readonly field: string
  constructor(key: string, field = 'settlements') {
    super(key)
    this.key = key
    this.field = field
  }
}
const refuse = (key: string, field?: string): never => {
  throw new SettlementRefused(key, field)
}

/** A complete line is settled once; the selected subset makes a partially settled session. */
export async function settleCountDifferenceHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const session = (await ours(tx, 'stock.CountSession', { id: args.sessionId }))[0]
      if (!session || session.state !== 'done') return refuse('countSettlementDone')
      await tx.db.compareAndSet(
        'stock.CountSession',
        { id: session.id },
        { state: 'done' },
        { state: 'done' },
      )
      const rows = args.lines
      if (!Array.isArray(rows) || !rows.length || rows.length > 200) return refuse('countSettlementLines')
      const normalized = rows
        .map((row) => ({
          lineId: String(row?.lineId ?? ''),
          method: String(row?.method ?? ''),
          partnerId: row?.partnerId ? String(row.partnerId) : null,
        }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId))
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([args.sessionId, args.accountingDate, normalized]))
        .digest('hex')
      const previous = (await ours(tx, 'stock.CountSettlement', { id: args.id }))[0]
      if (previous) {
        if (previous.fingerprint !== fingerprint) return refuse('countSettlementReplay')
        return { ok: true, id: session.id }
      }
      const date = String(args.accountingDate)
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date
      )
        return refuse('countSettlementDate', 'accountingDate')
      const setting = await stockJournalSetting(tx)
      const journal = setting ? (await tx.db.select('account.Journal', { id: setting.journalId }))[0] : null
      if (!setting || journal?.code !== 'KHO') return refuse('countSettlementJournal')
      if (
        await claimPostingPeriod(tx, {
          accountingDate: date,
          moveType: 'entry',
          journalType: journal.type,
          hasTax: false,
        })
      )
        return refuse('valuationPeriodLocked', 'accountingDate')
      const held = await ours(tx, 'stock.CountLine', { sessionId: session.id })
      const scale = await scaleFor(tx)
      const postings: StockPosting[] = []
      const seen = new Set<string>()
      const account = async (code: string) => {
        const row = (await tx.db.select('account.Account', { code }))[0]
        if (!row || row.active === false) return refuse('countSettlementAccount')
        return String(row.id)
      }
      for (const row of normalized) {
        const line = held.find((line) => line.id === row.lineId)
        if (
          !line ||
          seen.has(row.lineId) ||
          line.settlementId ||
          Number(line.counted) === Number(line.expected)
        )
          return refuse('countSettlementLines')
        seen.add(row.lineId)
        const shortage = Number(line.counted) < Number(line.expected)
        if (!(shortage ? ['632', '1388', '334', '811'] : ['711']).includes(row.method))
          return refuse('countSettlementMethod')
        const compensation = ['1388', '334'].includes(row.method)
        const partner = row.partnerId
          ? (await tx.db.select('partner.Partner', { id: row.partnerId }))[0]
          : null
        if (compensation && (!partner || partner.kind !== 'person' || partner.active === false))
          return refuse('countSettlementPerson')
        if (!compensation && row.partnerId) return refuse('countSettlementPerson')
        const layers = await ours(tx, 'stock.ValuationLayer', { moveLineId: `${row.lineId}:line` })
        if (!layers.length) return refuse('countSettlementValue')
        const signed = layers.reduce((total, layer) => total + moneyMinor(layer.value, scale), 0n)
        const amount = signed < 0n ? -signed : signed
        if (amount && layers.some((layer) => !layer.accountMoveId)) return refuse('countSettlementValue')
        const suspense = await account(shortage ? '13811' : '33811')
        const destination = await account(row.method)
        if (amount)
          postings.push({
            key: row.lineId,
            name: String(session.name),
            productId: line.productId,
            quantity: String(Math.abs(Number(line.counted) - Number(line.expected))),
            priceUnit: null,
            amount,
            debitAccount: shortage ? destination : suspense,
            creditAccount: shortage ? suspense : destination,
            debitPartnerId: compensation ? row.partnerId : null,
          })
      }
      const moveId = postings.length ? `count-settlement:${String(args.id)}` : null
      if (moveId)
        await postStockEntry(
          tx,
          { id: moveId, ref: String(session.name), date, accountingDate: date },
          postings,
          scale,
        )
      await tx.db.insert('stock.CountSettlement', {
        id: args.id,
        sessionId: session.id,
        fingerprint,
        accountingDate: date,
        accountMoveId: moveId,
        processedBy: ctx.actor ?? null,
        processedAt: new Date().toISOString(),
      })
      for (const row of normalized)
        await tx.db.update(
          'stock.CountLine',
          { id: row.lineId },
          {
            settlementId: args.id,
            settlementMethod: row.method,
            settlementPartnerId: row.partnerId,
          },
        )
      return { ok: true, id: session.id }
    })
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    if (error instanceof SettlementRefused)
      return { ok: false, errors: [{ field: error.field, messageKey: `stock.error.${error.key}` }] }
    throw error
  }
}

export async function listCountSettlementPeopleHandler(ctx: Ctx) {
  return (await ctx.db.select('partner.Partner', { kind: 'person', active: true })).map((row) => ({
    id: row.id,
    name: row.name,
  }))
}

/** Only the valuation reader receives this period-close warning; no balance leaks through count reads. */
export async function getCountSettlementWarningHandler(ctx: Ctx, args: Row) {
  const through = String(args.dateTo)
  const scale = await scaleFor(ctx)
  const sessions = await ours(ctx, 'stock.CountSession', { state: 'done' })
  const accounts = new Map((await ctx.db.select('account.Account')).map((row) => [row.id, row.code]))
  const pending: Row[] = []
  const allLayers = await ours(ctx, 'stock.ValuationLayer')
  for (const session of sessions) {
    const layers = allLayers.filter((row) =>
      [session.shortagePickingId, session.excessPickingId].includes(row.pickingId),
    )
    const settlements = await ours(ctx, 'stock.CountSettlement', { sessionId: session.id })
    const ids = new Set([...layers, ...settlements].map((row) => row.accountMoveId).filter(Boolean))
    let loss = 0n,
      gain = 0n
    for (const id of ids) {
      const move = (await ctx.db.select('account.Move', { id }))[0]
      if (!move || move.state !== 'posted' || String(move.accountingDate ?? move.date).slice(0, 10) > through)
        continue
      for (const line of await ctx.db.select('account.MoveLine', { moveId: id })) {
        const balance = moneyMinor(line.debit, scale) - moneyMinor(line.credit, scale)
        if (accounts.get(line.accountId) === '13811') loss += balance
        if (accounts.get(line.accountId) === '33811') gain += balance
      }
    }
    if (loss || gain) pending.push({ id: session.id, name: session.name })
  }
  return pending
}

export const countSettlementFunctions: Record<string, FnSpec> = {
  getCountSettlementWarning: defineFn({
    input: { dateTo: 'date' },
    effects: [
      'read:stock.CountSession',
      'read:stock.CountSettlement',
      'read:stock.ValuationLayer',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Account',
      'read:company.Company',
    ],
    handler: getCountSettlementWarningHandler,
  }),
  settleCountDifference: defineFn({
    input: { id: 'id', sessionId: 'id', accountingDate: 'date', lines: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    idempotent: true,
    effects: [
      ...VALUATION_EFFECTS,
      'read:stock.CountSession',
      'write:stock.CountSession',
      'read:stock.CountLine',
      'write:stock.CountLine',
      'read:stock.CountSettlement',
      'write:stock.CountSettlement',
      'read:partner.Partner',
    ],
    handler: settleCountDifferenceHandler,
  }),
  listCountSettlementPeople: defineFn({
    input: {},
    effects: ['read:partner.Partner'],
    handler: listCountSettlementPeopleHandler,
  }),
}
