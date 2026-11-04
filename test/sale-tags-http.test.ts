import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

const code = (result: Row) => String((result.errors as Row[] | undefined)?.[0]?.messageKey ?? '')
const listState = (q: string) => ({
  presets: [],
  filters: [],
  groupBy: [],
  sort: [],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
  q,
})

async function tagged(t: TestContext) {
  const r = await setup(t)
  const tag = (id: string, name: string, extra: Row = {}) => r.call('sale.saveTag', { id, name, ...extra })
  const tags = async (input: Row = {}) => (await r.call('sale.listTags', input)) as unknown as Row[]
  const held = async (id: string) =>
    (((await r.call('sale.getOrderTags', { id })) as Row).tags as Row[]).map((row) => row.id)
  return { ...r, tag, tags, held }
}

test('D15 tags are names unique in the company, archived but never lost', async (t) => {
  const r = await tagged(t)
  assert.equal((await r.tag('vip', '  Khách VIP ')).ok, true)
  assert.equal(code(await r.tag('again', 'khách vip')), 'sale.error.tag.duplicateName')
  assert.equal(code(await r.tag('blank', '   ')), 'sale.error.tag.required')
  assert.equal(code(await r.tag('long', 'x'.repeat(31))), 'sale.error.tag.tooLong')
  // Another company keeps its own tags, under the same name too.
  assert.equal((await r.fixture('sale.saveTag', { id: 'theirs', name: 'Khách VIP' }, 'other')).ok, true)
  assert.deepEqual(
    (await r.tags()).map((row) => [row.id, row.name]),
    [['vip', 'Khách VIP']],
  )

  const [vip] = await r.tags()
  assert.equal(code(await r.tag('vip', 'VIP', { expectedRevisionId: 'stale' })), 'sale.error.tag.conflict')
  const renamed = await r.tag('vip', 'VIP', { expectedRevisionId: vip!.revisionId })
  assert.equal(renamed.ok, true, JSON.stringify(renamed))
  // Archiving from a stale read is refused too.
  assert.equal(
    code(
      await r.call('sale.setTagActive', { id: 'vip', active: false, expectedRevisionId: vip!.revisionId }),
    ),
    'sale.error.tag.conflict',
  )
  const archived = await r.call('sale.setTagActive', {
    id: 'vip',
    active: false,
    expectedRevisionId: renamed.revisionId,
  })
  assert.equal(archived.ok, true)
  assert.deepEqual(await r.tags(), [])
  assert.deepEqual(
    (await r.tags({ includeArchived: true })).map((row) => [row.name, row.active]),
    [['VIP', false]],
  )
  assert.equal(
    code(await r.tag('vip', 'VIP 2', { expectedRevisionId: archived.revisionId })),
    'sale.error.tag.inactive',
  )
  // Its name stays taken while it is archived.
  assert.equal(code(await r.tag('other-vip', 'vip')), 'sale.error.tag.duplicateName')
  const restored = await r.call('sale.setTagActive', {
    id: 'vip',
    active: true,
    expectedRevisionId: archived.revisionId,
  })
  assert.equal(restored.ok, true)
  assert.equal((await r.tags())[0]!.active, true)
})

