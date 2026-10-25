import { and, asc, eq, from, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { permittedFor } from '../../user/roles.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'

export class FlowRefusal extends Error {
  readonly code: string
  readonly fields: Record<string, string>
  constructor(code: string, fields: Record<string, string> = {}) {
    super(code)
    this.code = code
    this.fields = fields
  }
}
export const refuse = (code: string, fields: Record<string, string> = {}): never => {
  throw new FlowRefusal(code, fields)
}
export const string = (value: unknown): string => String(value ?? '').trim()
export const rank: Record<string, number> = { viewer: 1, member: 2, editor: 2, admin: 3, owner: 4 }
/** The same Core grant engine is used for the actor and assignment candidates. */
export function scopeRoles(companyId: unknown, member: Row | null | undefined, grants: Row[]) {
  const scopedRole = (scope: string, targetId: unknown): string | null =>
    grants
      .filter((g) => g.scope === scope && g.targetId === targetId)
      .reduce<string | null>(
        (role, grant) =>
          (rank[string(grant.role)] ?? 0) > (rank[role ?? ''] ?? 0) ? string(grant.role) : role,
        null,
      )
  const workspaceRole = (w: Row): string | null => {
    if (!member || member.status !== 'active' || w.companyId !== companyId || w.archived) return null
    const granted = scopedRole('workspace', w.id)
    if (member.role !== 'guest' && w.access === 'internal' && (rank[granted ?? ''] ?? 0) < 2) return 'member'
    return member.role === 'guest' ? null : granted
  }
  const projectRole = (p: Row, w: Row): string | null => {
    if (
      !member ||
      member.status !== 'active' ||
      p.companyId !== companyId ||
      p.workspaceId !== w.id ||
      w.archived
    )
      return null
    const direct = scopedRole('project', p.id)
    const inherited = member.role !== 'guest' && p.access === 'workspace' ? workspaceRole(w) : null
    return (rank[direct ?? ''] ?? 0) >= (rank[inherited ?? ''] ?? 0) ? direct : inherited
  }
  return { scopedRole, workspaceRole, projectRole }
}
export const policyEffects = [
  ...AUTHORIZATION_READ_EFFECTS,
  'read:user.User',
  'read:user.Membership',
  'read:user.BranchMembership',
  'read:company.Branch',
  'read:company.Company',
  'read:partner.Partner',
  'read:flow.Member',
  'read:flow.Workspace',
  'read:flow.ProjectRecord',
  'read:flow.Team',
  'read:flow.TeamMember',
  'read:flow.ScopedGrant',
]

export async function identity(ctx: Ctx) {
  if (!ctx.actor || !ctx.scope.company) return refuse('forbidden')
  const U = ctx.table('user.User'),
    M = ctx.table('user.Membership'),
    C = ctx.table('company.Company')
  const [user, membership, company] = await Promise.all([
    ctx.db.one(from(U).where(eq(U.id, ctx.actor), eq(U.active, true))),
    ctx.db.one(from(M).where(eq(M.userId, ctx.actor), eq(M.companyId, ctx.scope.company))),
    ctx.db.one(from(C).where(eq(C.id, ctx.scope.company), eq(C.active, true))),
  ])
  if (!user || !membership || !company) return refuse('forbidden')
  const functions = await permittedFor(ctx, ctx.actor)
  if (functions !== null && !functions.includes('flow.workspace.bootstrap')) return refuse('forbidden')
  return { user, actorId: ctx.actor, companyId: ctx.scope.company }
}

export const owned = async (ctx: Ctx, model: string, id: unknown): Promise<Row> => {
  const T = ctx.table(model)
  const row = await ctx.db.one(from(T).where(eq(T.id, string(id)), eq(T.companyId, ctx.scope.company)))
  if (!row) return refuse('not_found')
  return row
}

export async function authority(ctx: Ctx) {
  const who = await identity(ctx)
  const M = ctx.table('flow.Member'),
    TM = ctx.table('flow.TeamMember'),
    T = ctx.table('flow.Team'),
    G = ctx.table('flow.ScopedGrant')
  const member = await ctx.db.one(from(M).where(eq(M.userId, who.actorId), eq(M.companyId, who.companyId)))
  if (member && member.status !== 'active') return refuse('forbidden')
  const joins =
    member?.role === 'guest'
      ? []
      : await ctx.db.all(
          from(TM).where(eq(TM.memberId, who.actorId), eq(TM.companyId, who.companyId)).limit(1001),
        )
  if (joins.length > 1000) return refuse('limit')
  const teamIds = joins.map((x) => string(x.teamId))
  const teams = teamIds.length
    ? await ctx.db.all(
        from(T)
          .where(inArray(T.id, teamIds), eq(T.archived, false), eq(T.companyId, who.companyId))
          .limit(1000),
      )
    : []
  const activeTeams = teams.map((x) => string(x.id))
  const grants = member
    ? await ctx.db.all(
        from(G)
          .where(
            eq(G.companyId, who.companyId),
            or(
              and(eq(G.subjectType, 'user'), eq(G.subjectId, who.actorId)),
              ...(activeTeams.length
                ? [and(eq(G.subjectType, 'team'), inArray(G.subjectId, activeTeams))]
                : []),
            ),
          )
          .limit(2001),
      )
    : []
  if (grants.length > 2000) return refuse('limit')
  const { scopedRole, workspaceRole, projectRole } = scopeRoles(who.companyId, member, grants)
  const manageOrganization = Boolean(member && ['owner', 'admin'].includes(string(member.role)))
  const canInitialize = async () => {
    if (member) return false
    const permissions = await permittedFor(ctx, who.actorId)
    if (permissions !== null && !permissions.includes('flow.workspace.initialize')) return false
    const rows = await ctx.db.all(from(M).where(eq(M.companyId, who.companyId)).orderBy(asc(M.id)).limit(1))
    return rows.length === 0
  }
  return {
    ...who,
    member,
    grants,
    teams,
    manageOrganization,
    workspaceRole,
    projectRole,
    scopedRole,
    canInitialize,
  }
}

export async function requireCapability(ctx: Ctx, capability: string, input: Row) {
  const a = await authority(ctx)
  if (capability === 'invitation.accept') return a
  if (capability === 'initialize' && (await a.canInitialize())) return a
  if (!a.member) return refuse('forbidden')
  if (capability === 'organization.manage') {
    if (!a.manageOrganization) return refuse('forbidden')
    return a
  }
  if (capability === 'member.read') return a
  if (capability.startsWith('workspace.')) {
    const w = await owned(ctx, 'flow.Workspace', input.workspaceId ?? input.id)
    const needed = capability === 'workspace.read' ? 1 : capability === 'workspace.write' ? 2 : 3
    if (
      !(capability === 'workspace.manage' && a.manageOrganization) &&
      (rank[a.workspaceRole(w) ?? ''] ?? 0) < needed
    )
      return refuse('forbidden')
    return a
  }
  if (capability === 'project.delete') {
    const permissions = await permittedFor(ctx, a.actorId)
    if (permissions !== null && !permissions.includes('flow.project.delete')) return refuse('forbidden')
    const P = ctx.table('flow.ProjectRecord')
    const p = await ctx.db.one(from(P).where(eq(P.companyId, a.companyId), eq(P.id, input.projectId)))
    if (!p) {
      const D = ctx.table('flow.DeletionRecord')
      const receipt = await ctx.db.one(
        from(D).where(eq(D.companyId, a.companyId), eq(D.projectId, input.projectId)),
      )
      if (!receipt || !a.manageOrganization) return refuse('not_found')
      return a
    }
    const w = await owned(ctx, 'flow.Workspace', p.workspaceId)
    if (!a.manageOrganization && (rank[a.projectRole(p, w) ?? ''] ?? 0) < 3) return refuse('forbidden')
    return a
  }
  const p = await owned(ctx, 'flow.ProjectRecord', input.projectId)
  if (p.deletionId) return refuse('not_found')
  if (capability === 'project.write' && p.archived) return refuse('archived')
  const w = await owned(ctx, 'flow.Workspace', p.workspaceId)
  const role = a.projectRole(p, w)
  if (capability === 'project.manage' && a.manageOrganization && a.member.role !== 'guest') return a
  const needed = capability === 'project.read' ? 1 : capability === 'project.manage' ? 3 : 2
  if ((rank[role ?? ''] ?? 0) < needed) return refuse('forbidden')
  return a
}
