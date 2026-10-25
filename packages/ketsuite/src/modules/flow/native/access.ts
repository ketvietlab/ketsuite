import { randomBytes, randomUUID } from 'node:crypto'
import { and, deleteFrom, desc, eq, from, gt, inArray, isNull, lt, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { advanceRevision, cas, hash, mutate, now, revision } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, FlowRefusal, identity, owned, refuse, requireCapability, string } from './policy.ts'
import { requiredTitle, timestamped } from './organization.ts'
import { readMembers } from './member-read.ts'
import { readTeams, teamCounts } from './team-read.ts'
import { limitOf } from './queries.ts'

export async function saveTeam(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.team.save', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      const id = string(input.id) || randomUUID(),
        values = { title: requiredTitle(input), description: string(input.description) }
      const row = input.id ? await cas(tx, 'flow.Team', id, input.expectedVersion, values) : { version: 1 }
      if (!input.id) await tx.db.insert('flow.Team', { id, ...values, ...timestamped() })
      return { ok: true, id, version: row.version, revision: await advanceRevision(tx, input) }
    },
  )
}
export async function teamMember(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.team.member', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      const team = await owned(tx, 'flow.Team', input.id),
        M = tx.table('flow.Member'),
        T = tx.table('flow.TeamMember')
      const member = await tx.db.one(
        from(M).where(
          eq(M.companyId, tx.scope.company),
          eq(M.userId, input.memberId),
          eq(M.status, 'active'),
        ),
      )
      if (team.archived || !member || member.role === 'guest')
        return refuse('validation', { memberId: 'invalid' })
      if (input.remove !== undefined && typeof input.remove !== 'boolean')
        return refuse('validation', { remove: 'invalid' })
      const old = await tx.db.one(
        from(T).where(
          eq(T.companyId, tx.scope.company),
          eq(T.teamId, team.id),
          eq(T.memberId, member.userId),
        ),
      )
      if (input.remove && old)
        await tx.db.del(deleteFrom(T).where(eq(T.companyId, tx.scope.company), eq(T.id, old.id)))
      else if (!input.remove && !old)
        await tx.db.insert('flow.TeamMember', { id: randomUUID(), teamId: team.id, memberId: member.userId })
      return { ok: true, id: team.id, revision: await advanceRevision(tx, input) }
    },
  )
}
export async function updateMember(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.member.update', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      const M = tx.table('flow.Member')
      const member = await tx.db.one(from(M).where(eq(M.companyId, tx.scope.company), eq(M.userId, input.id)))
      if (!member) return refuse('not_found')
      if (member.role === 'owner') return refuse('owner_protected')
      if (
        !['admin', 'member', 'guest'].includes(string(input.role)) ||
        (input.revoke !== undefined && typeof input.revoke !== 'boolean')
      )
        return refuse('validation', { role: 'invalid' })
      const row = await cas(tx, 'flow.Member', string(member.id), input.expectedVersion, {
        role: input.role,
        status: input.revoke === undefined ? member.status : input.revoke ? 'revoked' : 'active',
      })
      return { ok: true, id: member.userId, version: row.version, revision: await advanceRevision(tx, input) }
    },
  )
}
export async function grantAccess(ctx: Ctx, input: Row, extensions: NativeServerExtension[], revoke = false) {
  const old = revoke ? await owned(ctx, 'flow.ScopedGrant', input.id) : null
  const scope = string(old?.scope ?? input.scope),
    targetId = old?.targetId ?? input.targetId
  if (!['workspace', 'project'].includes(scope)) return refuse('validation', { scope: 'invalid' })
  const target = { [scope === 'project' ? 'projectId' : 'workspaceId']: targetId }
  return mutate(
    ctx,
    {
      name: `flow.access.${revoke ? 'revoke' : 'grant'}`,
      capability: `${scope}.manage`,
      input: { ...input, ...target },
    },
    extensions,
    async (tx) => {
      let id = string(old?.id)
      if (revoke) {
        const G = tx.table('flow.ScopedGrant')
        if (!old) return refuse('not_found')
        await cas(tx, 'flow.ScopedGrant', id, input.expectedVersion, {})
        await tx.db.del(deleteFrom(G).where(eq(G.companyId, tx.scope.company), eq(G.id, id)))
      } else {
        const subjectType = string(input.subjectType),
          role = string(input.role)
        if (
          !['user', 'team'].includes(subjectType) ||
          !['viewer', 'member', 'editor', 'admin'].includes(role)
        )
          return refuse('validation', { role: 'invalid' })
        // One subject, or several granted together: every one is checked before any is written.
        const batch = input.subjectIds !== undefined && input.subjectIds !== null
        if (batch === (input.subjectId !== undefined && input.subjectId !== null))
          return refuse('validation', { subjectIds: 'invalid' })
        const subjectIds = (batch ? input.subjectIds : [input.subjectId]) as unknown[]
        if (
          !Array.isArray(subjectIds) ||
          !subjectIds.length ||
          subjectIds.length > 100 ||
          subjectIds.some((x) => typeof x !== 'string' || !x || x.length > 200) ||
          new Set(subjectIds).size !== subjectIds.length
        )
          return refuse('validation', { subjectIds: 'invalid' })
        const field = batch ? 'subjectIds' : 'subjectId'
        for (const subjectId of subjectIds as string[]) {
          if (subjectType === 'team') {
            const T = tx.table('flow.Team')
            const team = await tx.db.one(
              from(T).where(eq(T.companyId, tx.scope.company), eq(T.id, subjectId)),
            )
            if (!team || team.archived) return refuse('validation', { [field]: 'invalid' })
          } else {
            const M = tx.table('flow.Member')
            const member = await tx.db.one(
              from(M).where(
                eq(M.companyId, tx.scope.company),
                eq(M.userId, subjectId),
                eq(M.status, 'active'),
              ),
            )
            if (!member || (member.role === 'guest' && (scope !== 'project' || role === 'admin')))
              return refuse('validation', { [field]: 'invalid' })
          }
        }
        const G = tx.table('flow.ScopedGrant')
        const ids: string[] = []
        for (const subjectId of subjectIds as string[]) {
          const existing = await tx.db.one(
            from(G).where(
              eq(G.companyId, tx.scope.company),
              eq(G.scope, scope),
              eq(G.targetId, targetId),
              eq(G.subjectType, subjectType),
              eq(G.subjectId, subjectId),
            ),
          )
          const grantId = existing ? string(existing.id) : randomUUID()
          // A single grant changes against its version; a batch is fenced by the revision.
          if (existing)
            await cas(tx, 'flow.ScopedGrant', grantId, batch ? existing.version : input.expectedVersion, {
              role,
            })
          else
            await tx.db.insert('flow.ScopedGrant', {
              id: grantId,
              scope,
              targetId,
              subjectType,
              subjectId,
              role,
              version: 1,
            })
          ids.push(grantId)
        }
        id = ids[0]!
        return { ok: true, id, ids, revision: await advanceRevision(tx, input) }
      }
      return { ok: true, id, revision: await advanceRevision(tx, input) }
    },
  )
}
export async function inviteMember(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.member.invite', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      const email = string(input.email).normalize('NFKC').toLowerCase(),
        role = string(input.role ?? 'member')
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        !['member', 'admin', 'guest'].includes(role)
      )
        return refuse('validation', { email: 'invalid' })
      if (role === 'guest') await requireCapability(tx, 'project.manage', input)
      const I = tx.table('flow.Invitation')
      if (
        await tx.db.one(
          from(I).where(
            eq(I.companyId, tx.scope.company),
            eq(I.email, email),
            isNull(I.consumedAt),
            isNull(I.revokedAt),
            gt(I.expiresAt, now()),
          ),
        )
      )
        return refuse('invitation_pending')
      const id = randomUUID(),
        token = randomBytes(32).toString('base64url'),
        expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
      await tx.db.insert('flow.Invitation', {
        id,
        email,
        inviterId: tx.actor,
        role,
        scope: role === 'guest' ? 'project' : 'company',
        targetId: role === 'guest' ? input.projectId : null,
        digest: hash(token),
        expiresAt,
        consumedAt: null,
        revokedAt: null,
        version: 1,
        createdAt: now(),
      })
      await tx.db.insert('flow.Outbox', {
        id: randomUUID(),
        kind: 'invitation',
        targetId: id,
        payload: { email, token, expiresAt },
        state: 'pending',
        attempts: 0,
        availableAt: now(),
        createdAt: now(),
      })
      return { ok: true, id, status: 'pending', revision: await advanceRevision(tx, input) }
    },
  )
}
export async function acceptInvitation(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.invitation.accept', capability: 'invitation.accept', input },
    extensions,
    async (tx) => {
      const a = await identity(tx),
        I = tx.table('flow.Invitation'),
        M = tx.table('flow.Member')
      const invitation = await tx.db.one(
        from(I).where(eq(I.companyId, a.companyId), eq(I.digest, hash(string(input.token)))),
      )
      if (
        !invitation ||
        invitation.consumedAt ||
        invitation.revokedAt ||
        string(invitation.expiresAt) <= now() ||
        string(a.user.email).normalize('NFKC').toLowerCase() !== invitation.email
      )
        return refuse('invitation_invalid')
      if (!(await invitationAuthorized(tx, invitation))) return refuse('invitation_invalid')
      const old = await tx.db.one(from(M).where(eq(M.companyId, a.companyId), eq(M.userId, a.actorId)))
      if (old && old.status !== 'active') return refuse('forbidden')
      if (!old)
        await tx.db.insert('flow.Member', {
          id: randomUUID(),
          userId: a.actorId,
          role: invitation.role,
          status: 'active',
          title: null,
          weeklyHours: 40,
          version: 1,
        })
      if (invitation.scope === 'project') {
        const project = await owned(tx, 'flow.ProjectRecord', invitation.targetId)
        if (project.deletionId) return refuse('not_found')
        const G = tx.table('flow.ScopedGrant')
        if (
          !(await tx.db.one(
            from(G).where(
              eq(G.companyId, a.companyId),
              eq(G.scope, 'project'),
              eq(G.targetId, invitation.targetId),
              eq(G.subjectType, 'user'),
              eq(G.subjectId, a.actorId),
            ),
          ))
        )
          await tx.db.insert('flow.ScopedGrant', {
            id: randomUUID(),
            scope: 'project',
            targetId: invitation.targetId,
            subjectType: 'user',
            subjectId: a.actorId,
            role: 'viewer',
            version: 1,
          })
      }
      await cas(tx, 'flow.Invitation', string(invitation.id), invitation.version, { consumedAt: now() })
      return { ok: true, id: invitation.id }
    },
  )
}
export async function revokeInvitation(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.invitation.revoke', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      const row = await cas(tx, 'flow.Invitation', string(input.id), input.expectedVersion, {
        revokedAt: now(),
      })
      return { ok: true, id: row.id, revision: await advanceRevision(tx, input) }
    },
  )
}
export async function saveCompanySettings(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.company.save', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      const values: Row = { title: requiredTitle(input) }
      if (input.acceptanceEnabled !== undefined) {
        if (typeof input.acceptanceEnabled !== 'boolean')
          return refuse('validation', { acceptanceEnabled: 'invalid' })
        values.acceptanceEnabled = input.acceptanceEnabled
      }
      const row = await cas(
        tx,
        'flow.CompanySettings',
        string(tx.scope.company),
        input.expectedVersion,
        values,
      )
      return { ok: true, id: row.id, version: row.version, revision: await advanceRevision(tx, input) }
    },
  )
}

