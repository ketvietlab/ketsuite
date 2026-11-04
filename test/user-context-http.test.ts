import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

const post = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' as const }
const barcode = '8930000000019'

test('a Commerce session works in one company and switches through the working context', async (t: TestContext) => {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = async (name: string, input: Row, company = 'a') => {
    const result = (await app.fixture.call(name, input, { scope: { company, branches: null } })).value as Row
    assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
    return result
  }
  for (const company of ['a', 'b']) {
    await fixture('partner.savePartner', { id: `${company}-party`, kind: 'company', name: company }, company)
    await fixture(
      'company.saveCompany',
      { id: company, partnerId: `${company}-party`, currency: 'VND' },
      company,
    )
    await fixture('uom.saveUnit', { id: `unit-${company}`, name: 'Each', relativeFactor: '1' }, company)
    await fixture(
      'product.saveTemplate',
      {
        id: `tpl-${company}`,
        name: `Sample ${company}`,
        type: 'goods',
        uomId: `unit-${company}`,
        listPrice: '100',
        barcode,
      },
      company,
    )
  }
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'one-company-test',
    name: 'Owner',
    defaultCompanyId: 'a',
    superuser: true,
  })
  for (const company of ['a', 'b'])
    await fixture('user.grantCompany', { id: `owner-${company}`, userId: 'owner', companyId: company })
  await app.client.login({ login: 'owner', password: 'one-company-test' })

  const listed = async () =>
    ((await app.client.call<Row[]>('product.listTemplates', {})).value as Row[]).map((row) => row.id)
  // A member of both companies still works in one: the default.
  assert.deepEqual(await listed(), ['tpl-a'])

  const path = '/admin/context?lang=en'
  const html = await (await app.client.get(path)).text()
  assert.match(html, /data-ui="form-page" data-scope="working-context-page"/)
  assert.match(html, /action="\/admin\/context\?lang=en"/)
  assert.match(html, /<select[^>]*name="companyId"/)
  assert.doesNotMatch(html, /name="company\./)
  assert.match(html, /name="branch\.root:a"/)
  assert.doesNotMatch(html, /name="branch\.root:b"/)
  assert.equal((await app.client.post(path, new URLSearchParams({ action: 'unknown' }), post)).status, 400)
  const crossSite = await app.client.post(path, new URLSearchParams({ action: 'save' }), {
    ...post,
    headers: { ...post.headers, origin: 'https://attacker.example' },
  })
  assert.equal(crossSite.status, 403)

  // Choosing company b while the branch still names a's root works in b's root.
  const switched = await app.client.post(
    path,
    new URLSearchParams({ action: 'save', companyId: 'b', branchId: 'root:a', 'branch.root:a': '1' }),
    post,
  )
  assert.equal(switched.status, 303, await switched.text())
  assert.equal(switched.headers.get('location'), '/admin/context?lang=en')
  assert.deepEqual(await listed(), ['tpl-b'])

  // b's product keeps the barcode a also sells, and saves in b.
  const held = (await app.client.call<Row>('product.getTemplate', { id: 'tpl-b' })).value as Row
  const saved = (
    await app.client.call<Row>('product.saveTemplate', {
      id: 'tpl-b',
      expectedRevisionId: held.revisionId,
      name: 'Sample b renamed',
      type: 'goods',
      uomId: 'unit-b',
      listPrice: '120',
      barcode,
    })
  ).value as Row
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const p = (index: number) => (app.adapter!.name === 'postgres' ? `$${index}` : '?')
  const rows = await app.adapter!.all(
    `SELECT id, name, "companyId" FROM product_template WHERE id IN (${p(1)}, ${p(2)}) ORDER BY id`,
    ['tpl-a', 'tpl-b'],
  )
  assert.deepEqual(
    rows.map((row) => [row.id, row.name, row.companyId]),
    [
      ['tpl-a', 'Sample a', 'a'],
      ['tpl-b', 'Sample b renamed', 'b'],
    ],
  )
})
