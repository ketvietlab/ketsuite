import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

/**
 * Dough (BTP-03, lot-tracked, pH 9–10) is made from flour; cakes are made from dough and delivered.
 * Each dough batch waits in quarantine for its quality check.
 */
const bakery = async (t: Parameters<typeof boot>[0]) => {
  const r = await boot(t)
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'production', name: 'Sản xuất', usage: 'production' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Kiểm kê', usage: 'inventory' })
  await r.save('stock.saveLocation', { id: 'customer', name: 'Khách', usage: 'customer' })
  await r.save('stock.savePickingType', {
    id: 'out',
    name: 'Giao hàng',
    code: 'outgoing',
    defaultLocationSrcId: 'wh:stock',
    defaultLocationDestId: 'customer',
  })
  await r.fixture('partner.savePartner', { id: 'an', kind: 'person', name: 'Chị An' })
  for (const [id, name, tracking] of [
    ['flour', 'Bột mì', 'none'],
    ['dough', 'Phôi BTP-03', 'lot'],
    ['cake', 'Bánh', 'lot'],
  ] as const) {
    await r.save('product.saveRecord', {
      id,
      name,
      type: 'goods',
      defaultCode: id.toUpperCase(),
      uomId: 'each',
      listPrice: '0',
    })
    await r.save('stock.configureProduct', { templateId: id, isStorable: true, tracking })
  }
  await r.save('stock.adjustInventory', {
    id: 'seed-flour',
    productId: 'flour:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '100',
    productUomId: 'each',
  })
  const bom = async (id: string, productId: string, componentId: string, extra: Row = {}) =>
    r.save('manufacturing.saveBom', {
      id,
      code: id.toUpperCase(),
      productId,
      productQty: '10',
      productUomId: 'each',
      consumption: 'flexible',
      lines: [{ id: `${id}-line`, productId: componentId, productQty: '10', productUomId: 'each' }],
      ...extra,
    })
  await bom('dough-bom', 'dough:default', 'flour:default', { phMin: '9', phMax: '10' })
  await bom('cake-bom', 'cake:default', 'dough:default')
  const order = async (id: string, name: string, bomId: string) => {
    await r.save('manufacturing.saveProduction', {
      id,
      name,
      bomId,
      productQty: '10',
      productUomId: 'each',
      sourceLocationId: 'wh:stock',
      productionLocationId: 'production',
      destinationLocationId: 'wh:stock',
      scheduledStart: '2026-10-29T01:00:00.000Z',
    })
    await r.save('manufacturing.confirmProduction', { id, version: 1 })
  }
  const lot = async () => (await r.call('stock.listLots', { productId: 'dough:default' })) as unknown as Row[]
  const checks = async (productionId: string) =>
    (await r.call('manufacturing.listQualityChecks', { productionId })) as unknown as Row[]
  const attempt = async (fn: string, input: Row) => (await r.app.client.call<Row>(fn, input)).value
  return { ...r, order, lot, checks, attempt }
}

