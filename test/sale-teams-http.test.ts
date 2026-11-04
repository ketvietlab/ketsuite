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

/** Lá Xanh's people: Linh leads sales, Huy sells; a stranger works only for the other company. */
async function staffed(t: TestContext) {
  const r = await setup(t)
  const person = async (id: string, name: string, company = 'acme') => {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name,
      defaultCompanyId: company,
    })
    await r.fixture('user.grantCompany', { id: `${id}-${company}`, userId: id, companyId: company }, company)
  }
  await person('linh', 'Bùi Khánh Linh')
  await person('huy', 'Hoàng Gia Huy')
  await person('stranger', 'Stranger', 'other')
  const team = (id: string, values: Row = {}) =>
    r.call('sale.saveTeam', {
      id,
      name: 'Khách sỉ',
      leaderId: 'linh',
      memberIds: ['linh'],
      monthlyTarget: '120000000',
      ...values,
    })
  const teams = async (input: Row = {}) => (await r.call('sale.listTeams', input)) as unknown as Row[]
  const revision = async (id: string) => String((await teams({ ids: [id] }))[0]!.revisionId)
  const sales = async (id: string) => {
    const row = (await r.call('sale.getOrderSales', { id })) as Row
    return [row.userId, row.teamId]
  }
  return { ...r, team, teams, revision, sales }
}

test('D16 a team has a unique name, a leader and members of the company and a whole target', async (t) => {
  const r = await staffed(t)
  assert.equal(code(await r.team('b2b', { name: ' ' })), 'sale.error.team.required')
  assert.equal(code(await r.team('b2b', { name: 'x'.repeat(61) })), 'sale.error.team.tooLong')
  assert.equal(code(await r.team('b2b', { leaderId: 'stranger' })), 'sale.error.team.leader')
  assert.equal(code(await r.team('b2b', { memberIds: ['linh', 'stranger'] })), 'sale.error.team.member')
  for (const target of ['-1', '1.5', '1e6', 'x', '1234567890123456'])
    assert.equal(code(await r.team('b2b', { monthlyTarget: target })), 'sale.error.team.target', target)

  const created = await r.team('b2b', { name: '  Khách sỉ ' })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(
    code(await r.team('again', { name: 'KHÁCH SỈ', memberIds: [] })),
    'sale.error.team.duplicateName',
  )
  // A salesperson sells in one team in use at most.
  assert.equal(
    code(await r.team('retail', { name: 'Bán lẻ', memberIds: ['huy', 'linh'] })),
    'sale.error.team.memberTaken',
  )
  const retail = await r.team('retail', { name: 'Bán lẻ', memberIds: ['huy'], monthlyTarget: '' })
  assert.equal(retail.ok, true, JSON.stringify(retail))
  assert.deepEqual(
    (await r.teams()).map((row) => [
      row.name,
      row.leaderName,
      row.memberNames,
      row.memberCount,
      row.monthlyTarget,
      row.active,
    ]),
    [
      ['Bán lẻ', 'Bùi Khánh Linh', ['Hoàng Gia Huy'], 1, '0', true],
      ['Khách sỉ', 'Bùi Khánh Linh', ['Bùi Khánh Linh'], 1, '120000000', true],
    ],
  )
  // Another company keeps its own teams, under the same name too.
  assert.equal(
    (
      await r.fixture(
        'sale.saveTeam',
        { id: 'theirs', name: 'Khách sỉ', leaderId: 'stranger', memberIds: ['stranger'] },
        'other',
      )
    ).ok,
    true,
  )
  assert.equal((await r.teams()).length, 2)

  // A stale page is refused; a team keeps a target with leading zeros as its number.
  assert.equal(
    code(await r.team('b2b', { expectedRevisionId: 'stale', monthlyTarget: '007' })),
    'sale.error.team.conflict',
  )
  const saved = await r.team('b2b', { expectedRevisionId: created.revisionId, monthlyTarget: '007' })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal((await r.teams({ ids: ['b2b'] }))[0]!.monthlyTarget, '7')
  const most = await r.team('b2b', { expectedRevisionId: saved.revisionId, monthlyTarget: '999999999999999' })
  assert.equal((await r.teams({ ids: ['b2b'] }))[0]!.monthlyTarget, '999999999999999', JSON.stringify(most))
})