/** Names/emails come from the shared identity; Flow owns only membership and grants. */
export async function accessProjection(ctx: Ctx, input: Row) {
  const a = await authority(ctx)
  if (!a.member || a.member.role === 'guest') return {}
  const M = ctx.table('flow.Member'),
    U = ctx.table('user.User'),
    T = ctx.table('flow.Team'),
    TM = ctx.table('flow.TeamMember')
  const page = await readMembers(ctx, { limit: 100 })
  const members = [...page.items] as Row[]
  // Pin the actor and linked member independently of the directory window.
  if (!members.some((m) => m.id === a.actorId))
    members.push({ ...a.member, id: a.actorId, name: a.user.name, email: a.user.email })
  if (
    ['member-edit', 'member-access'].includes(string(input.route)) &&
    input.recordId &&
    !members.some((m) => m.id === input.recordId)
  ) {
    const member = await ctx.db.one(from(M).where(eq(M.companyId, a.companyId), eq(M.userId, input.recordId)))
    const person = member
      ? await ctx.db.one(from(U).where(eq(U.id, member.userId)).select(U.id, U.name, U.email))
      : null
    // The access page explains a missing person itself; the edit form cannot open one.
    if (person) members.push({ ...member, ...person })
    else if (input.route === 'member-edit') return refuse('not_found')
  }
  const users = members.map((m) => ({ id: m.userId, name: m.name, email: m.email }))
  // The Team directory's first page, plus the actor's own Teams and the one a route opens.
  const directory = await readTeams(ctx, { limit: 100 })
  const pinned = [
    ...a.teams.map((t) => string(t.id)),
    ...(['team', 'team-edit'].includes(string(input.route)) && input.recordId
      ? [string(input.recordId)]
      : []),
  ].filter((id) => !directory.items.some((t) => t.id === id))
  const extra = pinned.length
    ? await ctx.db.all(
        from(T)
          .where(eq(T.companyId, a.companyId), eq(T.archived, false), inArray(T.id, pinned))
          .select(T.id, T.title, T.description, T.version)
          .limit(1001),
      )
    : []
  const { counts } = await teamCounts(
    ctx,
    a,
    extra.map((t) => string(t.id)),
  )
  const teams = [...directory.items, ...extra.map((t) => ({ ...t, archived: false, ...counts(t.id) }))]
  // People outside the directory page carry their Teams too.
  const outside = members.filter((m) => !Array.isArray(m.teamIds)).map((m) => string(m.userId ?? m.id))
  const joins = outside.length
    ? await ctx.db.all(
        from(TM)
          .where(eq(TM.companyId, a.companyId), inArray(TM.memberId, outside))
          .select(TM.teamId, TM.memberId)
          .limit(10001),
      )
    : []
  const activeTeams = new Set(
    joins.length
      ? (
          await ctx.db.all(
            from(T)
              .where(
                eq(T.companyId, a.companyId),
                eq(T.archived, false),
                inArray(T.id, [...new Set(joins.map((j) => j.teamId))]),
              )
              .select(T.id)
              .limit(10001),
          )
        ).map((t) => t.id)
      : [],
  )
  for (const m of members)
    if (!Array.isArray(m.teamIds))
      m.teamIds = joins
        .filter((j) => j.memberId === (m.userId ?? m.id) && activeTeams.has(j.teamId))
        .map((j) => j.teamId)
  const invitations = a.manageOrganization ? await readInvitations(ctx, { limit: 50 }) : null
  return {
    memberPage: { total: page.total, cursor: page.cursor, loadedIds: page.items.map((m) => m.id) },
    members: members.map((m) => ({
      ...m,
      id: m.userId,
      name: users.find((u) => u.id === m.userId)?.name ?? '',
      email: users.find((u) => u.id === m.userId)?.email ?? '',
    })),
    people: users.map((u) => u.name),
    teams,
    teamPage: {
      total: directory.total,
      cursor: directory.cursor,
      loadedIds: directory.items.map((t) => t.id),
    },
    // Only the actor's own grants and those of their Teams: others' access is read by
    // `flow.access.list`, `flow.grant.list` and `flow.member.options`, never derived here.
    grants: a.grants,
    invitations: invitations?.items ?? [],
    ...(invitations
      ? {
          invitationPage: {
            total: invitations.total,
            cursor: invitations.cursor,
            loadedIds: invitations.items.map((i) => i.id),
          },
        }
      : {}),
  }
}

