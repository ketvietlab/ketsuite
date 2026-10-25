import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { everyFunction } from './helpers/permissions.ts'

test('productivity invitations deliver after commit and reject obsolete tokens through HTTP', async () => {
  const provider = memoryTransport({
    fail: (message, attempt) =>
      message.to[0]?.address === 'invited@example.test' && attempt === 1
        ? new Error('temporary provider failure')
        : null,
  })
  const native = createFlowModule({
    invitationMail: { origin: 'https://flow.example.test', templateId: 'flow-invitation' },
  })
  const artifactsDir = await mkdtemp(join(tmpdir(), 'flow-invitation-delivery-'))
  const env = process.env.FLOW_TEST_DATABASE_URL
    ? { DATABASE_URL: process.env.FLOW_TEST_DATABASE_URL }
    : undefined
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
      mailTransport,
      livedoc,
      createFlowStorageModule(),
      native,
    ],
    worker: { queues: { mail: 1 } },
    serve: {
      permissions: everyFunction,
      openTransport: () => provider,
      sessions: { anonymous: { company: 'invitation-company' } },
      openStore: async (config) => {
        if (!config.databaseUrl) return sqliteStore(config)
        const adapter = postgresAdapter(config.databaseUrl, { max: 2 })
        await adapter.open()
        return adapter
      },
    },
  })
  const app = await createTestDeployment(deployment, { worker: false, artifactsDir, env })
  const ok = (value: Row) => {
    assert.equal(value.ok, true, JSON.stringify(value))
    return value
  }
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'invitation-partner',
      kind: 'company',
      name: 'Invitation delivery',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'invitation-company',
      partnerId: 'invitation-partner',
      currency: 'VND',
    })
    await app.fixture.call('user.saveRole', { id: 'invitation-role', name: 'Invitation test' })
    for (const key of [
      'workspace.initialize',
      'workspace.create',
      'workspace.bootstrap',
      'project.save',
      'access.grant',
      'member.update',
      'member.invite',
      'invitation.resend',
      'invitation.revoke',
      'invitation.accept',
    ])
      await app.fixture.call('user.grantFunction', {
        id: 'invitation-fn-' + key,
        roleId: 'invitation-role',
        fnKey: 'flow.' + key,
      })
    for (const [id, email] of [
      ['invitation-owner', 'owner@example.test'],
      ['invitation-reader', 'invited@example.test'],
      ['invitation-wrong', 'wrong@example.test'],
      ['invitation-guest', 'guest@example.test'],
    ]) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          name: id,
          email,
          password: 'synthetic-invitation-password',
          defaultCompanyId: 'invitation-company',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: id + '-company',
        userId: id,
        companyId: 'invitation-company',
      })
      await app.fixture.call('user.assignRole', { id: id + '-role', userId: id, roleId: 'invitation-role' })
    }
    await app.client.login({ login: 'invitation-owner', password: 'synthetic-invitation-password' })
    const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
    const context = () => call('flow.workspace.bootstrap', { route: 'organization-members' })
    const workspace = ok(
      await call('flow.workspace.create', {
        title: 'Invitation workspace',
        expectedRevision: 0,
        idempotencyKey: 'workspace',
      }),
    )
    await app.fixture.call(
      'mail_transport.saveTemplate',
      {
        id: 'flow-invitation',
        name: 'Flow invitation',
        fromAddress: 'invites@example.test',
        fromName: 'Flow',
        subjectTemplate: 'Invitation to Flow',
        textTemplate: '{{invitationUrl}}',
        htmlTemplate: '<a href="{{invitationUrl}}">Accept</a>',
        allowedKeys: ['invitationUrl', 'email', 'expiresAt', 'role'],
        active: true,
      },
      { actor: 'invitation-owner', scope: { company: 'invitation-company' } },
    )
    const inviteArgs = {
      email: 'invited@example.test',
      role: 'member',
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'invite',
    }
    const invite = ok(await call('flow.member.invite', inviteArgs))
    assert.deepEqual(await call('flow.member.invite', inviteArgs), invite)
    assert.equal(provider.deliveries().length, 0, 'HTTP transaction never invokes the provider')
    assert.equal((await context()).invitationDelivery, 'queued-email')
    const tokenOf = async (id: unknown) =>
      app.fixture.withTenant('', async ({ adapter }) => {
        const rows = await adapter.all(
          'SELECT payload FROM flow_outbox WHERE "targetId" = ' +
            (env ? '$1' : '?') +
            ' AND state = ' +
            (env ? '$2' : '?'),
          [id, 'pending'],
        )
        const payload =
          typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload) : (rows[0]!.payload as Row)
        return String(payload.token)
      })
    const oldToken = await tokenOf(invite.id)
    const reader = app.client.anonymous(),
      wrong = app.client.anonymous()
    await reader.login({ login: 'invitation-reader', password: 'synthetic-invitation-password' })
    await wrong.login({ login: 'invitation-wrong', password: 'synthetic-invitation-password' })
    assert.deepEqual(
      (await wrong.call<Row>('flow.workspace.bootstrap', { route: 'invitation-accept', recordId: oldToken }))
        .value.invitationOffer,
      { available: false },
    )
    assert.equal(
      (await wrong.call<Row>('flow.invitation.accept', { token: oldToken, idempotencyKey: 'wrong-identity' }))
        .value.ok,
      false,
    )
    const resendArgs = {
      id: invite.id,
      expectedVersion: 1,
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'resend',
    }
    const resent = ok(await call('flow.invitation.resend', resendArgs))
    assert.deepEqual(await call('flow.invitation.resend', resendArgs), resent)
    const token = await tokenOf(invite.id)
    assert.notEqual(token, oldToken)
    assert.equal(
      (await reader.call<Row>('flow.invitation.accept', { token: oldToken, idempotencyKey: 'obsolete' }))
        .value.ok,
      false,
    )
    const revoke = ok(
      await call('flow.member.invite', {
        email: 'revoked@example.test',
        role: 'member',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'invite-revoke',
      }),
    )
    const revokedToken = await tokenOf(revoke.id)
    ok(
      await call('flow.invitation.revoke', {
        id: revoke.id,
        expectedVersion: 1,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'revoke',
      }),
    )
    const expired = ok(
      await call('flow.member.invite', {
        email: 'expired@example.test',
        role: 'member',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'invite-expiry',
      }),
    )
    await app.fixture.withTenant('', ({ adapter }) =>
      adapter.run(
        'UPDATE flow_invitation SET "expiresAt" = ' +
          (env ? '$1' : '?') +
          ' WHERE id = ' +
          (env ? '$2' : '?'),
        ['2000-01-01T00:00:00.000Z', expired.id],
      ),
    )
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
    assert.equal(
      provider.deliveries().length,
      1,
      'revoked, expired, replay and obsolete invitations send no email',
    )
    const sent = provider.deliveries()[0]!.message
    assert.equal(
      provider.attempts(sent.idempotencyKey),
      2,
      'temporary provider failure retries with a stable envelope key',
    )
    assert.equal(sent.to[0]!.address, 'invited@example.test')
    const link = new URL(sent.text.trim())
    assert.equal(link.origin, 'https://flow.example.test')
    assert.equal(link.pathname, '/flow/invitation-accept')
    assert.equal(link.searchParams.get('id'), token)
    assert.equal(
      (await reader.call<Row>('flow.workspace.bootstrap', { route: 'invitation-accept', recordId: token }))
        .value.invitationOffer instanceof Object,
      true,
    )
    assert.equal(
      (
        (await reader.call<Row>('flow.workspace.bootstrap', { route: 'invitation-accept', recordId: token }))
          .value.invitationOffer as Row
      ).available,
      true,
    )
    const accept = { token, idempotencyKey: 'accept' },
      accepted = ok((await reader.call<Row>('flow.invitation.accept', accept)).value)
    assert.deepEqual((await reader.call<Row>('flow.invitation.accept', accept)).value, accepted)
    assert.equal(
      (await reader.call<Row>('flow.invitation.accept', { token, idempotencyKey: 'accept-again' })).value.ok,
      false,
    )
    assert.equal(
      (
        await reader.call<Row>('flow.invitation.accept', {
          token: revokedToken,
          idempotencyKey: 'revoked-token',
        })
      ).value.ok,
      false,
    )
    assert.deepEqual(
      (await reader.call<Row>('flow.workspace.bootstrap', { route: 'invitation-accept', recordId: token }))
        .value.invitationOffer,
      { available: false },
    )
    const rows = await app.fixture.withTenant('', ({ adapter }) =>
      adapter.all('SELECT state, payload FROM flow_outbox'),
    )
    assert.equal(
      rows.some((row) => JSON.stringify(row.payload).includes(token)),
      false,
      'dispatched tokens are erased from the durable outbox',
    )
    assert.equal(rows.filter((row) => row.state === 'queued').length, 1)
    const guest = app.client.anonymous()
    await guest.login({ login: 'invitation-guest', password: 'synthetic-invitation-password' })
    for (const code of ['GUA', 'GUB']) {
      const project = ok(
        await call('flow.project.save', {
          workspaceId: workspace.id,
          title: code,
          code,
          access: 'private',
          expectedRevision: (await context()).organizationRevision,
          idempotencyKey: 'project-' + code,
        }),
      )
      const invitation = ok(
        await call('flow.member.invite', {
          email: 'guest@example.test',
          role: 'guest',
          projectId: project.id,
          expectedRevision: (await context()).organizationRevision,
          idempotencyKey: 'guest-' + code,
        }),
      )
      const token = await tokenOf(invitation.id)
      ok(
        (await guest.call<Row>('flow.invitation.accept', { token, idempotencyKey: 'guest-accept-' + code }))
          .value,
      )
      const visible = (await guest.call<Row>('flow.workspace.bootstrap', { route: 'projects' })).value
        .projects as Row[]
      assert.equal(
        visible.some((p) => p.id === project.id),
        true,
        'guest invitations add a grant for each distinct project',
      )
    }
    const companyMismatch = await reader.call<Row>('flow.invitation.accept', {
      token: 'a'.repeat(43),
      companyId: 'wrong-company',
      idempotencyKey: 'wrong-company',
    })
    assert.equal((companyMismatch.value.errors as Row[])[0]!.code, 'forbidden')
    // A pending invitation loses authority when its issuer loses active membership.
    const inactive = ok(
      await call('flow.member.invite', {
        email: 'wrong@example.test',
        role: 'member',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'issuer-revoked',
      }),
    )
    const inactiveToken = await tokenOf(inactive.id)
    await app.fixture.withTenant('', ({ adapter }) =>
      adapter.run(
        'UPDATE flow_member SET status = ' + (env ? '$1' : '?') + ' WHERE "userId" = ' + (env ? '$2' : '?'),
        ['revoked', 'invitation-owner'],
      ),
    )
    assert.equal(
      (
        await wrong.call<Row>('flow.invitation.accept', {
          token: inactiveToken,
          idempotencyKey: 'inactive-issuer-accept',
        })
      ).value.ok,
      false,
    )
    assert.deepEqual(
      (
        await wrong.call<Row>('flow.workspace.bootstrap', {
          route: 'invitation-accept',
          recordId: inactiveToken,
        })
      ).value.invitationOffer,
      { available: false },
    )
  } finally {
    await app.close()
    await rm(artifactsDir, { recursive: true, force: true })
  }
})
