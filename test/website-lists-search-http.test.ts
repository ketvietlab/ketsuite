// CSR list data is read through the authenticated Studio transport.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const PAGES = '/website/pages'
const LAYOUT = [{ type: 'website.rich_text', settings: { body: 'noi dung' } }]

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.call('website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  await app.client.call('website.saveEntry', {
    id: 'p-tra',
    siteId: 'site1',
    type: 'website.page',
    slug: 'tra',
    path: '/tra',
    title: 'Trang trà',
    layout: LAYOUT,
  })
  await app.client.call('website.saveEntry', {
    id: 'p-gom',
    siteId: 'site1',
    type: 'website.page',
    slug: 'gom',
    path: '/gom',
    title: 'Trang gốm',
    layout: LAYOUT,
  })
  await app.client.call('website.publishEntry', { id: 'p-gom' })
  await app.client.call('website.saveDomain', {
    id: 'd-primary',
    siteId: 'site1',
    host: 'moc.test',
    primary: true,
  })
  await app.client.call('website.saveDomain', {
    id: 'd-alias',
    siteId: 'site1',
    host: 'alias.test',
    primary: false,
    redirectToPrimary: true,
  })
  return app
}

const studioCall = async (
  app: Awaited<ReturnType<typeof boot>>,
  name: string,
  input: Record<string, unknown>,
) => {
  const response = await app.client.post(`/website/api/${name}`, JSON.stringify(input), {
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(response.status, 200, await response.clone().text())
  return ((await response.json()) as { value: { rows: Record<string, unknown>[] } }).value.rows
}
test('website content HTTP: CSR list data filters the query and publication state', async (t) => {
  const app = await boot(t)
  const shell = await app.client.get(`${PAGES}?site=site1`)
  assert.equal(shell.status, 200)
  assert.match(await shell.text(), /id="website-studio"/)
  const entries = (input: Record<string, unknown> = {}) =>
    studioCall(app, 'website.listEntries', { siteId: 'site1', type: 'page', ...input })
  assert.equal((await entries()).length, 2)
  assert.deepEqual(
    (await entries({ search: 'gốm' })).map((row) => row.id),
    ['p-gom'],
  )
  assert.deepEqual(
    (await entries({ status: 'published' })).map((row) => row.id),
    ['p-gom'],
  )
  assert.deepEqual(
    (await entries({ status: 'draft' })).map((row) => row.id),
    ['p-tra'],
  )
  assert.equal((await entries({ search: 'does-not-exist' })).length, 0)
})
test('website domains HTTP: Studio supplies primary and redirect domains from the selected site', async (t) => {
  const app = await boot(t)
  const rows = await studioCall(app, 'website_studio.listResources', { siteId: 'site1', kind: 'domains' })
  assert.deepEqual(rows.map((row) => [row.id, row.title, row.role]).sort(), [
    ['d-alias', 'alias.test', 'redirect'],
    ['d-primary', 'moc.test', 'primary'],
  ])
  assert.equal((await app.client.get('/admin/website/sites/site1/domains')).status, 404)
})

test('website lists HTTP: authoring routes use CSR and retired SSR screens are absent', async (t) => {
  const app = await boot(t)
  for (const path of ['/website/pages?site=site1', '/website/posts?site=site1']) {
    const response = await app.client.get(path)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /id="website-studio"/)
    assert.doesNotMatch(html, /data-island="backend\.search-filter"/)
  }
  for (const path of ['/admin/website/pages', '/admin/website/health', '/admin/website/sites/site1/members'])
    assert.equal((await app.client.get(path)).status, 404, path)
})

test('website content HTTP: the page and post lists read one page of rows at a time', async (t) => {
  const app = await boot(t)
  for (let i = 1; i <= 63; i++)
    await app.client.call('website.saveEntry', {
      id: `p-trang-${i}`,
      siteId: 'site1',
      type: 'website.page',
      slug: `trang-${i}`,
      path: `/trang-${i}`,
      title: `Trang số ${i}`,
      layout: LAYOUT,
    })
  const list = async (input: Record<string, unknown>) => {
    const response = await app.client.post('/website/api/website.listEntries', JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(response.status, 200)
    return ((await response.json()) as { value: Record<string, unknown> & { rows: unknown[] } }).value
  }
  const base = { siteId: 'site1', type: 'page', search: 'trang số' }
  const first = await list({ ...base, page: 1 })
  assert.deepEqual([first.rows.length, first.total, first.page, first.pageSize], [30, 63, 1, 30])
  const last = await list({ ...base, page: 3 })
  assert.deepEqual([last.rows.length, last.page], [3, 3])
  assert.equal((await list({ ...base, page: 99 })).page, 3, 'a page past the end reads the last one')
  const seen = new Set(
    [...first.rows, ...(await list({ ...base, page: 2 })).rows, ...last.rows].map(
      (r) => (r as { id: string }).id,
    ),
  )
  assert.equal(seen.size, 63, 'the pages do not overlap and leave nothing out')
  // The link pickers ask for no page and still see every entry.
  assert.equal((await list(base)).rows.length, 63)
})
