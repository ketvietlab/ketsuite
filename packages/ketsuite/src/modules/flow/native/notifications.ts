import { asc, eq, from, gt, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, JobSpec, Row } from '@ketvietlab/ketjs'
import type { MailDeliveryGuard } from '../../mail_transport/jobs.ts'
import { deliveryEnvelope, queueTemplate } from '../../mail_transport/delivery-service.ts'
import { hash, now } from './command.ts'
import type { NativeMutation, NativeServerExtension } from './command.ts'
import { FlowRefusal, policyEffects, refuse, requireCapability, string } from './policy.ts'
import { invitationAuthorized } from './access.ts'

export type FlowNotificationMail = { origin: string; templateId: string }
export const containsMention = (text: string, name: string) => {
  if (!name) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_@])@${escaped}(?=$|[^\\p{L}\\p{N}_-])`, 'u').test(text)
}
const readEffects = [
  ...policyEffects,
  ...[
    'Task',
    'TaskStatus',
    'TaskRelation',
    'TaskAssignee',
    'TaskFollower',
    'UserPreference',
    'Inbox',
    'Outbox',
    'Invitation',
  ].map((model) => 'read:flow.' + model),
]
const mailEffects = [
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'write:mail_transport.DeliveryNotification',
  'enqueue:flow.deliverMail',
]
const permittedRecipient = async (ctx: Ctx, userId: unknown, projectId: unknown) => {
  try {
    await requireCapability({ ...ctx, actor: string(userId) }, 'project.read', { projectId })
    return true
  } catch (error) {
    if (error instanceof FlowRefusal) return false
    throw error
  }
}
const preference = async (ctx: Ctx, userId: unknown) => {
  const P = ctx.table('flow.UserPreference')
  const row = await ctx.db.one(
    from(P).where(eq(P.companyId, ctx.scope.company), eq(P.userId, userId), eq(P.key, 'personal')),
  )
  return string((row?.value as Row | undefined)?.notifications) || 'mentions'
}
const extraAllowed = (choice: string, kind: unknown) =>
  choice === 'all' || (choice === 'mentions' && ['mention', 'assignment'].includes(string(kind)))

async function stillFollowing(ctx: Ctx, notification: Row) {
  if (notification.kind !== 'update') return true
  const F = ctx.table('flow.TaskFollower')
  return Boolean(
    await ctx.db.one(
      from(F).where(
        eq(F.companyId, ctx.scope.company),
        eq(F.taskId, notification.taskId),
        eq(F.userId, notification.recipientId),
      ),
    ),
  )
}

async function stateOf(ctx: Ctx, task: Row) {
  const S = ctx.table('flow.TaskStatus'),
    A = ctx.table('flow.TaskAssignee'),
    R = ctx.table('flow.TaskRelation'),
    T = ctx.table('flow.Task')
  const [status, assigned, relations] = await Promise.all([
    ctx.db.one(from(S).where(eq(S.companyId, ctx.scope.company), eq(S.id, task.columnId))),
    ctx.db.all(
      from(A).where(eq(A.companyId, ctx.scope.company), eq(A.taskId, task.id)).select(A.userId).limit(31),
    ),
    ctx.db.all(
      from(R)
        .where(eq(R.companyId, ctx.scope.company), eq(R.targetId, task.id), eq(R.kind, 'blocks'))
        .select(R.taskId)
        .limit(101),
    ),
  ])
  if (assigned.length > 30 || relations.length > 100) return refuse('limit')
  const blockers = relations.length
    ? await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, ctx.scope.company),
            inArray(
              T.id,
              relations.map((r) => r.taskId),
            ),
          )
          .select(T.id, T.columnId, T.archived)
          .limit(100),
      )
    : []
  const statuses = blockers.length
    ? await ctx.db.all(
        from(S)
          .where(
            eq(S.companyId, ctx.scope.company),
            inArray(
              S.id,
              blockers.map((t) => t.columnId),
            ),
          )
          .select(S.id, S.kind)
          .limit(100),
      )
    : []
  return {
    task,
    kind: string(status?.kind),
    assignees: assigned.map((a) => string(a.userId)),
    blocked: blockers.some((t) => !t.archived && statuses.find((s) => s.id === t.columnId)?.kind !== 'done'),
  }
}
type Snapshot = Awaited<ReturnType<typeof stateOf>>

export async function notificationAction(ctx: Ctx, notification: Row, task?: Row) {
  if (!notification.actionNeeded || !task || task.archived) return false
  const state = await stateOf(ctx, task)
  if (!state.assignees.includes(string(notification.recipientId))) return false
  if (notification.kind === 'blocked') return state.blocked
  if (notification.kind === 'assignment') return state.kind === 'todo'
  if (notification.kind === 'unblocked') return state.kind === 'todo' && !state.blocked
  return Boolean(notification.actionNeeded)
}

/** A provider retry cannot send an obsolete private Flow body. Other applications are unaffected. */
export function createFlowMailGuard(): MailDeliveryGuard {
  return {
    name: 'flow-domain-recipient',
    effects: readEffects,
    authorize: async (ctx, delivery) => {
      if (
        !string(delivery.id).startsWith('flow-invitation-') &&
        !string(delivery.id).startsWith('flow-notification-')
      )
        return true
      const O = ctx.table('flow.Outbox')
      const outbox = await ctx.db.one(
        from(O).where(eq(O.companyId, ctx.scope.company), eq(O.deliveryId, delivery.id)),
      )
      if (outbox?.state !== 'queued') return false
      if (outbox.kind === 'invitation') {
        const I = ctx.table('flow.Invitation')
        const invite = await ctx.db.one(
          from(I).where(eq(I.companyId, ctx.scope.company), eq(I.id, outbox.targetId)),
        )
        return Boolean(
          invite &&
            !invite.revokedAt &&
            !invite.consumedAt &&
            string(invite.expiresAt) > now() &&
            (await invitationAuthorized(ctx, invite)),
        )
      }
      const I = ctx.table('flow.Inbox'),
        T = ctx.table('flow.Task')
      const note = await ctx.db.one(
        from(I).where(eq(I.companyId, ctx.scope.company), eq(I.id, outbox.targetId)),
      )
      if (
        !note ||
        !extraAllowed(await preference(ctx, note.recipientId), note.kind) ||
        !(await stillFollowing(ctx, note))
      )
        return false
      const U = ctx.table('user.User')
      const recipient = await ctx.db.one(from(U).where(eq(U.id, note.recipientId), eq(U.active, true)))
      const envelope = deliveryEnvelope(delivery)
      // An envelope may outlive an account email change. Never send private task
      // content to the former address, including on a provider retry.
      if (
        !recipient?.email ||
        envelope.to.length !== 1 ||
        envelope.cc?.length ||
        envelope.bcc?.length ||
        string(envelope.to[0]?.address).toLowerCase() !== string(recipient.email).toLowerCase()
      )
        return false
      const task = await ctx.db.one(from(T).where(eq(T.companyId, ctx.scope.company), eq(T.id, note.taskId)))
      return Boolean(
        task &&
          !task.archived &&
          (await permittedRecipient(ctx, note.recipientId, task.projectId)) &&
          (!note.actionNeeded || (await notificationAction(ctx, note, task))),
      )
    },
  }
}

/** Hooks only write durable records; every external effect belongs to a job. */
export function nativeNotifications(config?: FlowNotificationMail): {
  extension: NativeServerExtension
  jobs: Record<string, JobSpec>
} {
  const origin = config ? new URL(config.origin) : null
  if (
    origin &&
    (origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      !(
        origin.protocol === 'https:' ||
        (origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))
      ) ||
      !config?.templateId)
  )
    throw new Error('Flow notifications require a trusted HTTPS origin and template')
  const snapshots = new WeakMap<Ctx, Map<string, Snapshot>>()
  const emit = async (
    ctx: Ctx,
    mutation: NativeMutation,
    state: Snapshot,
    kind: string,
    recipientId: string,
    actionNeeded: boolean,
  ) => {
    if (recipientId === ctx.actor || !(await permittedRecipient(ctx, recipientId, state.task.projectId)))
      return
    if (kind === 'update' && !((await preference(ctx, recipientId)) === 'all')) return
    const id = hash(
      JSON.stringify([
        ctx.scope.company,
        ctx.actor,
        mutation.name,
        mutation.input.idempotencyKey,
        state.task.id,
        kind,
        recipientId,
      ]),
    )
    await ctx.db.insertIfAbsent('flow.Inbox', {
      id,
      recipientId,
      actorId: ctx.actor,
      taskId: state.task.id,
      projectId: state.task.projectId,
      kind,
      title: string(state.task.title),
      titleKey:
        kind === 'assignment'
          ? 'flow.today.assigned'
          : kind === 'mention'
            ? 'flow.ui.mentions'
            : kind === 'update'
              ? 'flow.notification.updated'
              : 'flow.review.' + kind,
      body: string(state.task.title),
      read: false,
      actionNeeded,
      route: 'issue',
      createdAt: now(),
      version: 1,
    })
    if (!config || !extraAllowed(await preference(ctx, recipientId), kind)) return
    await ctx.db.insertIfAbsent('flow.Outbox', {
      id,
      kind: 'notification',
      targetId: id,
      payload: {},
      state: 'pending',
      attempts: 0,
      availableAt: now(),
      createdAt: now(),
    })
    await ctx.jobs.enqueue(
      'flow.dispatchNotification',
      { outboxId: id },
      { uniqueKey: 'flow-notification:' + id },
    )
  }
  const active = (mutation: NativeMutation) =>
    (mutation.name.startsWith('flow.issue.') &&
      !['flow.issue.follow', 'flow.issue.reorder'].includes(mutation.name)) ||
    mutation.name === 'flow.form.submit'
  return {
    extension: {
      name: 'flow-native-notifications',
      effects: [
        ...readEffects,
        'write:flow.Inbox',
        'write:flow.Outbox',
        ...(config ? [...mailEffects, 'enqueue:flow.dispatchNotification'] : []),
      ],
      readEffects: [],
      beforeMutation: async (ctx, mutation) => {
        if (!active(mutation)) return
        const keys = [
          ...new Set(
            [
              ...(Array.isArray(mutation.input.ids) ? mutation.input.ids : []),
              mutation.input.id,
              mutation.input.taskId,
            ].filter(Boolean),
          ),
        ]
        if (keys.length > 100) return refuse('limit')
        const T = ctx.table('flow.Task'),
          R = ctx.table('flow.TaskRelation')
        const tasks = keys.length
          ? await ctx.db.all(
              from(T)
                .where(eq(T.companyId, ctx.scope.company), or(inArray(T.id, keys), inArray(T.key, keys)))
                .limit(100),
            )
          : []
        const readable: Row[] = []
        for (const task of tasks)
          if (await permittedRecipient(ctx, ctx.actor, task.projectId)) readable.push(task)
        const outgoing = readable.length
          ? await ctx.db.all(
              from(R)
                .where(
                  eq(R.companyId, ctx.scope.company),
                  inArray(
                    R.taskId,
                    readable.map((t) => t.id),
                  ),
                  eq(R.kind, 'blocks'),
                )
                .select(R.targetId)
                .limit(1001),
            )
          : []
        if (outgoing.length > 1000) return refuse('limit')
        const dependents = outgoing.length
          ? await ctx.db.all(
              from(T)
                .where(
                  eq(T.companyId, ctx.scope.company),
                  inArray(
                    T.id,
                    outgoing.map((r) => r.targetId),
                  ),
                )
                .limit(1000),
            )
          : []
        const before = new Map<string, Snapshot>()
        for (const task of [...readable, ...dependents])
          if (!before.has(string(task.id))) before.set(string(task.id), await stateOf(ctx, task))
        snapshots.set(ctx, before)
      },
      afterMutation: async (ctx, mutation, value) => {
        if (!active(mutation)) return
        const before = snapshots.get(ctx) ?? new Map<string, Snapshot>()
        snapshots.delete(ctx)
        const T = ctx.table('flow.Task'),
          F = ctx.table('flow.TaskFollower')
        const id = (value as Row | null)?.id
        if (!before.size && !id) return
        const tasks = await ctx.db.all(
          from(T)
            .where(
              eq(T.companyId, ctx.scope.company),
              or(
                ...(before.size ? [inArray(T.id, [...before.keys()])] : []),
                ...(id ? [eq(T.id, id), eq(T.key, id)] : []),
              ),
            )
            .limit(1001),
        )
        if (tasks.length > 1000) return refuse('limit')
        for (const task of tasks) {
          const old = before.get(string(task.id)),
            next = await stateOf(ctx, task)
          // Once resolved, an old action never reappears when work moves back
          // to Todo. Read acknowledgement stays independent of this transition.
          const I = ctx.table('flow.Inbox')
          let after = ''
          while (true) {
            const pending = await ctx.db.all(
              from(I)
                .where(
                  eq(I.companyId, ctx.scope.company),
                  eq(I.taskId, task.id),
                  eq(I.actionNeeded, true),
                  ...(after ? [gt(I.id, after)] : []),
                )
                .orderBy(asc(I.id))
                .limit(100),
            )
            for (const note of pending)
              if (!(await notificationAction(ctx, note, task)))
                await ctx.db.compareAndSet(
                  'flow.Inbox',
                  { id: note.id },
                  { version: note.version, actionNeeded: true },
                  { actionNeeded: false, version: Number(note.version) + 1 },
                )
            if (pending.length < 100) break
            after = string(pending.at(-1)!.id)
          }
          if (task.archived) continue
          for (const user of next.assignees.filter((user) => !old?.assignees.includes(user)))
            await emit(ctx, mutation, next, 'assignment', user, next.kind === 'todo' && !next.blocked)
          if (old ? old.blocked !== next.blocked : next.blocked)
            for (const user of next.assignees)
              await emit(
                ctx,
                mutation,
                next,
                next.blocked ? 'blocked' : 'unblocked',
                user,
                next.blocked || next.kind === 'todo',
              )
          if (old && old.task.version !== task.version) {
            const followers = await ctx.db.all(
              from(F)
                .where(eq(F.companyId, ctx.scope.company), eq(F.taskId, task.id))
                .select(F.userId)
                .limit(1001),
            )
            if (followers.length > 1000) return refuse('limit')
            for (const follower of followers)
              await emit(ctx, mutation, next, 'update', string(follower.userId), false)
          }
          if (mutation.name === 'flow.issue.comment') {
            const text = string(mutation.input.text ?? mutation.input.body)
            const M = ctx.table('flow.Member'),
              U = ctx.table('user.User')
            const members = await ctx.db.all(
              from(M)
                .where(eq(M.companyId, ctx.scope.company), eq(M.status, 'active'))
                .select(M.userId)
                .limit(1001),
            )
            if (members.length > 1000) return refuse('limit')
            const users = members.length
              ? await ctx.db.all(
                  from(U)
                    .where(
                      inArray(
                        U.id,
                        members.map((m) => m.userId),
                      ),
                    )
                    .select(U.id, U.name)
                    .limit(1000),
                )
              : []
            for (const user of users)
              if ([string(user.id), string(user.name)].some((name) => containsMention(text, name)))
                await emit(ctx, mutation, next, 'mention', string(user.id), false)
          }
        }
      },
    },
    jobs:
      config && origin
        ? {
            dispatchNotification: {
              queue: 'mail',
              input: { outboxId: 'id' },
              effects: [...readEffects, 'write:flow.Outbox', ...mailEffects],
              idempotent: true,
              maxAttempts: 5,
              timeoutMs: 30_000,
              handler: async (ctx, args) =>
                ctx.tx(async (tx) => {
                  const O = tx.table('flow.Outbox'),
                    I = tx.table('flow.Inbox'),
                    T = tx.table('flow.Task'),
                    U = tx.table('user.User')
                  const outbox = await tx.db.one(
                    from(O).where(
                      eq(O.companyId, tx.scope.company),
                      eq(O.id, args.outboxId),
                      eq(O.kind, 'notification'),
                    ),
                  )
                  if (outbox?.state !== 'pending') return
                  const note = await tx.db.one(
                    from(I).where(eq(I.companyId, tx.scope.company), eq(I.id, outbox.targetId)),
                  )
                  const task = note
                    ? await tx.db.one(from(T).where(eq(T.companyId, tx.scope.company), eq(T.id, note.taskId)))
                    : null
                  const user = note
                    ? await tx.db.one(from(U).where(eq(U.id, note.recipientId), eq(U.active, true)))
                    : null
                  if (
                    !note ||
                    !task ||
                    task.archived ||
                    !user?.email ||
                    !extraAllowed(await preference(tx, note.recipientId), note.kind) ||
                    !(await stillFollowing(tx, note)) ||
                    !(await permittedRecipient(tx, note.recipientId, task.projectId)) ||
                    (note.actionNeeded && !(await notificationAction(tx, note, task)))
                  ) {
                    await tx.db.update('flow.Outbox', { id: outbox.id }, { state: 'cancelled', payload: {} })
                    return
                  }
                  const link = new URL('/flow/issue', origin)
                  link.searchParams.set('id', string(task.key))
                  link.searchParams.set('project', string(task.projectId))
                  link.searchParams.set('company', string(tx.scope.company))
                  const delivery = await queueTemplate(tx, {
                    id: 'flow-notification-' + hash(JSON.stringify([tx.scope.company, outbox.id])),
                    templateId: config.templateId,
                    deliveryJob: 'flow.deliverMail',
                    context: {
                      taskTitle: task.title,
                      taskKey: task.key,
                      taskUrl: link.href,
                      notificationKind: note.kind,
                    },
                    to: [{ address: user.email }],
                  })
                  await tx.db.update(
                    'flow.Outbox',
                    { id: outbox.id },
                    {
                      state: 'queued',
                      deliveryId: delivery.id,
                      attempts: Number(outbox.attempts) + 1,
                      payload: {},
                    },
                  )
                }),
            },
          }
        : {},
  }
}