/** Pending invitations, newest first. Accepted, revoked and expired ones need no
 * action, so they are not listed; a stale cursor is refused like other pages. */
export async function readInvitations(ctx: Ctx, input: Row) {
  const a = await authority(ctx)
  if (!a.member || a.member.role === 'guest' || !a.manageOrganization) return refuse('forbidden')
  const I = ctx.table('flow.Invitation'),
    limit = limitOf(input.limit)
  const base = from(I).where(
    eq(I.companyId, a.companyId),
    isNull(I.consumedAt),
    isNull(I.revokedAt),
    gt(I.expiresAt, now()),
  )
  const fence = hash(
    JSON.stringify([a.companyId, a.actorId, 'invitations', await revision(ctx, 'collection-change')]),
  )
  let query = base
  if (input.cursor) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 2048)
      return refuse('validation', { cursor: 'invalid' })
    let c: Row
    try {
      c = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as Row
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (
      !c ||
      Array.isArray(c) ||
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 200 ||
      typeof c.time !== 'string' ||
      !Number.isFinite(Date.parse(c.time)) ||
      new Date(c.time).toISOString() !== c.time
    )
      return refuse('validation', { cursor: 'invalid' })
    if (c.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    query = query.where(or(lt(I.createdAt, c.time), and(eq(I.createdAt, c.time), lt(I.id, c.id))))
  }
  const rows = await ctx.db.all(
    query
      .select(I.id, I.email, I.role, I.scope, I.targetId, I.expiresAt, I.version, I.createdAt)
      .orderBy(desc(I.createdAt), desc(I.id))
      .limit(limit + 1),
  )
  const page = rows.slice(0, limit),
    last = page.at(-1)
  return {
    items: page.map(
      (i): Row => ({
        ...i,
        projectId: i.scope === 'project' ? i.targetId : null,
        status: 'pending',
        sentAt: i.createdAt,
      }),
    ),
    total: Number(await ctx.db.count(base)),
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ id: last.id, time: last.createdAt, fence })).toString('base64url')
        : null,
  }
}

