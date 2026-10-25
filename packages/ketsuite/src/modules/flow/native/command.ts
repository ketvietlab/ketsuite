import { createHash } from 'node:crypto'
import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { createFlowServerExtensions } from '@ketvietlab/flow-client/server'
import { FlowRefusal, owned, refuse, requireCapability, string } from './policy.ts'
import { ledgerContext } from './ledger.ts'

export type NativeMutation = {
  name: string
  capability: string
  input: Row
  /** Additional owners must stay authorized even when returning a replay receipt. */
  requirements?: { capability: string; input: Row }[]
  /** Ownership read before the transaction must still match under its lock. */
  subjects?: {
    model: 'flow.Task' | 'flow.Document' | 'flow.FlowAttachmentBinding'
    id: unknown
    projectId: unknown
  }[]
}
export type NativeProjectionRequest = {
  input: Row
  projectIds: unknown[]
  workspaceIds: unknown[]
  detail?: Row
}
export type NativeServerExtension = {
  name: string
  effects: string[]
  /** Reads may declare a narrower projection contract than mutation hooks. */
  readEffects?: string[]
  beforeMutation?: (ctx: Ctx, mutation: NativeMutation) => Promise<void>
  afterMutation?: (ctx: Ctx, mutation: NativeMutation, value: unknown) => Promise<void>
  inputFields?: Record<string, Record<string, string>>
  taskRoutes?: string[]
  detail?: (ctx: Ctx, task: Row) => Promise<Row>
  projection?: (ctx: Ctx, route: string, records: Row[], request: NativeProjectionRequest) => Promise<Row>
  search?: (ctx: Ctx, query: string) => Promise<Row[]>
  /** Transactional cleanup of extension-owned references before the Core owner disappears. */
  purge?: (ctx: Ctx, owners: { model: string; ids: string[]; projectId: string }) => Promise<void>
  /** Job-only effects, never inherited by read/projection functions. */
  purgeEffects?: string[]
}
export const now = () => new Date().toISOString()
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value

export async function lock(ctx: Ctx, id: string) {
  id = hash(JSON.stringify([ctx.scope.company, id]))
  await ctx.db.insertIfAbsent('flow.ScopeRevision', { id, revision: 0 })
  const T = ctx.table('flow.ScopeRevision')
  // A stale constant UPDATE could reset a revision after waiting on another
  // PostgreSQL transaction. CAS both acquires the row lock and preserves it.
  for (let attempt = 0; attempt < 32; attempt++) {
    const row = await ctx.db.one(from(T).where(eq(T.id, id), eq(T.companyId, ctx.scope.company)))
    if (!row) throw new Error('Flow revision lock missing')
    const result = await ctx.db.compareAndSet(
      'flow.ScopeRevision',
      { id },
      { revision: row.revision },
      { revision: row.revision },
    )
    if ('matched' in result && result.matched) return
  }
  return refuse('conflict')
}

export async function revision(ctx: Ctx, id = 'organization'): Promise<number> {
  id = hash(JSON.stringify([ctx.scope.company, id]))
  const T = ctx.table('flow.ScopeRevision')
  return Number(
    (await ctx.db.one(from(T).where(eq(T.id, id), eq(T.companyId, ctx.scope.company))))?.revision ?? 0,
  )
}

export async function advanceRevision(ctx: Ctx, input: Row, id = 'organization') {
  await lock(ctx, id)
  const expected = input.expectedRevision
  const current = await revision(ctx, id)
  if (!Number.isSafeInteger(expected) || expected !== current) return refuse('conflict')
  await ctx.db.update(
    'flow.ScopeRevision',
    { id: hash(JSON.stringify([ctx.scope.company, id])) },
    { revision: current + 1 },
  )
  return current + 1
}

export async function touchProjects(ctx: Ctx, ids: Iterable<string>) {
  for (const projectId of new Set(ids)) {
    const scope = 'project-change:' + projectId
    await advanceRevision(ctx, { expectedRevision: await revision(ctx, scope) }, scope)
  }
}

export async function cas(ctx: Ctx, model: string, id: string, expectedVersion: unknown, patch: Row) {
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1)
    return refuse('validation', { expectedVersion: 'required' })
  const old = await owned(ctx, model, id)
  if (old.version !== expectedVersion) return refuse('conflict')
  const result = await ctx.db.compareAndSet(
    model,
    { id },
    { version: expectedVersion },
    {
      ...patch,
      version: Number(expectedVersion) + 1,
      ...(Object.hasOwn(old, 'updatedAt') ? { updatedAt: now() } : {}),
    },
  )
  if (!('matched' in result) || !result.matched) return refuse('conflict')
  return owned(ctx, model, id)
}

/** All business writes happen after permission, replay and extension guards in the scoped transaction. */
export async function mutate<T>(
  ctx: Ctx,
  mutation: NativeMutation,
  extensions: NativeServerExtension[],
  write: (tx: Ctx) => Promise<T>,
): Promise<T> {
  const key = string(mutation.input.idempotencyKey)
  if (!key || key.length > 128) return refuse('validation', { idempotencyKey: 'required' })
  const id = hash(JSON.stringify([ctx.scope.company, ctx.actor, mutation.name, key]))
  const requestDigest = hash(JSON.stringify(canonical(mutation.input)))
  return ctx.tx(async (transaction) => {
    const tx = ledgerContext(transaction)
    await lock(tx, 'organization')
    await requireCapability(tx, mutation.capability, mutation.input)
    for (const requirement of mutation.requirements ?? [])
      await requireCapability(tx, requirement.capability, requirement.input)
    for (const subject of mutation.subjects ?? []) {
      const current = await owned(tx, subject.model, subject.id)
      if (current.projectId !== subject.projectId) return refuse('conflict')
    }
    const R = tx.table('flow.CommandReceipt')
    const receipt = await tx.db.one(from(R).where(eq(R.id, id), eq(R.companyId, tx.scope.company)))
    if (receipt) {
      if (receipt.requestDigest !== requestDigest) return refuse('replay_mismatch')
      return receipt.result as T
    }
    const registry = createFlowServerExtensions<Ctx>(extensions)
    const result = await registry.mutate(
      {
        requireCapability: (capability, input) => requireCapability(tx, capability, input),
        transaction: (work) => work(tx),
      },
      mutation,
      write,
    )
    // Counts alone cannot detect replacing or transferring work after a destructive
    // preview. Replays return above and do not advance the owner's mutation epoch.
    const projectIds = new Set(
      [
        mutation.input.projectId,
        ...(mutation.requirements ?? []).map((item) => item.input.projectId),
        ...(mutation.subjects ?? []).map((item) => item.projectId),
      ].filter((id): id is string => typeof id === 'string' && Boolean(id)),
    )
    await touchProjects(tx, projectIds)
    // Collection cursors are snapshots of filters and ordering. Every committed
    // command advances this epoch; replay receipts do not advance it twice.
    await advanceRevision(
      tx,
      { expectedRevision: await revision(tx, 'collection-change') },
      'collection-change',
    )
    await tx.db.insert('flow.CommandReceipt', {
      id,
      actorId: tx.actor,
      command: mutation.name,
      requestDigest,
      result,
      projectId: mutation.input.projectId ?? null,
      createdAt: now(),
    })
    await tx.notify(`flow_${hash(string(tx.scope.company)).slice(0, 48)}`, JSON.stringify({ changed: true }))
    return result
  })
}

export async function result<T>(work: () => Promise<T>) {
  try {
    return await work()
  } catch (error) {
    if (!(error instanceof FlowRefusal)) throw error
    return { ok: false, errors: [{ code: error.code }], fields: error.fields }
  }
}
