import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { recordChange } from '../audit.ts'
import { ACCOUNT_SETUP_EFFECTS, ensureCompanyAccounting } from '../setup.ts'
import { invalid } from '../validation.ts'
import { accountOf } from '../ledger.ts'

export async function initializeCompanyHandler(ctx: Ctx) {
  return ensureCompanyAccounting(ctx)
}

export const initializeCompanyFunction = defineFn({
  input: {},
  output: {
    id: 'id',
    countryCode: 'text',
    standard: 'text',
    legalBasis: 'text',
    sourceChecksum: 'text',
    installedAt: 'datetime',
  },
  effects: [...ACCOUNT_SETUP_EFFECTS],
  idempotent: true,
  agent: true,
  handler: initializeCompanyHandler,
})

export async function getSetupHandler(ctx: Ctx) {
  return (await ctx.db.select('account.Setup'))[0] ?? null
}

export const getSetupFunction = defineFn({
  input: {},
  effects: ['read:account.Setup'],
  agent: true,
  handler: getSetupHandler,
})

export async function getDefaultsHandler(ctx: Ctx) {
  await ensureCompanyAccounting(ctx)
  return (await ctx.db.select('account.Defaults'))[0] ?? {}
}

export const getDefaultsFunction = defineFn({
  input: {},
  output: {
    id: 'id?',
    incomeAccountId: 'id?',
    expenseAccountId: 'id?',
    goodsPurchaseAccountId: 'id?',
    servicePurchaseAccountId: 'id?',
    receivableAccountId: 'id?',
    payableAccountId: 'id?',
    saleTaxAccountRoots: 'json?',
    purchaseTaxAccountRoots: 'json?',
    pinned: 'json?',
  },
  effects: ['read:account.Defaults', ...ACCOUNT_SETUP_EFFECTS],
  agent: true,
  handler: getDefaultsHandler,
})

export async function saveDefaultsHandler(ctx: Ctx, args: Row) {
  // Each default has a type the ledger will insist on later; refusing here
  // means the invoice that would have used it never fails in the first place.
  for (const [field, wanted] of [
    ['incomeAccountId', ['income', 'income_other']],
    ['expenseAccountId', ['expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost']],
    [
      'goodsPurchaseAccountId',
      ['asset_current', 'expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost'],
    ],
    ['servicePurchaseAccountId', ['expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost']],
    ['receivableAccountId', ['asset_receivable']],
    ['payableAccountId', ['liability_payable']],
  ] as const) {
    const id = args[field]
    if (!id) continue
    const account = await accountOf(ctx, id)
    if (!account) return invalid(field, 'accountMissing')
    if (!wanted.includes(String(account.accountType) as never))
      return invalid(
        field,
        field === 'receivableAccountId'
          ? 'counterpartMustBeReceivable'
          : field === 'payableAccountId'
            ? 'counterpartMustBePayable'
            : 'defaultAccountType',
      )
  }
  for (const field of ['saleTaxAccountRoots', 'purchaseTaxAccountRoots'] as const) {
    const roots = args[field]
    if (roots == null) continue
    if (
      !Array.isArray(roots) ||
      !roots.every((root) => typeof root === 'string' && /^[A-Za-z0-9.]+$/.test(root))
    )
      return invalid(field, 'taxAccountRootFormat')
  }
  const held = (await ctx.db.select('account.Defaults'))[0]
  // What the standard fixes stays put: left out it keeps its account, and a different
  // account is refused rather than quietly ignored.
  const pinned = (held?.pinned ?? {}) as Record<string, unknown>
  for (const [field, account] of Object.entries(pinned))
    if (args[field] && String(args[field]) !== String(account)) return invalid(field, 'defaultPinned')
  // Left out, a branch list keeps what the company holds: the defaults screen
  // does not show them, and saving it must not open every tax to any account.
  const roots = Object.fromEntries(
    (['saleTaxAccountRoots', 'purchaseTaxAccountRoots'] as const).map((field) => [
      field,
      Object.hasOwn(args, field) ? (args[field] ?? null) : (held?.[field] ?? null),
    ]),
  )
  const values = {
    ...roots,
    goodsPurchaseAccountId: Object.hasOwn(args, 'goodsPurchaseAccountId')
      ? (args.goodsPurchaseAccountId ?? null)
      : (held?.goodsPurchaseAccountId ?? null),
    servicePurchaseAccountId: Object.hasOwn(args, 'servicePurchaseAccountId')
      ? (args.servicePurchaseAccountId ?? null)
      : (held?.servicePurchaseAccountId ?? null),
    incomeAccountId: args.incomeAccountId ?? null,
    expenseAccountId: args.expenseAccountId ?? null,
    receivableAccountId: args.receivableAccountId ?? null,
    payableAccountId: args.payableAccountId ?? null,
    ...pinned,
  }
  if (held) {
    await ctx.db.update('account.Defaults', { id: held.id }, values)
    await recordChange(ctx, 'defaults', held.id, held, { ...held, ...values })
    return { ok: true, id: held.id }
  }
  const id = `account-defaults:${String(ctx.scope.company ?? '')}`
  await ctx.db.insert('account.Defaults', { id, ...values })
  return { ok: true, id }
}

export const saveDefaultsFunction = defineFn({
  input: {
    incomeAccountId: 'id?',
    expenseAccountId: 'id?',
    goodsPurchaseAccountId: 'id?',
    servicePurchaseAccountId: 'id?',
    receivableAccountId: 'id?',
    payableAccountId: 'id?',
    saleTaxAccountRoots: 'json?',
    purchaseTaxAccountRoots: 'json?',
  },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:account.Account',
    'read:account.Defaults',
    'write:account.Defaults',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: saveDefaultsHandler,
})

export const setupFunctions: Record<string, FnSpec> = {
  initializeCompany: initializeCompanyFunction,
  getSetup: getSetupFunction,
  getDefaults: getDefaultsFunction,
  saveDefaults: saveDefaultsFunction,
}
