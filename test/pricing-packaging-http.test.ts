import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

async function priced(t: TestContext) {
  const run = await setup(t)
  await run.save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await run.save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  const rule = (args: Row = {}) =>
    run.save('pricing.savePricelistItem', {
      id: 'rule',
      pricelistId: 'retail',
      appliedOn: '0_product_variant',
      productId: run.productId,
      computePrice: 'fixed',
      fixedPrice: '90',
      ...args,
    })
  const quote = (args: Row = {}) =>
    run.call('pricing.priceForLine', {
      pricelistId: 'retail',
      productId: run.productId,
      quantity: '2',
      uomId: 'box',
      ...args,
    })
  return { ...run, rule, quote }
}

test('P37 package rule wins within its scope and matches only the selected line unit', async (t) => {
  const { rule, quote, add, call, productId } = await priced(t)
  await rule({ id: 'base', minQuantity: '2' })
  await rule({ id: 'box-rule', uomId: 'box', fixedPrice: '950' })
  assert.equal((await quote()).price, '950')
  assert.equal((await quote({ uomId: 'each' })).price, '90')
  assert.equal(
    (await add({ orderId: 'priced' })).priceUnit,
    '950',
    'do not multiply the package amount twice',
  )
  assert.equal((await add({ id: 'manual', orderId: 'priced', priceUnit: '920' })).priceUnit, '920')
  const legacy = await call('pricing.priceFor', {
    pricelistId: 'retail',
    productId,
    quantity: '2',
    uomId: 'box',
  })
  assert.equal(legacy.price, '90', 'legacy API still returns base-unit price and ignores packaging rules')
})

test('P37 quantity thresholds count packages rather than converted stock quantity', async (t) => {
  const { rule, quote } = await priced(t)
  await rule({ id: 'bulk', minQuantity: '10', fixedPrice: '70' })
  assert.equal((await quote()).price, '1200', 'two boxes are two sales units, not 24')
  assert.equal((await quote({ quantity: '10' })).price, '840')
  await rule({ id: 'box-bulk', uomId: 'box', minQuantity: '3', fixedPrice: '900' })
  assert.equal((await quote()).price, '1200')
  assert.equal((await quote({ quantity: '3' })).price, '900')
  assert.equal((await quote({ quantity: '10' })).price, '900', 'packaging specificity precedes quantity')
})

test('P37 quantity ordering preserves decimal thresholds beyond Number precision', async (t) => {
  const { rule, quote } = await priced(t)
  await rule({ id: 'a-lower', uomId: 'box', minQuantity: '9007199254740992', fixedPrice: '900' })
  await rule({ id: 'z-higher', uomId: 'box', minQuantity: '9007199254740993', fixedPrice: '800' })
  assert.equal((await quote({ quantity: '9007199254740992' })).price, '900')
  assert.equal((await quote({ quantity: '9007199254740993' })).price, '800')
})

test('P37 variant scope outranks template packaging and template fixed prices scale variant extras', async (t) => {
  const { rule, quote, save, call } = await priced(t)
  await save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Size',
    displayType: 'select',
    createVariant: 'always',
    values: [{ id: 'large', name: 'Large' }],
  })
  await save('product.configureAttributes', {
    templateId: 'goods',
    lines: [{ attributeId: 'size', values: [{ valueId: 'large', priceExtra: '30' }] }],
  })
  const variants = (await call('product.listVariants', { templateId: 'goods' })) as unknown as Row[]
  const productId = variants.find((v) => v.active !== false)!.id
  await rule({
    id: 'template-box',
    appliedOn: '1_product',
    templateId: 'goods',
    uomId: 'box',
    fixedPrice: '900',
  })
  assert.equal((await quote({ productId })).price, '1260', '900 per box + 30 extra × 12')
  await rule({ id: 'variant-base', productId, fixedPrice: '110' })
  assert.equal((await quote({ productId })).price, '1320', 'variant wins over template packaging')
  await rule({ id: 'variant-box', productId, uomId: 'box', fixedPrice: '990' })
  assert.equal((await quote({ productId })).price, '990', 'variant fixed amount adds no template extra')
})

