import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/** A quotation of two boxes, the accounts and journals an invoice and a deposit need. */
async function booked(t: TestContext) {
  const r = await setup(t)
  for (const [id, accountType, reconcile] of [
    ['revenue', 'income', false],
    ['receivable', 'asset_receivable', true],
    ['bank', 'asset_cash', false],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile })
  await r.save('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('account.saveJournal', {
    id: 'bank',
    name: 'Ngân hàng',
    code: 'BNK',
    type: 'bank',
    defaultAccountId: 'bank',
  })
  const events = async (id = 'order') =>
    ((await r.call('sale.listOrderEvents', { id })) as unknown as Row[]).map((row) => [
      row.action,
      row.actorName,
      row.relatedId,
    ])
  const invoice = {
    orderId: 'order',
    journalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  }
  return { ...r, events, invoice }
}

test('D7 every order command leaves one event naming who ran it, newest first', async (t) => {
  const r = await booked(t)
  assert.equal((await r.add({ productUomQty: '2', priceUnit: '500' })).ok, true)
  const revision = Number((await r.call('sale.getOrder', { id: 'order' })).revision)
  await r.save('sale.updateLine', { id: 'line', expectedRevision: revision, productUomQty: '3' })
  await r.save('sale.saveTag', { id: 'vip', name: 'VIP' })
  await r.save('sale.setOrderTags', { id: 'order', tagIds: ['vip'] })
  // The same tags again change nothing, so nothing is recorded.
  await r.save('sale.setOrderTags', { id: 'order', tagIds: ['vip'] })
  // A refused command leaves no event.
  assert.equal((await r.call('sale.confirmOrder', { id: 'order', expectedRevision: 0 })).ok, false)
  await r.save('sale.confirmOrder', { id: 'order' })
  // Confirming a confirmed order is answered, not recorded again.
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('sale.createInvoice', { id: 'inv-1', ...r.invoice })
  await r.save('sale.collectDeposit', {
    id: 'dep-1',
    orderId: 'order',
    journalId: 'bank',
    receivableAccountId: 'receivable',
    amount: '100',
  })
  // The same receipt again is one deposit and one event.
  await r.save('sale.collectDeposit', {
    id: 'dep-1',
    orderId: 'order',
    journalId: 'bank',
    receivableAccountId: 'receivable',
    amount: '100',
  })
  // Setting the deposit off changes no order row; it is recorded once all the same.
  assert.equal((await r.call('account.postMove', { id: 'inv-1' })).ok, true)
  for (let turn = 0; turn < 2; turn++)
    await r.call('sale.applyDeposit', { orderId: 'order', paymentId: 'dep-1', invoiceId: 'inv-1' })
  await r.save('sale.lockOrder', { id: 'order', locked: true })
  await r.save('sale.lockOrder', { id: 'order', locked: false })
  assert.deepEqual(await r.events(), [
    ['unlock', 'Owner', null],
    ['lock', 'Owner', null],
    ['applyDeposit', 'Owner', 'dep-1'],
    ['deposit', 'Owner', 'dep-1'],
    ['invoice', 'Owner', 'inv-1'],
    ['confirm', 'Owner', null],
    ['tags', 'Owner', null],
    ['updateLine', 'Owner', null],
    ['addLine', 'Owner', null],
    ['create', 'Owner', null],
  ])
  // Another order keeps its own history; a copy names the quotation it came from.
  const source = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.copyOrder', { id: 'copy', sourceId: 'order', expectedRevision: source.revision })
  const copied = (await r.call('sale.listOrderEvents', { id: 'copy' })) as unknown as Row[]
  assert.deepEqual(
    copied.map((row) => [row.action, row.relatedId, (row.details as Row).name]),
    [['copy', 'order', String(source.name)]],
  )
  assert.equal((await r.events()).length, 10)
  // Cancelling a quotation is recorded with the line removed before it.
  const [copiedLine] = (await r.call('sale.getOrder', { id: 'copy' })).lines as Row[]
  await r.save('sale.removeLine', { id: copiedLine!.id })
  await r.save('sale.cancelOrder', { id: 'copy' })
  assert.deepEqual(
    ((await r.call('sale.listOrderEvents', { id: 'copy' })) as unknown as Row[]).map((row) => row.action),
    ['cancel', 'removeLine', 'copy'],
  )
  // Another company reads none of them.
  const elsewhere = await r.app.fixture.call<Row[]>(
    'sale.listOrderEvents',
    { id: 'order' },
    { scope: { company: 'other', branches: null } },
  )
  assert.deepEqual(elsewhere.value, [])
  // The page reads the 30 newest.
  await r.save('sale.saveTag', { id: 'new', name: 'Mới' })
  for (let turn = 0; turn < 25; turn++)
    await r.save('sale.setOrderTags', { id: 'order', tagIds: turn % 2 ? ['vip'] : ['new'] })
  const newest = (await r.call('sale.listOrderEvents', { id: 'order' })) as unknown as Row[]
  assert.equal(newest.length, 30)
  assert.equal(newest.at(-1)!.action, 'invoice')
})

