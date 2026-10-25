import { randomUUID } from 'node:crypto'
import { asc, eq, from, gt, inArray, isNull, ne } from '@ketvietlab/ketjs'
import { validateCustomFields } from '@ketvietlab/flow-client/custom-fields.mjs'
import {
  catalogColors,
  catalogTitleKey,
  statusKinds,
  taskTypeIcons,
} from '@ketvietlab/flow-client/catalog-contract.mjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { cas, hash, mutate } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, owned, refuse, requireCapability, string } from './policy.ts'
import { requiredTitle, timestamped } from './organization.ts'
import { decodeCustomFieldValue } from './field-values.ts'

export type CatalogKind = 'column' | 'type' | 'tag' | 'field'
const catalogModels = {
  column: 'flow.TaskStatus',
  type: 'flow.TaskType',
  tag: 'flow.Label',
  field: 'flow.CustomField',
} as const
const colors = new Set(catalogColors)

async function uniqueTitle(
  ctx: Ctx,
  model: string,
  owner: unknown,
  title: string,
  id?: unknown,
  domain?: unknown,
) {
  const T = ctx.table(model)
  let after = ''
  const key = catalogTitleKey(title)
  // Unicode case handling is identical on SQLite/PostgreSQL and in Atlas.
  // Read only this owner's catalog, in bounded windows with two columns.
  while (true) {
    const rows = await ctx.db.all(
      from(T)
        .select(T.id, T.title)
        .where(
          eq(T.companyId, ctx.scope.company),
          eq(T.archived, false),
          owner ? eq(T.projectId, owner) : isNull(T.projectId),
          ...(id ? [ne(T.id, id)] : []),
          ...(domain ? [eq(T.domain, domain)] : []),
          ...(after ? [gt(T.id, after)] : []),
        )
        .orderBy(asc(T.id))
        .limit(256),
    )
    if (rows.some((row) => catalogTitleKey(string(row.title)) === key))
      return refuse('validation', { title: 'catalog_duplicate_title' })
    if (rows.length < 256) return
    after = string(rows.at(-1)!.id)
  }
}

async function preserveStatusGroups(ctx: Ctx, existing: Row, nextKind?: unknown) {
  const C = ctx.table('flow.TaskStatus')
  for (const kind of statusKinds) {
    if (kind === nextKind) continue
    if (
      !(await ctx.db.count(
        from(C).where(
          eq(C.companyId, ctx.scope.company),
          eq(C.archived, false),
          ne(C.id, existing.id),
          eq(C.kind, kind),
          existing.projectId ? eq(C.projectId, existing.projectId) : isNull(C.projectId),
        ),
      ))
    )
      return refuse('validation', { kind: 'catalog_required_group' })
  }
}

export async function requireUnusedStatus(ctx: Ctx, existing: Row) {
  const T = ctx.table('flow.Task')
  if (await ctx.db.count(from(T).where(eq(T.companyId, ctx.scope.company), eq(T.columnId, existing.id))))
    return refuse('validation', { kind: 'catalog_status_in_use' })
}

async function changeStatusGroup(ctx: Ctx, existing: Row, nextKind: unknown) {
  await requireUnusedStatus(ctx, existing)
  await preserveStatusGroups(ctx, existing, nextKind)
}

async function compatibleDefinition(ctx: Ctx, field: Row, proposed: Row) {
  const options = (value: unknown) => JSON.stringify([...new Set((value ?? []) as string[])].sort())
  if (field.kind === proposed.kind && options(field.options) === options(proposed.options)) return
  const V = ctx.table('flow.TaskFieldValue')
  let after = ''
  while (true) {
    const rows = await ctx.db.all(
      from(V)
        .where(
          eq(V.companyId, ctx.scope.company),
          eq(V.fieldId, field.id),
          ...(after ? [gt(V.id, after)] : []),
        )
        .orderBy(asc(V.id))
        .limit(256),
    )
    const target = proposed.appliesTo ?? field.projectId
    const taskIds = rows.map((row) => row.taskId)
    const T = ctx.table('flow.Task')
    const scopedTasks =
      target && taskIds.length
        ? await ctx.db.all(
            from(T).where(
              eq(T.companyId, ctx.scope.company),
              eq(T.projectId, target),
              inArray(T.id, taskIds),
            ),
          )
        : null
    const allowedTasks = scopedTasks ? new Set(scopedTasks.map((task) => task.id)) : null
    for (const row of rows) {
      if (allowedTasks && !allowedTasks.has(row.taskId)) continue
      const invalid = validateCustomFields(
        [
          {
            id: String(field.id),
            title: String(proposed.title),
            kind: String(proposed.kind),
            options: proposed.options as string[],
          },
        ],
        { [String(field.id)]: decodeCustomFieldValue(row.value) },
        '',
      )
      if (invalid)
        return refuse('validation', {
          [field.kind === proposed.kind ? 'options' : 'kind']: 'incompatible_values',
        })
    }
    if (rows.length < 256) return
    after = String(rows.at(-1)!.id)
  }
}

