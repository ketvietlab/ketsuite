import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootManufacturing(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'basket-template',
    name: 'Giỏ trái cây',
    type: 'goods',
    uomId: 'kg',
    listPrice: '0',
  })
  await fixture('product.saveVariant', {
    id: 'basket',
    templateId: 'basket-template',
    combinationKey: '',
    defaultCode: 'BASKET',
  })
  for (const [id, name, usage] of [
    ['stock', 'Stock', 'internal'],
    ['production', 'Production', 'production'],
    ['finished', 'Finished goods', 'internal'],
  ])
    await fixture('stock.saveLocation', { id, name, usage })
  await fixture('manufacturing.saveBom', {
    id: 'basket-bom',
    code: 'BASKET-01',
    productId: 'basket',
    productQty: '1',
    productUomId: 'kg',
    lines: [],
    operations: [],
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return e2e
}

const productionForm = (name: string, bomId = 'basket-bom') =>
  new URLSearchParams({
    name,
    bomId,
    productQty: '12.5',
    productUomId: 'kg',
    sourceLocationId: 'stock',
    productionLocationId: 'production',
    destinationLocationId: 'finished',
    scheduledStart: '2026-08-28T08:30',
  })

test('manufacturing orders HTTP: split list/create preserves validation, locale, CSRF and legacy POST', async (t) => {
  const e2e = await bootManufacturing(t)

  const list = await (await e2e.client.get('/admin/manufacturing?lang=vi')).text()
  assert.match(list, /data-ui="list-page"/)
  assert.match(list, /href="\/admin\/manufacturing\/new\?lang=vi"/)
  assert.doesNotMatch(list, /data-ui="record-form"|manufacturing-order-create-form/)

  const create = await (await e2e.client.get('/admin/manufacturing/new?lang=vi')).text()
  assert.match(
    create,
    /data-ui="form-page" data-scope="manufacturing-order-create-form-page" data-has-aside="false"/,
  )
  assert.match(create, /id="manufacturing-order-create-form"/)
  assert.match(create, /action="\/admin\/manufacturing\/new\?lang=vi"/)
  assert.match(create, /href="\/admin\/manufacturing\?lang=vi"/)
  for (const field of [
    'name',
    'bomId',
    'productQty',
    'productUomId',
    'sourceLocationId',
    'productionLocationId',
    'destinationLocationId',
    'scheduledStart',
  ])
    assert.match(create, new RegExp(`name="${field}"`), field)
  assert.doesNotMatch(create, /form-page-aside|mail\.chatter|activity\.record/)

  const invalid = await e2e.client.post(
    '/admin/manufacturing/new?lang=vi',
    productionForm('MO/INVALID', 'missing-bom'),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /bomId: Bản ghi không tồn tại\./)
  assert.match(invalidHtml, /name="name"[^>]*value="MO\/INVALID"/)
  assert.match(invalidHtml, /<option value="missing-bom" selected="true">/)
  assert.match(invalidHtml, /name="productQty"[^>]*value="12.5"/)
  assert.match(invalidHtml, /name="scheduledStart"[^>]*value="2026-08-28T08:30"/)

  const refused = await e2e.client.post('/admin/manufacturing/new?lang=en', productionForm('MO/CROSS-SITE'), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://cross-site.example',
    },
    redirect: 'manual',
  })
  assert.equal(refused.status, 403)

  const created = await e2e.client.post('/admin/manufacturing/new?lang=en', productionForm('MO/0001'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(created.status, 303)
  assert.equal(created.headers.get('location'), '/admin/manufacturing?lang=en')

  const createdRows = await e2e.client.call<Row[]>('manufacturing.listProductions', {})
  const createdId = String(createdRows.value.find((row) => row.name === 'MO/0001')?.id)
  const detail = await (await e2e.client.get(`/admin/manufacturing/orders/${createdId}?lang=en`)).text()
  assert.match(
    detail,
    /data-ui="form-page" data-scope="manufacturing-order-execution-form-page" data-has-aside="false"/,
  )
  assert.match(detail, new RegExp(`action="/admin/manufacturing/orders/${createdId}\\?lang=en"`))
  assert.match(detail, /name="action" value="confirm"/)
  assert.match(detail, /name="action" value="cancel"/)
  assert.doesNotMatch(detail, /form-page-aside|mail\.chatter|activity\.record|record-workspace/)

  const refusedDetail = await e2e.client.post(
    `/admin/manufacturing/orders/${createdId}?lang=en`,
    new URLSearchParams({ action: 'confirm' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(refusedDetail.status, 403)
  assert.equal(
    (await e2e.client.call<Row>('manufacturing.getProduction', { id: createdId })).value.state,
    'draft',
  )

  const confirmed = await e2e.client.post(
    `/admin/manufacturing/orders/${createdId}?lang=en`,
    new URLSearchParams({ action: 'confirm' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(confirmed.status, 303)
  assert.equal(confirmed.headers.get('location'), `/admin/manufacturing/orders/${createdId}?lang=en`)

  // Cancelling asks why.
  const unexplained = await e2e.client.post(
    `/admin/manufacturing/orders/${createdId}?lang=vi`,
    new URLSearchParams({ action: 'cancel' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(unexplained.status, 200)
  assert.match(await unexplained.text(), /Cần nhập lý do\./)
  assert.equal(
    (await e2e.client.call<Row>('manufacturing.getProduction', { id: createdId })).value.state,
    'confirmed',
  )
  const cancelled = await e2e.client.post(
    `/admin/manufacturing/orders/${createdId}?lang=en`,
    new URLSearchParams({ action: 'cancel', reason: 'Customer withdrew the order' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(cancelled.status, 303)
  assert.equal(cancelled.headers.get('location'), `/admin/manufacturing/orders/${createdId}?lang=en`)

  const invalidStart = await e2e.client.post(
    `/admin/manufacturing/orders/${createdId}?lang=en`,
    new URLSearchParams({ action: 'start' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalidStart.status, 200)
  const invalidStartHtml = await invalidStart.text()
  assert.match(invalidStartHtml, /data-scope="manufacturing-order-execution-form-page"/)
  assert.match(invalidStartHtml, /version: The record changed; reload it before acting\./)
  assert.match(invalidStartHtml, /data-ui="badge" data-tone="danger"[\s\S]*?Cancelled/)
  assert.match(invalidStartHtml, /Customer withdrew the order/)
  assert.doesNotMatch(invalidStartHtml, /data-ui="form-page-actions"/)

  const englishList = await (await e2e.client.get('/admin/manufacturing?lang=en')).text()
  assert.match(englishList, /MO\/0001/)
  assert.match(englishList, /Giỏ trái cây/)
  assert.match(englishList, /data-row-href="\/admin\/manufacturing\/orders\/[^"]+\?lang=en"/)

  const legacyForm = productionForm('MO/LEGACY')
  legacyForm.set('id', 'legacy-order')
  const legacyCreated = await e2e.client.post('/admin/manufacturing?lang=vi', legacyForm, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(legacyCreated.status, 303)
  assert.equal(legacyCreated.headers.get('location'), '/admin/manufacturing?lang=vi')

  const productions = await e2e.client.call<Row[]>('manufacturing.listProductions', {})
  assert.deepEqual(productions.value.map((row) => row.name).sort(), ['MO/0001', 'MO/LEGACY'])
  assert.equal(
    (await e2e.client.call<Row>('manufacturing.getProduction', { id: 'legacy-order' })).value.name,
    'MO/LEGACY',
  )
})

test('manufacturing orders HTTP: the list follows the queue and says which orders are short', async (t) => {
  const e2e = await bootManufacturing(t)
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('product.saveTemplate', {
    id: 'apple-template',
    name: 'Táo',
    type: 'goods',
    uomId: 'kg',
    listPrice: '0',
  })
  await fixture('product.saveVariant', {
    id: 'apple',
    templateId: 'apple-template',
    combinationKey: '',
    defaultCode: 'APPLE',
  })
  await fixture('stock.configureProduct', {
    templateId: 'apple-template',
    isStorable: true,
    tracking: 'none',
  })
  await fixture('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await fixture('stock.adjustInventory', {
    id: 'apple-opening',
    productId: 'apple',
    locationId: 'stock',
    inventoryLocationId: 'count',
    countedQuantity: '10',
    productUomId: 'kg',
  })
  await fixture('manufacturing.saveBom', {
    id: 'apple-bom',
    code: 'APPLE-01',
    productId: 'basket',
    productQty: '1',
    productUomId: 'kg',
    lines: [{ productId: 'apple', productQty: '2', productUomId: 'kg' }],
  })
  await fixture('manufacturing.archiveBom', { id: 'basket-bom' })
  for (const [id, name, quantity, start] of [
    ['mo-later', 'HCM/SX/0002', '4', '2026-10-30T01:00:00.000Z'],
    ['mo-first', 'HCM/SX/0001', '3', '2026-10-29T01:00:00.000Z'],
  ])
    await fixture('manufacturing.saveProduction', {
      id,
      name,
      productId: 'basket',
      productQty: quantity,
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: start,
    })
  await fixture('manufacturing.confirmProduction', { id: 'mo-first', version: 1 })

  // 10 kg of apples: the confirmed order takes 6, the draft needs 8 of the 4 left.
  const list = await (await e2e.client.get('/admin/manufacturing?lang=vi')).text()
  const first = list.indexOf('HCM/SX/0001')
  const later = list.indexOf('HCM/SX/0002')
  assert.ok(first > 0 && later > first, 'the confirmed order leads the queue')
  assert.match(list, /Đủ nguyên liệu/)
  assert.match(list, /Thiếu nguyên liệu/)
  const short = await (await e2e.client.get('/admin/manufacturing/orders/mo-later?lang=vi')).text()
  assert.match(short, /Táo: cần 8, còn 4, đang về 0/)
  const ready = await (await e2e.client.get('/admin/manufacturing/orders/mo-first?lang=vi')).text()
  assert.doesNotMatch(ready, /Thiếu nguyên liệu/)

  // The confirmed order records use from its grid: a total per component.
  assert.match(ready, /manufacturing-order-components/)
  assert.match(ready, /name="action" value="consume"/)
  const record = (consumed: string) =>
    e2e.client.post(
      '/admin/manufacturing/orders/mo-first?lang=vi',
      new URLSearchParams({
        action: 'consume',
        components: JSON.stringify({
          added: [],
          updated: [{ id: 'apple', values: { consumed } }],
          removed: [],
          order: null,
        }),
      }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
    )
  assert.equal((await record('4')).status, 303)
  const usage = (await e2e.client.call<Row>('manufacturing.getConsumption', { id: 'mo-first' })).value
  assert.deepEqual(usage.components, [
    {
      productId: 'apple',
      uomId: 'kg',
      moveId: 'mo-first:raw:apple-bom:line:1',
      need: '6',
      consumed: '4',
      returned: '0',
      scrapped: '0',
      remaining: '2',
    },
  ])
  assert.equal(
    (await e2e.client.call<Row>('manufacturing.getProduction', { id: 'mo-first' })).value.state,
    'in_progress',
  )
  const lowered = await record('3')
  assert.equal(lowered.status, 200)
  assert.match(await lowered.text(), /Táo: không giảm được số đã dùng \(đã ghi 4\)/)
  // Over the need on a flexible BOM: recorded, and the page says so.
  assert.equal((await record('7')).status, 303)
  const over = await (await e2e.client.get('/admin/manufacturing/orders/mo-first?lang=vi')).text()
  assert.match(over, /Dùng quá định mức/)
  // Past what is left in stock (10 − 7 = 3): refused, naming what is left.
  const overStock = await record('11')
  assert.match(await overStock.text(), /Táo: không đủ tồn, chỉ còn 3\./)
})

test('manufacturing orders HTTP: output is recorded in batches and the order closes into a rest order', async (t) => {
  const e2e = await bootManufacturing(t)
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('stock.configureProduct', {
    templateId: 'basket-template',
    isStorable: true,
    tracking: 'none',
  })
  await fixture('manufacturing.saveProduction', {
    id: 'mo-out',
    name: 'HCM/SX/0007',
    bomId: 'basket-bom',
    productQty: '12.5',
    productUomId: 'kg',
    sourceLocationId: 'stock',
    productionLocationId: 'production',
    destinationLocationId: 'finished',
    scheduledStart: '2026-10-29T01:00:00.000Z',
  })
  await fixture('manufacturing.confirmProduction', { id: 'mo-out', version: 1 })
  const page = async () => (await e2e.client.get('/admin/manufacturing/orders/mo-out?lang=vi')).text()
  const post = (values: Record<string, string>) =>
    e2e.client.post('/admin/manufacturing/orders/mo-out?lang=vi', new URLSearchParams(values), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })

  const fresh = await page()
  assert.match(fresh, /Đã nhập 0 \/ 12.5 kg/)
  assert.match(fresh, /id="manufacturing-order-output"/)
  assert.doesNotMatch(fresh, /id="manufacturing-order-close"/, 'nothing to close before any output')
  assert.match(fresh, /value="complete"/, 'an untouched order can still be booked at once')

  const refused = await post({ action: 'output', quantity: '0' })
  assert.equal(refused.status, 200)
  assert.match(await refused.text(), /Dữ liệu sản xuất không hợp lệ/)
  assert.equal((await post({ action: 'output', quantity: '5' })).status, 303)
  const made = await page()
  assert.match(made, /Đã nhập 5 \/ 12.5 kg/)
  assert.match(made, /Phần còn lại 7.5 kg/)
  assert.match(made, /id="manufacturing-order-close"/)
  assert.doesNotMatch(made, /value="complete"/, 'once output is recorded the order closes from its output')

  assert.equal((await post({ action: 'close', rest: 'backorder' })).status, 303)
  const done = (await e2e.client.call<Row>('manufacturing.getProduction', { id: 'mo-out' })).value
  assert.deepEqual([done.state, done.quantityProduced, done.closedShort], ['done', '5', false])
  const rest = (await e2e.client.call<Row>('manufacturing.getProduction', { id: 'mo-out:rest:1' })).value
  assert.deepEqual(
    [rest.name, rest.productQty, rest.state, rest.backorderOfId],
    ['HCM/SX/0007-01', '7.5', 'confirmed', 'mo-out'],
  )
})

test('manufacturing work HTTP: the floor lead assigns by skill and a worker runs an operation to done', async (t) => {
  const e2e = await bootManufacturing(t)
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  for (const [id, code, skill] of [
    ['cut', 'CUT', 'cut'],
    ['pack', 'PACK', 'pack'],
  ])
    await fixture('manufacturing.saveWorkCenter', { id, code, name: `Khu ${code}`, capacity: '1', skill })
  for (const [userId, name, skill, level] of [
    ['hung', 'Ngô Văn Hùng', 'cut', 2],
    ['mai', 'Lê Thị Mai', 'pack', 2],
    ['tu', 'Đỗ Văn Tú', 'pack', 1],
  ] as const)
    await fixture('manufacturing.saveOperatorSkill', { userId, name, skill, level })
  await fixture('manufacturing.saveBom', {
    id: 'cake-bom',
    code: 'CAKE-01',
    productId: 'basket',
    productQty: '1',
    productUomId: 'kg',
    lines: [],
    operations: [
      { id: 'cut-op', name: 'Cắt bánh', workCenterId: 'cut', durationExpected: 60, sequence: 1 },
      {
        id: 'pack-op',
        name: 'Đóng hộp và dán nhãn',
        workCenterId: 'pack',
        durationExpected: 30,
        sequence: 2,
      },
    ],
  })
  await fixture('manufacturing.archiveBom', { id: 'basket-bom' })
  await fixture('manufacturing.saveProduction', {
    id: 'mo-cake',
    name: 'HCM/SX/0002',
    bomId: 'cake-bom',
    productQty: '1',
    productUomId: 'kg',
    sourceLocationId: 'stock',
    productionLocationId: 'production',
    destinationLocationId: 'finished',
    scheduledStart: '2026-10-29T01:00:00.000Z',
  })
  await fixture('manufacturing.confirmProduction', { id: 'mo-cake', version: 1 })
  const cut = '/admin/manufacturing/work/mo-cake%3Awork%3Acut-op?lang=vi'
  const pack = '/admin/manufacturing/work/mo-cake%3Awork%3Apack-op?lang=vi'
  const post = (path: string, values: Record<string, string>) =>
    e2e.client.post(path, new URLSearchParams(values), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })

  const list = await (await e2e.client.get('/admin/manufacturing/work?lang=vi')).text()
  assert.ok(list.indexOf('Cắt bánh') > 0 && list.indexOf('Đóng hộp và dán nhãn') > list.indexOf('Cắt bánh'))
  assert.match(list, /Ngô Văn Hùng/)
  assert.match(list, /Chờ công đoạn trước/)

  // The lead sees the assign form, offering only people skilled enough.
  const packPage = await (await e2e.client.get(pack)).text()
  assert.match(packPage, /id="manufacturing-work-assign"/)
  assert.match(packPage, /Lê Thị Mai · mức 2/)
  assert.doesNotMatch(packPage, /Đỗ Văn Tú/)
  const refused = await post(pack, { action: 'assign', operatorId: 'tu' })
  assert.equal(refused.status, 200)
  assert.match(await refused.text(), /Người này chưa đủ mức kỹ năng của khu/)

  // A worker runs the operation and cannot assign.
  await fixture('user.createUser', {
    id: 'hung',
    login: 'hung',
    password: 'correct horse',
    name: 'Ngô Văn Hùng',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'hung:acme', userId: 'hung', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'worker-role', name: 'Worker' })
  for (const fnKey of [
    'manufacturing.listWorkOrders',
    'manufacturing.getWorkOrder',
    'manufacturing.startWorkOrder',
    'manufacturing.pauseWorkOrder',
    'manufacturing.finishWorkOrder',
  ])
    await fixture('user.grantFunction', { id: `worker-role:${fnKey}`, roleId: 'worker-role', fnKey })
  await fixture('user.assignRole', { id: 'hung:role', userId: 'hung', roleId: 'worker-role' })
  await e2e.client.logout()
  await e2e.client.login({ login: 'hung', password: 'correct horse' })

  const mine = await (await e2e.client.get(cut)).text()
  assert.doesNotMatch(mine, /id="manufacturing-work-assign"/, 'a worker does not assign')
  assert.match(mine, /value="start"/)
  assert.equal((await post(cut, { action: 'start' })).status, 303)
  for (const minutes of ['', '0', 'abc']) {
    const wrong = await post(cut, { action: 'finish', actualMinutes: minutes, note: '' })
    assert.equal(wrong.status, 200, minutes)
    const body = await wrong.text()
    assert.match(body, /Số phút thực tế phải là số nguyên từ 1 đến 100.000/, minutes)
  }
  assert.equal((await post(cut, { action: 'finish', actualMinutes: '75', note: 'Dao cùn' })).status, 303)
  const done = (
    await e2e.fixture.call<Row>('manufacturing.getWorkOrder', { id: 'mo-cake:work:cut-op' }, { scope })
  ).value
  assert.deepEqual(
    [done.state, done.durationActual, done.note, done.operatorId],
    ['done', 75, 'Dao cùn', 'hung'],
  )
  const next = (
    await e2e.fixture.call<Row>('manufacturing.getWorkOrder', { id: 'mo-cake:work:pack-op' }, { scope })
  ).value
  assert.deepEqual([next.state, next.operatorName], ['ready', 'Lê Thị Mai'])
  const finished = await (await e2e.client.get(cut)).text()
  assert.match(finished, /Làm hết 75 phút/)
})

test('manufacturing work HTTP: runs are logged by who did them, workers only take work, the last operation books output, and a work center link filters', async (t) => {
  const e2e = await bootManufacturing(t)
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  for (const [id, code, name, skill] of [
    ['cut', 'CUT', 'Bàn cắt', 'cut'],
    ['pack', 'PACK', 'Bàn đóng gói', 'pack'],
  ])
    await fixture('manufacturing.saveWorkCenter', { id, code, name, capacity: '1', skill })
  for (const [userId, name, skill, lead] of [
    ['hung', 'Ngô Văn Hùng', 'cut', false],
    ['admin', 'Trần Văn Lộc', 'cut', true],
    ['admin', 'Trần Văn Lộc', 'pack', true],
  ] as const)
    await fixture('manufacturing.saveOperatorSkill', { userId, name, skill, level: 2, lead })
  await fixture('manufacturing.saveBom', {
    id: 'cake-bom',
    code: 'CAKE-01',
    productId: 'basket',
    productQty: '1',
    productUomId: 'kg',
    lines: [],
    operations: [
      { id: 'cut-op', name: 'Cắt bánh', workCenterId: 'cut', durationExpected: 60, sequence: 1 },
      { id: 'pack-op', name: 'Đóng hộp', workCenterId: 'pack', durationExpected: 30, sequence: 2 },
    ],
  })
  await fixture('manufacturing.archiveBom', { id: 'basket-bom' })
  await fixture('manufacturing.saveProduction', {
    id: 'mo-cake',
    name: 'HCM/SX/0002',
    bomId: 'cake-bom',
    productQty: '50',
    productUomId: 'kg',
    sourceLocationId: 'stock',
    productionLocationId: 'production',
    destinationLocationId: 'finished',
    scheduledStart: '2026-10-29T01:00:00.000Z',
  })
  await fixture('manufacturing.confirmProduction', { id: 'mo-cake', version: 1 })
  await fixture('user.createUser', {
    id: 'hung',
    login: 'hung',
    password: 'correct horse',
    name: 'Ngô Văn Hùng',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'hung:acme', userId: 'hung', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'worker-role', name: 'Worker' })
  for (const fnKey of [
    'manufacturing.listWorkOrders',
    'manufacturing.getWorkOrder',
    'manufacturing.startWorkOrder',
    'manufacturing.pauseWorkOrder',
    'manufacturing.finishWorkOrder',
    'manufacturing.takeWorkOrder',
  ])
    await fixture('user.grantFunction', { id: `worker-role:${fnKey}`, roleId: 'worker-role', fnKey })
  await fixture('user.assignRole', { id: 'hung:role', userId: 'hung', roleId: 'worker-role' })
  const cut = '/admin/manufacturing/work/mo-cake%3Awork%3Acut-op?lang=vi'
  const pack = '/admin/manufacturing/work/mo-cake%3Awork%3Apack-op?lang=vi'
  const post = (path: string, values: Record<string, string>) =>
    e2e.client.post(path, new URLSearchParams(values), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })
  const work = async (id: string) =>
    (await e2e.fixture.call<Row>('manufacturing.getWorkOrder', { id: `mo-cake:work:${id}` }, { scope })).value

  // A work center link becomes the list's own filter.
  const link = await e2e.client.get('/admin/manufacturing/work?workcenter=pack&lang=vi', {
    redirect: 'manual',
  })
  assert.equal(link.status, 303)
  const filtered = await (await e2e.client.get(String(link.headers.get('location')))).text()
  assert.match(filtered, /Đóng hộp/)
  assert.doesNotMatch(filtered, /Cắt bánh/)

  await e2e.client.logout()
  await e2e.client.login({ login: 'hung', password: 'correct horse' })
  assert.equal((await post(cut, { action: 'start' })).status, 303)
  const noMinutes = await post(cut, { action: 'pause', pauseMinutes: '' })
  assert.equal(noMinutes.status, 200)
  assert.match(await noMinutes.text(), /Số phút thực tế phải là số nguyên/)
  assert.equal((await post(cut, { action: 'pause', pauseMinutes: '30' })).status, 303)
  assert.equal((await post(cut, { action: 'start' })).status, 303)
  // A worker cannot hand the work to someone else.
  const handOff = await post(cut, { action: 'assign', operatorId: 'admin', assignMinutes: '5' })
  assert.equal(handOff.status, 403)
  assert.equal((await work('cut-op')).operatorId, 'hung')

  // The lead takes it over after 20 minutes of Hùng's second run and finishes in 15.
  await e2e.client.logout()
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const takePage = await (await e2e.client.get(cut)).text()
  assert.match(takePage, /id="manufacturing-work-take"/)
  assert.equal((await post(cut, { action: 'take', minutes: '20' })).status, 303)
  assert.equal(
    (await post(cut, { action: 'finish', actualMinutes: '15', note: '', loss: '0.2' })).status,
    303,
  )
  const done = await work('cut-op')
  assert.deepEqual(
    (done.runs as Row[]).map((run) => `${String(run.operatorName)} ${String(run.minutes)}`),
    ['Ngô Văn Hùng 30', 'Ngô Văn Hùng 20', 'Trần Văn Lộc 15'],
  )
  // Python: 30 + 20 + 15 = 65.
  assert.deepEqual([done.durationActual, done.loss], [65, '0.2'])
  assert.match(await (await e2e.client.get(cut)).text(), /Hao hụt 0.2 kg/)

  // The last operation books the finished goods from its own page.
  const last = await (await e2e.client.get(pack)).text()
  assert.match(last, /id="manufacturing-work-output"/)
  assert.doesNotMatch(takePage, /id="manufacturing-work-output"/, 'only the last operation books output')
  assert.equal((await post(pack, { action: 'output', quantity: '50' })).status, 303)
  assert.equal(
    (await e2e.fixture.call<Row>('manufacturing.getProduction', { id: 'mo-cake' }, { scope })).value
      .quantityProduced,
    '50',
  )
})
