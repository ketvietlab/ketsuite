// Focused regressions from the mail/activity review. Run after building KetSuite.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineModule,
  eq,
  from,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Ctx, Row } from '@ketvietlab/ketjs'
import { address, partner, company, storage, user, mail, mailTransport, activity } from '@ketvietlab/ketsuite'
import {
  dispatchNotification,
  NOTIFICATION_DELIVERY_EFFECTS,
} from '../packages/ketsuite/src/modules/mail_transport/notification-delivery.ts'
import { civilDate } from '../packages/ketsuite/src/modules/company/civil-date.ts'
import { targetFunctions } from '../packages/ketsuite/src/modules/mail/index.ts'
import { targetActivityFunctions } from '../packages/ketsuite/src/modules/activity/index.ts'

const target = {
  resModel: 'partner.Partner',
  targetEffect: 'read:partner.Partner',
  verify: async (ctx: Ctx, id: string) => {
    const P = ctx.table('partner.Partner')
    const row = await ctx.db.one(from(P).where(eq(P.id, id)))
    assert.ok(row)
    return { id, displayName: String(row.name) }
  },
}
const bridge = defineModule({
  name: 'mail_review_fixture',
  depends: ['mail', 'activity', 'mail_transport'],
  functions: {
    dispatch: {
      input: { id: 'id' },
      effects: NOTIFICATION_DELIVERY_EFFECTS,
      handler: async (ctx, args) => {
        await dispatchNotification(ctx, String(args.id))
        return { ok: true }
      },
    },
    seedEmail: {
      effects: ['write:mail.Thread', 'write:mail.Message', 'write:mail.Notification'],
      handler: async (ctx) => {
        await ctx.db.insert('mail.Thread', {
          id: 'thread:legacy:customer',
          resModel: 'partner.Partner',
          resId: 'customer',
          displayName: 'Customer',
          active: true,
          createdAt: '2026-10-12T00:00:00.000Z',
        })
        await ctx.db.insert('mail.Message', {
          id: 'external-message',
          threadId: 'thread:legacy:customer',
          kind: 'comment',
          direction: 'outgoing',
          body: 'External message',
          externalVisible: true,
          createdAt: '2026-10-12T00:00:00.000Z',
        })
        await ctx.db.insert('mail.Notification', {
          id: 'external-notification',
          messageId: 'external-message',
          recipientPartnerId: 'customer',
          channel: 'email',
          state: 'ready',
          createdAt: '2026-10-12T00:00:00.000Z',
        })
        return { ok: true }
      },
    },
    ...targetFunctions(target),
    ...Object.fromEntries(
      Object.entries(targetActivityFunctions(target)).map(([key, spec]) => [`activity_${key}`, spec]),
    ),
    seedDelivery: {
      input: { state: 'text?' },
      effects: ['write:mail_transport.Delivery'],
      handler: (ctx, args) =>
        ctx.db.insert('mail_transport.Delivery', {
          id: 'secret-delivery',
          fromAddress: 'sender@example.test',
          to: [{ address: 'recipient@example.test' }],
          subject: 'token=secret',
          text: 'token=secret',
          html: '<a href="?token=secret">reset</a>',
          headers: { 'X-Secret': 'secret' },
          bcc: [{ address: 'hidden@example.test' }],
          state: args.state ?? 'queued',
          version: 1,
          idempotencyKey: 'secret:v1',
          attempts: 0,
          queuedAt: '2026-10-12T00:00:00.000Z',
          updatedAt: '2026-10-12T00:00:00.000Z',
        }),
    },
  },
})
const modules = [address, partner, company, storage, user, mail, mailTransport, activity, bridge]
const manifest = compose(modules, { headless: true, companies: true })
type Result = Row & {
  following: boolean
  followerId: string
  total: number
  followers: Row[]
  activity: Row
  deliveries: Row[]
}
const call = async (
  adapter: Adapter,
  key: string,
  args: Row = {},
  companyId = 'acme',
  actor: string | null = 'staff',
) => {
  const result = await callFn(key, args, {
    adapter,
    manifest,
    scope: { company: companyId, branches: null },
    actor,
  })
  return { ...result, value: result.value as Result }
}
async function fixture(fn: (adapter: Adapter) => Promise<void>) {
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, manifest)
    registerFunctions(modules)
    for (const id of ['customer', 'staff-partner'])
      await call(
        adapter,
        'partner.savePartner',
        { id, kind: 'person', name: id, email: `${id}@example.test` },
        'acme',
        null,
      )
    await call(
      adapter,
      'user.createUser',
      { id: 'staff', login: 'staff', password: 'test-password', name: 'Staff', partnerId: 'staff-partner' },
      'acme',
      null,
    )
    await call(
      adapter,
      'user.createUser',
      { id: 'invited', login: 'invited', password: 'test-password', name: 'Invited' },
      'acme',
      null,
    )
    await fn(adapter)
  } finally {
    await adapter.close()
  }
}