test('D16 an archived team frees its members and comes back only if none joined another', async (t) => {
  const r = await staffed(t)
  await r.save('sale.saveTeam', { id: 'b2b', name: 'Khách sỉ', leaderId: 'linh', memberIds: ['linh'] })
  await r.save('sale.saveTeam', { id: 'retail', name: 'Bán lẻ', leaderId: 'linh', memberIds: ['huy'] })
  const before = await r.revision('retail')
  assert.equal(
    code(await r.call('sale.setTeamActive', { id: 'retail', active: false, expectedRevisionId: 'stale' })),
    'sale.error.team.conflict',
  )
  await r.save('sale.setTeamActive', { id: 'retail', active: false, expectedRevisionId: before })
  assert.deepEqual(
    (await r.teams()).map((row) => row.id),
    ['b2b'],
  )
  assert.equal(
    code(await r.team('retail', { name: 'Bán lẻ 2', expectedRevisionId: await r.revision('retail') })),
    'sale.error.team.inactive',
  )
  // Huy is free to join Khách sỉ, so Bán lẻ cannot come back while he sells there.
  await r.save('sale.saveTeam', {
    id: 'b2b',
    name: 'Khách sỉ',
    leaderId: 'linh',
    memberIds: ['linh', 'huy'],
    expectedRevisionId: await r.revision('b2b'),
  })
  assert.equal(
    code(
      await r.call('sale.setTeamActive', {
        id: 'retail',
        active: true,
        expectedRevisionId: await r.revision('retail'),
      }),
    ),
    'sale.error.team.memberTaken',
  )
  await r.save('sale.saveTeam', {
    id: 'b2b',
    name: 'Khách sỉ',
    leaderId: 'linh',
    memberIds: ['linh'],
    expectedRevisionId: await r.revision('b2b'),
  })
  await r.save('sale.setTeamActive', {
    id: 'retail',
    active: true,
    expectedRevisionId: await r.revision('retail'),
  })
  assert.deepEqual(
    (await r.teams()).map((row) => [row.name, row.memberIds]),
    [
      ['Bán lẻ', ['huy']],
      ['Khách sỉ', ['linh']],
    ],
  )
  // The archived name stays taken.
  await r.save('sale.setTeamActive', {
    id: 'retail',
    active: false,
    expectedRevisionId: await r.revision('retail'),
  })
  assert.equal(code(await r.team('new', { name: 'bán lẻ', memberIds: [] })), 'sale.error.team.duplicateName')
})

test('D16 an order is sold by the customer’s salesperson or its creator, in their team', async (t) => {
  const r = await staffed(t)
  await r.save('sale.saveTeam', { id: 'b2b', name: 'Khách sỉ', leaderId: 'linh', memberIds: ['linh'] })
  await r.save('sale.saveTeam', { id: 'retail', name: 'Bán lẻ', leaderId: 'linh', memberIds: ['huy'] })
  // The owner sells in no team; a customer without a salesperson is sold by whoever writes the order.
  await r.save('sale.createOrder', { id: 'mine', partnerId: 'buyer', warehouseId: 'wh' })
  assert.deepEqual(await r.sales('mine'), ['owner', null])
  const customer = (await r.call('sale.getCustomer', { id: 'buyer' })) as Row
  await r.save('sale.saveCustomer', {
    id: 'buyer',
    expectedRevision: customer.revision,
    kind: customer.kind,
    name: customer.name,
    salespersonId: 'huy',
  })
  await r.save('sale.createOrder', { id: 'his', partnerId: 'buyer', warehouseId: 'wh' })
  assert.deepEqual(await r.sales('his'), ['huy', 'retail'])
  // A named salesperson brings their team; a named team stays; null is no one.
  await r.save('sale.createOrder', { id: 'hers', partnerId: 'buyer', warehouseId: 'wh', userId: 'linh' })
  assert.deepEqual(await r.sales('hers'), ['linh', 'b2b'])
  await r.save('sale.createOrder', { id: 'picked', partnerId: 'buyer', warehouseId: 'wh', teamId: 'b2b' })
  assert.deepEqual(await r.sales('picked'), ['huy', 'b2b'])
  await r.save('sale.createOrder', {
    id: 'nobody',
    partnerId: 'buyer',
    warehouseId: 'wh',
    userId: null,
    teamId: null,
  })
  assert.deepEqual(await r.sales('nobody'), [null, null])
  assert.equal(
    code(
      await r.call('sale.createOrder', {
        id: 'x1',
        partnerId: 'buyer',
        warehouseId: 'wh',
        userId: 'stranger',
      }),
    ),
    'sale.error.team.salesperson',
  )
  assert.equal(
    code(
      await r.call('sale.createOrder', { id: 'x2', partnerId: 'buyer', warehouseId: 'wh', teamId: 'theirs' }),
    ),
    'sale.error.team.invalid',
  )
  assert.equal((await r.call('sale.getOrder', { id: 'x1' })) ?? null, null)

  // A copy keeps its salesperson, in the team they sell in now.
  assert.equal((await r.add({ id: 'hers-line', orderId: 'hers', productUomId: 'each' })).ok, true)
  const hers = (await r.call('sale.getOrder', { id: 'hers' })) as Row
  await r.save('sale.copyOrder', { id: 'hers-copy', sourceId: 'hers', expectedRevision: hers.revision })
  assert.deepEqual(await r.sales('hers-copy'), ['linh', 'b2b'])
})

