import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

async function hierarchy(t: TestContext) {
  const run = await setup(t)
  for (const [id, parentId] of [
    ['root', null],
    ['child', 'root'],
    ['leaf', 'child'],
    ['other-root', null],
  ] as const)
    await run.save('product.saveCategory', { id, name: id, parentId })
  const before = await run.call('product.getTemplate', { id: 'goods' })
  await run.save('product.saveRecord', {
    expectedRevisionId: before.revisionId,
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    listPrice: '100',
    saleOk: true,
    categoryId: 'leaf',
  })
  await run.save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await run.save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  const rule = (args: Row) =>
    run.save('pricing.savePricelistItem', {
      pricelistId: 'retail',
      appliedOn: '2_product_category',
      computePrice: 'fixed',
      fixedPrice: '90',
      minQuantity: '0',
      ...args,
    })
  const quote = (fn = 'pricing.priceForLine', args: Row = {}) =>
    run.call(fn, {
      pricelistId: 'retail',
      productId: run.productId,
      quantity: '20',
      uomId: 'each',
      date: '2026-10-23',
      ...args,
    })
  return { ...run, rule, quote }
}

test('P40 nearest category outranks ancestor quantity in base, package and sales-line prices', async (t) => {
  const { rule, quote, add } = await hierarchy(t)
  await rule({ id: 'root-bulk', categoryId: 'root', minQuantity: '10', fixedPrice: '60' })
  await rule({ id: 'child', categoryId: 'child', minQuantity: '2', fixedPrice: '80' })
  await rule({ id: 'leaf', categoryId: 'leaf', minQuantity: '1', fixedPrice: '90' })
  assert.equal((await quote()).price, '90')
  assert.equal((await quote('pricing.priceFor')).price, '90')
  assert.equal((await quote('pricing.priceForLine', { uomId: 'box' })).price, '1080')
  assert.equal((await add({ orderId: 'priced', productUomQty: '20' })).priceUnit, '1080')
})

test('P40 eligibility precedes depth, then quantity and descending IDs decide within one category', async (t) => {
  const { rule, quote } = await hierarchy(t)
  await rule({ id: 'root', categoryId: 'root', fixedPrice: '60' })
  await rule({ id: 'child-small', categoryId: 'child', minQuantity: '1', fixedPrice: '80' })
  await rule({ id: 'a-child-bulk', categoryId: 'child', minQuantity: '10', fixedPrice: '75' })
  await rule({ id: 'z-child-bulk', categoryId: 'child', minQuantity: '10', fixedPrice: '74' })
  await rule({ id: 'leaf-too-large', categoryId: 'leaf', minQuantity: '30', fixedPrice: '90' })
  await rule({ id: 'leaf-expired', categoryId: 'leaf', fixedPrice: '40', dateEnd: '2026-10-22' })
  await rule({ id: 'leaf-future', categoryId: 'leaf', fixedPrice: '30', dateStart: '2026-10-24' })
  assert.equal((await quote()).price, '74')
  assert.equal((await quote('pricing.priceFor')).price, '74')
  assert.equal((await quote('pricing.priceForLine', { quantity: '5' })).price, '80')
  assert.equal((await quote('pricing.priceForLine', { quantity: '30' })).price, '90')
})

test('P40 category depth preserves template and variant precedence', async (t) => {
  const { rule, quote, productId } = await hierarchy(t)
  await rule({ id: 'leaf', categoryId: 'leaf', fixedPrice: '60', minQuantity: '10' })
  await rule({
    id: 'template',
    appliedOn: '1_product',
    categoryId: null,
    templateId: 'goods',
    fixedPrice: '80',
  })
  assert.equal((await quote()).price, '80')
  await rule({ id: 'variant', appliedOn: '0_product_variant', categoryId: null, productId, fixedPrice: '90' })
  assert.equal((await quote()).price, '90')
  assert.equal((await quote('pricing.priceFor')).price, '90')
})

test('P40 rename and reparent preserve IDs and update applicable ancestor fallback', async (t) => {
  const { rule, quote, save, call } = await hierarchy(t)
  await rule({ id: 'root', categoryId: 'root', fixedPrice: '80' })
  await rule({ id: 'other-root', categoryId: 'other-root', fixedPrice: '70' })
  assert.equal((await quote()).price, '80')
  await save('product.saveCategory', { id: 'child', name: 'Renamed child', parentId: 'root' })
  assert.equal((await quote()).price, '80')
  await save('product.saveCategory', { id: 'child', name: 'Renamed child', parentId: 'other-root' })
  assert.equal((await quote()).price, '70')
  const template = await call('product.getTemplate', { id: 'goods' })
  assert.equal(template.categoryId, 'leaf')
  const items = (await call('pricing.listPricelistItems', { pricelistId: 'retail' })) as unknown as Row[]
  assert.deepEqual(items.map((row) => row.categoryId).sort(), ['other-root', 'root'])
})
