import { randomUUID } from 'node:crypto'
import { categoryFailure } from '../product/category-policy.ts'
import { exactDecimal } from '../account/money.ts'
import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../user/authorization.ts'
import { savePricelistItem, savePricelistItemFunctions } from './functions/save-item.ts'
import { pricingRefusal } from './dependency-policy.ts'
import { pricelistRevision } from './record-revision.ts'
export class PricingRecordRefused extends Error {
  readonly result: Row
  constructor(result: Row) {
    super('pricing record refused')
    this.result = result
  }
}
export const recordWriteEffects = [
  ...AUTHORIZATION_READ_EFFECTS,
  ...savePricelistItemFunctions.savePricelistItem.effects!,
]
/** The outer list writer owns the transaction and company graph lock. */
export async function writePricelistItems(ctx: Ctx, args: Row, record: Row | undefined) {
  const fail = (key: string): never => {
    throw new PricingRecordRefused(pricingRefusal('items', key))
  }
  if (!record || !Array.isArray(args.items) || args.items.length > 500) fail('items')
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  if (allowed !== null && !allowed.includes('pricing.savePricelistItem')) fail('permission')
  const existing = await ctx.db.select('pricing.PricelistItem', { pricelistId: args.id })
  if (args.expectedRevision !== pricelistRevision(record!, existing)) fail('changed')
  const ids = new Set<string>()
  const submittedIds = new Set<string>()
  const rows = (args.items as Row[]).map((input) => {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.id !== 'string' ||
      !input.id ||
      submittedIds.has(input.id)
    )
      fail('items')
    submittedIds.add(input.id as string)
    return /^new-\d+$/.test(String(input.id)) && !existing.some((row) => row.id === input.id)
      ? { ...input, id: randomUUID() }
      : input
  })
  for (const input of rows) {
    if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !input.id || ids.has(input.id))
      fail('items')
    try {
      for (const key of [
        'minQuantity',
        'fixedPrice',
        'percentPrice',
        'priceDiscount',
        'priceRound',
        'priceSurcharge',
        'priceMinMargin',
        'priceMaxMargin',
      ])
        if (input[key] !== undefined && input[key] !== null) {
          if (!['string', 'number'].includes(typeof input[key])) fail('items')
          exactDecimal(input[key])
        }
      for (const key of ['dateStart', 'dateEnd'])
        if (
          input[key] &&
          (typeof input[key] !== 'string' || !Number.isFinite(Date.parse(String(input[key]))))
        )
          fail('items')
    } catch {
      fail('items')
    }
    ids.add(String(input.id))
    const held = (await ctx.db.select('pricing.PricelistItem', { id: input.id }))[0]
    if (held && held.pricelistId !== args.id) fail('items')
  }
  const table = ctx.table('pricing.PricelistItem')
  for (const held of existing)
    if (!ids.has(String(held.id))) await ctx.db.del(deleteFrom(table).where(eq(table.id, String(held.id))))
  for (const [index, input] of rows.entries()) {
    let result: Row
    try {
      result = await savePricelistItem(ctx, { ...input, pricelistId: args.id })
    } catch (error) {
      const refused = categoryFailure(error)
      if (!refused) throw error
      result = refused
    }
    if (!result.ok)
      throw new PricingRecordRefused({
        ...result,
        errors: (result.errors as Row[]).map((error) => ({
          ...error,
          field: 'items',
          params: { ...(error.params as Row), line: index + 1, field: error.field },
        })),
      })
  }
}