test('shared partner chatter creates distinct company threads', () =>
  fixture(async (adapter) => {
    const first = await call(adapter, 'mail_review_fixture.follow', { targetId: 'customer' })
    const second = await call(adapter, 'mail_review_fixture.follow', { targetId: 'customer' }, 'beta')
    assert.equal(first.value.following, true)
    assert.equal(second.value.following, true)
    assert.notEqual(first.value.followerId, second.value.followerId)
  }))

test('invited users without partners can read existing and empty chatter', () =>
  fixture(async (adapter) => {
    const empty = await call(
      adapter,
      'mail_review_fixture.timeline',
      { targetId: 'customer' },
      'acme',
      'invited',
    )
    assert.equal(empty.value.following, false)
    await call(adapter, 'mail_review_fixture.follow', { targetId: 'customer' })
    const existing = await call(
      adapter,
      'mail_review_fixture.timeline',
      { targetId: 'customer' },
      'acme',
      'invited',
    )
    assert.equal(existing.value.following, false)
    assert.equal(existing.value.followers.length, 1)
  }))

test('archived activity types allow existing work to complete', () =>
  fixture(async (adapter) => {
    const type = {
      id: 'call',
      name: 'Call',
      category: 'call',
      defaultDelayDays: 0,
      chainingPolicy: 'none',
      sequence: 1,
      active: true,
    }
    await call(adapter, 'activity.saveType', type)
    await call(adapter, 'mail_review_fixture.activity_schedule', {
      id: 'task',
      targetId: 'customer',
      typeId: 'call',
      summary: 'Call back',
      dueDate: '2026-10-12',
    })
    await call(adapter, 'activity.saveType', { ...type, active: false })
    const result = await call(adapter, 'activity.complete', {
      id: 'task',
      feedback: 'Done',
      completedDate: '2026-10-12',
    })
    assert.ok(result.value.activity.doneAt)
    await assert.rejects(
      call(adapter, 'mail_review_fixture.activity_schedule', {
        id: 'new-task',
        targetId: 'customer',
        typeId: 'call',
        summary: 'New',
        dueDate: '2026-10-12',
      }),
      { code: 'E_ACTIVITY_TYPE' },
    )
  }))

test('outbox readers receive metadata without content or hidden recipients', () =>
  fixture(async (adapter) => {
    await call(adapter, 'mail_review_fixture.seedDelivery')
    const result = await call(adapter, 'mail_transport.listOutbox')
    assert.equal(result.value.deliveries[0].id, 'secret-delivery')
    for (const key of ['subject', 'text', 'html', 'headers', 'bcc'])
      assert.equal(Object.hasOwn(result.value.deliveries[0], key), false, key)
    assert.doesNotMatch(JSON.stringify(result.value), /token=secret/)
  }))

test('outbox cancellation refuses work already claimed by a sender', () =>
  fixture(async (adapter) => {
    await call(adapter, 'mail_review_fixture.seedDelivery', { state: 'sending' })
    await assert.rejects(call(adapter, 'mail_transport.cancel', { id: 'secret-delivery' }), {
      code: 'E_MAIL_DELIVERY_SENDING',
    })
  }))

test('public queue reuse cannot disclose an existing rendered reset message', () =>
  fixture(async (adapter) => {
    await call(adapter, 'mail_review_fixture.seedDelivery')
    const queued = await call(adapter, 'mail_transport.queueTemplate', {
      id: 'secret-delivery',
      templateId: 'missing',
      to: [],
      context: {},
    })
    assert.equal((queued.value.delivery as Row).id, 'secret-delivery')
    assert.doesNotMatch(JSON.stringify(queued.value), /token=|hidden@example/)
  }))

test('outbox retry refuses sending and cancellation invalidates queued work', () =>
  fixture(async (adapter) => {
    await call(adapter, 'mail_review_fixture.seedDelivery', { state: 'sending' })
    await assert.rejects(call(adapter, 'mail_transport.retry', { id: 'secret-delivery' }), {
      code: 'E_MAIL_DELIVERY_SENDING',
    })
    await adapter.run('UPDATE mail_transport_delivery SET state = ? WHERE id = ?', [
      'queued',
      'secret-delivery',
    ])
    await call(adapter, 'mail_transport.cancel', { id: 'secret-delivery' })
    const [delivery] = await adapter.all('SELECT state, version FROM mail_transport_delivery WHERE id = ?', [
      'secret-delivery',
    ])
    assert.equal(delivery.state, 'cancelled')
    assert.equal(delivery.version, 2, 'the old queued job no longer owns this delivery version')
  }))

