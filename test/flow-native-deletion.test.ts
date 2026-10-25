import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Changeset, defineDeployment, deleteFrom, eq, sqliteStore } from '@ketvietlab/ketjs'
import type { JobContext, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'
import { refuse } from '../packages/ketsuite/src/modules/flow/native/policy.ts'
import { everyFunction } from './helpers/permissions.ts'

test('productivity irreversible deletion is separately authorized, durable, bounded and retryable', async () => {
  let blockPurge = false,
    failRemoval = false,
    ageObjects = false
  let workerTime = Date.now()
  let ledgerAttack = ''
  const removedKeys: string[] = []
  let duringHead: (() => Promise<void>) | null = null
  const jobOnly = createFlowModule({
    extensions: [{ name: 'job-effects-proof', effects: [], purgeEffects: ['write:flow_pro.GoalEpic'] }],
  })
  assert.ok(!jobOnly.functions['workspace.bootstrap']!.effects!.includes('write:flow_pro.GoalEpic'))
  assert.ok(jobOnly.jobs!.purgeNativeProject!.effects!.includes('write:flow_pro.GoalEpic'))
  const native = createFlowModule({
    extensions: [
      {
        name: 'purge-atomicity',
        effects: [],
        beforeMutation: async (ctx, mutation) => {
          if (!ledgerAttack || mutation.name !== 'flow.issue.save') return
          const model = 'flow.TaskHistory',
            T = ctx.table(model)
          if (ledgerAttack === 'update')
            await ctx.db.update(model, { id: 'anything' }, { description: 'tampered' })
          if (ledgerAttack === 'cas')
            await ctx.db.compareAndSet(model, { id: 'anything' }, {}, { description: 'tampered' })
          if (ledgerAttack === 'delete') await ctx.db.del(deleteFrom(T).where(eq(T.id, 'anything')))
          if (ledgerAttack === 'commit')
            await ctx.db.commit(
              new Changeset(ctx.manifest, model, { description: 'tampered' }, { id: 'anything' }),
            )
          if (ledgerAttack === 'nested')
            await ctx.tx((tx) => tx.db.update(model, { id: 'anything' }, { description: 'tampered' }))
        },
        purge: async () => {
          if (blockPurge) refuse('blocked')
        },
      },
    ],
  })
  const blobs = native.jobs!.purgeNativeBlobs!,
    original = blobs.handler!
  native.jobs!.purgeNativeBlobs = {
    ...blobs,
    maxAttempts: 1,
    handler: (ctx, args) =>
      original(
        {
          ...ctx,
          storage: {
            ...ctx.storage,
            head: async (key) => {
              const meta = await ctx.storage.head(key)
              if (duringHead) {
                const write = duringHead
                duringHead = null
                await write()
              }
              return meta && ageObjects
                ? { ...meta, modifiedAt: new Date(Date.now() - 7200000).toISOString() }
                : meta
            },
            remove: async (key) => {
              if (failRemoval) throw new Error('controlled storage outage')
              removedKeys.push(key)
              await ctx.storage.remove(key)
              assert.equal(await ctx.storage.head(key), null, 'physical object is gone')
            },
          },
        } as JobContext,
        args,
      ),
  }
  const metadataJob = native.jobs!.purgeNativeProject!,
    metadataHandler = metadataJob.handler!
  let largestRead = 0
  native.jobs!.purgeNativeProject = {
    ...metadataJob,
    maxAttempts: 1,
    handler: (ctx, args) =>
      metadataHandler(
        {
          ...ctx,
          tx: (callback) =>
            ctx.tx((tx) =>
              callback({
                ...tx,
                db: {
                  ...tx.db,
                  all: async (query) => {
                    const rows = await tx.db.all(query)
                    largestRead = Math.max(largestRead, rows.length)
                    assert.ok(
                      rows.length <= 100,
                      'purge reads must stay in bounded windows, including child ledgers',
                    )
                    return rows
                  },
                },
              }),
            ),
        } as JobContext,
        args,
      ),
  }
  const artifactsDir = await mkdtemp(join(tmpdir(), 'flow-native-delete-'))
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
      createFlowWorkspaceModule(),
    ],
    worker: { queues: { maintenance: 1 } },
    serve: {
      permissions: everyFunction,
      sessions: { anonymous: { company: 'deletion-company' } },
      openStore: async (config) => {
        if (!config.databaseUrl) return sqliteStore(config)
        const adapter = postgresAdapter(config.databaseUrl, { max: 2 })
        await adapter.open()
        return adapter
      },
    },
  })
  const failures: string[] = []
  const workerLog = (entry: { error?: string }) => {
    if (entry.error) failures.push(String(entry.error))
  }
  let app = await createTestDeployment(deployment, {
    artifactsDir,
    env,
    workerNow: () => new Date(workerTime),
    workerLog,
  })
  const ok = (value: Row) => {
    assert.equal(value.ok, true, JSON.stringify(value))
    return value
  }
  const call = async (name: string, input: Row = {}) => (await app.client.call<Row>(name, input)).value
  const read = async (table: string, column: string, value: unknown) =>
    app.fixture.withTenant('', async ({ adapter }) => {
      const rows = await adapter.all(
        `SELECT * FROM ${adapter.quoteIdent(table)} WHERE ${adapter.quoteIdent('companyId')} = ${env ? '$1' : '?'} AND ${adapter.quoteIdent(column)} = ${env ? '$2' : '?'}`,
        ['deletion-company', value],
      )
      return rows.map(
        (row): Row => ({
          ...row,
          ...(typeof row.removed === 'string' ? { removed: JSON.parse(row.removed) } : {}),
        }),
      )
    })
  const context = () => call('flow.workspace.bootstrap', { route: 'settings' })
  try {
    await app.fixture.call('partner.savePartner', {
      id: 'deletion-partner',
      kind: 'company',
      name: 'Synthetic deletion',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'deletion-company',
      partnerId: 'deletion-partner',
      currency: 'VND',
    })
    await app.fixture.call('user.saveRole', { id: 'deletion-role', name: 'Ordinary configuration' })
    for (const [name, spec] of Object.entries(native.functions))
      if (
        spec.exposure !== 'internal' &&
        !name.startsWith('project.deletion.') &&
        name !== 'project.delete'
      ) {
        await app.fixture.call('user.grantFunction', {
          id: 'deletion-' + name,
          roleId: 'deletion-role',
          fnKey: 'flow.' + name,
        })
      }
    await app.fixture.call('user.grantFunction', {
      id: 'deletion-preview',
      roleId: 'deletion-role',
      fnKey: 'flow.project.deletion.preview',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'deletion-owner',
        login: 'deletion-owner',
        name: 'Synthetic owner',
        email: 'owner@example.test',
        password: 'synthetic-deletion-password',
        defaultCompanyId: 'deletion-company',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'deletion-company-grant',
      userId: 'deletion-owner',
      companyId: 'deletion-company',
    })
    await app.fixture.call('user.assignRole', {
      id: 'deletion-owner-role',
      userId: 'deletion-owner',
      roleId: 'deletion-role',
    })
    await app.client.login({ login: 'deletion-owner', password: 'synthetic-deletion-password' })
    const workspace = ok(
      await call('flow.workspace.create', {
        title: 'Delivery',
        access: 'restricted',
        expectedRevision: 0,
        idempotencyKey: 'workspace',
      }),
    )
    const makeProject = async (code: string) =>
      ok(
        await call('flow.project.save', {
          workspaceId: workspace.id,
          title: code,
          code,
          access: 'private',
          ownerId: 'deletion-owner',
          expectedRevision: (await context()).organizationRevision,
          idempotencyKey: 'project-' + code,
        }),
      )
    const doomed = await makeProject('DEL'),
      keeper = await makeProject('KEEP')
    const statuses = (await context()).columns as Row[],
      columnId = statuses.find((s) => s.kind === 'todo')!.id
    const makeTask = async (projectId: unknown, title: string) =>
      ok(await call('flow.issue.save', { projectId, title, columnId, idempotencyKey: title }))
    const task = await makeTask(doomed.id, 'Delete this task'),
      other = await makeTask(keeper.id, 'Keep this task')
    for (const mode of ['update', 'cas', 'delete', 'commit', 'nested']) {
      ledgerAttack = mode
      const rejected = await call('flow.issue.save', {
        projectId: doomed.id,
        title: 'Rejected ' + mode,
        columnId,
        idempotencyKey: 'rejected-' + mode,
      }).catch((error) => {
        throw new Error(
          'Ledger guard ' +
            mode +
            ': ' +
            String(error) +
            '; ' +
            JSON.stringify(
              app.records.records
                .filter((r) => r.level === 'error')
                .slice(-1)
                .map((r) => r.error),
            ),
        )
      })
      assert.equal(rejected.ok, false)
      assert.equal(
        (rejected.errors as Row[])[0]!.code,
        mode === 'nested' ? 'nested_transaction' : 'immutable_ledger',
      )
    }
    ledgerAttack = ''
    ok(await call('flow.issue.comment', { id: task.id, text: 'Private content', idempotencyKey: 'comment' }))
    for (let i = 0; i < 105; i++)
      ok(
        await call('flow.issue.comment', {
          id: task.id,
          text: 'Bounded child ' + i,
          idempotencyKey: 'child-comment-' + i,
        }),
      )
    const page = ok(
      await call('flow.page.save', {
        projectId: doomed.id,
        workspaceId: workspace.id,
        title: 'Private document',
        blocks: [{ type: 'paragraph', text: 'Document content' }],
        idempotencyKey: 'page',
      }),
    )
    const upload = async (id: unknown, bytes: string) => {
      const data = new FormData()
      data.append('file', new Blob([bytes], { type: 'text/plain' }), 'private.txt')
      const response = await app.client.post('/flow/uploads?task=' + id, data)
      assert.equal(response.status, 201, await response.clone().text())
      const uploadId = ((await response.json()) as Row).uploadId
      ok(
        await call('flow.attachment.save', {
          taskId: id,
          files: [{ uploadId }],
          idempotencyKey: 'attach-' + uploadId,
        }),
      )
      return uploadId
    }
    const shared = await upload(task.id, 'shared bytes'),
      retained = await upload(other.id, 'shared bytes'),
      privateFile = await upload(task.id, 'unique private bytes')
    assert.equal((await app.client.get('/flow/files/' + shared)).status, 200)
    const privateKey = (await read('storage_attachment', 'id', privateFile))[0]!.storeKey
    const sharedKey = (await read('storage_attachment', 'id', shared))[0]!.storeKey
    assert.notEqual(
      sharedKey,
      (await read('storage_attachment', 'id', retained))[0]!.storeKey,
      'equal bytes cannot overwrite an existing upload key',
    )
    // Isolated compatibility fixture: historical/imported attachments may share
    // a physical object. Native copy intentionally does not carry files.
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        'UPDATE storage_attachment SET ' +
          adapter.quoteIdent('storeKey') +
          ' = ' +
          (env ? '$1' : '?') +
          ' WHERE ' +
          adapter.quoteIdent('companyId') +
          ' = ' +
          (env ? '$2' : '?') +
          ' AND id = ' +
          (env ? '$3' : '?'),
        [sharedKey, 'deletion-company', retained],
      )
    })
    await assert.rejects(
      app.fixture.call(
        'storage.createAttachment',
        {
          id: 'forged-key',
          name: 'Forged',
          kind: 'stored',
          storeKey: sharedKey,
          mimetype: 'text/plain',
          size: 12,
          public: false,
          createdAt: new Date().toISOString(),
        },
        { scope: { company: 'deletion-company' }, actor: 'deletion-owner' },
      ),
      /E_FLOW_ATTACHMENT_OWNER|Use the owning Flow command/,
    )
    let preview = ok(await call('flow.project.deletion.preview', { id: doomed.id }))
    const ask = {
      id: doomed.id,
      expectedVersion: preview.version,
      confirmName: preview.title,
      impactDigest: preview.impactDigest,
      idempotencyKey: 'delete-project',
    }
    const withoutAuthority = await call('flow.project.delete', ask)
    assert.equal(withoutAuthority.ok, false, 'project administrator does not inherit irreversible deletion')
    assert.equal((withoutAuthority.errors as Row[])[0]!.code, 'forbidden')
    for (const name of ['project.delete', 'project.deletion.list', 'project.deletion.retry'])
      await app.fixture.call('user.grantFunction', {
        id: 'manual-' + name,
        roleId: 'deletion-role',
        fnKey: 'flow.' + name,
      })
    assert.equal(
      (await call('flow.project.delete', { ...ask, confirmName: 'Wrong', idempotencyKey: 'wrong' })).ok,
      false,
    )
    await makeTask(doomed.id, 'Created after preview')
    let lastWindowTask: Row = {}
    for (let i = 0; i < 101; i++) lastWindowTask = await makeTask(doomed.id, 'Window task ' + i)
    assert.equal((await call('flow.project.delete', ask)).ok, false, 'stale impact cannot delete new work')
    preview = ok(await call('flow.project.deletion.preview', { id: doomed.id }))
    assert.equal((preview.impact as Row).Task, 103)
    assert.equal((preview.impact as Row).Document, 1)
    const relocation = ok(
      await call('flow.issue.relocation.preview', {
        id: lastWindowTask.id,
        targetProjectId: keeper.id,
        mode: 'transfer',
      }),
    )
    ok(
      await call('flow.issue.transfer', {
        id: lastWindowTask.id,
        targetProjectId: keeper.id,
        sourceProjectId: doomed.id,
        expectedVersion: relocation.sourceVersion,
        impactDigest: relocation.impactDigest,
        idempotencyKey: 'balanced-transfer',
      }),
    )
    await makeTask(doomed.id, 'Replacement with the same count')
    const balanced = { ...ask, impactDigest: preview.impactDigest, idempotencyKey: 'balanced-counts-preview' }
    assert.equal(
      (await call('flow.project.delete', balanced)).ok,
      false,
      'equal counts do not make a stale preview safe',
    )
    preview = ok(await call('flow.project.deletion.preview', { id: doomed.id }))
    assert.equal((preview.impact as Row).Task, 103)
    const confirmed = { ...ask, impactDigest: preview.impactDigest }
    blockPurge = true
    const deletion = ok(await call('flow.project.delete', confirmed))
    assert.deepEqual(await call('flow.project.delete', confirmed), deletion, 'pending receipt replay')
    assert.equal((await read('flow_deletion_record', 'id', deletion.id))[0]!.state, 'requested')
    assert.equal((await call('flow.issue.detail', { id: task.id })).ok, false)
    const deniedPage = await app.client.post(
      '/_ket/fn/flow.page.document.read',
      JSON.stringify({ id: page.id }),
      { headers: { 'content-type': 'application/json' } },
    )
    assert.notEqual(deniedPage.status, 200)
    assert.notEqual(
      (await app.client.get('/flow/files/' + shared)).status,
      200,
      'tombstone immediately closes blob access',
    )
    assert.equal(
      (
        await call('flow.project.restore', {
          id: doomed.id,
          expectedVersion: Number(preview.version) + 1,
          idempotencyKey: 'restore',
        })
      ).ok,
      false,
    )
    await app.drainJobs()
    assert.equal(
      (await read('flow_task', 'projectId', doomed.id)).length,
      103,
      'extension refusal rolls cleanup back',
    )
    blockPurge = false
    ok(await call('flow.project.deletion.retry', { id: deletion.id, idempotencyKey: 'retry-metadata' }))
    await app.drainJobs()
    for (const table of [
      'flow_task',
      'flow_document',
      'flow_task_history',
      'flow_flow_attachment_binding',
      'flow_project_record',
    ])
      assert.equal(
        (await read(table, table === 'flow_project_record' ? 'id' : 'projectId', doomed.id)).length,
        0,
        table + ' purged: ' + failures.join('; '),
      )
    assert.equal(
      (await read('flow_task_comment', 'taskId', (await read('flow_task', 'key', other.id))[0]!.id)).length,
      0,
    )
    assert.equal(
      (await read('storage_attachment', 'id', retained)).length,
      1,
      'other project attachment survives',
    )
    assert.equal(largestRead, 100, 'the test exercised a full window and its continuation')
    assert.equal((await read('flow_deletion_record', 'id', deletion.id))[0]!.state, 'waiting_blobs')
    assert.deepEqual(
      await call('flow.project.delete', confirmed),
      deletion,
      'completed metadata receipt replay',
    )
    ok(await call('flow.project.deletion.retry', { id: deletion.id, idempotencyKey: 'retry-recent-blob' }))
    await app.drainJobs()
    assert.equal(
      (await read('flow_deletion_record', 'id', deletion.id))[0]!.state,
      'waiting_blobs',
      'recent upload grace keeps bytes pending',
    )
    assert.ok(!removedKeys.includes(String(privateKey)))
    ageObjects = true
    failRemoval = true
    ok(await call('flow.project.deletion.retry', { id: deletion.id, idempotencyKey: 'retry-blobs-outage' }))
    await app.drainJobs()
    assert.equal(
      (await read('flow_deletion_record', 'id', deletion.id))[0]!.state,
      'waiting_blobs',
      'storage failure cannot claim done',
    )
    // Reopen the exact database/queue, then run the original scheduled blob jobs.
    await app.close()
    workerTime += 7200000
    failRemoval = false
    app = await createTestDeployment(deployment, {
      artifactsDir,
      env,
      workerNow: () => new Date(workerTime),
      workerLog,
    })
    await app.client.login({ login: 'deletion-owner', password: 'synthetic-deletion-password' })
    let concurrentFile: unknown
    duringHead = async () => {
      concurrentFile = await upload(other.id, 'unique private bytes')
    }
    // Worker clock does not control the queue's clock. Move only this test's
    // persisted scheduled blob jobs to the past instead of waiting an hour.
    await app.fixture.withTenant('', async ({ adapter }) => {
      const pending = await adapter.all(
        'SELECT id FROM ket_job WHERE job = ' +
          (env ? '$1' : '?') +
          ' AND company_id = ' +
          (env ? '$2' : '?') +
          " AND state = 'scheduled'",
        ['flow.purgeNativeBlobs', 'deletion-company'],
      )
      assert.ok(pending.length, 'scheduled jobs survive the process restart')
      for (const job of pending)
        await adapter.run(
          'UPDATE ket_job SET scheduled_at = ' + (env ? '$1' : '?') + ' WHERE id = ' + (env ? '$2' : '?'),
          [new Date(Date.now() - 1000).toISOString(), job.id],
        )
    })
    await app.drainJobs()
    assert.equal(
      (await read('flow_deletion_record', 'id', deletion.id))[0]!.state,
      'done',
      failures.join('; '),
    )
    assert.ok(removedKeys.includes(String(privateKey)), 'unreferenced bytes removed')
    assert.ok(!removedKeys.includes(String(sharedKey)), 'shared bytes retained')
    assert.ok(concurrentFile, 'upload was interleaved after the reference check')
    assert.notEqual((await read('storage_attachment', 'id', concurrentFile))[0]!.storeKey, privateKey)
    assert.equal(
      await (await app.client.get('/flow/files/' + concurrentFile)).text(),
      'unique private bytes',
      'concurrent upload survives purge',
    )
    assert.equal((await app.client.get('/flow/files/' + retained)).status, 200)
    assert.equal(await (await app.client.get('/flow/files/' + retained)).text(), 'shared bytes')
    assert.equal(((await call('flow.issue.detail', { id: other.id })).task as Row).id, other.id)
    const listing = ok(await call('flow.project.deletion.list', { limit: 1 }))
    assert.equal((listing.records as Row[]).length, 1)
    assert.equal((listing.records as Row[])[0]!.state, 'done')
    assert.deepEqual(await call('flow.project.delete', confirmed), deletion, 'restart replay remains scoped')
    // Real generic upload with a historical content-addressed key, then an
    // isolated ownership fixture representing an imported pre-native file.
    await app.fixture.call('user.grantFunction', {
      id: 'legacy-file-upload',
      roleId: 'deletion-role',
      fnKey: 'storage.createAttachment',
    })
    const legacyProject = await makeProject('LEGACY'),
      legacyTask = await makeTask(legacyProject.id, 'Legacy file owner')
    const multipart = new FormData()
    multipart.append('file', new Blob(['historical generic bytes'], { type: 'text/plain' }), 'legacy.txt')
    const uploadedLegacy = await app.client.post('/files', multipart)
    assert.equal(uploadedLegacy.status, 201, await uploadedLegacy.clone().text())
    const legacyFile = (await uploadedLegacy.json()) as Row
    const legacyTaskId = (await read('flow_task', 'key', legacyTask.id))[0]!.id
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        'UPDATE storage_attachment SET ' +
          adapter.quoteIdent('resModel') +
          ' = ' +
          (env ? '$1' : '?') +
          ', ' +
          adapter.quoteIdent('resId') +
          ' = ' +
          (env ? '$2' : '?') +
          ' WHERE id = ' +
          (env ? '$3' : '?'),
        ['flow.Task', legacyTaskId, legacyFile.id],
      )
    })
    assert.equal(
      await (await app.client.get('/flow/files/' + legacyFile.id)).text(),
      'historical generic bytes',
    )
    const legacyPreview = ok(await call('flow.project.deletion.preview', { id: legacyProject.id }))
    const legacyDeletion = ok(
      await call('flow.project.delete', {
        id: legacyProject.id,
        expectedVersion: legacyPreview.version,
        confirmName: legacyPreview.title,
        impactDigest: legacyPreview.impactDigest,
        idempotencyKey: 'legacy-delete',
      }),
    )
    await app.drainJobs()
    ok(await call('flow.project.deletion.retry', { id: legacyDeletion.id, idempotencyKey: 'legacy-bytes' }))
    await app.drainJobs()
    assert.equal((await read('flow_deletion_record', 'id', legacyDeletion.id))[0]!.state, 'retained_blobs')
    assert.equal(
      (await read('flow_deletion_blob', 'deletionId', legacyDeletion.id))[0]!.state,
      'retained_legacy',
    )
    assert.ok(
      !removedKeys.includes(String(legacyFile.storeKey)),
      'unsafe legacy key is never physically removed',
    )
    await app.fixture.call('partner.savePartner', {
      id: 'other-partner',
      kind: 'company',
      name: 'Other synthetic company',
    })
    await app.fixture.call('company.saveCompany', {
      id: 'another-company',
      partnerId: 'other-partner',
      currency: 'VND',
    })
    await app.fixture.call(
      'user.createUser',
      {
        id: 'other-owner',
        login: 'other-owner',
        name: 'Other owner',
        email: 'other@example.test',
        password: 'synthetic-deletion-password',
        defaultCompanyId: 'another-company',
      },
      { actor: null },
    )
    await app.fixture.call('user.grantCompany', {
      id: 'other-company-grant',
      userId: 'other-owner',
      companyId: 'another-company',
    })
    await app.fixture.call('user.assignRole', {
      id: 'other-role',
      userId: 'other-owner',
      roleId: 'deletion-role',
    })
    const crossCompany = app.client.anonymous()
    await crossCompany.login({ login: 'other-owner', password: 'synthetic-deletion-password' })
    ok(
      (
        await crossCompany.call<Row>('flow.workspace.create', {
          title: 'Other workspace',
          access: 'restricted',
          expectedRevision: 0,
          idempotencyKey: 'other-workspace',
        })
      ).value,
    )
    assert.notEqual(
      (
        await crossCompany.call<Row>('flow.project.deletion.retry', {
          id: deletion.id,
          idempotencyKey: 'foreign',
        })
      ).value.ok,
      true,
    )
  } finally {
    await app.close()
    await rm(artifactsDir, { recursive: true, force: true })
  }
})
