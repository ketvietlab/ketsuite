import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { minorText } from '../../account/money.ts'
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

/**
 * K63: what an adjustment of a receipt's value is posted against: the vendor when the price was corrected,
 * the cost of sales when the goods have gone on, or other income and other costs.
 */
export const REVALUATION_ACCOUNTS = {
  supplier: 'supplierAccountId',
  cogs: 'cogsAccountId',
  gain: 'gainAccountId',
  loss: 'lossAccountId',
  // A production receipt settled after its order closes moves against work in progress (154).
  production: 'productionAccountId',
} as const
type Counterpart = keyof typeof REVALUATION_ACCOUNTS
const RECEIVING = ['receipt', 'production']

const refusal = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, messageKey: `stock.error.${key}` }],
})

/** The moves of a completed receipt that brought value in, which are the ones an adjustment may name. */
export async function revaluableMoves(ctx: Ctx, picking: Row): Promise<Row[]> {
  if (picking.state !== 'done') return []
  const scale = await scaleFor(ctx)
  const brought = new Map<string, bigint>()
  for (const layer of await ours(ctx, 'stock.ValuationLayer', { pickingId: picking.id }))
    if (RECEIVING.includes(String(layer.kind)) && layer.moveId)
      brought.set(
        String(layer.moveId),
        (brought.get(String(layer.moveId)) ?? 0n) + moneyMinor(layer.value, scale),
      )
  return (await ours(ctx, 'stock.Move', { pickingId: picking.id })).filter(
    (move) => (brought.get(String(move.id)) ?? 0n) > 0n,
  )
}

/**
 * K63: raises or lowers what a line of a completed receipt is worth, as when the vendor corrects the price.
 * The company's value held of the product and its average cost move by the amount, a revaluation layer
 * records it against the move, and the stock journal posts the goods account against the account chosen,
 * today. The value held may not fall below nought; a locked period refuses it.
 */
