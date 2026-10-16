import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { tableNameFor } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const form = { 'content-type': 'application/x-www-form-urlencoded' }
const post = { headers: form, redirect: 'manual' as const }

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite)
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', {
    id: 'customer',
    kind: 'person',
    name: 'Nguyễn Minh',
    email: 'minh@example.test',
  })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'customer',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await app.client.call<T>(name, input)).value
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-defaults' })
  return { app, call, fixture }
}

test('crm: a case that reaches a terminal state records when it closed', async (t) => {
  const { call } = await boot(t)
  await call('crm.case.save', {
    id: 'closing',
    kind: 'opportunity',
    name: 'Closing opportunity',
    partnerId: 'customer',
    idempotencyKey: 'save-closing-01',
  })
  let row = await call<Row>('crm.case.get', { id: 'closing' })
  assert.equal(row.closedAt, null)

  const won = await call<Row>('crm.case.markWon', {
    id: 'closing',
    expectedVersion: row.version,
    idempotencyKey: 'won-closing-01',
  })
  assert.equal(won.ok, true)
  row = await call<Row>('crm.case.get', { id: 'closing' })
  assert.equal(row.terminalState, 'won')
  assert.ok(row.closedAt, 'a won case carries a closing date')

  // Pulling it back into the pipeline clears the date again.
  const reopened = await call<Row>('crm.case.move', {
    id: 'closing',
    stageId: 'crm-stage-qualified',
    expectedVersion: row.version,
    idempotencyKey: 'reopen-closing-1',
  })
  assert.equal(reopened.ok, true)
  assert.equal((await call<Row>('crm.case.get', { id: 'closing' })).closedAt, null)
})

test('crm: duplicate detection reaches past the list page size', async (t) => {
  const { call } = await boot(t)
  for (let index = 0; index < 210; index += 1)
    await call('crm.case.save', {
      id: `bulk-${index}`,
      kind: 'lead',
      name: `Bulk ${index}`,
      email: 'dupe@example.test',
      idempotencyKey: `bulk-key-${index}-aaaa`,
    })
  const found = await call<Row>('crm.case.detectDuplicates', { email: 'dupe@example.test', limit: 100 })
  const rows = found.rows as Row[]
  assert.equal(rows.length, 100, 'the caller-supplied limit is honoured, not silently capped at 200 rows')
  assert.ok(rows.every((row) => row.email === 'dupe@example.test'))

  // The same number written with different spacing is one number. A different
  // country-code form is not: normalising `+84…` to `0…` is a dialling-plan
  // question this module has no business answering.
  await call('crm.case.save', {
    id: 'phone-a',
    kind: 'lead',
    name: 'Phone A',
    phone: '090 123 4567',
    idempotencyKey: 'phone-key-aaaa1',
  })
  const byPhone = (await call<Row>('crm.case.detectDuplicates', { phone: '0901234567' })).rows as Row[]
  assert.equal(
    byPhone.some((row) => row.id === 'phone-a'),
    true,
  )
})

test('crm: merging carries the whole record and refuses a second pass', async (t) => {
  const { call } = await boot(t)
  await call('crm.tag.save', { id: 'tag-hot', name: 'Hot' })
  for (const id of ['merge-target', 'merge-source'])
    await call('crm.case.save', {
      id,
      kind: 'lead',
      name: `Record ${id}`,
      email: 'same@example.test',
      idempotencyKey: `save-${id}-01`,
    })
  await call('crm.case.save', {
    id: 'merge-source',
    kind: 'lead',
    name: 'Record merge-source',
    email: 'same@example.test',
    tagIds: ['tag-hot'],
    idempotencyKey: 'save-merge-source-02',
  })
  await call('crm.case.addMessage', {
    id: 'note-1',
    caseId: 'merge-source',
    body: 'Called them back',
    visibility: 'internal',
    idempotencyKey: 'note-key-000001',
  })
  const target = await call<Row>('crm.case.get', { id: 'merge-target' })
  const merged = await call<Row>('crm.case.merge', {
    targetId: 'merge-target',
    sourceId: 'merge-source',
    expectedTargetVersion: target.version,
    idempotencyKey: 'merge-key-00001',
  })
  assert.equal(merged.ok, true)

  const after = await call<Row>('crm.case.get', { id: 'merge-target' })
  assert.equal((after.messages as Row[]).length, 1, 'notes move with the record')
  assert.equal((after.tags as Row[]).length, 1, 'tags move with the record')
  assert.equal(
    (after.timeline as Row[]).some((entry) => entry.eventType === 'merged'),
    true,
  )
  // The source's own history came across rather than staying on an archived row.
  assert.equal((after.timeline as Row[]).filter((entry) => entry.eventType === 'created').length, 2)
  const again = await call<Row>('crm.case.merge', {
    targetId: 'merge-target',
    sourceId: 'merge-source',
    expectedTargetVersion: after.version,
    idempotencyKey: 'merge-key-00002',
  })
  assert.equal(again.ok, false)
  assert.equal((again.errors as Row[])[0]?.code, 'crm.error.alreadyMerged')
})

