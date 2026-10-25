import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { POS_PAYMENT_SETTLEMENT_KINDS, invalid } from './helpers.ts'

export function listPaymentMethodsHandler(ctx: Ctx) {
  return ctx.db.select('pos.PaymentMethod', { active: true })
}

export async function savePaymentMethodHandler(ctx: Ctx, args: Row) {
  const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
  const settlementKind = String(args.settlementKind ?? 'liquidity')
  if (!POS_PAYMENT_SETTLEMENT_KINDS.includes(settlementKind as never))
    return invalid('settlementKind', 'settlement kind must be liquidity or stored value')
  if (!journal?.defaultAccountId)
    return invalid('journalId', 'payment method requires a journal with a default account')
  const settlementAccount = (await ctx.db.select('account.Account', { id: journal.defaultAccountId }))[0]
  if (settlementKind === 'liquidity' && !['cash', 'bank'].includes(String(journal.type)))
    return invalid('journalId', 'liquidity payment method requires a cash or bank journal')
  if (
    settlementKind === 'stored_value' &&
    (String(journal.type) !== 'general' ||
      !String(settlementAccount?.accountType ?? '').startsWith('liability'))
  )
    return invalid('journalId', 'stored value payment method requires a general liability journal')
  if (settlementKind === 'stored_value' && args.isCash === true)
    return invalid('isCash', 'stored value cannot be counted as cash')
  const existing = (await ctx.db.select('pos.PaymentMethod', { id: args.id }))[0],
    values = {
      name: args.name,
      journalId: args.journalId,
      settlementKind,
      isCash: settlementKind === 'liquidity' && Boolean(args.isCash),
      active: true,
    }
  if (existing) await ctx.db.update('pos.PaymentMethod', { id: args.id }, values)
  else await ctx.db.insert('pos.PaymentMethod', { id: args.id, ...values })
  return { ok: true, id: args.id }
}

export async function linkPaymentMethodHandler(ctx: Ctx, args: Row) {
  if (!(await ctx.db.select('pos.Config', { id: args.configId }))[0])
    return invalid('configId', 'point of sale does not exist')
  if (!(await ctx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0])
    return invalid('paymentMethodId', 'payment method does not exist')
  await ctx.db.insertIfAbsent('pos.ConfigPaymentMethod', args)
  return { ok: true, id: args.id }
}

export async function paymentMethodAvailableHandler(ctx: Ctx, args: Row) {
  return {
    ok: Boolean(
      (
        await ctx.db.select('pos.ConfigPaymentMethod', {
          configId: args.configId,
          paymentMethodId: args.paymentMethodId,
        })
      )[0],
    ),
  }
}

export const paymentMethodsFunctions: Record<string, FnSpec> = {
  listPaymentMethods: defineFn({
    input: {},
    effects: ['read:pos.PaymentMethod'],
    agent: true,
    handler: listPaymentMethodsHandler,
  }),
  savePaymentMethod: defineFn({
    input: { id: 'id', name: 'text', journalId: 'id', settlementKind: 'text?', isCash: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:pos.PaymentMethod',
      'write:pos.PaymentMethod',
      'read:account.Journal',
      'read:account.Account',
    ],
    idempotent: true,
    agent: true,
    handler: savePaymentMethodHandler,
  }),
  linkPaymentMethod: defineFn({
    input: { id: 'id', configId: 'id', paymentMethodId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:pos.Config', 'read:pos.PaymentMethod', 'write:pos.ConfigPaymentMethod'],
    idempotent: true,
    agent: true,
    handler: linkPaymentMethodHandler,
  }),
  paymentMethodAvailable: defineFn({
    input: { configId: 'id', paymentMethodId: 'id' },
    output: { ok: 'bool' },
    effects: ['read:pos.ConfigPaymentMethod'],
    agent: true,
    handler: paymentMethodAvailableHandler,
  }),
}
