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

test('access lists are computed by the server for one target, past the people window', async () => {
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
        sessions: { anonymous: { company: 'access-flow' } },
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
      id: 'access-party',
      kind: 'company',
      name: 'Synthetic access',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'access-flow',
      partnerId: 'access-party',
      currency: 'VND',
    })
    const people = Array.from({ length: 60 }, (_, n) => 'acc-p' + String(n).padStart(2, '0'))
    const everyone = ['acc-owner', ...people, 'acc-guest', 'acc-outsider']
    for (const id of everyone) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id === 'acc-owner' ? 'Owner' : id,
          email: id + '@example.test',
          defaultCompanyId: 'access-flow',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `${id}:access-flow`,
        userId: id,
        companyId: 'access-flow',
      })
    }
    await app.fixture.call('user.saveRole', { id: 'access-role', name: 'Access test role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `access-${key}`,
          roleId: 'access-role',
          fnKey: `flow.${key}`,
        })
    for (const id of everyone)
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'access-role' })
    await app.client.login({ login: 'acc-owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
    let revision = 0
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      if (value.revision !== undefined) revision = Number(value.revision)
      return value
    }
    const internal = ok(
      await call('flow.workspace.create', { title: 'Internal', expectedRevision: 0, idempotencyKey: 'w1' }),
    )
    const open = ok(
      await call('flow.project.save', {
        workspaceId: internal.id,
        title: 'Open',
        code: 'OPN',
        expectedRevision: revision,
        idempotencyKey: 'p1',
      }),
    )
    const closed = ok(
      await call('flow.workspace.create', {
        title: 'Private',
        access: 'restricted',
        expectedRevision: revision,
        idempotencyKey: 'w2',
      }),
    )
    const secret = ok(
      await call('flow.project.save', {
        workspaceId: closed.id,
        title: 'Secret',
        code: 'SEC',
        expectedRevision: revision,
        idempotencyKey: 'p2',
      }),
    )
    // Flow membership for sixty people, one revoked person and a guest, cloned from the owner's row.
    const bind = (n: number) => (pg ? '$' + n : '?')
    await app.fixture.withTenant('', async ({ adapter }) => {
      const [owner] = await adapter.all(`SELECT * FROM flow_member WHERE "userId"=${bind(1)}`, ['acc-owner'])
      const columns = Object.keys(owner!)
      for (const id of [...people, 'acc-guest']) {
        const row: Row = {
          ...owner,
          id: 'member-' + id,
          userId: id,
          role: id === 'acc-guest' ? 'guest' : 'member',
          status: id === 'acc-p59' ? 'revoked' : 'active',
        }
        await adapter.run(
          `INSERT INTO flow_member (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map((_, i) => bind(i + 1)).join(',')})`,
          columns.map((c) => row[c]),
        )
      }
    })
    const team = ok(
      await call('flow.team.save', { title: 'Design', expectedRevision: revision, idempotencyKey: 'team' }),
    )
    for (const id of people.slice(0, 5))
      ok(
        await call('flow.team.member', {
          id: team.id,
          memberId: id,
          expectedRevision: revision,
          idempotencyKey: 'join-' + id,
        }),
      )
    const grant = async (
      key: string,
      scope: string,
      targetId: unknown,
      subjectType: string,
      subjectId: unknown,
      role: string,
    ) =>
      ok(
        await call('flow.access.grant', {
          scope,
          targetId,
          subjectType,
          subjectId,
          role,
          expectedRevision: revision,
          idempotencyKey: key,
        }),
      )
    await grant('g-team', 'workspace', closed.id, 'team', team.id, 'editor')
    await grant('g-p00', 'project', secret.id, 'user', 'acc-p00', 'admin')
    await grant('g-p10', 'project', secret.id, 'user', 'acc-p10', 'viewer')
    await grant('g-guest', 'project', secret.id, 'user', 'acc-guest', 'viewer')

    // Internal Workspace: every active internal person can open the project; the guest cannot.
    const first = await call('flow.access.list', { scope: 'project', targetId: open.id })
    assert.equal(first.total, 60, 'owner and the 59 active members; revoked and guest left out')
    assert.equal(first.without, 1, 'only the guest is active without access')
    assert.equal((first.items as Row[]).length, 50)
    const rest = await call('flow.access.list', { scope: 'project', targetId: open.id, cursor: first.cursor })
    assert.equal((rest.items as Row[]).length, 10)
    assert.equal(rest.cursor, null)
    const listed = [...(first.items as Row[]), ...(rest.items as Row[])]
    assert.equal(new Set(listed.map((m) => m.id)).size, 60, 'every person once')
    assert.ok(!listed.some((m) => m.id === 'acc-p59' || m.id === 'acc-guest'))
    for (let n = 1; n < listed.length; n++)
      assert.ok(String(listed[n - 1]!.name) <= String(listed[n]!.name), 'ordered by name')
    const owner = listed.find((m) => m.id === 'acc-owner')!
    assert.deepEqual(
      ((owner.access as Row).sources as Row[]).map((s) => [s.scope, s.role]),
      [
        ['project', 'admin'],
        ['workspace', 'admin'],
        ['internal', 'editor'],
      ],
    )
    assert.equal((owner.access as Row).role, 'admin')
    assert.equal(
      ((listed.find((m) => m.id === 'acc-p30')!.access as Row).sources as Row[])[0]!.scope,
      'internal',
    )

    // Private Workspace: only grants count, through the project, the Workspace or a Team.
    const secretAccess = await call('flow.access.list', { scope: 'project', targetId: secret.id })
    const byId = new Map((secretAccess.items as Row[]).map((m) => [m.id, m]))
    assert.deepEqual([...byId.keys()].sort(), [
      'acc-guest',
      'acc-owner',
      'acc-p00',
      'acc-p01',
      'acc-p02',
      'acc-p03',
      'acc-p04',
      'acc-p10',
    ])
    assert.equal(secretAccess.total, 8)
    assert.equal(secretAccess.without, 61 - 8)
    const lead = byId.get('acc-p00')!
    assert.equal((lead.access as Row).role, 'admin')
    assert.deepEqual(
      ((lead.access as Row).sources as Row[]).map((s) => [s.scope, s.role, s.teamTitle, s.teamMemberCount]),
      [
        ['project', 'admin', null, null],
        ['workspace', 'editor', 'Design', 5],
      ],
    )
    assert.deepEqual(lead.teams, [{ id: team.id, title: 'Design' }])
    assert.equal((byId.get('acc-p03')!.access as Row).role, 'editor')
    assert.equal((byId.get('acc-guest')!.access as Row).role, 'viewer')
    assert.deepEqual(byId.get('acc-guest')!.teams, [])
    // The assignment read applies the same Core engine: the same people, no more, no fewer.
    const eligible: string[] = []
    for (let cursor: unknown = undefined; ; ) {
      const page = await call('flow.member.options', { projectId: secret.id, limit: 100, cursor })
      eligible.push(...(page.items as Row[]).map((m) => String(m.id)))
      if (!page.cursor) break
      cursor = page.cursor
    }
    assert.deepEqual(eligible.sort(), [...byId.keys()].sort())

    const workspace = await call('flow.access.list', { scope: 'workspace', targetId: closed.id })
    assert.deepEqual(
      (workspace.items as Row[]).map((m) => m.id).sort(),
      ['acc-owner', 'acc-p00', 'acc-p01', 'acc-p02', 'acc-p03', 'acc-p04'],
      'a project grant and a guest grant do not open the Workspace',
    )

    const one = await call('flow.access.list', { scope: 'project', targetId: secret.id, memberId: 'acc-p20' })
    assert.equal(one.total, 1)
    assert.equal((one.items as Row[])[0]!.id, 'acc-p20')
    assert.deepEqual((one.items as Row[])[0]!.access, { role: null, sources: [] })

    const organization = await call('flow.workspace.bootstrap', {
      route: 'project-members',
      projectId: secret.id,
    })
    const page = organization.accessPage as Row
    assert.equal(page.scope, 'project')
    assert.equal(page.targetId, secret.id)
    assert.equal(page.total, 8)
    assert.deepEqual(
      page.loadedIds,
      (secretAccess.items as Row[]).map((m) => m.id),
    )

    // Any committed command moves the collection epoch, so an older cursor restarts.
    await grant('g-late', 'project', open.id, 'user', 'acc-p40', 'admin')
    const stale = await call('flow.access.list', {
      scope: 'project',
      targetId: open.id,
      cursor: first.cursor,
    })
    assert.equal((stale.errors as Row[] | undefined)?.[0]?.code, 'conflict')
    for (const cursor of ['not-a-cursor', Buffer.from(JSON.stringify({ id: 'x' })).toString('base64url')])
      assert.equal(
        ((await call('flow.access.list', { scope: 'project', targetId: open.id, cursor })).fields as Row)
          .cursor,
        'invalid',
      )
    assert.equal(
      ((await call('flow.access.list', { scope: 'project', targetId: open.id, limit: 101 })).fields as Row)
        .limit,
      'invalid',
    )
    assert.equal(
      ((await call('flow.access.list', { scope: 'company', targetId: open.id })).fields as Row).scope,
      'invalid',
    )

    // Readers of the target see the list; people who cannot open it, guests and outsiders do not.
    const reader = app.client.anonymous()
    await reader.login({ login: 'acc-p10', password: 'local-test-password' })
    assert.equal(
      (await reader.call<Row>('flow.access.list', { scope: 'project', targetId: secret.id })).value.total,
      8,
    )
    for (const login of ['acc-p20', 'acc-guest', 'acc-outsider']) {
      const other = app.client.anonymous()
      await other.login({ login, password: 'local-test-password' })
      const refused = (await other.call<Row>('flow.access.list', { scope: 'project', targetId: secret.id }))
        .value
      assert.equal((refused.errors as Row[] | undefined)?.[0]?.code, 'forbidden', login)
    }

    // Previews of an access change use the same engine, list only changed people and page.
    const projectChange = await call('flow.access.preview', {
      change: 'project-access',
      projectId: secret.id,
      access: 'private',
    })
    assert.deepEqual(
      (projectChange.items as Row[]).map((r) => [
        r.id,
        r.change,
        (r.before as Row).role,
        (r.after as Row).role,
      ]),
      ['acc-p01', 'acc-p02', 'acc-p03', 'acc-p04'].map((id) => [id, 'loss', 'editor', null]),
      'only the Team members who reach the project through its Workspace lose it',
    )
    const internalChange = await call('flow.access.preview', {
      change: 'workspace-access',
      workspaceId: internal.id,
      access: 'restricted',
    })
    assert.equal(
      internalChange.total,
      58,
      'all but the owner and the person with a project grant lose the open project',
    )
    assert.equal((internalChange.counts as Row).loss, 58)
    assert.equal((internalChange.items as Row[]).length, 50)
    assert.ok((internalChange.items as Row[]).every((r) => r.projectId === open.id && r.change === 'loss'))
    const internalRest = await call('flow.access.preview', {
      change: 'workspace-access',
      workspaceId: internal.id,
      access: 'restricted',
      cursor: internalChange.cursor,
    })
    assert.equal((internalRest.items as Row[]).length, 8)
    assert.equal(internalRest.cursor, null)
    assert.equal(
      new Set([...(internalChange.items as Row[]), ...(internalRest.items as Row[])].map((r) => r.id)).size,
      58,
    )
    assert.equal(
      (
        (
          await call('flow.access.preview', {
            change: 'project-access',
            projectId: secret.id,
            access: 'internal',
          })
        ).fields as Row
      ).access,
      'invalid',
    )
    assert.equal(
      ((await call('flow.access.preview', { change: 'everything', access: 'private' })).fields as Row).change,
      'invalid',
    )
    const viewer = (
      await reader.call<Row>('flow.access.preview', {
        change: 'project-access',
        projectId: secret.id,
        access: 'private',
      })
    ).value
    assert.equal(
      (viewer.errors as Row[] | undefined)?.[0]?.code,
      'forbidden',
      'a viewer cannot preview access changes',
    )

    // Moving to a Workspace without grants: editor access through the old Workspace is a loss,
    // and keeping access must keep exactly that role.
    const empty = ok(
      await call('flow.workspace.create', {
        title: 'Empty',
        access: 'restricted',
        expectedRevision: revision,
        idempotencyKey: 'w3',
      }),
    )
    const move = await call('flow.project.move.preview', {
      projectId: secret.id,
      targetWorkspaceId: empty.id,
      preserve: false,
    })
    const moved = new Map((move.people as Row[]).map((r) => [r.id, r]))
    assert.equal((move.people as Row[])[0]!.change, 'loss', 'losses come first')
    for (const id of ['acc-p01', 'acc-p02', 'acc-p03', 'acc-p04']) {
      assert.equal((moved.get(id)!.before as Row).role, 'editor', id + ' had editor access before the move')
      assert.equal(moved.get(id)!.change, 'loss')
    }
    assert.equal(moved.get('acc-p10')!.change, 'same', 'a project grant moves with the project')
    assert.equal((move.summary as Row).loss, 4)
    assert.equal(move.total, (move.people as Row[]).length)
    const kept = await call('flow.project.move.preview', {
      projectId: secret.id,
      targetWorkspaceId: empty.id,
      preserve: true,
    })
    const keptLead = (kept.people as Row[]).find((r) => r.id === 'acc-p01')!
    assert.equal(keptLead.change, 'same')
    assert.equal((keptLead.after as Row).role, 'editor')
    assert.ok(((keptLead.after as Row).sources as Row[]).some((x) => x.retained === true))
    assert.equal((kept.summary as Row).loss, 0)
    const project = (await call('flow.workspace.bootstrap', { route: 'board', projectId: secret.id }))
      .projects as Row[]
    ok(
      await call('flow.project.move', {
        id: secret.id,
        projectId: secret.id,
        targetWorkspaceId: empty.id,
        preserve: true,
        expectedVersion: project.find((x) => x.id === secret.id)!.version,
        expectedRevision: kept.revision,
        idempotencyKey: 'move-secret',
      }),
    )
    const after = await call('flow.access.list', { scope: 'project', targetId: secret.id })
    const afterById = new Map((after.items as Row[]).map((m) => [m.id, m]))
    for (const id of ['acc-p01', 'acc-p02', 'acc-p03', 'acc-p04'])
      assert.equal(
        (afterById.get(id)?.access as Row | undefined)?.role,
        'editor',
        id + ' keeps editor access after the move',
      )
    assert.equal(after.total, 8)
  } finally {
    await app.close()
  }
})
