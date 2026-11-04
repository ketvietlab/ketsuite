import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, partner, pricing, product, stock, uom, user } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user, uom, product, pricing, stock]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }

async function call(name: string, args: Record<string, unknown>, adapter: Adapter) {
  return (await callFn(name, args, { adapter, manifest, scope })).value as Row
}

test('stock: fractional moves that net to nothing leave a plain zero on the shelf', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, manifest)
    registerFunctions(modules)
    await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
    await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
    await call('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' }, adapter)
    await call(
      'product.saveTemplate',
      { id: 'tpl', name: 'Nho', type: 'goods', uomId: 'kg', listPrice: '100' },
      adapter,
    )
    await call(
      'product.saveVariant',
      { id: 'p1', templateId: 'tpl', defaultCode: 'NHO', combinationKey: '' },
      adapter,
    )
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
    await call('stock.saveLocation', { id: 'inv', name: 'Inventory', usage: 'inventory' }, adapter)
    await call(
      'stock.adjustInventory',
      {
        id: 'count',
        productId: 'p1',
        locationId: 'wh:stock',
        inventoryLocationId: 'inv',
        countedQuantity: '0.3',
        productUomId: 'kg',
      },
      adapter,
    )
    // 0.3 − 0.1 − 0.2 is −2.8e-17 in binary floating point; written as String() that is
    // an exponent, which the datastore rightly refuses as a decimal.
    for (const [id, quantity] of [
      ['s1', '0.1'],
      ['s2', '0.2'],
    ] as const) {
      assert.equal(
        (
          await call(
            'stock.saveScrap',
            { id, warehouseId: 'wh', productId: 'p1', quantity, reason: 'damaged' },
            adapter,
          )
        ).ok,
        true,
      )
      assert.equal((await call('stock.validateScrap', { id }, adapter)).ok, true, `scrap ${id} validates`)
    }
    const quant = (
      await adapter.all('SELECT quantity FROM stock_quant WHERE "locationId"=?', ['wh:stock'])
    )[0]!
    assert.equal(quant.quantity, '0')
  } finally {
    await adapter.close()
  }
})

test('stock: reserving the last billionth of a kilo writes a plain decimal move line', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, manifest)
    registerFunctions(modules)
    await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
    await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
    await call('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' }, adapter)
    await call(
      'product.saveTemplate',
      { id: 'tpl', name: 'Nho', type: 'goods', uomId: 'kg', listPrice: '100' },
      adapter,
    )
    await call(
      'product.saveVariant',
      { id: 'p1', templateId: 'tpl', defaultCode: 'NHO', combinationKey: '' },
      adapter,
    )
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
    await call('stock.saveLocation', { id: 'inv', name: 'Inventory', usage: 'inventory' }, adapter)
    await call(
      'stock.adjustInventory',
      {
        id: 'count',
        productId: 'p1',
        locationId: 'wh:stock',
        inventoryLocationId: 'inv',
        countedQuantity: '2.000000001',
        productUomId: 'kg',
      },
      adapter,
    )
    await call('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' }, adapter)
    // After the first move holds 2 kg, 2.000000001 − 2 is 1.00000008e-9 in binary floating point,
    // which String() writes as an exponent the datastore refuses.
    for (const [id, quantity] of [
      ['m1', '2'],
      ['m2', '1'],
    ] as const) {
      const added = await call(
        'stock.addMove',
        {
          id,
          name: id,
          productId: 'p1',
          productUomId: 'kg',
          productUomQty: quantity,
          locationId: 'wh:stock',
          locationDestId: 'customer',
        },
        adapter,
      )
      assert.equal(added.ok, true, `move ${id} is added`)
      assert.equal((await call('stock.reserveMove', { id }, adapter)).ok, true, `move ${id} reserves`)
    }
    const line = (
      await adapter.all('SELECT quantity FROM stock_move_line WHERE "moveId"=? AND "locationId"=?', [
        'm2',
        'wh:stock',
      ])
    )[0]!
    assert.equal(line.quantity, '0.000000001')
  } finally {
    await adapter.close()
  }
})