test('D7 the accountant who raises the invoice is the name the seller reads on the order', async (t) => {
  const r = await booked(t)
  await r.add({ productUomQty: '2', priceUnit: '500' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (role: string, name: string) => {
    await r.fixture('user.createUser', {
      id: role,
      login: role,
      password: 'test-password',
      name,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${role}-company`, userId: role, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${role}-role`, userId: role, roleId: `commerce.${role}` })
    const client = r.app.client.anonymous()
    await client.login({ login: role, password: 'test-password' })
    return client
  }
  const accountant = await login('accountant', 'Nguyễn Hải Yến')
  const raised = await accountant.request('/_ket/fn/sale.createInvoice', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'invoice-once' },
    body: JSON.stringify({ id: 'inv-1', ...r.invoice }),
  })
  assert.equal(raised.status, 200)
  // A retry under the same key is answered from the first call and records nothing more.
  const retried = await accountant.request('/_ket/fn/sale.createInvoice', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'invoice-once' },
    body: JSON.stringify({ id: 'inv-1', ...r.invoice }),
  })
  assert.equal(retried.status, 200)
  assert.deepEqual((await r.events()).slice(0, 2), [
    ['invoice', 'Nguyễn Hải Yến', 'inv-1'],
    ['confirm', 'Owner', null],
  ])
  // What the system runs on the order names nobody.
  await r.fixture('sale.lockOrder', { id: 'order', locked: true })
  const seller = await login('sales-representative', 'Trần Bán')
  const read = async (lang: string) =>
    ((await (await seller.get(`/admin/sales/record/order/context?lang=${lang}`)).json()) as { data: Row })
      .data
  const vi = await read('vi')
  assert.equal((vi.permissions as Row).listOrderEvents, true)
  const [locked, latest] = vi.history as Row[]
  assert.deepEqual([locked!.actor, locked!.action, locked!.detail], ['Hệ thống', 'Khoá đơn', '—'])
  assert.deepEqual(
    [latest!.actor, latest!.action, latest!.detail, latest!.detailHref],
    ['Nguyễn Hải Yến', 'Tạo hoá đơn', 'inv-1', null],
  )
  assert.match(String(latest!.when), /\d/)
  assert.deepEqual(
    ((await read('en')).history as Row[]).map((row) => row.action),
    ['Locked order', 'Created invoice', 'Confirmed order', 'Added line', 'Created quotation'],
  )
  // The accountant opens the invoice from the history.
  const books = (
    (await (await accountant.get('/admin/sales/record/order/context?lang=vi')).json()) as {
      data: Row
    }
  ).data
  assert.match(
    String((books.history as Row[])[1]!.detailHref),
    /^\/admin\/accounting\/customer-invoices\/inv-1\?/,
  )
})

test('D7 every Commerce function that writes an order records its history, but for the listed ones', async (t) => {
  const r = await setup(t)
  const manifest = compose(
    [
      ...r.deployment.modules,
      ...(r.deployment.theme ? [r.deployment.theme] : []),
      ...(r.deployment.themes ?? []),
    ],
    { companies: true },
  )
  // These change an order as a consequence of a document elsewhere, not as a command on it.
  const consequences = new Set([
    'account.cancelMove',
    'account.reverseMove',
    'stock.completePicking',
    'stock.validatePicking',
    // K48: handing a parcel over completes its delivery, as completing the delivery would.
    'stock.handOverShipment',
    'stock.handOverShipments',
    'loyalty_sale.refundOrder',
    'loyalty_sale.backfill',
    'sale_template.saveTemplate',
    'sale_template.saveSection',
    'sale_template.setTemplateActive',
  ])
  const writers = Object.entries(manifest.functions)
    .filter(([, fn]) => fn.effects.some((effect) => /^write:sale\.Order(Line|Tag|Deposit)?$/.test(effect)))
    .map(([key, fn]) => [key, fn.effects.includes('write:sale.OrderEvent')] as const)
  assert.ok(writers.length > 30)
  assert.deepEqual(
    writers.filter(([key, logged]) => logged === consequences.has(key)).map(([key]) => key),
    [],
  )
})

test('D7 a command that runs another order command records once, as the outer one', async () => {
  const tables: Record<string, Row[]> = { 'sale.Order': [{ id: 'o', companyId: 'acme', revision: 0 }] }
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value)
  const ctx = {
    scope: { company: 'acme' },
    actor: 'seller',
    dryRun: false,
    db: {
      select: async (model: string, where: Row = {}) =>
        (tables[model] ?? []).filter((row) => matches(row, where)),
      insert: async (model: string, row: Row) => void (tables[model] ??= []).push(row),
      insertIfAbsent: async (model: string, row: Row) => void (tables[model] ??= []).push(row),
    },
  }
  const { withOrderHistory } = await import('../packages/ketsuite/src/modules/sale/order-history.ts')
  const inner = withOrderHistory({
    addLine: {
      input: {},
      effects: [],
      handler: async (_ctx: unknown, args: Row) => {
        tables['sale.OrderLine'] = [{ id: 'l', companyId: 'acme', orderId: args.orderId }]
        return { ok: true }
      },
    },
  })
  const outer = withOrderHistory({
    saveDraft: {
      input: {},
      effects: [],
      handler: async (run: Ctx, args: Row) => inner.addLine!.handler(run, { orderId: args.id }),
    },
  })
  await outer.saveDraft!.handler(ctx as never, { id: 'o' })
  assert.deepEqual(
    tables['sale.OrderEvent']?.map((row) => [row.orderId, row.action, row.actorId]),
    [['o', 'save', 'seller']],
  )
})