test('D16 an order’s salesperson and team change in any state, outside its revision', async (t) => {
  const r = await staffed(t)
  await r.save('sale.saveTeam', { id: 'b2b', name: 'Khách sỉ', leaderId: 'linh', memberIds: ['linh'] })
  await r.save('sale.saveTeam', { id: 'retail', name: 'Bán lẻ', leaderId: 'linh', memberIds: ['huy'] })
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh', userId: 'huy' })
  await r.save('sale.createOrder', { id: 'plain', partnerId: 'buyer', warehouseId: 'wh', userId: null })
  const set = (input: Row) => r.call('sale.setOrderSalesperson', { id: 'quote', ...input })
  const before = Number(((await r.call('sale.getOrder', { id: 'quote' })) as Row).revision)

  // Another salesperson brings their team, unless a team is named too.
  await r.save('sale.setOrderSalesperson', { id: 'quote', userId: 'linh' })
  assert.deepEqual(await r.sales('quote'), ['linh', 'b2b'])
  await r.save('sale.setOrderSalesperson', { id: 'quote', userId: 'huy', teamId: 'b2b' })
  assert.deepEqual(await r.sales('quote'), ['huy', 'b2b'])
  await r.save('sale.setOrderSalesperson', { id: 'quote', teamId: 'retail' })
  assert.deepEqual(await r.sales('quote'), ['huy', 'retail'])
  await r.save('sale.setOrderSalesperson', { id: 'quote', teamId: null })
  assert.deepEqual(await r.sales('quote'), ['huy', null])
  // Naming the same salesperson again leaves the team as it is.
  await r.save('sale.setOrderSalesperson', { id: 'quote', userId: 'huy' })
  assert.deepEqual(await r.sales('quote'), ['huy', null])
  assert.equal(code(await set({ userId: 'stranger' })), 'sale.error.team.salesperson')
  assert.equal(code(await set({ teamId: 'missing' })), 'sale.error.team.invalid')
  assert.equal(
    code(await r.call('sale.setOrderSalesperson', { id: 'missing', userId: 'huy' })),
    'sale.error.team.orderMissing',
  )
  assert.equal(Number(((await r.call('sale.getOrder', { id: 'quote' })) as Row).revision), before)

  // An archived team stays on the order in it, and goes on no other.
  await r.save('sale.setOrderSalesperson', { id: 'quote', teamId: 'retail' })
  await r.save('sale.setTeamActive', {
    id: 'retail',
    active: false,
    expectedRevisionId: await r.revision('retail'),
  })
  await r.save('sale.setOrderSalesperson', { id: 'quote', userId: 'huy', teamId: 'retail' })
  assert.deepEqual(await r.sales('quote'), ['huy', 'retail'])
  assert.equal(
    code(await r.call('sale.setOrderSalesperson', { id: 'plain', teamId: 'retail' })),
    'sale.error.team.invalid',
  )
  // Huy sells in no team in use now: a new order of his is in none.
  await r.save('sale.createOrder', { id: 'later', partnerId: 'buyer', warehouseId: 'wh', userId: 'huy' })
  assert.deepEqual(await r.sales('later'), ['huy', null])

  // Confirmed, the order still takes another salesperson.
  assert.equal((await r.add({ id: 'quote-line', orderId: 'quote', productUomId: 'each' })).ok, true)
  await r.save('sale.confirmOrder', { id: 'quote' })
  await r.save('sale.setOrderSalesperson', { id: 'quote', userId: 'linh' })
  assert.deepEqual(await r.sales('quote'), ['linh', 'b2b'])

  // A team's name, without accents or case, finds the orders in it.
  const search = async (state: string, q: string) =>
    (((await r.call('sale.listOrders', { state, listState: listState(q) })) as Row).rows as Row[]).map(
      (row) => row.id,
    )
  assert.deepEqual(await search('sale', 'khach si'), ['quote'])
  assert.deepEqual(await search('draft', 'khach si'), [])
  const listed = (await r.call('sale.listOrders', { search: 'KHÁCH SỈ' })) as unknown as Row[]
  assert.deepEqual(
    listed.map((row) => [row.id, row.userName, row.teamName]),
    [['quote', 'Bùi Khánh Linh', 'Khách sỉ']],
  )
})

