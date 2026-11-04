import { createHash } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { linesOfMoves, ledgerOf, postedMoves } from './functions.ts'
import { moneyMinor } from './money.ts'
import {
  PERIOD_LOCK_KINDS,
  periodControlsOf,
  periodFunctions,
  policyOf,
  type PeriodControl,
  type PeriodLockKind,
} from './period.ts'
import { ACCOUNT_CORE_STANDARD } from './setup.ts'

export const CLOSE_CHECKLIST_VERSION = 'account-close-v2'

const CHECKS = [
  { code: 'draft_moves', required: true },
  { code: 'trial_balance', required: true },
  { code: 'localization_evidence', required: true },
  { code: 'bank_reconciled', required: true },
  { code: 'cash_counted', required: true },
  { code: 'inventory_closed', required: false },
  { code: 'assets_tied_out', required: false },
] as const

const now = (): string => new Date().toISOString()
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const issue = (field: string, code: string, message: string, params?: Record<string, unknown>) => ({
  field,
  code: `account.error.${code}`,
  message,
  params,
})
const failure = (...errors: ReturnType<typeof issue>[]) => ({ ok: false as const, errors })

const within = (row: Row, from: string, to: string): boolean => {
  const date = String(row.accountingDate ?? row.date).slice(0, 10)
  return date >= from && date <= to
}

/** The list a draft is finished from: sales and purchase documents each have their own. */
const draftList = (move: Row): 'customerInvoices' | 'vendorBills' | 'entries' => {
  const type = String(move.moveType ?? '')
  return type.startsWith('out_') ? 'customerInvoices' : type.startsWith('in_') ? 'vendorBills' : 'entries'
}

async function evidenceOf(ctx: Ctx, close: Row): Promise<Map<string, Row>> {
  const from = String(close.dateFrom)
  const to = String(close.dateTo)
  const allMoves = await ctx.db.select('account.Move')
  const drafts = allMoves.filter((move) => move.state === 'draft' && within(move, from, to))
  const moves = await postedMoves(ctx, from, to)
  const lines = await linesOfMoves(ctx, [...moves.keys()])
  const { scale } = await ledgerOf(ctx)
  let debit = 0n
  let credit = 0n
  for (const line of lines) {
    debit += moneyMinor(line.debit, scale)
    credit += moneyMinor(line.credit, scale)
  }
  const setup = (await ctx.db.select('account.Setup'))[0]
  const localized = Boolean(setup && setup.standard !== ACCOUNT_CORE_STANDARD)
  const localization = await ctx.db.select('account.CloseEvidence', { closeId: close.id })
  const requiredLocalization = localization.filter((row) => row.required === true)
  const incompleteLocalization = requiredLocalization.filter((row) => row.state !== 'passed')
  // Up to the period's last day, not from its first: a line left unmatched last month is
  // still unmatched when this month closes.
  const unmatched = (
    await ctx.db.select('account.BankTransaction', { providerState: 'posted', reconcileState: 'unmatched' })
  ).filter((row) => String(row.bookingDate).slice(0, 10) <= to)
  const uncounted = (await ctx.db.select('account.CashCount', { state: 'difference' })).filter(
    (row) => String(row.accountingDate).slice(0, 10) <= to,
  )
  return new Map<string, Row>([
    [
      'draft_moves',
      {
        complete: drafts.length === 0,
        blocker: drafts.length ? `${drafts.length} draft journal entries remain in the period` : null,
        evidence: {
          count: drafts.length,
          moveIds: drafts.map((row) => row.id).sort(),
          // How many each list holds, so the checklist can send the accountant to each one.
          lists: {
            customerInvoices: drafts.filter((row) => draftList(row) === 'customerInvoices').length,
            vendorBills: drafts.filter((row) => draftList(row) === 'vendorBills').length,
            entries: drafts.filter((row) => draftList(row) === 'entries').length,
          },
        },
      },
    ],
    [
      'trial_balance',
      {
        complete: debit === credit,
        blocker: debit === credit ? null : 'period debit and credit totals do not balance',
        evidence: { debit: debit.toString(), credit: credit.toString(), moveCount: moves.size },
      },
    ],
    [
      'localization_evidence',
      {
        required: localized,
        complete: !localized || (requiredLocalization.length > 0 && incompleteLocalization.length === 0),
        blocker: !localized
          ? null
          : requiredLocalization.length === 0
            ? `localization ${String(setup.standard)} has not supplied close evidence`
            : incompleteLocalization.length
              ? `${incompleteLocalization.length} localization close requirements remain incomplete`
              : null,
        evidence: {
          standard: setup?.standard ?? ACCOUNT_CORE_STANDARD,
          evidenceIds: localization.map((row) => row.id).sort(),
          incompleteIds: incompleteLocalization.map((row) => row.id).sort(),
        },
      },
    ],
    [
      'bank_reconciled',
      {
        complete: unmatched.length === 0,
        blocker: unmatched.length
          ? `${unmatched.length} bank lines up to the period end remain unmatched`
          : null,
        evidence: { count: unmatched.length, transactionIds: unmatched.map((row) => row.id).sort() },
      },
    ],
    [
      'cash_counted',
      {
        complete: uncounted.length === 0,
        blocker: uncounted.length
          ? `${uncounted.length} cash counts up to the period end have a difference not yet booked`
          : null,
        evidence: { count: uncounted.length, cashCountIds: uncounted.map((row) => row.id).sort() },
      },
    ],
    [
      'inventory_closed',
      {
        complete: false,
        blocker: null,
        evidence: { status: 'requires composition-specific evidence' },
      },
    ],
    [
      'assets_tied_out',
      {
        complete: false,
        blocker: null,
        evidence: { deferredTo: 'Wave 3', status: 'not_available' },
      },
    ],
  ])
}