test('crm backend: the timeline reads as words, not as message keys', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'readable',
    kind: 'lead',
    name: 'Readable record',
    partnerId: 'customer',
    idempotencyKey: 'save-readable-1',
  })
  assert.equal((await app.client.get('/admin/crm/cases/readable?lang=en')).status, 200)
  const read = await app.client.post(
    '/admin/crm/sales/read',
    JSON.stringify({ query: 'screen=lead-detail&id=readable&lang=en' }),
    { headers: { 'content-type': 'application/json' } },
  )
  const history = JSON.stringify(((await read.json()) as { value: Row }).value)
  // Its creation reads as an action the screen names in words, not as a message key.
  assert.match(history, /"create"/)
  assert.doesNotMatch(history, /crm\.timeline\./)
})

test('crm: configuration modal contexts carry defaults, choices and permissions', async (t) => {
  const { call } = await boot(t)
  const creating = await call<Row>('crm.team.modalContext', {})
  const created = creating.data as Row
  const messages = creating.messages as Record<string, string>
  assert.equal((created.record as Row).assignmentMode, 'manual')
  assert.deepEqual(created.members, [])
  assert.deepEqual(created.permissions, { save: true, members: true })
  assert.equal(messages['recordModal.close'], 'Đóng')
  assert.equal(messages['crm_backend.field.configName'], 'Tên')
  assert.equal(messages['crm.error.duplicateMember'], 'Người này đã là thành viên của đội.')
  const english = await call<Row>('crm.tag.modalContext', { locale: 'en' })
  assert.equal((english.messages as Record<string, string>)['recordModal.close'], 'Close')
  assert.deepEqual((english.data as Row).permissions, { save: true, archive: true })

  // Archived teams are not offered in pickers.
  const retired = await call<Row>('crm.team.save', {
    values: { id: 'team-old', name: 'Old team', code: 'old', active: false },
    idempotencyKey: 'team-old-000001',
  })
  assert.equal(retired.ok, true)
  const stage = (await call<Row>('crm.stage.modalContext', {})).data as Row
  const teamIds = (stage.teams as Row[]).map((row) => row.id)
  assert.ok(teamIds.includes('crm-team-sales'))
  assert.ok(!teamIds.includes('team-old'))
  assert.deepEqual((stage.record as Row).allowedKinds, ['lead', 'opportunity'])

  // Assignees are the chosen team's active members and leader.
  await call('crm.team.member.save', {
    id: 'member-admin',
    teamId: 'crm-team-sales',
    userId: 'admin',
    idempotencyKey: 'member-admin-0001',
  })
  const rule = (await call<Row>('crm.assignmentRule.modalContext', {})).data as Row
  const assignees = rule.assignees as Record<string, Row[]>
  assert.deepEqual(
    assignees['crm-team-sales']!.map((row) => row.id),
    ['admin'],
  )
  assert.equal('team-old' in assignees, false)

  const score = (await call<Row>('crm.scoreRule.modalContext', {})).data as Row
  assert.deepEqual((score.operators as Record<string, string[]>).expectedRevenue, ['gte', 'eq'])

  const existing = (await call<Row>('crm.team.modalContext', { id: 'crm-team-sales' })).data as Row
  assert.deepEqual(
    (existing.members as Row[]).map((row) => row.userName),
    ['Administrator'],
  )
  assert.equal(await call('crm.tag.modalContext', { id: 'missing-tag' }), null)
})

