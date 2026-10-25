import { createHash, randomUUID } from 'node:crypto'
import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export type CommandIssue = { field: string; code: string; messageKey: string }
export type CommandResult = { ok: boolean; errors?: unknown; [key: string]: unknown }
export const commandIssue = (field: string, code: string): CommandIssue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
})
export class CommandRejected extends Error {
  readonly result: CommandResult
  constructor(result: CommandResult) {
    super('Hospitality command rejected')
    this.result = result
  }
}
export function reject(field: string, code: string): never {
  throw new CommandRejected({ ok: false, errors: [commandIssue(field, code)] })
}
export const readRecord = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> => {
  const T = ctx.table(model)
  let query = from(T).where(eq(T.id, id))
  if (T.$columns.includes('companyId') && ctx.scope.company)
    query = query.where(eq(T.companyId!, ctx.scope.company))
  return ctx.db.one(query)
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value

/** Receipt, domain changes, and returned result share the same transaction. Failed commands leave no receipt. */
export async function runCommand(
  ctx: Ctx,
  args: Record<string, unknown>,
  action: string,
  run: (tx: Ctx) => Promise<CommandResult>,
): Promise<CommandResult> {
  try {
    return await ctx.tx(async (tx) => {
      const key = String(args.requestKey ?? '')
      if (args.requestKey !== undefined && (key.length < 8 || key.length > 160))
        reject('requestKey', 'request_key')
      const id = createHash('sha256').update(`${action}\0${key}`).digest('hex')
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify(
            canonical({
              input: args,
              actor: ctx.actor ?? null,
              company: ctx.scope.company,
              branches: ctx.scope.branches ?? null,
            }),
          ),
        )
        .digest('hex')
      if (key) {
        const existing = await readRecord(tx, 'hospitality_core.CommandReceipt', id)
        if (existing) {
          if (existing.fingerprint !== fingerprint) reject('requestKey', 'request_reused')
          if (existing.result) return existing.result as CommandResult
          reject('requestKey', 'transition_conflict')
        }
        const inserted = await tx.db.insertIfAbsent('hospitality_core.CommandReceipt', {
          id,
          action,
          requestKey: key,
          fingerprint,
          result: null,
          createdAt: new Date().toISOString(),
        })
        if ('inserted' in inserted && !inserted.inserted) reject('requestKey', 'transition_conflict')
      }
      const result = await run(tx)
      if (!result.ok) throw new CommandRejected(result)
      if (key) await tx.db.update('hospitality_core.CommandReceipt', { id }, { result })
      return result
    })
  } catch (error) {
    if (error instanceof CommandRejected) return error.result
    throw error
  }
}

export async function claimVersion(ctx: Ctx, model: string, row: Row, expected: unknown): Promise<number> {
  const version = Number(row.version ?? 0)
  if (expected !== undefined && Number(expected) !== version) reject('expectedVersion', 'transition_conflict')
  const claim = await ctx.db.compareAndSet(
    model,
    { id: row.id },
    { version: row.version ?? null },
    { version: version + 1 },
  )
  if (!('matched' in claim) || !claim.matched) reject('expectedVersion', 'transition_conflict')
  return version + 1
}

export const hasPropertyScope = (ctx: Ctx, property: Row): boolean =>
  !ctx.scope.branches || (!!property.branchId && ctx.scope.branches.includes(String(property.branchId)))
export async function propertyAccess(ctx: Ctx, id: unknown): Promise<Row> {
  const property = await readRecord(ctx, 'hospitality_core.Property', id)
  if (!property) reject('propertyId', 'property_missing')
  if (!hasPropertyScope(ctx, property)) reject('propertyId', 'property_scope')
  return property
}
export async function recordChange(
  ctx: Ctx,
  propertyId: unknown,
  entityId: unknown,
  action: string,
  details: Record<string, unknown>,
) {
  await ctx.db.insert('hospitality_core.OperationalChange', {
    id: randomUUID(),
    propertyId,
    entityId,
    action,
    actorId: ctx.actor,
    details,
    occurredAt: new Date().toISOString(),
  })
}
