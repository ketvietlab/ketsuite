import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot, setup } from './fixtures/sale/commerce.ts'

test('P14 policy fact is scoped, minimal and current for goods, services and archived records', async (t) => {
  const r = await boot(t)
  for (const type of ['goods', 'service']) {
    await r.save('product.saveRecord', {
      id: type,
      name: type,
      type,
      uomId: 'each',
      defaultCode: type.toUpperCase(),
    })
    assert.deepEqual(await r.call('sale.getProductInvoicePolicy', { templateId: type }), {
      invoicePolicy: 'order',
    })
    // A service is always invoiced by ordered quantities (D21).
    if (type === 'goods')
      await r.save('sale.setInvoicePolicy', { templateId: type, invoicePolicy: 'delivery' })
    else
      assert.deepEqual(
        (await r.call('sale.setInvoicePolicy', { templateId: type, invoicePolicy: 'delivery' })).errors,
        [{ field: 'invoicePolicy', messageKey: 'sale.error.invoicePolicy.service' }],
      )
    for (const lang of ['vi', 'en']) {
      const response = await r.app.client.get(`/admin/product/templates/${type}/context?lang=${lang}`)
      assert.equal(response.status, 200)
      const body = (await response.json()) as { data: Row; messages: Row }
      assert.equal(body.data.invoicePolicy, type === 'goods' ? 'delivery' : 'order')
      assert.equal(
        body.messages['product_backend.ws.invoicePolicy.delivery'],
        lang === 'vi' ? 'Theo số lượng giao' : 'Delivered quantities',
      )
    }
  }
  const current = await r.call('product.templateModalContext', { id: 'goods', locale: 'en' })
  await r.save('product.archiveTemplate', {
    id: 'goods',
    active: false,
    confirmed: true,
    reason: 'No longer offered',
    expectedRevisionId: ((current.data as Row).record as Row).revisionId,
  })
  assert.deepEqual(await r.call('sale.getProductInvoicePolicy', { templateId: 'goods' }), {
    invoicePolicy: 'delivery',
  })
  // Without its own policy, goods follow the company default (D20, D21).
  await r.save('sale.saveConfiguration', { goodsInvoicePolicy: 'delivery', expectedRevision: 0 })
  await r.save('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: null })
  assert.deepEqual(await r.call('sale.getProductInvoicePolicy', { templateId: 'goods' }), {
    invoicePolicy: 'delivery',
  })
  await r.fixture('uom.saveUnit', { id: 'other-each', name: 'Other unit', relativeFactor: '1' }, 'other')
  const foreign = await r.fixture(
    'product.saveRecord',
    { id: 'foreign', name: 'Secret', type: 'service', uomId: 'other-each', defaultCode: 'SECRET' },
    'other',
  )
  assert.equal(foreign.ok, true, JSON.stringify(foreign))
  assert.deepEqual(await r.fixture('sale.getProductInvoicePolicy', { templateId: 'foreign' }, 'other'), {
    invoicePolicy: 'order',
  })
  assert.equal(await r.call('sale.getProductInvoicePolicy', { templateId: 'foreign' }), null)
  assert.equal(await r.call('sale.getProductInvoicePolicy', { templateId: 'missing' }), null)
  assert.equal(
    ((await (await r.app.client.get('/admin/product/templates/new/context')).json()) as { data: Row }).data
      .invoicePolicy,
    null,
  )
})

test('P14 combos have no independent policy and the scoped reader never returns prices', async (t) => {
  const r = await setup(t)
  await r.save('product.saveCombo', {
    id: 'choice',
    name: 'Choice',
    items: [{ productId: r.productId, extraPrice: '0' }],
  })
  await r.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    type: 'combo',
    uomId: 'each',
    defaultCode: 'COMBO',
    comboIds: ['choice'],
  })
  assert.equal(await r.call('sale.getProductInvoicePolicy', { templateId: 'combo' }), null)
  const response = await r.app.client.get('/admin/product/templates/combo/context')
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as { data: Row }).data.invoicePolicy, null)
  assert.deepEqual(Object.keys(await r.call('sale.getProductInvoicePolicy', { templateId: 'goods' })), [
    'invoicePolicy',
  ])
})

test('P14 context keeps stock, sales, accounts and policy independently permission-filtered', async (t) => {
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'count',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '30',
    productUomId: 'each',
  })
  assert.equal((await r.add()).ok, true)
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.fixture('user.saveRole', { id: 'limited', name: 'Limited' })
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'limited' })
  const grant = (fnKey: string) => r.fixture('user.grantFunction', { id: fnKey, roleId: 'limited', fnKey })
  await grant('product.getTemplate')
  await grant('product.templateModalContext')
  const client = r.app.client.anonymous()
  await client.login({ login: 'reader', password: 'test-password' })
  const read = async () => {
    const response = await client.get('/admin/product/templates/goods/context')
    assert.equal(response.status, 200)
    return ((await response.json()) as { data: Row }).data
  }
  const hidden = await read()
  for (const key of ['invoicePolicy', 'accounts', 'stock', 'sales', 'margin'])
    assert.equal(hidden[key], null, key)
  await assert.rejects(client.call('sale.getProductInvoicePolicy', { templateId: 'goods' }), { status: 403 })
  await grant('sale.getProductInvoicePolicy')
  await grant('sale.productSales')
  const sales = await read()
  assert.equal(sales.invoicePolicy, 'order')
  assert.equal(sales.accounts, null)
  assert.equal(sales.stock, null)
  assert.equal((sales.sales as Row).quantity, 24)
  assert.equal((sales.sales as Row).orders, 1)
  assert.equal((sales.sales as Row).revenue, null)
  assert.equal(sales.margin, null)
  await grant('stock.productWorkspace')
  const stock = await read()
  assert.equal(((stock.stock as Row).totals as Row).onHand, 30)
  assert.equal((stock.sales as Row).revenue, null)
  assert.equal(stock.accounts, null)
  assert.equal(stock.margin, null)
})
