import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeListState, parseListState } from '@ketvietlab/ketjs'
import type { Answer } from '../packages/ketsuite/src/modules/pricing_backend/list/shared.ts'
import { recordBack } from '../packages/ketsuite/src/modules/pricing_backend/list/shared.ts'
import { pricelistListSearch } from '../packages/ketsuite/src/modules/pricing_backend/search.ts'
import { setup } from './fixtures/sale/commerce.ts'
const headers = { 'content-type': 'application/json' }
const path = '/admin/pricing/pricelists'

test('Commerce pricelist shell sends no records and its read bounds, clamps and sorts pages', async (t) => {
  const { app, save } = await setup(t)
  for (let n = 0; n < 107; n++)
    await save('pricing.savePricelist', {
      id: `list-${String(n).padStart(3, '0')}`,
      name: `Unique list ${String(n).padStart(3, '0')}`,
      sequence: n,
      active: n % 2 === 0,
    })
  const shell = await app.client.get(`${path}?lang=en`),
    html = await shell.text()
  assert.equal(shell.status, 200)
  assert.match(html, /pricing.list-results/)
  assert.doesNotMatch(html, /Unique list 000/)
  const read = async (href: string) => {
    const response = await app.client.post(`${path}/read?lang=en`, JSON.stringify({ href }), { headers })
    assert.equal(response.status, 200, await response.clone().text())
    return ((await response.json()) as { value: Answer }).value
  }
  const first = await read(`${path}?lang=en`)
  assert.equal(first.rows.length, 50)
  assert.equal(first.total, 107)
  assert.equal(first.pages, 3)
  assert.equal(first.rows[0]!.id, 'list-000')
  assert.ok(first.next)
  const last = await read(`${path}?lang=en&page=999`)
  assert.equal(last.page, 3)
  assert.equal(last.rows.length, 7)
  assert.match(last.query.href, /page=3/)
  const capped = await read(`${path}?lang=en&pageSize=999`)
  assert.equal(capped.rows.length, 100)
  assert.equal(capped.query.pageSize, 100)
  const searched = await read(`${path}?lang=en&q=Unique+list+106`)
  const noMatches = await read(`${path}?lang=en&q=not-found`)
  assert.equal(noMatches.total, 0)
  assert.equal(noMatches.isEmpty, false)
  assert.equal(searched.search.applyOnInput, true)
  assert.equal(searched.search.query, 'Unique list 106')
  assert.ok(!searched.search.facets.some((f) => f.type === 'field'))
  assert.equal(searched.total, 1)
  assert.equal(searched.rows[0]!.id, 'list-106')
  const detail = new URL(searched.rows[0]!.detailHref, 'http://local')
  assert.equal(recordBack(detail), searched.query.href)
  const sorted = await read(first.sort.sequence!.href)
  assert.equal(sorted.rows[0]!.id, 'list-106')
})

test('Commerce pricelist reads retain advanced filters, grouped rows and saved searches', async (t) => {
  const { app, save } = await setup(t)
  await save('pricing.savePricelist', { id: 'active', name: 'Retail', active: true, sequence: 5 })
  await save('pricing.savePricelist', { id: 'archived', name: 'Old wholesale', active: false, sequence: 20 })
  await save('pricing_backend.saveSearchFavorite', {
    name: 'My active lists',
    state: {
      listKey: 'pricing.pricelists',
      returnTo: `${path}?lang=en`,
      filters: ['active'],
      groupBy: [],
      customFilters: [],
      query: '',
    },
  })
  const base = new URL(`${path}?lang=en`, 'http://local')
  const state = parseListState(pricelistListSearch, base).state
  const href = encodeListState(
    { ...state, presets: ['active'], groupBy: [{ key: 'state' }], openGroups: [['active']] },
    base,
  )
  const response = await app.client.post(`${path}/read?lang=en`, JSON.stringify({ href }), { headers })
  assert.equal(response.status, 200)
  const answer = ((await response.json()) as { value: Answer }).value
  assert.ok(JSON.stringify(answer.search).includes('My active lists'))
  assert.equal(answer.total, 1)
  assert.deepEqual(answer.rows, [])
  assert.equal(answer.groups?.[0]?.count, 1)
  assert.equal(answer.groups?.[0]?.rows?.[0]?.id, 'active')
  assert.ok(answer.search.facets.some((f) => f.id === 'preset:active'))
  assert.ok(answer.search.facets.some((f) => f.type === 'groupBy'))
  const custom = encodeListState(
    { ...state, filters: [{ kind: 'rule', field: 'sequence', operator: 'gt', value: 10 }] },
    base,
  )
  const filtered = await app.client.post(`${path}/read?lang=en`, JSON.stringify({ href: custom }), {
    headers,
  })
  const result = ((await filtered.json()) as { value: Answer }).value
  assert.deepEqual(
    result.rows.map((row) => row.id),
    ['archived'],
  )
})