test('P37 packaging eligibility is scoped and base units normalize to unrestricted rules', async (t) => {
  const { call, productId, rule, save, fixture, quote } = await priced(t)
  const bad = async (args: Row) => {
    const result = await call('pricing.savePricelistItem', {
      id: 'bad',
      pricelistId: 'retail',
      appliedOn: '0_product_variant',
      productId,
      computePrice: 'fixed',
      fixedPrice: '1',
      ...args,
    })
    assert.equal(result.ok, false)
    assert.equal((result.errors as Row[])[0]!.field, 'uomId')
  }
  await bad({ uomId: 'case' })
  await bad({ uomId: 'box', appliedOn: '3_global' })
  await save('uom.saveUnit', { id: 'weight', name: 'Weight', relativeFactor: '1' })
  await bad({ uomId: 'weight' })
  await fixture('product.addProductUom', { productId, uomId: 'case', barcode: 'OTHER' }, 'other')
  await bad({ uomId: 'case' })
  await rule({ uomId: 'each' })
  const rows = (await call('pricing.listPricelistItems', { pricelistId: 'retail' })) as unknown as Row[]
  assert.equal(rows[0]!.uomId, null)
  assert.equal((await quote()).price, '1080')
  assert.equal((await quote({ uomId: 'case' })).ok, false)
})

test('P37 percentage, formula and chained pricelists price the line unit once', async (t) => {
  const { rule, quote, save, call } = await priced(t)
  await rule({ uomId: 'box', computePrice: 'percentage', percentPrice: '10' })
  assert.equal((await quote()).price, '1080')
  await rule({
    uomId: 'box',
    computePrice: 'formula',
    priceDiscount: '10',
    priceRound: '100',
    priceSurcharge: '5',
  })
  assert.equal((await quote()).price, '1105', 'rounding and surcharge apply to the package amount')
  await save('pricing.savePricelist', { id: 'nested', name: 'Nested' })
  await rule({ id: 'nested-box', pricelistId: 'nested', uomId: 'box', fixedPrice: '900' })
  await rule({
    uomId: 'box',
    base: 'pricelist',
    basePricelistId: 'nested',
    computePrice: 'percentage',
    percentPrice: '10',
  })
  assert.equal((await quote()).price, '810')
  const refused = await call('pricing.savePricelistItem', {
    id: 'nested-box',
    pricelistId: 'nested',
    appliedOn: '0_product_variant',
    base: 'pricelist',
    basePricelistId: 'retail',
    computePrice: 'percentage',
  })
  assert.equal(refused.ok, false, 'recursive rules are refused before persisting')
  assert.equal((await quote()).price, '810', 'the previous valid rule remains')
})

test('P37 a base-unit formula rule scales its surcharge and margins to the package (C8)', async (t) => {
  // Surcharge and margins convert from the product unit to the line unit; rounding stays as entered.
  const { rule, quote } = await priced(t)
  await rule({ computePrice: 'formula', priceDiscount: '0', priceSurcharge: '5' })
  assert.equal((await quote({ uomId: 'each' })).price, '105')
  assert.equal((await quote()).price, '1260', 'a box of 12 adds 12 surcharges, not one')
  await rule({ computePrice: 'formula', priceDiscount: '50', priceMinMargin: '20' })
  assert.equal((await quote()).price, '1440', 'the floor is the box base plus 12 unit margins')
  await rule({ computePrice: 'formula', priceDiscount: '-50', priceMaxMargin: '10' })
  assert.equal((await quote()).price, '1320', 'the ceiling is the box base plus 12 unit margins')
})

test('P37 exact fixed package prices preserve decimal digits through the sales writer', async (t) => {
  const { rule, quote, add } = await priced(t)
  await rule({ uomId: 'box', fixedPrice: '9007199254740993.125' })
  assert.equal((await quote()).price, '9007199254740993.125')
  assert.equal((await add({ orderId: 'priced' })).priceUnit, '9007199254740993.125')
})

test('P37 dated package rules fall back outside their validity period', async (t) => {
  const { rule, quote } = await priced(t)
  await rule({
    uomId: 'box',
    fixedPrice: '900',
    dateStart: '2026-10-01T00:00:00Z',
    dateEnd: '2026-10-31T23:59:59Z',
  })
  assert.equal((await quote({ date: '2026-10-15T10:00:00Z' })).price, '900')
  assert.equal((await quote({ date: '2026-11-01T00:00:00Z' })).price, '1200')
})
