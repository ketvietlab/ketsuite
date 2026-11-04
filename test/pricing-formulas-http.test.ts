import { pricelistRevision } from '../packages/ketsuite/src/modules/pricing/record-revision.ts'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
async function priced(t: TestContext) {
  const r = await setup(t)
  for (const id of ['retail', 'base', 'third']) await r.save('pricing.savePricelist', { id, name: id })
  const item = (args: Row) =>
    r.call('pricing.savePricelistItem', {
      pricelistId: 'retail',
      appliedOn: '3_global',
      computePrice: 'formula',
      ...args,
    })
  const rule = async (args: Row) => {
    const result = await item(args)
    assert.equal(result.ok, true, JSON.stringify(result))
    return result
  }
  const quote = (args: Row = {}) =>
    r.call('pricing.priceForLine', {
      pricelistId: 'retail',
      productId: r.productId,
      quantity: '1',
      uomId: 'each',
      ...args,
    })
  return { ...r, item, rule, quote }
}
test('D30 exact formulas round half away from zero before integer surcharge and clamp below zero', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'formula', priceDiscount: '-50', priceRound: '100', priceSurcharge: '-25' })
  const q = await r.quote()
  assert.equal(q.price, '175')
  assert.equal(q.priceUnit, '175')
  assert.equal(q.discount, '0')
  await r.rule({ id: 'formula', priceDiscount: '100', priceSurcharge: '-25' })
  assert.equal((await r.quote()).price, '0')
  for (const bad of [{ priceDiscount: '-1001' }, { priceDiscount: '101' }, { priceSurcharge: '0.5' }])
    assert.equal((await r.item({ id: 'bad', ...bad })).ok, false)
})
test('D30 percentage separates displayed base and discount; nested formulas consume the net base price', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'base-discount', pricelistId: 'base', computePrice: 'percentage', percentPrice: '20' })
  await r.rule({
    id: 'nested',
    base: 'pricelist',
    basePricelistId: 'base',
    computePrice: 'percentage',
    percentPrice: '10',
  })
  const q = await r.quote()
  assert.equal(q.price, '72')
  assert.equal(q.priceUnit, '80')
  assert.equal(q.discount, '10')
  await r.rule({
    id: 'nested',
    base: 'pricelist',
    basePricelistId: 'base',
    priceDiscount: '-25',
    priceSurcharge: '7',
  })
  assert.equal((await r.quote()).price, '107')
  const legacy = await r.call('pricing.priceFor', {
    pricelistId: 'retail',
    productId: r.productId,
    quantity: '1',
  })
  assert.equal(legacy.price, '107')
  assert.equal((await r.item({ id: 'bad', computePrice: 'percentage', base: 'standard_price' })).ok, false)
})
test('D30 ties use creation order and legacy descending IDs after specificity and quantity', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'z', computePrice: 'fixed', fixedPrice: '10' })
  await r.rule({ id: 'a', computePrice: 'fixed', fixedPrice: '20' })
  assert.equal((await r.quote()).price, '20')
})
test('D30 graph refuses cycles and inactive bases and protects referenced active pricelists', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'a-b', base: 'pricelist', basePricelistId: 'base' })
  await r.rule({ id: 'b-c', pricelistId: 'base', base: 'pricelist', basePricelistId: 'third' })
  assert.equal(
    (await r.item({ id: 'c-a', pricelistId: 'third', base: 'pricelist', basePricelistId: 'retail' })).ok,
    false,
  )
  assert.equal((await r.call('pricing.savePricelist', { id: 'base', name: 'base', active: false })).ok, false)
  await r.save('pricing.savePricelist', { id: 'unused', name: 'unused', active: false })
  assert.equal((await r.item({ id: 'inactive', base: 'pricelist', basePricelistId: 'unused' })).ok, false)
  await r.save('pricing.savePricelist', { id: 'retail', name: 'retail', active: false })
  await r.save('pricing.savePricelist', { id: 'base', name: 'base', active: false })
  assert.equal(
    (await r.call('pricing.savePricelist', { id: 'retail', name: 'retail', active: true })).ok,
    false,
  )
})
test('D30 concurrent opposite graph writes cannot commit a cycle', async (t) => {
  const r = await priced(t)
  const results = await Promise.all([
    r.item({ id: 'a-b', base: 'pricelist', basePricelistId: 'base' }),
    r.item({ id: 'b-a', pricelistId: 'base', base: 'pricelist', basePricelistId: 'retail' }),
  ])
  assert.equal(results.filter((x) => x.ok).length, 1)
})
test('D30 legacy cycles fall back to list price at the closing edge', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'a-b', base: 'pricelist', basePricelistId: 'base', priceDiscount: '10' })
  await r.rule({ id: 'b-a', pricelistId: 'base', priceDiscount: '10' })
  await r.app.adapter!.run(
    "UPDATE pricing_pricelist_item SET base = 'pricelist', \"basePricelistId\" = 'retail' WHERE id = 'b-a'",
  )
  assert.equal((await r.quote()).price, '81')
})
test('D30 automatic sales lines expose percentage discounts and preserve the net order total', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'percent', computePrice: 'percentage', percentPrice: '15' })
  await r.save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  await r.save('sale.addLine', {
    id: 'p',
    orderId: 'priced',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '2',
  })
  const order = await r.call('sale.getOrder', { id: 'priced' }),
    line = (order.lines as Row[])[0]!
  assert.equal(line.priceUnit, '100')
  assert.equal(line.discount, '15')
  assert.equal(order.amountUntaxed, '170')
  const units = (
    await r.app.client.call<Row[]>('sale.listLinePricing', {
      orderId: 'priced',
      productId: r.productId,
      quantity: '2',
    })
  ).value
  const each = units.find((row) => row.id === 'each')!
  assert.equal(each.priceUnit, '100')
  assert.equal(each.discount, '15')
})

