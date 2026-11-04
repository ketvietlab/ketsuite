import type { Ctx, Row } from '@ketvietlab/ketjs'
import { DraftMoveBoundaryError, insertDraftMove } from '../account/draft-moves.ts'
import { minorText, moneyMinor as exactMinor, scaleOf } from '../account/money.ts'
import { postMoveById } from '../account/posting.ts'
import { InventoryRefused } from './inventory-validation.ts'
import { ours } from './scope.ts'
import { isStorable } from './stock-ledger.ts'

/**
 * Perpetual weighted-average valuation (K4, K22–K24). The company holds one average cost per product
 * across every warehouse: receipts add their value, issues take their proportional share, and the last
 * units out take all that is left so the goods account keeps no remainder. Transfers between owned
 * locations move no value. When accounting is installed and configured, each valued operation posts one
 * stock-journal entry owned by stock.
 */
export const VALUATION_EFFECTS = [
  'read:stock.ValuationLayer',
  'write:stock.ValuationLayer',
  'read:stock.ProductValuation',
  'write:stock.ProductValuation',
  'read:stock.AccountingSetting',
  'read:stock.Quant',
  'read:stock.Location',
  'read:product.Cost',
  'write:product.Cost',
  'read:product.Product',
  'read:product.Template',
  'read:company.Company',
  'read:account.Move',
  'write:account.Move',
  'read:account.MoveLine',
  'write:account.MoveLine',
  'read:account.Journal',
  'write:account.Journal',
  'read:account.Account',
  'read:account.PeriodPolicy',
  'write:account.PeriodPolicy',
  'write:account.AuditEvent',
]

export const OWNED = ['internal', 'transit']
const INBOUND: ValuationKind[] = ['receipt', 'production', 'return', 'gain', 'scrap_return']

/**
 * A transfer as the warehouse sees it. Prices and values travel only through `getPickingValuation`,
 * which needs the valuation right (K25); the storekeeper's reads never carry them.
 */
export const withoutCosts = (row: Row): Row => {
  const { priceUnit: _price, unitCost: _cost, value: _value, ...rest } = row
  return rest
}
/** Drivers hand decimals back as text or numbers; money math takes exact text. */
export const moneyMinor = (value: unknown, scale: number): bigint =>
  exactMinor(
    typeof value === 'number' ? value.toFixed(Math.max(scale, 6)) : String(value ?? '0').trim() || '0',
    scale,
  )
/** Quantities are exact to six decimals, matching the stock ledger's tolerance. */
const UNIT = 1_000_000n
export const units = (value: unknown): bigint => {
  const text = String(value ?? '0').trim()
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = text.replace(/^[-+]/, '').split('.')
  const scaled = BigInt(whole || '0') * UNIT + BigInt((fraction + '000000').slice(0, 6) || '0')
  return negative ? -scaled : scaled
}
export const unitsText = (value: bigint): string => {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const fraction = String(magnitude % UNIT)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return `${negative ? '-' : ''}${magnitude / UNIT}${fraction ? `.${fraction}` : ''}`
}
/** round(numerator × multiplier ÷ divisor), half away from zero. */
export const share = (numerator: bigint, multiplier: bigint, divisor: bigint): bigint => {
  if (divisor === 0n) return 0n
  const product = numerator * multiplier
  const negative = product < 0n !== divisor < 0n
  const magnitude = (product < 0n ? -product : product) * 2n + (divisor < 0n ? -divisor : divisor)
  const rounded = magnitude / (2n * (divisor < 0n ? -divisor : divisor))
  return negative ? -rounded : rounded
}

/** Value of `quantity` units at an exact per-unit cost, rounded once at currency scale. */
export const priced = (cost: unknown, quantity: bigint, scale: number): bigint =>
  share(moneyMinor(cost, scale + 6), quantity, UNIT * 1_000_000n)

export type ValuationKind =
  | 'receipt'
  | 'production'
  | 'return'
  | 'gain'
  | 'delivery'
  | 'vendor_return'
  | 'consumption'
  | 'loss'
  | 'scrap'
  | 'scrap_return'

const counterpartField: Record<ValuationKind, string> = {
  receipt: 'supplierAccountId',
  vendor_return: 'supplierAccountId',
  production: 'productionAccountId',
  consumption: 'productionAccountId',
  delivery: 'cogsAccountId',
  return: 'cogsAccountId',
  gain: 'gainAccountId',
  loss: 'lossAccountId',
  // K59: scrapped goods are a cost of goods, and undoing a scrap brings that cost back.
  scrap: 'cogsAccountId',
  scrap_return: 'cogsAccountId',
}

