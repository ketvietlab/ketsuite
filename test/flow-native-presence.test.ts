import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineDeployment, defineFn, migrateOne, planMigration, schemaFromManifest } from '@ketvietlab/ketjs'
import type { JobContext } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, livedoc, mail, partner, user, userBackend } from '@ketvietlab/ketsuite'
import backend from '../packages/ketsuite/src/modules/backend/index.ts'
import { createFlowModule } from '../packages/ketsuite/src/modules/flow/native/index.ts'
import { createFlowStorageModule } from '../packages/ketsuite/src/modules/flow/native/attachments.ts'
import { expireDocumentPresence } from '../packages/ketsuite/src/modules/flow/native/presence.ts'

test('presence schema is additive and rerunnable; expiry fences Company and renewed leases', async () => {
  const native = createFlowModule()
  const artifactsDir = await mkdtemp(join(tmpdir(), 'flow-presence-schema-'))
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
        {
          ...native,
          functions: {
            ...native.functions,
            testExpirePresence: defineFn({
              exposure: 'internal',
              input: { id: 'id' },
              effects: expireDocumentPresence.effects,
              handler: (ctx, args) => expireDocumentPresence.handler(ctx as JobContext, args),
            }),
          },
        },
      ],
    }),
    { worker: false, artifactsDir },
  )
  try {
    await app.fixture.withTenant('', async ({ adapter, manifest }) => {
      const current = schemaFromManifest(manifest),
        previous = structuredClone(current)
      delete previous.tables.flow_document_presence
      const upgrade = planMigration(previous, current)
      assert.ok(upgrade.some((op) => op.op === 'CREATE_TABLE' && op.table === 'flow_document_presence'))
      assert.ok(upgrade.every((op) => !op.destructive && op.table === 'flow_document_presence'))
      assert.deepEqual(await migrateOne(adapter, manifest), [], 'schema rerun is a no-op')
      const expired = '2000-01-01T00:00:00.000Z',
        future = '2099-01-01T00:00:00.000Z'
      for (const [id, companyId, expiresAt] of [
        ['old', 'one', expired],
        ['renewed', 'one', future],
        ['foreign', 'two', expired],
      ])
        await adapter.run(
          'INSERT INTO flow_document_presence (id,"companyId","ownerKind","ownerId","actorId","index","expiresAt",version) VALUES (?,?,?,?,?,?,?,?)',
          [id, companyId, 'page', 'doc', 'viewer', 0, expiresAt, 2],
        )
    })
    for (const id of ['renewed', 'foreign', 'old', 'old'])
      await app.fixture.call(
        'flow.testExpirePresence',
        { id },
        { actor: null, scope: { company: 'one', companies: ['one'], branches: null } },
      )
    await app.fixture.withTenant('', async ({ adapter, manifest }) => {
      const held = await adapter.all('SELECT id FROM flow_document_presence ORDER BY id')
      assert.deepEqual(
        Array.from(held, (row) => row.id),
        ['foreign', 'renewed'],
      )
      assert.deepEqual(await migrateOne(adapter, manifest), [])
      assert.equal((await adapter.all('SELECT id FROM flow_document_presence')).length, 2)
    })
    await assert.rejects(
      app.fixture.call(
        'flow.testExpirePresence',
        { id: 'foreign' },
        { actor: null, scope: { company: null, companies: [], branches: null } },
      ),
      /Company scope/,
    )
  } finally {
    await app.close()
    await rm(artifactsDir, { recursive: true, force: true })
  }
})
