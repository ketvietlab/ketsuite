import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import type { KetModule, Row } from '@ketvietlab/ketjs'
import { defineDeployment, tableNameFor } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { createKetsuiteDeployment } from '@ketvietlab/ketsuite/deployment'
import activity from '../packages/ketsuite/src/modules/activity/index.ts'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import postgres from 'postgres'
import crm from '../packages/ketsuite/src/modules/crm/index.ts'
import { ketsuitePermissionModules } from '../packages/ketsuite/src/permission-catalogue.ts'
import { defaultImportRules } from '../packages/ketsuite/src/modules/crm/import-format.ts'

/** Producer contracts for the CRM modules composed by Cosmetic; no other domain suite runs. */
async function boot(t: TestContext) {
  const all = createKetsuiteDeployment().modules.filter(
    (module): module is KetModule => typeof module !== 'string',
  )
  const byName = new Map(all.map((module) => [module.name, module]))
  byName.set('crm', crm)
  byName.set('activity', activity)
  const selected = new Map<string, KetModule>()
  const include = (name: string) => {
    if (selected.has(name)) return
    const module = byName.get(name)
    assert.ok(module, `CRM dependency ${name} is installed`)
    selected.set(name, module)
    for (const name of module.depends ?? []) include(name)
  }
  include('crm')
  let databaseUrl: string | undefined
  if (process.env.KET_CRM_IMPORT_PG === '1') {
    const name = `crm_import_${randomUUID().replaceAll('-', '')}`
    const admin = postgres(process.env.KET_CRM_IMPORT_PG_URL || 'postgres://127.0.0.1:5435/postgres', {
      max: 1,
    })
    await admin.unsafe(`CREATE DATABASE ${name}`)
    const target = new URL(process.env.KET_CRM_IMPORT_PG_URL || 'postgres://127.0.0.1:5435/postgres')
    target.pathname = '/' + name
    databaseUrl = target.href
    t.after(async () => {
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`)
      await admin.end()
    })
  }
  const { pages: _pages, resolveAnonymousScope: _anonymous, ...serve } = createKetsuiteDeployment().serve!
  const app = await createTestDeployment(
    defineDeployment({
      name: 'cosmetic_crm_import_contract',
      companies: true,
      modules: [...selected.values()],
      permissions: {
        requireCoverage: true,
        modules: Object.fromEntries(
          [...selected.keys()].map((name) => [name, ketsuitePermissionModules[name]]),
        ),
      },
      worker: { queues: { default: 1 } },
      serve,
      ...(databaseUrl
        ? {
            serve: {
              ...serve,
              openStore: async () => {
                const adapter = postgresAdapter(databaseUrl!)
                await adapter.open()
                return adapter
              },
            },
          }
        : {}),
    }),
    { ...(databaseUrl ? { env: { DATABASE_URL: databaseUrl } } : {}) },
  )
  t.after(() => app.close())
  if (databaseUrl) assert.equal(app.adapter?.name, 'postgres')
  const scope = { company: 'acme', companies: ['acme'], branches: null }
  const call = async (
    key: string,
    input: Row = {},
    actor: string | null = 'admin',
    company = 'acme',
  ): Promise<Row> =>
    (await app.fixture.call(key, input, { actor, scope: { ...scope, company, companies: [company] } }))
      .value as Row
  await call('partner.savePartner', { id: 'company', kind: 'company', name: 'Import contract company' }, null)
  await call('company.saveCompany', { id: 'acme', partnerId: 'company', currency: 'VND' }, null)
  const passwords = Object.fromEntries(['admin', 'agent', 'other'].map((id) => [id, randomUUID()]))
  for (const id of ['admin', 'agent', 'other']) {
    await call(
      'user.createUser',
      {
        id,
        login: id,
        name: id,
        password: passwords[id],
        superuser: id === 'admin',
        defaultCompanyId: 'acme',
      },
      null,
    )
    await call('user.grantCompany', { id: `grant-${id}`, userId: id, companyId: 'acme' }, null)
  }
  await call('crm.bootstrap.defaults', { idempotencyKey: randomUUID() })
  await call('crm.team.save', {
    values: { id: 'sales', code: 'TEST-SALES', name: 'Import sales', active: true, leaderUserId: 'admin' },
    idempotencyKey: randomUUID(),
  })
  for (const userId of ['admin', 'agent'])
    await call('crm.team.member.save', {
      id: `sales-${userId}`,
      teamId: 'sales',
      userId,
      sequence: userId === 'admin' ? 1 : 2,
      idempotencyKey: randomUUID(),
    })
  const upload = async (csv: string, rules = {}) => {
    const uploaded = await call('crm.import.upload', {
      id: randomUUID(),
      filename: 'contacts.csv',
      content: Buffer.from(csv).toString('base64'),
    })
    assert.equal(uploaded.ok, true, JSON.stringify(uploaded))
    let batch = (await call('crm.import.get', { id: uploaded.id })).batch as Row
    const configured = await call('crm.import.configure', {
      id: uploaded.id,
      version: batch.version,
      review: true,
      mapping: batch.mapping,
      rules: {
        ...defaultImportRules(),
        teamId: 'sales',
        assignment: 'person',
        assigneeUserId: 'admin',
        ...rules,
      },
    })
    assert.equal(configured.ok, true, JSON.stringify(configured))
    batch = (await call('crm.import.get', { id: uploaded.id })).batch as Row
    return batch
  }
  return { app, call, upload, passwords, scope }
}

test('CRM import previews without records, then commits one durable receipt per row and replays safely', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, upload } = await boot(t)
  const batch = await upload(
    'Name,Phone,Email,Tags\nMai,0901234567,mai@example.test,Trị mụn\nMai repeat,0901234567,,Spa\nLinh,0901234568,,Spa\nBad,invalid,,',
    { tags: ['Chiến dịch A'], firstTask: true, due: 'two-hours' },
  )
  const preview = await call('crm.import.preview', { id: batch.id })
  assert.deepEqual((preview.preview as Row).counts, { created: 2, skipped: 1, error: 1 })
  assert.equal((await call('crm.case.list')).total, 0)
  assert.equal((await call('crm.tag.list')).length, 0)
  const started = await call('crm.import.start', { id: batch.id, version: batch.version })
  assert.equal(started.ok, true, JSON.stringify(started))
  await app.drainJobs()
  const completed = (await call('crm.import.get', { id: batch.id })).batch as Row
  assert.equal(completed.state, 'partial', JSON.stringify({ completed, logs: app.records }))
  assert.equal(completed.cursor, 4)
  assert.equal((await call('crm.case.list')).total, 2)
  assert.equal((await call('crm.import.rows', { id: batch.id })).total, 4)
  const rows = (await call('crm.import.rows', { id: batch.id })).rows as Row[]
  const detail = await call('crm.case.get', { id: rows[0].caseId })
  assert.equal(detail.contactConsent, false)
  assert.ok((detail.tags as Row[]).some((tag) => tag.name === 'Trị mụn'))
  assert.equal((detail.activities as Row[]).length, 1)
  assert.equal(
    Date.parse(String((detail.activities as Row[])[0].dueAt)) - Date.parse(String(completed.startedAt)),
    7_200_000,
  )
  assert.equal((await call('crm.import.performance', { id: batch.id })).total, 2)
  assert.equal((await call('crm.import.start', { id: batch.id, version: batch.version })).ok, true)
  await app.drainJobs()
  assert.equal((await call('crm.case.list')).total, 2)
  assert.equal((await call('crm.import.get', { id: batch.id }, 'other')).batch, null)
  assert.equal((await call('crm.import.get', { id: batch.id }, 'admin', 'another-company')).batch, null)
})

test('CRM import merges additively and undo preserves changed records and pre-existing tags', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, upload } = await boot(t)
  const original = await upload('Name,Phone,Tags\nMai,0901234567,Original\nLinh,0901234568,Original')
  await call('crm.import.start', { id: original.id, version: original.version })
  await app.drainJobs()
  const added = await upload('Name,Phone,Tags\nMai latest,0901234567,New tag\nAn,0901234569,New tag')
  const preview = (await call('crm.import.preview', { id: added.id })).preview as Row
  assert.deepEqual(preview.counts, { merged: 1, created: 1 })
  await call('crm.import.start', { id: added.id, version: added.version })
  await app.drainJobs()
  const rows = (await call('crm.import.rows', { id: added.id })).rows as Row[]
  const merged = await call('crm.case.get', { id: rows[0].caseId })
  assert.equal(merged.name, 'Mai')
  assert.equal(merged.assigneeUserId, 'admin')
  assert.deepEqual((merged.tags as Row[]).map((tag) => tag.name).sort(), ['New tag', 'Original'])
  const batch = (await call('crm.import.get', { id: added.id })).batch as Row
  const undo = await call('crm.import.undo', { id: added.id, version: batch.version })
  assert.equal(undo.ok, true, JSON.stringify(undo))
  assert.equal(undo.archived, 1)
  assert.deepEqual(
    ((await call('crm.case.get', { id: rows[0].caseId })).tags as Row[]).map((tag) => tag.name),
    ['Original'],
  )
  assert.equal((await call('crm.case.list')).total, 2)
  assert.equal((await call('crm.import.undo', { id: added.id, version: batch.version })).ok, true)
})

test('CRM import resumes from a committed chunk and rejects stale draft changes', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, upload } = await boot(t)
  const batch = await upload(
    'Name,Phone\n' +
      Array.from({ length: 28 }, (_, i) => `Customer ${i},09012${String(i).padStart(5, '0')}`).join('\n'),
  )
  const stale = await call('crm.import.configure', { id: batch.id, version: 1, review: true })
  assert.equal(stale.ok, false)
  await call('crm.import.start', { id: batch.id, version: batch.version })
  const stopped = await call('crm.import.stop', { id: batch.id, version: Number(batch.version) + 1 })
  assert.equal(stopped.ok, true)
  await app.drainJobs()
  assert.equal((await call('crm.case.list')).total, 0)
  const held = (await call('crm.import.get', { id: batch.id })).batch as Row
  assert.equal((await call('crm.import.resume', { id: held.id, version: held.version })).ok, true)
  await app.drainJobs()
  assert.equal(((await call('crm.import.get', { id: batch.id })).batch as Row).cursor, 28)
  assert.equal((await call('crm.case.list')).total, 28)
})

test('CRM import HTTP permissions, company isolation and queued role revocation', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, passwords, scope } = await boot(t)
  await app.client.login({ login: 'other', password: passwords.other })
  await assert.rejects(() =>
    app.client.call('crm.import.upload', {
      id: 'denied',
      filename: 'a.csv',
      content: Buffer.from('Name,Phone\nA,0901234567').toString('base64'),
    }),
  )
  await call('user.saveRole', { id: 'importer', name: 'Importer' })
  for (const fnKey of [
    'crm.import.upload',
    'crm.import.configure',
    'crm.import.get',
    'crm.import.start',
    'crm.case.save',
  ])
    await call('user.grantFunction', { id: `importer:${fnKey}`, roleId: 'importer', fnKey })
  await call('user.assignRole', { id: 'agent-importer', roleId: 'importer', userId: 'agent' })
  await app.client.login({ login: 'agent', password: passwords.agent })
  const uploaded = (
    await app.client.call<Row>('crm.import.upload', {
      id: randomUUID(),
      filename: 'a.csv',
      content: Buffer.from('Name,Phone\nA,0901234567').toString('base64'),
    })
  ).value
  assert.equal(uploaded.ok, true)
  const batch = (await call('crm.import.get', { id: uploaded.id }, 'agent')).batch as Row
  assert.equal(
    (
      await call(
        'crm.import.configure',
        {
          id: batch.id,
          version: batch.version,
          review: true,
          rules: { ...defaultImportRules(), teamId: 'sales' },
        },
        'agent',
      )
    ).ok,
    true,
  )
  assert.equal((await app.client.call<Row>('crm.import.start', { id: batch.id, version: 2 })).value.ok, true)
  const hidden = await app.fixture.call<Row>(
    'crm.import.get',
    { id: batch.id },
    { actor: 'admin', scope: { ...scope, company: 'different', companies: ['acme', 'different'] } },
  )
  assert.equal(hidden.value.batch, null)
  await call('user.unassignRole', { userId: 'agent', roleId: 'importer' })
  await app.drainJobs()
  const stopped = (await call('crm.import.get', { id: batch.id })).batch as Row
  assert.equal(stopped.state, 'stopped')
  assert.equal(stopped.stoppedReason, 'permission')
  assert.equal((await call('crm.case.list')).total, 0)
})

test('CRM tags preserve archive history, normalize names, merge, and repeat bulk edits safely', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, upload } = await boot(t)
  const batch = await upload('Name,Phone,Tags\nMai,0901234567,Spa\nLinh,0901234568,Spa', {
    assignment: 'team',
  })
  const preview = (await call('crm.import.preview', { id: batch.id })).preview as Row
  assert.deepEqual(preview.distribution, { admin: 1, agent: 1 })
  await call('crm.import.start', { id: batch.id, version: batch.version })
  await app.drainJobs()
  const receipts = (await call('crm.import.rows', { id: batch.id })).rows as Row[]
  assert.deepEqual(
    receipts.map((row) => row.assigneeUserId),
    ['admin', 'agent'],
  )
  const tags = (await call('crm.tag.list')) as unknown as Row[],
    spa = tags.find((tag) => tag.name === 'Spa')!
  assert.equal((await call('crm.tag.save', { id: 'same', name: ' SPÁ  ' })).ok, false)
  assert.equal((await call('crm.tag.save', { id: 'extra', name: 'VIP' })).ok, true)
  const input = { ids: [receipts[0].caseId], tagIds: ['extra'], operation: 'add' }
  assert.deepEqual((await call('crm.case.tags', input)).changed, [receipts[0].caseId])
  const version = (await call('crm.case.get', { id: receipts[0].caseId })).version
  assert.deepEqual((await call('crm.case.tags', input)).changed, [])
  assert.equal((await call('crm.case.get', { id: receipts[0].caseId })).version, version)
  assert.equal((await call('crm.case.tagged', { tagId: 'extra' })).total, 1)
  assert.equal((await call('crm.tag.archive', { id: 'extra' })).ok, true)
  assert.ok(
    ((await call('crm.case.get', { id: receipts[0].caseId })).tags as Row[]).some(
      (tag) => tag.id === 'extra',
    ),
  )
  assert.equal((await call('crm.tag.save', { id: 'target', name: 'Beauty' })).ok, true)
  assert.equal((await call('crm.tag.merge', { sourceId: spa.id, targetId: 'target' })).ok, true)
  assert.equal((await call('crm.case.tagged', { tagId: 'target' })).total, 2)
  const held = (await call('crm.import.get', { id: batch.id })).batch as Row
  const undo = await call('crm.import.undo', { id: held.id, version: held.version })
  assert.equal(undo.kept, 1)
  assert.equal(undo.archived, 1)
  assert.equal((await call('crm.case.list')).total, 1)
})

test('CRM import preview exports errors before writing and preserves rescheduled first contact on undo', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, upload } = await boot(t)
  const batch = await upload('Name,Phone\nA,0901234567\nBad,invalid', { firstTask: true, due: 'two-hours' })
  const csv = await call('crm.import.export', { id: batch.id, errorsOnly: true })
  assert.match(String(csv.content), /Bad/)
  assert.doesNotMatch(String(csv.content), /0901234567/)
  await call('crm.import.start', { id: batch.id, version: batch.version })
  await app.drainJobs()
  const receipt = ((await call('crm.import.rows', { id: batch.id })).rows as Row[])[0]
  await call('activity.reschedule', { id: receipt.activityId, dueDate: '2026-12-01' })
  const held = (await call('crm.import.get', { id: batch.id })).batch as Row
  const undo = await call('crm.import.undo', { id: held.id, version: held.version })
  assert.equal(undo.kept, 1)
  assert.equal(undo.archived, 0)
})

test('CRM import rolls back every record when the second receipt fails mid-chunk', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, upload } = await boot(t)
  const batch = await upload('Name,Phone\nMai,0901234567\nLinh,0901234568')
  const adapter = app.adapter!,
    table = tableNameFor('crm.ImportRow')
  const columns =
    adapter.name === 'postgres'
      ? await adapter.all(
          'select column_name as name from information_schema.columns where table_name = $1',
          [table],
        )
      : await adapter.all(`PRAGMA table_info("${table}")`)
  const column = String(
    columns.find((row) => String(row.name).replaceAll('_', '').toLowerCase() === 'rownumber')!.name,
  )
  if (adapter.name === 'postgres')
    await adapter.exec(`ALTER TABLE "${table}" ADD CONSTRAINT import_fault CHECK ("${column}" <> 2)`)
  else
    await adapter.exec(
      `CREATE TRIGGER import_fault BEFORE INSERT ON "${table}" WHEN NEW."${column}" = 2 BEGIN SELECT RAISE(ABORT, 'synthetic import failure'); END`,
    )
  await call('crm.import.start', { id: batch.id, version: batch.version })
  await app.drainJobs()
  assert.equal((await call('crm.case.list')).total, 0, 'no partial first row may survive')
  assert.equal((await call('crm.import.rows', { id: batch.id })).total, 0, 'receipt and case commit together')
  assert.equal(((await call('crm.import.get', { id: batch.id })).batch as Row).cursor, 0)
})

test('CRM tag edits serialize normalized names, enforce cumulative limits, and clamp collection pages', {
  timeout: 60_000,
}, async (t) => {
  const { app, call, upload } = await boot(t)
  const batch = await upload('Name,Phone,Tags\nMai,0901234567,Spa')
  await call('crm.import.start', { id: batch.id, version: batch.version })
  await app.drainJobs()
  await Promise.allSettled([
    call('crm.tag.save', { id: 'normalized-one', name: 'Chăm sóc' }),
    call('crm.tag.save', { id: 'normalized-two', name: ' cham soc ' }),
  ])
  const similar = await call('crm.tag.catalogue', { search: 'cham soc' })
  assert.equal(similar.total, 1, 'concurrent spelling variants have one canonical tag')
  assert.ok(app.adapter)
  const caseTable = tableNameFor('crm.Case')
  const columns =
    app.adapter.name === 'postgres'
      ? await app.adapter.all(
          'select column_name as name from information_schema.columns where table_name = $1',
          [caseTable],
        )
      : await app.adapter.all(`PRAGMA table_info("${caseTable}")`)
  const createdColumn = String(
    columns.find((row) => String(row.name).replaceAll('_', '').toLowerCase() === 'createdat')!.name,
  )
  await app.adapter.exec(`UPDATE "${caseTable}" SET "${createdColumn}" = '2020-01-01T00:00:00.000Z'`)
  const names = Array.from({ length: 10 }, (_, i) => `Campaign ${i}`)
  for (const [i, name] of names.entries()) await call('crm.tag.save', { id: `campaign-${i}`, name })
  assert.equal(
    (await call('crm.import.tag', { id: batch.id, names })).ok,
    false,
    'existing row tag counts toward the limit',
  )
  assert.equal(
    (await call('crm.case.tagged', { tagId: 'campaign-0' })).total,
    0,
    'failed tag update writes nothing',
  )
  assert.equal((await call('crm.import.tag', { id: batch.id, names: names.slice(0, 9) })).ok, true)
  assert.equal(
    (await call('crm.import.tag', { id: batch.id, names: [names[9]] })).ok,
    false,
    'later additions cannot bypass the limit',
  )
  const recentlyUsed = (await call('crm.tag.catalogue', { search: names[0] })).rows as Row[]
  assert.ok(
    Date.parse(String(recentlyUsed[0].lastUsedAt)) > Date.now() - 60_000,
    'tagging an old case counts as recent use of the tag',
  )
  for (const [fn, input] of [
    ['crm.import.list', { offset: 10000 }],
    ['crm.tag.catalogue', { offset: 10000 }],
    ['crm.case.tagged', { cursor: '10000' }],
  ] as const) {
    const result = await call(fn, input)
    assert.equal(result.offset, 0)
    assert.ok((result.rows as Row[]).length > 0, `${fn} returns the final existing page`)
  }
})
