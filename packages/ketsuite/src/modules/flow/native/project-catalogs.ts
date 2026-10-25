import { randomUUID } from 'node:crypto'
import { asc, eq, from, gt, isNull } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { catalogColors, catalogTitleKey } from '@ketvietlab/flow-client/catalog-contract.mjs'
import { requireUnusedStatus } from './catalogs.ts'
import { createFlowServerExtensions } from '@ketvietlab/flow-client/server'
import { cas, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { owned, refuse, requireCapability, string } from './policy.ts'
import { timestamped } from './organization.ts'

const kinds = ['todo', 'progress', 'review', 'done']

function checkedCatalog(value: unknown, statuses: boolean, field: string): Row[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > 30 || (statuses && !value.length))
    return refuse('validation', { [field]: 'invalid' })
  const ids = new Set<string>(),
    names = new Set<string>()
  const items = value.map((v: unknown): Row => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return refuse('validation', { [field]: 'invalid' })
    const item = v as Row,
      id = string(item.id),
      title = string(item.title),
      name = catalogTitleKey(title)
    if (
      !id ||
      id.length > 100 ||
      ids.has(id) ||
      !title ||
      title.length > 240 ||
      names.has(name) ||
      !catalogColors.includes(string(item.color)) ||
      (statuses && !kinds.includes(string(item.kind)))
    )
      return refuse('validation', { [field]: 'invalid' })
    ids.add(id)
    names.add(name)
    return {
      id,
      title,
      color: item.color,
      ...(item.sourceId ? { sourceId: string(item.sourceId) } : {}),
      ...(statuses ? { kind: item.kind } : {}),
    }
  })
  if (field === 'taskStatuses' && kinds.some((kind) => !items.some((i) => i.kind === kind)))
    return refuse('validation', { [field]: 'groups_required' })
  return items
}

type CatalogPlan = {
  field: string
  model: string
  domain: string
  status: boolean
  items: Row[] | null
  oldIds: string[] | null
  allowed: Set<string>
  remap: Map<string, string>
  provenance: Row
}

async function globalDefinitions(ctx: Ctx, model: string, domain: string, status: boolean) {
  const T = ctx.table(model),
    rows: Row[] = []
  let after = ''
  while (true) {
    const window = await ctx.db.all(
      from(T)
        .where(
          eq(T.companyId, ctx.scope.company),
          isNull(T.projectId),
          eq(T.archived, false),
          ...(status ? [] : [eq(T.domain, domain)]),
          ...(after ? [gt(T.id, after)] : []),
        )
        .orderBy(asc(T.id))
        .limit(100),
    )
    rows.push(...window)
    if (window.length < 100) return rows
    after = string(window.at(-1)!.id)
  }
}

async function planCatalog(
  ctx: Ctx,
  projectId: string,
  field: string,
  items: Row[] | null,
  previous: Row,
): Promise<CatalogPlan> {
  const status = field === 'taskStatuses',
    model = status ? 'flow.TaskStatus' : 'flow.Label',
    domain = field === 'projectLabels' ? 'project' : 'task',
    idsKey = status ? 'taskStatusIds' : domain === 'task' ? 'taskLabelIds' : 'projectLabelIds',
    sourceKey = idsKey + 'Sources',
    oldIds = Array.isArray(previous[idsKey]) ? (previous[idsKey] as string[]) : null,
    sources = (previous[sourceKey] ?? {}) as Row,
    plan: CatalogPlan = {
      field,
      model,
      domain,
      status,
      items,
      oldIds,
      allowed: new Set(),
      remap: new Map(),
      provenance: {},
    }
  if (items === null) {
    const globals = await globalDefinitions(ctx, model, domain, status)
    for (const row of globals) plan.allowed.add(string(row.id))
    for (const id of oldIds ?? []) {
      const target = globals.find((row) => row.id === sources[id])
      if (!target) continue
      const old = await owned(ctx, model, id)
      if (!status || old.kind === target.kind) plan.remap.set(id, string(target.id))
    }
    return plan
  }
  const sourceIds = new Set<string>()
  for (const item of items) {
    const id = string(item.id),
      sourceId = string(item.sourceId),
      T = ctx.table(model)
    const old = await ctx.db.one(from(T).where(eq(T.companyId, ctx.scope.company), eq(T.id, id)))
    if (old && (old.projectId !== projectId || (!status && old.domain !== domain)))
      return refuse('validation', { [field]: 'scope' })
    if (old && status && old.kind !== item.kind) await requireUnusedStatus(ctx, old)
    plan.allowed.add(id)
    if (old && sourceId && sourceId !== id) return refuse('validation', { [field]: 'source_target' })
    if (!sourceId) {
      if (sources[id]) plan.provenance[id] = sources[id]
      continue
    }
    if (sourceIds.has(sourceId)) return refuse('validation', { [field]: 'source_duplicate' })
    sourceIds.add(sourceId)
    const source = await owned(ctx, model, sourceId)
    if (
      source.archived ||
      (oldIds ? !oldIds.includes(sourceId) : source.projectId !== null) ||
      (!status && source.domain !== domain)
    )
      return refuse('validation', { [field]: 'source_scope' })
    if (status && source.kind !== item.kind) {
      const T = ctx.table('flow.Task')
      if (
        await ctx.db.count(
          from(T).where(
            eq(T.companyId, ctx.scope.company),
            eq(T.projectId, projectId),
            eq(T.columnId, sourceId),
          ),
        )
      )
        return refuse('validation', { kind: 'catalog_status_in_use' })
    }
    plan.remap.set(sourceId, id)
    plan.provenance[id] = sources[sourceId] ?? (source.projectId === null ? sourceId : null)
  }
  return plan
}

