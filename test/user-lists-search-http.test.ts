// The search-filter bar over the identity lists.
//
// People and roles both read a bounded collection and narrow it in memory, so
// what is worth proving over real HTTP is that the URL the bar writes is the
// URL the page reads: the query, a preset, a group that turns the table into
// openable groups, the archived toggle, and a favourite that round-trips.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const PEOPLE = '/admin/users'
const ROLES = '/admin/roles'

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
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('user.createUser', {
    id: 'portal-guest',
    login: 'guest',
    name: 'Khách Portal',
    accessKind: 'portal',
  })
  await fixture('user.createUser', { id: 'left', login: 'left', name: 'Người Đã Nghỉ' })
  await fixture('user.archiveUser', { id: 'left', active: false })
  await fixture('user.saveRole', { id: 'manager', name: 'Manager', description: 'Operational manager' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

/** One page of people, as the list's islands read it. */
const readPeople = async (app: Awaited<ReturnType<typeof boot>>, href: string) => {
  const response = await app.client.post(`${PEOPLE}/read?lang=vi`, JSON.stringify({ href }), {
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(response.status, 200, href)
  return ((await response.json()) as { value: { rows: Row[]; groups: Array<{ href: string }> | null } }).value
}
const ids = (answer: { rows: Row[] }) => answer.rows.map((row) => row.id)

test('identity lists HTTP: the bar drives the URL the people read applies', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${PEOPLE}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.row-list-controls"[\s\S]*?data-ui="search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.doesNotMatch(allHtml, /data-row="portal-guest"/, 'no person is rendered on the server')

  const everyone = await readPeople(app, `${PEOPLE}?lang=vi`)
  assert.ok(ids(everyone).includes('portal-guest'))
  assert.ok(!ids(everyone).includes('left'))

  assert.deepEqual(ids(await readPeople(app, `${PEOPLE}?lang=vi&q=Portal`)), ['portal-guest'])
  assert.deepEqual(ids(await readPeople(app, `${PEOPLE}?lang=vi&preset=portal`)), ['portal-guest'])

  // Alternatives within one group, so asking for both keeps both kinds.
  const both = ids(await readPeople(app, `${PEOPLE}?lang=vi&preset=portal&preset=internal`))
  assert.ok(both.includes('portal-guest') && both.includes('admin'))

  // The archived toggle reaches the domain call as well as the row filter.
  assert.ok(ids(await readPeople(app, `${PEOPLE}?lang=vi&archived=1`)).includes('left'))

  const grouped = await readPeople(app, `${PEOPLE}?lang=vi&group=accessKind`)
  assert.deepEqual(grouped.rows, [])
  assert.ok(grouped.groups?.length, 'a group must be expandable')
  const opened = await readPeople(app, grouped.groups![0]!.href)
  assert.ok(JSON.stringify(opened.groups).includes('"rows":[{'), 'an open group carries its rows')
})

const readRoles = async (app: Awaited<ReturnType<typeof boot>>, href: unknown, headers = {}) =>
  app.client.post(`${ROLES}/read?lang=vi`, JSON.stringify({ href }), {
    headers: { 'content-type': 'application/json', ...headers },
  })

test('identity lists HTTP: the roles page is a frame, its rows a read; custom roles stay unavailable', async (t) => {
  const app = await boot(t)
  const html = await (await app.client.get(`${ROLES}?lang=vi`)).text()
  assert.match(html, /data-island="backend\.row-list-controls"[\s\S]*?data-ui="search-filter"/)
  assert.match(html, /data-island="backend\.row-list"[\s\S]*?data-ui="kt-placeholder"/)
  assert.doesNotMatch(html, /data-row="manager"/)

  const response = await readRoles(app, `${ROLES}?lang=vi&q=Manager`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const answer = (
    (await response.json()) as {
      value: { rows: Array<{ id: string }>; isEmpty: boolean; search: { query: string } }
    }
  ).value
  assert.deepEqual(answer.rows, [], 'the custom role is never listed')
  assert.equal(answer.search.query, 'Manager')
})

test('identity lists HTTP: the roles read answers only its own list, to its own site, by POST', async (t) => {
  const app = await boot(t)
  assert.equal((await readRoles(app, '/admin/users?lang=vi')).status, 400)
  assert.equal((await readRoles(app, 'https://elsewhere.test/admin/roles')).status, 400)
  assert.equal((await readRoles(app, `${ROLES}?lang=vi`, { origin: 'https://elsewhere.test' })).status, 403)
  assert.equal((await readRoles(app, `${ROLES}?lang=vi`, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await app.client.get(`${ROLES}/read?lang=vi`)).status, 405)
})

test('identity lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${PEOPLE}?lang=vi`

  const applied = await app.client.call<{ href: string }>('user_backend.applySearchFilter', {
    listKey: 'user.users',
    returnTo,
    query: 'Portal',
    facets: [{ id: 'preset:portal', type: 'filter', label: 'Portal' }],
    groupBy: ['accessKind'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, PEOPLE)
  assert.equal(href.searchParams.get('q'), 'Portal')
  assert.deepEqual(href.searchParams.getAll('preset'), ['portal'])
  assert.deepEqual(href.searchParams.getAll('group'), ['accessKind'])

  const favorite = await app.client.call<{ id: string }>('user_backend.saveSearchFavorite', {
    name: 'Chỉ khách portal',
    isDefault: true,
    state: {
      listKey: 'user.users',
      returnTo,
      facets: [{ id: 'preset:portal', type: 'filter', label: 'Portal' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('user_backend.applySearchFilter', {
    listKey: 'user.users',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), ['portal'])
  assert.match(await (await app.client.get(returnTo)).text(), /Chỉ khách portal/)

  await app.client.call('user_backend.deleteSearchFavorite', {
    listKey: 'user.users',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Chỉ khách portal/)
})

test('identity lists HTTP: checked people are made active or inactive together, and the last administrator stays', async (t) => {
  const app = await boot(t)
  const form = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
    app.client.post(`${PEOPLE}/bulk?lang=vi`, new URLSearchParams(fields), {
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      redirect: 'manual',
    })
  const active = async (id: string) =>
    ((await app.client.call<Row[]>('user.listUsers', { includeArchived: true })).value.find(
      (row) => row.id === id,
    )?.active as boolean | undefined) ?? null

  const page = await (await app.client.get(`${PEOPLE}?lang=vi`)).text()
  // The rows check into the form by its id (`selection` of the islands); the form is the server's.
  assert.match(page, /data-island="backend\.row-list"[^>]*data-props="[^"]*user-people-bulk/)
  assert.match(
    page,
    /<form data-ui="bulk-form" id="user-people-bulk"[^>]*action="\/admin\/users\/bulk\?lang=vi"/,
  )

  assert.equal((await app.client.request(`${PEOPLE}/bulk?lang=vi`)).status, 405)
  const crossSite = await form(
    { action: 'deactivate', 'selected.portal-guest': '1' },
    { origin: 'https://cross-site.example' },
  )
  assert.equal(crossSite.status, 403)
  assert.equal(await active('portal-guest'), true)
  assert.equal((await form({ action: 'erase', 'selected.portal-guest': '1' })).status, 400)

  const deactivated = await form({
    action: 'deactivate',
    returnTo: '/admin/users?q=Portal',
    'selected.portal-guest': '1',
    // The only full administrator is refused on its own; the rest still go through.
    'selected.admin': '1',
  })
  assert.equal(deactivated.status, 303)
  assert.equal(deactivated.headers.get('location'), '/admin/users?q=Portal&lang=vi')
  assert.equal(await active('portal-guest'), false)
  assert.equal(await active('admin'), true)

  const activated = await form({ action: 'activate', 'selected.portal-guest': '1', 'selected.left': '1' })
  assert.equal(activated.status, 303)
  assert.equal(await active('portal-guest'), true)
  assert.equal(await active('left'), true)
})

test('identity lists HTTP: the access-rules page is a frame and its rules a read, for whoever may list them', async (t) => {
  const app = await boot(t)
  const html = await (await app.client.get('/admin/access-policies?lang=vi')).text()
  assert.match(html, /data-island="backend\.row-list"[\s\S]*?data-ui="kt-placeholder"/)
  assert.match(html, /id="user-policy-help"/)
  const read = (href: string) =>
    app.client.post('/admin/access-policies/read?lang=vi', JSON.stringify({ href }), {
      headers: { 'content-type': 'application/json' },
    })
  const response = await read('/admin/access-policies?lang=vi')
  assert.equal(response.status, 200)
  const answer = ((await response.json()) as { value: { isEmpty: boolean; total: number } }).value
  assert.equal(answer.isEmpty, true, 'no rule yet, which the list tells apart from no match')
  assert.equal(answer.total, 0)

  // Someone who may not list rules is refused the read, which the island shows as denied.
  await app.fixture.call(
    'user.createUser',
    { id: 'clerk', login: 'clerk', password: 'correct horse', name: 'Clerk' },
    { scope: { company: 'acme', branch: 'root:acme', branches: ['root:acme'] } },
  )
  await app.fixture.call(
    'user.grantCompany',
    { id: 'clerk:acme', userId: 'clerk', companyId: 'acme' },
    { scope: { company: 'acme', branch: 'root:acme', branches: ['root:acme'] } },
  )
  await app.client.login({ login: 'clerk', password: 'correct horse' })
  assert.equal((await read('/admin/access-policies?lang=vi')).status, 403)
  assert.equal(
    (
      await app.client.post(`${ROLES}/read?lang=vi`, JSON.stringify({ href: `${ROLES}?lang=vi` }), {
        headers: { 'content-type': 'application/json' },
      })
    ).status,
    403,
  )
})
