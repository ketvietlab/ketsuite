import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Row, tableNameFor } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

type Run = Awaited<ReturnType<typeof setup>>
const code = (result: Row) => String((result.errors as Row[] | undefined)?.[0]?.messageKey ?? '')

/** Goods GOODS (from the fixture), goods SHIRT in Clothes / Shirts, service ADVICE, a combo, an archived and an unsold product. */
async function catalogue(r: Run) {
  await r.save('product.saveCategory', { id: 'clothes', name: 'Clothes' })
  await r.save('product.saveCategory', { id: 'shirts', name: 'Shirts', parentId: 'clothes' })
  const product = (id: string, values: Row) =>
    r.save('product.saveRecord', { id, name: id, uomId: 'each', listPrice: '10', saleOk: true, ...values })
  await product('shirt', { name: 'Áo sơ mi', type: 'goods', defaultCode: 'SHIRT', categoryId: 'shirts' })
  await product('advice', { name: 'Advice', type: 'service', defaultCode: 'ADVICE' })
  // Before D21 a service could be saved by delivered quantities; the row still says so.
  const q = r.app.adapter!.quoteIdent.bind(r.app.adapter)
  await r.app.adapter!.run(
    `UPDATE ${q(tableNameFor('product.Template'))} SET ${q('invoicePolicy')} = 'delivery' WHERE ${q('id')} = 'advice'`,
  )
  await product('old', { name: 'Old', type: 'goods', defaultCode: 'OLD' })
  await product('unsold', { name: 'Unsold', type: 'goods', defaultCode: 'UNSOLD', saleOk: false })
  await r.save('product.saveCombo', {
    id: 'choice',
    name: 'Choice',
    items: [{ productId: r.productId, extraPrice: '0' }],
  })
  await product('combo', { name: 'Combo', type: 'combo', defaultCode: 'COMBO', comboIds: ['choice'] })
  const current = await r.call('product.templateModalContext', { id: 'old', locale: 'en' })
  await r.save('product.archiveTemplate', {
    id: 'old',
    active: false,
    confirmed: true,
    reason: 'No longer offered',
    expectedRevisionId: ((current.data as Row).record as Row).revisionId,
  })
}
const policies = async (r: Run) =>
  ((await r.call('sale.listInvoicePolicies', {})) as unknown as Row[]).map((row) => [
    row.defaultCode,
    row.policy,
    row.setting,
  ])

test('D21 the list holds products on sale with the policy their next line takes', async (t) => {
  const r = await setup(t)
  await catalogue(r)
  // Codes order the list; combos, archived and unsold products are not in it.
  assert.deepEqual(await policies(r), [
    ['ADVICE', 'order', 'service'],
    ['GOODS', 'order', 'default'],
    ['SHIRT', 'order', 'default'],
  ])
  const shirt = ((await r.call('sale.listInvoicePolicies', { ids: ['shirt'] })) as unknown as Row[])[0]!
  assert.deepEqual(
    [shirt.name, shirt.categoryName, shirt.type, shirt.invoicePolicy],
    ['Áo sơ mi', 'Clothes / Shirts', 'goods', null],
  )
  // A service keeps no policy of its own, whatever it was saved with as goods.
  const advice = ((await r.call('sale.listInvoicePolicies', { ids: ['advice'] })) as unknown as Row[])[0]!
  assert.deepEqual([advice.type, advice.invoicePolicy, advice.policy], ['service', null, 'order'])
  // Goods without their own policy follow the company default; services do not.
  await r.save('sale.saveConfiguration', { goodsInvoicePolicy: 'delivery', expectedRevision: 0 })
  await r.save('sale.setInvoicePolicy', { templateId: 'shirt', invoicePolicy: 'order' })
  assert.deepEqual(await policies(r), [
    ['ADVICE', 'order', 'service'],
    ['GOODS', 'delivery', 'default'],
    ['SHIRT', 'order', 'own'],
  ])
  assert.deepEqual(await r.call('sale.getProductInvoicePolicy', { templateId: 'goods' }), {
    invoicePolicy: 'delivery',
  })
  assert.deepEqual(await r.call('sale.getProductInvoicePolicy', { templateId: 'advice' }), {
    invoicePolicy: 'order',
  })
})