test('D30 quantity breaks include active dated base-list tiers in the selected packaging', async (t) => {
  const r = await priced(t)
  await r.rule({
    id: 'base-box',
    pricelistId: 'base',
    computePrice: 'fixed',
    uomId: 'box',
    appliedOn: '0_product_variant',
    productId: r.productId,
    minQuantity: '2',
    fixedPrice: '900',
  })
  await r.rule({
    id: 'expired',
    pricelistId: 'base',
    computePrice: 'fixed',
    minQuantity: '7',
    dateEnd: '2020-01-01',
    fixedPrice: '1',
  })
  await r.rule({
    id: 'derived',
    base: 'pricelist',
    basePricelistId: 'base',
    computePrice: 'percentage',
    percentPrice: '10',
  })
  const result = await r.quote({ uomId: 'box', includeBreaks: true, date: '2026-10-24' })
  const breaks = result.priceBreaks as Row[]
  assert.deepEqual(
    breaks.map((row) => row.quantity),
    ['0', '2'],
  )
  assert.equal(breaks[0]!.price, '1080')
  assert.equal(breaks[1]!.price, '810')
  assert.deepEqual(
    ((await r.quote({ includeBreaks: true })).priceBreaks as Row[]).map((row) => row.quantity),
    ['0'],
  )
})

