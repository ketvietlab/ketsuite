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

test('productivity collection reads preserve cursor order, filtered counts and bounded context', async () => {
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
        sessions: { anonymous: { company: 'paged-flow' } },
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
    await app.fixture.call('partner.savePartner', {
      id: 'paged-party',
      kind: 'company',
      name: 'Synthetic paged Company',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'paged-flow',
      partnerId: 'paged-party',
      currency: 'VND',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'paged-owner',
        login: 'paged-owner',
        password: 'synthetic-paged-password',
        name: 'Synthetic paged owner',
        superuser: true,
        defaultCompanyId: 'paged-flow',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'paged-owner:company',
      userId: 'paged-owner',
      companyId: 'paged-flow',
    })
    await app.client.login({ login: 'paged-owner', password: 'synthetic-paged-password' })
    const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
    let revision = 0
    const ok = (v: Row) => {
      assert.equal(v.ok, true, JSON.stringify(v))
      if (v.revision !== undefined) revision = Number(v.revision)
      return v
    }
    const workspace = ok(
      await call('flow.workspace.create', {
        title: 'Paged reads workspace',
        expectedRevision: 0,
        idempotencyKey: 'w',
      }),
    )
    const project = ok(
      await call('flow.project.save', {
        workspaceId: workspace.id,
        title: 'Paged project',
        code: 'PGR',
        expectedRevision: revision,
        idempotencyKey: 'p',
      }),
    )
    const other = ok(
      await call('flow.project.save', {
        workspaceId: workspace.id,
        title: 'Other project',
        code: 'OTH',
        expectedRevision: revision,
        idempotencyKey: 'other-p',
      }),
    )
    const created: Row[] = []
    for (let i = 0; i < 62; i++)
      created.push(
        ok(
          await call('flow.issue.save', {
            projectId: project.id,
            title: `${i % 2 === 0 ? 'Needle' : 'Other'} task ${i}`,
            description: `Detail payload ${i}`,
            priority: i % 3 === 0 ? 'high' : 'normal',
            dueDate: '2026-10-28',
            assigneeIds: i % 3 === 0 ? ['paged-owner'] : [],
            idempotencyKey: 'task-' + i,
          }),
        ),
      )
    for (let i = 0; i < 3; i++)
      ok(
        await call('flow.issue.save', {
          projectId: other.id,
          title: 'Needle outside scope ' + i,
          idempotencyKey: 'outside-' + i,
        }),
      )
    const list = (input: Row = {}) => call('flow.issue.list', { projectId: project.id, ...input })
    const first = await list({ limit: 7 })
    assert.equal(first.total, 62)
    assert.equal((first.tasks as Row[]).length, 7)
    assert.equal((first.metrics as Row).total, 62)
    assert.ok(first.cursor)
    for (const task of first.tasks as Row[]) {
      assert.equal(task.summary, true)
      assert.equal(Object.hasOwn(task, 'description'), false)
    }
    const walk = async (input: Row = {}, total = 62) => {
      let cursor: unknown
      const rows: Row[] = []
      do {
        const page = await list({ ...input, limit: 7, cursor })
        assert.equal(page.ok, undefined, JSON.stringify(page))
        assert.equal(page.total, total)
        assert.equal(
          Object.values(page.statusCounts as Row).reduce<number>((a, b) => a + Number(b), 0),
          total,
        )
        assert.ok((page.tasks as Row[]).length <= 7)
        rows.push(...(page.tasks as Row[]))
        cursor = page.cursor
        assert.ok(rows.length <= total, 'cursor terminates without duplicate accumulation')
      } while (cursor)
      assert.equal(rows.length, total)
      assert.equal(new Set(rows.map((r) => r.id)).size, total)
      return rows.map((r) => r.id)
    }
    for (const sort of ['manual', 'due', 'priority'])
      assert.deepEqual(await walk({ sort }), await walk({ sort }), sort + ' stable ties')
    await walk({ query: 'Needle' }, 31)
    await walk({ query: 'Needle', mine: true }, 11)
    for (const patch of [
      { query: 'Needle' },
      { sort: 'priority' },
      { projectId: other.id },
      { mine: true },
    ]) {
      const denied = await list({ ...patch, cursor: first.cursor })
      assert.equal((denied.fields as Row).cursor, 'scope_changed')
    }
    for (const cursor of ['malformed', 'x'.repeat(2049)])
      assert.equal(((await list({ cursor })).fields as Row).cursor, 'invalid')
    const settings = await call('flow.workspace.bootstrap', {
      workspaceId: workspace.id,
      projectId: project.id,
      route: 'personal-settings',
    })
    assert.deepEqual(settings.tasks, [])
    assert.deepEqual(settings.columns, [])
    const boot = await call('flow.workspace.bootstrap', {
      workspaceId: workspace.id,
      projectId: project.id,
      route: 'project-issues',
    })
    assert.ok((boot.tasks as Row[]).length < 62, 'bootstrap stays bounded')
    assert.equal((boot.collectionPage as Row).total, 62)
    const detail = await call('flow.issue.detail', { id: created[0]!.id })
    assert.equal((detail.task as Row).description, 'Detail payload 0')
    const options = await call('flow.project.options', { workspaceId: workspace.id, limit: 1 })
    assert.equal((options.items as Row[]).length, 1)
    assert.equal(options.total, 2)
    assert.ok(options.cursor)
    const next = await call('flow.project.options', {
      workspaceId: workspace.id,
      limit: 1,
      cursor: options.cursor,
    })
    assert.equal((next.items as Row[]).length, 1)
    assert.equal(next.cursor, null)
    assert.notEqual((options.items as Row[])[0]!.id, (next.items as Row[])[0]!.id)
    ok(
      await call('flow.issue.save', {
        id: created[0]!.id,
        expectedVersion: created[0]!.version,
        title: 'Needle changed',
        idempotencyKey: 'change-epoch',
      }),
    )
    assert.equal(((await list({ cursor: first.cursor })).fields as Row).cursor, 'scope_changed')
    if (process.env.FLOW_D02_REVIEW)
      await reviewFlow(
        app,
        app.client,
        `/flow/project-issues?company=paged-flow&workspace=${workspace.id}&project=${project.id}&lang=vi`,
        3700,
      )
  } finally {
    await app.close()
  }
})