test('D21 a goods product sets or clears its own policy at its revision; others are refused', async (t) => {
  const r = await setup(t)
  await catalogue(r)
  const revision = async (id: string) =>
    String(((await r.call('sale.listInvoicePolicies', { ids: [id] })) as unknown as Row[])[0]!.revisionId)
  const before = await revision('shirt')
  const set = (templateId: string, invoicePolicy: string | null, expectedRevisionId?: string) =>
    r.call('sale.setInvoicePolicy', {
      templateId,
      invoicePolicy,
      ...(expectedRevisionId === undefined ? {} : { expectedRevisionId }),
    })
  assert.equal(code(await set('shirt', 'later')), 'sale.error.invoicePolicy.value')
  assert.equal(code(await set('advice', 'delivery')), 'sale.error.invoicePolicy.service')
  assert.equal(code(await set('advice', 'order')), 'sale.error.invoicePolicy.service')
  assert.equal(code(await set('combo', 'order')), 'sale.error.invoicePolicy.combo')
  assert.equal(code(await set('missing', 'order')), 'sale.error.invoicePolicy.missing')
  assert.equal(await revision('shirt'), before)

  assert.equal((await set('shirt', 'delivery', before)).ok, true)
  const changed = await revision('shirt')
  assert.notEqual(changed, before)
  // Someone saved in between: the stale revision is refused and nothing changes.
  assert.equal(code(await set('shirt', 'order', before)), 'sale.error.invoicePolicy.changed')
  assert.deepEqual(
    (await policies(r)).find(([key]) => key === 'SHIRT'),
    ['SHIRT', 'delivery', 'own'],
  )
  // Saving what is already set writes nothing.
  assert.equal((await set('shirt', 'delivery', changed)).ok, true)
  assert.equal(await revision('shirt'), changed)
  // Empty, like null, gives the product back to the company default.
  assert.equal((await set('shirt', '', changed)).ok, true)
  assert.deepEqual(
    (await policies(r)).find(([key]) => key === 'SHIRT'),
    ['SHIRT', 'order', 'default'],
  )
  const product = (await r.call('product.templateModalContext', { id: 'shirt', locale: 'en' })) as Row
  assert.equal(((product.data as Row).record as Row).revisionId, await revision('shirt'))
})

test('D21 quotations confirmed and lines added later take a new policy; sold lines keep theirs', async (t) => {
  const r = await setup(t)
  await r.save('product.saveRecord', {
    id: 'advice',
    name: 'Advice',
    type: 'service',
    defaultCode: 'ADVICE',
    uomId: 'each',
    listPrice: '70',
    saleOk: true,
  })
  const advice = String(
    ((await r.call('product.listVariants', { templateId: 'advice' })) as unknown as Row[])[0]!.id,
  )
  await r.save('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'delivery' })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  await r.add({ id: 'advice-line', productId: advice, productUomId: 'each', productUomQty: '1' })
  await r.save('sale.confirmOrder', { id: 'order' })
  const order = async () => (await r.call('sale.getOrder', { id: 'order' })) as Row
  const sold = async () =>
    Object.fromEntries(((await order()).lines as Row[]).map((line) => [line.id, line.invoicePolicy]))
  assert.deepEqual(await sold(), { line: 'delivery', 'advice-line': 'order' })

  await r.save('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'order' })
  const added = await r.call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: (await order()).revision,
    changes: {
      added: [{ id: 'later', index: 2, values: { productId: r.productId, productUomQty: 1 } }],
      updated: [],
      removed: [],
      order: null,
    },
  })
  assert.equal(added.ok, true, JSON.stringify(added))
  const lines = (await order()).lines as Row[]
  assert.equal(lines.find((line) => line.id === 'line')!.invoicePolicy, 'delivery')
  assert.equal(
    lines.find((line) => !['line', 'advice-line'].includes(String(line.id)))!.invoicePolicy,
    'order',
  )
})

test('D21 sales managers, owners and accountants set policies; sellers read them', async (t) => {
  const r = await setup(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const expected = {
    'commerce.sales-manager': [200, 200],
    'commerce.company-administrator': [200, 200],
    'commerce.accountant': [200, 200],
    'commerce.sales-representative': [403, 200],
    'commerce.warehouse-operator': [403, 403],
  } as const
  let flip = false
  for (const [roleId, [save, read]] of Object.entries(expected)) {
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
    const saved = await client.request('/_ket/fn/sale.setInvoicePolicy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `${id}-save` },
      body: JSON.stringify({ templateId: 'goods', invoicePolicy: flip ? 'order' : 'delivery' }),
    })
    assert.equal(saved.status, save, roleId)
    if (saved.status === 200) flip = !flip
    assert.equal((await client.request('/admin/sales/invoicing-policies?lang=vi')).status, read, roleId)
    const context = await client.request('/admin/sales/invoicing-policies/goods/context?lang=vi')
    assert.equal(context.status, read, roleId)
    if (read === 200)
      assert.equal(
        (((await context.json()) as Row).data as Row as { permissions: Row }).permissions.edit,
        save === 200,
        roleId,
      )
  }
})