/** Apply bounded windows inside the project CAS transaction; never truncate a remap. */
async function remapTasks(
  ctx: Ctx,
  projectId: string,
  plans: CatalogPlan[],
  extensions: NativeServerExtension[],
) {
  const statuses = plans.find((p) => p.status),
    labels = plans.find((p) => p.field === 'taskLabels')
  if (!statuses && !labels) return
  const T = ctx.table('flow.Task'),
    L = ctx.table('flow.TaskLabel'),
    registry = createFlowServerExtensions<Ctx>(extensions)
  const project = await owned(ctx, 'flow.ProjectRecord', projectId)
  let after = ''
  while (true) {
    const tasks = await ctx.db.all(
      from(T)
        .where(
          eq(T.companyId, ctx.scope.company),
          eq(T.projectId, projectId),
          ...(after ? [gt(T.id, after)] : []),
        )
        .orderBy(asc(T.id))
        .limit(100),
    )
    for (const task of tasks) {
      const columnId = statuses?.remap.get(string(task.columnId)) ?? string(task.columnId)
      if (statuses && !statuses.allowed.has(columnId)) return refuse('in_use', { taskStatuses: 'in_use' })
      const associations: Row[] = []
      let labelAfter = ''
      if (labels)
        while (true) {
          const window = await ctx.db.all(
            from(L)
              .where(
                eq(L.companyId, ctx.scope.company),
                eq(L.taskId, task.id),
                ...(labelAfter ? [gt(L.id, labelAfter)] : []),
              )
              .orderBy(asc(L.id))
              .limit(100),
          )
          associations.push(...window)
          if (window.length < 100) break
          labelAfter = string(window.at(-1)!.id)
        }
      const tags = associations.map((row) => labels?.remap.get(string(row.labelId)) ?? string(row.labelId))
      if (labels && tags.some((id) => !labels.allowed.has(id)))
        return refuse('in_use', { taskLabels: 'in_use' })
      if (columnId === task.columnId && !associations.some((row, i) => row.labelId !== tags[i])) continue
      const mutation = {
        name: 'flow.issue.save',
        capability: 'project.write',
        input: {
          id: task.key,
          projectId,
          columnId,
          ...(labels ? { tagIds: tags } : {}),
          expectedVersion: task.version,
          catalogRemap: true,
        },
      }
      await registry.mutate(
        {
          requireCapability: (capability, input) => requireCapability(ctx, capability, input),
          transaction: (work) => work(ctx),
        },
        mutation,
        async (tx) => {
          for (const [i, row] of associations.entries())
            if (row.labelId !== tags[i])
              await tx.db.update('flow.TaskLabel', { id: row.id }, { labelId: tags[i] })
          const updated = await cas(tx, 'flow.Task', string(task.id), task.version, { columnId })
          await tx.db.insert('flow.TaskHistory', {
            id: randomUUID(),
            taskId: task.id,
            projectId,
            workspaceId: project.workspaceId,
            actorId: tx.actor,
            kind: 'catalog_remapped',
            description: 'Project catalog remapped',
            metadata: {
              from: task.columnId,
              to: columnId,
              version: updated.version,
              changes: [
                ...(columnId !== task.columnId
                  ? [{ field: 'status', before: task.columnId, after: columnId }]
                  : []),
                ...(associations.some((row, i) => row.labelId !== tags[i])
                  ? [{ field: 'tags', before: associations.map((row) => row.labelId), after: tags }]
                  : []),
              ],
            },
            createdAt: now(),
          })
          return updated
        },
      )
    }
    if (tasks.length < 100) break
    after = string(tasks.at(-1)!.id)
  }
  if (statuses) {
    const V = ctx.table('flow.SavedView')
    let cursor = ''
    while (true) {
      const views = await ctx.db.all(
        from(V)
          .where(
            eq(V.companyId, ctx.scope.company),
            eq(V.projectId, projectId),
            ...(cursor ? [gt(V.id, cursor)] : []),
          )
          .orderBy(asc(V.id))
          .limit(100),
      )
      for (const view of views) {
        const status = statuses.remap.get(string(view.status))
        if (view.status !== 'all' && !statuses.allowed.has(status ?? string(view.status)))
          return refuse('in_use', { taskStatuses: 'view_in_use' })
        if (status && status !== view.status)
          await cas(ctx, 'flow.SavedView', string(view.id), view.version, { status })
      }
      if (views.length < 100) break
      cursor = string(views.at(-1)!.id)
    }
  }
}