test('D30 batch rules and settings share one revision, rollback and ownership boundary', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'held', computePrice: 'fixed', fixedPrice: '95' })
  const lists = (await r.app.client.call<Row[]>('pricing.listPricelists', {})).value
  const record = lists.find((row) => row.id === 'retail')!
  const rows = (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' })).value
  const expectedRevision = pricelistRevision(record, rows)
  const save = (items: Row[], revision = expectedRevision) =>
    r.call('pricing.savePricelist', { id: 'retail', name: 'Edited', items, expectedRevision: revision })
  const valid = { id: 'new', appliedOn: '3_global', computePrice: 'fixed', fixedPrice: '80' }
  assert.equal(
    (
      await save([
        valid,
        {
          id: 'bad',
          appliedOn: '3_global',
          computePrice: 'formula',
          base: 'pricelist',
          basePricelistId: 'retail',
        },
      ])
    ).ok,
    false,
  )
  assert.deepEqual(
    (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' })).value,
    rows,
  )
  assert.equal((await save([valid], 'stale')).ok, false)
  const both = await Promise.all([save([valid]), save([{ ...valid, id: 'second' }])])
  assert.equal(both.filter((row) => row.ok).length, 1)
  const current = (await r.app.client.call<Row[]>('pricing.listPricelists', {})).value.find(
    (row) => row.id === 'retail',
  )!
  assert.equal(current.name, 'Edited')
  assert.equal(
    (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' })).value.length,
    1,
  )
})

test('D30 public sales price choices carry base-list tiers without cost fields', async (t) => {
  const r = await priced(t)
  await r.rule({
    id: 'base-tier',
    pricelistId: 'base',
    computePrice: 'fixed',
    minQuantity: '3',
    fixedPrice: '80',
  })
  await r.rule({
    id: 'derived',
    base: 'pricelist',
    basePricelistId: 'base',
    computePrice: 'percentage',
    percentPrice: '10',
  })
  await r.save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  const rows = (
    await r.app.client.call<Row[]>('sale.listLinePrices', {
      orderId: 'priced',
      productId: r.productId,
      quantity: '1',
    })
  ).value
  const each = rows.find((row) => row.id === 'each')!
  assert.deepEqual(each.priceSteps, [
    { from: 0, row: { priceUnit: '100', discount: 10 } },
    { from: 3, row: { priceUnit: '80', discount: 10 } },
  ])
  assert.ok(rows.every((row) => !Object.hasOwn(row, 'unitCost') && !Object.hasOwn(row, 'marginLocked')))
})

test('D30 native batch command converts local dates, reports the failed row and retains drafts atomically', async (t) => {
  const r = await priced(t)
  const context = async () =>
    (await (await r.app.client.get('/admin/pricing/pricelists/retail/context?lang=en')).json()) as {
      data: Row
    }
  const data = (await context()).data
  assert.ok(data.revision)
  assert.ok(((data.choices as Row).lists as Row[]).every((row) => row.id !== 'retail'))
  const post = (items: Row[]) =>
    r.app.client.post(
      '/admin/pricing/record-command?lang=en',
      JSON.stringify({
        id: 'retail',
        name: 'Grid',
        active: true,
        sequence: 16,
        expectedRevision: data.revision,
        items: JSON.stringify(items),
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  const good = {
    id: 'grid',
    appliedOn: '3_global',
    computePrice: 'formula',
    priceDiscount: '-25',
    priceSurcharge: '7',
    dateStart: '2026-10-24',
  }
  const bad = await post([good, { ...good, id: 'bad', base: 'pricelist', basePricelistId: 'retail' }])
  const refused = (await bad.json()) as { value: Row }
  assert.equal(refused.value.ok, false)
  assert.match(String((refused.value.errors as Row[])[0]!.message), /Row 2:/)
  // A record page words a known key on its own, which would drop the row: the worded message is all.
  assert.equal((refused.value.errors as Row[])[0]!.messageKey, undefined)
  assert.deepEqual(
    (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' })).value,
    [],
  )
  const response = await post([good])
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as { value: Row }).value.ok, true)
  const row = (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' }))
    .value[0]!
  assert.equal(new Date(String(row.dateStart)).toISOString(), '2026-10-23T17:00:00.000Z')
})

test('D30 settings-only grant cannot write rule batches through function or native command', async (t) => {
  const r = await priced(t)
  await r.fixture('user.createUser', {
    id: 'settings',
    login: 'settings',
    password: 'test-password',
    name: 'Settings',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'settings-company', userId: 'settings', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'settings-role', name: 'Settings' })
  await r.fixture('user.assignRole', {
    id: 'settings-assignment',
    userId: 'settings',
    roleId: 'settings-role',
  })
  await r.fixture('user.grantFunction', {
    id: 'settings-grant',
    roleId: 'settings-role',
    fnKey: 'pricing.savePricelist',
  })
  const client = r.app.client.anonymous()
  await client.login({ login: 'settings', password: 'test-password' })
  const context = (await (
    await r.app.client.get('/admin/pricing/pricelists/retail/context?lang=en')
  ).json()) as { data: Row }
  const input = { id: 'retail', name: 'Forged', expectedRevision: context.data.revision, items: [] }
  assert.equal((await client.call<Row>('pricing.savePricelist', input)).value.ok, false)
  assert.equal(
    (
      await client.post('/admin/pricing/record-command?lang=en', JSON.stringify({ ...input, items: '[]' }), {
        headers: { 'content-type': 'application/json' },
      })
    ).status,
    403,
  )
  assert.equal(
    (await client.call<Row>('pricing.savePricelist', { id: 'retail', name: 'Allowed settings' })).value.ok,
    true,
  )
})
test('D30 adding a dependent rule races safely with archiving its base', async (t) => {
  const r = await priced(t)
  const results = await Promise.all([
    r.item({ id: 'dependent', base: 'pricelist', basePricelistId: 'base' }),
    r.call('pricing.savePricelist', { id: 'base', name: 'Base', active: false }),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
})

test('D30 grid temporary IDs are independent across lists and new rows win equal rules', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'z-legacy', computePrice: 'fixed', fixedPrice: '10' })
  for (const id of ['retail', 'base']) {
    const record = (await r.app.client.call<Row[]>('pricing.listPricelists', {})).value.find(
      (row) => row.id === id,
    )!
    const items = (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: id })).value
    assert.equal(
      (
        await r.call('pricing.savePricelist', {
          id,
          name: id,
          expectedRevision: pricelistRevision(record, items),
          items: [...items, { id: 'new-1', appliedOn: '3_global', computePrice: 'fixed', fixedPrice: '70' }],
        })
      ).ok,
      true,
    )
    const after = (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: id })).value
    assert.ok(after.every((row) => !String(row.id).startsWith('new-')))
    assert.equal((await r.quote({ pricelistId: id })).price, '70')
  }
})
test('D30 nullable creation-order migration preserves legacy rules and replays safely', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'a', computePrice: 'fixed', fixedPrice: '20' })
  await r.rule({ id: 'z', computePrice: 'fixed', fixedPrice: '10' })
  const legacy = r.deployment.modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'pricing') return module
    const model = module.models!.PricelistItem!,
      { creationOrder: _order, ...fields } = model.fields
    return { ...module, models: { ...module.models, PricelistItem: { ...model, fields } } }
  })
  await migrateOne(r.app.adapter!, compose(legacy, { headless: true, companies: true }), {
    allowDestructive: true,
  })
  const before = await r.app.adapter!.all('SELECT * FROM pricing_pricelist_item')
  const target = compose(r.deployment.modules, { headless: true, companies: true })
  await migrateOne(r.app.adapter!, target)
  const after = await r.app.adapter!.all('SELECT * FROM pricing_pricelist_item')
  assert.ok(after.every((row) => row.creationOrder === null))
  assert.deepEqual(
    after.map(({ creationOrder: _order, ...row }) => row),
    before.map((row) => ({ ...row })),
  )
  assert.deepEqual(await migrateOne(r.app.adapter!, target), [])
  assert.equal((await r.quote()).price, '10')
})

