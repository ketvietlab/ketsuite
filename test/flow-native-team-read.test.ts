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
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'
import { reviewFlow } from './helpers/flow-review.ts'
import { everyFunction } from './helpers/permissions.ts'

test('Teams, their people and a new project reach are read by the server, never from shipped membership', async () => {
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
        createFlowWorkspaceModule(),
      ],
      serve: {
        permissions: everyFunction,
        sessions: { anonymous: { company: 'team-flow' } },
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
      id: 'team-party',
      kind: 'company',
      name: 'Synthetic teams',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'team-flow',
      partnerId: 'team-party',
      currency: 'VND',
    })
    const people = ['tm-a', 'tm-b', 'tm-c', 'tm-d', 'tm-guest', 'tm-revoked']
    for (const id of ['tm-owner', ...people]) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id,
          email: id + '@example.test',
          defaultCompanyId: 'team-flow',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `${id}:team-flow`,
        userId: id,
        companyId: 'team-flow',
      })
    }
    await app.fixture.call('user.saveRole', { id: 'team-role', name: 'Team test role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `team-${key}`,
          roleId: 'team-role',
          fnKey: `flow.${key}`,
        })
    for (const id of ['tm-owner', ...people])
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'team-role' })
    await app.client.login({ login: 'tm-owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
    let revision = 0
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      if (value.revision !== undefined) revision = Number(value.revision)
      return value
    }
    const code = (value: Row) => (value.errors as Row[] | undefined)?.[0]?.code
    const open = ok(
      await call('flow.workspace.create', { title: 'Open', expectedRevision: 0, idempotencyKey: 'w1' }),
    )
    const shared = ok(
      await call('flow.project.save', {
        workspaceId: open.id,
        title: 'Shared',
        code: 'SHR',
        expectedRevision: revision,
        idempotencyKey: 'p1',
      }),
    )
    const closed = ok(
      await call('flow.workspace.create', {
        title: 'Closed',
        access: 'restricted',
        expectedRevision: revision,
        idempotencyKey: 'w2',
      }),
    )
    // Flow membership cloned from the owner's row: four members, a guest and a revoked person.
    const bind = (n: number) => (pg ? '$' + n : '?')
    await app.fixture.withTenant('', async ({ adapter }) => {
      const [owner] = await adapter.all(`SELECT * FROM flow_member WHERE "userId"=${bind(1)}`, ['tm-owner'])
      const columns = Object.keys(owner!)
      for (const id of people) {
        const row: Row = {
          ...owner,
          id: 'member-' + id,
          userId: id,
          role: id === 'tm-guest' ? 'guest' : 'member',
          status: 'active',
        }
        await adapter.run(
          `INSERT INTO flow_member (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map((_, i) => bind(i + 1)).join(',')})`,
          columns.map((c) => row[c]),
        )
      }
    })
    const team = async (title: string) =>
      ok(await call('flow.team.save', { title, expectedRevision: revision, idempotencyKey: 'team-' + title }))
    const alpha = await team('Alpha'),
      beta = await team('Beta'),
      gamma = await team('Gamma'),
      gone = await team('Archived')
    const join = async (teamId: unknown, memberId: string) =>
      ok(
        await call('flow.team.member', {
          id: teamId,
          memberId,
          expectedRevision: revision,
          idempotencyKey: `join-${String(teamId)}-${memberId}`,
        }),
      )
    for (const id of ['tm-a', 'tm-b', 'tm-revoked']) await join(alpha.id, id)
    await join(beta.id, 'tm-c')
    await join(gone.id, 'tm-c')
    const grant = async (key: string, scope: string, targetId: unknown, teamId: unknown, role: string) =>
      ok(
        await call('flow.access.grant', {
          scope,
          targetId,
          subjectType: 'team',
          subjectId: teamId,
          role,
          expectedRevision: revision,
          idempotencyKey: key,
        }),
      )
    await grant('g-alpha-closed', 'workspace', closed.id, alpha.id, 'editor')
    await grant('g-alpha-shared', 'project', shared.id, alpha.id, 'viewer')
    await grant('g-beta-shared', 'project', shared.id, beta.id, 'viewer')
    // Revoked after joining, and one Team archived, both outside the commands this test reads.
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(`UPDATE flow_member SET status='revoked' WHERE "userId"=${bind(1)}`, ['tm-revoked'])
      await adapter.run(`UPDATE flow_team SET archived=${pg ? 'true' : '1'} WHERE id=${bind(1)}`, [gone.id])
    })

    // The directory: active Teams by title, with their sizes, paged by a fenced keyset cursor.
    const directory = await call('flow.team.list', {})
    assert.deepEqual(
      (directory.items as Row[]).map((t) => [t.title, t.memberCount, t.grantCount, t.archived]),
      [
        ['Alpha', 3, 2, false],
        ['Beta', 1, 1, false],
        ['Gamma', 0, 0, false],
      ],
      'the archived Team is not listed',
    )
    assert.equal(directory.total, 3)
    assert.ok(!(directory.items as Row[]).some((t) => 'memberIds' in t), 'membership is never shipped')
    const first = await call('flow.team.list', { limit: 2 })
    assert.deepEqual(
      (first.items as Row[]).map((t) => t.title),
      ['Alpha', 'Beta'],
    )
    const rest = await call('flow.team.list', { limit: 2, cursor: first.cursor })
    assert.deepEqual(
      (rest.items as Row[]).map((t) => t.id),
      [gamma.id],
    )
    assert.equal(rest.cursor, null)
    assert.deepEqual(
      ((await call('flow.team.list', { query: 'alp' })).items as Row[]).map((t) => t.id),
      [alpha.id],
    )
    for (const cursor of ['not-a-cursor', Buffer.from(JSON.stringify({ id: 'x' })).toString('base64url')])
      assert.equal(((await call('flow.team.list', { cursor })).fields as Row).cursor, 'invalid')

    // One Team: its size and the scopes it is granted, by target title.
    const read = await call('flow.team.read', { id: alpha.id })
    assert.equal((read.team as Row).memberCount, 3)
    assert.deepEqual(
      (read.grants as Row[]).map((g) => [g.targetTitle, g.scope, g.role]),
      [
        ['Closed', 'workspace', 'editor'],
        ['Shared', 'project', 'viewer'],
      ],
    )
    assert.equal(code(await call('flow.team.read', { id: gone.id })), 'not_found')

    // A Team's people, and the internal people who could still join it.
    const members = await call('flow.member.list', { teamId: alpha.id })
    assert.deepEqual(
      (members.items as Row[]).map((m) => m.id),
      ['tm-a', 'tm-b', 'tm-revoked'],
    )
    assert.ok((members.items as Row[]).every((m) => (m.teamIds as string[]).includes(String(alpha.id))))
    const candidates = await call('flow.member.list', { candidateForTeamId: alpha.id })
    assert.deepEqual(
      (candidates.items as Row[]).map((m) => m.id),
      ['tm-c', 'tm-d', 'tm-owner'],
      'guests, revoked people and members are not candidates',
    )
    const c = (candidates.items as Row[]).find((m) => m.id === 'tm-c')!
    assert.deepEqual(c.teamIds, [beta.id], 'an archived Team is not among a person’s Teams')
    assert.equal(code(await call('flow.member.list', { teamId: gone.id })), 'not_found')
    const pageOne = await call('flow.member.list', { teamId: alpha.id, limit: 2 })
    assert.equal(pageOne.total, 3)
    assert.equal(
      (
        (await call('flow.member.list', { candidateForTeamId: alpha.id, cursor: pageOne.cursor }))
          .errors as Row[]
      )[0]!.code,
      'conflict',
      'a cursor is fenced to its filter',
    )

    // The bootstrap ships the directory page and each person's Team ids, never membership.
    const boot = await call('flow.workspace.bootstrap', { route: 'teams' })
    assert.deepEqual(
      (boot.teams as Row[]).map((t) => t.title),
      ['Alpha', 'Beta', 'Gamma'],
    )
    assert.ok(!(boot.teams as Row[]).some((t) => 'memberIds' in t))
    assert.deepEqual(boot.teamPage, {
      total: 3,
      cursor: null,
      loadedIds: [alpha.id, beta.id, gamma.id],
    })
    assert.deepEqual((boot.user as Row).teamIds, [])
    assert.deepEqual((boot.members as Row[]).find((m) => m.id === 'tm-a')!.teamIds, [alpha.id])

    // A new project's reach is previewed with the grants creation writes, plus its Workspace.
    const reach = await call('flow.access.preview', {
      change: 'project-create',
      workspaceId: closed.id,
      access: 'private',
      ownerId: 'tm-d',
      memberIds: ['tm-c'],
      teamIds: [beta.id],
    })
    assert.deepEqual(
      (reach.items as Row[]).map((r) => [r.id, (r.after as Row).role, r.change, r.projectId]).sort(),
      [
        ['tm-c', 'member', 'gain', null],
        ['tm-d', 'admin', 'gain', null],
        ['tm-owner', 'admin', 'gain', null],
      ],
      'a private project ignores its restricted Workspace’s Team',
    )
    const inherited = await call('flow.access.preview', {
      change: 'project-create',
      workspaceId: closed.id,
      access: 'workspace',
    })
    assert.deepEqual(
      (inherited.items as Row[]).map((r) => r.id).sort(),
      ['tm-a', 'tm-b', 'tm-owner'],
      'an inheriting project opens to the Workspace Team, without its revoked member',
    )
    const everyone = await call('flow.access.preview', {
      change: 'project-create',
      workspaceId: open.id,
      access: 'workspace',
    })
    assert.equal(everyone.total, 5, 'every active internal person, not the guest')
    assert.equal(
      (
        (
          await call('flow.access.preview', {
            change: 'project-create',
            workspaceId: open.id,
            access: 'workspace',
            memberIds: [42],
          })
        ).fields as Row
      ).memberIds,
      'invalid',
    )

    // Any committed command moves the epoch, so an older Team cursor restarts.
    await team('Delta')
    assert.equal(code(await call('flow.team.list', { limit: 2, cursor: first.cursor })), 'conflict')

    // Members read Teams and see only the grants on targets they can open; guests read none.
    const reader = app.client.anonymous()
    await reader.login({ login: 'tm-c', password: 'local-test-password' })
    const seen = (await reader.call<Row>('flow.team.list', {})).value
    assert.equal(
      (seen.items as Row[]).find((t) => t.id === alpha.id)!.grantCount,
      1,
      'the closed Workspace is hidden from a non-member',
    )
    assert.deepEqual(
      (((await reader.call<Row>('flow.team.read', { id: alpha.id })).value.grants as Row[]) ?? []).map(
        (g) => g.targetTitle,
      ),
      ['Shared'],
    )
    assert.deepEqual(
      ((await reader.call<Row>('flow.workspace.bootstrap', { route: 'my-work' })).value.user as Row).teamIds,
      [beta.id],
    )
    assert.equal(
      code(
        (
          await reader.call<Row>('flow.access.preview', {
            change: 'project-create',
            workspaceId: open.id,
            access: 'workspace',
          })
        ).value,
      ),
      'forbidden',
      'previewing a new project needs Workspace management',
    )
    const guest = app.client.anonymous()
    await guest.login({ login: 'tm-guest', password: 'local-test-password' })
    for (const [name, args] of [
      ['flow.team.list', {}],
      ['flow.team.read', { id: alpha.id }],
      ['flow.member.list', { teamId: alpha.id }],
    ] as const)
      assert.equal(code((await guest.call<Row>(name, args)).value), 'forbidden', name)
    // C03: use the production Core engine, with no Pro module or paid extension.
    const project = async (title: string, access: string) =>
      ok(
        await call('flow.project.save', {
          workspaceId: closed.id,
          title,
          code: title.toUpperCase(),
          access,
          expectedRevision: revision,
          idempotencyKey: 'project-' + title,
        }),
      )
    const inheritedProject = await project('Inherited', 'workspace')
    const privateProject = await project('Private', 'private')
    const teammate = app.client.anonymous()
    await teammate.login({ login: 'tm-a', password: 'local-test-password' })
    const asTeammate = async (name: string, input: Row) => (await teammate.call<Row>(name, input)).value
    assert.notEqual((await asTeammate('flow.issue.list', { projectId: inheritedProject.id })).ok, false)
    assert.equal(
      code(await asTeammate('flow.issue.list', { projectId: privateProject.id })),
      'forbidden',
      'a Workspace Team grant does not enter a private project',
    )
    const grantUser = async (key: string, targetId: unknown, subjectId: string, role: string) =>
      ok(
        await call('flow.access.grant', {
          scope: 'project',
          targetId,
          subjectType: 'user',
          subjectId,
          role,
          expectedRevision: revision,
          idempotencyKey: key,
        }),
      )
    await grantUser('private-direct', privateProject.id, 'tm-a', 'viewer')
    assert.notEqual((await asTeammate('flow.issue.list', { projectId: privateProject.id })).ok, false)
    assert.equal(
      code(
        await asTeammate('flow.issue.save', {
          projectId: privateProject.id,
          title: 'Denied viewer write',
          idempotencyKey: 'viewer-write',
        }),
      ),
      'forbidden',
    )
    ok(
      await asTeammate('flow.issue.save', {
        projectId: inheritedProject.id,
        title: 'Team editor write',
        idempotencyKey: 'team-write',
      }),
    )
    // Organization epoch is returned on bootstrap, while task writes have their own CAS.
    revision = Number((await call('flow.workspace.bootstrap', { route: 'teams' })).organizationRevision)
    assert.equal(
      code(
        await call('flow.issue.save', {
          projectId: privateProject.id,
          title: 'Assign must not grant',
          assigneeIds: ['tm-c'],
          idempotencyKey: 'assign-no-grant',
        }),
      ),
      'forbidden',
    )
    assert.equal(
      code((await reader.call<Row>('flow.issue.list', { projectId: privateProject.id })).value),
      'forbidden',
    )
    assert.equal(
      (
        (await call('flow.grant.list', { scope: 'project', targetId: privateProject.id })).items as Row[]
      ).some((g) => g.subjectId === 'tm-c'),
      false,
    )
    await grantUser('guest-direct', privateProject.id, 'tm-guest', 'viewer')
    assert.notEqual(
      (await guest.call<Row>('flow.issue.list', { projectId: privateProject.id })).value.ok,
      false,
    )
    assert.equal(
      code((await guest.call<Row>('flow.issue.list', { projectId: shared.id })).value),
      'forbidden',
      'guests never inherit an internal Workspace',
    )
    assert.equal(
      code(
        await call('flow.access.grant', {
          scope: 'workspace',
          targetId: closed.id,
          subjectType: 'user',
          subjectId: 'tm-guest',
          role: 'viewer',
          expectedRevision: revision,
          idempotencyKey: 'guest-workspace',
        }),
      ),
      'validation',
    )
    for (const revoke of [false, true])
      assert.equal(
        code(
          await call('flow.member.update', {
            id: 'tm-owner',
            role: 'member',
            revoke,
            expectedVersion: 1,
            expectedRevision: revision,
            idempotencyKey: 'owner-' + revoke,
          }),
        ),
        'owner_protected',
        'the last owner cannot be demoted or revoked',
      )
    ok(
      await call('flow.member.update', {
        id: 'tm-d',
        role: 'admin',
        expectedVersion: 1,
        expectedRevision: revision,
        idempotencyKey: 'promote-admin',
      }),
    )
    const admin = app.client.anonymous()
    await admin.login({ login: 'tm-d', password: 'local-test-password' })
    ok(
      (
        await admin.call<Row>('flow.team.save', {
          title: 'Admin-managed',
          expectedRevision: revision,
          idempotencyKey: 'admin-team',
        })
      ).value,
    )
    assert.equal(
      code(
        await asTeammate('flow.team.save', {
          title: 'Member cannot administer',
          expectedRevision: revision,
          idempotencyKey: 'member-team',
        }),
      ),
      'forbidden',
    )
    // Membership revocation suspends existing sources. Only an organizer may
    // explicitly reactivate the member; Team and direct grants then apply again.
    const suspended = ok(
      await call('flow.member.update', {
        id: 'tm-a',
        role: 'member',
        revoke: true,
        expectedVersion: 1,
        expectedRevision: revision,
        idempotencyKey: 'suspend-teammate',
      }),
    )
    for (const projectId of [inheritedProject.id, privateProject.id])
      assert.equal(code(await asTeammate('flow.issue.list', { projectId })), 'forbidden')
    ok(
      await call('flow.member.update', {
        id: 'tm-a',
        role: 'member',
        revoke: false,
        expectedVersion: suspended.version,
        expectedRevision: revision,
        idempotencyKey: 'reactivate-teammate',
      }),
    )
    for (const projectId of [inheritedProject.id, privateProject.id])
      assert.notEqual((await asTeammate('flow.issue.list', { projectId })).ok, false)

    // Remove one source immediately, preserving an unrelated direct grant.
    ok(
      await call('flow.team.member', {
        id: alpha.id,
        memberId: 'tm-a',
        remove: true,
        expectedRevision: revision,
        idempotencyKey: 'remove-team-source',
      }),
    )
    assert.equal(code(await asTeammate('flow.issue.list', { projectId: inheritedProject.id })), 'forbidden')
    assert.notEqual((await asTeammate('flow.issue.list', { projectId: privateProject.id })).ok, false)
    if (process.env.FLOW_C03_REVIEW === '1') await reviewFlow(app, app.client, '/flow/teams?lang=vi')
    revision = Number((await call('flow.workspace.bootstrap', { route: 'teams' })).organizationRevision)
    // Cleanup of a revoked member must not reactivate or grant that member.
    assert.equal(
      code(
        await call('flow.team.member', {
          id: alpha.id,
          memberId: 'tm-revoked',
          expectedRevision: revision,
          idempotencyKey: 'readd-revoked',
        }),
      ),
      'validation',
    )
    ok(
      await call('flow.team.member', {
        id: alpha.id,
        memberId: 'tm-revoked',
        remove: true,
        expectedRevision: revision,
        idempotencyKey: 'cleanup-revoked',
      }),
    )
    assert.equal(
      ((await call('flow.member.list', { teamId: alpha.id })).items as Row[]).some(
        (m) => m.id === 'tm-revoked',
      ),
      false,
    )
  } finally {
    await app.close()
  }
})