async function refresh(ctx: Ctx, close: Row): Promise<Row> {
  const evidence = await evidenceOf(ctx, close)
  const rows: Row[] = []
  for (const check of CHECKS) {
    const result = evidence.get(check.code)!
    const held = (await ctx.db.select('account.CloseStep', { closeId: close.id, code: check.code }))[0]
    const row = {
      id: held?.id ?? `${String(close.id)}:${check.code}`,
      closeId: close.id,
      code: check.code,
      required: check.code === 'localization_evidence' ? result.required === true : check.required,
      ownerId: held?.ownerId ?? null,
      state: result.complete ? 'complete' : result.blocker ? 'blocked' : 'pending',
      blocker: result.blocker,
      evidenceChecksum: digest(result.evidence),
      evidence: result.evidence,
      completedAt: result.complete ? (held?.completedAt ?? now()) : null,
      completedBy: result.complete ? (held?.completedBy ?? ctx.actor ?? null) : null,
      revision: Number(held?.revision ?? -1) + 1,
    }
    if (held) await ctx.db.update('account.CloseStep', { id: held.id }, row)
    else await ctx.db.insert('account.CloseStep', row)
    rows.push(row)
  }
  const blockers = rows.filter((row) => row.required === true && row.state !== 'complete')
  const snapshotChecksum = digest(
    rows.map((row) => ({
      code: row.code,
      required: row.required,
      state: row.state,
      evidenceChecksum: row.evidenceChecksum,
    })),
  )
  await ctx.db.update(
    'account.ClosePeriod',
    { id: close.id },
    { snapshotChecksum, blockerCount: blockers.length, revision: Number(close.revision) + 1 },
  )
  return {
    ...close,
    snapshotChecksum,
    blockerCount: blockers.length,
    revision: Number(close.revision) + 1,
    steps: rows,
  }
}