test('D30 duplicate draft IDs refuse atomically and edits cannot forge creation priority', async (t) => {
  const r = await priced(t)
  await r.rule({ id: 'first', computePrice: 'fixed', fixedPrice: '10' })
  await r.rule({ id: 'second', computePrice: 'fixed', fixedPrice: '20' })
  const record = (await r.app.client.call<Row[]>('pricing.listPricelists', {})).value.find(
    (row) => row.id === 'retail',
  )!
  const items = (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' }))
    .value
  const draft = { id: 'new-1', appliedOn: '3_global', computePrice: 'fixed', fixedPrice: '70' }
  assert.equal(
    (
      await r.call('pricing.savePricelist', {
        id: 'retail',
        name: 'Changed',
        expectedRevision: pricelistRevision(record, items),
        items: [draft, draft],
      })
    ).ok,
    false,
  )
  assert.deepEqual(
    (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' })).value,
    items,
  )
  const edited = items.map((row) =>
    row.id === 'first' ? { ...row, fixedPrice: '99', creationOrder: 999999 } : row,
  )
  assert.equal(
    (
      await r.call('pricing.savePricelist', {
        id: 'retail',
        name: 'retail',
        expectedRevision: pricelistRevision(record, items),
        items: edited,
      })
    ).ok,
    true,
  )
  assert.equal((await r.quote()).price, '20')
  const saved = (await r.app.client.call<Row[]>('pricing.listPricelistItems', { pricelistId: 'retail' }))
    .value
  assert.equal(
    saved.find((row) => row.id === 'first')!.creationOrder,
    items.find((row) => row.id === 'first')!.creationOrder,
  )
})
