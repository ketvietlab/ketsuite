import { asc, eq, from, inArray, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { owned, rank, refuse, requireCapability } from './policy.ts'

/** Called only after the owner task's project-read guard. Never an organization scan. */
export async function taskCatalogs(ctx: Ctx, projectId: unknown) {
  const project = await owned(ctx, 'flow.ProjectRecord', projectId)
  const overrides = project.catalogOverrides as Row
  const read = async (model: string) => {
    const T = ctx.table(model)
    if (model === 'flow.CustomField') {
      const fields = await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, ctx.scope.company),
            eq(T.archived, false),
            or(isNull(T.projectId), eq(T.projectId, projectId)),
            or(isNull(T.appliesTo), eq(T.appliesTo, projectId)),
          )
          .orderBy(asc(T.sequence), asc(T.id))
          .limit(201),
      )
      if (fields.length > 200) return refuse('limit')
      return fields
    }
    const windows = await Promise.all(
      [isNull(T.projectId), eq(T.projectId, projectId)].map((scope) =>
        ctx.db.all(
          from(T)
            .where(eq(T.companyId, ctx.scope.company), eq(T.archived, false), scope)
            .orderBy(asc(T.sequence), asc(T.id))
            .limit(201),
        ),
      ),
    )
    if (windows.some((rows) => rows.length > 200)) return refuse('limit')
    return windows
      .flat()
      .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
  }
  const [columns, types, labels, fields] = await Promise.all([
    read('flow.TaskStatus'),
    read('flow.TaskType'),
    read('flow.Label'),
    read('flow.CustomField'),
  ])
  const chosen = (rows: Row[], key: string) => {
    const ids = overrides[key]
    return Array.isArray(ids)
      ? rows.filter((r) => ids.includes(r.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      : rows.filter((r) => !r.projectId)
  }
  return {
    projectId,
    columns: chosen(columns, 'taskStatusIds').map((c) => ({
      id: c.id,
      label: c.title,
      kind: c.kind,
      color: c.color,
      projectId: c.projectId,
    })),
    types: types.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      icon: t.icon,
      projectId: t.projectId,
    })),
    tags: chosen(
      labels.filter((l) => l.domain === 'task'),
      'taskLabelIds',
    ).map((t) => ({
      id: t.id,
      title: t.title,
      color: t.color,
      projectId: t.projectId,
      archived: t.archived,
    })),
    fields: fields.map((f) => ({
      id: f.id,
      title: f.title,
      kind: f.kind,
      required: f.required,
      options: f.options,
      projectId: f.projectId,
      appliesTo: f.appliesTo,
      archived: f.archived,
    })),
  }
}

/** Composer choices have the same authorization boundary as task detail. */
export async function taskOptions(ctx: Ctx, input: Row) {
  const actor = await requireCapability(ctx, 'project.read', { projectId: input.projectId })
  const project = await owned(ctx, 'flow.ProjectRecord', input.projectId)
  const workspace = await owned(ctx, 'flow.Workspace', project.workspaceId)
  const canWrite = !project.archived && (rank[actor.projectRole(project, workspace) ?? ''] ?? 0) >= 2
  const S = ctx.table('flow.SprintRecord')
  const sprints = await ctx.db.all(
    from(S)
      .where(
        eq(S.companyId, ctx.scope.company),
        eq(S.projectId, project.id),
        eq(S.archived, false),
        inArray(S.state, ['planned', 'active']),
      )
      .orderBy(asc(S.start), asc(S.id))
      .select(S.id, S.title, S.projectId, S.state)
      .limit(201),
  )
  if (sprints.length > 200) return refuse('limit')
  return {
    ...(await taskCatalogs(ctx, input.projectId)),
    project: {
      id: project.id,
      title: project.title,
      code: project.code,
      workspaceId: project.workspaceId,
      canWrite,
      sprintCadence: project.sprintCadence,
    },
    sprints,
  }
}