/** Catalog definitions, task references and the owner version commit together. */
export async function projectCatalogs(
  ctx: Ctx,
  projectId: string,
  input: Row,
  previous: Row,
  extensions: NativeServerExtension[],
  existing: boolean,
): Promise<Row> {
  const result: Row = { ...previous },
    plans: CatalogPlan[] = []
  for (const field of ['projectStatuses', 'projectLabels', 'taskStatuses', 'taskLabels']) {
    if (input[field] === undefined) continue
    const items = checkedCatalog(input[field], field.endsWith('Statuses'), field)
    if (field === 'projectStatuses') {
      result.projectStatuses = items
      continue
    }
    plans.push(await planCatalog(ctx, projectId, field, items, previous))
  }
  const ids = plans.flatMap((p) => (p.items ?? []).map((item) => string(item.id)))
  if (new Set(ids).size !== ids.length) return refuse('validation', { taskLabels: 'catalog_id_duplicate' })
  for (const plan of plans) {
    for (const [sequence, item] of (plan.items ?? []).entries()) {
      const T = ctx.table(plan.model),
        old = await ctx.db.one(from(T).where(eq(T.companyId, ctx.scope.company), eq(T.id, item.id)))
      const values = {
        title: item.title,
        color: item.color,
        sequence,
        archived: false,
        ...(plan.status ? { kind: item.kind, icon: 'circle' } : { domain: plan.domain }),
      }
      if (old) await cas(ctx, plan.model, string(item.id), old.version, values)
      else await ctx.db.insert(plan.model, { id: item.id, projectId, ...timestamped(), ...values })
    }
    const key = plan.status ? 'taskStatusIds' : plan.domain === 'task' ? 'taskLabelIds' : 'projectLabelIds'
    result[key] = plan.items === null ? null : [...plan.allowed]
    result[key + 'Sources'] = plan.items === null ? null : plan.provenance
  }
  if (existing) await remapTasks(ctx, projectId, plans, extensions)
  for (const plan of plans)
    for (const id of (plan.oldIds ?? []).filter((id) => !plan.allowed.has(id))) {
      const T = ctx.table(plan.status ? 'flow.Task' : 'flow.TaskLabel')
      if (
        await ctx.db.count(
          from(T).where(eq(T.companyId, ctx.scope.company), eq(plan.status ? T.columnId : T.labelId, id)),
        )
      )
        return refuse('in_use', { [plan.field]: 'in_use' })
      const old = await owned(ctx, plan.model, id)
      await cas(ctx, plan.model, id, old.version, { archived: true })
    }
  return result
}

export function remapProjectTags(input: unknown, previous: Row, next: Row, definitions: unknown): unknown {
  if (!Array.isArray(input)) return input
  if (Array.isArray(definitions)) {
    const map = new Map(definitions.map((item) => [string((item as Row).sourceId), string((item as Row).id)]))
    return input.map((id) => map.get(string(id)) ?? id)
  }
  if (definitions === null) {
    const sources = (previous.projectLabelIdsSources ?? {}) as Row
    return input
      .map((id) => sources[string(id)] ?? id)
      .filter((id) => !(next.projectLabelIds as string[] | null)?.includes(id))
  }
  return input
}