/** Which way value moves between two location usages, or null when it stays inside the company. */
export function valuationKind(source: unknown, destination: unknown): ValuationKind | null {
  const from = String(source ?? '')
  const to = String(destination ?? '')
  const inbound = !OWNED.includes(from) && OWNED.includes(to)
  const outbound = OWNED.includes(from) && !OWNED.includes(to)
  if (inbound)
    return from === 'supplier'
      ? 'receipt'
      : from === 'production'
        ? 'production'
        : from === 'customer'
          ? 'return'
          : from === 'inventory'
            ? 'gain'
            : from === 'scrap'
              ? 'scrap_return'
              : null
  if (outbound)
    return to === 'customer'
      ? 'delivery'
      : to === 'supplier'
        ? 'vendor_return'
        : to === 'production'
          ? 'consumption'
          : to === 'inventory'
            ? 'loss'
            : to === 'scrap'
              ? 'scrap'
              : null
  return null
}

const refuse = (key: string) =>
  new InventoryRefused({ ok: false, errors: [{ field: 'id', messageKey: `stock.error.${key}` }] })

const settingId = (ctx: Ctx) => `stock-accounting:${String(ctx.scope.company)}`
export async function accountingSettingOf(ctx: Ctx): Promise<Row | null> {
  return (await ours(ctx, 'stock.AccountingSetting', { id: settingId(ctx) }))[0] ?? null
}
export const accountingSettingKey = settingId

export async function scaleFor(ctx: Ctx): Promise<number> {
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  return scaleOf(company?.currency ?? 'VND')
}

const valuationId = (ctx: Ctx, productId: unknown) => `${String(ctx.scope.company)}:${String(productId)}`

async function catalogueCost(ctx: Ctx, productId: unknown): Promise<string | null> {
  const cost = (await ours(ctx, 'product.Cost', { productId }))[0]
  return cost?.standardPrice == null ? null : String(cost.standardPrice)
}

/**
 * Open a product's running value from what owned locations hold now at its catalogue cost. Callers prime
 * every product an operation touches before moving any quantity, so the opening reflects the stock that
 * existed before the operation.
 */
export async function primeValuation(ctx: Ctx, productIds: Iterable<unknown>): Promise<void> {
  const scale = await scaleFor(ctx)
  for (const productId of new Set([...productIds].map(String))) {
    if (!(await isStorable(ctx, productId))) continue
    if ((await ours(ctx, 'stock.ProductValuation', { productId }))[0]) continue
    const locations = new Map(
      (await ours(ctx, 'stock.Location')).map((row) => [String(row.id), String(row.usage)] as const),
    )
    let held = 0n
    for (const quant of await ours(ctx, 'stock.Quant', { productId }))
      if (OWNED.includes(locations.get(String(quant.locationId)) ?? '')) held += units(quant.quantity)
    const cost = (await catalogueCost(ctx, productId)) ?? '0'
    const value = held > 0n ? priced(cost, held, scale) : 0n
    const id = valuationId(ctx, productId)
    await ctx.db.insertIfAbsent('stock.ProductValuation', {
      id,
      productId,
      quantity: unitsText(held > 0n ? held : 0n),
      value: minorText(held > 0n ? value : 0n, scale),
      revision: 0,
    })
    if (held > 0n)
      await ctx.db.insertIfAbsent('stock.ValuationLayer', {
        id: `${id}:opening`,
        productId,
        pickingId: null,
        moveId: null,
        moveLineId: null,
        kind: 'opening',
        quantity: unitsText(held),
        value: minorText(value, scale),
        unitCost: cost,
        accountMoveId: null,
        date: new Date().toISOString(),
      })
  }
}

export type ValuationEntry = {
  /** Stable id of the moved quantity: a move line, or a move for direct writes. */
  key: string
  productId: unknown
  productUomId?: unknown
  moveId?: unknown
  moveLineId?: unknown
  quantity: number | string
  sourceUsage: unknown
  destinationUsage: unknown
  /** Receipt price per unit (K24); blank falls back to the current average, then the catalogue cost. */
  unitCost?: unknown
  /** K19: what the delivery being returned moved, so the goods come back at the value they left with. */
  returnOf?: { value: unknown; quantity: unknown }
  name?: string
}

export type ValuedLine = { key: string; kind: ValuationKind; value: string; unitCost: string }

/** K19: the value and quantity a completed move took out, or nothing when it was never valued. */
export async function deliveredValue(
  ctx: Ctx,
  moveId: unknown,
): Promise<{ value: string; quantity: string } | undefined> {
  const lines = (await ours(ctx, 'stock.MoveLine', { moveId })).filter((line) => Number(line.quantity) > 0)
  if (!lines.length || lines.some((line) => line.value == null)) return undefined
  const scale = await scaleFor(ctx)
  let value = 0n
  let quantity = 0n
  for (const line of lines) {
    value += moneyMinor(line.value, scale)
    quantity += units(line.quantity)
  }
  return { value: minorText(value, scale), quantity: unitsText(quantity) }
}

