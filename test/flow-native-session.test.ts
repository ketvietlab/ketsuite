import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { defineDeployment, memorySessionStore, sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { TestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'
import { everyFunction } from './helpers/permissions.ts'

/** Local evidence only: SSR has a real test session, then bootstrap/probe lose it.
 * This models expiry between the document response and the first client read.
 * No credential is printed, and no production entry imports test files. */
async function reviewExpiredSession(app: TestDeployment, workspaceId: string) {
  const proxy = createServer(async (req, res) => {
    try {
      const body: Buffer[] = []
      for await (const chunk of req) body.push(Buffer.from(chunk))
      const target = new URL(req.url ?? '/', app.baseUrl)
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers))
        if (value && !['host', 'connection', 'content-length', 'cookie'].includes(name))
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      if (!['/_ket/fn/flow.workspace.bootstrap', '/flow/session', '/login'].includes(target.pathname))
        headers.set('cookie', app.client.jar.header())
      if (headers.has('origin')) headers.set('origin', new URL(app.baseUrl).origin)
      const response = await fetch(target, {
        method: req.method,
        headers,
        redirect: 'manual',
        ...(body.length ? { body: Buffer.concat(body) } : {}),
      })
      res.statusCode = response.status
      response.headers.forEach((value, name) => {
        if (
          !['content-length', 'content-encoding', 'connection', 'transfer-encoding', 'set-cookie'].includes(
            name,
          )
        )
          res.setHeader(name, value)
      })
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      res.writeHead(502)
      res.end('Synthetic session evidence failed')
    }
  })
  await new Promise<void>((resolve) => proxy.listen(3694, '127.0.0.1', resolve))
  console.log(
    JSON.stringify({
      evidence: 'http://127.0.0.1:3694',
      workspaceId,
      state: 'session-ended',
      expectedRequests: ['bootstrap:403', 'session:401'],
    }),
  )
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', () => resolve())
    process.once('SIGINT', () => resolve())
  })
  await new Promise<void>((resolve) => proxy.close(() => resolve()))
}

