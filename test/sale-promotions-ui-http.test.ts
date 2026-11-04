import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
import { commerceRoleTemplates } from '../packages/ketsuite/src/role-templates.ts'
const path = '/admin/sales/promotions'
test('D31d record commands replay one intent without duplicating programs, cards or revisions', async (t) => {
  const r = await setup(t)
  const create = () =>
    r.app.client.call<Row>(
      'loyalty_sale.saveProgram',
      { values: { name: 'Replay coupons', programType: 'coupons' } },
      { idempotencyKey: 'program-create' },
    )
  const saved = (await create()).value
  assert.deepEqual((await create()).value, saved)
  assert.equal((await r.call('loyalty_sale.listPrograms', {})).total, 1)
  const issue = () =>
    r.app.client.call<Row>(
      'loyalty_sale.generateCoupons',
      { id: saved.id, expectedRevision: 1, count: 3 },
      { idempotencyKey: 'program-issue' },
    )
  const issued = (await issue()).value
  assert.notEqual(issued.ok, false)
  assert.deepEqual((await issue()).value, issued)
  assert.equal((await r.call('loyalty_sale.listProgramCards', { id: saved.id })).total, 3)
  const program = await r.call('loyalty_sale.getProgram', { id: saved.id })
  const archive = () =>
    r.app.client.call<Row>(
      'loyalty_sale.setProgramActive',
      { id: saved.id, expectedRevision: program.revision, active: false },
      { idempotencyKey: 'program-archive' },
    )
  const archived = (await archive()).value
  assert.notEqual(archived.ok, false)
  assert.deepEqual((await archive()).value, archived)
  assert.equal(
    (await r.call('loyalty_sale.getProgram', { id: saved.id })).revision,
    Number(program.revision) + 1,
  )
})
test('D31d read-only routes omit writes and reject new records and forged commands', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Visible coupons', programType: 'coupons' },
  })
  await r.fixture('user.createUser', {
    id: 'viewer',
    login: 'viewer',
    password: 'test-password',
    name: 'Viewer',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'viewer-company', userId: 'viewer', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'viewer-role', name: 'Viewer' })
  await r.fixture('user.assignRole', { id: 'viewer-link', userId: 'viewer', roleId: 'viewer-role' })
  for (const fn of ['getProgram', 'listPrograms', 'listProgramCards', 'searchProgramReferences'])
    await r.fixture('user.grantFunction', {
      id: 'viewer-' + fn,
      roleId: 'viewer-role',
      fnKey: 'loyalty_sale.' + fn,
    })
  const client = r.app.client.anonymous()
  await client.login({ login: 'viewer', password: 'test-password' })
  const context = await client.get(path + '/' + saved.id + '/context?lang=en&company=acme')
  assert.equal(context.status, 200)
  const data = ((await context.json()) as { data: Record<string, unknown> }).data
  assert.equal(data.save, false)
  assert.equal(data.lifecycle, false)
  assert.equal(data.generate, false)
  for (const suffix of ['', '/context'])
    assert.equal((await client.get(path + '/new' + suffix + '?company=acme')).status, 403)
  for (const [fn, input] of [
    ['saveProgram', { id: saved.id, expectedRevision: 1, values: { name: 'Forged' } }],
    ['setProgramActive', { id: saved.id, expectedRevision: 1, active: false }],
    ['generateCoupons', { id: saved.id, expectedRevision: 1, count: 1 }],
  ] as const)
    await assert.rejects(
      client.call('loyalty_sale.' + fn, input),
      (e: unknown) => (e as { status: number }).status === 403,
    )
  await r.fixture('user.grantCompany', { id: 'viewer-other', userId: 'viewer', companyId: 'other' })
  const other = await r.fixture('loyalty_sale.saveProgram', { values: { name: 'Other company' } }, 'other')
  const foreign = await client.get(path + '/' + other.id + '/context?company=acme')
  assert.equal(foreign.status, 404)
  assert.equal((await r.call('loyalty_sale.getProgram', { id: saved.id })).name, 'Visible coupons')
})
test('D31d native program collection is paged, scope-bound and carries Help', async (t) => {
  const r = await setup(t)
  for (let i = 0; i < 27; i++)
    await r.save('loyalty_sale.saveProgram', { values: { name: 'Program ' + String(i).padStart(2, '0') } })
  const shell = await r.app.client.get(path + '?lang=en&company=acme')
  assert.equal(shell.status, 200)
  const html = await shell.text()
  assert.match(html, /sale-promotion.list-results/)
  assert.match(html, /sale-promotion-help/)
  assert.doesNotMatch(html, /Program 00/)
  const read = (href: string) =>
    r.app.client.post(path + '/read?lang=en&company=acme', JSON.stringify({ href }), {
      headers: { 'content-type': 'application/json' },
    })
  const response = await read(path + '?lang=en&company=acme&page=2')
  assert.equal(response.status, 200)
  const result = (
    (await response.json()) as { value: { rows: Row[]; total: number; page: number; pages: number } }
  ).value
  assert.equal(result.total, 27)
  assert.equal(result.page, 2)
  assert.equal(result.rows.length, 2)
  assert.ok(result.rows.every((row) => String(row.detailHref).includes('company=acme')))
  assert.equal((await read(path + '?lang=en&company=other')).status, 400)
  assert.equal((await read('/admin/products?lang=en&company=acme')).status, 400)
})
test('D31d program context primes selected references only and reflects lifecycle permissions', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Native program', productIds: [r.productId] },
  })
  const response = await r.app.client.get(path + '/' + saved.id + '/context?lang=en&company=acme')
  assert.equal(response.status, 200)
  const { data, messages } = (await response.json()) as {
    data: {
      record: Row
      references: Record<string, Row[]>
      save: boolean
      lifecycle: boolean
      cardHref: string
    }
    messages: Record<string, string>
  }
  assert.equal(data.record.id, saved.id)
  assert.equal(data.save, true)
  assert.equal(data.lifecycle, true)
  assert.equal(data.references.productIds!.length, 1)
  assert.equal(data.references.productIds![0]!.value, r.productId)
  assert.equal(data.references.categoryIds!.length, 0)
  assert.equal(messages['sale_promotion_backend.create'], 'Create program')
  assert.ok(!Object.keys(messages).some((key) => key.startsWith('product_backend.')))
  assert.equal((await r.app.client.get(path + '/missing/context?lang=en')).status, 404)
})
test('D31d card list is bounded and separates expired and cancelled issuance', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Cards', programType: 'coupons' },
  })
  await r.save('loyalty_sale.generateCoupons', {
    id: saved.id,
    expectedRevision: 1,
    count: 27,
    expiresOn: '2000-01-01',
  })
  const result = await r.call('loyalty_sale.listProgramCards', { id: saved.id, pageSize: 25, page: 2 })
  assert.equal(result.total, 27)
  assert.equal((result.rows as Row[]).length, 2)
  assert.ok((result.rows as Row[]).every((row) => row.state === 'expired'))
  const cardsPath = path + '/' + saved.id + '/cards'
  const page = await r.app.client.get(cardsPath + '?lang=en&company=acme')
  assert.equal(page.status, 200)
  const read = await r.app.client.post(
    cardsPath + '/read?lang=en&company=acme',
    JSON.stringify({ href: cardsPath + '?lang=en&company=acme&page=2' }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.equal(read.status, 200)
  const answer = ((await read.json()) as { value: { rows: Row[]; page: number } }).value
  assert.equal(answer.page, 2)
  assert.ok(answer.rows.every((row) => !row.detailHref))
  const next = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Next', programType: 'next_order_coupons' },
  })
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('sale.cancelOrder', { id: 'order' })
  const cancelled = await r.call('loyalty_sale.listProgramCards', { id: next.id })
  assert.equal((cancelled.rows as Row[])[0]!.state, 'cancelled')
})
test('D31d reference search is capped and excludes foreign catalogue values', async (t) => {
  const r = await setup(t)
  for (let i = 0; i < 28; i++) await r.save('product.saveTag', { id: 'tag-' + i, name: 'Tag ' + i })
  await r.fixture('product.saveTag', { id: 'foreign-tag', name: 'Foreign tag' }, 'other')
  await r.fixture('user.grantCompany', { id: 'owner-other', userId: 'owner', companyId: 'other' })
  await r.app.client.login({ login: 'owner', password: 'test-password' })
  const all = (await r.call('loyalty_sale.searchProgramReferences', {
    kind: 'tag',
    limit: 999,
  })) as unknown as Row[]
  assert.equal(all.length, 25)
  assert.ok(all.every((row) => row.id !== 'foreign-tag'))
  const foreign = await r.call('loyalty_sale.searchProgramReferences', { kind: 'tag', ids: ['foreign-tag'] })
  assert.deepEqual(foreign, [])
})
test('D31d role templates separate program viewing, quotation operations and configuration', () => {
  const bundles = (key: keyof typeof commerceRoleTemplates) => commerceRoleTemplates[key].bundles
  for (const key of [
    'commerce.sales-representative',
    'commerce.accountant',
    'commerce.tenant-auditor',
  ] as const) {
    assert.ok(bundles(key).includes('loyalty_sale.view'))
    assert.ok(!bundles(key).includes('loyalty_sale.configure'))
  }
  assert.ok(bundles('commerce.sales-representative').includes('loyalty_sale.operate'))
  for (const key of ['commerce.sales-manager', 'commerce.company-administrator'] as const)
    assert.ok(bundles(key).includes('loyalty_sale.configure'))
})
test('D31b the program list names kinds and states as the mock does', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Auto', programType: 'promotion' } })
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Card', programType: 'loyalty' } })
  const response = await r.app.client.post(
    path + '/read?lang=vi&company=acme',
    JSON.stringify({ href: path + '?lang=vi&company=acme' }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.equal(response.status, 200)
  const { rows } = ((await response.json()) as { value: { rows: Row[] } }).value
  // "Khuyến mãi" names the whole screen, so an automatic program is "Tự động"; loyalty is a card.
  assert.deepEqual(
    rows.map((row) => [row.name, row.programType, row.state]),
    [
      ['Auto', 'Tự động', 'active'],
      ['Card', 'Thẻ tích điểm', 'active'],
    ],
  )
  const html = await (await r.app.client.get(path + '?lang=vi&company=acme')).text()
  assert.match(html, /<h1[^>]*>(?:<!--[^>]*-->)*Khuyến mãi</)
  assert.match(html, /Đang sử dụng/)
  assert.doesNotMatch(html, /Khuyến mại|Đang hoạt động/)
})

test('W12b the program list shows code, reward, end date and usage as the mock does', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '3', priceUnit: '100' })
  const code = await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'A code',
      programType: 'promo_code',
      code: 'SALE10',
      discount: '10',
      discountMaximum: '200000',
      maxUsage: '5',
      endDate: '2026-12-31',
    },
  })
  const coupons = await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'B coupons',
      programType: 'coupons',
      discountMode: 'per_order',
      discount: '50000',
      discountApplicability: 'cheapest',
    },
  })
  await r.save('loyalty_sale.generateCoupons', { id: coupons.id, expectedRevision: 1, count: 3 })
  await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'C gift',
      programType: 'buy_x_get_y',
      minimumQuantity: '3',
      rewardProductId: r.productId,
      rewardProductQuantity: '2',
    },
  })
  await r.save('loyalty_sale.saveProgram', {
    values: { name: 'D card', programType: 'loyalty', requiredPoints: '100', discount: '5' },
  })
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code: 'sale10' })
  const reward = (await r.app.adapter!.all('SELECT * FROM loyalty_reward')).find(
    (row) => row.programId === code.id,
  )!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: code.id, rewardId: reward.id })
  await r.save('sale.confirmOrder', { id: 'order' })
  const read = async (lang: string) => {
    const response = await r.app.client.post(
      path + `/read?lang=${lang}&company=acme`,
      JSON.stringify({ href: path + `?lang=${lang}&company=acme` }),
      { headers: { 'content-type': 'application/json' } },
    )
    assert.equal(response.status, 200)
    const { rows } = ((await response.json()) as { value: { rows: Row[] } }).value
    return rows.map((row) => [row.name, row.code, row.reward, row.appliesUntil, row.usage])
  }
  assert.deepEqual(await read('vi'), [
    ['A code', 'SALE10', 'Giảm 10% trên đơn (tối đa 200.000\u00a0₫)', '31/12/2026', '1/5'],
    ['B coupons', '', 'Giảm 50.000\u00a0₫ một đơn vị rẻ nhất', '—', '0/3'],
    // Three units qualify, so confirming the order took the automatic gift as well.
    ['C gift', '', 'Mỗi 3 tặng 2 × Goods', '—', '1'],
    ['D card', '', '100 điểm: Giảm 5% trên đơn', '—', '0'],
  ])
  assert.deepEqual(
    (await read('en')).map((row) => row[2]),
    [
      '10% off the order (at most ₫200,000)',
      '₫50,000 off the cheapest unit',
      'Every 3: 2 × Goods free',
      '100 points: 5% off the order',
    ],
  )
  // Xuất CSV writes the same cells for every program the list's search and filters match.
  const exported = async (query: string, client = r.app.client) => {
    const response = await client.get(path + '/export?lang=vi&company=acme' + query)
    const bytes = Buffer.from(await response.arrayBuffer())
    // The byte-order mark makes a spreadsheet read the file as UTF-8; text() would drop it.
    return {
      response,
      bom: bytes.subarray(0, 3).toString('hex'),
      lines: bytes.subarray(3).toString('utf8').split('\r\n'),
    }
  }
  const all = await exported('')
  assert.equal(all.response.status, 200)
  assert.match(String(all.response.headers.get('content-type')), /^text\/csv/)
  assert.equal(all.bom, 'efbbbf')
  assert.deepEqual(all.lines, [
    '"Tên chương trình","Loại","Mã","Phần thưởng","Áp dụng đến","Đã dùng","Trạng thái"',
    '"A code","Mã giảm giá","SALE10","Giảm 10% trên đơn (tối đa 200.000\u00a0₫)","31/12/2026","1/5","Đang sử dụng"',
    '"B coupons","Phiếu ưu đãi","","Giảm 50.000\u00a0₫ một đơn vị rẻ nhất","—","0/3","Đang sử dụng"',
    '"C gift","Mua X tặng Y","","Mỗi 3 tặng 2 × Goods","—","1","Đang sử dụng"',
    '"D card","Thẻ tích điểm","","100 điểm: Giảm 5% trên đơn","—","0","Đang sử dụng"',
  ])
  assert.deepEqual((await exported('&programType=coupons')).lines.slice(1), [all.lines[2]])
  assert.deepEqual((await exported('&q=gift')).lines.slice(1), [all.lines[3]])
  // Someone who cannot list programs cannot export them either.
  await r.fixture('user.createUser', {
    id: 'stranger',
    login: 'stranger',
    password: 'test-password',
    name: 'Stranger',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'stranger-company', userId: 'stranger', companyId: 'acme' })
  const stranger = r.app.client.anonymous()
  await stranger.login({ login: 'stranger', password: 'test-password' })
  assert.equal((await exported('', stranger)).response.status, 403)
})