test('D21 the screen sits behind the gear, reads its rows and opens one product', async (t) => {
  const r = await setup(t)
  await catalogue(r)
  await r.save('sale.setInvoicePolicy', { templateId: 'shirt', invoicePolicy: 'delivery' })
  const page = await r.app.client.get('/admin/sales/invoicing-policies?lang=vi')
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /data-island="sale\.policy-results"/)
  assert.match(html, /id="sale-policy-help"/)
  assert.match(html, /Chính sách xuất hoá đơn/)
  const menu = r.app.deployment.manifest.menus?.['sale.policies'] as Row | undefined
  assert.equal(menu?.parent, 'admin.sale')

  const read = async (href: string, values: Record<string, string> = {}) =>
    (
      (await (
        await r.app.client.post(
          '/admin/sales/invoicing-policies/read?lang=vi',
          new URLSearchParams({ href, ...values }),
          { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
        )
      ).json()) as { value: Row }
    ).value
  const all = await read('/admin/sales/invoicing-policies?lang=vi')
  assert.deepEqual(all.counts, { all: 3, default: 1, own: 1, service: 1 })
  assert.deepEqual(
    (all.rows as Row[]).map((row) => [row.defaultCode, row.categoryName, row.policy, row.setting]),
    [
      ['ADVICE', '', 'order', 'service'],
      ['GOODS', '', 'order', 'default'],
      ['SHIRT', 'Clothes / Shirts', 'delivery', 'own'],
    ],
  )
  assert.match(String((all.rows as Row[])[2]!.editHref), /record=sale\.invoicePolicy%3Ashirt/)
  // Search without accents across code, name and category; filter by setting; sort by code.
  const codes = (answer: Row) => (answer.rows as Row[]).map((row) => row.defaultCode)
  assert.deepEqual(codes(await read('/admin/sales/invoicing-policies', { q: 'ao so mi' })), ['SHIRT'])
  assert.deepEqual(codes(await read('/admin/sales/invoicing-policies', { q: 'shirts' })), ['SHIRT'])
  assert.deepEqual(codes(await read('/admin/sales/invoicing-policies?setting=service')), ['ADVICE'])
  assert.deepEqual(codes(await read('/admin/sales/invoicing-policies?dir=desc')), [
    'SHIRT',
    'GOODS',
    'ADVICE',
  ])
  const paged = await read('/admin/sales/invoicing-policies?pageSize=2&page=2')
  assert.deepEqual(
    [codes(paged), paged.pages, Boolean(paged.previous), Boolean(paged.next)],
    [['SHIRT'], 2, true, false],
  )

  await r.save('sale.saveConfiguration', { goodsInvoicePolicy: 'delivery', expectedRevision: 0 })
  for (const lang of ['vi', 'en']) {
    const context = (await (
      await r.app.client.get(`/admin/sales/invoicing-policies/goods/context?lang=${lang}`)
    ).json()) as { data: Row; messages: Row }
    assert.deepEqual(
      [
        (context.data.record as Row).invoicePolicy,
        context.data.goodsDefault,
        (context.data.permissions as Row).edit,
      ],
      ['', 'delivery', true],
    )
    assert.equal(
      context.messages['sale_backend.policy.followDefault'],
      lang === 'vi' ? 'Theo cấu hình chung ({policy})' : 'Sales settings ({policy})',
    )
    assert.ok(context.messages['sale.error.invoicePolicy.service'], lang)
  }
  const service = (await (
    await r.app.client.get('/admin/sales/invoicing-policies/advice/context')
  ).json()) as {
    data: Row
  }
  assert.deepEqual(
    [(service.data.record as Row).type, (service.data.record as Row).setting],
    ['service', 'service'],
  )
  assert.equal((await r.app.client.get('/admin/sales/invoicing-policies/combo/context')).status, 404)
  assert.equal((await r.app.client.get('/admin/sales/invoicing-policies/old/context')).status, 404)
})
