import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { TestClient, TestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'
import { everyFunction } from './helpers/permissions.ts'

/** A native, empty Company for the manual onboarding check; never a production route. */
async function reviewOrganization(app: TestDeployment, client: TestClient) {
  const proxy = createServer(async (req, res) => {
    try {
      const body: Buffer[] = []
      for await (const chunk of req) body.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers))
        if (value && !['host', 'connection', 'content-length', 'cookie'].includes(name))
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      headers.set('cookie', client.jar.header())
      if (headers.has('origin')) headers.set('origin', new URL(app.baseUrl).origin)
      const response = await fetch(new URL(req.url ?? '/', app.baseUrl), {
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
      res.end('Synthetic onboarding evidence failed')
    }
  })
  await new Promise<void>((resolve) => proxy.listen(3695, '127.0.0.1', resolve))
  console.log(
    JSON.stringify({
      evidence: 'http://127.0.0.1:3695/flow/my-work?lang=vi',
      state: 'empty-company',
      actor: 'root-first',
      mode: 'manual-onboarding',
    }),
  )
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', () => resolve())
    process.once('SIGINT', () => resolve())
  })
  await new Promise<void>((resolve) => proxy.close(() => resolve()))
}

// C02 / FLW-DEC-030: the Company is the organization. An empty tenant needs no seed:
// the first person allowed to initialize Flow creates the first workspace and becomes
// its only owner, with default catalogs. Racing, replaying or arriving later never
// makes a second owner; everyone else joins by invitation.
test('an empty company gets exactly one Flow owner, once, without seed data', async () => {
  const native = createFlowModule()
  const concurrentTransactions = new Set<unknown>()
  const bothTransactionsStarted = Promise.withResolvers<void>()
  if (process.env.FLOW_TEST_DATABASE_URL) {
    const create = native.functions['workspace.create']!
    native.functions['workspace.create'] = {
      ...create,
      handler: (ctx, args) => {
        if (
          !['root-first', 'root-rival'].includes(String(args.idempotencyKey)) ||
          concurrentTransactions.size >= 2
        )
          return create.handler(ctx, args)
        return create.handler(
          {
            ...ctx,
            tx: (work) =>
              ctx.tx(async (transaction) => {
                concurrentTransactions.add(transaction.db)
                if (concurrentTransactions.size === 2) bothTransactionsStarted.resolve()
                let timer: ReturnType<typeof setTimeout> | undefined
                try {
                  // ctx.tx has opened the PostgreSQL transaction before invoking
                  // this callback. Neither initializer may acquire Flow's lock
                  // until both real transactions are simultaneously in flight.
                  await Promise.race([
                    bothTransactionsStarted.promise,
                    new Promise<never>((_, reject) => {
                      timer = setTimeout(() => reject(new Error('initializers did not overlap')), 10_000)
                    }),
                  ])
                  return await work(transaction)
                } finally {
                  clearTimeout(timer)
                }
              }),
          },
          args,
        )
      },
    }
  }
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
        sessions: { anonymous: { company: 'root-flow' } },
        openStore: async (config) => {
          if (!config.databaseUrl) return sqliteStore(config)
          const adapter = postgresAdapter(config.databaseUrl, { max: 4 })
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
    await app.fixture.call('partner.savePartner', { id: 'root-party', kind: 'company', name: 'Synthetic' })
    await app.fixture.call('company.saveCompany', {
      id: 'root-flow',
      partnerId: 'root-party',
      currency: 'VND',
    })
    // `initializer` may start Flow for the company; `operator` holds every other Flow function.
    for (const [role, initialize] of [
      ['initializer', true],
      ['operator', false],
    ] as const) {
      await app.fixture.call('user.saveRole', { id: role, name: role })
      for (const key of Object.keys(native.functions))
        if (native.functions[key]!.exposure !== 'internal' && (initialize || key !== 'workspace.initialize'))
          await app.fixture.call('user.grantFunction', {
            id: `${role}-${key}`,
            roleId: role,
            fnKey: `flow.${key}`,
          })
    }
    const people = { first: 'initializer', rival: 'initializer', late: 'initializer', operator: 'operator' }
    const clients = {} as Record<keyof typeof people, typeof app.client>
    for (const [id, role] of Object.entries(people) as [keyof typeof people, string][]) {
      await app.fixture.call(
        'user.createUser',
        {
          id: `root-${id}`,
          login: `root-${id}`,
          password: 'local-test-password',
          name: id,
          email: `root-${id}@example.test`,
          defaultCompanyId: 'root-flow',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `root-${id}:root-flow`,
        userId: `root-${id}`,
        companyId: 'root-flow',
      })
      await app.fixture.call('user.assignRole', {
        id: `root-${id}:${role}`,
        userId: `root-${id}`,
        roleId: role,
      })
      clients[id] = app.client.anonymous()
      await clients[id].login({ login: `root-${id}`, password: 'local-test-password' })
    }
    const call = async (who: keyof typeof people, name: string, input: Row = {}) =>
      (await clients[who].call<Row>(name, input)).value
    const refusal = (value: Row) => (value.errors as Row[] | undefined)?.[0]?.code

    if (process.env.FLOW_ORGANIZATION_REVIEW === '1') {
      await reviewOrganization(app, clients.first)
      const initialized = await call('first', 'flow.workspace.bootstrap')
      assert.equal((initialized.workspaces as Row[]).length, 1, 'the browser created one Workspace')
      assert.deepEqual(
        (initialized.members as Row[]).map((member) => [member.id, member.role]),
        [['root-first', 'owner']],
        'the browser initializer became the only owner',
      )
      assert.equal((initialized.projects as Row[]).length, 1, 'the browser created the first project')
      assert.equal((initialized.projects as Row[])[0]!.code, 'C02', 'the manual project code was saved')
      return // Standard mode below separately exercises races, replay and late arrivals.
    }

    // Empty tenant: nothing seeded, nobody is a member; only an initializer is offered setup.
    const empty = await call('first', 'flow.workspace.bootstrap')
    assert.deepEqual(empty.workspaces, [])
    assert.deepEqual(empty.members, [])
    assert.equal(empty.organizationRevision, 0)
    assert.equal(
      (empty.capabilities as Row).manageOrganization,
      true,
      'the initializer is offered onboarding',
    )
    assert.equal(
      ((await call('operator', 'flow.workspace.bootstrap')).capabilities as Row).manageOrganization,
      false,
      'platform access to Flow alone does not make an organizer',
    )
    assert.equal(
      refusal(
        await call('operator', 'flow.workspace.create', {
          title: 'Shadow',
          expectedRevision: 0,
          idempotencyKey: 'op',
        }),
      ),
      'forbidden',
    )

    // Two initializers race on the empty company: exactly one becomes owner.
    const input = (title: string, key: string) => ({ title, expectedRevision: 0, idempotencyKey: key })
    const [a, b] = await Promise.all([
      call('first', 'flow.workspace.create', input('Head office', 'root-first')),
      call('rival', 'flow.workspace.create', input('Rival office', 'root-rival')),
    ])
    if (process.env.FLOW_TEST_DATABASE_URL)
      assert.equal(concurrentTransactions.size, 2, 'both PostgreSQL transactions reached the barrier')
    const winners = [a, b].filter((x) => x.ok === true)
    assert.equal(winners.length, 1, JSON.stringify([a, b]))
    const loser = a.ok === true ? b : a
    assert.ok(['conflict', 'forbidden'].includes(String(refusal(loser))), JSON.stringify(loser))
    const owner = a.ok === true ? 'first' : 'rival'
    const other = owner === 'first' ? 'rival' : 'first'
    const ownerKey =
      owner === 'first' ? input('Head office', 'root-first') : input('Rival office', 'root-rival')

    // A replay answers the same result and creates nothing more.
    assert.deepEqual(await call(owner, 'flow.workspace.create', ownerKey), winners[0])
    const root = await call(owner, 'flow.workspace.bootstrap')
    assert.equal((root.workspaces as Row[]).length, 1)
    const members = root.members as Row[]
    assert.deepEqual(
      members.map((m) => [m.id, m.role]),
      [[`root-${owner}`, 'owner']],
    )
    assert.equal(root.organizationRevision, 1)
    // The organization is usable at once: default statuses and types exist without fixtures.
    for (const [kind, expected] of [
      ['column', 4],
      ['type', 4],
    ] as const) {
      const listed = await call(owner, 'flow.catalog.list', { kind, limit: 20 })
      assert.equal(listed.total, expected, kind)
    }

    // Arriving later, even with the newest revision, is not a way in.
    for (const who of [other, 'late'] as const) {
      const late = await call(who, 'flow.workspace.create', {
        title: 'Second root',
        expectedRevision: root.organizationRevision,
        idempotencyKey: `late-${who}`,
      })
      assert.equal(refusal(late), 'forbidden', who)
      assert.equal(
        ((await call(who, 'flow.workspace.bootstrap')).capabilities as Row).manageOrganization,
        false,
      )
    }
    const after = await call(owner, 'flow.workspace.bootstrap')
    assert.equal((after.members as Row[]).length, 1)
    assert.equal((after.workspaces as Row[]).length, 1)
    assert.equal(after.organizationRevision, 1)
  } finally {
    await app.close()
  }
})