export async function revaluePickingHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return refusal('id', 'revaluationReceiptOnly')
  const id = String(args.revaluationId ?? '').trim()
  if (!id) return refusal('id', 'revaluationReceiptOnly')
  const known = (await ours(ctx, 'stock.Revaluation', { id }))[0]
  if (known)
    return known.pickingId === picking.id ? { ok: true, id } : refusal('id', 'revaluationReceiptOnly')
  const move = (await revaluableMoves(ctx, picking)).find((row) => row.id === args.moveId)
  if (!move) return refusal(picking.state === 'done' ? 'moveId' : 'id', 'revaluationReceiptOnly')
  const scale = await scaleFor(ctx)
  // A whole amount in the company currency, signed, with no more decimals than the currency keeps.
  const text = String(args.amount ?? '')
    .trim()
    .replace(/\s/g, '')
  const exact = new RegExp(`^-?\\d{1,15}${scale ? `(\\.\\d{1,${scale}})?` : ''}$`).test(text)
  const amount = exact ? moneyMinor(text, scale) : 0n
  if (amount === 0n) return refusal('amount', 'revaluationAmountInvalid')
  const account = String(args.account ?? '') as Counterpart
  if (!Object.hasOwn(REVALUATION_ACCOUNTS, account)) return refusal('account', 'revaluationAccountInvalid')
  const reason = String(args.reason ?? '').trim()
  if (!reason) return refusal('reason', 'revaluationReasonRequired')
  const held = (await ours(ctx, 'stock.ProductValuation', { productId: move.productId }))[0]
  const heldUnits = held ? units(held.quantity) : 0n
  const heldValue = held ? moneyMinor(held.value, scale) : 0n
  if (!held || heldUnits <= 0n) return refusal('moveId', 'revaluationNothingHeld')
  if (heldValue + amount < 0n) return refusal('amount', 'revaluationBelowZero')
  const setting = await stockJournalSetting(ctx)
  if (setting && (!setting.valuationAccountId || !setting[REVALUATION_ACCOUNTS[account]]))
    return refusal('account', 'valuationAccountMissing')
  const date = new Date().toISOString()
  try {
    await ctx.tx(async (tx) => {
      const nextValue = heldValue + amount
      const changed = await tx.db.compareAndSet(
        'stock.ProductValuation',
        { id: held.id },
        { revision: held.revision },
        { value: minorText(nextValue, scale), revision: Number(held.revision ?? 0) + 1 },
      )
      if (!('dryRun' in changed) && !changed.matched)
        throw new InventoryRefused(refusal('id', 'valuationChanged'))
      // The average cost follows the value held, as a receipt's does.
      const average = minorText(share(nextValue, 1_000_000n, heldUnits), scale)
      const cost = (await ours(tx, 'product.Cost', { productId: move.productId }))[0]
      if (cost) await tx.db.update('product.Cost', { id: cost.id }, { standardPrice: average })
      else
        await tx.db.insert('product.Cost', {
          id: `${String(tx.scope.company)}:${String(move.productId)}`,
          productId: move.productId,
          standardPrice: average,
        })
      const accountMoveId = setting ? `stock-revaluation:${id}` : null
      // No picking on the layer: the receipt's own valuation and print keep what it was received at.
      await tx.db.insert('stock.ValuationLayer', {
        id: `revaluation:${id}`,
        productId: move.productId,
        pickingId: null,
        moveId: move.id,
        moveLineId: null,
        kind: 'revaluation',
        quantity: unitsText(0n),
        value: minorText(amount, scale),
        unitCost: null,
        accountMoveId,
        date,
      })
      await tx.db.insert('stock.Revaluation', {
        id,
        pickingId: picking.id,
        moveId: move.id,
        productId: move.productId,
        amount: minorText(amount, scale),
        account,
        reason: reason.slice(0, 500),
        date,
        createdBy: ctx.actor ?? null,
        accountMoveId,
      })
      if (setting) {
        const goods = String(setting.valuationAccountId)
        const other = String(setting[REVALUATION_ACCOUNTS[account]])
        await postStockEntry(
          tx,
          { id: accountMoveId!, ref: String(picking.name), date, partnerId: picking.partnerId },
          [
            {
              key: 'revaluation',
              name: reason.slice(0, 500),
              productId: move.productId,
              productUomId: move.productUomId ?? null,
              quantity: unitsText(0n),
              priceUnit: null,
              amount: amount < 0n ? -amount : amount,
              debitAccount: amount > 0n ? goods : other,
              creditAccount: amount > 0n ? other : goods,
            },
          ],
          scale,
        )
      }
    })
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    throw error
  }
  return { ok: true, id }
}

/** K63: the adjustments made to a receipt, newest last, with the entry each posted. */
export async function pickingRevaluations(ctx: Ctx, picking: Row): Promise<Row[]> {
  const rows = (await ours(ctx, 'stock.Revaluation', { pickingId: picking.id })).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  )
  const out: Row[] = []
  for (const row of rows) {
    const product = (await ctx.db.select('product.Product', { id: row.productId }))[0]
    const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    const entry =
      row.accountMoveId && ctx.manifest.models['account.Move']
        ? (await ctx.db.select('account.Move', { id: row.accountMoveId }))[0]
        : undefined
    out.push({
      id: row.id,
      moveId: row.moveId,
      product: `${product?.defaultCode ? `[${String(product.defaultCode)}] ` : ''}${String(template?.name ?? '')}`,
      amount: row.amount,
      account: row.account,
      reason: row.reason,
      date: row.date,
      accountMoveId: entry ? entry.id : null,
      accountMoveName: entry ? entry.name : null,
    })
  }
  return out
}

export const revaluationFunctions: Record<string, FnSpec> = {
  revaluePicking: defineFn({
    input: {
      id: 'id',
      revaluationId: 'id',
      moveId: 'id',
      amount: 'text',
      account: 'text',
      reason: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        ...VALUATION_EFFECTS,
        'read:stock.Picking',
        'read:stock.Move',
        'read:stock.Revaluation',
        'write:stock.Revaluation',
      ]),
    ],
    // The adjustment's own id makes a retried post write it once.
    idempotent: true,
    agent: true,
    handler: revaluePickingHandler,
  }),
}
