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

test('others’ access is read on demand from the server; the bootstrap carries only the actor’s grants', async () => {
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
        sessions: { anonymous: { company: 'grant-flow' } },
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
      id: 'grant-party',
      kind: 'company',
      name: 'Synthetic grants',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'grant-flow',
      partnerId: 'grant-party',
      currency: 'VND',
    })
    const people = ['gr-a', 'gr-b', 'gr-c', 'gr-guest', 'gr-revoked']
    for (const id of ['gr-owner', ...people]) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id,
          email: id + '@example.test',
          defaultCompanyId: 'grant-flow',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `${id}:grant-flow`,
        userId: id,
        companyId: 'grant-flow',
      })
    }
    await app.fixture.call('user.saveRole', { id: 'grant-role', name: 'Grant test role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `grant-${key}`,
          roleId: 'grant-role',
          fnKey: `flow.${key}`,
        })
    for (const id of ['gr-owner', ...people])
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'grant-role' })
    await app.client.login({ login: 'gr-owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
    let revision = 0
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      if (value.revision !== undefined) revision = Number(value.revision)
      return value
    }
    const code = (value: Row) => (value.errors as Row[] | undefined)?.[0]?.code
    const field = (value: Row, name: string) => (value.fields as Row | undefined)?.[name]
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
    const inside = ok(
      await call('flow.project.save', {
        workspaceId: closed.id,
        title: 'Inside',
        code: 'INS',
        expectedRevision: revision,
        idempotencyKey: 'p2',
      }),
    )
    const secret = ok(
      await call('flow.project.save', {
        workspaceId: closed.id,
        title: 'Secret',
        code: 'SEC',
        access: 'private',
        expectedRevision: revision,
        idempotencyKey: 'p3',
      }),
    )
    // Flow membership cloned from the owner's row: members, a guest and a revoked person.
    const bind = (n: number) => (pg ? '$' + n : '?')
    await app.fixture.withTenant('', async ({ adapter }) => {
      const [owner] = await adapter.all(`SELECT * FROM flow_member WHERE "userId"=${bind(1)}`, ['gr-owner'])
      const columns = Object.keys(owner!)
      for (const id of people) {
        const row: Row = {
          ...owner,
          id: 'member-' + id,
          userId: id,
          role: id === 'gr-guest' ? 'guest' : 'member',
          status: 'active',
        }
        await adapter.run(
          `INSERT INTO flow_member (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map((_, i) => bind(i + 1)).join(',')})`,
          columns.map((c) => row[c]),
        )
      }
    })
    const alpha = ok(
      await call('flow.team.save', { title: 'Alpha', expectedRevision: revision, idempotencyKey: 'team-a' }),
    )
    for (const id of ['gr-a', 'gr-revoked'])
      ok(
        await call('flow.team.member', {
          id: alpha.id,
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
          subjectIds: [subjectId],
          role,
          expectedRevision: revision,
          idempotencyKey: key,
        }),
      )
    await grant('g-alpha', 'workspace', closed.id, 'team', alpha.id, 'editor')
    await grant('g-guest', 'project', shared.id, 'user', 'gr-guest', 'viewer')
    await grant('g-b-secret', 'project', secret.id, 'user', 'gr-b', 'admin')
    await grant('g-c-shared', 'project', shared.id, 'user', 'gr-c', 'viewer')
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(`UPDATE flow_member SET status='revoked' WHERE "userId"=${bind(1)}`, ['gr-revoked'])
    })

    // The bootstrap ships the actor's own grants and their Teams', nobody else's.
    const ownerBoot = await call('flow.workspace.bootstrap', { route: 'organization-members' })
    assert.ok(
      (ownerBoot.grants as Row[]).every((g) => g.subjectType === 'user' && g.subjectId === 'gr-owner'),
      JSON.stringify(ownerBoot.grants),
    )
    const member = app.client.anonymous()
    await member.login({ login: 'gr-a', password: 'local-test-password' })
    const as = async (name: string, args: Row) => (await member.call<Row>(name, args)).value
    const memberBoot = await as('flow.workspace.bootstrap', { route: 'my-work' })
    assert.deepEqual(
      (memberBoot.grants as Row[]).map((g) => [g.subjectType, g.subjectId, g.targetId]),
      [['team', alpha.id, closed.id]],
      'a member sees their Team’s grant and not the guest’s or anyone else’s',
    )

    // A target's grants, named, a page at a time by a fenced keyset cursor.
    const all = await call('flow.grant.list', { scope: 'project', targetId: shared.id })
    const guestRow = (all.items as Row[]).find((g) => g.subjectId === 'gr-guest')!
    assert.deepEqual(
      [
        guestRow.subjectTitle,
        guestRow.subjectEmail,
        guestRow.subjectRole,
        guestRow.subjectStatus,
        guestRow.targetTitle,
      ],
      ['gr-guest', 'gr-guest@example.test', 'guest', 'active', 'Shared'],
    )
    const ids: unknown[] = []
    let cursor: unknown
    do {
      const page = await call('flow.grant.list', {
        scope: 'project',
        targetId: shared.id,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      })
      assert.equal(page.total, all.total)
      ids.push(...(page.items as Row[]).map((g) => g.id))
      cursor = page.cursor
    } while (cursor)
    assert.deepEqual(
      ids,
      (all.items as Row[]).map((g) => g.id),
    )
    assert.ok(ids.length >= 3, 'the owner, the guest and gr-c')
    const held = await call('flow.grant.list', { scope: 'project', targetId: shared.id, limit: 1 })
    for (const bad of ['not-a-cursor', Buffer.from(JSON.stringify({ id: '' })).toString('base64url')])
      assert.equal(
        field(
          await call('flow.grant.list', { scope: 'project', targetId: shared.id, cursor: bad }),
          'cursor',
        ),
        'invalid',
      )
    // A Team's row carries its size; a member who reaches the target reads it too.
    const team = (await as('flow.grant.list', { scope: 'workspace', targetId: closed.id })).items as Row[]
    const alphaRow = team.find((g) => g.subjectType === 'team')!
    assert.deepEqual(
      [alphaRow.subjectTitle, alphaRow.memberCount, alphaRow.subjectStatus, alphaRow.role],
      ['Alpha', 2, 'active', 'editor'],
      'a Team row carries its size, revoked members included',
    )
    assert.ok(team.filter((g) => g.subjectType === 'user').every((g) => g.memberCount === null))
    assert.equal(code(await as('flow.grant.list', { scope: 'project', targetId: secret.id })), 'forbidden')
    // Exactly one way of reading, and a target needs its scope.
    assert.equal(field(await call('flow.grant.list', {}), 'targetId'), 'invalid')
    assert.equal(
      field(
        await call('flow.grant.list', {
          scope: 'project',
          targetId: shared.id,
          subjectType: 'user',
          subjectId: 'gr-a',
        }),
        'targetId',
      ),
      'invalid',
    )
    assert.equal(field(await call('flow.grant.list', { targetId: shared.id }), 'scope'), 'invalid')
    // A person's grants are read by organization managers, or by that person.
    const guestGrants = await call('flow.grant.list', {
      subjectType: 'user',
      subjectId: 'gr-guest',
      scope: 'project',
    })
    assert.deepEqual(
      (guestGrants.items as Row[]).map((g) => [g.targetTitle, g.role]),
      [['Shared', 'viewer']],
    )
    assert.equal(code(await as('flow.grant.list', { subjectType: 'user', subjectId: 'gr-b' })), 'forbidden')
    assert.notEqual((await as('flow.grant.list', { subjectType: 'user', subjectId: 'gr-a' })).ok, false)
    assert.equal(
      field(await call('flow.grant.list', { subjectType: 'bot', subjectId: 'gr-a' }), 'subjectType'),
      'invalid',
    )
    const guest = app.client.anonymous()
    await guest.login({ login: 'gr-guest', password: 'local-test-password' })
    assert.equal(
      code((await guest.call<Row>('flow.grant.list', { subjectType: 'user', subjectId: 'gr-guest' })).value),
      'forbidden',
    )

    // People filters narrow before paging.
    const names = (value: Row) => (value.items as Row[]).map((m) => m.id)
    assert.deepEqual(names(await call('flow.member.list', { internal: true })), [
      'gr-a',
      'gr-b',
      'gr-c',
      'gr-owner',
    ])
    assert.deepEqual(names(await call('flow.member.list', { active: true })), [
      'gr-a',
      'gr-b',
      'gr-c',
      'gr-guest',
      'gr-owner',
    ])
    assert.deepEqual(names(await call('flow.member.list', { ids: ['gr-revoked', 'gr-b'] })), [
      'gr-b',
      'gr-revoked',
    ])
    assert.equal(
      field(await call('flow.member.list', { ids: Array.from({ length: 101 }, (_, n) => `x-${n}`) }), 'ids'),
      'invalid',
    )
    assert.deepEqual(
      names(await call('flow.member.options', { projectId: shared.id, internal: true })),
      ['gr-a', 'gr-b', 'gr-c', 'gr-owner'],
      'the guest can open Shared but is not internal',
    )
    assert.deepEqual(names(await call('flow.member.options', { projectId: secret.id, roles: ['admin'] })), [
      'gr-b',
      'gr-owner',
    ])
    assert.deepEqual(
      names(
        await call('flow.member.options', {
          projectId: inside.id,
          roles: ['editor', 'admin', 'owner'],
          exclude: ['gr-owner'],
        }),
      ),
      ['gr-a'],
      'the Team’s editor grant reaches an inheriting project',
    )
    assert.deepEqual(
      names(await call('flow.member.options', { projectId: shared.id, roles: ['editor', 'admin', 'owner'] })),
      ['gr-owner'],
      'people who only read or contribute to Shared are left out',
    )
    for (const roles of [[], ['constructor'], ['viewer', 'member', 'editor', 'admin', 'owner', 'viewer']])
      assert.equal(
        field(await call('flow.member.options', { projectId: shared.id, roles }), 'roles'),
        'invalid',
      )

    // Projects: inheriting ones are counted, and those whose access the actor may change.
    const projectTitles = (value: Row) => (value.items as Row[]).map((p) => p.title)
    const inheriting = await call('flow.project.options', {
      workspaceId: closed.id,
      access: 'workspace',
      limit: 1,
    })
    assert.equal(inheriting.total, 1)
    assert.equal(field(await call('flow.project.options', { access: 'internal' }), 'access'), 'invalid')
    assert.deepEqual(projectTitles(await call('flow.project.options', { manage: true })), [
      'Inside',
      'Secret',
      'Shared',
    ])
    const admin = app.client.anonymous()
    await admin.login({ login: 'gr-b', password: 'local-test-password' })
    assert.deepEqual(
      projectTitles((await admin.call<Row>('flow.project.options', { manage: true })).value),
      ['Secret'],
      'a project admin manages only that project',
    )
    assert.deepEqual(
      projectTitles(await as('flow.project.options', { manage: true })),
      [],
      'an editor manages none',
    )

    // An access list may be searched by name or email.
    const found = await call('flow.access.list', { scope: 'project', targetId: shared.id, query: 'GR-GU' })
    assert.deepEqual(names(found), ['gr-guest'])
    assert.equal(found.total, 1)

    // What revoking someone removes: reachable projects (as if active) and unfinished tasks.
    const statuses = (await call('flow.project.statusOptions', { projectId: shared.id })).items as Row[]
    const done = statuses.find((s) => s.kind === 'done')!
    const task = async (key: string, title: string) =>
      ok(
        await call('flow.issue.save', {
          projectId: shared.id,
          title,
          assigneeIds: ['gr-a'],
          idempotencyKey: key,
        }),
      )
    const first = await task('t1', 'First open'),
      second = await task('t2', 'Second open'),
      finished = await task('t3', 'Finished')
    ok(
      await call('flow.issue.save', {
        id: finished.id,
        columnId: done.id,
        expectedVersion: 1,
        idempotencyKey: 't3-done',
      }),
    )
    const impact = await call('flow.member.impact', { memberId: 'gr-a' })
    assert.equal(impact.projects, 2, 'Shared through the internal Workspace, Inside through Alpha')
    assert.equal((impact.tasks as Row).total, 2)
    assert.deepEqual(
      ((impact.tasks as Row).items as Row[]).map((t) => [t.id, t.title, t.projectId]),
      [
        [first.id, 'First open', shared.id],
        [second.id, 'Second open', shared.id],
      ],
    )
    assert.equal(
      (await call('flow.member.impact', { memberId: 'gr-revoked' })).projects,
      2,
      'a revoked person’s reach is counted as if they returned',
    )
    assert.equal(code(await call('flow.member.impact', { memberId: 'nobody' })), 'not_found')
    assert.equal(code(await as('flow.member.impact', { memberId: 'gr-b' })), 'forbidden')

    // Several people are granted together; one ineligible person grants nobody.
    const insideGrants = async () =>
      ((await call('flow.grant.list', { scope: 'project', targetId: inside.id })).items as Row[]).map((g) => [
        g.subjectId,
        g.role,
      ])
    const batch = (key: string, args: Row) =>
      call('flow.access.grant', {
        scope: 'project',
        targetId: inside.id,
        subjectType: 'user',
        role: 'viewer',
        expectedRevision: revision,
        idempotencyKey: key,
        ...args,
      })
    const untouched = await insideGrants()
    assert.equal(
      field(await batch('batch-bad', { subjectIds: ['gr-c', 'gr-revoked'] }), 'subjectIds'),
      'invalid',
    )
    assert.deepEqual(await insideGrants(), untouched, 'nothing was written')
    const both = ok(await batch('batch-ok', { subjectIds: ['gr-c', 'gr-guest'] }))
    assert.equal((both.ids as unknown[]).length, 2)
    ok(await batch('batch-role', { subjectIds: ['gr-c'], role: 'editor' }))
    const granted = new Map((await insideGrants()) as [string, string][])
    assert.equal(granted.get('gr-c'), 'editor', 'a batch changes an existing grant’s role')
    assert.equal(granted.get('gr-guest'), 'viewer')
    assert.equal(
      field(
        await call('flow.access.grant', {
          scope: 'workspace',
          targetId: closed.id,
          subjectType: 'user',
          subjectIds: ['gr-guest'],
          role: 'viewer',
          expectedRevision: revision,
          idempotencyKey: 'batch-guest-workspace',
        }),
        'subjectIds',
      ),
      'invalid',
      'guests are granted projects only',
    )
    for (const [key, args] of [
      ['batch-both', { subjectId: 'gr-c', subjectIds: ['gr-c'] }],
      ['batch-neither', {}],
      ['batch-twice', { subjectIds: ['gr-c', 'gr-c'] }],
      ['batch-empty', { subjectIds: [] }],
    ] as const)
      assert.equal(code(await batch(key, args)), 'validation', key)

    // A committed command moves the epoch, so an older grant cursor restarts.
    assert.equal(
      code(
        await call('flow.grant.list', {
          scope: 'project',
          targetId: shared.id,
          limit: 1,
          cursor: held.cursor,
        }),
      ),
      'conflict',
    )

    // The owner of the open document reads its readers by name; a reader learns only about themselves.
    const document = ok(
      await call('flow.page.save', {
        projectId: shared.id,
        workspaceId: open.id,
        title: 'Plan',
        titleSource: 'content',
        blocks: [{ id: 'title', type: 'h1', text: 'Plan' }],
        idempotencyKey: 'doc-create',
      }),
    )
    ok(
      await call('flow.page.share', {
        id: document.id,
        visibility: 'private',
        readerIds: ['gr-a', 'gr-c'],
        expectedVersion: 1,
        idempotencyKey: 'doc-share',
      }),
    )
    const pageOf = (boot: Row) => (boot.pages as Row[]).find((p) => p.id === document.id)!
    const owned = pageOf(
      await call('flow.workspace.bootstrap', {
        route: 'page',
        recordId: document.id,
        workspaceId: open.id,
        projectId: shared.id,
      }),
    )
    assert.deepEqual([...(owned.readerIds as string[])].sort(), ['gr-a', 'gr-c'])
    assert.deepEqual((owned.readers as Row[]).map((r) => [r.id, r.name]).sort(), [
      ['gr-a', 'gr-a'],
      ['gr-c', 'gr-c'],
    ])
    const read = pageOf(
      await as('flow.workspace.bootstrap', {
        route: 'page',
        recordId: document.id,
        workspaceId: open.id,
        projectId: shared.id,
      }),
    )
    assert.deepEqual(read.readerIds, ['gr-a'], 'another reader is not disclosed')
    assert.ok(!('readers' in read))

    // An intake form's recipient is an active internal person who can open the project; anyone
    // else is the form's invalid field, not the owner's refusal.
    const form = async (key: string, assigneeId: string) =>
      await call('flow.form.save', {
        projectId: secret.id,
        title: 'Requests',
        fields: [{ label: 'Need', type: 'text' }],
        access: 'internal',
        assigneeId,
        // Forms advance their own revision, untouched until now.
        expectedRevision: 0,
        idempotencyKey: key,
      })
    for (const person of ['gr-c', 'gr-a', 'gr-guest', 'gr-revoked', 'nobody'])
      assert.equal(field(await form('form-' + person, person), 'assignee'), 'invalid', person)
    ok(await form('form-gr-b', 'gr-b'))

    // The access page of a person opens them even when missing from the directory page; an
    // unknown person is explained by the page, while the edit form refuses.
    assert.notEqual(
      (await call('flow.workspace.bootstrap', { route: 'member-access', recordId: 'nobody' })).ok,
      false,
    )
    assert.equal(
      code(await call('flow.workspace.bootstrap', { route: 'member-edit', recordId: 'nobody' })),
      'not_found',
    )
  } finally {
    await app.close()
  }
})