test('retryable delivery restarts attempts with a new version and the same idempotency key', () =>
  fixture(async (adapter) => {
    await call(adapter, 'mail_review_fixture.seedDelivery', { state: 'retryable' })
    await adapter.run('UPDATE mail_transport_delivery SET attempts = ? WHERE id = ?', [3, 'secret-delivery'])
    await call(adapter, 'mail_transport.retry', { id: 'secret-delivery' })
    const [delivery] = await adapter.all(
      'SELECT state, version, attempts, "idempotencyKey" FROM mail_transport_delivery WHERE id = ?',
      ['secret-delivery'],
    )
    assert.equal(delivery.state, 'queued')
    assert.equal(delivery.version, 2)
    assert.equal(delivery.attempts, 0)
    assert.equal(delivery.idempotencyKey, 'secret:v1')
  }))

test('company civil date advances at midnight in Vietnam independently of host timezone', () => {
  assert.equal(civilDate('2026-10-12T17:00:00.000Z'), '2026-10-13')
  assert.equal(civilDate('2026-10-12T16:59:59.999Z'), '2026-10-12')
  assert.equal(civilDate('2026-10-12T17:00:00.000Z', 'America/Los_Angeles'), '2026-10-12')
})

test('reassignment requires a current company member and transfers actor ownership', () =>
  fixture(async (adapter) => {
    await call(
      adapter,
      'partner.savePartner',
      { id: 'company-party', kind: 'company', name: 'Review company' },
      'acme',
      null,
    )
    await call(
      adapter,
      'company.saveCompany',
      { id: 'acme', code: 'ACME', partnerId: 'company-party', currency: 'VND' },
      'acme',
      null,
    )
    await call(
      adapter,
      'user.grantCompany',
      { id: 'invited:acme', userId: 'invited', companyId: 'acme' },
      'acme',
      null,
    )
    await call(adapter, 'activity.saveType', {
      id: 'call',
      name: 'Call',
      category: 'call',
      defaultDelayDays: 0,
      chainingPolicy: 'none',
      sequence: 1,
      active: true,
    })
    await call(adapter, 'mail_review_fixture.activity_schedule', {
      id: 'task',
      targetId: 'customer',
      typeId: 'call',
      summary: 'Call',
      dueDate: '2026-10-12',
    })
    const reassigned = await call(adapter, 'activity.reassign', { id: 'task', assigneeUserId: 'invited' })
    assert.equal(reassigned.value.activity.assigneeUserId, 'invited')
    await assert.rejects(call(adapter, 'activity.cancel', { id: 'task' }), { code: 'E_ACTIVITY_AUTHORITY' })
    const cancelled = await call(adapter, 'activity.cancel', { id: 'task' }, 'acme', 'invited')
    assert.ok(cancelled.value.activity.canceledAt)
  }))

test('email notification dispatch binds once and preserves legacy thread identity', () =>
  fixture(async (adapter) => {
    await call(adapter, 'mail_review_fixture.seedEmail')
    await call(adapter, 'mail_transport.saveTemplate', {
      id: 'notification-template',
      name: 'mail.notification',
      fromAddress: 'sender@example.test',
      subjectTemplate: '{{targetName}}',
      textTemplate: '{{body}}',
      allowedKeys: ['targetName', 'body'],
      active: true,
    })
    await call(adapter, 'mail_review_fixture.dispatch', { id: 'external-notification' })
    await call(adapter, 'mail_review_fixture.dispatch', { id: 'external-notification' })
    const outbox = await call(adapter, 'mail_transport.listOutbox')
    assert.equal(outbox.value.deliveries.length, 1)
    assert.equal(outbox.value.deliveries[0].state, 'queued')
    const timeline = await call(adapter, 'mail_review_fixture.timeline', { targetId: 'customer' })
    assert.equal(timeline.value.threadId, 'thread:legacy:customer')
    await call(adapter, 'mail_transport.cancel', { id: outbox.value.deliveries[0].id })
    const notifications = await adapter.all('SELECT state FROM mail_notification WHERE id = ?', [
      'external-notification',
    ])
    assert.equal(notifications[0].state, 'cancelled')
  }))