/** Offers disclose no invitation metadata until the logged-in identity matches it. */
export async function invitationOffer(ctx: Ctx, token: unknown): Promise<Row> {
  const who = await identity(ctx),
    I = ctx.table('flow.Invitation')
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { available: false }
  const invite = await ctx.db.one(from(I).where(eq(I.companyId, who.companyId), eq(I.digest, hash(token))))
  if (
    !invite ||
    invite.revokedAt ||
    invite.consumedAt ||
    string(invite.expiresAt) <= now() ||
    string(who.user.email).normalize('NFKC').toLowerCase() !== invite.email
  )
    return { available: false }
  if (!(await invitationAuthorized(ctx, invite))) return { available: false }
  if (invite.scope === 'project') {
    const P = ctx.table('flow.ProjectRecord')
    const project = await ctx.db.one(from(P).where(eq(P.companyId, who.companyId), eq(P.id, invite.targetId)))
    if (!project || project.deletionId || project.archived) return { available: false }
  }
  return { available: true, role: invite.role, expiresAt: invite.expiresAt }
}

/** Revoke the invitation's authority when its issuer loses active access. */
export async function invitationAuthorized(ctx: Ctx, invitation: Row): Promise<boolean> {
  if (!invitation.inviterId) return false
  const issuer = { ...ctx, actor: string(invitation.inviterId) }
  try {
    await requireCapability(issuer, 'organization.manage', {})
    if (invitation.scope === 'project') {
      await requireCapability(issuer, 'project.manage', { projectId: invitation.targetId })
      const project = await owned(ctx, 'flow.ProjectRecord', invitation.targetId)
      if (project.archived || project.deletionId) return false
    }
    return true
  } catch (error) {
    if (error instanceof FlowRefusal) return false
    throw error
  }
}
