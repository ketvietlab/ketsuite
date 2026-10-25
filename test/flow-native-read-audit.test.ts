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

// Every read a screen issues, called by people outside a private project: none of them reads
// the project's records, options, reports or words. Search offers only what its reader may open.
test('reads refuse people outside a private project and search offers only what they may open', async () => {
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
        sessions: { anonymous: { company: 'read-flow' } },
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
      id: 'read-party',
      kind: 'company',
      name: 'Synthetic read',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'read-flow',
      partnerId: 'read-party',
      currency: 'VND',
    })
    // A member with no grant, a guest of the open project and a viewer of the secret one.
    const people = ['ra-outsider', 'ra-guest', 'ra-viewer']
    for (const id of ['ra-owner', ...people]) {
      await app.fixture.call(
        'user.createUser',
        {
          id,
          login: id,
          password: 'local-test-password',
          name: id,
          email: id + '@example.test',
          defaultCompanyId: 'read-flow',
        },
        { actor: null },
      )
      await app.fixture.call('user.grantCompany', {
        id: `${id}:read-flow`,
        userId: id,
        companyId: 'read-flow',
      })
    }
    // Every person may call every function: the refusals below are Flow's own.
    await app.fixture.call('user.saveRole', { id: 'read-role', name: 'Read role' })
    for (const key of Object.keys(native.functions))
      if (native.functions[key]!.exposure !== 'internal')
        await app.fixture.call('user.grantFunction', {
          id: `read-${key}`,
          roleId: 'read-role',
          fnKey: `flow.${key}`,
        })
    for (const id of ['ra-owner', ...people])
      await app.fixture.call('user.assignRole', { id: `${id}:flow`, userId: id, roleId: 'read-role' })
    await app.client.login({ login: 'ra-owner', password: 'local-test-password' })
    const call = async (name: string, args: Row) => (await app.client.call<Row>(name, args)).value
    const ok = (value: Row) => {
      assert.equal(value.ok, true, JSON.stringify(value))
      return value
    }
    // A read answers with its data; only a refusal carries `ok: false`.
    const read = (value: Row) => {
      assert.notEqual(value.ok, false, JSON.stringify(value))
      return value
    }
    const boot = async (route: string, projectId?: unknown) =>
      await call('flow.workspace.bootstrap', { route, ...(projectId ? { projectId } : {}) })
    const orgRevision = async () => Number((await boot('workspaces')).organizationRevision)

    const workspace = ok(
      await call('flow.workspace.create', { title: 'Quartz', expectedRevision: 0, idempotencyKey: 'ws' }),
    )
    const project = async (title: string, code: string, defaultView = 'board') =>
      ok(
        await call('flow.project.save', {
          workspaceId: workspace.id,
          title,
          code,
          defaultView,
          access: 'private',
          sprintCadence: { weeks: 1, weekday: 1 },
          expectedRevision: await orgRevision(),
          idempotencyKey: 'project-' + code,
        }),
      )
    const secret = await project('Zircon', 'ZIR'),
      open = await project('Quartz project', 'QTZ', 'project-issues')
    const bind = (n: number) => (pg ? '$' + n : '?')
    await app.fixture.withTenant('', async ({ adapter }) => {
      const [owner] = await adapter.all(`SELECT * FROM flow_member WHERE "userId"=${bind(1)}`, ['ra-owner'])
      const columns = Object.keys(owner!)
      for (const id of people) {
        const row: Row = {
          ...owner,
          id: 'member-' + id,
          userId: id,
          role: id === 'ra-guest' ? 'guest' : 'member',
        }
        await adapter.run(
          `INSERT INTO flow_member (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map((_, i) => bind(i + 1)).join(',')})`,
          columns.map((c) => row[c]),
        )
      }
    })
    const grants = new Map<string, Row>()
    for (const [person, role, target] of [
      ['ra-guest', 'editor', open],
      ['ra-viewer', 'viewer', secret],
    ] as const)
      grants.set(
        person,
        ok(
          await call('flow.access.grant', {
            scope: 'project',
            targetId: target.id,
            subjectType: 'user',
            subjectId: person,
            role,
            expectedRevision: await orgRevision(),
            idempotencyKey: `grant-${person}`,
          }),
        ),
      )

    // The secret project's records all carry the word Zircon.
    const records = async (target: Row, word: string) => {
      const task = ok(
        await call('flow.issue.save', {
          projectId: target.id,
          title: `${word} task`,
          description: `${word} description`,
          idempotencyKey: 'task-' + word,
        }),
      )
      ok(
        await call('flow.issue.comment', {
          id: task.id,
          text: `${word} comment`,
          idempotencyKey: 'comment-' + word,
        }),
      )
      const page = ok(
        await call('flow.page.save', {
          projectId: target.id,
          workspaceId: workspace.id,
          title: `${word} page`,
          blocks: [{ id: 'title', type: 'h1', text: `${word} page` }],
          idempotencyKey: 'page-' + word,
        }),
      )
      const epic = ok(
        await call('flow.epic.save', {
          projectId: target.id,
          title: `${word} epic`,
          start: '2026-10-12',
          end: '2026-10-30',
          ownerId: 'ra-owner',
          outcome: `${word} outcome`,
          idempotencyKey: 'epic-' + word,
        }),
      )
      const sprint = ok(
        await call('flow.sprint.save', {
          projectId: target.id,
          title: `${word} sprint`,
          start: '2026-10-12',
          end: '2026-10-18',
          idempotencyKey: 'sprint-' + word,
        }),
      )
      ok(
        await call('flow.form.save', {
          projectId: target.id,
          title: `${word} form`,
          fields: [{ label: 'Need', type: 'text', required: true }],
          access: 'project',
          assigneeId: 'ra-owner',
          publish: true,
          expectedRevision: (await boot('forms', target.id)).operationsRevision,
          idempotencyKey: 'form-' + word,
        }),
      )
      return { task, page, epic, sprint }
    }
    const hidden = await records(secret, 'Zircon')
    await records(open, 'Quartz')
    // A Workspace page, shared with every member of the Workspace.
    ok(
      await call('flow.page.save', {
        workspaceId: workspace.id,
        title: 'Quartz handbook',
        blocks: [{ id: 'title', type: 'h1', text: 'Quartz handbook' }],
        idempotencyKey: 'page-workspace',
      }),
    )

    const session = async (login: string) => {
      const client = app.client.anonymous()
      await client.login({ login, password: 'local-test-password' })
      return async (name: string, args: Row) => (await client.call<Row>(name, args)).value
    }
    const outsider = await session('ra-outsider'),
      guest = await session('ra-guest'),
      viewer = await session('ra-viewer')
    const leaks = (value: unknown) => JSON.stringify(value).includes('Zircon')

    // Reads of the secret project's records, options and reports: refused, with nothing of them.
    const targeted: [string, Row][] = [
      ['flow.workspace.bootstrap', { route: 'board', projectId: secret.id }],
      ['flow.workspace.bootstrap', { route: 'issue', recordId: hidden.task.id, projectId: secret.id }],
      ['flow.workspace.bootstrap', { route: 'page', recordId: hidden.page.id, projectId: secret.id }],
      ['flow.issue.list', { projectId: secret.id }],
      ['flow.issue.detail', { id: hidden.task.id }],
      ['flow.issue.activity', { id: hidden.task.id, kind: 'comments' }],
      ['flow.issue.export', { projectId: secret.id }],
      ['flow.issue.relocation.options', { id: hidden.task.id, mode: 'copy' }],
      ['flow.issue.relocation.preview', { id: hidden.task.id, targetProjectId: open.id, mode: 'copy' }],
      ['flow.sprint.report', { id: hidden.sprint.id }],
      ['flow.project.statusOptions', { projectId: secret.id }],
      ['flow.project.taskOptions', { projectId: secret.id }],
      ['flow.member.options', { projectId: secret.id }],
      ['flow.access.list', { scope: 'project', targetId: secret.id }],
      ['flow.access.preview', { change: 'project-access', projectId: secret.id, access: 'workspace' }],
      ['flow.grant.list', { scope: 'project', targetId: secret.id }],
      ['flow.project.move.preview', { projectId: secret.id, targetWorkspaceId: workspace.id }],
      ['flow.project.deletion.preview', { id: secret.id }],
    ]
    for (const [who, label] of [
      [outsider, 'outsider'],
      [guest, 'guest'],
    ] as const) {
      for (const [name, args] of targeted) {
        const value = await who(name, args)
        assert.equal(value.ok, false, `${label} ${name} ${JSON.stringify(args)} ${JSON.stringify(value)}`)
        assert.ok(
          ['forbidden', 'not_found'].includes(String((value.errors as Row[])[0]?.code)),
          `${label} ${name} ${JSON.stringify(value)}`,
        )
        assert.ok(!leaks(value), `${label} ${name} leaks ${JSON.stringify(value)}`)
      }
      // The live document reads refuse by throwing, never by an envelope LiveDoc would accept.
      for (const [name, id] of [
        ['flow.issue.document.read', hidden.task.id],
        ['flow.page.document.read', hidden.page.id],
      ] as const)
        await assert.rejects(who(name, { id }), `${label} ${name}`)
    }

    // Reads across what a person may see: the secret project is not among them.
    for (const [who, label] of [
      [outsider, 'outsider'],
      [guest, 'guest'],
    ] as const)
      for (const [name, args] of [
        ['flow.workspace.bootstrap', { route: 'my-work' }],
        ['flow.workspace.bootstrap', { route: 'all-issues' }],
        ['flow.workspace.bootstrap', { route: 'all-pages' }],
        ['flow.workspace.bootstrap', { route: 'workspaces' }],
        ['flow.issue.list', {}],
        ['flow.risk.list', {}],
        ['flow.project.options', {}],
        ['flow.project.list', {}],
        ['flow.inbox.list', {}],
        ['flow.search', { query: '' }],
        ['flow.search', { query: 'Zircon' }],
      ] as [string, Row][]) {
        const value = await who(name, args)
        assert.ok(!leaks(value), `${label} ${name} ${JSON.stringify(args)} leaks ${JSON.stringify(value)}`)
      }

    // The viewer of the secret project reads it, and writes none of its document.
    read(await viewer('flow.issue.detail', { id: hidden.task.id }))
    // The sprint has not started: the viewer passes the access check and meets the state rule.
    assert.equal(
      ((await viewer('flow.sprint.report', { id: hidden.sprint.id })).errors as Row[])[0]?.code,
      'sprint_state',
    )
    assert.equal(
      ((await viewer('flow.issue.document.read', { id: hidden.task.id })) as Row).key,
      hidden.task.id,
    )
    assert.equal(
      ((await viewer('flow.page.document.read', { id: hidden.page.id })) as Row).id,
      hidden.page.id,
    )
    await assert.rejects(viewer('flow.issue.document.write', { id: hidden.task.id }))
    await assert.rejects(viewer('flow.page.document.write', { id: hidden.page.id }))
    const found = read(await viewer('flow.search', { query: 'Zircon' }))
    const group = (value: Row, id: string) =>
      ((value.groups as Row[]).find((g) => g.id === id)?.items as Row[] | undefined) ?? []
    assert.deepEqual(
      ['tasks', 'pages', 'epics', 'sprints', 'forms'].map((id) => group(found, id).map((i) => i.title)),
      [['Zircon task'], ['Zircon page'], ['Zircon epic'], ['Zircon sprint'], ['Zircon form']],
    )

    // Every result opens a screen the client has: no search item leads to a missing route.
    const screens = new Set([
      'workspace-overview',
      'board',
      'project-issues',
      'issue',
      'page',
      'sprints',
      'epic',
      'forms',
      'all-issues',
      'inbox',
      'organization-members',
      'team',
      'my-work',
      'all-pages',
      'organization',
      'personal-settings',
    ])
    // A view shared with the project, and one its owner keeps to themselves.
    const view = async (title: string, visibility: string) =>
      ok(
        await call('flow.view.save', {
          projectId: open.id,
          title,
          visibility,
          query: 'Quartz',
          status: 'progress',
          expectedRevision: (await boot('forms', open.id)).operationsRevision,
          idempotencyKey: 'view-' + visibility,
        }),
      )
    const shared = await view('Quartz shared view', 'project')
    await view('Quartz own view', 'private')
    const owned = read(await call('flow.search', { query: 'Quartz' }))
    for (const g of owned.groups as Row[])
      for (const item of g.items as Row[])
        assert.ok(screens.has(String(item.route)), `${g.id} opens ${item.route}`)
    // A project opens on its own default view.
    assert.deepEqual(
      group(owned, 'projects').map((i) => i.route),
      ['project-issues'],
    )
    assert.deepEqual(group(owned, 'sprints')[0]?.params, { project: open.id })
    // A saved view opens as the saved views screen opens it: the project list with its filter.
    assert.deepEqual(
      group(owned, 'views').map((i) => i.title),
      ['Quartz own view', 'Quartz shared view'],
    )
    assert.deepEqual(group(owned, 'views')[1]?.params, {
      project: open.id,
      view: shared.id,
      q: 'Quartz',
      status: 'progress',
    })

    // A guest searches only what a guest may open: no Workspace, form, people or team, and of the
    // saved views only those shared with the project.
    const asGuest = read(await guest('flow.search', { query: 'Quartz' }))
    assert.deepEqual(
      group(asGuest, 'tasks').map((i) => i.title),
      ['Quartz task'],
    )
    assert.deepEqual(
      (asGuest.groups as Row[])
        .map((g) => g.id)
        .filter((id) => ['workspaces', 'forms', 'people', 'teams'].includes(String(id))),
      [],
    )
    assert.deepEqual(
      group(asGuest, 'views').map((i) => i.title),
      ['Quartz shared view'],
    )
    // A guest reads a page only when it is shared with them, even in their project.
    assert.deepEqual(group(asGuest, 'pages'), [])
    const browsing = read(await guest('flow.search', { query: '' }))
    assert.deepEqual(
      (browsing.groups as Row[])
        .map((g) => g.id)
        .filter((id) => ['workspaces', 'forms', 'people', 'teams'].includes(String(id))),
      [],
    )

    // A guest's own view is found while they read its project, and not once they no longer do.
    ok(
      await guest('flow.view.save', {
        projectId: open.id,
        title: 'Quartz guest view',
        visibility: 'private',
        expectedRevision: (
          await guest('flow.workspace.bootstrap', { route: 'saved-views', projectId: open.id })
        ).operationsRevision,
        idempotencyKey: 'guest-view',
      }),
    )
    assert.deepEqual(
      group(read(await guest('flow.search', { query: 'Quartz' })), 'views').map((i) => i.title),
      ['Quartz guest view', 'Quartz shared view'],
    )
    ok(
      await call('flow.access.revoke', {
        id: grants.get('ra-guest')!.id,
        expectedVersion: 1,
        expectedRevision: await orgRevision(),
        idempotencyKey: 'revoke-guest',
      }),
    )
    assert.deepEqual(group(read(await guest('flow.search', { query: 'Quartz' })), 'views'), [])
  } finally {
    await app.close()
  }
})