test('D15 an order carries up to ten tags, also once confirmed, and is found by their names', async (t) => {
  const r = await tagged(t)
  for (const [id, name] of [
    ['vip', 'Khách VIP'],
    ['tet', 'Đơn Tết'],
    ['old', 'Cũ'],
  ])
    await r.tag(id, name)
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  await r.save('sale.createOrder', { id: 'plain', partnerId: 'buyer', warehouseId: 'wh' })
  assert.equal(
    code(await r.call('sale.setOrderTags', { id: 'quote', tagIds: ['nope'] })),
    'sale.error.tag.invalid',
  )
  assert.equal(
    code(await r.call('sale.setOrderTags', { id: 'missing', tagIds: [] })),
    'sale.error.tag.orderMissing',
  )
  // Another company's tag is not one of ours.
  await r.fixture('sale.saveTag', { id: 'theirs', name: 'Của họ' }, 'other')
  assert.equal(
    code(await r.call('sale.setOrderTags', { id: 'quote', tagIds: ['theirs'] })),
    'sale.error.tag.invalid',
  )
  const many = Array.from({ length: 11 }, (_, index) => `t${index}`)
  for (const id of many) await r.tag(id, id)
  assert.equal(
    code(await r.call('sale.setOrderTags', { id: 'quote', tagIds: many })),
    'sale.error.tag.tooMany',
  )

  const before = Number((await r.call('sale.getOrder', { id: 'quote' })).revision)
  const set = await r.call('sale.setOrderTags', { id: 'quote', tagIds: ['tet', 'vip', 'old', 'vip'] })
  assert.equal(set.ok, true, JSON.stringify(set))
  assert.deepEqual(await r.held('quote'), ['tet', 'vip', 'old'])
  // Tags are not terms: the order keeps its revision.
  assert.equal(Number((await r.call('sale.getOrder', { id: 'quote' })).revision), before)

  // Archived, a tag stays on the order that carries it and goes on no other.
  const old = (await r.tags()).find((row) => row.id === 'old')!
  await r.save('sale.setTagActive', { id: 'old', active: false, expectedRevisionId: old.revisionId })
  assert.equal((await r.call('sale.setOrderTags', { id: 'quote', tagIds: ['old', 'vip'] })).ok, true)
  assert.equal(
    code(await r.call('sale.setOrderTags', { id: 'plain', tagIds: ['old'] })),
    'sale.error.tag.invalid',
  )
  assert.equal((await r.tags({ ids: ['old'] }))[0]!.orderCount, 1)

  assert.equal((await r.add({ id: 'quote-line', orderId: 'quote', productUomId: 'each' })).ok, true)
  await r.save('sale.confirmOrder', { id: 'quote' })
  assert.equal((await r.call('sale.setOrderTags', { id: 'quote', tagIds: ['vip', 'tet'] })).ok, true)
  assert.deepEqual(await r.held('quote'), ['vip', 'tet'])

  // A tag's name, without accents or case, finds the orders that carry it.
  const search = async (state: string, q: string) =>
    (((await r.call('sale.listOrders', { state, listState: listState(q) })) as Row).rows as Row[]).map(
      (row) => row.id,
    )
  assert.deepEqual(await search('sale', 'don tet'), ['quote'])
  assert.deepEqual(await search('draft', 'don tet'), [])
  assert.deepEqual(
    ((await r.call('sale.listOrders', { search: 'KHÁCH VIP' })) as unknown as Row[]).map((row) => row.id),
    ['quote'],
  )
  await r.save('sale.setOrderTags', { id: 'quote', tagIds: [] })
  assert.deepEqual(await r.held('quote'), [])
  assert.deepEqual(await search('sale', 'don tet'), [])
})

test('D15 sales managers keep the tags; sellers tag orders; the warehouse does neither', async (t) => {
  const r = await tagged(t)
  await r.tag('vip', 'Khách VIP')
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (roleId: string) => {
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
    return client
  }
  const post = (client: Awaited<ReturnType<typeof login>>, fn: string, key: string, body: Row) =>
    client.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      // Record pages post their commands with an idempotency key.
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  const expected = {
    'commerce.sales-manager': [200, 200, 200],
    'commerce.company-administrator': [200, 200, 403],
    'commerce.sales-representative': [403, 200, 200],
    'commerce.accountant': [403, 200, 403],
    'commerce.warehouse-operator': [403, 403, 403],
  } as const
  for (const [roleId, [save, list, order]] of Object.entries(expected)) {
    const client = await login(roleId)
    const id = roleId.replace('commerce.', '')
    assert.equal(
      (await post(client, 'sale.saveTag', `${id}-save`, { id: `${id}-tag`, name: id })).status,
      save,
      roleId,
    )
    assert.equal((await client.request(`/admin/sales/tags?lang=vi`)).status, list, roleId)
    assert.equal(
      (await post(client, 'sale.setOrderTags', `${id}-order`, { id: 'quote', tagIds: ['vip'] })).status,
      order,
      roleId,
    )
  }

  const read = await r.app.client.request('/admin/sales/tags/read?lang=vi', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ href: '/admin/sales/tags?status=all', q: 'vip', page: 1, pageSize: 50 }),
  })
  const answer = ((await read.json()) as Row).value as Row
  assert.deepEqual(
    (answer.rows as Row[]).map((row) => [row.name, row.orderCount]),
    [['Khách VIP', 1]],
  )
  const context = (await (await r.app.client.get('/admin/sales/tags/vip/context?lang=vi')).json()) as Row
  assert.deepEqual((context.data as Row).usage, { orders: 1 })
  assert.equal((context.messages as Row)['sale_backend.tag.title'], 'Thẻ bán hàng')

  // The quotation list searches in memory; a tag's name finds the quotation too.
  const name = String((await r.call('sale.getOrder', { id: 'quote' })).name)
  const listed = async (q: string) =>
    (
      await (await r.app.client.get(`/admin/sales/quotations?lang=vi&q=${encodeURIComponent(q)}`)).text()
    ).includes(name)
  assert.deepEqual([await listed('khách vip'), await listed('không có')], [true, false])
  const order = (await (await r.app.client.get('/admin/sales/record/quote/context?lang=vi')).json()) as Row
  const data = order.data as Row
  assert.equal((data.permissions as Row).setOrderTags, true)
  assert.deepEqual((data.record as Row).tagIds, ['vip'])
  assert.equal((data.record as Row).tagNames, 'Khách VIP')
  assert.ok(((data.choices as Row).tags as Row[]).some((row) => row.id === 'vip'))
  assert.equal((order.messages as Row)['sale_backend.tags.action'], 'Sửa thẻ')
})
