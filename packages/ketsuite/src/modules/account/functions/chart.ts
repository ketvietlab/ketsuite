import { asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { recordChange } from '../audit.ts'
import { ACCOUNT_SETUP_EFFECTS, ensureCompanyAccounting } from '../setup.ts'
import { ACCOUNT_TYPES, JOURNAL_TYPES } from '../vocabulary.ts'
import { invalid } from '../validation.ts'
import { accountOf } from '../ledger.ts'

export async function listAccountsHandler(ctx: Ctx, args: Row) {
  await ensureCompanyAccounting(ctx)
  const A = ctx.table('account.Account')
  const q = from(A).orderBy(asc(A.code))
  const rows = await ctx.db.all(args.includeArchived ? q : q.where(eq(A.active, true)))
  const types = Array.isArray(args.accountTypes) ? args.accountTypes.map(String) : []
  const wanted = types.length
    ? rows.filter((row) =>
        types.some((type) =>
          // A prefix so a field can ask for every income account without
          // naming income_other alongside income.
          type.endsWith('*')
            ? String(row.accountType).startsWith(type.slice(0, -1))
            : String(row.accountType) === type,
        ),
      )
    : rows
  const needle = String(args.search ?? '')
    .trim()
    .toLocaleLowerCase()
  const matched = needle
    ? wanted.filter((row) => `${String(row.code)} ${String(row.name)}`.toLocaleLowerCase().includes(needle))
    : wanted
  const limit = Number(args.limit)
  return Number.isInteger(limit) && limit > 0 ? matched.slice(0, limit) : matched
}

export const listAccountsFunction = defineFn({
  input: { includeArchived: 'bool?', accountTypes: 'json?', search: 'text?', limit: 'int?' },
  effects: ['read:account.Account', ...ACCOUNT_SETUP_EFFECTS],
  agent: true,
  handler: listAccountsHandler,
})

export async function saveAccountHandler(ctx: Ctx, args: Row) {
  if (!ACCOUNT_TYPES.includes(args.accountType as never))
    return invalid('accountType', 'accountTypeUnsupported')
  if (!/^[A-Za-z0-9.]+$/.test(String(args.code))) return invalid('code', 'accountCodeFormat')
  const forced = ['asset_receivable', 'liability_payable'].includes(String(args.accountType))
  const reconcile = forced || args.reconcile === true
  if (args.accountType === 'off_balance' && reconcile) return invalid('reconcile', 'offBalanceReconcile')
  const existing = (await ctx.db.select('account.Account', { id: args.id }))[0]
  const values = { ...args, reconcile, active: args.active ?? true }
  const cs = ctx
    .change('account.Account', values, existing ?? null)
    .cast(['id', 'code', 'name', 'accountType', 'reconcile', 'active'])
    .required(['code', 'name', 'accountType'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  if (existing)
    await recordChange(
      ctx,
      'account',
      args.id,
      existing,
      (await ctx.db.select('account.Account', { id: args.id }))[0],
    )
  return { ok: true, id: args.id }
}

export const saveAccountFunction = defineFn({
  input: { id: 'id', code: 'text', name: 'text', accountType: 'text', reconcile: 'bool?', active: 'bool?' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: ['read:account.Account', 'write:account.Account', 'write:account.AuditEvent'],
  idempotent: true,
  agent: true,
  handler: saveAccountHandler,
})

export async function listJournalsHandler(ctx: Ctx, args: Row) {
  await ensureCompanyAccounting(ctx)
  return ctx.db.select('account.Journal', {
    ...(args.type ? { type: args.type } : {}),
    ...(args.includeArchived ? {} : { active: true }),
  })
}

export const listJournalsFunction = defineFn({
  input: { type: 'text?', includeArchived: 'bool?' },
  effects: ['read:account.Journal', ...ACCOUNT_SETUP_EFFECTS],
  agent: true,
  handler: listJournalsHandler,
})

export async function saveJournalHandler(ctx: Ctx, args: Row) {
  if (!JOURNAL_TYPES.includes(args.type as never)) return invalid('type', 'journalTypeUnsupported')
  if (!/^[A-Za-z0-9]+$/.test(String(args.code))) return invalid('code', 'journalCodeFormat')
  const defaultAccount = args.defaultAccountId ? await accountOf(ctx, args.defaultAccountId) : null
  if (args.defaultAccountId && !defaultAccount) return invalid('defaultAccountId', 'defaultAccountMissing')
  // A cash or bank journal is where a receipt or payment puts its money, so it
  // must name the cash account that money sits on before anything is paid into it.
  if (['cash', 'bank'].includes(String(args.type)) && defaultAccount?.accountType !== 'asset_cash')
    return invalid('defaultAccountId', 'journalLiquidityAccount')
  const existing = (await ctx.db.select('account.Journal', { id: args.id }))[0]
  const values = {
    ...args,
    code: String(args.code).toUpperCase(),
    sequenceNumber: existing?.sequenceNumber ?? 0,
    active: args.active ?? true,
  }
  const cs = ctx
    .change('account.Journal', values, existing ?? null)
    .cast(['id', 'name', 'code', 'type', 'defaultAccountId', 'sequenceNumber', 'active'])
    .required(['name', 'code', 'type'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  if (existing)
    await recordChange(
      ctx,
      'journal',
      args.id,
      existing,
      (await ctx.db.select('account.Journal', { id: args.id }))[0],
    )
  return { ok: true, id: args.id }
}

export const saveJournalFunction = defineFn({
  input: { id: 'id', name: 'text', code: 'text', type: 'text', defaultAccountId: 'id?', active: 'bool?' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:account.Journal',
    'write:account.Journal',
    'read:account.Account',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: saveJournalHandler,
})

export const chartFunctions: Record<string, FnSpec> = {
  listAccounts: listAccountsFunction,
  saveAccount: saveAccountFunction,
  listJournals: listJournalsFunction,
  saveJournal: saveJournalFunction,
}
