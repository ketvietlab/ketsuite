// The product catalogue through the job roles a tenant actually assigns, not
// through functions granted one by one: every role that reads products can open
// the list, its images and its activity, and only the roles that price, buy or
// audit read what a product cost.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import type { Scope } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'
import type { ProductListAnswer } from '../packages/ketsuite/src/modules/product_backend/list/read.ts'

const roles = {
  'commerce.company-administrator': { cost: true, activity: true },
  'commerce.tenant-auditor': { cost: true, activity: false },
  'commerce.sales-representative': { cost: false, activity: true },
  'commerce.sales-manager': { cost: true, activity: true },
  'commerce.purchasing-operator': { cost: true, activity: true },
  'commerce.purchasing-manager': { cost: true, activity: true },
  'commerce.warehouse-operator': { cost: false, activity: true },
  'commerce.warehouse-manager': { cost: false, activity: true },
} as const

test('commerce job roles open the product catalogue, and only some of them read its cost', async (t) => {
  const booted = await bootDeployment(commerce, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'product-role-access' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  let scope: Scope = { company: null, branch: null }
  const call = async <T>(fn: string, args: Record<string, unknown>, actor: string | null) => {
    const result = await callFn(fn, args, {
      adapter: booted.adapter!,
      manifest: booted.manifest,
      actor,
      scope,
    })
    return result.value as T
  }

  const tenant = await call<{ ok: boolean; companyId: string; branchId: string; userId: string }>(
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
  const synced = await call<{ ok: boolean }>('user.syncRoleTemplates', {}, 'system:role-templates')
  assert.equal(synced.ok, true, JSON.stringify(synced))
  scope = { company: tenant.companyId, companies: [tenant.companyId], branch: tenant.branchId }
  const admin = tenant.userId

  await call('uom.saveUnit', { id: 'unit', name: 'Chai', relativeFactor: '1' }, admin)
  const saved = await call<{ ok: boolean }>(
    'product.saveTemplate',
    { id: 'serum', name: 'Serum B5', type: 'goods', uomId: 'unit', listPrice: '100', saleOk: true },
    admin,
  )
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const cost = await call<{ ok: boolean }>(
    'product.setCost',
    { productId: 'serum:default', standardPrice: '60' },
    admin,
  )
  assert.equal(cost.ok, true, JSON.stringify(cost))

  for (const [role, expected] of Object.entries(roles)) {
    const userId = role.replace('commerce.', '')
    await call('user.createUser', { id: userId, login: userId, name: userId }, null)
    await call('user.grantCompany', { id: `${userId}:company`, userId, companyId: tenant.companyId }, admin)
    await call('user.assignRole', { id: `${userId}:${role}`, userId, roleId: role }, admin)

    const permitted = await call<{ functions: Array<{ key: string } | string> }>(
      'user.permitted',
      { userId },
      admin,
    )
    const keys = new Set(permitted.functions.map((entry) => (typeof entry === 'string' ? entry : entry.key)))
    // Commerce composes stock, so the list's read is stock's.
    for (const fn of [
      'product.listTemplates',
      'stock_backend.searchProductTemplates',
      'product_backend.searchTemplates',
      'product_media.listPrimaryMedia',
      'product.getVariant',
    ])
      assert.ok(keys.has(fn), `${role} calls ${fn}`)
    assert.equal(keys.has('product_mail_backend.timeline'), expected.activity, `${role}: activity`)
    assert.equal(keys.has('product_mail_backend.post'), false, `${role} does not post`)
    assert.equal(keys.has('product.listVariantCosts'), expected.cost, `${role}: cost`)

    const list = await call<ProductListAnswer>(
      'stock_backend.searchProductTemplates',
      { href: '/admin/product/templates' },
      userId,
    )
    assert.deepEqual(
      [list.rows.map((row) => row.id), list.money],
      [['serum'], expected.cost],
      `${role}: list`,
    )
    const variant = await call<Record<string, unknown>>('product.getVariant', { id: 'serum:default' }, userId)
    assert.equal('cost' in variant, expected.cost, `${role}: variant cost`)
    if (expected.cost) assert.equal(Number((variant.cost as { standardPrice: string }).standardPrice), 60)
  }
})
