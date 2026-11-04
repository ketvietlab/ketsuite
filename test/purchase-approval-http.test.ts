// Purchase approval by amount: the company's thresholds decide on the server
// whether a confirmed RFQ waits for a purchasing manager and a final approver,
// and whoever drafted an order never approves it.

import { createCommerceTestDeployment as createTestDeployment } from './commerce-test-deployment.ts'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { TestHttpError, type TestClient } from '@ketvietlab/ketjs/testing'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { openStore } from '../apps/ketsuite/config.ts'

const ketsuite = createCommerceDeployment(openStore)
const managerBundles = ketsuite.permissions!.roleTemplates!['commerce.purchasing-manager']!.bundles
const deployment = defineDeployment({
  ...ketsuite,
  name: 'commerce_purchase_approval',
  permissions: {
    ...ketsuite.permissions,
    roleTemplates: {
      ...ketsuite.permissions?.roleTemplates,
      'test.purchase-final-approver': {
        version: 1,
        labels: { vi: 'Duyệt cấp cuối', en: 'Final approver' },
        bundles: [...managerBundles, 'purchase.final-approve'],
      },
    },
  },
})

const PEOPLE = {
  buyer: 'commerce.purchasing-operator',
  manager: 'commerce.purchasing-manager',
  deputy: 'commerce.purchasing-manager',
  director: 'test.purchase-final-approver',
} as const
type Person = keyof typeof PEOPLE

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'a', branch: 'root:a', branches: ['root:a'] }
  const setup = async <T = Row>(name: string, input: Record<string, unknown>) =>
    (await app.fixture.call(name, input, { scope })).value as T
  await setup('partner.savePartner', { id: 'a-party', kind: 'company', name: 'A' })
  await setup('company.saveCompany', { id: 'a', code: 'a', partnerId: 'a-party', currency: 'VND' })
  await setup('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  await setup('uom.saveUnit', { id: 'unit', name: 'Cái', relativeFactor: '1' })
  await setup('product.saveTemplate', {
    id: 'goods',
    name: 'Bàn',
    type: 'goods',
    uomId: 'unit',
    purchaseOk: true,
  })
  await setup('product.saveVariant', { id: 'desk', templateId: 'goods', combinationKey: '' })
  await setup('stock.saveLocation', { id: 'supplier', name: 'Supplier', usage: 'supplier' })
  await setup('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' })
  await setup('stock.savePickingType', {
    id: 'receipt',
    name: 'Receipt',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  const clients = {} as Record<Person, TestClient>
  const roles = new Map<string, string>()
  for (const [person, template] of Object.entries(PEOPLE) as [Person, string][]) {
    await setup('user.createUser', {
      id: person,
      login: person,
      name: person,
      password: 'correct horse',
      defaultCompanyId: 'a',
    })
    await setup('user.grantCompany', { id: `${person}-a`, userId: person, companyId: 'a' })
    // A managed role is the template applied once; people sharing a job share it.
    if (!roles.has(template)) {
      const roleId = `role-${roles.size}`
      const role = await setup('user.applyRoleTemplate', {
        roleId,
        templateKey: template,
        expectedRoleRevision: 0,
        expectedAuthorizationRevision: (await setup('user.authorizationState', {})).revision,
        idempotencyKey: roleId,
      })
      assert.equal(role.ok, true, JSON.stringify(role))
      roles.set(template, roleId)
    }
    const assigned = await setup('user.assignScopedRole', {
      id: `${person}-grant`,
      userId: person,
      roleId: roles.get(template),
      scopeKind: 'company',
      companyId: 'a',
      expectedAuthorizationRevision: (await setup('user.authorizationState', {})).revision,
      idempotencyKey: `${person}-grant`,
    })
    assert.equal(assigned.ok, true, JSON.stringify(assigned))
    const client = app.client.anonymous()
    await client.login({ login: person, password: 'correct horse' })
    clients[person] = client
  }
  const call = async (person: Person, name: string, input: Record<string, unknown> = {}) =>
    (await clients[person].call<Row>(name, input)).value
  /** A draft of `total` VND drafted by `person`: one line of ten desks. */
  const draft = async (person: Person, id: string, total: number) => {
    assert.equal(
      (await call(person, 'purchase.createOrder', { id, partnerId: 'vendor', pickingTypeId: 'receipt' })).ok,
      true,
    )
    const line = await call(person, 'purchase.addLine', {
      id: `${id}:line`,
      orderId: id,
      productId: 'desk',
      productQty: '10',
      productUomId: 'unit',
      priceUnit: String(total / 10),
    })
    assert.equal(line.ok, true, JSON.stringify(line))
  }
  const configure = async (approvalAmount: string | null, finalApprovalAmount: string | null) => {
    const current = await call('manager', 'purchase.getConfiguration')
    const saved = await call('manager', 'purchase.saveConfiguration', {
      approvalAmount,
      finalApprovalAmount,
      expectedRevision: current.revision,
    })
    assert.equal(saved.ok, true, JSON.stringify(saved))
  }
  const order = async (id: string) =>
    (await call('manager', 'purchase.getOrder', { id })) as Row & { approval: Row }
  const forbidden = (person: Person, name: string, input: Record<string, unknown>) =>
    assert.rejects(
      () => clients[person].call(name, input),
      (error: unknown) => error instanceof TestHttpError && error.status === 403,
    )
  const code = (result: Row) => (result.errors as Row[] | undefined)?.[0]?.code
  const page = (person: Person, path: string) => clients[person].get(path)
  return { call, draft, configure, order, forbidden, code, page }
}

test('a buyer confirms an order below the thresholds, and with no thresholds, without approval', async (t) => {
  const { call, draft, configure, order } = await boot(t)
  await draft('buyer', 'free', 300_000_000)
  const confirmed = await call('buyer', 'purchase.confirmOrder', { id: 'free' })
  assert.equal(confirmed.state, 'purchase', JSON.stringify(confirmed))
  assert.ok(confirmed.pickingId)

  await configure('50000000', '200000000')
  await draft('buyer', 'small', 49_000_000)
  assert.equal((await order('small')).approval.required, 0)
  assert.equal((await call('buyer', 'purchase.confirmOrder', { id: 'small' })).state, 'purchase')
})

test('from the first threshold an order waits for a purchasing manager, from the second also for a final approver', async (t) => {
  const { call, draft, configure, order, forbidden, code } = await boot(t)
  await configure('50000000', '200000000')

  await draft('buyer', 'level-one', 60_000_000)
  assert.equal((await order('level-one')).approval.required, 1)
  assert.equal((await call('buyer', 'purchase.confirmOrder', { id: 'level-one' })).state, 'to approve')
  // Confirming again never turns the pending approval into an order.
  assert.equal((await call('buyer', 'purchase.confirmOrder', { id: 'level-one' })).state, 'to approve')
  assert.equal((await order('level-one')).state, 'to approve')
  await forbidden('buyer', 'purchase.approveOrder', { id: 'level-one' })
  const approved = await call('manager', 'purchase.approveOrder', { id: 'level-one' })
  assert.equal(approved.state, 'purchase', JSON.stringify(approved))
  assert.ok(approved.pickingId)
  const given = (await order('level-one')).approval.given as Row[]
  assert.deepEqual(
    given.map((row) => [row.level, row.approvedBy]),
    [['manager', 'manager']],
  )

  await draft('buyer', 'level-two', 250_000_000)
  assert.equal((await call('buyer', 'purchase.confirmOrder', { id: 'level-two' })).state, 'to approve')
  const partly = await call('manager', 'purchase.approveOrder', { id: 'level-two' })
  assert.equal(partly.state, 'to approve', JSON.stringify(partly))
  assert.deepEqual(partly.pending, ['owner'])
  assert.deepEqual((await order('level-two')).approval.pending, ['owner'])
  assert.equal(
    code(await call('deputy', 'purchase.approveOrder', { id: 'level-two' })),
    'purchase.error.approval.finalPending',
  )
  await forbidden('manager', 'purchase.finalApproveOrder', { id: 'level-two' })
  const final = await call('director', 'purchase.finalApproveOrder', { id: 'level-two' })
  assert.equal(final.state, 'purchase', JSON.stringify(final))

  // A final approver gives every level still pending.
  await draft('buyer', 'straight', 250_000_000)
  await call('buyer', 'purchase.confirmOrder', { id: 'straight' })
  assert.equal((await call('director', 'purchase.finalApproveOrder', { id: 'straight' })).state, 'purchase')
  assert.deepEqual(((await order('straight')).approval.given as Row[]).map((row) => row.level).sort(), [
    'manager',
    'owner',
  ])
})

test('whoever drafted an order cannot approve it, at either level', async (t) => {
  const { call, draft, configure, order, code } = await boot(t)
  await configure('50000000', '200000000')
  await draft('manager', 'own', 60_000_000)
  assert.equal((await call('manager', 'purchase.confirmOrder', { id: 'own' })).state, 'to approve')
  assert.equal((await order('own')).approval.draftedByCaller, true)
  assert.equal(
    code(await call('manager', 'purchase.approveOrder', { id: 'own' })),
    'purchase.error.approval.ownOrder',
  )
  assert.equal((await order('own')).state, 'to approve')
  assert.equal((await call('deputy', 'purchase.approveOrder', { id: 'own' })).state, 'purchase')

  await draft('director', 'own-large', 250_000_000)
  await call('director', 'purchase.confirmOrder', { id: 'own-large' })
  assert.equal(
    code(await call('director', 'purchase.finalApproveOrder', { id: 'own-large' })),
    'purchase.error.approval.ownOrder',
  )
})

test('an order keeps the levels it was submitted with; back to draft it forgets its approvals', async (t) => {
  const { call, draft, configure, order } = await boot(t)
  await configure('50000000', '200000000')
  // Asked for below the thresholds, approval takes one purchasing manager.
  await draft('buyer', 'asked', 10_000_000)
  assert.equal(
    (await call('buyer', 'purchase.confirmOrder', { id: 'asked', requiresApproval: true })).state,
    'to approve',
  )
  await configure('5000000', '6000000')
  assert.equal((await call('manager', 'purchase.approveOrder', { id: 'asked' })).state, 'purchase')

  await configure('50000000', '200000000')
  await draft('buyer', 'redo', 250_000_000)
  await call('buyer', 'purchase.confirmOrder', { id: 'redo' })
  await call('manager', 'purchase.approveOrder', { id: 'redo' })
  assert.equal((await call('buyer', 'purchase.resetToDraft', { id: 'redo' })).state, 'draft')
  const reset = await order('redo')
  assert.deepEqual(reset.approval.given, [])
  assert.equal(reset.approvalLevels, null)
  await configure(null, null)
  assert.equal((await call('buyer', 'purchase.confirmOrder', { id: 'redo' })).state, 'purchase')
})

test('purchasing settings refuse invalid thresholds and stale revisions; only a manager saves them', async (t) => {
  const { call, forbidden } = await boot(t)
  const start = await call('buyer', 'purchase.getConfiguration')
  assert.deepEqual([start.approvalAmount, start.finalApprovalAmount, start.revision], [null, null, 0])
  await forbidden('buyer', 'purchase.saveConfiguration', { approvalAmount: '1', expectedRevision: 0 })
  const refused = async (input: Record<string, unknown>) =>
    (((await call('manager', 'purchase.saveConfiguration', { expectedRevision: 0, ...input }))
      .errors as Row[]) ?? [])[0]
  assert.deepEqual(await refused({ approvalAmount: '-5' }), {
    field: 'approvalAmount',
    code: 'purchase.error.configuration.amount',
  })
  assert.equal((await refused({ approvalAmount: '1.234' }))?.code, 'purchase.error.configuration.amount')
  assert.equal(
    (await refused({ finalApprovalAmount: '100' }))?.code,
    'purchase.error.configuration.finalAmount',
  )
  assert.equal(
    (await refused({ approvalAmount: '100', finalApprovalAmount: '100' }))?.code,
    'purchase.error.configuration.finalAmount',
  )
  const saved = await call('manager', 'purchase.saveConfiguration', {
    approvalAmount: '50000000',
    finalApprovalAmount: '200000000.50',
    expectedRevision: 0,
  })
  assert.deepEqual(
    [saved.approvalAmount, saved.finalApprovalAmount, saved.revision],
    ['50000000', '200000000.50', 1],
  )
  assert.equal(
    (await refused({ approvalAmount: '1' }))?.code,
    'purchase.error.configurationChanged',
    'a save at an old revision is refused',
  )
  const unchanged = await call('manager', 'purchase.saveConfiguration', {
    approvalAmount: '50000000',
    expectedRevision: 1,
  })
  assert.equal(unchanged.revision, 1, 'an unchanged save writes nothing')
})

test('the order page offers the commands its reader may give; the settings page saves only for a manager', async (t) => {
  const { call, draft, configure, page } = await boot(t)
  await configure('50000000', '200000000')
  await draft('buyer', 'large', 250_000_000)
  type Context = {
    data: { record: Row & { approval: Row }; permissions: Record<string, boolean>; save?: boolean }
  }
  const context = async (person: Person, path: string) => {
    const response = await page(person, path)
    assert.equal(response.status, 200, `${person} ${path}`)
    return (await response.json()) as Context
  }
  const draftView = await context('buyer', '/admin/purchase/record/large/context?lang=vi')
  assert.equal(draftView.data.record.approval.required, 2)
  assert.equal(draftView.data.permissions.confirmOrder, true)
  assert.equal(draftView.data.permissions.approveOrder, false)
  await call('buyer', 'purchase.confirmOrder', { id: 'large' })
  const managerView = await context('manager', '/admin/purchase/record/large/context?lang=vi')
  assert.deepEqual(managerView.data.record.approval.pending, ['manager', 'owner'])
  assert.equal(managerView.data.record.approval.draftedByCaller, false)
  assert.deepEqual(
    [managerView.data.permissions.approveOrder, managerView.data.permissions.finalApproveOrder],
    [true, false],
  )
  const directorView = await context('director', '/admin/purchase/record/large/context?lang=en')
  assert.equal(directorView.data.permissions.finalApproveOrder, true)

  for (const [person, save] of [
    ['buyer', false],
    ['manager', true],
  ] as const) {
    const screen = await page(person, '/admin/purchase/configuration?lang=vi')
    assert.equal(screen.status, 200)
    assert.match(await screen.text(), /Cấu hình mua hàng/)
    const settings = await context(person, '/admin/purchase/configuration/context?lang=vi')
    assert.equal(settings.data.save, save)
    assert.equal(settings.data.record.approvalAmount, '50000000')
  }
})