test('crm: configuration saves are validated on the server', async (t) => {
  const { call } = await boot(t)
  const refusal = async (name: string, input: Record<string, unknown>) => {
    const result = await call<Row>(name, input)
    assert.equal(result.ok, false, `${name} ${JSON.stringify(input)}`)
    const [first] = result.errors as Row[]
    return [first!.field, first!.code]
  }
  const config = await call<Record<string, Row[]>>('crm.configuration.get')
  const seededTeam = config.teams.find((row) => row.id === 'crm-team-sales')!
  const seededStage = config.stages[0]!

  assert.deepEqual(
    await refusal('crm.team.save', {
      values: { id: 'team-a', name: ' ', code: 'a' },
      idempotencyKey: 'team-a-0000001',
    }),
    ['name', 'crm.error.required'],
  )
  assert.deepEqual(
    await refusal('crm.team.save', {
      values: { id: 'team-a', name: 'A', code: '' },
      idempotencyKey: 'team-a-0000002',
    }),
    ['code', 'crm.error.required'],
  )
  assert.deepEqual(
    await refusal('crm.team.save', {
      values: { id: 'team-a', name: 'A', code: seededTeam.code },
      idempotencyKey: 'team-a-0000003',
    }),
    ['code', 'crm.error.duplicateCode'],
  )
  assert.deepEqual(
    await refusal('crm.stage.save', {
      values: { id: 'stage-a', name: 'A', code: seededStage.code, allowedKinds: ['lead'] },
      idempotencyKey: 'stage-a-000001',
    }),
    ['code', 'crm.error.duplicateCode'],
  )
  assert.deepEqual(
    await refusal('crm.scoreRule.save', {
      values: { id: 'score-a', name: 'A', field: 'email', operator: 'gte', value: 'x' },
      idempotencyKey: 'score-a-000001',
    }),
    ['operator', 'crm.error.invalidOperator'],
  )

  const member = { teamId: 'crm-team-sales', userId: 'admin', capacity: 5 }
  const added = await call<Row>('crm.team.member.save', {
    ...member,
    id: 'member-1',
    idempotencyKey: 'member-1-000001',
  })
  assert.equal(added.ok, true)
  assert.deepEqual(
    await refusal('crm.team.member.save', { ...member, id: 'member-2', idempotencyKey: 'member-2-000001' }),
    ['userId', 'crm.error.duplicateMember'],
  )
  const edited = await call<Row>('crm.team.member.save', {
    ...member,
    id: 'member-1',
    capacity: 7,
    idempotencyKey: 'member-1-000002',
  })
  assert.equal(edited.ok, true, 'the same membership can still be edited')

  // Round-robin routing depends on the members configured in the team.
  await call<Row>('crm.case.save', {
    id: 'routed',
    kind: 'lead',
    name: 'Routed record',
    idempotencyKey: 'save-routed-001',
  })
  const assigned = await call<Row>('crm.case.assign', {
    id: 'routed',
    teamId: 'crm-team-sales',
    idempotencyKey: 'assign-routed-01',
  })
  assert.equal(assigned.assigneeUserId, 'admin')

  // A tag keeps its colour and archives through `crm.tag.archive`.
  assert.equal((await call<Row>('crm.tag.save', { id: 'tag-vip', name: 'VIP', color: '#ff0000' })).ok, true)
  assert.equal((await call<Row>('crm.tag.archive', { id: 'tag-vip' })).ok, true)
  const tag = (await call<Row[]>('crm.tag.list', { includeArchived: true })).find(
    (row) => row.id === 'tag-vip',
  )!
  assert.equal(tag.active, false)
  assert.equal(tag.color, '#ff0000')
})

test('crm backend: the leaderboard is reachable and refreshes', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'scored',
    kind: 'opportunity',
    name: 'Scored opportunity',
    partnerId: 'customer',
    assigneeUserId: 'admin',
    idempotencyKey: 'save-scored-001',
  })
  const refreshed = await app.client.post(
    '/admin/crm/leaderboard?lang=en',
    new URLSearchParams({ action: 'refresh' }),
    post,
  )
  assert.equal(refreshed.status, 303)
  const page = await app.client.get('/admin/crm/leaderboard?lang=en')
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /Leaderboard/)
  assert.match(html, /Administrator/)
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-col="rank"/)
  assert.match(html, /data-col="points"/)
  assert.match(html, /href="\/admin\/users\/admin\?lang=en"/)
  assert.match(html, /action="\/admin\/crm\/leaderboard\?lang=en"/)
  assert.match(html, /name="action" value="refresh"/)
})