export const closeFunctions: Record<string, FnSpec> = {
  listClosePeriods: defineFn({
    input: { state: 'text?' },
    effects: ['read:account.ClosePeriod'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = args.state
        ? await ctx.db.select('account.ClosePeriod', { state: args.state })
        : await ctx.db.select('account.ClosePeriod')
      return rows.sort((a, b) => String(b.dateTo).localeCompare(String(a.dateTo)))
    },
  }),
  getClosePeriod: defineFn({
    input: { id: 'id' },
    output: { period: 'json?', steps: 'json', evidence: 'json' },
    effects: ['read:account.ClosePeriod', 'read:account.CloseStep', 'read:account.CloseEvidence'],
    agent: true,
    handler: async (ctx, args) => {
      const period = (await ctx.db.select('account.ClosePeriod', { id: args.id }))[0] ?? null
      const steps = period ? await ctx.db.select('account.CloseStep', { closeId: args.id }) : []
      // What the installed accounting standard supplied, each item on its own.
      const evidence = period ? await ctx.db.select('account.CloseEvidence', { closeId: args.id }) : []
      return {
        period,
        steps: steps.sort((a, b) => String(a.code).localeCompare(String(b.code))),
        evidence: evidence.sort(
          (a, b) =>
            String(a.provider).localeCompare(String(b.provider)) || String(a.id).localeCompare(String(b.id)),
        ),
      }
    },
  }),
  createClosePeriod: defineFn({
    input: { id: 'id', periodKey: 'text', dateFrom: 'date', dateTo: 'date' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.ClosePeriod', 'write:account.ClosePeriod'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (String(args.dateFrom) > String(args.dateTo))
        return failure(issue('dateTo', 'closePeriodInvalid', 'close period end must not precede its start'))
      const existing = (await ctx.db.select('account.ClosePeriod', { id: args.id }))[0]
      if (existing) {
        const same =
          existing.periodKey === args.periodKey &&
          existing.dateFrom === args.dateFrom &&
          existing.dateTo === args.dateTo
        return same
          ? { ok: true, id: existing.id }
          : failure(issue('id', 'closePeriodIdReused', 'close id belongs to a different period'))
      }
      await ctx.db.insert('account.ClosePeriod', {
        id: args.id,
        periodKey: args.periodKey,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
        state: 'open',
        checklistVersion: CLOSE_CHECKLIST_VERSION,
        snapshotChecksum: null,
        blockerCount: CHECKS.filter((check) => check.required).length,
        revision: 0,
        createdAt: now(),
        createdBy: ctx.actor ?? null,
        closedAt: null,
        closedBy: null,
        reopenedAt: null,
        reopenedBy: null,
        reopenReason: null,
      })
      return { ok: true, id: args.id }
    },
  }),
  refreshClosePeriod: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', period: 'json?', errors: 'json?' },
    effects: [
      'read:company.Company',
      'read:account.ClosePeriod',
      'read:account.CloseStep',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Setup',
      'read:account.CloseEvidence',
      'read:account.BankTransaction',
      'read:account.CashCount',
      'write:account.ClosePeriod',
      'write:account.CloseStep',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const close = (await ctx.db.select('account.ClosePeriod', { id: args.id }))[0]
      if (!close) return failure(issue('id', 'closePeriodMissing', 'close period does not exist'))
      if (close.state === 'hard_closed')
        return failure(issue('state', 'closePermanent', 'a hard-closed period cannot be refreshed'))
      return { ok: true, period: await refresh(ctx, close) }
    },
  }),
  closePeriod: defineFn({
    input: { id: 'id', mode: 'text', expectedRevision: 'int', reason: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:company.Company',
      'read:account.ClosePeriod',
      'read:account.CloseStep',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Setup',
      'read:account.CloseEvidence',
      'read:account.BankTransaction',
      'read:account.CashCount',
      'read:account.PeriodPolicy',
      'read:account.PeriodLockEvent',
      'write:account.ClosePeriod',
      'write:account.CloseStep',
      'write:account.PeriodPolicy',
      'write:account.PeriodLockEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['soft', 'hard'].includes(String(args.mode)))
        return failure(issue('mode', 'closeModeUnsupported', 'close mode must be soft or hard'))
      const close = (await ctx.db.select('account.ClosePeriod', { id: args.id }))[0]
      if (!close) return failure(issue('id', 'closePeriodMissing', 'close period does not exist'))
      const target = args.mode === 'hard' ? 'hard_closed' : 'soft_closed'
      if (close.state === target) return { ok: true, id: close.id }
      if (close.state === 'hard_closed')
        return failure(issue('state', 'closePermanent', 'a hard-closed period cannot change'))
      if (Number(close.revision) !== Number(args.expectedRevision))
        return failure(issue('expectedRevision', 'closeConcurrent', 'close period changed; review and retry'))
      const refreshed = await refresh(ctx, close)
      if (Number(refreshed.blockerCount) > 0)
        return failure(
          issue('steps', 'closeBlocked', 'required close checks remain blocked', {
            blockerCount: refreshed.blockerCount,
          }),
        )
      const lock = (await periodFunctions.changePeriodLock!.handler(ctx, {
        id: `${String(close.id)}:${String(args.mode)}-lock`,
        scope: args.mode === 'hard' ? 'hard' : 'all',
        through: close.dateTo,
        reason: args.reason,
      })) as Row
      if (lock.ok !== true) return lock
      await ctx.db.update(
        'account.ClosePeriod',
        { id: close.id },
        {
          state: target,
          closedAt: now(),
          closedBy: ctx.actor ?? null,
          revision: Number(refreshed.revision) + 1,
        },
      )
      return { ok: true, id: close.id }
    },
  }),
  /**
   * The chief accountant's controls on one period: kinds of document locked ahead of the rest
   * while it is open, and who may still post once it is soft closed. A hard close ends both.
   */
  setClosePeriodControls: defineFn({
    input: { id: 'id', lockedKinds: 'json', softPosters: 'json', expectedRevision: 'int' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:account.ClosePeriod',
      'read:account.PeriodPolicy',
      'write:account.ClosePeriod',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const close = (await ctx.db.select('account.ClosePeriod', { id: args.id }))[0]
      if (!close) return failure(issue('id', 'closePeriodMissing', 'close period does not exist'))
      if (close.state === 'hard_closed')
        return failure(issue('state', 'closePermanent', 'a hard-closed period cannot change'))
      const kinds = Array.isArray(args.lockedKinds) ? args.lockedKinds.map(String) : null
      if (!kinds || kinds.some((kind) => !PERIOD_LOCK_KINDS.includes(kind as PeriodLockKind)))
        return failure(issue('lockedKinds', 'periodControlKind', 'unsupported kind of document'))
      const posters = Array.isArray(args.softPosters) ? args.softPosters.map((id) => String(id).trim()) : null
      if (!posters || posters.length > 50 || posters.some((id) => !id || id.length > 128))
        return failure(issue('softPosters', 'periodControlPoster', 'invalid list of people who may post'))
      const lockedKinds = PERIOD_LOCK_KINDS.filter((kind) => kinds.includes(kind))
      const softPosters = [...new Set(posters)].sort()
      const before = {
        lockedKinds: (close.lockedKinds as PeriodLockKind[] | null) ?? [],
        softPosters: (close.softPosters as string[] | null) ?? [],
      }
      if (JSON.stringify(before) === JSON.stringify({ lockedKinds, softPosters }))
        return { ok: true, id: close.id }
      if (Number(close.revision) !== Number(args.expectedRevision))
        return failure(issue('expectedRevision', 'closeConcurrent', 'close period changed; review and retry'))
      try {
        return await ctx.tx(async (tx) => {
          const policy = await policyOf(tx)
          const control: PeriodControl = {
            closeId: String(close.id),
            dateFrom: String(close.dateFrom),
            dateTo: String(close.dateTo),
            lockedKinds,
            softPosters,
          }
          const controls = periodControlsOf(policy).filter((held) => held.closeId !== control.closeId)
          if (lockedKinds.length || softPosters.length) controls.push(control)
          // The policy row serializes this against every post that claims it.
          const changed = await tx.db.compareAndSet(
            'account.PeriodPolicy',
            { id: policy.id },
            { revision: policy.revision },
            {
              periodControls: controls,
              revision: Number(policy.revision ?? 0) + 1,
              updatedAt: now(),
              updatedBy: tx.actor ?? null,
            },
          )
          if (!('dryRun' in changed) && !changed.matched)
            return failure(
              issue('expectedRevision', 'closeConcurrent', 'close period changed; review and retry'),
            )
          const revision = Number(close.revision) + 1
          const updated = await tx.db.compareAndSet(
            'account.ClosePeriod',
            { id: close.id },
            { revision: close.revision },
            { lockedKinds, softPosters, revision },
          )
          if (!('dryRun' in updated) && !updated.matched)
            return failure(
              issue('expectedRevision', 'closeConcurrent', 'close period changed; review and retry'),
            )
          await tx.db.insert('account.AuditEvent', {
            id: `close:${String(close.id)}:controls:${revision}`,
            subjectType: 'closePeriod',
            subjectId: String(close.id),
            action: 'controlsChanged',
            actorId: tx.actor ?? null,
            accountingDate: String(close.dateTo),
            reason: null,
            relatedId: null,
            details: { before, after: { lockedKinds, softPosters } },
            createdAt: now(),
          })
          return { ok: true, id: close.id }
        })
      } catch (error) {
        return failure(
          issue(
            'expectedRevision',
            'closeConcurrent',
            error instanceof Error ? error.message : String(error),
          ),
        )
      }
    },
  }),
  reopenClosePeriod: defineFn({
    input: { id: 'id', expectedRevision: 'int', reason: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:account.ClosePeriod',
      'read:account.PeriodPolicy',
      'read:account.PeriodLockEvent',
      'write:account.ClosePeriod',
      'write:account.PeriodPolicy',
      'write:account.PeriodLockEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const close = (await ctx.db.select('account.ClosePeriod', { id: args.id }))[0]
      if (!close) return failure(issue('id', 'closePeriodMissing', 'close period does not exist'))
      if (close.state === 'open' || close.state === 'reopened') return { ok: true, id: close.id }
      if (close.state === 'hard_closed')
        return failure(issue('state', 'closePermanent', 'a hard-closed period cannot reopen'))
      if (!String(args.reason).trim())
        return failure(issue('reason', 'periodReasonRequired', 'reopening requires a reason'))
      if (Number(close.revision) !== Number(args.expectedRevision))
        return failure(issue('expectedRevision', 'closeConcurrent', 'close period changed; review and retry'))
      const later = (await ctx.db.select('account.ClosePeriod')).find(
        (row) =>
          row.id !== close.id &&
          ['soft_closed', 'hard_closed'].includes(String(row.state)) &&
          String(row.dateTo) > String(close.dateTo),
      )
      if (later)
        return failure(issue('state', 'closeLaterPeriod', 'a later closed period must be reopened first'))
      const unlocked = (await periodFunctions.changePeriodLock!.handler(ctx, {
        id: `${String(close.id)}:reopen`,
        scope: 'all',
        through: null,
        reason: args.reason,
      })) as Row
      if (unlocked.ok !== true) return unlocked
      await ctx.db.update(
        'account.ClosePeriod',
        { id: close.id },
        {
          state: 'reopened',
          reopenedAt: now(),
          reopenedBy: ctx.actor ?? null,
          reopenReason: String(args.reason).trim(),
          revision: Number(close.revision) + 1,
        },
      )
      return { ok: true, id: close.id }
    },
  }),
}