test('manufacturing quality HTTP: a batch waits in quarantine, a passing check releases it and a failing one keeps it', async (t) => {
  const r = await bakery(t)
  await r.order('mo-dough', 'HCM/SX/0004', 'dough-bom')
  const first = await r.save('manufacturing.recordOutput', {
    id: 'mo-dough',
    quantity: '5',
    lotName: '261028',
  })
  const lots = await r.lot()
  assert.deepEqual(
    lots.map((row) => [row.name, row.quarantined]),
    [['261028', true]],
  )
  const history = (await r.call('stock.listLotHistory', { lotId: first.lotId })) as unknown as Row[]
  assert.deepEqual(
    history.map((row) => row.reason),
    ['qualityPending'],
  )
  const [pending] = await r.checks('mo-dough')
  assert.deepEqual(
    [pending?.state, pending?.lotName, pending?.phMin, pending?.phMax],
    ['pending', '261028', '9', '10'],
  )

  // The foreman sees the warning and the check form.
  const page = async () => (await r.app.client.get('/admin/manufacturing/orders/mo-dough?lang=vi')).text()
  const waiting = await page()
  assert.ok(waiting.includes('Lô chờ kiểm chất lượng'), 'the order warns of the waiting lot')
  assert.ok(waiting.includes('name="ph"'), 'the foreman has the check form')

  // A reading off the scale is refused in words.
  const off = await r.attempt('manufacturing.checkQuality', { id: pending!.id, ph: '15', sensory: 'pass' })
  assert.deepEqual(off.errors, [{ field: 'ph', code: 'manufacturing.error.phReading' }])
  const posted = await r.app.client.post(
    '/admin/manufacturing/orders/mo-dough?lang=vi',
    new URLSearchParams({ action: 'quality', checkId: String(pending!.id), ph: '15', sensory: 'pass' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.ok((await posted.text()).includes('Nhập pH từ 0 đến 14.'), 'the page says what is wrong')

  // A second batch fails at pH 8 and stays held.
  const second = await r.save('manufacturing.recordOutput', {
    id: 'mo-dough',
    quantity: '5',
    lotName: '261028',
  })
  assert.equal(second.lotName, '261028-2')
  const failing = (await r.checks('mo-dough')).find((row) => row.lotId === second.lotId)!
  const failed = await r.save('manufacturing.checkQuality', { id: failing.id, ph: '8', sensory: 'pass' })
  assert.equal(failed.state, 'failed')

  // pH 9,5 (typed with a comma) and a sensory pass release the first.
  const passed = await r.save('manufacturing.checkQuality', {
    id: pending!.id,
    ph: '9,5',
    sensory: 'pass',
    note: 'Mịn',
  })
  assert.equal(passed.state, 'passed')
  assert.deepEqual((await r.lot()).map((row) => [row.name, Boolean(row.quarantined)]).sort(), [
    ['261028', false],
    ['261028-2', true],
  ])
  const released = (await r.call('stock.listLotHistory', { lotId: first.lotId })) as unknown as Row[]
  assert.deepEqual(released.map((row) => row.reason).sort(), ['qualityPassed', 'qualityPending'])
  assert.deepEqual(
    (await r.checks('mo-dough')).map((row) => [row.lotName, row.state, row.ph, row.sensory]),
    [
      ['261028-2', 'failed', '8', 'pass'],
      ['261028', 'passed', '9.5', 'pass'],
    ],
  )
  // Checked once.
  const again = await r.attempt('manufacturing.checkQuality', { id: pending!.id, ph: '9.5', sensory: 'pass' })
  assert.deepEqual(again.errors, [{ field: 'id', code: 'manufacturing.error.qualityChecked' }])
  // A bad sensory value, and a BOM range missing an end, are refused.
  assert.deepEqual(
    (
      await r.attempt('manufacturing.saveBom', {
        id: 'dough-bom',
        productId: 'dough:default',
        productQty: '10',
        productUomId: 'each',
        phMin: '',
      })
    ).errors,
    [{ field: 'phMin', code: 'manufacturing.error.phRange' }],
  )

  // A worker who may record output reads the order but has no check form.
  await r.fixture('user.createUser', {
    id: 'worker',
    login: 'worker',
    password: 'test-password',
    name: 'Worker',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'worker-acme', userId: 'worker', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'floor', name: 'Floor' })
  for (const fnKey of [
    'manufacturing.getProduction',
    'manufacturing.productionQueue',
    'manufacturing.recordOutput',
    'manufacturing.listQualityChecks',
    'manufacturing.getBom',
    'uom.listUnits',
    'product.listVariants',
  ])
    await r.fixture('user.grantFunction', { id: `floor:${fnKey}`, roleId: 'floor', fnKey })
  await r.fixture('user.assignRole', { id: 'worker:floor', userId: 'worker', roleId: 'floor' })
  await r.app.client.logout()
  await r.app.client.login({ login: 'worker', password: 'test-password' })
  const floor = await page()
  assert.ok(floor.includes('Kiểm chất lượng'), 'the worker sees the checks')
  assert.ok(!floor.includes('name="ph"'), 'but has no check form')
})

test('manufacturing trace HTTP: a dough lot leads to the order that used it, the cake lot it made and the customer who got it', async (t) => {
  const r = await bakery(t)
  await r.order('mo-dough', 'HCM/SX/0004', 'dough-bom')
  const good = await r.save('manufacturing.recordOutput', {
    id: 'mo-dough',
    quantity: '5',
    lotName: '260815',
  })
  const held = await r.save('manufacturing.recordOutput', {
    id: 'mo-dough',
    quantity: '5',
    lotName: '260816',
  })
  const [check] = (await r.checks('mo-dough')).filter((row) => row.lotId === good.lotId)
  await r.save('manufacturing.checkQuality', { id: check!.id, ph: '9.5', sensory: 'pass' })
  await r.save('manufacturing.consumeProduction', {
    id: 'mo-dough',
    components: [{ productId: 'flour:default', consumed: '10' }],
  })

  // The cake order uses dough: only the released lot can be taken.
  await r.order('mo-cake', 'HCM/SX/0005', 'cake-bom')
  const cake = await r.save('manufacturing.recordOutput', { id: 'mo-cake', quantity: '4', lotName: '261008' })
  await r.save('manufacturing.consumeProduction', {
    id: 'mo-cake',
    components: [{ productId: 'dough:default', consumed: '4' }],
  })
  // 3 cakes reach Chị An.
  await r.save('stock.createPicking', {
    id: 'out-1',
    name: 'WH/OUT/0001',
    pickingTypeId: 'out',
  })
  // A sale names the customer on its delivery; here the fixture does.
  await r.app.adapter!.run(sql('UPDATE stock_picking SET "partnerId" = ? WHERE id = ?'), ['an', 'out-1'])
  await r.save('stock.addMove', {
    id: 'out-1-cake',
    name: 'Bánh',
    pickingId: 'out-1',
    productId: 'cake:default',
    productUomId: 'each',
    productUomQty: '3',
  })
  await r.save('stock.confirmPicking', { id: 'out-1' })
  await r.save('stock.saveMoveLine', {
    id: 'out-1-line',
    moveId: 'out-1-cake',
    quantity: '3',
    lotId: cake.lotId,
    picked: true,
  })
  await r.save('stock.completePicking', { id: 'out-1', createBackorder: false })

  const trace = await r.call('manufacturing.traceLot', { lotId: good.lotId })
  assert.deepEqual(
    (trace.madeBy as Row[]).map((row) => [row.productionName, (row.used as Row[]).length]),
    [['HCM/SX/0004', 0]],
  )
  assert.deepEqual(
    (trace.usedIn as Row[]).map((row) => [
      row.productionName,
      row.quantity,
      (row.made as Row[]).map((made) => [made.lotName, made.quantity]),
    ]),
    [['HCM/SX/0005', '4', [['261008', '4']]]],
  )
  // Only the delivery counts as received; the issue to production does not.
  assert.deepEqual(
    (trace.received as Row[]).map((row) => [
      row.lotName,
      row.level,
      row.quantity,
      row.pickingName,
      row.partnerName,
    ]),
    [['261008', 1, '3', 'WH/OUT/0001', 'Chị An']],
  )
  assert.deepEqual(
    (trace.checks as Row[]).map((row) => [row.state, row.ph]),
    [['passed', '9.5']],
  )
  // The held lot was used by nobody.
  const untouched = await r.call('manufacturing.traceLot', { lotId: held.lotId })
  assert.deepEqual([(untouched.usedIn as Row[]).length, (untouched.received as Row[]).length], [0, 0])

  // The cake lot looks back to the dough lot it was made from.
  const back = await r.call('manufacturing.traceLot', { lotId: cake.lotId })
  assert.deepEqual(
    (back.madeBy as Row[]).map((row) => [
      row.productionName,
      (row.used as Row[]).map((used) => [used.lotName, used.quantity]),
    ]),
    [['HCM/SX/0005', [['260815', '4']]]],
  )
  assert.deepEqual(
    (back.received as Row[]).map((row) => [row.lotName, row.level]),
    [['261008', 0]],
  )

  // The lot page carries the trace with its links.
  const context = (await (
    await r.app.client.get(
      `/admin/stock/record/lot/${encodeURIComponent(String(good.lotId))}/context?lang=vi`,
    )
  ).json()) as {
    data: { production?: { rows: Row[]; customers: number; checks: Row[] } }
  }
  const production = context.data.production!
  assert.deepEqual(
    production.rows.map((row) => [row.relation, row.document, row.lot ?? null]),
    [
      ['madeBy', 'HCM/SX/0004', null],
      ['usedIn', 'HCM/SX/0005', null],
      ['madeLot', 'HCM/SX/0005', '261008'],
      ['receivedMade', 'WH/OUT/0001', '261008'],
    ],
  )
  assert.equal(production.customers, 1)
  assert.match(String(production.rows[1]?.documentHref), /^\/admin\/manufacturing\/orders\/mo-cake/)

  // A seller who reads stock but not production gets no trace.
  await r.fixture('user.createUser', {
    id: 'seller',
    login: 'seller',
    password: 'test-password',
    name: 'Seller',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'seller-acme', userId: 'seller', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'sales', name: 'Sales' })
  for (const fnKey of ['stock.listLots', 'stock.listLotHistory', 'stock.listMoveHistory'])
    await r.fixture('user.grantFunction', { id: `sales:${fnKey}`, roleId: 'sales', fnKey })
  await r.fixture('user.assignRole', { id: 'seller:sales', userId: 'seller', roleId: 'sales' })
  await r.app.client.logout()
  await r.app.client.login({ login: 'seller', password: 'test-password' })
  const seen = await r.app.client.get(
    `/admin/stock/record/lot/${encodeURIComponent(String(good.lotId))}/context?lang=vi`,
  )
  assert.equal(seen.status, 200)
  assert.equal(((await seen.json()) as { data: Row }).data.production, undefined)
})

test('manufacturing quality HTTP: a template checks several criteria and a lot passes only when every required one does (#1947)', async (t) => {
  const r = await bakery(t)
  const template = {
    id: 'dough-qc',
    name: 'Phôi bánh BTP-03',
    productId: 'dough:default',
    criteria: [
      { name: 'pH', kind: 'range', min: '9', max: '10' },
      { name: 'Brix', kind: 'range', min: '10', max: '14', unit: '°Bx' },
      { name: 'Độ ẩm', kind: 'range', max: '12', unit: '%', required: false },
      { name: 'Cảm quan', kind: 'passFail' },
    ],
  }
  // A range needs a limit, the lower no greater than the upper; a product has one template in use.
  assert.deepEqual(
    (
      await r.attempt('manufacturing.saveQualityTemplate', {
        ...template,
        criteria: [
          { name: 'Brix', kind: 'range', min: '14', max: '10' },
          { name: '', kind: 'passFail' },
        ],
      })
    ).errors,
    [
      { field: 'criteria', code: 'manufacturing.error.criterionRange', params: { row: '1' } },
      { field: 'criteria', code: 'manufacturing.error.criterionName', params: { row: '2' } },
    ],
  )
  await r.save('manufacturing.saveQualityTemplate', template)
  assert.deepEqual(
    (await r.attempt('manufacturing.saveQualityTemplate', { ...template, id: 'other' })).errors,
    [{ field: 'productId', code: 'manufacturing.error.qualityTemplateProduct' }],
  )

  await r.order('mo-dough', 'HCM/SX/0004', 'dough-bom')
  for (const lotName of ['261028', '261029'])
    await r.save('manufacturing.recordOutput', { id: 'mo-dough', quantity: '5', lotName })
  const pending = await r.checks('mo-dough')
  assert.deepEqual(
    pending.map((check) => [
      check.lotName,
      check.templateId,
      (check.criteria as Row[]).map((row) => row.name),
    ]),
    [
      ['261029', 'dough-qc', ['pH', 'Brix', 'Độ ẩm', 'Cảm quan']],
      ['261028', 'dough-qc', ['pH', 'Brix', 'Độ ẩm', 'Cảm quan']],
    ],
  )
  const ids = (check: Row) => Object.fromEntries((check.criteria as Row[]).map((row) => [row.name, row.id]))
  const results = (check: Row, values: Record<string, string>) =>
    Object.entries(values).map(([name, value]) => ({ criterionId: ids(check)[name], value }))
  const [later, earlier] = pending as [Row, Row]

  // A required criterion left blank is refused; nothing is recorded.
  assert.deepEqual(
    (
      await r.attempt('manufacturing.checkQuality', {
        id: earlier.id,
        results: results(earlier, { pH: '9,4', 'Cảm quan': 'pass' }),
      })
    ).errors,
    [{ field: 'results', code: 'manufacturing.error.qualityMissing', params: { criterion: 'Brix' } }],
  )
  // Brix over its range fails the lot and says which; the optional moisture over its limit does not.
  const failed = await r.save('manufacturing.checkQuality', {
    id: earlier.id,
    results: results(earlier, { pH: '9,4', Brix: '15', 'Độ ẩm': '13', 'Cảm quan': 'pass' }),
  })
  assert.deepEqual([failed.state, failed.failed], ['failed', ['Brix', 'Độ ẩm']])
  const passed = await r.save('manufacturing.checkQuality', {
    id: later.id,
    results: results(later, { pH: '9.6', Brix: '12', 'Độ ẩm': '13', 'Cảm quan': 'pass' }),
  })
  assert.deepEqual([passed.state, passed.failed], ['passed', ['Độ ẩm']])
  assert.deepEqual((await r.lot()).map((row) => [row.name, Boolean(row.quarantined)]).sort(), [
    ['261028', true],
    ['261029', false],
  ])

  // The results keep the criteria as checked, even after the template changes.
  await r.save('manufacturing.saveQualityTemplate', {
    ...template,
    version: 1,
    criteria: [{ name: 'Brix', kind: 'range', min: '11', max: '13', unit: '°Bx' }],
  })
  const checked = (await r.checks('mo-dough')).find((check) => check.id === earlier.id)!
  assert.deepEqual(
    (checked.results as Row[]).map((row) => [row.name, row.value, row.min, row.max, row.passed]),
    [
      ['pH', '9.4', '9', '10', true],
      ['Brix', '15', '10', '14', false],
      ['Độ ẩm', '13', null, '12', false],
      ['Cảm quan', 'pass', null, null, true],
    ],
  )

  // The order page shows each criterion and which one failed.
  const page = await (await r.app.client.get('/admin/manufacturing/orders/mo-dough?lang=vi')).text()
  for (const text of ['Brix: 15 °Bx (không đạt)', 'pH: 9,4', 'Cảm quan: Đạt'])
    assert.ok(page.includes(text), `the order page shows ${text}`)
})

test('manufacturing quality HTTP: a template is made and edited on its own page, its criteria in one grid (#1947)', async (t) => {
  const r = await bakery(t)
  const post = (path: string, fields: Record<string, string>, criteria: Row) =>
    r.app.client.post(
      path,
      new URLSearchParams({
        ...fields,
        criteria: JSON.stringify({ added: [], updated: [], removed: [], order: null, ...criteria }),
      }),
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        redirect: 'manual',
      },
    )
  const empty = await (await r.app.client.get('/admin/manufacturing/quality-templates?lang=vi')).text()
  assert.ok(empty.includes('Chưa có mẫu kiểm'), 'the list says there are none')
  const created = await post(
    '/admin/manufacturing/quality-templates/new?lang=vi',
    { name: 'Phôi bánh BTP-03', productId: 'dough:default', active: '1', version: '' },
    {
      added: [
        {
          id: 'a',
          index: 0,
          values: { name: 'Brix', kind: 'range', min: 10, max: 14, unit: '°Bx', required: true },
        },
        { id: 'b', index: 1, values: { name: 'Cảm quan', kind: 'passFail', required: true } },
      ],
    },
  )
  assert.equal(created.status, 303)
  const location = String(created.headers.get('location'))
  assert.match(location, /^\/admin\/manufacturing\/quality-templates\/[^/?]+\?lang=vi&saved=1$/)
  const id = decodeURIComponent(location.split('/').pop()!.split('?')[0]!)
  const template = async () => (await r.call('manufacturing.getQualityTemplate', { id })) as Row
  assert.deepEqual(
    ((await template()).criteria as Row[]).map((row) => [row.name, row.kind, row.min, row.max, row.unit]),
    [
      ['Brix', 'range', '10', '14', '°Bx'],
      ['Cảm quan', 'passFail', null, null, null],
    ],
  )
  const page = await (await r.app.client.get(location)).text()
  for (const text of ['Phôi bánh BTP-03', 'Đã lưu mẫu kiểm', 'Lô đạt khi mọi chỉ tiêu bắt buộc đạt'])
    assert.ok(page.includes(text), `the template page shows ${text}`)
  const list = await (await r.app.client.get('/admin/manufacturing/quality-templates?lang=vi')).text()
  assert.ok(
    list.includes('Phôi bánh BTP-03') && list.includes('Phôi BTP-03'),
    'the list names the template and its product',
  )

  // An edit: the first criterion narrowed, the second removed, pH added first; a bad range is refused.
  const path = `/admin/manufacturing/quality-templates/${encodeURIComponent(id)}?lang=vi`
  const fields = { name: 'Phôi bánh BTP-03', productId: 'dough:default', active: '1', version: '1' }
  const refused = await post(path, fields, { updated: [{ id: '1', values: { min: 15 } }] })
  assert.equal(refused.status, 200)
  assert.ok(
    (await refused.text()).includes('Chỉ tiêu dòng 1: nhập ít nhất một cận'),
    'the refusal names its row',
  )
  assert.equal(
    (
      await post(path, fields, {
        updated: [{ id: '1', values: { min: 11, max: 13 } }],
        removed: ['2'],
        added: [
          { id: 'ph', index: 0, values: { name: 'pH', kind: 'range', min: 9, max: 10, required: true } },
        ],
      })
    ).status,
    303,
  )
  assert.deepEqual(
    ((await template()).criteria as Row[]).map((row) => [row.name, row.min, row.max]),
    [
      ['pH', '9', '10'],
      ['Brix', '11', '13'],
    ],
  )
  assert.equal((await template()).version, 2)
})

test('manufacturing quality HTTP: competing edits cannot both replace the same template revision', async (t) => {
  const r = await boot(t)
  const template = {
    id: 'concurrent-template',
    name: 'Inspection',
    criteria: [{ name: 'Appearance', kind: 'passFail' }],
  }
  await r.save('manufacturing.saveQualityTemplate', template)
  const outcomes = await Promise.all(
    ['First editor', 'Second editor'].map(
      async (name) =>
        (await r.app.client.call<Row>('manufacturing.saveQualityTemplate', { ...template, name, version: 1 }))
          .value,
    ),
  )
  assert.equal(outcomes.filter((row) => row.ok === true).length, 1, 'exactly one editor owns revision 1')
  const refused = outcomes.find((row) => row.ok === false)!
  assert.deepEqual(refused.errors, [{ field: 'version', code: 'manufacturing.error.version' }])
  const saved = await r.call('manufacturing.getQualityTemplate', { id: template.id })
  assert.equal(saved.version, 2)
  assert.equal((saved.criteria as Row[]).length, 1)
})
