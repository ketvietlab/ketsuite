import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * K15 (#1428): someone assigned to one warehouse only has it chosen on a new quotation, count or scrap;
 * anyone who may work in several chooses, unless the company has one warehouse.
 */
test('K15 a new document starts in the one warehouse its maker is assigned to, else none', async (t) => {
  const r = await setup(t)
  const read = async (path: string) => {
    const response = await r.app.client.get(`${path}${path.includes('?') ? '&' : '?'}lang=en`)
    assert.equal(response.status, 200, path)
    return ((await response.json()) as { data: { record: Row } }).data.record.warehouseId || null
  }
  const chosen = async () => [
    await read('/admin/sales/record/new/context'),
    await read('/admin/stock/count-session/new/context'),
    await read('/admin/stock/scrap/new/context'),
  ]
  const staff = async (id: string, userIds: string[]) =>
    r.save('stock.saveWarehouse', {
      id,
      name: id === 'wh' ? 'Warehouse' : 'Hà Nội',
      code: id.toUpperCase(),
      userIds,
    })
  const warehouse = async (id: string) =>
    ((await r.call('stock.listWarehouses', {})) as unknown as Row[]).find((row) => row.id === id)!

  // One warehouse and nobody assigned: it is the only choice.
  assert.deepEqual(await chosen(), ['wh', 'wh', 'wh'])
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  // Two warehouses, assigned to none: the maker may work in both, so nothing is chosen.
  assert.deepEqual(await chosen(), [null, null, null])
  // Assigned to Hà Nội only: chosen, though the company has two.
  await staff('hn', ['owner'])
  assert.deepEqual(await chosen(), ['hn', 'hn', 'hn'])
  assert.deepEqual(await warehouse('hn'), { ...(await warehouse('hn')), userIds: ['owner'], assigned: true })
  assert.equal((await warehouse('wh')).assigned, false)
  // Assigned to both: nothing is chosen, to keep a quotation out of the wrong warehouse.
  await staff('wh', ['owner'])
  assert.deepEqual(await chosen(), [null, null, null])
  // Saving without staff leaves who is assigned; an empty list clears it.
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  assert.deepEqual((await warehouse('wh')).userIds, ['owner'])
  await staff('wh', [])
  assert.deepEqual((await warehouse('wh')).userIds, [])
  assert.deepEqual(await chosen(), ['hn', 'hn', 'hn'])
  // A scrap opened from a transfer keeps that transfer's warehouse (covered in the scraps suite); here the
  // query names none, so the person's warehouse stands.
})

test('K15 only the company’s active people can be assigned to a warehouse', async (t) => {
  const r = await setup(t)
  await r.fixture('user.createUser', { id: 'lan', login: 'lan', password: 'test-password', name: 'Lan' })
  await r.fixture('user.grantCompany', { id: 'lan-acme', userId: 'lan', companyId: 'acme' })
  await r.fixture('user.createUser', {
    id: 'stranger',
    login: 'stranger',
    password: 'test-password',
    name: 'Ba',
  })
  await r.fixture(
    'user.grantCompany',
    { id: 'stranger-other', userId: 'stranger', companyId: 'other' },
    'other',
  )
  assert.deepEqual(await r.call('stock.listWarehousePeople', {}), [
    { id: 'lan', name: 'Lan' },
    { id: 'owner', name: 'Owner' },
  ])
  const refused = await r.call('stock.saveWarehouse', {
    id: 'wh',
    name: 'Warehouse',
    code: 'WH',
    userIds: ['lan', 'stranger'],
  })
  assert.deepEqual(refused, {
    ok: false,
    errors: [{ field: 'userIds', messageKey: 'stock.error.warehouseUser' }],
  })
  // A list it must be; the function's input refuses anything else.
  await assert.rejects(
    r.call('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH', userIds: 'lan' }),
  )
  const listed = async () =>
    ((await r.call('stock.listWarehouses', {})) as unknown as Row[]).find((row) => row.id === 'wh')!.userIds
  assert.deepEqual(await listed(), [])
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH', userIds: ['lan', 'lan'] })
  assert.deepEqual(await listed(), ['lan'])
  // Saving again is a replay, not a second assignment.
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH', userIds: ['lan'] })
  assert.deepEqual(await listed(), ['lan'])
  // Someone who left the company can no longer be assigned.
  await r.fixture('user.archiveUser', { id: 'lan', active: false })
  assert.equal(
    (await r.call('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH', userIds: ['lan'] })).ok,
    false,
  )
})

test('K15 the warehouse page picks its staff among the company’s people and names them to readers', async (t) => {
  const r = await setup(t)
  await r.fixture('user.createUser', { id: 'lan', login: 'lan', password: 'test-password', name: 'Lan' })
  await r.fixture('user.grantCompany', { id: 'lan-acme', userId: 'lan', companyId: 'acme' })
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH', userIds: ['lan'] })
  const response = await r.app.client.get('/admin/stock/record/warehouse/wh/context?lang=vi')
  assert.equal(response.status, 200)
  const { data, messages } = (await response.json()) as {
    data: { record: Row; choices: { people: Row[] } }
    messages: Record<string, string>
  }
  assert.deepEqual(data.record.userIds, ['lan'])
  assert.deepEqual(data.choices.people, [
    { id: 'lan', name: 'Lan' },
    { id: 'owner', name: 'Owner' },
  ])
  assert.equal(messages['stock_backend.warehouse.field.userIds'], 'Nhân viên kho')
})