// C01: Flow has no sign-in of its own. The deployment session is the only identity:
// without it Flow answers nothing, and logout, deactivation or losing the company
// take effect on the very next Flow call, with no fixture actor to fall back on.
test('Flow trusts only the deployment session and honours logout and revocation at once', async () => {
  const native = createFlowModule()
  let sessionClock = Date.now()
  const idleTtlMs = 60_000
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
        createFlowWorkspaceModule(),
      ],
      serve: {
        permissions: everyFunction,
        // The productivity deployment lets anonymous requests resolve a company, as here.
        sessions: {
          anonymous: { company: 'session-flow' },
          store: memorySessionStore({ now: () => sessionClock }),
          now: () => sessionClock,
          idleTtlMs,
        },
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
  try {
    await app.fixture.call('partner.savePartner', { id: 'session-party', kind: 'company', name: 'Synthetic' })
    await app.fixture.call('company.saveCompany', {
      id: 'session-flow',
      partnerId: 'session-party',
      currency: 'VND',
    })
    const role = await app.fixture.call('user.saveRole', { id: 'session-role', name: 'Session role' })
    assert.ok(role)
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `session-${key}`,
          roleId: 'session-role',
          fnKey: `flow.${key}`,
        })
    for (const id of ['ss-owner', 'ss-member', 'ss-leaver'])
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id,
          email: `${id}@example.test`,
          defaultCompanyId: 'session-flow',
        },
        { actor: null },
      )
    for (const id of ['ss-owner', 'ss-member', 'ss-leaver']) {
      await app.fixture.call('user.grantCompany', {
        id: `${id}:session-flow`,
        userId: id,
        companyId: 'session-flow',
      })
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'session-role' })
    }

    const raw = async (client: typeof app.client, name: string, input: Row = {}) => {
      const response = await client.request(`/_ket/fn/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      return { status: response.status, body: await response.text() }
    }
    const owner = app.client
    await owner.login({ login: 'ss-owner', password: 'local-test-password' })
    const workspace = await owner.call<Row>('flow.workspace.create', {
      title: 'Secret plans',
      expectedRevision: 0,
      idempotencyKey: 'ws',
    })
    assert.equal(workspace.value.ok, true, JSON.stringify(workspace.value))
    const member = app.client.anonymous()
    await member.login({ login: 'ss-member', password: 'local-test-password' })
    const leaver = app.client.anonymous()
    await leaver.login({ login: 'ss-leaver', password: 'local-test-password' })
    // SQLite and PostgreSQL spell a bound parameter differently.
    const bind = process.env.FLOW_TEST_DATABASE_URL ? '$1' : '?'
    // Both join the organization the ordinary way, so they read what a member reads.
    for (const [client, login] of [
      [member, 'ss-member'],
      [leaver, 'ss-leaver'],
    ] as const) {
      const revision = (await owner.call<Row>('flow.workspace.bootstrap', {})).value.organizationRevision
      const invitation = (
        await owner.call<Row>('flow.member.invite', {
          email: `${login}@example.test`,
          role: 'member',
          expectedRevision: revision,
          idempotencyKey: `invite-${login}`,
        })
      ).value
      assert.equal(invitation.ok, true, JSON.stringify(invitation))
      const token = await app.fixture.withTenant('', async ({ adapter }) => {
        const rows = await adapter.all(`SELECT payload FROM flow_outbox WHERE "targetId" = ${bind}`, [
          String(invitation.id),
        ])
        const payload = rows[0]!.payload
        return (typeof payload === 'string' ? JSON.parse(payload) : (payload as Row)).token
      })
      const accepted = (
        await client.call<Row>('flow.invitation.accept', { token, idempotencyKey: `accept-${login}` })
      ).value
      assert.equal(accepted.ok, true, JSON.stringify(accepted))
    }
    const session = async (client: typeof app.client) =>
      (await client.request('/flow/session', { headers: { accept: 'application/json' } })).status
    const secret = /Secret plans/

    // Signed in: the probe and the read both answer, the read with the company's data.
    assert.equal(await session(owner), 200)
    const read = await raw(owner, 'flow.workspace.bootstrap')
    assert.equal(read.status, 200)
    assert.match(read.body, secret)
    // Flow has no sign-in page of its own, even for someone already signed in.
    const own = await owner.request('/flow/sign-in', { headers: { accept: 'text/html' }, redirect: 'manual' })
    assert.equal(own.status, 303)
    assert.equal(own.headers.get('location'), '/login')

    if (process.env.FLOW_SESSION_REVIEW === '1') await reviewExpiredSession(app, String(workspace.value.id))

    // Nobody signed in: reads, writes and an Atlas fixture header are all refused without data,
    // and the probe tells the client that this refusal is a missing session.
    const anonymous = app.client.anonymous()
    for (const [name, input] of [
      ['flow.workspace.bootstrap', {}],
      ['flow.workspace.create', { title: 'Intruder', expectedRevision: 1, idempotencyKey: 'anon' }],
    ] as const) {
      const refused = await raw(anonymous, name, input)
      assert.equal(refused.status, 403, name)
      assert.doesNotMatch(refused.body, secret)
    }
    const fixture = await anonymous.request('/_ket/fn/flow.workspace.bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-flow-fixture': 'blank' },
      body: '{}',
    })
    assert.equal(fixture.status, 403, 'an Atlas fixture session means nothing to the deployment')
    assert.equal(await session(anonymous), 401)
    // A page asks the deployment login to bring the person back to the same screen.
    const page = await anonymous.request('/flow/project-issues?project=p&status=open', {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    })
    assert.equal(page.status, 303)
    assert.equal(
      page.headers.get('location'),
      '/login?next=%2Fflow%2Fproject-issues%3Fproject%3Dp%26status%3Dopen',
    )
    const login = await anonymous.request('/flow/sign-in', {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    })
    assert.equal(login.status, 303)
    assert.match(login.headers.get('location') ?? '', /^\/login\?next=/)

    // Deactivation and removal from the organization take effect without signing out.
    assert.match(
      (await raw(member, 'flow.workspace.bootstrap')).body,
      secret,
      'a member reads the workspace first',
    )
    await app.fixture.call('user.archiveUser', { id: 'ss-member', active: false })
    const archived = await raw(member, 'flow.workspace.bootstrap')
    assert.doesNotMatch(archived.body, secret)
    assert.match(archived.body, /"forbidden"|E_FN_NOT_PERMITTED/)

    assert.match(
      (await raw(leaver, 'flow.workspace.bootstrap')).body,
      secret,
      'a member reads the workspace first',
    )
    // The platform keeps a person's default company; Flow membership is what the owner revokes.
    const kept = (await app.fixture.call('user.revokeCompany', {
      userId: 'ss-leaver',
      companyId: 'session-flow',
    })) as Row
    assert.equal((kept.value as Row).ok, false, JSON.stringify(kept))
    const context = (await owner.call<Row>('flow.workspace.bootstrap', {})).value
    const leaving = (context.members as Row[]).find((m) => m.id === 'ss-leaver')!
    const removed = (
      await owner.call<Row>('flow.member.update', {
        id: leaving.id,
        role: 'member',
        revoke: true,
        expectedVersion: leaving.version,
        expectedRevision: context.organizationRevision,
        idempotencyKey: 'revoke-leaver',
      })
    ).value
    assert.equal(removed.ok, true, JSON.stringify(removed))
    assert.equal(await session(leaver), 200, 'the deployment session itself is still valid')
    const revoked = await raw(leaver, 'flow.workspace.bootstrap')
    assert.doesNotMatch(revoked.body, secret)
    assert.match(revoked.body, /"forbidden"/)
    const write = await raw(leaver, 'flow.workspace.create', {
      title: 'Late',
      expectedRevision: context.organizationRevision,
      idempotencyKey: 'late',
    })
    assert.match(write.body, /"forbidden"/)

    // Logout ends Flow on the very next call.
    await owner.logout()
    assert.equal(await session(owner), 401)
    const after = await raw(owner, 'flow.workspace.bootstrap')
    assert.equal(after.status, 403)
    assert.doesNotMatch(after.body, secret)

    // Exercise the deployment session TTL itself, with its signed cookie intact.
    // The browser evidence proxy above only demonstrates the expired-session UI.
    const expiring = app.client.anonymous()
    await expiring.login({ login: 'ss-owner', password: 'local-test-password' })
    assert.equal(await session(expiring), 200)
    assert.match((await raw(expiring, 'flow.workspace.bootstrap')).body, secret)
    sessionClock += idleTtlMs + 1
    assert.equal(await session(expiring), 401, 'a signed cookie cannot outlive the session TTL')
    const expired = await raw(expiring, 'flow.workspace.bootstrap')
    assert.equal(expired.status, 403)
    assert.doesNotMatch(expired.body, secret)
  } finally {
    await app.close()
  }
})