test('crm: a case kind another module owns stays out of the CRM screens', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'crm-lead',
    kind: 'lead',
    name: 'A CRM lead',
    email: 'shared@example.test',
    idempotencyKey: 'save-crm-lead-1',
  })
  /**
   * `crm.Case` is a shared header: a module built on the CRM may store its own
   * `kind` there, the way the private customer-care module stores tickets. That
   * row used to appear in the CRM list under a raw kind, open a detail screen
   * whose save refused it, and be offered as a merge candidate.
   */
  await app.fixture.withTenant('', async ({ adapter }) => {
    const columns = [
      'companyId',
      'id',
      'kind',
      'name',
      'email',
      'stageId',
      'priority',
      'terminalState',
      'active',
      'version',
      'score',
      'threadId',
      'createdAt',
      'updatedAt',
    ]
    await adapter.run(
      `INSERT INTO ${adapter.quoteIdent(tableNameFor('crm.Case'))} (${columns
        .map((name) => adapter.quoteIdent(name))
        .join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      [
        'acme',
        'foreign-ticket',
        'ticket',
        'A support ticket',
        'shared@example.test',
        'crm-stage-new',
        '1',
        'open',
        1,
        1,
        '0',
        'thread:crm.Case:crm-lead',
        '2026-08-22T00:00:00.000Z',
        '2026-08-22T00:00:00.000Z',
      ],
    )
  })

  const listed = await call<Row>('crm.case.list', { limit: 50 })
  assert.equal(
    (listed.rows as Row[]).some((row) => row.id === 'foreign-ticket'),
    false,
    'the CRM list shows only the kinds the CRM owns',
  )
  assert.equal((await call<Row>('crm.case.count', {})).count, 1)
  assert.equal(await call<Row | null>('crm.case.get', { id: 'foreign-ticket' }), null)

  const page = await app.client.get('/admin/crm/cases/foreign-ticket?lang=en')
  assert.equal(page.status, 404, 'and its detail screen does not claim the record')

  // A duplicate hunt on the shared email must not offer to merge the two.
  const duplicates = await call<Row>('crm.case.detectDuplicates', { email: 'shared@example.test' })
  assert.equal(
    (duplicates.rows as Row[]).some((row) => row.id === 'foreign-ticket'),
    false,
  )
  // The owning module still reaches its own row through its own query.
  await app.fixture.withTenant('', async ({ adapter }) => {
    const found = await adapter.all(
      `SELECT id FROM ${adapter.quoteIdent(tableNameFor('crm.Case'))} WHERE kind = ?`,
      ['ticket'],
    )
    assert.equal(found.length, 1)
  })
})

test('crm: a second company in the tenant gets its own pipeline', async (t) => {
  const { app, call } = await boot(t)
  const inSecond = async <T = Row>(name: string, input: Record<string, unknown>): Promise<T> =>
    (await app.fixture.call<T>(name, input, { scope: { company: 'second', branches: null } })).value
  await inSecond('partner.savePartner', { id: 'second-party', kind: 'company', name: 'Second' })
  await inSecond('company.saveCompany', {
    id: 'second',
    code: 'SECOND',
    partnerId: 'second-party',
    currency: 'VND',
  })
  /**
   * The seed ids are the primary key across the whole tenant, so the second
   * company's `crm-stage-new` used to collide with the first one's and be
   * dropped by `ON CONFLICT DO NOTHING` — leaving that company with no stages
   * at all and every case refused for having nowhere to sit.
   */
  assert.equal((await inSecond<Row[]>('crm.stage.list', {})).length, 0)

  // The first write in a company seeds it, which is the path a second tenant
  // company actually takes.
  const created = await inSecond('crm_website.website.submitLead', {
    name: 'Second company lead',
    email: 'second@example.test',
    idempotencyKey: 'second-lead-0001',
  })
  assert.equal(created.ok, true, JSON.stringify(created))
  const stages = await inSecond<Row[]>('crm.stage.list', {})
  assert.ok(stages.length >= 5, 'the second company has a pipeline of its own')
  const cases = await inSecond<{ rows: Row[] }>('crm.case.list', { limit: 10 })
  assert.equal(cases.rows.length, 1)

  // And the first company still uses the ids it was installed with.
  const first = await call<Row[]>('crm.stage.list', {})
  assert.equal(
    first.some((stage) => stage.id === 'crm-stage-new'),
    true,
  )
  assert.equal(
    stages.every((stage) => String(stage.id).startsWith('second:')),
    true,
    'the second company holds its own rows rather than pointing at the first one',
  )
})

test('crm website: the public form cannot address an existing record', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'private-lead',
    kind: 'lead',
    name: 'Private lead',
    email: 'vip@example.test',
    assigneeUserId: 'admin',
    description: 'Confidential notes',
    idempotencyKey: 'save-private-01',
  })
  const anon = app.client.anonymous()
  // The id is no longer an input at all, so the overwrite has no way in.
  await assert.rejects(
    anon.call('crm_website.website.submitLead', {
      id: 'private-lead',
      name: 'pwned',
      email: 'attacker@example.test',
      idempotencyKey: 'attacker-key-01',
    }),
    /unknown input "id"/,
  )
  const posted = await anon.post(
    '/contact/sales?lang=en',
    new URLSearchParams({ id: 'private-lead', name: 'pwned', email: 'attacker@example.test' }),
    post,
  )
  assert.ok(posted.status === 303 || posted.status === 200)
  const untouched = await call<Row>('crm.case.get', { id: 'private-lead' })
  assert.equal(untouched.name, 'Private lead')
  assert.equal(untouched.assigneeUserId, 'admin')
  assert.equal(untouched.version, 1)
})

test('crm website: a submission lands, replays and is throttled', async (t) => {
  const { app } = await boot(t)
  // The anonymous scope names a company, and the write is pinned to it: the
  // company has to exist or every lead is discarded.
  const inDefault = async <T = Row>(name: string, input: Record<string, unknown>): Promise<T> =>
    (await app.fixture.call<T>(name, input, { scope: { company: 'default', branches: null } })).value
  await inDefault('partner.savePartner', { id: 'default-party', kind: 'company', name: 'Default' })
  const anon = app.client.anonymous()
  const submit = async (input: Record<string, unknown>) =>
    (await anon.call<Row>('crm_website.website.submitLead', input)).value
  const failed = await submit({
    name: 'Before the company exists',
    email: 'early@example.test',
    idempotencyKey: 'early-key-00001',
  })
  assert.equal(failed.ok, false)
  assert.equal(
    (failed.errors as Row[])[0]?.code,
    'crm_website.error.inboxUnavailable',
    'an unconfigured inbox says so instead of failing on an empty stage table',
  )

  await inDefault('company.saveCompany', {
    id: 'default',
    code: 'DEF',
    partnerId: 'default-party',
    currency: 'VND',
  })
  const first = await submit({
    name: 'Visitor lead',
    email: 'visitor@example.test',
    idempotencyKey: 'visitor-key-0001',
  })
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.match(String(first.caseId), /^website-lead:/)

  const replay = await submit({
    name: 'Visitor lead again',
    email: 'visitor@example.test',
    idempotencyKey: 'visitor-key-0001',
  })
  assert.equal(replay.replayed, true)
  assert.equal(replay.caseId, first.caseId)

  // Five submissions per address per hour; the sixth is refused.
  const attempts: Row[] = []
  for (let index = 0; index < 8; index += 1)
    attempts.push(
      await submit({
        name: `Repeat ${index}`,
        email: 'visitor@example.test',
        idempotencyKey: `repeat-key-${index}-aa`,
      }),
    )
  assert.equal(
    attempts.some(
      (result) => (result.errors as Row[] | undefined)?.[0]?.code === 'crm_website.error.rateLimit',
    ),
    true,
  )
})

test('crm website: a filled honeypot writes nothing', async (t) => {
  const { app } = await boot(t)
  const inDefault = async <T = Row>(name: string, input: Record<string, unknown>): Promise<T> =>
    (await app.fixture.call<T>(name, input, { scope: { company: 'default', branches: null } })).value
  await inDefault('partner.savePartner', { id: 'default-party', kind: 'company', name: 'Default' })
  await inDefault('company.saveCompany', {
    id: 'default',
    code: 'DEF',
    partnerId: 'default-party',
    currency: 'VND',
  })
  const anon = app.client.anonymous()
  const trapped = await anon.post(
    '/contact/sales?lang=en',
    new URLSearchParams({ name: 'Bot', email: 'bot@example.test', website: 'http://spam.test' }),
    post,
  )
  assert.equal(trapped.status, 303, 'a script sees the same answer a person would')
  const cases = await inDefault<{ rows: Row[] }>('crm.case.list', { limit: 10 })
  assert.equal(cases.rows.length, 0, 'the trapped submission wrote nothing')

  // The same form without the trap filled does land, so the honeypot is not
  // simply refusing everything.
  const real = await anon.post(
    '/contact/sales?lang=en',
    new URLSearchParams({ name: 'Person', email: 'person@example.test' }),
    post,
  )
  assert.equal(real.status, 303)
  const after = await inDefault<{ rows: Row[] }>('crm.case.list', { limit: 10 })
  assert.equal(after.rows.length, 1)
})

test('crm pipeline: the header counts the board it is standing over, not the whole board', async (t) => {
  const { call } = await boot(t)
  const save = (id: string, name: string, revenue: string, probability: string) =>
    call('crm.case.save', {
      id,
      kind: 'opportunity',
      name,
      partnerId: 'customer',
      stageId: 'crm-stage-qualified',
      expectedRevenue: revenue,
      probability,
      idempotencyKey: `pipeline-${id}`.padEnd(16, '0'),
    })
  await save('open-one', 'Open one', '100', '25')
  await save('open-two', 'Open two', '200', '50')
  await save('closing-deal', 'Closing deal', '400', '100')

  const before = await call<Row>('crm.pipeline.summary', {})
  assert.equal(before.openCount, 3)
  assert.equal(Number(before.expectedRevenue), 700)
  // 100×25% + 200×50% + 400×100% — a probability is a percentage, not a factor.
  assert.equal(Number(before.weightedRevenue), 525)

  const held = await call<Row>('crm.case.get', { id: 'closing-deal' })
  const won = await call<Row>('crm.case.markWon', {
    id: 'closing-deal',
    expectedVersion: held.version,
    idempotencyKey: 'pipeline-won-0001',
  })
  assert.equal(won.ok, true)

  // Winning a deal takes it out of the header and leaves it in its column: a
  // pipeline total that climbs every time something closes measures nothing.
  const after = await call<Row>('crm.pipeline.summary', {})
  assert.equal(after.openCount, 2)
  assert.equal(Number(after.expectedRevenue), 300)
  assert.equal(Number(after.weightedRevenue), 125)
  const wonColumn = (after.stages as Row[]).find((stage) => String(stage.id).endsWith('crm-stage-won'))
  assert.equal(Number(wonColumn?.count), 1, 'the Won column still states its own count')
  assert.equal(Number(wonColumn?.expectedRevenue), 400)

  // And the filters the board runs are the filters the header runs.
  assert.equal((await call<Row>('crm.pipeline.summary', { search: 'Open one' })).openCount, 1)
  assert.equal((await call<Row>('crm.pipeline.summary', { mine: true })).openCount, 0)
})

test('crm: a pipeline card carries its tags and the next thing owed on it', async (t) => {
  const { call } = await boot(t)
  await call('crm.tag.save', { id: 'tag-gift', name: 'Gift' })
  await call('crm.case.save', {
    id: 'carded',
    kind: 'opportunity',
    name: 'Carded opportunity',
    partnerId: 'customer',
    tagIds: ['tag-gift'],
    expectedRevenue: '90',
    probability: '40',
    idempotencyKey: 'carded-00000001',
  })
  await call('crm.activity.schedule', {
    id: 'carded-call',
    caseId: 'carded',
    summary: 'Call the buyer back',
    dueDate: '2020-01-01',
    idempotencyKey: 'carded-activity-1',
  })
  const listed = await call<{ rows: Row[] }>('crm.case.list', { search: 'Carded' })
  const row = listed.rows[0]!
  assert.deepEqual(
    (row.tags as Row[]).map((tag) => tag.name),
    ['Gift'],
  )
  const activity = row.nextActivity as Row
  assert.equal(activity.summary, 'Call the buyer back')
  assert.equal(activity.overdue, true, 'a due date in the past is late, decided where today is known')
})