export async function saveCatalog(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  kind: CatalogKind,
) {
  const model = catalogModels[kind]
  const prior = input.id ? await owned(ctx, model, input.id) : null
  const projectId = prior ? prior.projectId : (input.projectId ?? null)
  const a = await authority(ctx)
  return mutate(
    ctx,
    {
      name: `flow.${kind}.save`,
      capability: projectId ? 'project.manage' : 'organization.manage',
      input: { ...input, projectId },
    },
    extensions,
    async (tx) => {
      const existing = prior ? await owned(tx, model, prior.id) : null
      if (
        existing &&
        input.projectId !== undefined &&
        (input.projectId || null) !== (existing.projectId || null)
      )
        return refuse('validation', { projectId: 'catalog_owner_locked' })
      const values: Row = {
        title: input.title === undefined && existing ? existing.title : requiredTitle(input),
        description: input.description ?? existing?.description ?? '',
      }
      if (string(values.description).length > 100000) return refuse('validation', { description: 'invalid' })
      if (kind !== 'field' && input.appliesTo !== undefined)
        return refuse('validation', { appliesTo: 'invalid' })
      if (kind === 'column' || kind === 'tag') {
        values.color = string(input.color ?? existing?.color ?? 'neutral')
        if (!colors.has(string(values.color))) return refuse('validation', { color: 'invalid' })
      }
      if (kind === 'column' || kind === 'type')
        values.icon = string(input.icon ?? existing?.icon ?? (kind === 'type' ? 'list' : 'circle'))
      if (kind === 'type' && !taskTypeIcons.includes(string(values.icon)) && values.icon !== existing?.icon)
        return refuse('validation', { icon: 'catalog_invalid_icon' })
      if (kind === 'column') {
        values.kind = string(input.kind ?? existing?.kind ?? 'todo')
        if (!statusKinds.includes(string(values.kind)))
          return refuse('validation', { kind: 'catalog_invalid_kind' })
        if (existing && values.kind !== existing.kind) await changeStatusGroup(tx, existing, values.kind)
      }
      if (kind === 'tag') {
        values.domain = input.domain ?? existing?.domain ?? 'task'
        if (!['project', 'task'].includes(string(values.domain)))
          return refuse('validation', { domain: 'invalid' })
      }
      if (kind === 'field') {
        values.kind = string(input.kind ?? existing?.kind ?? 'text')
        if (values.kind === 'checkbox') values.kind = 'boolean'
        if (
          !['text', 'number', 'date', 'select', 'multi-select', 'boolean', 'url', 'person'].includes(
            string(values.kind),
          )
        )
          return refuse('validation', { kind: 'invalid' })
        if (input.required !== undefined && typeof input.required !== 'boolean')
          return refuse('validation', { required: 'invalid' })
        values.required = input.required ?? existing?.required ?? false
        const appliesTo = input.appliesTo === undefined ? (existing?.appliesTo ?? null) : input.appliesTo
        values.appliesTo = appliesTo === 'all' || appliesTo === '' ? null : appliesTo
        if (projectId && values.appliesTo && values.appliesTo !== projectId)
          return refuse('validation', { appliesTo: 'catalog_owner_invalid' })
        if (values.appliesTo) {
          await requireCapability(tx, 'project.read', { projectId: values.appliesTo })
          await owned(tx, 'flow.ProjectRecord', values.appliesTo)
        }
        values.options = input.options ?? existing?.options ?? []
        if (!Array.isArray(values.options) || values.options.length > 100)
          return refuse('validation', { options: 'invalid' })
        if (values.options.some((value) => typeof value !== 'string' || !value.trim() || value.length > 1000))
          return refuse('validation', { options: 'invalid' })
        if (new Set(values.options).size !== values.options.length)
          return refuse('validation', { options: 'invalid' })
        if (existing) await compatibleDefinition(tx, existing, values)
      }
      if (!existing?.archived)
        await uniqueTitle(tx, model, projectId, string(values.title), existing?.id, values.domain)
      if (input.sequence !== undefined) {
        if (!Number.isSafeInteger(input.sequence) || Number(input.sequence) < 0)
          return refuse('validation', { sequence: 'invalid' })
        values.sequence = input.sequence
      } else
        values.sequence =
          existing?.sequence ??
          (await tx.sequence(`flow.catalog_${kind}_${hash(string(projectId ?? a.companyId)).slice(0, 32)}`))
      const id = existing ? string(existing.id) : randomUUID()
      const record = existing ? await cas(tx, model, id, input.expectedVersion, values) : { id, version: 1 }
      if (!existing) await tx.db.insert(model, { id, projectId, ...values, ...timestamped() })
      const projectVersion = await bumpCatalogOwner(tx, projectId)
      return { ok: true, id, version: record.version, ...(projectVersion ? { projectVersion } : {}) }
    },
  )
}

export async function archiveCatalog(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  kind: CatalogKind,
  archived: boolean,
) {
  const model = catalogModels[kind],
    existing = await owned(ctx, model, input.id)
  return mutate(
    ctx,
    {
      name: `flow.${kind}.${archived ? 'archive' : 'restore'}`,
      capability: existing.projectId ? 'project.manage' : 'organization.manage',
      input: { ...input, projectId: existing.projectId },
    },
    extensions,
    async (tx) => {
      const current = await owned(tx, model, existing.id)
      if (!archived)
        await uniqueTitle(tx, model, current.projectId, string(current.title), current.id, current.domain)
      if (archived && kind === 'column') {
        const T = tx.table('flow.Task')
        if (
          await tx.db.count(
            from(T).where(
              eq(T.companyId, tx.scope.company),
              eq(T.columnId, existing.id),
              eq(T.archived, false),
            ),
          )
        )
          return refuse('in_use')
        await preserveStatusGroups(tx, current)
      }
      const record = await cas(tx, model, string(existing.id), input.expectedVersion, { archived })
      const projectVersion = await bumpCatalogOwner(tx, existing.projectId)
      return {
        ok: true,
        id: record.id,
        version: record.version,
        ...(projectVersion ? { projectVersion } : {}),
      }
    },
  )
}

/** An individual catalog edit invalidates an older aggregate project form. */
async function bumpCatalogOwner(ctx: Ctx, projectId: unknown) {
  if (!projectId) return undefined
  const project = await owned(ctx, 'flow.ProjectRecord', projectId)
  return (await cas(ctx, 'flow.ProjectRecord', string(project.id), project.version, {})).version
}
