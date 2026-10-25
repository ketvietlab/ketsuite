import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
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
    phone: '0909000123',
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
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-cases-defaults' })
  return { app, call }
}

test('crm records: the list’s old record links open the record page; an unknown record is not found', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'deep-link',
    kind: 'lead',
    name: 'Deep link',
    idempotencyKey: 'deep-link-create',
  })
  const response = await app.client.get('/admin/crm/cases?record=crm.case%3Adeep-link&tab=timeline&lang=en', {
    redirect: 'manual',
  })
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), '/admin/crm/cases/deep-link?lang=en')
  assert.equal((await app.client.get('/admin/crm/cases/deep-link?lang=en')).status, 200)
  // The page still draws, and says the record is not there.
  const missing = await app.client.get('/admin/crm/cases/missing', { redirect: 'manual' })
  assert.equal(missing.status, 404)
  assert.ok((await missing.text()).includes('data-island="crm.sales-screen"'))
})

test('crm records: a reader who may only open records reads one and is offered no change', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'reader-case',
    kind: 'lead',
    name: 'Readable case',
    idempotencyKey: 'reader-create-001',
  })
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call(name, input, { scope: { company: 'acme', branches: null } })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'reader-test',
    name: 'CRM Reader',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'reader:acme', userId: 'reader', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'crm-reader', name: 'CRM reader' })
  for (const fnKey of ['crm.case.modalContext', 'crm.case.get'])
    await fixture('user.grantFunction', { id: `reader:${fnKey}`, roleId: 'crm-reader', fnKey })
  await fixture('user.assignRole', { id: 'reader:role', userId: 'reader', roleId: 'crm-reader' })
  await call('crm.team.member.save', {
    id: 'reader:member',
    userId: 'reader',
    teamId: 'crm-team-sales',
    idempotencyKey: 'reader-team-member',
  })
  await app.client.logout()
  await app.client.login({ login: 'reader', password: 'reader-test' })
  assert.equal((await app.client.get('/admin/crm/cases/reader-case')).status, 200)
  const read = await app.client.post(
    '/admin/crm/sales/read',
    JSON.stringify({ query: 'screen=lead-detail&id=reader-case' }),
    { headers: { 'content-type': 'application/json' } },
  )
  const { ok, value } = (await read.json()) as { ok: boolean; value: Row }
  assert.equal(ok, true, 'a team member may read the record')
  assert.equal(((value.detail as Row).record as Row).id, 'reader-case')
  // Nothing on the page writes for them.
  assert.deepEqual(value.can, { write: false, admin: false })
})