test('W12b Xuất CSV writes a name that looks like a formula as text', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: '=1+1 "deal"', programType: 'promotion' } })
  const csv = await (await r.app.client.get(path + '/export?lang=en&company=acme')).text()
  assert.equal(csv.split('\r\n')[1]!.split(',')[0], `"'=1+1 ""deal"""`)
})

test('W12b Xuất CSV reads past the first hundred programs', async (t) => {
  const r = await setup(t)
  for (let index = 0; index < 101; index++)
    await r.save('loyalty_sale.saveProgram', {
      values: { name: `Program ${index}`, programType: 'promotion' },
    })
  const csv = await (await r.app.client.get(path + '/export?lang=en&company=acme')).text()
  assert.equal(csv.split('\r\n').length, 102)
})

test('W12b the quotation names each offered and applied reward as the program list does', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '3', priceUnit: '100' })
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Autumn', programType: 'promotion', discount: '10', discountMaximum: '20' },
  })
  const reward = (await r.app.adapter!.all('SELECT * FROM loyalty_reward')).find(
    (row) => row.programId === saved.id,
  )!
  const context = async () =>
    (
      (await (await r.app.client.get('/admin/sales/record/order/context?lang=vi&company=acme')).json()) as {
        data: { benefits: { rewardSummaries: Record<string, string>; applied: Row[] } }
      }
    ).data.benefits
  // Offered before it is applied, and the same words once it is on the quotation.
  assert.deepEqual((await context()).rewardSummaries, {
    [String(reward.id)]: 'Giảm 10% trên đơn (tối đa 20 ₫)',
  })
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: saved.id, rewardId: reward.id })
  const applied = await context()
  assert.equal(applied.applied[0]!.rewardId, reward.id)
  assert.equal(applied.rewardSummaries[String(reward.id)], 'Giảm 10% trên đơn (tối đa 20 ₫)')
})