test('Commerce pricelist read refuses wrong methods, origins, scope and foreign collection URLs', async (t) => {
  const { app, save, fixture } = await setup(t)
  await save('pricing.savePricelist', { id: 'own', name: 'Own company' })
  await fixture('pricing.savePricelist', { id: 'foreign', name: 'Foreign company' }, 'other')
  const post = (href: string, extra: Record<string, string> = {}) =>
    app.client.post(`${path}/read?lang=en`, JSON.stringify({ href }), { headers: { ...headers, ...extra } })
  assert.equal((await app.client.get(`${path}/read?lang=en`)).status, 405)
  for (const href of [
    'https://foreign.example/admin/pricing/pricelists?lang=en',
    '/admin/sales/orders?lang=en',
    `${path}?lang=en&company=other`,
  ])
    assert.equal((await post(href)).status, 400)
  assert.equal((await post(`${path}?lang=en`, { origin: 'https://foreign.example' })).status, 403)
  const response = await post(`${path}?lang=en`)
  assert.deepEqual(
    ((await response.json()) as { value: Answer }).value.rows.map((row) => row.id),
    ['own'],
  )
})

test('Commerce read-only pricelist viewers load pages but cannot create and unauthorized readers are denied', async (t) => {
  const { app, save, fixture } = await setup(t)
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await save('user.saveRole', { id: 'reader', name: 'Reader' })
  await save('user.grantFunction', { id: 'grant-reader', roleId: 'reader', fnKey: 'pricing.listPricelists' })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    name: 'Reader',
    password: 'test-password',
    defaultCompanyId: 'acme',
  })
  await save('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await save('user.assignRole', { id: 'reader-role', roleId: 'reader', userId: 'reader' })
  await app.client.login({ login: 'reader', password: 'test-password' })
  const page = await app.client.get(`${path}?lang=en`)
  assert.equal(page.status, 200)
  assert.doesNotMatch(await page.text(), /create=1/)
  assert.equal(
    (await app.client.post(`${path}/read?lang=en`, JSON.stringify({ href: `${path}?lang=en` }), { headers }))
      .status,
    200,
  )
  assert.equal(
    (await app.client.post(path, JSON.stringify({ action: 'create', name: 'Forged' }), { headers })).status,
    403,
  )
  assert.equal((await app.client.get(`${path}?create=1`)).status, 403)
  await app.client.login({ login: 'owner', password: 'test-password' })
  await fixture('user.createUser', {
    id: 'denied',
    login: 'denied',
    name: 'Denied',
    password: 'test-password',
    defaultCompanyId: 'acme',
  })
  await save('user.grantCompany', { id: 'denied-company', userId: 'denied', companyId: 'acme' })
  await app.client.login({ login: 'denied', password: 'test-password' })
  assert.equal(
    (await app.client.post(`${path}/read?lang=en`, JSON.stringify({ href: `${path}?lang=en` }), { headers }))
      .status,
    403,
  )
})

test('Pricelist Back retains collection filters and refuses external or unrelated return targets', () => {
  assert.equal(
    recordBack(
      new URL(
        `http://local${path}/retail?returnTo=${encodeURIComponent(`${path}?q=Retail&page=2&company=acme`)}`,
      ),
    ),
    `${path}?q=Retail&page=2&company=acme`,
  )
  for (const target of ['https://foreign.example/', '/admin/users', 'javascript:alert(1)'])
    assert.equal(
      recordBack(new URL(`http://local${path}/retail?lang=en&returnTo=${encodeURIComponent(target)}`)),
      `${path}?lang=en`,
    )
})
