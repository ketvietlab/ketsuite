import { asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { recordChange } from '../audit.ts'
import { canonicalDecimalText, compareDecimals, decimalSign } from '../money.ts'
import { ACCOUNT_SETUP_EFFECTS, ensureCompanyAccounting } from '../setup.ts'
import { PAYMENT_TERM_VALUES, PAYMENT_TERM_DELAY_TYPES } from '../vocabulary.ts'
import { invalid } from '../validation.ts'

export async function listPaymentTermsHandler(ctx: Ctx, args: Row) {
  await ensureCompanyAccounting(ctx)
  const T = ctx.table('account.PaymentTerm')
  const q = from(T).orderBy(asc(T.name)).preload('lines')
  return ctx.db.all(args.includeArchived ? q : q.where(eq(T.active, true)))
}

export const listPaymentTermsFunction = defineFn({
  input: { includeArchived: 'bool?' },
  effects: ['read:account.PaymentTerm', 'read:account.PaymentTermLine', ...ACCOUNT_SETUP_EFFECTS],
  agent: true,
  handler: listPaymentTermsHandler,
})

export async function savePaymentTermHandler(ctx: Ctx, args: Row) {
  const existing = (await ctx.db.select('account.PaymentTerm', { id: args.id }))[0]
  const values = { ...args, active: args.active ?? true }
  const cs = ctx
    .change('account.PaymentTerm', values, existing ?? null)
    .cast(['id', 'name', 'note', 'active'])
    .required(['name'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  if (existing)
    await recordChange(
      ctx,
      'paymentTerm',
      args.id,
      existing,
      (await ctx.db.select('account.PaymentTerm', { id: args.id }))[0],
    )
  return { ok: true, id: args.id }
}

export const savePaymentTermFunction = defineFn({
  input: { id: 'id', name: 'text', note: 'text?', active: 'bool?' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: ['read:account.PaymentTerm', 'write:account.PaymentTerm', 'write:account.AuditEvent'],
  idempotent: true,
  agent: true,
  handler: savePaymentTermHandler,
})

export async function savePaymentTermLineHandler(ctx: Ctx, args: Row) {
  if (!(await ctx.db.select('account.PaymentTerm', { id: args.paymentId }))[0])
    return invalid('paymentId', 'paymentTermMissing')
  if (!PAYMENT_TERM_VALUES.includes(args.value as never)) return invalid('value', 'termValueUnsupported')
  if (!PAYMENT_TERM_DELAY_TYPES.includes(args.delayType as never))
    return invalid('delayType', 'termDelayUnsupported')
  let valueAmount: string
  try {
    valueAmount = canonicalDecimalText(args.valueAmount)
  } catch {
    return invalid('valueAmount', 'moneyExactString')
  }
  if (args.value === 'percent' && (decimalSign(valueAmount) < 0 || compareDecimals(valueAmount, '100') > 0))
    return invalid('valueAmount', 'termPercentRange')
  const existing = (await ctx.db.select('account.PaymentTermLine', { id: args.id }))[0]
  const values = { ...args, valueAmount, sequence: args.sequence ?? 10 }
  const cs = ctx
    .change('account.PaymentTermLine', values, existing ?? null)
    .cast(['id', 'paymentId', 'value', 'valueAmount', 'delayType', 'nbDays', 'daysNextMonth', 'sequence'])
    .required(['paymentId', 'value', 'valueAmount', 'delayType'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}

export const savePaymentTermLineFunction = defineFn({
  input: {
    id: 'id',
    paymentId: 'id',
    value: 'text',
    valueAmount: 'decimal',
    delayType: 'text',
    nbDays: 'int',
    daysNextMonth: 'int?',
    sequence: 'int?',
  },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: ['read:account.PaymentTerm', 'read:account.PaymentTermLine', 'write:account.PaymentTermLine'],
  idempotent: true,
  agent: true,
  handler: savePaymentTermLineHandler,
})

export const paymentTermsFunctions: Record<string, FnSpec> = {
  listPaymentTerms: listPaymentTermsFunction,
  savePaymentTerm: savePaymentTermFunction,
  savePaymentTermLine: savePaymentTermLineFunction,
}
