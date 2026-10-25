import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../../account/money.ts'
import { invalid } from './helpers.ts'

export function listConfigsHandler(ctx: Ctx) {
  return ctx.db.select('pos.Config', { active: true })
}

export async function saveConfigHandler(ctx: Ctx, args: Row) {
  if (!(await ctx.db.select('stock.Warehouse', { id: args.warehouseId }))[0])
    return invalid('warehouseId', 'warehouse does not exist')
  const journal = (await ctx.db.select('account.Journal', { id: args.salesJournalId }))[0]
  if (journal?.type !== 'sale') return invalid('salesJournalId', 'a sales journal is required')
  const revenue = (await ctx.db.select('account.Account', { id: args.revenueAccountId }))[0],
    receivable = (await ctx.db.select('account.Account', { id: args.receivableAccountId }))[0]
  if (!revenue || !String(revenue.accountType).startsWith('income'))
    return invalid('revenueAccountId', 'an income account is required')
  if (receivable?.accountType !== 'asset_receivable')
    return invalid('receivableAccountId', 'a receivable account is required')
  if (args.taxAccountId && !(await ctx.db.select('account.Account', { id: args.taxAccountId }))[0])
    return invalid('taxAccountId', 'tax account does not exist')
  if (
    args.cashOverShortAccountId &&
    !(await ctx.db.select('account.Account', { id: args.cashOverShortAccountId }))[0]
  )
    return invalid('cashOverShortAccountId', 'cash over/short account does not exist')
  if (compareDecimals(args.cashRoundingIncrement ?? '0', '0') !== 0)
    return invalid('cashRoundingIncrement', 'cash rounding is modeled but disabled for the pilot')
  if (compareDecimals(args.maximumDifference ?? '0', '0') < 0)
    return invalid('maximumDifference', 'maximum cash difference cannot be negative')
  const existing = (await ctx.db.select('pos.Config', { id: args.id }))[0],
    values = {
      name: args.name,
      warehouseId: args.warehouseId,
      pricelistId: args.pricelistId ?? null,
      salesJournalId: args.salesJournalId,
      revenueAccountId: args.revenueAccountId,
      receivableAccountId: args.receivableAccountId,
      taxAccountId: args.taxAccountId ?? null,
      cashOverShortAccountId: args.cashOverShortAccountId ?? existing?.cashOverShortAccountId ?? null,
      cashRoundingIncrement: args.cashRoundingIncrement ?? existing?.cashRoundingIncrement ?? '0',
      maximumDifference: args.maximumDifference ?? '0',
      active: true,
    }
  if (existing) await ctx.db.update('pos.Config', { id: args.id }, values)
  else await ctx.db.insert('pos.Config', { id: args.id, ...values })
  return { ok: true, id: args.id }
}

export const configsFunctions: Record<string, FnSpec> = {
  listConfigs: defineFn({
    input: {},
    effects: ['read:pos.Config'],
    agent: true,
    handler: listConfigsHandler,
  }),
  saveConfig: defineFn({
    input: {
      id: 'id',
      name: 'text',
      warehouseId: 'id',
      pricelistId: 'id?',
      salesJournalId: 'id',
      revenueAccountId: 'id',
      receivableAccountId: 'id',
      taxAccountId: 'id?',
      cashOverShortAccountId: 'id?',
      cashRoundingIncrement: 'decimal?',
      maximumDifference: 'decimal?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:pos.Config',
      'write:pos.Config',
      'read:stock.Warehouse',
      'read:pricing.Pricelist',
      'read:account.Journal',
      'read:account.Account',
    ],
    idempotent: true,
    agent: true,
    handler: saveConfigHandler,
  }),
}
