import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

/** Most fields one change records; past this a configuration edit is a replacement, not an edit. */
export const AUDIT_CHANGE_LIMIT = 30

// Bookkeeping the database keeps on every row; nobody edits these, so nobody reads them as a change.
const UNRECORDED = new Set([
  'id',
  'companyId',
  'revision',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
])

const scalar = (value: unknown) => value === null || value === undefined || typeof value !== 'object'

/**
 * The fields an edit changed, each with what it held and what it holds now. Only
 * plain values count: a field holding a list or an object is left to the event
 * that owns it, and two values that read the same are not a change.
 */
export const changedFields = (before: Row, after: Row): { before: Row; after: Row } | null => {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        !UNRECORDED.has(key) &&
        scalar(before[key]) &&
        scalar(after[key]) &&
        String(before[key] ?? '') !== String(after[key] ?? ''),
    )
    .sort()
    .slice(0, AUDIT_CHANGE_LIMIT)
  if (!keys.length) return null
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key] ?? null])),
    after: Object.fromEntries(keys.map((key) => [key, after[key] ?? null])),
  }
}

/**
 * Records an edit to a configuration record as what each field was and what it
 * became. Creating a record is not an edit — installing a chart of accounts
 * would otherwise log two hundred events nobody asked about — and saving the
 * same values again changes nothing, so neither records an event.
 */
export async function recordChange(
  ctx: Ctx,
  subjectType: string,
  subjectId: unknown,
  before: Row | undefined | null,
  after: Row | undefined | null,
): Promise<void> {
  if (!before || !after) return
  const changes = changedFields(before, after)
  if (!changes) return
  await ctx.db.insert('account.AuditEvent', {
    id: randomUUID(),
    subjectType,
    subjectId: String(subjectId),
    action: 'updated',
    actorId: ctx.actor ?? null,
    accountingDate: null,
    reason: null,
    relatedId: null,
    details: changes,
    createdAt: new Date().toISOString(),
  })
}

export const auditFunctions: Record<string, FnSpec> = {
  listAuditEvents: defineFn({
    input: { subjectType: 'text?', subjectId: 'text?' },
    effects: ['read:account.AuditEvent'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.AuditEvent'))
        .filter(
          (row) =>
            (!args.subjectType || row.subjectType === args.subjectType) &&
            (!args.subjectId || row.subjectId === args.subjectId),
        )
        .sort(
          (a, b) =>
            String(a.createdAt).localeCompare(String(b.createdAt)) ||
            String(a.id).localeCompare(String(b.id)),
        ),
  }),
}
