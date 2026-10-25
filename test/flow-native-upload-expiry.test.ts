import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { JobContext, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'
import { everyFunction } from './helpers/permissions.ts'

test('productivity expired draft uploads release metadata and reconcile late bytes without deleting finalized files', async () => {
  const env = process.env.FLOW_TEST_DATABASE_URL
    ? { DATABASE_URL: process.env.FLOW_TEST_DATABASE_URL }
    : undefined
  const sql = (query: string) => {
    let index = 0
    return env ? query.replace(/\?/g, () => '$' + ++index) : query
  }
  let age = false,
    workerTime = Date.now()
  const seen = new Map<string, boolean>(),
    removed = new Set<string>()
  const storage = createFlowStorageModule(),
    sweep = storage.jobs!.sweep!
  storage.jobs = {
    ...storage.jobs,
    sweep: {
      ...sweep,
      handler: (ctx: JobContext, args: Row) =>
        sweep.handler!(
          {
            ...ctx,
            storage: {
              ...ctx.storage,
              head: async (key) => {
                const meta = await ctx.storage.head(key)
                seen.set(key, Boolean(meta))
                return meta && age
                  ? { ...meta, modifiedAt: new Date(Date.now() - 7200000).toISOString() }
                  : meta
              },
              remove: async (key) => {
                await ctx.storage.remove(key)
                assert.equal(await ctx.storage.head(key), null)
                removed.add(key)
              },
            },
          } as JobContext,
          args,
        ),
    },
  }
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
      storage,
      createFlowModule(),
      createFlowWorkspaceModule(),
    ],
    worker: { queues: { maintenance: 1 } },
    serve: {
      permissions: everyFunction,
      sessions: { anonymous: { company: 'upload-expiry' } },
      openStore: async (config) => {
        if (!config.databaseUrl) return sqliteStore(config)
        const adapter = postgresAdapter(config.databaseUrl, { max: 2 })
        await adapter.open()
        return adapter
      },
    },
  })
  const app = await createTestDeployment(deployment, { env, workerNow: () => new Date(workerTime) })
  const call = async (name: string, input: Row) => (await app.client.call<Row>(name, input)).value
  const ok = (value: Row) => {
    assert.notEqual(value.ok, false, JSON.stringify(value.errors))
    return value
  }
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'expiry-partner',
      kind: 'company',
      name: 'Synthetic expiry Company',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'upload-expiry',
      partnerId: 'expiry-partner',
      currency: 'VND',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'expiry-owner',
        login: 'expiry-owner',
        name: 'Expiry owner',
        password: 'synthetic-expiry-password',
        superuser: true,
        defaultCompanyId: 'upload-expiry',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'expiry-owner:company',
      userId: 'expiry-owner',
      companyId: 'upload-expiry',
    })
    await app.client.login({ login: 'expiry-owner', password: 'synthetic-expiry-password' })
    const w = ok(
      await call('flow.workspace.create', {
        title: 'Expiry',
        expectedRevision: 0,
        idempotencyKey: 'expiry-workspace',
      }),
    )
    const p = ok(
      await call('flow.project.save', {
        workspaceId: w.id,
        title: 'Expiry project',
        code: 'EXP',
        expectedRevision: 1,
        idempotencyKey: 'expiry-project',
      }),
    )
    const task = ok(
      await call('flow.issue.save', { projectId: p.id, title: 'Expiry task', idempotencyKey: 'expiry-task' }),
    )
    const upload = async (name: string) => {
      const form = new FormData()
      form.set('file', new Blob([name], { type: 'text/plain' }), name + '.txt')
      const result = await app.client.post('/flow/uploads?task=' + task.id, form)
      assert.equal(result.status, 201, await result.clone().text())
      return String(((await result.json()) as Row).uploadId)
    }
    const draft = await upload('draft'),
      kept = await upload('finalized')
    const detail = (await call('flow.issue.detail', { id: task.id })).task as Row
    ok(
      await call('flow.issue.save', {
        id: task.id,
        expectedVersion: detail.version,
        attachments: [{ uploadId: kept }],
        idempotencyKey: 'finalize-file',
      }),
    )
    const before = await app.fixture.withTenant(
      '',
      async ({ adapter }) =>
        (await adapter.all(sql('SELECT "storeKey" FROM storage_attachment WHERE id=?'), [draft]))[0]!,
    )
    const key = String(before.storeKey)
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(sql('UPDATE flow_flow_attachment_binding SET "expiresAt"=? WHERE id=?'), [
        new Date(Date.now() - 1000).toISOString(),
        draft,
      ])
      await adapter.run(sql('UPDATE ket_job SET scheduled_at=? WHERE job=?'), [
        new Date(Date.now() - 1000).toISOString(),
        'flow.expireUpload',
      ])
    })
    workerTime += 3700000
    await app.drainJobs()
    const rows = await app.fixture.withTenant('', async ({ adapter }) => ({
      draft: await adapter.all(sql('SELECT id FROM flow_flow_attachment_binding WHERE id=?'), [draft]),
      kept: await adapter.all(sql('SELECT id FROM flow_flow_attachment_binding WHERE id=?'), [kept]),
      metadata: await adapter.all(sql('SELECT id FROM storage_attachment WHERE id=?'), [draft]),
    }))
    assert.equal(
      rows.draft.length,
      0,
      JSON.stringify(app.records.records.filter((r) => r.level === 'error').map((r) => r.error)),
    )
    assert.equal(rows.metadata.length, 0)
    assert.equal(rows.kept.length, 1)
    // Recent bytes survive the first sweep; the second sweep sees the grace-aged
    // object. This also represents a put finishing after metadata expiry.
    assert.equal(seen.get(key), true)
    assert.equal(removed.has(key), false)
    age = true
    workerTime += 7300000
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(sql('UPDATE ket_job SET scheduled_at=? WHERE job=? AND state=?'), [
        new Date(Date.now() - 1000).toISOString(),
        'storage.sweep',
        'scheduled',
      ])
    })
    await app.drainJobs()
    assert.equal(removed.has(key), true)
    assert.equal((await app.client.get('/flow/files/' + kept)).status, 200)
    assert.equal((await app.client.get('/flow/files/' + draft)).status, 403)
    assert.equal(
      (await app.client.get('/files/' + kept)).status,
      200,
      'shared storage path is readable before quarantine',
    )
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(sql('UPDATE storage_attachment SET "resModel"=?, "resId"=? WHERE id=?'), [
        'flow.Project',
        'quarantined-project',
        kept,
      ])
    })
    assert.ok(
      (await app.client.get('/files/' + kept)).status >= 400,
      'shared storage cannot bypass legacy Flow quarantine',
    )
    assert.equal((await app.client.get('/flow/files/' + kept)).status, 403)
  } finally {
    await app.close()
  }
})
