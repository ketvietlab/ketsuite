import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { refuse } from '../packages/ketsuite/src/modules/flow/native/policy.ts'
import { everyFunction } from './helpers/permissions.ts'

test('productivity project catalog clones and restoration remap scoped records atomically', async () => {
  let blocked = false,
    guarded = 0
  const native = createFlowModule({
    extensions: [
      {
        name: 'catalog-proof',
        effects: [],
        beforeMutation: async (_ctx, mutation) => {
          if (!mutation.input.catalogRemap) return
          guarded++
          if (blocked && guarded === 101) refuse('blocked')
        },
      },
    ],
  })
  const artifactsDir = await mkdtemp(join(tmpdir(), 'flow-project-catalogs-'))
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
      livedoc,
      createFlowStorageModule(),
      native,
    ],
    serve: {
      permissions: everyFunction,
      sessions: { anonymous: { company: 'catalog-remap-company' } },
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
      id: 'remap-partner',
      kind: 'company',
      name: 'Catalog remapping',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'catalog-remap-company',
      partnerId: 'remap-partner',
      currency: 'VND',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'remap-owner',
        login: 'remap-owner',
        name: 'Remap owner',
        password: 'synthetic-remap-password',
        defaultCompanyId: 'catalog-remap-company',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'remap-company-grant',
      userId: 'remap-owner',
      companyId: 'catalog-remap-company',
    })
    await app.fixture.call('user.saveRole', { id: 'remap-role', name: 'Remap test' })
    for (const key of [
      'workspace.initialize',
      'workspace.create',
      'workspace.bootstrap',
      'project.save',
      'tag.save',
      'column.save',
      'view.save',
      'issue.save',
      'issue.archive',
      'issue.detail',
    ])
      await app.fixture.call('user.grantFunction', {
        id: 'remap-fn-' + key,
        roleId: 'remap-role',
        fnKey: 'flow.' + key,
      })
    await app.fixture.call('user.assignRole', {
      id: 'remap-owner-role',
      userId: 'remap-owner',
      roleId: 'remap-role',
    })
    await app.client.login({ login: 'remap-owner', password: 'synthetic-remap-password' })
    const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
    const context = async (projectId?: unknown) =>
      call('flow.workspace.bootstrap', { route: 'settings', ...(projectId ? { projectId } : {}) })
    const w = ok(
      await call('flow.workspace.create', {
        title: 'Remap workspace',
        expectedRevision: 0,
        idempotencyKey: 'workspace',
      }),
    )
    const p = ok(
      await call('flow.project.save', {
        workspaceId: w.id,
        title: 'First',
        code: 'ONE',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'first',
      }),
    )
    const other = ok(
      await call('flow.project.save', {
        workspaceId: w.id,
        title: 'Second',
        code: 'TWO',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'second',
      }),
    )
    const unsupported = await call('flow.tag.save', {
      title: 'Unsupported color',
      domain: 'task',
      color: 'pink',
      idempotencyKey: 'unsupported-color',
    })
    assert.equal((unsupported.errors as Row[])[0]!.code, 'validation')
    const label = ok(
      await call('flow.tag.save', {
        title: 'Shared tag',
        domain: 'task',
        color: 'green',
        idempotencyKey: 'label',
      }),
    )
    const initial = await context(p.id),
      columns = initial.columns as Row[]
    assert.equal(columns.length, 4)
    const tasks: Row[] = []
    for (let i = 0; i < 101; i++)
      tasks.push(
        ok(
          await call('flow.issue.save', {
            projectId: p.id,
            title: 'Task ' + i,
            columnId: columns[0]!.id,
            tagIds: [label.id],
            idempotencyKey: 'task-' + i,
          }),
        ),
      )
    const shared = ok(
      await call('flow.issue.save', {
        projectId: other.id,
        title: 'Unchanged',
        columnId: columns[0]!.id,
        tagIds: [label.id],
        idempotencyKey: 'other-task',
      }),
    )
    ok(
      await call('flow.issue.archive', {
        reason: 'Synthetic archive verification',
        id: tasks[100]!.id,
        expectedVersion: tasks[100]!.version,
        idempotencyKey: 'archive-last',
      }),
    )
    const view = ok(
      await call('flow.view.save', {
        projectId: p.id,
        title: 'Todo saved',
        status: columns[0]!.id,
        visibility: 'project',
        expectedRevision: (await context()).operationsRevision,
        idempotencyKey: 'view',
      }),
    )
    const definitions = columns.map((c, i) => ({
      id: 'custom-remap-' + i,
      sourceId: c.id,
      title: c.title ?? c.label,
      kind: c.kind,
      color: c.color,
    }))
    const args = {
      id: p.id,
      taskStatuses: definitions,
      taskLabels: [{ id: 'custom-remap-label', sourceId: label.id, title: 'Project tag', color: 'green' }],
      expectedVersion: p.version,
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'clone',
    }
    blocked = true
    guarded = 0
    const failed = await call('flow.project.save', args)
    assert.equal((failed.errors as Row[])[0]!.code, 'blocked')
    assert.equal(guarded, 101, 'extension guard runs after the first task window')
    assert.equal(
      ((await call('flow.issue.detail', { id: tasks[0]!.id })).task as Row).status,
      columns[0]!.id,
      'late refusal rolls back preceding task remaps',
    )
    blocked = false
    guarded = 0
    const cloned = ok(await call('flow.project.save', args))
    assert.equal(guarded, 101)
    assert.deepEqual(await call('flow.project.save', args), cloned)
    assert.equal(guarded, 101, 'replay never runs remapping twice')
    for (const [i, task] of tasks.entries()) {
      const value = (await call('flow.issue.detail', { id: task.id })).task as Row
      assert.equal(value.status, definitions[0]!.id)
      assert.deepEqual(value.tags, ['custom-remap-label'])
      assert.equal(value.version, i === 100 ? 3 : 2)
    }
    const unchanged = (await call('flow.issue.detail', { id: shared.id })).task as Row
    assert.equal(unchanged.status, columns[0]!.id)
    assert.deepEqual(unchanged.tags, [label.id])
    assert.equal(unchanged.version, 1)
    const readSaved = await app.fixture.withTenant('', async ({ adapter }) =>
      adapter.all('SELECT status, version FROM flow_saved_view WHERE id = ' + (env ? '$1' : '?'), [view.id]),
    )
    assert.equal(readSaved[0]!.status, definitions[0]!.id)
    assert.equal(Number(readSaved[0]!.version), 2)
    const invalidSource = await call('flow.project.save', {
      ...args,
      taskStatuses: definitions.map((d, i) => ({ ...d, id: 'next-remap-' + i, sourceId: columns[i]!.id })),
      expectedVersion: cloned.version,
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'invalid-source',
    })
    assert.equal((invalidSource.fields as Row).taskStatuses, 'source_scope')
    const current = await context(p.id)
    const column = (current.columns as Row[]).find((row) => row.id === definitions[0]!.id)!
    const renamed = ok(
      await call('flow.column.save', {
        id: column.id,
        title: 'Edited separately',
        expectedVersion: column.version,
        idempotencyKey: 'individual-rename',
      }),
    )
    assert.equal(renamed.projectVersion, 3)
    const staleAggregate = await call('flow.project.save', {
      id: p.id,
      taskStatuses: null,
      expectedVersion: cloned.version,
      expectedRevision: (await context()).organizationRevision,
      idempotencyKey: 'stale-project-form',
    })
    assert.equal(
      (staleAggregate.errors as Row[])[0]!.code,
      'conflict',
      'individual edits invalidate aggregate CAS',
    )
    assert.equal(
      ((await call('flow.issue.detail', { id: tasks[0]!.id })).task as Row).status,
      definitions[0]!.id,
      'stale aggregate leaves references untouched',
    )
    const restored = ok(
      await call('flow.project.save', {
        id: p.id,
        taskStatuses: null,
        taskLabels: null,
        expectedVersion: renamed.projectVersion,
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'restore',
      }),
    )
    assert.equal(restored.version, 4)
    const last = (await call('flow.issue.detail', { id: tasks[100]!.id })).task as Row
    assert.equal(last.status, columns[0]!.id)
    assert.deepEqual(last.tags, [label.id])
    assert.equal(last.version, 4)
    const restoredView = await app.fixture.withTenant('', async ({ adapter }) =>
      adapter.all('SELECT status, version FROM flow_saved_view WHERE id = ' + (env ? '$1' : '?'), [view.id]),
    )
    assert.equal(restoredView[0]!.status, columns[0]!.id)
    assert.equal(Number(restoredView[0]!.version), 3)
  } finally {
    await app.close()
    await rm(artifactsDir, { recursive: true, force: true })
  }
})