/** Value each entry in order, update averages and post one stock-journal entry for the operation. */
export async function valueOperation(
  ctx: Ctx,
  operation: { id: string; name: string; partnerId?: unknown; date: string },
  entries: ValuationEntry[],
): Promise<ValuedLine[]> {
  const scale = await scaleFor(ctx)
  const valued: Array<ValuedLine & { entry: ValuationEntry }> = []
  for (const entry of entries) {
    const kind = valuationKind(entry.sourceUsage, entry.destinationUsage)
    const quantity = units(entry.quantity)
    if (!kind || quantity <= 0n || !(await isStorable(ctx, entry.productId))) continue
    await primeValuation(ctx, [entry.productId])
    const id = valuationId(ctx, entry.productId)
    const held = (await ours(ctx, 'stock.ProductValuation', { id }))[0]!
    const heldUnits = units(held.quantity)
    const heldValue = moneyMinor(held.value, scale)
    const fallback =
      heldUnits > 0n
        ? minorText(share(heldValue, UNIT, heldUnits), scale)
        : ((await catalogueCost(ctx, entry.productId)) ?? '0')
    let value: bigint
    let unitCost: string
    const inbound = INBOUND.includes(kind)
    const delivered =
      ['return', 'scrap_return'].includes(kind) && entry.returnOf ? units(entry.returnOf.quantity) : 0n
    if (delivered > 0n) {
      value = share(moneyMinor(entry.returnOf!.value, scale), quantity, delivered)
      unitCost = minorText(share(value, UNIT, quantity), scale)
    } else if (inbound) {
      const agreed = ['receipt', 'production'].includes(kind) ? String(entry.unitCost ?? '').trim() : ''
      unitCost = agreed || fallback
      value = priced(unitCost, quantity, scale)
    } else {
      // The last units out take all the value left so the goods account keeps no remainder.
      value =
        heldUnits <= 0n
          ? priced(fallback, quantity, scale)
          : quantity >= heldUnits
            ? heldValue + priced(fallback, quantity - heldUnits, scale)
            : share(heldValue, quantity, heldUnits)
      unitCost = minorText(share(value, UNIT, quantity), scale)
    }
    const nextUnits = heldUnits + (inbound ? quantity : -quantity)
    const nextValue = heldValue + (inbound ? value : -value)
    const changed = await ctx.db.compareAndSet(
      'stock.ProductValuation',
      { id },
      { revision: held.revision },
      {
        quantity: unitsText(nextUnits),
        value: minorText(nextUnits === 0n ? 0n : nextValue, scale),
        revision: Number(held.revision ?? 0) + 1,
      },
    )
    if (!('dryRun' in changed) && !changed.matched) throw refuse('valuationChanged')
    // K22: whatever comes in (a receipt, a return, a count's surplus) sets the catalogue cost new sales
    // lines price from to the average it leaves.
    if (inbound && nextUnits > 0n) {
      const average = minorText(share(nextValue, UNIT, nextUnits), scale)
      const cost = (await ours(ctx, 'product.Cost', { productId: entry.productId }))[0]
      if (cost) await ctx.db.update('product.Cost', { id: cost.id }, { standardPrice: average })
      else
        await ctx.db.insert('product.Cost', {
          // Same id product.setCost writes, so later catalogue edits update this row.
          id: `${String(ctx.scope.company)}:${String(entry.productId)}`,
          productId: entry.productId,
          standardPrice: average,
        })
    }
    const signed = inbound ? value : -value
    await ctx.db.insert('stock.ValuationLayer', {
      id: `${operation.id}:${entry.key}`,
      productId: entry.productId,
      pickingId: operation.id,
      moveId: entry.moveId ?? null,
      moveLineId: entry.moveLineId ?? null,
      kind,
      quantity: unitsText(inbound ? quantity : -quantity),
      value: minorText(signed, scale),
      unitCost,
      accountMoveId: null,
      date: operation.date,
    })
    valued.push({ key: entry.key, kind, value: minorText(value, scale), unitCost, entry })
  }
  await postValuation(ctx, operation, valued, scale)
  return valued.map(({ entry: _entry, ...line }) => line)
}

