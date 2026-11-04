// P28: a variant has the product's three field groups (P17). The catalogue keeps its code,
// price and state; the stock manager its barcode and HS code, saved together; the accountant
// its cost. Each Commerce role, signed in over HTTP, saves its own group and is refused the
// others.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { Row, Scope } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'

const PASSWORD = 'variant-groups-pass'

test('P28: the stock manager saves a variant barcode and HS code together; other roles keep to their group', async (t) => {
  const app = await createTestDeployment(commerce, { worker: false })
  t.after(() => app.close())
  const run = async <T = Row>(fn: string, input: Row, actor: string | null, scope?: Scope) =>
    (await app.fixture.call<T>(fn, input, { actor, ...(scope ? { scope } : {}) })).value
  const tenant = await run<{ ok: boolean; companyId: string; branchId: string; userId: string }>(
    'user.provisionAdmin',
    {
      companyName: 'An Việt',
      companyCode: 'AV',
      currency: 'VND',
      adminLogin: 'owner',
      adminName: 'Owner',
      adminPassword: 'correct horse battery',
    },
    'system:provision',
  )
  assert.equal(tenant.ok, true)
  assert.equal((await run('user.syncRoleTemplates', {}, 'system:role-templates')).ok, true)
  const scope: Scope = { company: tenant.companyId, companies: [tenant.companyId], branch: tenant.branchId }
  const admin = async <T = Row>(fn: string, input: Row) => {
    const row = await run<T>(fn, input, tenant.userId, scope)
    assert.equal((row as Row).ok, true, `${fn}: ${JSON.stringify(row)}`)
    return row
  }
  // One signed-in person per role, calling functions the way the screens do.
  const signedIn = async (userId: string, role: string) => {
    await run('user.createUser', { id: userId, login: userId, name: userId, password: PASSWORD }, null)
    await admin('user.grantCompany', { id: `${userId}:company`, userId, companyId: tenant.companyId })
    await admin('user.assignRole', { id: `${userId}:${role}`, userId, roleId: role })
    const client = app.client.anonymous().with({ followRedirects: true })
    await client.login({ login: userId, password: PASSWORD })
    return async (fn: string, input: Row) => {
      const response = await client.request(`/_ket/fn/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = (await response.json()) as Row
      return { status: response.status, value: (body.value ?? body) as Row }
    }
  }
  const kho = await signedIn('kho', 'commerce.warehouse-manager')
  const ketoan = await signedIn('ketoan', 'commerce.accountant')
  const banhang = await signedIn('banhang', 'commerce.sales-representative')

  await admin('uom.saveUnit', { id: 'unit', name: 'Chai', relativeFactor: '1' })
  await admin('product.saveTemplate', {
    id: 'other',
    name: 'Toner',
    type: 'goods',
    uomId: 'unit',
    listPrice: '90',
    barcode: '8930000000019',
  })
  await admin('product.saveTemplate', {
    id: 'tee',
    name: 'Serum',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
  })
  await admin('product.saveAttribute', { id: 'size', name: 'Dung tích', createVariant: 'always' })
  for (const id of ['s30', 's50'])
    await admin('product.saveAttributeValue', { id, attributeId: 'size', name: id })
  await admin('product.saveAttributeLine', {
    id: 'tee:size',
    templateId: 'tee',
    attributeId: 'size',
    valueIds: ['s30', 's50'],
  })
  const generated = await admin<{ ids: string[] }>('product.generateVariants', { templateId: 'tee' })
  const variant = generated.ids.find((id) => id !== 'tee:default')!
  const stored = async () => {
    const row = (
      await app.adapter!.all('SELECT barcode, "hsCode" FROM product_product WHERE id = ?', [variant])
    )[0]!
    return { barcode: row.barcode, hsCode: row.hsCode }
  }

  // The variant dialog opens for each group: the context says which one the viewer holds.
  for (const [who, call, stock, catalogue] of [
    ['kho', kho, true, false],
    ['ketoan', ketoan, false, false],
  ] as const) {
    const context = await call('product.templateModalContext', { id: 'tee' })
    const permissions = (context.value.data as { permissions: Record<string, boolean> }).permissions
    assert.equal(permissions.saveVariantStock, stock, `${who}: stock group`)
    assert.equal(permissions.saveVariantSetup, catalogue, `${who}: catalogue group`)
  }

  // The stock manager: barcode and HS code in one save; the HS code is kept as its digits.
  const saved = await kho('product.saveVariantStock', {
    productId: variant,
    barcode: '8930000000026',
    hsCode: '3304.99',
  })
  assert.equal(saved.value.ok, true, JSON.stringify(saved))
  assert.deepEqual(await stored(), { barcode: '8930000000026', hsCode: '330499' })
  // A value left out stays as saved.
  assert.equal(
    (await kho('product.saveVariantStock', { productId: variant, barcode: '8930000000033' })).value.ok,
    true,
  )
  assert.deepEqual(await stored(), { barcode: '8930000000033', hsCode: '330499' })
  // A refused value writes nothing, the other one included.
  assert.deepEqual(
    (await kho('product.saveVariantStock', { productId: variant, barcode: '8930000000040', hsCode: '12' }))
      .value.errors,
    [{ field: 'hsCode', code: 'product.error.variant.hsCode' }],
  )
  assert.deepEqual(
    (await kho('product.saveVariantStock', { productId: variant, barcode: '8930000000019', hsCode: '3304' }))
      .value.errors,
    [{ field: 'barcode', code: 'product.error.template.barcodeTaken' }],
  )
  assert.deepEqual(await stored(), { barcode: '8930000000033', hsCode: '330499' })
  // The catalogue's part of the variant is not the stock manager's.
  assert.equal(
    (await kho('product.saveVariantSetup', { templateId: 'tee', lines: [], variants: [] })).status,
    403,
  )

  // The accountant sets the variant cost and nothing of its stock setup.
  assert.equal((await ketoan('product.setCost', { productId: variant, standardPrice: '45' })).value.ok, true)
  assert.equal((await ketoan('product.saveVariantStock', { productId: variant, hsCode: '3304' })).status, 403)
  // Who only sells changes none of it.
  assert.equal(
    (await banhang('product.saveVariantStock', { productId: variant, hsCode: '3304' })).status,
    403,
  )
  assert.deepEqual(await stored(), { barcode: '8930000000033', hsCode: '330499' })
})
