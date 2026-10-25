import { tr } from './i18n.mjs'
const rank = { viewer: 1, member: 2, editor: 2, admin: 3, owner: 4 }
export const roleLabel = (role) =>
  ({
    owner: tr('flow.ui.owner'),
    admin: tr('flow.ui.admin'),
    member: tr('flow.ui.member'),
    editor: tr('flow.ui.edit'),
    viewer: tr('flow.ui.view.only'),
    guest: tr('flow.ui.guest'),
  })[role] ?? tr('flow.ui.no.access')
/** Label of one source from the server's access read, worded as `accessFor` words it. */
export const accessSourceLabel = (source) =>
  source.retained
    ? tr('flow.ui.direct.retained.when.moved')
    : source.scope === 'internal'
      ? tr('flow.ui.internal.workspace')
      : source.scope === 'workspace'
        ? `Workspace${source.teamId ? ' · Team ' + source.teamTitle : ''}`
        : source.teamId
          ? `Team · ${source.teamTitle}`
          : tr('flow.ui.direct')
/** A person's active Teams. The server sends them with the person (the actor's as
 * `user.teamIds`); only raw prototype data still lists members on each Team. */
export const teamIdsOf = (data, userId) =>
  (userId === data.user?.id && Array.isArray(data.user.teamIds)
    ? data.user.teamIds
    : data.members?.find((m) => m.id === userId)?.teamIds) ??
  (data.teams ?? []).filter((t) => !t.archived && t.memberIds?.includes(userId)).map((t) => t.id)
export function accessFor(data, project, userId, workspaceId = project.workspaceId) {
  const member = data.members.find((m) => m.id === userId && m.status === 'active')
  if (!member || project.companyId !== data.company.id) return { role: null, sources: [] }
  const sources = []
  const teamIds = teamIdsOf(data, userId)
  for (const grant of data.grants) {
    const direct = grant.subjectType === 'user' && grant.subjectId === userId
    const team = member.role !== 'guest' && grant.subjectType === 'team' && teamIds.includes(grant.subjectId)
    if (!direct && !team) continue
    if (grant.scope === 'project' && grant.targetId === project.id)
      sources.push({
        role: grant.role,
        label: direct
          ? tr('flow.ui.direct')
          : `Team · ${data.teams.find((t) => t.id === grant.subjectId)?.title}`,
        grantId: grant.id,
      })
    if (
      member.role !== 'guest' &&
      project.access === 'workspace' &&
      grant.scope === 'workspace' &&
      grant.targetId === workspaceId
    )
      sources.push({
        role: grant.role === 'member' ? 'editor' : grant.role,
        label: `Workspace${team ? ' · Team ' + data.teams.find((t) => t.id === grant.subjectId)?.title : ''}`,
        grantId: grant.id,
      })
  }
  const workspace = data.workspaces.find((w) => w.id === workspaceId && !w.archived)
  if (!workspace) return { role: null, sources: [] }
  if (member.role !== 'guest' && workspace.access === 'internal' && project.access === 'workspace')
    sources.push({ role: 'editor', label: tr('flow.ui.internal.workspace') })
  return {
    role: sources.reduce((best, x) => ((rank[x.role] ?? 0) > (rank[best] ?? 0) ? x.role : best), null),
    sources,
  }
}
export function moveImpact(data, project, workspaceId, preserve = false) {
  return data.members
    .filter((m) => m.status === 'active')
    .map((member) => {
      const before = accessFor(data, project, member.id),
        rawAfter = accessFor(data, project, member.id, workspaceId)
      const after =
        preserve && (rank[before.role] ?? 0) > (rank[rawAfter.role] ?? 0)
          ? {
              role: before.role,
              sources: [
                ...rawAfter.sources,
                { role: before.role, label: tr('flow.ui.direct.retained.when.moved') },
              ],
            }
          : rawAfter
      return {
        id: member.id,
        name: member.name,
        before,
        after,
        change:
          (rank[after.role] ?? 0) > (rank[before.role] ?? 0)
            ? 'gain'
            : (rank[after.role] ?? 0) < (rank[before.role] ?? 0)
              ? 'loss'
              : 'same',
      }
    })
    .filter((x) => x.before.role || x.after.role)
}
export function canManageScope(data, scope, targetId, userId = data.user.id) {
  const member = data.members.find((m) => m.id === userId && m.status === 'active')
  if (!member || member.role === 'guest') return false
  if (['owner', 'admin'].includes(member.role)) return true
  return data.grants.some(
    (g) =>
      g.scope === scope &&
      g.targetId === targetId &&
      g.role === 'admin' &&
      (g.subjectType === 'user' ? g.subjectId === userId : teamIdsOf(data, userId).includes(g.subjectId)),
  )
}
