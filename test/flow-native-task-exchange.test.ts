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

test('productivity task exchange preview rolls back, applies atomically and deduplicates across batches', async () => {
  let block = false
  const native = createFlowModule({
    extensions: [
      {
        name: 'exchange-proof',
        effects: [],
        beforeMutation: async (_ctx, mutation) => {
          if (block && mutation.name === 'flow.issue.save' && mutation.input.title === 'Refused')
            refuse('blocked')
        },
      },
    ],
  })
  const artifactsDir = await mkdtemp(join(tmpdir(), 'flow-task-exchange-'))
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
      sessions: { anonymous: { company: 'exchange-company' } },
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
      id: 'exchange-partner',
      kind: 'company',
      name: 'Task exchange',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'exchange-company',
      partnerId: 'exchange-partner',
      currency: 'VND',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'exchange-owner',
        login: 'exchange-owner',
        name: 'Exchange owner',
        password: 'synthetic-exchange-password',
        defaultCompanyId: 'exchange-company',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'exchange-company-grant',
      userId: 'exchange-owner',
      companyId: 'exchange-company',
    })
    await app.fixture.call('user.saveRole', { id: 'exchange-role', name: 'Exchange test' })
    for (const key of [
      'workspace.initialize',
      'workspace.create',
      'workspace.bootstrap',
      'project.save',
      'issue.export',
      'issue.importPreview',
      'issue.importApply',
      'issue.save',
      'issue.detail',
      'issue.list',
    ])
      await app.fixture.call('user.grantFunction', {
        id: 'exchange-fn-' + key,
        roleId: 'exchange-role',
        fnKey: 'flow.' + key,
      })
    await app.fixture.call('user.assignRole', {
      id: 'exchange-owner-role',
      userId: 'exchange-owner',
      roleId: 'exchange-role',
    })
    await app.client.login({ login: 'exchange-owner', password: 'synthetic-exchange-password' })
    const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
    const context = () => call('flow.workspace.bootstrap', { route: 'settings' })
    const w = ok(
      await call('flow.workspace.create', {
        title: 'Exchange workspace',
        expectedRevision: 0,
        idempotencyKey: 'workspace',
      }),
    )
    const p = ok(
      await call('flow.project.save', {
        workspaceId: w.id,
        title: 'Destination',
        code: 'EXC',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'project',
      }),
    )
    const other = ok(
      await call('flow.project.save', {
        workspaceId: w.id,
        title: 'Other',
        code: 'OTH',
        expectedRevision: (await context()).organizationRevision,
        idempotencyKey: 'other',
      }),
    )
    const count = async () => (await call('flow.issue.list', { projectId: p.id })).total
    const base = {
      projectId: p.id,
      schema: 'flow.task-exchange',
      version: 1,
      importId: 'file-one',
      mode: 'create',
      rows: [
        {
          sourceId: 'row-1',
          title: '=Spreadsheet formula',
          description: 'Plain content\nwith a new line',
          points: 3,
          checklist: [{ id: 'c1', text: 'Check', checked: false }],
        },
        { sourceId: 'row-2', title: 'Second', priority: 'high' },
      ],
      idempotencyKey: 'preview-one',
    }
    const preview = ok(await call('flow.issue.importPreview', base))
    assert.equal(preview.valid, true)
    assert.equal(await count(), 0, 'preview leaves no task, rank or history committed')
    const appliedArgs = { ...base, previewDigest: preview.previewDigest, idempotencyKey: 'apply-one' }
    const applied = ok(await call('flow.issue.importApply', appliedArgs))
    assert.equal(applied.imported, 2)
    assert.equal(await count(), 2)
    assert.deepEqual(await call('flow.issue.importApply', appliedArgs), applied)
    const repeated = { ...base, idempotencyKey: 'preview-two' },
      repeatedPreview = ok(await call('flow.issue.importPreview', repeated))
    const repeat = ok(
      await call('flow.issue.importApply', {
        ...repeated,
        previewDigest: repeatedPreview.previewDigest,
        idempotencyKey: 'apply-two',
      }),
    )
    assert.equal(repeat.imported, 0)
    assert.equal(repeat.replayed, 2)
    assert.equal(await count(), 2)
    const changed = {
      ...base,
      rows: [{ sourceId: 'row-1', title: 'Changed payload' }],
      idempotencyKey: 'preview-changed',
    }
    const changedPreview = ok(await call('flow.issue.importPreview', changed))
    assert.equal(changedPreview.valid, false)
    assert.equal((changedPreview.rows as Row[])[0]!.code, 'replay_mismatch')
    const bad = {
      ...base,
      importId: 'file-invalid',
      rows: [
        { sourceId: 'valid-first', title: 'Valid' },
        { sourceId: 'bad-last', title: 'Refused' },
      ],
      idempotencyKey: 'preview-bad',
    }
    const goodBeforeBlock = ok(await call('flow.issue.importPreview', bad))
    block = true
    const refused = await call('flow.issue.importApply', {
      ...bad,
      previewDigest: goodBeforeBlock.previewDigest,
      idempotencyKey: 'apply-bad',
    })
    assert.equal((refused.errors as Row[])[0]!.code, 'blocked')
    assert.equal(await count(), 2, 'late guard rolls back preceding records and row receipts')
    block = false
    const first = ok(await call('flow.issue.export', { projectId: p.id, limit: 1 }))
    assert.equal((first.rows as Row[]).length, 1)
    assert.ok(first.cursor)
    const second = ok(
      await call('flow.issue.export', {
        projectId: p.id,
        limit: 1,
        cursor: first.cursor,
        expectedRevision: first.revision,
      }),
    )
    assert.equal(second.cursor, null)
    const exported = [...(first.rows as Row[]), ...(second.rows as Row[])]
    assert.equal(
      exported.find((row) => row.sourceId === (applied.rows as Row[])[0]!.id)!.description,
      base.rows[0]!.description,
    )
    const update = {
      ...base,
      importId: 'file-update',
      mode: 'update',
      rows: [{ ...exported[0]!, title: 'Updated via exchange' }],
      idempotencyKey: 'preview-update',
    }
    const updatePreview = ok(await call('flow.issue.importPreview', update))
    assert.equal(updatePreview.valid, true)
    const updated = ok(
      await call('flow.issue.importApply', {
        ...update,
        previewDigest: updatePreview.previewDigest,
        idempotencyKey: 'apply-update',
      }),
    )
    assert.equal((updated.rows as Row[])[0]!.version, 2)
    const stale = await call('flow.issue.export', {
      projectId: p.id,
      cursor: first.cursor,
      expectedRevision: first.revision,
    })
    assert.equal((stale.errors as Row[])[0]!.code, 'conflict')
    const wrongProject = {
      ...update,
      projectId: other.id,
      importId: 'foreign-update',
      idempotencyKey: 'preview-foreign',
    }
    const foreignPreview = ok(await call('flow.issue.importPreview', wrongProject))
    assert.equal(foreignPreview.valid, false)
    assert.equal(((foreignPreview.rows as Row[])[0]!.fields as Row).id, 'scope')
    const copied = {
      ...base,
      projectId: other.id,
      importId: 'portable-copy',
      rows: exported,
      idempotencyKey: 'preview-copy',
    }
    const copyPreview = ok(await call('flow.issue.importPreview', copied))
    ok(
      await call('flow.issue.importApply', {
        ...copied,
        previewDigest: copyPreview.previewDigest,
        idempotencyKey: 'apply-copy',
      }),
    )
    assert.equal((await call('flow.issue.list', { projectId: other.id })).total, 2)
  } finally {
    await app.close()
    await rm(artifactsDir, { recursive: true, force: true })
  }
})
