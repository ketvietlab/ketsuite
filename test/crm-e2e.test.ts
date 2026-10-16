import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

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
  return { app, call }
}

/** Posts a sales screen's form as its island does and returns the route's reply. */
const command = async (app: Awaited<ReturnType<typeof boot>>['app'], fields: Record<string, string>) => {
  const response = await app.client.post(
    '/admin/crm/sales/command',
    new URLSearchParams({ requestId: randomUUID(), lang: 'en', ...fields }).toString(),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-crm-sales-resolve': '1' },
      redirect: 'manual',
    },
  )
  assert.equal(response.status, 200)
  return (await response.json()) as { location: string; response?: { code: string; message: string } }
}

test('crm HTTP E2E: create, convert, move and win a sales record', async (t) => {
  const { app, call } = await boot(t)
  const created = await command(app, {
    command: 'create',
    context: 'screen=lead-new',
    kind: 'lead',
    name: 'Spa package enquiry',
    partnerId: 'customer',
    source: 'Website',
  })
  assert.equal(created.response, undefined, JSON.stringify(created.response))
  const id = new URL(created.location, app.baseUrl).pathname.split('/').pop() ?? ''
  let row = await call<Row>('crm.case.get', { id })
  assert.equal(row.kind, 'lead')
  assert.equal(row.partnerId, 'customer')

  const step = (fields: Record<string, string>) =>
    command(app, { context: `screen=lead-detail&id=${id}`, id, version: String(row.version), ...fields })
  const converted = await step({
    command: 'convert',
    stageId: 'crm-stage-qualified',
    expectedRevenue: '1850000',
    probability: '40',
    expectedClosing: '2026-09-12',
  })
  assert.equal(converted.response, undefined, JSON.stringify(converted.response))
  row = await call<Row>('crm.case.get', { id })
  assert.equal(row.kind, 'opportunity')
  assert.equal(row.id, id, 'a lead converts in place')
  assert.equal(row.stageId, 'crm-stage-qualified', 'the chosen stage is the one it opens in')
  assert.equal((row.salesDetail as Row).expectedRevenue, '1850000')
  assert.equal((row.salesDetail as Row).expectedClosing, '2026-09-12')

  const stale = String(row.version)
  assert.equal((await step({ command: 'move', stageId: 'crm-stage-proposition' })).response, undefined)
  row = await call<Row>('crm.case.get', { id })
  assert.equal(row.stageId, 'crm-stage-proposition')
  // A step taken from the version read before the move is refused, not applied over it.
  const late = await step({ command: 'close', version: stale, terminalState: 'won' })
  assert.equal(late.response?.code, 'E_CONFLICT')
  assert.equal((await call<Row>('crm.case.get', { id })).terminalState, 'open')

  const won = await step({ command: 'close', terminalState: 'won', note: 'Customer approved the proposal' })
  assert.equal(won.response, undefined, JSON.stringify(won.response))
  const closed = await call<Row>('crm.case.get', { id })
  assert.equal(closed.terminalState, 'won')
  assert.match(JSON.stringify(closed.timeline), /Customer approved the proposal/u)
})

test('crm HTTP E2E: optimistic conflict and company isolation', async (t) => {
  const { app, call } = await boot(t)
  await call<Row>('crm.case.save', {
    id: 'conflict',
    kind: 'lead',
    name: 'Conflict record',
    partnerId: 'customer',
    idempotencyKey: 'save-conflict',
  })
  const row = await call<Row>('crm.case.get', { id: 'conflict' })
  const results = await Promise.all([
    call<Row>('crm.case.move', {
      id: row.id,
      stageId: 'crm-stage-qualified',
      expectedVersion: row.version,
      idempotencyKey: 'move-conflict-a',
    }),
    call<Row>('crm.case.move', {
      id: row.id,
      stageId: 'crm-stage-proposition',
      expectedVersion: row.version,
      idempotencyKey: 'move-conflict-b',
    }),
  ])
  assert.equal(results.filter((item) => item.ok).length, 1)
  assert.equal(results.filter((item) => !item.ok).length, 1)

  const website = await app.client.anonymous().get('/contact/sales?lang=en')
  assert.equal(website.status, 200)
  assert.match(await website.text(), /Request a consultation/)
  const page = await app.client.get('/admin/crm/cases?lang=en')
  const visibleText = (await page.text()).replace(/<[^>]*>/g, ' ')
  assert.doesNotMatch(visibleText, /crm_backend\.[A-Za-z]/)
})
