import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
import { commerceRoleTemplates } from '../packages/ketsuite/src/role-templates.ts'

test('Commerce pricelist page is client-read with permission-scoped context and working local-time commands', async (t) => {
  const { app, save, call, productId } = await setup(t)
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  const page = await app.client.get('/admin/pricing/pricelists/retail?lang=en')
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /pricing.pricelist-page/)
  assert.match(html, /pricing-pricelist-help/)
  assert.doesNotMatch(html, /pricing-pricelist-settings/)
  const context = (await (
    await app.client.get('/admin/pricing/pricelists/retail/context?lang=en')
  ).json()) as { data: Row }
  assert.equal(context.data.saveItem, true)
  const payload = {
    id: 'rule',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId,
    uomId: 'box',
    computePrice: 'fixed',
    fixedPrice: '950',
    base: null,
    dateStart: '2026-10-23T09:00',
    dateEnd: '2026-10-24T09:00',
  }
  const post = (body: Row) =>
    app.client.post('/admin/pricing/rule-command?lang=en', JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    })
  const saved = (await (await post(payload)).json()) as { value: Row }
  assert.equal(saved.value.ok, true, JSON.stringify(saved))
  const refreshed = (await (
    await app.client.get('/admin/pricing/pricelists/retail/context?lang=en')
  ).json()) as { data: { items: Row[] } }
  assert.equal(refreshed.data.items[0]!.dateStart, '2026-10-23T09:00')
  const raw = (await call('pricing.listPricelistItems', { pricelistId: 'retail' })) as unknown as Row[]
  assert.equal(new Date(String(raw[0]!.dateStart)).toISOString(), '2026-10-23T02:00:00.000Z')
  const refused = (await (await post({ ...payload, dateStart: 'invalid' })).json()) as { value: Row }
  assert.equal(refused.value.ok, false)
  assert.equal((refused.value.errors as Row[])[0]!.field, 'dateStart')
  const wrongPackage = (await (await post({ ...payload, uomId: 'case' })).json()) as { value: Row }
  assert.equal(wrongPackage.value.ok, false)
  assert.equal((wrongPackage.value.errors as Row[])[0]!.field, 'uomId')
})

test('Commerce pricing viewer can inspect rules without product grants, but cannot forge writes', async (t) => {
  const { app, save, fixture } = await setup(t)
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await save('user.saveRole', { id: 'reader', name: 'Pricing reader' })
  for (const fnKey of ['pricing.listPricelists', 'pricing.listPricelistItems'])
    await save('user.grantFunction', { id: `reader-${fnKey}`, roleId: 'reader', fnKey })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await save('user.grantCompany', { id: 'reader-acme', userId: 'reader', companyId: 'acme' })
  await save('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'reader' })
  await app.client.login({ login: 'reader', password: 'test-password' })
  const response = await app.client.get('/admin/pricing/pricelists/retail/context?lang=en')
  assert.equal(response.status, 200)
  const context = (await response.json()) as {
    data: { save: boolean; saveItem: boolean; choices: Record<string, Row[]> }
  }
  assert.equal(context.data.saveItem, false)
  assert.equal(context.data.save, false)
  assert.deepEqual(context.data.choices.products, [])
  const denied = await app.client.post('/admin/pricing/rule-command', JSON.stringify({ id: 'bad' }), {
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(denied.status, 403)
  await assert.rejects(
    () =>
      app.client.call('pricing.savePricelistItem', {
        id: 'bad',
        pricelistId: 'retail',
        appliedOn: '3_global',
        computePrice: 'fixed',
      }),
    { status: 403 },
  )
})

test('Commerce manager has pricing configuration, representative remains a viewer', () => {
  assert.ok(commerceRoleTemplates['commerce.sales-manager']!.bundles.includes('pricing.configure'))
  assert.ok(!commerceRoleTemplates['commerce.sales-representative']!.bundles.includes('pricing.configure'))
})

test('Commerce managed roles enforce pricing configuration and warehouse denial over HTTP', async (t) => {
  const { app, save, fixture } = await setup(t)
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  const synced = await app.fixture.call<Row>('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  assert.equal(synced.value.ok, true, JSON.stringify(synced.value))
  for (const [key, readable, writable] of [
    ['sales-manager', true, true],
    ['sales-representative', true, false],
    ['accountant', true, false],
    ['tenant-auditor', true, false],
    ['warehouse-operator', false, false],
  ] as const) {
    await app.client.login({ login: 'owner', password: 'test-password' })
    await fixture('user.createUser', {
      id: key,
      login: key,
      password: 'test-password',
      name: key,
      defaultCompanyId: 'acme',
    })
    await save('user.grantCompany', { id: `${key}-acme`, userId: key, companyId: 'acme' })
    await save('user.assignRole', { id: `${key}-role`, userId: key, roleId: `commerce.${key}` })
    await app.client.login({ login: key, password: 'test-password' })
    const response = await app.client.get('/admin/pricing/pricelists/retail/context?lang=en')
    assert.equal(response.status, readable ? 200 : 403, key)
    if (readable) {
      const collection = await app.client.get('/admin/pricing/pricelists?lang=en')
      assert.equal(collection.status, 200, key)
      const collectionHtml = await collection.text()
      assert.match(collectionHtml, /pricing-pricelist-help/)
      assert.equal(collectionHtml.includes('create=1'), writable, key)
      const context = (await response.json()) as { data: { saveItem: boolean } }
      assert.equal(context.data.saveItem, writable, key)
    }
    const post = await app.client.post(
      '/admin/pricing/rule-command',
      JSON.stringify({
        id: `rule-${key}`,
        pricelistId: 'retail',
        appliedOn: '3_global',
        computePrice: 'fixed',
        fixedPrice: '90',
      }),
      { headers: { 'content-type': 'application/json' } },
    )
    assert.equal(post.status, writable ? 200 : 403, key)
    if (writable) assert.equal(((await post.json()) as { value: Row }).value.ok, true)
  }
})