test('D16 sales managers keep the teams; sellers name an order’s salesperson; the warehouse neither', async (t) => {
  const r = await staffed(t)
  await r.save('sale.saveTeam', { id: 'b2b', name: 'Khách sỉ', leaderId: 'linh', memberIds: ['linh'] })
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh', userId: 'linh' })
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
      (
        await post(client, 'sale.saveTeam', `${id}-save`, {
          id: `${id}-team`,
          name: id,
          leaderId: 'linh',
          memberIds: [],
        })
      ).status,
      save,
      roleId,
    )
    assert.equal((await client.request(`/admin/sales/teams?lang=vi`)).status, list, roleId)
    assert.equal(
      (await post(client, 'sale.setOrderSalesperson', `${id}-order`, { id: 'quote', userId: 'linh' })).status,
      order,
      roleId,
    )
  }

  const read = await r.app.client.request('/admin/sales/teams/read?lang=vi', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ href: '/admin/sales/teams?status=all', q: 'linh', page: 1, pageSize: 50 }),
  })
  const answer = ((await read.json()) as Row).value as Row
  assert.deepEqual(
    (answer.rows as Row[])
      .filter((row) => row.id === 'b2b')
      .map((row) => [row.name, row.leaderName, row.memberCount]),
    [['Khách sỉ', 'Bùi Khánh Linh', 1]],
  )
  const context = (await (await r.app.client.get('/admin/sales/teams/b2b/context?lang=vi')).json()) as Row
  const data = context.data as Row
  assert.deepEqual((data.record as Row).memberIds, ['linh'])
  assert.ok(((data.choices as Row).salespeople as Row[]).some((row) => row.id === 'huy'))
  assert.equal((context.messages as Row)['sale_backend.team.title'], 'Đội bán hàng')

  // The quotation list searches in memory; a team's name finds the quotation too.
  const name = String(((await r.call('sale.getOrder', { id: 'quote' })) as Row).name)
  const listed = async (q: string) =>
    (
      await (await r.app.client.get(`/admin/sales/quotations?lang=vi&q=${encodeURIComponent(q)}`)).text()
    ).includes(name)
  assert.deepEqual([await listed('khách sỉ'), await listed('không có')], [true, false])
  const order = (await (await r.app.client.get('/admin/sales/record/quote/context?lang=vi')).json()) as Row
  const page = order.data as Row
  assert.equal((page.permissions as Row).setOrderSalesperson, true)
  assert.deepEqual(
    [(page.record as Row).userName, (page.record as Row).teamName],
    ['Bùi Khánh Linh', 'Khách sỉ'],
  )
  assert.ok(((page.choices as Row).teams as Row[]).some((row) => row.id === 'b2b'))
  assert.equal((order.messages as Row)['sale_backend.sales.action'], 'Sửa người bán')
  const create = (await (await r.app.client.get('/admin/sales/record/new/context?lang=vi')).json()) as Row
  assert.ok((((create.data as Row).choices as Row).salespeople as Row[]).some((row) => row.id === 'linh'))
})
