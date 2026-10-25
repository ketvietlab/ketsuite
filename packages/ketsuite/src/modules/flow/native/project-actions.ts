import { randomBytes, randomUUID } from 'node:crypto'
import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { advanceRevision, cas, hash, mutate, now, revision } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { owned, refuse, requireCapability, string } from './policy.ts'
import { accessGraph, changeOf, impactPage } from './access-read.ts'
import type { Impact } from './access-read.ts'

/** Everyone whose access the move changes or keeps, through the shared Core engine:
 * the project's own grants, the two Workspaces' grants and the Teams they name. */
async function moveImpact(ctx: Ctx, input: Row) {
  const project = await owned(ctx, 'flow.ProjectRecord', input.projectId ?? input.id)
  await requireCapability(ctx, 'project.manage', { projectId: project.id })
  await requireCapability(ctx, 'workspace.manage', { workspaceId: project.workspaceId })
  const before = await owned(ctx, 'flow.Workspace', project.workspaceId),
    after = await owned(ctx, 'flow.Workspace', input.targetWorkspaceId)
  if (project.archived || after.archived || before.id === after.id) return refuse('validation')
  const a = await requireCapability(ctx, 'workspace.manage', { workspaceId: after.id })
  const graph = await accessGraph(ctx, string(a.companyId), {
    projectIds: [string(project.id)],
    workspaceIds: [string(before.id), string(after.id)],
  })
  const moved = { ...project, workspaceId: after.id }
  const people = graph.members
    .map((m): Impact => {
      const old = graph.effective(m, project, before),
        next = graph.effective(m, moved, after)
      return {
        id: string(m.userId),
        name: m.name,
        email: m.email,
        projectId: string(project.id),
        projectTitle: string(project.title),
        before: old,
        after: next,
        change: changeOf(old, next),
      }
    })
    .filter((p) => p.before.role || p.after.role)
  return { a, project, after, people, grants: graph.grants }
}
export async function previewProjectMove(ctx: Ctx, input: Row) {
  const { a, project, after, people } = await moveImpact(ctx, input)
  const preserve = input.preserve === true
  // Keeping access adds a direct project grant at the old role, so nobody loses it.
  const rows = people.map(
    (p): Impact =>
      preserve && p.change === 'loss'
        ? {
            ...p,
            after: {
              role: p.before.role,
              sources: [
                ...p.after.sources,
                {
                  role: string(p.before.role),
                  scope: 'project',
                  grantId: null,
                  teamId: null,
                  teamTitle: null,
                  teamMemberCount: null,
                  retained: true,
                },
              ],
            },
            change: 'same',
          }
        : p,
  )
  const page = await impactPage(ctx, a, rows, input, ['move-preview', project.id, after.id, preserve])
  return {
    ok: true,
    revision: await revision(ctx),
    people: page.items,
    total: page.total,
    summary: page.counts,
    cursor: page.cursor,
  }
}
export async function moveProject(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const projectId = string(input.projectId ?? input.id)
  return mutate(
    ctx,
    { name: 'flow.project.move', capability: 'project.manage', input: { ...input, projectId } },
    extensions,
    async (tx) => {
      const { project, after, people, grants } = await moveImpact(tx, input)
      if (typeof input.preserve !== 'boolean') return refuse('validation')
      const nextRevision = await advanceRevision(tx, input)
      if (input.preserve) {
        for (const person of people.filter((p) => p.change === 'loss')) {
          const previous = grants.find(
            (g) =>
              g.scope === 'project' &&
              g.targetId === project.id &&
              g.subjectType === 'user' &&
              g.subjectId === person.id,
          )
          if (previous)
            await cas(tx, 'flow.ScopedGrant', string(previous.id), previous.version, {
              role: person.before.role,
            })
          else
            await tx.db.insert('flow.ScopedGrant', {
              id: randomUUID(),
              scope: 'project',
              targetId: project.id,
              subjectType: 'user',
              subjectId: person.id,
              role: person.before.role,
              version: 1,
            })
        }
      }
      const saved = await cas(tx, 'flow.ProjectRecord', string(project.id), input.expectedVersion, {
        workspaceId: after.id,
      })
      // Workspace documents stay in their workspace; only project-owned pages follow the project.
      await tx.db.update(
        'flow.Document',
        { projectId: project.id, companyId: tx.scope.company },
        { workspaceId: after.id },
      )
      return {
        ok: true,
        id: project.id,
        workspaceId: after.id,
        version: saved.version,
        revision: nextRevision,
      }
    },
  )
}
export async function projectAccess(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.project.access', capability: 'project.manage', input: { ...input, projectId: input.id } },
    extensions,
    async (tx) => {
      if (!['private', 'workspace'].includes(string(input.access))) return refuse('validation')
      const saved = await cas(tx, 'flow.ProjectRecord', string(input.id), input.expectedVersion, {
        access: input.access,
      })
      return { ok: true, id: saved.id, version: saved.version, revision: await advanceRevision(tx, input) }
    },
  )
}
export async function favoriteProject(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.project.favorite', capability: 'project.read', input: { ...input, projectId: input.id } },
    extensions,
    async (tx) => {
      const id = hash(JSON.stringify([tx.scope.company, tx.actor, 'favorites'])),
        P = tx.table('flow.UserPreference')
      const held = await tx.db.one(from(P).where(eq(P.companyId, tx.scope.company), eq(P.id, id)))
      const old = Array.isArray(held?.value) ? (held.value as string[]) : [],
        key = string(input.id)
      const value = old.includes(key) ? old.filter((x) => x !== key) : [...old, key]
      if (value.length > 500) return refuse('limit')
      if (held) await cas(tx, 'flow.UserPreference', id, held.version, { value })
      else
        await tx.db.insert('flow.UserPreference', {
          id,
          userId: tx.actor,
          key: 'favorites',
          value,
          version: 1,
        })
      // Personal: a favourite is the actor's own preference and moves no shared revision.
      return { ok: true }
    },
  )
}
export async function resendInvitation(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.invitation.resend', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      const invitation = await owned(tx, 'flow.Invitation', input.id)
      if (invitation.revokedAt || invitation.consumedAt) return refuse('validation')
      if (invitation.scope === 'project')
        await requireCapability(tx, 'project.manage', { projectId: invitation.targetId })
      const token = randomBytes(32).toString('base64url'),
        expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
      const saved = await cas(tx, 'flow.Invitation', string(invitation.id), input.expectedVersion, {
        digest: hash(token),
        inviterId: tx.actor,
        expiresAt,
      })
      await tx.db.insert('flow.Outbox', {
        id: randomUUID(),
        kind: 'invitation',
        targetId: invitation.id,
        payload: { email: invitation.email, token, expiresAt },
        state: 'pending',
        attempts: 0,
        availableAt: now(),
        createdAt: now(),
      })
      return { ok: true, id: saved.id, version: saved.version, revision: await advanceRevision(tx, input) }
    },
  )
}
