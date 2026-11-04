import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
import { selectProductSupplier } from '../packages/ketsuite/src/modules/purchase/supplier-selection.ts'

async function seed(t: TestContext) {
  const run = await boot(t)
  const { save } = run
  await save('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'each', relativeFactor: '12' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'GOODS',
    purchaseOk: true,
  })
  for (const id of ['vendor', 'second']) {
    await save('partner.savePartner', { id, kind: 'company', name: id })
    await save('partner.grantRole', { id: `${id}-role`, partnerId: id, role: 'supplier' })
  }
  await save('stock.saveLocation', { id: 'supplier', name: 'Supplier', usage: 'supplier' })
  await save('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' })
  await save('stock.savePickingType', {
    id: 'incoming',
    name: 'Receipt',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  await save('purchase.createOrder', {
    id: 'po',
    partnerId: 'vendor',
    pickingTypeId: 'incoming',
    dateOrder: '2026-10-23T00:00:00.000Z',
  })
  const supplier = (id: string, fields: Row = {}) =>
    save('purchase.saveSupplierInfo', {
      id,
      partnerId: 'vendor',
      productTemplateId: 'goods',
      productUomId: 'each',
      price: '80',
      sequence: 1,
      ...fields,
    })
  const add = (id: string, quantity: string, fields: Row = {}) =>
    save('purchase.addLine', {
      id,
      orderId: 'po',
      productId: 'goods:default',
      productUomId: 'each',
      productQty: quantity,
      ...fields,
    })
  const line = async (id: string) =>
    ((await run.call('purchase.getOrder', { id: 'po' })).lines as Row[]).find((row) => row.id === id)!
  return { ...run, supplier, add, line }
}

test('P49 purchase uses grid order before variant, minimum quantity or cheapest price', async (t) => {
  const r = await seed(t)
  await r.supplier('first', {
    minQty: '500',
    price: '17200',
    sequence: 1,
    delay: 10,
    productName: 'First supplier item',
  })
  await r.supplier('later', {
    productId: 'goods:default',
    minQty: '100',
    price: '100',
    sequence: 2,
    delay: 5,
  })
  await r.add('large', '600')
  assert.equal((await r.line('large')).priceUnit, '17200')
  assert.equal((await r.line('large')).name, 'First supplier item')
  assert.equal((await r.line('large')).datePlanned, '2026-11-02T00:00:00.000Z')
  await r.add('medium', '200')
  assert.equal((await r.line('medium')).priceUnit, '100')
  await r.add('small', '1')
  assert.equal((await r.line('small')).priceUnit, '17200')
  await r.supplier('later', { productId: 'goods:default', minQty: '100', price: '100', sequence: 0 })
  await r.add('reordered', '600')
  assert.equal((await r.line('reordered')).priceUnit, '100')
})

test('P49 purchase converts thresholds and prices in supplier units and preserves explicit prices', async (t) => {
  const r = await seed(t)
  await r.supplier('pieces', { minQty: '10', price: '80', discount: '5' })
  await r.supplier('lower-tier', { minQty: '1', price: '50', sequence: 2 })
  await r.add('box-line', '1', { productUomId: 'box' })
  const line = await r.line('box-line')
  assert.equal(line.priceUnit, '960')
  assert.equal(line.discount, '5')
  await r.add('manual', '1', { productUomId: 'box', priceUnit: '999', discount: '2' })
  assert.equal((await r.line('manual')).priceUnit, '999')
  assert.equal((await r.line('manual')).discount, '2')
  await r.add('fallback-box', '0.01', { productUomId: 'box' })
  assert.equal((await r.line('fallback-box')).priceUnit, '960')
})

test('P49 excludes expired, future, foreign-company and inactive supplier rows without switching order vendor', async (t) => {
  const r = await seed(t)
  await r.supplier('expired', { price: '1', sequence: 0, dateEnd: '2026-10-22T23:59:59.000Z' })
  await r.supplier('future', { price: '2', sequence: 0, dateStart: '2026-10-24T00:00:00.000Z' })
  await r.supplier('other-vendor', { partnerId: 'second', price: '3', sequence: 0 })
  await r.supplier('valid', { price: '80', minQty: '500', sequence: 2 })
  await r.app.adapter!.exec(`UPDATE purchase_supplier_info SET "companyId" = 'other' WHERE id = 'future'`)
  await r.add('valid-line', '1')
  assert.equal((await r.line('valid-line')).priceUnit, '80')
  await r.save('partner.archivePartner', { id: 'vendor', active: false })
  await r.add('inactive', '1')
  assert.equal((await r.line('inactive')).priceUnit, '0')
})

test('P49 shared selection applies variant membership and active-company fallback across vendors', async () => {
  const rows: Row[] = [
    { id: 'foreign', companyId: 'other', partnerId: 'v1', sequence: 0, minQty: '0' },
    { id: 'wrong-variant', companyId: 'acme', partnerId: 'v1', productId: 'wrong', sequence: 0, minQty: '0' },
    { id: 'inactive', companyId: 'acme', partnerId: 'retired', sequence: 0, minQty: '0' },
    { id: 'first', companyId: 'acme', partnerId: 'v1', sequence: 1, minQty: '500' },
    { id: 'second', companyId: 'acme', partnerId: 'v2', productId: 'sku', sequence: 2, minQty: '100' },
  ].map((row) => ({ ...row, productUomId: 'each' }))
  const ctx = {
    scope: { company: 'acme' },
    db: {
      select: async (model: string, query: Row) => {
        if (model === 'product.Product') return [{ id: 'sku', templateId: 'template' }]
        if (model === 'product.Template') return [{ id: 'template' }]
        if (model === 'purchase.SupplierInfo') return rows
        if (model === 'partner.Partner') return [{ id: query.id, active: query.id !== 'retired' }]
        throw new Error(model)
      },
    },
  } as unknown as Ctx
  const select = (quantity: number) =>
    selectProductSupplier(ctx, { productId: 'sku', quantity, uomId: 'each', at: '2026-10-23T00:00:00.000Z' })
  assert.equal((await select(600))?.row.id, 'first')
  assert.equal((await select(200))?.row.id, 'second')
  assert.equal((await select(1))?.row.id, 'first')
  assert.equal(await select(Number.NaN), null)
})
