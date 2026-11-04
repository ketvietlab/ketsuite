import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boot } from './fixtures/sale/commerce.ts'
import {
  productBackHref,
  productRecordHref,
} from '../packages/ketsuite/src/modules/product_backend/navigation.ts'
test('P58 real modal bookmarks preserve identity, scope, tab and collection state', () => {
  const source = new URL(
    'https://app.test/admin/product/templates?company=other&branch=west&lang=en&q=Tea&page=2&record=product.template%3Areal%2Fid&tab=variants&recordDialog=edit#row=real',
  )
  const target = new URL(productRecordHref(source, 'real/id', 'variants'), source)
  assert.equal(target.pathname, '/admin/product/templates/real%2Fid')
  for (const [key, value] of [
    ['company', 'other'],
    ['branch', 'west'],
    ['lang', 'en'],
    ['tab', 'variants'],
  ])
    assert.equal(target.searchParams.get(key!), value)
  const back = new URL(target.searchParams.get('returnTo')!, source)
  assert.equal(back.pathname, '/admin/product/templates')
  assert.equal(back.searchParams.get('q'), 'Tea')
  assert.equal(back.searchParams.get('page'), '2')
  assert.equal(back.hash, '#row=real')
  assert.equal(back.searchParams.has('record'), false)
  assert.equal(back.searchParams.has('tab'), false)
  assert.equal(back.searchParams.has('recordDialog'), false)
})
test('P58 return paths reject external, recursive and malformed values while preserving a scoped fallback', () => {
  for (const raw of [
    'https://evil.test/admin/product/search',
    '//evil.test/admin/product/templates',
    'http://[',
    '/admin/product/templates/another',
    'javascript:alert(1)',
  ]) {
    const url = new URL('https://app.test/admin/product/templates/id?company=other&branch=west&lang=en')
    url.searchParams.set('returnTo', raw)
    assert.equal(productBackHref(url), '/admin/product/templates?company=other&branch=west&lang=en')
  }
  const source = new URL('https://app.test/admin/product/templates/id')
  source.searchParams.set(
    'returnTo',
    '/admin/product/variants?company=other&q=Tea&page=3&record=product.template:id&returnTo=https://evil.test',
  )
  assert.equal(productBackHref(source), '/admin/product/variants?company=other&q=Tea&page=3')
})
test('P58 legacy record URL redirects to the same company record, never mock or a generic list', async (t) => {
  const r = await boot(t)
  await r.fixture('user.grantCompany', { id: 'owner-other', userId: 'owner', companyId: 'other' })
  const seeded = await r.fixture(
    'product.saveTemplate',
    { id: 'other-template', name: 'Other scoped product', type: 'service', defaultCode: 'OTHER' },
    'other',
  )
  assert.notEqual(seeded.ok, false, JSON.stringify(seeded))
  await r.fixture('user.createUser', {
    id: 'other-owner',
    login: 'other-owner',
    password: 'test-password',
    name: 'Other owner',
    defaultCompanyId: 'other',
    superuser: true,
  })
  await r.fixture('user.grantCompany', {
    id: 'other-owner-company',
    userId: 'other-owner',
    companyId: 'other',
  })
  const activeOther = r.app.client.anonymous()
  await activeOther.login({ login: 'other-owner', password: 'test-password' })
  const response = await activeOther.get(
    '/admin/product/templates?company=other&lang=en&q=Other&page=2&record=product.template:other-template&tab=variants',
    { redirect: 'manual' },
  )
  assert.equal(response.status, 303)
  const next = new URL(response.headers.get('location')!, r.app.baseUrl)
  assert.equal(next.pathname, '/admin/product/templates/other-template')
  assert.equal(next.searchParams.get('company'), 'other')
  assert.equal(next.searchParams.get('lang'), 'en')
  assert.equal(next.searchParams.get('tab'), 'variants')
  const page = await activeOther.get(next)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Other scoped product/)
  const wrong = new URL(next)
  wrong.searchParams.set('company', 'acme')
  assert.equal((await r.app.client.get(wrong)).status, 404)
  const absent = await r.app.client.get(
    '/admin/product/templates?company=other&record=product.template:missing',
    { redirect: 'manual' },
  )
  assert.equal(absent.status, 303)
  assert.equal((await r.app.client.get(absent.headers.get('location')!)).status, 404)
})
test('P58 native create, import and saved-filter URLs remain real catalogue workflows', async (t) => {
  const r = await boot(t)
  const create = await r.app.client.get(
    '/admin/product/templates?company=acme&lang=en&record=product.template:new',
    { redirect: 'manual' },
  )
  assert.equal(create.status, 303)
  assert.match(create.headers.get('location')!, /^\/admin\/product\/templates\/new\?/)
  assert.equal((await r.app.client.get(create.headers.get('location')!)).status, 200)
  const importing = await r.app.client.get(
    '/admin/product/templates?company=acme&lang=en&record=product.import:new',
    { redirect: 'manual' },
  )
  assert.equal(importing.status, 200)
  assert.match(await importing.text(), /product.import-modal/)
  const favorite = await r.app.client.get('/admin/product/templates/favorites/new?company=acme&lang=en', {
    redirect: 'manual',
  })
  assert.equal(favorite.status, 303)
  assert.match(favorite.headers.get('location')!, /^\/admin\/product\/templates\?/)
})