async function postValuation(
  ctx: Ctx,
  operation: { id: string; name: string; partnerId?: unknown; date: string },
  valued: Array<ValuedLine & { entry: ValuationEntry }>,
  scale: number,
) {
  const posting = valued.filter((line) => moneyMinor(line.value, scale) !== 0n)
  if (!posting.length) return
  const setting = await stockJournalSetting(ctx)
  if (!setting) return
  const missing = (field: string) => !setting[field]
  if (missing('valuationAccountId') || posting.some((line) => missing(counterpartField[line.kind])))
    throw refuse('valuationAccountMissing')
  const moveId = `stock-valuation:${operation.id}`
  await postStockEntry(
    ctx,
    { id: moveId, ref: operation.name, date: operation.date, partnerId: operation.partnerId },
    posting.map((line) => {
      const goods = String(setting.valuationAccountId)
      const other = String(setting[counterpartField[line.kind]])
      const inbound = INBOUND.includes(line.kind)
      return {
        key: line.key,
        name: line.entry.name ?? operation.name,
        productId: line.entry.productId,
        productUomId: line.entry.productUomId ?? null,
        quantity: unitsText(units(line.entry.quantity)),
        priceUnit: line.unitCost,
        amount: moneyMinor(line.value, scale),
        debitAccount: inbound ? goods : other,
        creditAccount: inbound ? other : goods,
      }
    }),
    scale,
  )
  for (const line of posting)
    await ctx.db.update(
      'stock.ValuationLayer',
      { id: `${operation.id}:${line.key}` },
      { accountMoveId: moveId },
    )
}

/** The stock journal entry settings, when accounting is composed and a journal is chosen. */
export async function stockJournalSetting(ctx: Ctx): Promise<Row | null> {
  if (!ctx.manifest.models['account.Move']) return null
  const setting = await accountingSettingOf(ctx)
  return setting?.journalId ? setting : null
}

export type StockPosting = {
  key: string
  name: string
  productId: unknown
  productUomId?: unknown
  quantity: string
  priceUnit: string | null
  /** Positive, in minor units: what moves from the credit account to the debit one. */
  amount: bigint
  debitAccount: string
  creditAccount: string
  /** Whom each side is owed by or to, when not the entry's partner (null for none): a carrier holding a customer's cash. */
  debitPartnerId?: unknown
  creditPartnerId?: unknown
}

/** Posts one stock-journal entry of balanced pairs; a locked period or a refused draft refuses the operation. */
export async function postStockEntry(
  ctx: Ctx,
  move: {
    id: string
    ref: string
    date: string
    partnerId?: unknown
    /** Another journal than the stock one: a bank's, for what a carrier pays over. */
    journalId?: string
    /** The company's day the entry belongs to, when not the day of `date`. */
    accountingDate?: string
  },
  postings: StockPosting[],
  scale: number,
) {
  const setting = (await stockJournalSetting(ctx))!
  const lines: Row[] = []
  let sequence = 10
  for (const line of postings)
    for (const [side, accountId] of [
      ['debit', line.debitAccount],
      ['credit', line.creditAccount],
    ] as const) {
      const account = (await ctx.db.select('account.Account', { id: accountId }))[0]
      const balance = side === 'debit' ? line.amount : -line.amount
      lines.push({
        id: `${move.id}:${line.key}:${side}`,
        moveId: move.id,
        name: line.name,
        accountId,
        partnerId:
          (Object.hasOwn(line, `${side}PartnerId`) ? line[`${side}PartnerId`] : move.partnerId) ?? null,
        productId: line.productId,
        productUomId: line.productUomId ?? null,
        quantity: line.quantity,
        priceUnit: line.priceUnit,
        discount: '0',
        taxId: null,
        debit: minorText(side === 'debit' ? line.amount : 0n, scale),
        credit: minorText(side === 'credit' ? line.amount : 0n, scale),
        balance: minorText(balance, scale),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: minorText(account?.reconcile === true ? line.amount : 0n, scale),
        sequence: sequence++,
      })
    }
  const zero = minorText(0n, scale)
  try {
    await insertDraftMove(ctx, {
      move: {
        id: move.id,
        name: move.id,
        ref: move.ref,
        date: move.date,
        moveType: 'entry',
        sourceModule: 'stock',
        state: 'draft',
        journalId: move.journalId ?? setting.journalId,
        partnerId: move.partnerId ?? null,
        ...(move.accountingDate ? { accountingDate: move.accountingDate } : {}),
        invoiceDate: null,
        invoiceDateDue: null,
        paymentTermId: null,
        paymentState: 'not_paid',
        currency: (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency,
        amountUntaxed: zero,
        amountTax: zero,
        amountTotal: zero,
        postedAt: null,
        revision: 0,
      },
      lines,
    })
  } catch (error) {
    if (error instanceof DraftMoveBoundaryError) throw refuse('valuationPosting')
    throw error
  }
  const posted = await postMoveById(ctx, move.id, undefined, { inTransaction: true })
  if (posted.ok !== true) {
    const code = String(((posted.errors as Row[] | undefined) ?? [])[0]?.code ?? '')
    throw refuse(code === 'account.error.periodLocked' ? 'valuationPeriodLocked' : 'valuationPosting')
  }
}
