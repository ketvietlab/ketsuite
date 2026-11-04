import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/** A confirmed order of two delivered, with the books a sales invoice needs. */
async function seed(t: TestContext) {
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'each',
  })
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  await r.save('sale.confirmOrder', { id: 'order' })
  const order = () => r.call('sale.getOrder', { id: 'order' })
  const move = ((await order()).moves as Row[])[0]!
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.reserveMove', { id: move.id })
  const picking = await r.call('stock.getPicking', { id: 'order:delivery' })
  const picked = ((picking.moves as Row[])[0]!.lines as Row[])[0]!
  await r.save('stock.completePicking', {
    id: 'order:delivery',
    quantities: [{ moveLineId: picked.id, quantity: 2 }],
    createBackorder: false,
  })
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('account.saveJournal', { id: 'misc', name: 'Misc', code: 'MISC', type: 'general' })
  const invoice = (id: string) =>
    r.call('sale.createInvoice', {
      id,
      orderId: 'order',
      journalId: 'journal',
      revenueAccountId: 'revenue',
      receivableAccountId: 'receivable',
    })
  const invoiced = async () => {
    const current = await order()
    return [String(Number((current.lines as Row[])[0]!.qtyInvoiced)), current.invoiceStatus]
  }
  return { ...r, order, invoice, invoiced }
}

test('D10 a cancelled draft invoice no longer counts as invoiced, and the order invoices again', async (t) => {
  const r = await seed(t)
  assert.equal((await r.invoice('first')).ok, true)
  assert.deepEqual(await r.invoiced(), ['2', 'invoiced'])
  assert.equal((await r.call('account.cancelMove', { id: 'first' })).ok, true)
  assert.deepEqual(await r.invoiced(), ['0', 'to invoice'])
  assert.equal((await r.invoice('second')).ok, true)
  assert.deepEqual(await r.invoiced(), ['2', 'invoiced'])
})

test('D10 a reversed posted invoice no longer counts as invoiced', async (t) => {
  const r = await seed(t)
  assert.equal((await r.invoice('first')).ok, true)
  assert.equal((await r.call('account.postMove', { id: 'first' })).ok, true)
  const reversed = await r.call('account.reverseMove', { id: 'first', reversalId: 'undo', journalId: 'misc' })
  assert.equal(reversed.ok, true, JSON.stringify(reversed))
  assert.deepEqual(await r.invoiced(), ['0', 'to invoice'])
})

test('D8 invoicing a sales order is the accountant’s: sellers read the order but cannot invoice it', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (roleId: string) => {
    const id = roleId.replace('commerce.', '')
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    const client = r.app.client.anonymous()
    await client.login({ login: id, password: 'test-password' })
    return client
  }
  const post = (client: Awaited<ReturnType<typeof login>>, fn: string, args: Row) =>
    client.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
  const invoiceArgs = (id: string) => ({
    id,
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  for (const [roleId, reads, invoices] of [
    ['commerce.accountant', 200, 200],
    ['commerce.sales-manager', 200, 403],
    ['commerce.sales-representative', 200, 403],
  ] as const) {
    const client = await login(roleId)
    assert.equal((await post(client, 'sale.getOrder', { id: 'order' })).status, reads, roleId)
    const page = await client.request('/admin/sales/orders/order?lang=vi')
    assert.equal(page.status, reads, `${roleId} page`)
    assert.equal(
      (await post(client, 'sale.createInvoice', invoiceArgs(`${roleId}-invoice`))).status,
      invoices,
      roleId,
    )
  }
})
