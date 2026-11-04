import { withoutGlobalSearchDialog } from './helpers/shell.ts'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootBoms(t: TestContext) {
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
  for (const [id, name, code] of [
    ['basket', 'Giỏ trái cây', 'BASKET'],
    ['apple', 'Táo', 'APPLE'],
  ]) {
    await fixture('product.saveTemplate', {
      id: `${id}-template`,
      name,
      type: 'goods',
      uomId: 'kg',
      listPrice: '0',
    })
    await fixture('product.saveVariant', {
      id,
      templateId: `${id}-template`,
      combinationKey: '',
      defaultCode: code,
    })
  }
  await fixture('manufacturing.saveBom', {
    id: 'existing-bom',
    code: 'BOM/0001',
    productId: 'basket',
    productQty: '10',
    productUomId: 'kg',
    lines: [],
    operations: [],
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return e2e
}

const bomForm = (code: string, productId = 'basket') =>
  new URLSearchParams({
    code,
    productId,
    productQty: '12.5',
    productUomId: 'kg',
    componentId: 'apple',
    componentQty: '2',
    componentUomId: 'kg',
    operationName: '',
    workCenterId: '',
    durationExpected: '30',
  })

test('manufacturing BOM HTTP: modal split preserves locale, values, CSRF and legacy POST', async (t) => {
  const e2e = await bootBoms(t)

  const list = await (await e2e.client.get('/admin/manufacturing/boms?lang=vi')).text()
  assert.match(list, /data-ui="list-page"/)
  assert.match(list, /href="\/admin\/manufacturing\/boms\?create=1&amp;lang=vi"/)
  assert.match(list, /BOM\/0001/)
  assert.match(list, /Giỏ trái cây/)
  assert.doesNotMatch(withoutGlobalSearchDialog(list), /data-ui="record-form"|data-ui="modal-layer"/)

  const modal = await (await e2e.client.get('/admin/manufacturing/boms?create=1&lang=vi')).text()
  assert.match(modal, /data-ui="list-page"/)
  assert.match(modal, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(modal, /action="\/admin\/manufacturing\/boms\/new\?lang=vi"/)
  assert.match(modal, /data-ui="modal-close" href="\/admin\/manufacturing\/boms\?lang=vi"/)
  for (const field of [
    'code',
    'productId',
    'productQty',
    'productUomId',
    'componentId',
    'componentQty',
    'componentUomId',
    'operationName',
    'workCenterId',
    'durationExpected',
  ])
    assert.match(modal, new RegExp(`name="${field}"`), field)

  const compatibility = await e2e.client.get('/admin/manufacturing/boms/new?lang=en', {
    redirect: 'manual',
  })
  assert.equal(compatibility.status, 303)
  assert.equal(compatibility.headers.get('location'), '/admin/manufacturing/boms?create=1&lang=en')

  const refused = await e2e.client.post('/admin/manufacturing/boms/new?lang=en', bomForm('BOM/CROSS'), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://cross-site.example',
    },
    redirect: 'manual',
  })
  assert.equal(refused.status, 403)

  const invalid = await e2e.client.post(
    '/admin/manufacturing/boms/new?lang=vi',
    bomForm('BOM/INVALID', 'missing-product'),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /data-ui="list-page"/)
  assert.match(invalidHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidHtml, /name="code"[^>]*value="BOM\/INVALID"/)
  assert.match(invalidHtml, /<option value="missing-product" selected="true">/)
  assert.match(invalidHtml, /name="productQty"[^>]*value="12.5"/)
  assert.match(invalidHtml, /name="componentQty"[^>]*value="2"/)

  const created = await e2e.client.post('/admin/manufacturing/boms/new?lang=en', bomForm('BOM/0002'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(created.status, 303)
  // A new BOM is a draft version, opened on its own page.
  assert.match(String(created.headers.get('location')), /^\/admin\/manufacturing\/boms\/[0-9a-f-]+\?lang=en$/)

  const legacyForm = bomForm('BOM/LEGACY')
  legacyForm.set('id', 'legacy-bom')
  const legacy = await e2e.client.post('/admin/manufacturing/boms?lang=vi', legacyForm, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(legacy.status, 303)
  assert.equal(legacy.headers.get('location'), '/admin/manufacturing/boms/legacy-bom?lang=vi')

  const boms = await e2e.client.call<Row[]>('manufacturing.listBoms', {})
  assert.deepEqual(boms.value.map((row) => row.code).sort(), ['BOM/0001', 'BOM/0002', 'BOM/LEGACY'])
  assert.deepEqual(
    boms.value.filter((row) => row.code !== 'BOM/0001').map((row) => row.state),
    ['draft', 'draft'],
  )
  assert.equal(
    (await e2e.client.call<Row>('manufacturing.getBom', { id: 'legacy-bom' })).value.code,
    'BOM/LEGACY',
  )
})

test('manufacturing BOM HTTP: a draft saves both grids in one post, names a refused row, and needs another approver', async (t) => {
  const e2e = await bootBoms(t)
  const scope = { company: 'acme', branches: null }
  await e2e.fixture.call('manufacturing.saveWorkCenter', { id: 'cook', code: 'NAU', name: 'Nấu' }, { scope })
  await e2e.fixture.call(
    'user.createUser',
    {
      id: 'owner',
      login: 'owner',
      password: 'correct horse',
      name: 'Owner',
      defaultCompanyId: 'acme',
      superuser: true,
    },
    { scope },
  )
  await e2e.fixture.call(
    'user.grantCompany',
    { id: 'owner:acme', userId: 'owner', companyId: 'acme' },
    { scope },
  )
  const created = await e2e.client.post('/admin/manufacturing/boms/new?lang=vi', bomForm('BTP-02'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  const page = String(created.headers.get('location'))
  const id = decodeURIComponent(page.split('/').pop()!.split('?')[0]!)

  const html = await (await e2e.client.get(page)).text()
  assert.match(html, /manufacturing\.bom-page/)
  assert.match(html, /manufacturing-bom-help/)
  const contextOf = async (client = e2e.client) => {
    const response = await client.get(`/admin/manufacturing/boms/${encodeURIComponent(id)}/context?lang=vi`)
    assert.equal(response.status, 200)
    return ((await response.json()) as { data: Row }).data
  }
  const draft = await contextOf()
  assert.deepEqual([(draft.record as Row).productQty, (draft.record as Row).productUomId], ['12.5', 'kg'])
  assert.deepEqual(draft.can, {
    save: true,
    submit: true,
    approve: false,
    reject: false,
    newVersion: false,
    archive: true,
    products: true,
  })

  const save = (lines: Row[], operations: Row[]) =>
    e2e.client.post(
      '/admin/manufacturing/boms/record-command?lang=vi',
      new URLSearchParams({
        id,
        code: 'BTP-02',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        consumption: 'strict',
        lines: JSON.stringify(lines),
        operations: JSON.stringify(operations),
      }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
    )
  const refused = (await (
    await save(
      [
        { id: `${id}:a`, productId: 'apple', productQty: '1', productUomId: 'kg' },
        { id: `${id}:b`, productId: '', productQty: '1', productUomId: 'kg' },
        { id: `${id}:c`, productId: 'apple', productQty: '1', productUomId: 'kg', lossPercent: '60' },
      ],
      [{ id: `${id}:o`, name: 'Nấu', workCenterId: '', durationExpected: 30 }],
    )
  ).json()) as { value: { ok: boolean; errors: Array<{ field: string; message: string }> } }
  assert.equal(refused.value.ok, false)
  assert.deepEqual(
    refused.value.errors.map((error) => error.message),
    [
      'Công đoạn, dòng 1: Chưa chọn khu sản xuất cho công đoạn.',
      'Nguyên vật liệu, dòng 2: Chưa chọn nguyên liệu.',
      'Nguyên vật liệu, dòng 3: Hao hụt phải từ 0 đến 50%.',
    ],
  )
  // A refused row leaves every row as it was.
  assert.equal(((await contextOf()).record as Row).consumption, null)
  const lines = Array.from({ length: 6 }, (_, index) => ({
    id: `${id}:line-${index}`,
    productId: 'apple',
    productQty: String(index + 1),
    productUomId: 'kg',
    lossPercent: '2',
    operationId: `${id}:op-${index % 3}`,
  }))
  const operations = ['Cân', 'Nấu', 'Đóng gói'].map((name, index) => ({
    id: `${id}:op-${index}`,
    name,
    workCenterId: 'cook',
    durationExpected: 10 * (index + 1),
    timeMode: index === 1 ? 'fixed' : 'quantity',
  }))
  const saved = (await (await save(lines, operations)).json()) as { value: Row }
  assert.equal(saved.value.ok, true, JSON.stringify(saved.value))
  const record = (await contextOf()).record as Row
  assert.deepEqual(
    [(record.lines as Row[]).length, (record.operations as Row[]).length, record.consumption],
    [6, 3, 'strict'],
  )

  assert.equal(
    (await e2e.client.call<Row>('manufacturing.submitBom', { id, reason: 'Công thức mới' })).value.ok,
    true,
  )
  assert.equal(((await contextOf()).can as Row).save, false)
  const self = await e2e.client.call<Row>('manufacturing.approveBom', { id })
  assert.equal((self.value.errors as Row[])[0]?.code, 'manufacturing.error.sameReviewer')
  const owner = e2e.client.anonymous()
  await owner.login({ login: 'owner', password: 'correct horse' })
  assert.equal(((await contextOf(owner)).can as Row).approve, true)
  assert.equal((await owner.call<Row>('manufacturing.approveBom', { id })).value.ok, true)
  const active = await contextOf()
  assert.equal((active.record as Row).state, 'active')
  assert.equal((active.can as Row).newVersion, true)
})
