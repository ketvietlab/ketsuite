import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootWorker, defineDeployment, memoryTransport, sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import {
  address,
  company,
  livedoc,
  mail,
  mailTransport,
  partner,
  user,
  userBackend,
} from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { containsMention } from '../packages/ketsuite/src/modules/flow/native/notifications.ts'
import { everyFunction } from './helpers/permissions.ts'

test('notification mentions match complete names, never prefixes or email addresses', () => {
  assert.equal(containsMention('@Anna please review', 'Ann'), false)
  assert.equal(containsMention('mail@Ann.example.test', 'Ann'), false)
  assert.equal(containsMention('@user-id-long', 'user-id'), false)
  assert.equal(containsMention('Hi @Mai Anh, thanks', 'Mai Anh'), true)
  assert.equal(containsMention('(@Tên Việt)', 'Tên Việt'), true)
  assert.equal(containsMention('@A+B.', 'A+B'), true)
})

test('productivity notifications preserve action state, deduplicate, retry and recheck recipients before sending', async () => {
  const provider = memoryTransport({
    fail: (_message, attempt) => (attempt === 1 ? new Error('synthetic provider retry') : null),
  })
  const native = createFlowModule({
    notificationMail: { origin: 'https://flow.example.test', templateId: 'flow-notification-test' },
  })
  let revokeBeforeSend = false,
    revoke: () => Promise<void> = async () => {}
  const delivery = native.jobs!.deliverMail!
  const controlled = {
    ...native,
    jobs: {
      ...native.jobs,
      deliverMail: {
        ...delivery,
        handler: async (ctx: Parameters<NonNullable<typeof delivery.handler>>[0], args: Row) => {
          if (revokeBeforeSend) {
            revokeBeforeSend = false
            await revoke()
          }
          return delivery.handler!(ctx, args)
        },
      },
    },
  }
  const deployment = defineDeployment({
    name: 'productivity',
    companies: true,
    modules: [
      address,
      partner,
      company,
      user,
      userBackend,
      backend,
      mail,
      livedoc,
      createFlowStorageModule(),
      controlled,
      mailTransport,
    ],
    worker: { queues: { mail: 1 } },
    serve: {
      permissions: everyFunction,
      sessions: { anonymous: { company: 'notification-flow' } },
      openTransport: () => provider,
      openStore: async (config) => {
        if (!config.databaseUrl) return sqliteStore(config)
        const adapter = postgresAdapter(config.databaseUrl, { max: 2 })
        await adapter.open()
        return adapter
      },
    },
  })
  const app = await createTestDeployment(deployment, {
    worker: false,
    ...(process.env.FLOW_TEST_DATABASE_URL
      ? { env: { DATABASE_URL: process.env.FLOW_TEST_DATABASE_URL } }
      : {}),
  })
  const ok = (value: Row) => {
    assert.equal(value.ok, true, JSON.stringify(value))
    return value
  }
  const fixture = async (name: string, input: Row, actor: string | null = null) =>
    (
      await app.fixture.call<Row>(name, input, {
        actor,
        scope: { company: 'notification-flow', branches: null },
      })
    ).value
  try {
    await fixture('partner.savePartner', {
      id: 'notification-party',
      kind: 'company',
      name: 'Synthetic notifications',
    })
    await fixture('company.saveCompany', {
      id: 'notification-flow',
      partnerId: 'notification-party',
      currency: 'VND',
    })
    for (const [id, superuser] of [
      ['notification-owner', true],
      ['notification-recipient', false],
    ] as const) {
      ok(
        await fixture('user.createUser', {
          id,
          login: id,
          name: id,
          email: id + '@example.test',
          password: 'synthetic-notification-password',
          superuser,
          defaultCompanyId: 'notification-flow',
        }),
      )
      ok(
        await fixture(
          'user.grantCompany',
          { id: id + ':company', userId: id, companyId: 'notification-flow' },
          'notification-owner',
        ),
      )
    }
    await fixture(
      'user.saveRole',
      { id: 'notification-technical', name: 'Synthetic technical access' },
      'notification-owner',
    )
    for (const key of Object.keys(native.functions!))
      await fixture(
        'user.grantFunction',
        { id: 'notification:' + key, roleId: 'notification-technical', fnKey: 'flow.' + key },
        'notification-owner',
      )
    await fixture(
      'user.assignRole',
      { id: 'recipient-role', userId: 'notification-recipient', roleId: 'notification-technical' },
      'notification-owner',
    )
    await app.client.login({ login: 'notification-owner', password: 'synthetic-notification-password' })
    const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
    const context = () => call('flow.workspace.bootstrap', { route: 'organization-members' })
    const workspace = ok(
      await call('flow.workspace.create', {
        title: 'Internal notifications',
        access: 'internal',
        expectedRevision: 0,
        idempotencyKey: 'workspace',
      }),
    )
    const project = ok(
      await call('flow.project.save', {
        workspaceId: workspace.id,
        title: 'Notification tasks',
        code: 'NTF',
        access: 'workspace',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'project',
      }),
    )
    const invite = ok(
      await call('flow.member.invite', {
        email: 'notification-recipient@example.test',
        role: 'member',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'recipient-invite',
      }),
    )
    const token = await app.fixture.withTenant('', async ({ adapter }) => {
      const payload = (
        await adapter.all(
          'SELECT payload FROM flow_outbox WHERE "targetId" = ' +
            (process.env.FLOW_TEST_DATABASE_URL ? '$1' : '?'),
          [invite.id],
        )
      )[0]!.payload
      return ((typeof payload === 'string' ? JSON.parse(payload) : payload) as Row).token
    })
    const recipient = app.client.anonymous()
    await recipient.login({ login: 'notification-recipient', password: 'synthetic-notification-password' })
    ok(
      (await recipient.call<Row>('flow.invitation.accept', { token, idempotencyKey: 'accept-recipient' }))
        .value,
    )
    assert.equal(
      (
        await fixture(
          'mail_transport.saveTemplate',
          {
            id: 'flow-notification-test',
            name: 'Synthetic task notifications',
            fromAddress: 'flow@example.test',
            subjectTemplate: '{{notificationKind}} {{taskKey}}',
            textTemplate: '{{taskTitle}}\n{{taskUrl}}',
            allowedKeys: ['taskTitle', 'taskKey', 'taskUrl', 'notificationKind'],
            active: true,
          },
          'notification-owner',
        )
      ).id,
      'flow-notification-test',
    )
    const input = {
      projectId: project.id,
      title: 'Assigned from a real command',
      assigneeIds: ['notification-recipient'],
      idempotencyKey: 'first-task',
    }
    const task = ok(await call('flow.issue.save', input))
    assert.deepEqual(await call('flow.issue.save', input), task)
    const inbox = async () =>
      (await recipient.call<Row>('flow.workspace.bootstrap', { route: 'inbox', inboxFilter: 'all' })).value
    let view = await inbox()
    const note = (view.inbox as Row[])[0]!
    assert.equal((view.inbox as Row[]).length, 1)
    assert.equal(note.kind, 'assignment')
    assert.equal(note.taskId, task.id)
    assert.equal(note.actionNeeded, true)
    assert.equal(view.inboxUnreadCount, 1)
    ok(
      (
        await recipient.call<Row>('flow.inbox.read', {
          ids: [note.id],
          expectedRevision: view.operationsRevision,
          idempotencyKey: 'read-notification',
        })
      ).value,
    )
    view = await inbox()
    assert.equal((view.inbox as Row[])[0]!.read, true)
    assert.equal((view.inbox as Row[])[0]!.actionNeeded, true, 'read does not resolve an assignment')
    assert.equal(view.inboxUnreadCount, 0)
    assert.equal(provider.deliveries().length, 0, 'no provider call in the mutation transaction')
    const drain = async () => {
      const worker = await bootWorker(deployment, {
        env: app.env,
        now: () => new Date('2020-01-01T00:00:00.000Z'),
        random: () => 0,
        log: () => {},
      })
      try {
        await worker.drain()
      } finally {
        await worker.close()
      }
    }
    await drain()
    assert.equal(provider.deliveries().length, 1)
    assert.equal(provider.attempts(provider.deliveries()[0]!.message.idempotencyKey), 2)
    const progress = (
      (await call('flow.workspace.bootstrap', { route: 'board', projectId: project.id })).columns as Row[]
    ).find((c) => c.kind === 'progress')!
    const detail = (await call('flow.issue.detail', { id: task.id })).task as Row
    ok(
      await call('flow.issue.move', {
        id: task.id,
        columnId: progress.id,
        expectedVersion: detail.version,
        idempotencyKey: 'begin-task',
      }),
    )
    assert.equal(((await inbox()).inbox as Row[])[0]!.actionNeeded, false)
    const beforeComment = (await inbox()).inbox as Row[]
    ok(
      await call('flow.issue.comment', {
        id: task.id,
        text: '@notification-recipient a real mention',
        idempotencyKey: 'mention',
      }),
    )
    assert.equal(((await inbox()).inbox as Row[]).length, beforeComment.length + 1)
    await drain()
    assert.equal(provider.deliveries().length, 2)
    const preference = async (notifications: string, key: string) =>
      ok(
        (
          await recipient.call<Row>('flow.preferences.save', {
            notifications,
            expectedRevision: (await inbox()).operationsRevision,
            idempotencyKey: key,
          })
        ).value,
      )
    await preference('none', 'quiet-preference')
    const columns = (await call('flow.workspace.bootstrap', { route: 'board', projectId: project.id }))
      .columns as Row[]
    const move = async (id: unknown, kind: string, key: string) =>
      ok(
        await call('flow.issue.move', {
          id,
          columnId: columns.find((c) => c.kind === kind)!.id,
          expectedVersion: ((await call('flow.issue.detail', { id })).task as Row).version,
          idempotencyKey: key,
        }),
      )
    await move(task.id, 'todo', 'return-task')
    assert.equal(
      ((await inbox()).inbox as Row[]).find((n) => n.id === note.id)!.actionNeeded,
      false,
      'a resolved assignment does not reappear',
    )
    const blocker = ok(
      await call('flow.issue.save', {
        projectId: project.id,
        title: 'Actual dependency',
        idempotencyKey: 'blocker',
      }),
    )
    ok(
      await call('flow.issue.dependency', {
        id: task.id,
        target: blocker.id,
        expectedVersion: ((await call('flow.issue.detail', { id: task.id })).task as Row).version,
        idempotencyKey: 'add-blocker',
      }),
    )
    assert.equal(((await inbox()).inbox as Row[]).find((n) => n.kind === 'blocked')!.actionNeeded, true)
    await move(blocker.id, 'done', 'complete-blocker')
    view = await inbox()
    assert.equal((view.inbox as Row[]).find((n) => n.kind === 'blocked')!.actionNeeded, false)
    assert.equal((view.inbox as Row[]).find((n) => n.kind === 'unblocked')!.actionNeeded, true)
    await drain()
    assert.equal(
      provider.deliveries().length,
      2,
      'none preference keeps actionable Inbox events without extra email',
    )
    await preference('all', 'all-preference')
    ok(
      (
        await recipient.call<Row>('flow.issue.follow', {
          id: task.id,
          follow: true,
          expectedVersion: (
            (
              await recipient.call<Row>('flow.issue.detail', { id: task.id })
            ).value.task as Row
          ).version,
          idempotencyKey: 'follow-task',
        })
      ).value,
    )
    ok(
      await call('flow.issue.save', {
        id: task.id,
        title: 'Followed task updated',
        expectedVersion: ((await call('flow.issue.detail', { id: task.id })).task as Row).version,
        idempotencyKey: 'update-followed-task',
      }),
    )
    assert.equal(
      ((await inbox()).inbox as Row[]).some((n) => n.kind === 'update'),
      true,
    )
    await drain()
    assert.equal(provider.deliveries().length, 3, 'all preference delivers followed-task updates')
    const follow = async (enabled: boolean, key: string) =>
      ok(
        (
          await recipient.call<Row>('flow.issue.follow', {
            id: task.id,
            follow: enabled,
            expectedVersion: (
              (
                await recipient.call<Row>('flow.issue.detail', { id: task.id })
              ).value.task as Row
            ).version,
            idempotencyKey: key,
          })
        ).value,
      )
    const updateFollowed = async (key: string) =>
      ok(
        await call('flow.issue.save', {
          id: task.id,
          title: key,
          expectedVersion: ((await call('flow.issue.detail', { id: task.id })).task as Row).version,
          idempotencyKey: key,
        }),
      )
    const envelopeCount = async () => {
      let count = 0
      await app.fixture.withTenant('', async ({ adapter }) => {
        count = Number((await adapter.all('SELECT COUNT(*) AS total FROM mail_transport_delivery'))[0]!.total)
      })
      return count
    }
    const envelopesBeforeUnfollow = await envelopeCount()
    await updateFollowed('Unfollow before dispatcher')
    await follow(false, 'unfollow-before-dispatch')
    await drain()
    assert.equal(provider.deliveries().length, 3, 'unfollowing cancels queued updates before dispatch')
    assert.equal(
      await envelopeCount(),
      envelopesBeforeUnfollow,
      'dispatcher must not build an obsolete envelope',
    )
    assert.equal(
      ((await inbox()).inbox as Row[]).filter((n) => n.kind === 'update').length,
      2,
      'unfollowing preserves historical in-app updates',
    )
    await follow(true, 'refollow-before-provider')
    await updateFollowed('Unfollow after envelope')
    revoke = async () => {
      await follow(false, 'unfollow-before-provider')
    }
    revokeBeforeSend = true
    await drain()
    assert.equal(provider.deliveries().length, 3, 'unfollowing invalidates an already built email envelope')
    assert.equal(
      await envelopeCount(),
      envelopesBeforeUnfollow + 1,
      'provider guard exercises a persisted envelope',
    )
    await follow(true, 'refollow-after-cancellation')
    await drain()
    assert.equal(provider.deliveries().length, 3, 'refollowing cannot resurrect cancelled update emails')
    const setRecipientEmail = async (email: string) =>
      ok(
        await call('user.saveUser', {
          id: 'notification-recipient',
          login: 'notification-recipient',
          name: 'notification-recipient',
          email,
          accessKind: 'internal',
          active: true,
          superuser: false,
        }),
      )
    await updateFollowed('Email changed after envelope')
    revoke = () => setRecipientEmail('notification-new-address@example.test').then(() => {})
    revokeBeforeSend = true
    await drain()
    assert.equal(provider.deliveries().length, 3, 'a cached envelope cannot reach the former email address')
    assert.equal(
      await envelopeCount(),
      envelopesBeforeUnfollow + 2,
      'email change is checked after envelope persistence',
    )
    await setRecipientEmail('notification-recipient@example.test')
    await drain()
    assert.equal(provider.deliveries().length, 3, 'restoring an email cannot resurrect a cancelled envelope')
    await preference('none', 'quiet-pagination')
    for (let index = 0; index < 51; index++)
      ok(
        await call('flow.issue.comment', {
          id: task.id,
          text: '@notification-recipient paged mention ' + index,
          idempotencyKey: 'paged-mention-' + index,
        }),
      )
    const page = async (input: Row) => (await recipient.call<Row>('flow.inbox.list', input)).value
    const firstPage = await page({ filter: 'mentions', limit: 10 })
    assert.equal(firstPage.total, 52)
    assert.equal((firstPage.items as Row[]).length, 10)
    assert.ok(firstPage.cursor)
    assert.equal(
      (await page({ filter: 'all', cursor: firstPage.cursor })).ok,
      false,
      'a cursor cannot cross filters',
    )
    const ids = new Set((firstPage.items as Row[]).map((note) => note.id))
    let cursor: unknown = firstPage.cursor
    while (cursor) {
      const next = await page({ filter: 'mentions', limit: 10, cursor })
      for (const note of next.items as Row[]) {
        assert.equal(ids.has(note.id), false)
        ids.add(note.id)
      }
      cursor = next.cursor
    }
    assert.equal(ids.size, 52)
    await preference('all', 'restore-related-updates')
    // Revoke between the dispatcher building a cached envelope and provider authorization.
    ok(
      await call('flow.issue.save', {
        ...input,
        title: 'Must never reach revoked recipient',
        idempotencyKey: 'second-task',
      }),
    )
    revoke = async () => {
      const data = await context(),
        member = (data.members as Row[]).find((m) => m.id === 'notification-recipient')!
      ok(
        await call('flow.member.update', {
          id: member.id,
          role: 'member',
          revoke: true,
          expectedVersion: member.version,
          expectedRevision: data.organizationRevision,
          idempotencyKey: 'revoke-before-provider',
        }),
      )
    }
    revokeBeforeSend = true
    await drain()
    assert.equal(
      provider.deliveries().length,
      3,
      'the cached private envelope is cancelled before external send',
    )
    assert.equal((await recipient.call<Row>('flow.workspace.bootstrap', { route: 'inbox' })).value.ok, false)
    assert.equal(
      (await recipient.call<Row>('flow.inbox.read', { ids: [note.id], idempotencyKey: 'after-revoke' })).value
        .ok,
      false,
    )
  } finally {
    await app.close()
  }
})
