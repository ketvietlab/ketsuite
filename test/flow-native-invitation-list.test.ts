import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { everyFunction } from './helpers/permissions.ts'

test('organization managers page pending invitations newest first, past the first window', async () => {
  const native = createFlowModule()
  const app = await createTestDeployment(
    defineDeployment({
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
        native,
      ],
      serve: {
        permissions: everyFunction,
        sessions: { anonymous: { company: 'invite-flow' } },
        openStore: async (config) => {
          if (!config.databaseUrl) return sqliteStore(config)
          const adapter = postgresAdapter(config.databaseUrl, { max: 2 })
          await adapter.open()
          return adapter
        },
      },
    }),
    {
      worker: false,
      ...(process.env.FLOW_TEST_DATABASE_URL
        ? { env: { DATABASE_URL: process.env.FLOW_TEST_DATABASE_URL } }
        : {}),
    },
  )
  const pg = Boolean(process.env.FLOW_TEST_DATABASE_URL)
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'invite-party',
      kind: 'company',
      name: 'Synthetic invitations',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'invite-flow',
      partnerId: 'invite-party',
      currency: 'VND',
    })
    for (const id of ['invite-owner', 'invite-outsider']) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id,
          email: id + '@example.test',
          defaultCompanyId: 'invite-flow',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `${id}:invite-flow`,
        userId: id,
        companyId: 'invite-flow',
      })
    }
    await app.fixture.call('user.saveRole', { id: 'invite-role', name: 'Invitation test role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `invite-${key}`,
          roleId: 'invite-role',
          fnKey: `flow.${key}`,
        })
    for (const id of ['invite-owner', 'invite-outsider'])
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'invite-role' })
    await app.client.login({ login: 'invite-owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      return value
    }
    let revision = Number(
      ok(await call('flow.workspace.create', { title: 'People', expectedRevision: 0, idempotencyKey: 'ws' }))
        .revision,
    )
    const ids: string[] = []
    for (let n = 0; n < 56; n++) {
      const invited = ok(
        await call('flow.member.invite', {
          email: `person-${String(n).padStart(2, '0')}@example.test`,
          role: 'member',
          expectedRevision: revision,
          idempotencyKey: 'invite-' + n,
        }),
      )
      revision = Number(invited.revision)
      ids.push(String(invited.id))
    }
    // Close three of the oldest invitations in each way the list must leave out.
    const bind = (n: number) => (pg ? '$' + n : '?')
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(`UPDATE flow_invitation SET "consumedAt"=${bind(1)} WHERE id=${bind(2)}`, [
        new Date().toISOString(),
        ids[0],
      ])
      await adapter.run(`UPDATE flow_invitation SET "expiresAt"=${bind(1)} WHERE id=${bind(2)}`, [
        '2000-01-01T00:00:00.000Z',
        ids[1],
      ])
    })
    revision = Number(
      ok(
        await call('flow.invitation.revoke', {
          id: ids[2],
          expectedVersion: 1,
          expectedRevision: revision,
          idempotencyKey: 'revoke',
        }),
      ).revision,
    )
    const pending = ids.slice(3)

    const first = await call('flow.invitation.list', {})
    assert.equal(first.total, pending.length)
    assert.equal((first.items as Row[]).length, 50)
    assert.ok(first.cursor)
    const next = await call('flow.invitation.list', { cursor: first.cursor })
    assert.equal(next.cursor, null)
    const seen = [...(first.items as Row[]), ...(next.items as Row[])]
    assert.deepEqual(
      seen.map((i) => i.id).sort(),
      [...pending].sort(),
      'every pending invitation once; accepted, expired and revoked ones left out',
    )
    assert.equal(seen[0]!.id, ids.at(-1), 'the newest invitation comes first')
    for (let n = 1; n < seen.length; n++)
      assert.ok(String(seen[n - 1]!.createdAt) >= String(seen[n]!.createdAt), 'newest first')
    assert.ok(seen.every((i) => i.status === 'pending' && !('digest' in i)))

    const organization = await call('flow.workspace.bootstrap', { route: 'organization-members' })
    assert.equal((organization.invitations as Row[]).length, 50)
    assert.equal((organization.invitations as Row[])[0]!.id, ids.at(-1))
    assert.deepEqual((organization.invitationPage as Row).total, pending.length)
    assert.equal((organization.invitationPage as Row).cursor, first.cursor)

    // Any committed command moves the collection epoch, so an older cursor restarts.
    ok(
      await call('flow.member.invite', {
        email: 'late@example.test',
        role: 'member',
        expectedRevision: revision,
        idempotencyKey: 'late',
      }),
    )
    const stale = await call('flow.invitation.list', { cursor: first.cursor })
    assert.equal(
      (stale.errors as Row[] | undefined)?.[0]?.code,
      'conflict',
      'a cursor from before a committed command is refused',
    )
    for (const cursor of [
      'not-a-cursor',
      Buffer.from(JSON.stringify({ id: 'x', time: 'yesterday' })).toString('base64url'),
    ])
      assert.equal(((await call('flow.invitation.list', { cursor })).fields as Row).cursor, 'invalid')
    assert.equal(((await call('flow.invitation.list', { limit: 101 })).fields as Row).limit, 'invalid')

    const outsider = app.client.anonymous()
    await outsider.login({ login: 'invite-outsider', password: 'local-test-password' })
    const refused = (await outsider.call<Row>('flow.invitation.list', {})).value
    assert.equal(
      (refused.errors as Row[] | undefined)?.[0]?.code,
      'forbidden',
      'only organization managers read invitations',
    )
  } finally {
    await app.close()
  }
})
