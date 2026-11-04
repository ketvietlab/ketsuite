import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

/**
 * The RFQ line grid's save (`purchase.saveLines`): goods bought by the each or the box of 12, and a
 * unit of another tree. A purchasing operator, a role that may only add lines and a role holding only
 * the grid's own function work in it.
 */
async function seed(t: TestContext) {
  const r = await boot(t)
  const { save } = r
  await save('uom.saveUnit', { id: 'box', name: 'Box of 12', relativeUomId: 'each', relativeFactor: '12' })
  await save('uom.saveUnit', { id: 'hour', name: 'Hour', relativeFactor: '1' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'GOODS',
    purchaseOk: true,
  })
  await save('account.saveTax', {
    id: 'vat',
    name: 'VAT 10%',
    typeTaxUse: 'purchase',
    amountType: 'percent',
    amount: '10',
  })
  await save('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  await save('partner.grantRole', { id: 'vendor-role', partnerId: 'vendor', role: 'supplier' })
  await save('stock.saveLocation', { id: 'supplier', name: 'Supplier', usage: 'supplier' })
  await save('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' })
  await save('stock.savePickingType', {
    id: 'incoming',
    name: 'Receipt',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  const order = async (id: string, lines: string[]) => {
    await save('purchase.createOrder', { id, partnerId: 'vendor', pickingTypeId: 'incoming' })
    for (const line of lines)
      await save('purchase.addLine', {
        id: line,
        orderId: id,
        productId: 'goods:default',
        productUomId: 'each',
        productQty: '2',
        priceUnit: '100',
      })
  }
  await order('po', ['a', 'b'])
  await order('other', ['c'])

  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const grants: Record<string, string[]> = {
    'grid-only': ['purchase.saveLines', 'purchase.getOrder'],
    adds: ['purchase.saveLines', 'purchase.addLine', 'purchase.getOrder'],
  }
  for (const [roleId, fns] of Object.entries(grants)) {
    await r.fixture('user.saveRole', { id: roleId, name: roleId })
    for (const fnKey of fns)
      await r.fixture('user.grantFunction', { id: `${roleId}:${fnKey}`, roleId, fnKey })
  }
  const users: Record<string, ReturnType<typeof r.app.client.anonymous>> = {}
  for (const [id, roleId] of [
    ['buyer', 'commerce.purchasing-operator'],
    ['adder', 'adds'],
    ['gridOnly', 'grid-only'],
  ] as const) {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    users[id] = r.app.client.anonymous()
    await users[id]!.login({ login: id, password: 'test-password' })
  }
  /** Saves the grid as one of the users: the answer, or the HTTP status when the call is refused. */
  const grid = async (user: string, id: string, lines: unknown, removed: unknown = []) => {
    const response = await users[user]!.request('/_ket/fn/purchase.saveLines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, lines, removed }),
    })
    if (response.status !== 200) return { status: response.status } as Row
    const answer = (await response.json()) as Row
    return (answer.value ?? answer) as Row
  }
  /** The order's lines in order: id, quantity, unit, price, discount, tax. */
  const lines = async (id: string) =>
    ((await r.call('purchase.getOrder', { id })).lines as Row[])
      .toSorted((left, right) => Number(left.sequence) - Number(right.sequence))
      .map((line) => [
        line.id,
        Number(line.productQty),
        line.productUomId,
        Number(line.priceUnit),
        Number(line.discount),
        line.taxId ?? null,
      ])
  const field = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.field
  return { ...r, grid, lines, field }
}

const added = (id: string, values: Row = {}) => ({
  id,
  productId: 'goods:default',
  productQty: '3',
  productUomId: 'box',
  priceUnit: '',
  discount: '',
  taxId: '',
  ...values,
})

test('purchase.saveLines adds, changes and removes the lines at once, or nothing', async (t) => {
  const r = await seed(t)
  const save = [
    { id: 'a', productQty: '5', priceUnit: '90', taxId: 'vat' },
    added('draft:new-1', { priceUnit: '1100' }),
  ]
  assert.deepEqual(await r.grid('buyer', 'po', save, ['b']), { ok: true, id: 'po' })
  // The new line follows the order's last line, in its own unit.
  assert.deepEqual(await r.lines('po'), [
    ['a', 5, 'each', 90, 0, 'vat'],
    ['draft:new-1', 3, 'box', 1100, 0, null],
  ])
  // A retried save writes nothing twice: the line it added is there, the one it removed is gone.
  assert.deepEqual(await r.grid('buyer', 'po', save, ['b']), { ok: true, id: 'po' })
  assert.deepEqual(await r.lines('po'), [
    ['a', 5, 'each', 90, 0, 'vat'],
    ['draft:new-1', 3, 'box', 1100, 0, null],
  ])
  // An emptied tax cell takes the tax off; a change of quantity alone keeps the price.
  assert.deepEqual(
    await r.grid('buyer', 'po', [
      { id: 'a', taxId: '' },
      { id: 'draft:new-1', productQty: '4' },
    ]),
    {
      ok: true,
      id: 'po',
    },
  )
  assert.deepEqual(await r.lines('po'), [
    ['a', 5, 'each', 90, 0, null],
    ['draft:new-1', 4, 'box', 1100, 0, null],
  ])
  // One refused line keeps every other change out, the removal too.
  for (const [lines, name] of [
    [[{ id: 'a', productQty: '7' }, added('draft:new-2', { productUomId: 'hour' })], 'productUomId'],
    [[added('draft:new-2'), { id: 'a', productQty: '-1' }], 'productQty'],
    [[{ id: 'a', discount: '120' }], 'priceUnit'],
  ] as const) {
    const result = await r.grid('buyer', 'po', lines, ['draft:new-1'])
    assert.equal(result.ok, false)
    assert.equal(r.field(result), name)
  }
  assert.deepEqual(await r.lines('po'), [
    ['a', 5, 'each', 90, 0, null],
    ['draft:new-1', 4, 'box', 1100, 0, null],
  ])
})

test('purchase.saveLines takes each part only from who may do it alone, on this open RFQ only', async (t) => {
  const r = await seed(t)
  const before = await r.lines('po')
  // The grid's function alone writes nothing: adding, changing and removing each need their own.
  for (const [lines, removed] of [
    [[added('draft:new-1')], []],
    [[{ id: 'a', productQty: '9' }], []],
    [[], ['b']],
  ] as const)
    assert.deepEqual(await r.grid('gridOnly', 'po', lines, removed), { status: 403 })
  // A role that only adds lines may add, but a change in the same save refuses the add with it.
  assert.deepEqual(await r.grid('adder', 'po', [added('draft:new-1'), { id: 'a', productQty: '9' }]), {
    status: 403,
  })
  assert.deepEqual(await r.lines('po'), before)
  assert.deepEqual(await r.grid('adder', 'po', [added('draft:new-1')]), { ok: true, id: 'po' })
  // Retrying that save needs no right to change lines: the line it added is already there.
  assert.deepEqual(await r.grid('adder', 'po', [added('draft:new-1')]), { ok: true, id: 'po' })
  assert.equal((await r.lines('po')).length, 3)

  // A line of another order is neither changed, removed nor taken over by a new line.
  for (const [lines, removed] of [
    [[{ id: 'c', productQty: '9' }], []],
    [[added('c')], []],
    [[], ['c']],
    [[{ id: '', productQty: '1' }], []],
    [['a'], []],
  ] as const) {
    const result = await r.grid('buyer', 'po', lines, removed)
    assert.equal(result.ok, false, JSON.stringify(lines))
    assert.equal(r.field(result), 'id')
  }
  assert.deepEqual(await r.lines('other'), [['c', 2, 'each', 100, 0, null]])
  // A grid the modal could not read is refused by name.
  for (const [lines, removed] of [
    [null, []],
    [[], { id: 'b' }],
  ] as const)
    assert.equal(r.field(await r.grid('buyer', 'po', lines, removed)), 'lines')
  // A confirmed order's lines are no longer the grid's.
  assert.equal((await r.call('purchase.confirmOrder', { id: 'other' })).ok, true)
  const confirmed = await r.grid('buyer', 'other', [{ id: 'c', productQty: '9' }])
  assert.equal(confirmed.ok, false)
  assert.match(String((confirmed.errors as Row[])[0]?.message), /unlocked RFQ/)
  assert.deepEqual(await r.lines('other'), [['c', 2, 'each', 100, 0, null]])
})
