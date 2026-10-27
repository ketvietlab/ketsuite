import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  for (let index = 0; index < 32; index += 1) {
    const suffix = String(index).padStart(2, '0')
    await fixture('user.createUser', {
      id: `user-${suffix}`,
      login: `login-${suffix}`,
      password: index === 0 ? 'correct horse' : undefined,
      name: index === 7 ? 'Search Needle' : `User ${suffix}`,
      email: index === 8 ? 'needle@example.test' : null,
      superuser: index === 0,
      accessKind: index === 9 ? 'portal' : 'internal',
    })
  }
  await fixture('user.grantCompany', { id: 'user-00:acme', userId: 'user-00', companyId: 'acme' })
  await fixture('user.archiveUser', { id: 'user-31', active: false })
  await app.client.login({ login: 'login-00', password: 'correct horse' })
  return app
}

type Answer = {
  total: number
  page: number
  rows: Row[]
  clear: string
  href: string
  menus?: Array<{ id: string; items: Array<{ id: string; label: string; href: string; active: boolean }> }>
}

/** One page of people, as the list's islands read it. */
const read = async (app: Awaited<ReturnType<typeof boot>>, href: string): Promise<Answer> => {
  const response = await app.client.post('/admin/users/read?lang=en', JSON.stringify({ href }), {
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(response.status, 200, href)
  return ((await response.json()) as { value: Answer }).value
}

test('users HTTP list: the page is a frame, its people a read that searches before exact paging', async (t) => {
  const app = await boot(t)
  const first = await (await app.client.get('/admin/users?lang=en')).text()
  assert.match(first, /data-ui="list-page"/)
  assert.match(first, /data-island="backend\.row-list"[\s\S]*?data-ui="kt-placeholder"/)
  assert.doesNotMatch(first, /login-01/, 'no person is rendered on the server')

  const page1 = await read(app, '/admin/users?lang=en')
  assert.equal(page1.total, 31)
  assert.equal(page1.rows.length, 30)
  assert.ok(!page1.rows.some((row) => row.id === 'user-31'))
  assert.equal((await read(app, '/admin/users?page=2&lang=en')).rows.length, 1)

  const archived = await read(app, '/admin/users?archived=1&page=2&lang=en')
  assert.equal(archived.total, 32)
  assert.equal(archived.rows.length, 2)

  const byName = await read(app, '/admin/users?q=needle&lang=en')
  assert.deepEqual(byName.rows.map((row) => row.id).sort(), ['user-07', 'user-08'])

  // A page past the end comes back clamped, with the URL that says so.
  const past = await read(app, '/admin/users?page=9&lang=en')
  assert.equal(past.page, 2)
  assert.equal(past.href, '/admin/users?lang=en&page=2')
  assert.equal((await app.client.request('/admin/users?lang=en', { method: 'PUT' })).status, 405)
})

test('the create action opens a person in the record modal, while a row opens the person’s own page', async (t) => {
  const app = await boot(t)
  const page = await (await app.client.get('/admin/users?q=user&archived=1&page=2&lang=en')).text()

  // The create link names the record, so the collection behind the modal keeps its query.
  assert.match(
    page,
    /href="\/admin\/users\?q=user&amp;archived=1&amp;page=2&amp;lang=en&amp;record=user\.user%3Anew"/,
  )
  // The closed host is what opens that link once the page hydrates.
  assert.match(page, /data-ui="record-modal-host" data-record-kind="user\.user"/)
  // A row is the other way in: the island opens the person's own page, whose way back is the list.
  const props = page.match(/data-island="backend\.row-list"[^>]*data-props="([^"]*)"/)?.[1] ?? ''
  const open = JSON.parse(props.replaceAll('&quot;', '"').replaceAll('&amp;', '&')).open
  assert.deepEqual(open, { kind: 'page', path: '/admin/users/{id}?lang=en', returnPath: '/admin/users' })
})

test('the list narrows by where people work and what they hold, and clearing drops both', async (t) => {
  const app = await boot(t)
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('user.saveRole', { id: 'cashier', name: 'Thu ngân' })
  await fixture('user.assignRole', { id: 'a-01', userId: 'user-01', roleId: 'cashier' })

  // Both questions come with the read, each choice a link back to the list.
  const plain = await read(app, '/admin/users?lang=en')
  const role = plain.menus?.find((menu) => menu.id === 'role')
  const cashier = role?.items.find((item) => item.id === 'cashier')
  assert.equal(cashier?.label, 'Thu ngân')
  assert.equal(cashier?.href, '/admin/users?lang=en&role=cashier')

  // Only the person who works at that company is left; choosing it again drops it.
  const byCompany = await read(app, '/admin/users?company=acme&lang=en')
  assert.deepEqual(
    byCompany.rows.map((row) => row.login),
    ['login-00'],
  )
  const acme = byCompany.menus
    ?.find((menu) => menu.id === 'company')
    ?.items.find((item) => item.id === 'acme')
  assert.equal(acme?.active, true)
  assert.equal(acme?.href, '/admin/users?lang=en')

  // Only the person holding that role is left.
  assert.deepEqual(
    (await read(app, '/admin/users?role=cashier&lang=en')).rows.map((row) => row.login),
    ['login-01'],
  )

  // Asked for both at once nobody qualifies, and the way out drops both questions.
  const neither = await read(app, '/admin/users?company=acme&role=cashier&q=login&lang=en')
  assert.equal(neither.total, 0)
  assert.equal(neither.clear, '/admin/users?lang=en')
})
