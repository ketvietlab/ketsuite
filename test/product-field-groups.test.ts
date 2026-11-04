// P5/P17/P18: a product record has three field groups with their own editors, and
// its type and unit are fixed once it exists. A changed value in a group the role
// may not edit is refused with E_FN_NOT_PERMITTED (403), never silently dropped.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import type { Row, Scope } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'

const groups = {
  'commerce.company-administrator': { general: true, stock: true, accounting: true },
  'commerce.sales-manager': { general: true, stock: true, accounting: true },
  'commerce.warehouse-manager': { general: false, stock: true, accounting: false },
  'commerce.accountant': { general: false, stock: false, accounting: true },
  'commerce.sales-representative': { general: false, stock: false, accounting: false },
} as const

test('commerce roles edit the product field groups P17 gives them, and nothing else', async (t) => {
  const booted = await bootDeployment(commerce, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'product-field-groups' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  let scope: Scope = { company: null, branch: null }
  const run = (fn: string, args: Record<string, unknown>, actor: string | null) =>
    callFn(fn, args, { adapter: booted.adapter!, manifest: booted.manifest, actor, scope })
  const call = async <T = Row>(fn: string, args: Record<string, unknown>, actor: string | null) =>
    (await run(fn, args, actor)).value as T
  const refusal = async (fn: string, args: Record<string, unknown>, actor: string) => {
    try {
      await run(fn, args, actor)
    } catch (error) {
      return (error as { code?: string }).code
    }
    return 'accepted'
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
  assert.equal((await call('user.syncRoleTemplates', {}, 'system:role-templates')).ok, true)
  scope = { company: tenant.companyId, companies: [tenant.companyId], branch: tenant.branchId }
  const admin = tenant.userId
  await call('uom.saveUnit', { id: 'unit', name: 'Chai', relativeFactor: '1' }, admin)
  await call('uom.saveUnit', { id: 'box', name: 'Hộp', relativeFactor: '1' }, admin)
  const base = { id: 'serum', name: 'Serum B5', type: 'goods', uomId: 'unit', listPrice: '100' }
  assert.equal((await call('product.saveTemplate', { ...base, barcode: '8930000000019' }, admin)).ok, true)

  const revision = async () => String((await call('product.getTemplate', { id: 'serum' }, admin)).revisionId)
  const edit = async (fields: Record<string, unknown>) => ({
    ...base,
    expectedRevisionId: await revision(),
    ...fields,
  })
  for (const [role, may] of Object.entries(groups)) {
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
    assert.equal(keys.has('product.saveTemplate'), may.general, `${role}: general fields`)
    assert.equal(keys.has('product.setBarcode'), may.stock, `${role}: stock fields`)
    assert.equal(keys.has('product.setCost'), may.accounting, `${role}: accounting fields`)
    assert.equal(
      keys.has('product.saveRecord'),
      may.general || may.stock || may.accounting,
      `${role}: the page's one save`,
    )
  }

  // A role with the general fields only: an unchanged barcode passes, a changed one is refused.
  await call('user.saveRole', { id: 'general-only', name: 'General fields only' }, admin)
  for (const fnKey of ['product.saveTemplate', 'product.getTemplate', 'product.saveVariant'])
    await call('user.grantFunction', { id: `general-only:${fnKey}`, roleId: 'general-only', fnKey }, admin)
  await call('user.createUser', { id: 'editor', login: 'editor', name: 'Editor' }, null)
  await call(
    'user.grantCompany',
    { id: 'editor:company', userId: 'editor', companyId: tenant.companyId },
    admin,
  )
  await call(
    'user.assignRole',
    { id: 'editor:general-only', userId: 'editor', roleId: 'general-only' },
    admin,
  )
  const unchanged = await call(
    'product.saveTemplate',
    await edit({ name: 'Serum B5 mới', barcode: '8930000000019' }),
    'editor',
  )
  assert.equal(unchanged.ok, true, JSON.stringify(unchanged))
  assert.equal(
    await refusal('product.saveTemplate', await edit({ barcode: '8930000000026' }), 'editor'),
    'E_FN_NOT_PERMITTED',
    'a changed barcode needs stock setup',
  )
  assert.equal(
    await refusal(
      'product.saveVariant',
      { id: 'serum:default', templateId: 'serum', barcode: null },
      'editor',
    ),
    'E_FN_NOT_PERMITTED',
    'clearing it is a change too',
  )
  const [stored] = await booted.adapter!.all('SELECT barcode FROM product_product WHERE id = ?', [
    'serum:default',
  ])
  assert.equal(stored?.barcode, '8930000000019', 'the refusal changed nothing')

  // The stock field group on its own, for the warehouse manager.
  const before = await call('product.getTemplate', { id: 'serum' }, admin)
  const set = await call(
    'product.setBarcode',
    { productId: 'serum:default', barcode: '8930000000026' },
    'warehouse-manager',
  )
  assert.equal(set.ok, true, JSON.stringify(set))
  const after = await call('product.getTemplate', { id: 'serum' }, admin)
  assert.notEqual(
    after.revisionId,
    before.revisionId,
    'a page opened before the barcode changed cannot save over it',
  )
  const taken = await call(
    'product.saveTemplate',
    { id: 'other', name: 'Other', type: 'goods', uomId: 'unit' },
    admin,
  )
  assert.equal(taken.ok, true)
  const collision = await call<{ ok: boolean; errors: Row[] }>(
    'product.setBarcode',
    { productId: 'other:default', barcode: '8930000000026' },
    'warehouse-manager',
  )
  assert.deepEqual(
    collision.errors.map((error) => error.field),
    ['barcode'],
  )

  // P18: type and unit are chosen once.
  const typed = await call<{ ok: boolean; errors: Row[] }>(
    'product.saveTemplate',
    await edit({ type: 'service' }),
    admin,
  )
  assert.deepEqual(typed.errors, [{ field: 'type', code: 'product.error.template.typeLocked' }])
  const unit = await call<{ ok: boolean; errors: Row[] }>(
    'product.saveTemplate',
    await edit({ uomId: 'box' }),
    admin,
  )
  assert.deepEqual(unit.errors, [{ field: 'uomId', code: 'product.error.template.uomLocked' }])
  assert.equal(
    (await call('product.saveTemplate', await edit({}), admin)).ok,
    true,
    'the same type and unit save',
  )

  // P17: the page saves its three groups in one command, each group checked on its own.
  const page = async (fields: Record<string, unknown>) => {
    const saved = await call('product.getTemplate', { id: 'serum' }, admin)
    return {
      id: 'serum',
      name: saved.name,
      type: saved.type,
      expectedRevisionId: saved.revisionId,
      ...fields,
    }
  }
  const costOf = async () =>
    (
      await booted.adapter!.all('SELECT standardPrice FROM product_cost WHERE productId = ?', [
        'serum:default',
      ])
    )[0]?.standardPrice ?? null
  const stockOf = async () =>
    (
      await booted.adapter!.all('SELECT isStorable, tracking, listPrice FROM product_template WHERE id = ?', [
        'serum',
      ])
    )[0]

  const costed = await call('product.saveRecord', await page({ costPrice: '60' }), 'accountant')
  assert.equal(costed.ok, true, JSON.stringify(costed))
  assert.equal(Number(await costOf()), 60, 'the accountant saves the cost from the page')
  assert.equal(
    await refusal('product.saveRecord', await page({ costPrice: '70', listPrice: '120' }), 'accountant'),
    'E_FN_NOT_PERMITTED',
    'a general field the accountant changed refuses the whole save',
  )
  assert.equal(Number(await costOf()), 60, 'and the cost beside it is not written')

  const stocked = await call(
    'product.saveRecord',
    await page({ barcode: '8930000000033', isStorable: true, tracking: 'lot' }),
    'warehouse-manager',
  )
  assert.equal(stocked.ok, true, JSON.stringify(stocked))
  assert.equal(Boolean((await stockOf())?.isStorable), true)
  assert.equal((await stockOf())?.tracking, 'lot', 'the warehouse manager saves the stock setup')
  // The HS code is stock setup, on the template as on a variant.
  const classified = await call('product.saveRecord', await page({ hsCode: '3304.99' }), 'warehouse-manager')
  assert.equal(classified.ok, true, JSON.stringify(classified))
  const [classifiedRow] = await booted.adapter!.all('SELECT hsCode FROM product_template WHERE id = ?', [
    'serum',
  ])
  assert.equal(classifiedRow?.hsCode, '330499', 'the warehouse manager classifies the product')
  assert.equal(
    await refusal('product.saveRecord', await page({ hsCode: '3304.10' }), 'accountant'),
    'E_FN_NOT_PERMITTED',
    "the HS code is not the accountant's",
  )
  assert.equal(
    await refusal('product.saveTemplate', await edit({ hsCode: '3304.10' }), 'editor'),
    'E_FN_NOT_PERMITTED',
    'nor part of the general fields',
  )
  assert.equal(
    await refusal('product.saveRecord', await page({ costPrice: '80' }), 'warehouse-manager'),
    'E_FN_NOT_PERMITTED',
    "the cost is not the warehouse manager's",
  )
  assert.equal(
    await refusal('product.saveRecord', await page({ isStorable: false, tracking: 'none' }), 'accountant'),
    'E_FN_NOT_PERMITTED',
    "the stock setup is not the accountant's",
  )
  assert.equal(
    await refusal('product.saveRecord', await page({ listPrice: '125' }), 'sales-representative'),
    'E_FN_NOT_PERMITTED',
    'a role with no group changes nothing',
  )
  // Every general field the save writes is checked, not only the ones the page shows.
  const doc = JSON.stringify([{ id: 'summary', type: 'p', delta: [{ insert: 'Ghi đè' }] }])
  for (const forged of [{ summaryDoc: doc }, { descriptionDoc: doc }])
    assert.equal(
      await refusal('product.saveRecord', await page(forged), 'accountant'),
      'E_FN_NOT_PERMITTED',
      `${Object.keys(forged)[0]} is a general field`,
    )
  const [described] = await booted.adapter!.all(
    'SELECT summaryDoc, descriptionDoc FROM product_template WHERE id = ?',
    ['serum'],
  )
  assert.equal(String(described?.descriptionDoc ?? '').includes('Ghi đè'), false, 'no forged description')
  assert.equal(String(described?.summaryDoc ?? '').includes('Ghi đè'), false, 'no forged summary')
  assert.equal(
    (await call('product.saveTemplate', { id: 'unitless', name: 'Unitless', type: 'goods' }, admin)).ok,
    true,
  )
  const unitless = await call('product.getTemplate', { id: 'unitless' }, admin)
  assert.equal(
    await refusal(
      'product.saveRecord',
      {
        id: 'unitless',
        name: 'Unitless',
        type: 'goods',
        expectedRevisionId: unitless.revisionId,
        uomId: 'box',
      },
      'accountant',
    ),
    'E_FN_NOT_PERMITTED',
    'giving a product its first unit is a general change',
  )

  // One revision for the whole page: a stale save writes none of its groups.
  const stale = await page({ costPrice: '90', listPrice: '130', isStorable: false, tracking: 'none' })
  await call('product.saveRecord', await page({ origin: 'Việt Nam' }), admin)
  const conflict = await call<{ ok: boolean; errors: Row[] }>('product.saveRecord', stale, admin)
  assert.deepEqual(
    conflict.errors.map((error) => error.field),
    ['expectedRevisionId'],
  )
  assert.equal(Number(await costOf()), 60, 'no cost from a stale page')
  assert.equal((await stockOf())?.tracking, 'lot', 'no stock setup from a stale page')
  assert.equal(Number((await stockOf())?.listPrice), 100, 'no price from a stale page')
  const whole = await call(
    'product.saveRecord',
    await page({ costPrice: '90', listPrice: '130', isStorable: false, tracking: 'none' }),
    admin,
  )
  assert.equal(whole.ok, true, JSON.stringify(whole))
  assert.deepEqual(
    [Number(await costOf()), (await stockOf())?.tracking, Number((await stockOf())?.listPrice)],
    [90, 'none', 130],
    'a fresh page saves every group together',
  )
  const tracked = await call<{ ok: boolean; errors: Row[] }>(
    'product.saveRecord',
    await page({ isStorable: false, tracking: 'serial' }),
    admin,
  )
  assert.deepEqual(tracked.errors, [{ field: 'tracking', code: 'product.error.template.tracking' }])
})
