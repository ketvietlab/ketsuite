import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/** A confirmed order of 1,000 (two at 500), a bank journal and two receivable accounts. */
async function booked(t: TestContext) {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '500' })
  await r.save('sale.confirmOrder', { id: 'order' })
  for (const [id, accountType, reconcile] of [
    ['revenue', 'income', false],
    ['receivable', 'asset_receivable', true],
    ['receivable-2', 'asset_receivable', true],
    ['bank', 'asset_cash', false],
  ] as const)
    await r.save('account.saveAccount', { id, code: id.replace('-', '.'), name: id, accountType, reconcile })
  await r.save('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('account.saveJournal', {
    id: 'bank',
    name: 'Ngân hàng',
    code: 'BNK',
    type: 'bank',
    defaultAccountId: 'bank',
  })
  const collect = (input: Row) =>
    r.call('sale.collectDeposit', {
      orderId: 'order',
      journalId: 'bank',
      receivableAccountId: 'receivable',
      ...input,
    })
  const deposits = async () => ((await r.call('sale.getOrder', { id: 'order' })).deposits as Row[]) ?? []
  const invoice = async (id: string, post = true) => {
    await r.save('sale.createInvoice', {
      id,
      orderId: 'order',
      journalId: 'sales',
      revenueAccountId: 'revenue',
      receivableAccountId: 'receivable',
    })
    if (post) assert.equal((await r.call('account.postMove', { id })).ok, true)
  }
  const owed = async (id: string) =>
    String(
      (
        await r.app.adapter!.all(
          `SELECT "amountResidual" FROM account_move_line WHERE id = '${id}:counterpart'`,
        )
      )[0]!.amountResidual,
    )
  return { ...r, collect, deposits, invoice, owed }
}

const refusal = (result: Row) => (result.errors as Row[] | undefined)?.[0]?.message

test('D9 a deposit is a customer receipt linked to the order, never an invoice', async (t) => {
  const r = await booked(t)
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  assert.equal(
    refusal(
      await r.call('sale.collectDeposit', {
        id: 'q',
        orderId: 'quote',
        journalId: 'bank',
        receivableAccountId: 'receivable',
        amount: '10',
      }),
    ),
    'sale.error.deposit.state',
  )
  assert.equal(refusal(await r.collect({ id: 'x' })), 'sale.error.deposit.amountOrPercent')
  assert.equal(
    refusal(await r.collect({ id: 'x', amount: '10', percent: '10' })),
    'sale.error.deposit.amountOrPercent',
  )
  assert.equal(refusal(await r.collect({ id: 'x', percent: '0' })), 'sale.error.deposit.percent')
  assert.equal(refusal(await r.collect({ id: 'x', percent: '120' })), 'sale.error.deposit.percent')
  assert.equal(refusal(await r.collect({ id: 'x', amount: '-5' })), 'sale.error.deposit.amount')

  // 30% of 1,000, collected twice under one id: one receipt.
  assert.deepEqual(await r.collect({ id: 'dep-1', percent: '30' }), { ok: true, id: 'dep-1', amount: '300' })
  assert.deepEqual(await r.collect({ id: 'dep-1', percent: '30' }), { ok: true, id: 'dep-1', amount: '300' })
  // Deposits never add up to more than the order.
  assert.equal(refusal(await r.collect({ id: 'dep-2', amount: '800' })), 'sale.error.deposit.exceeds')
  assert.equal((await r.collect({ id: 'dep-2', amount: '700' })).ok, true)
  assert.deepEqual(
    (await r.deposits()).map((row) => [
      row.id,
      String(row.name).replace(/\/\d{4}\//, '/YYYY/'),
      row.amount,
      row.unapplied,
      row.journalName,
    ]),
    [
      ['dep-1', 'BNK/YYYY/00001', '300', '300', 'Ngân hàng'],
      ['dep-2', 'BNK/YYYY/00002', '700', '700', 'Ngân hàng'],
    ],
  )
  // In Accounting: an inbound customer payment on the receivable, referenced by the order, and no
  // invoice of any kind.
  const payment = (await r.app.adapter!.all(`SELECT * FROM account_payment WHERE id = 'dep-1'`))[0]!
  assert.deepEqual(
    [
      payment.paymentType,
      payment.partnerType,
      payment.partnerId,
      payment.destinationAccountId,
      payment.paymentReference,
    ],
    [
      'inbound',
      'customer',
      'buyer',
      'receivable',
      String((await r.call('sale.getOrder', { id: 'order' })).name),
    ],
  )
  assert.equal(
    (
      await r.app.adapter!.all(
        `SELECT id FROM account_move WHERE "moveType" IN ('out_invoice', 'out_refund')`,
      )
    ).length,
    0,
  )
  // A receipt id belongs to one order.
  await r.save('sale.createOrder', { id: 'other', partnerId: 'buyer', warehouseId: 'wh' })
  await r.add({
    id: 'other-line',
    orderId: 'other',
    productUomId: 'each',
    productUomQty: '1',
    priceUnit: '500',
  })
  await r.save('sale.confirmOrder', { id: 'other' })
  assert.equal(
    refusal(
      await r.call('sale.collectDeposit', {
        id: 'dep-1',
        orderId: 'other',
        journalId: 'bank',
        receivableAccountId: 'receivable',
        amount: '300',
      }),
    ),
    'sale.error.deposit.reused',
  )
  // A reversed receipt holds nothing: what it took can be collected again.
  assert.equal(refusal(await r.collect({ id: 'dep-3', amount: '100' })), 'sale.error.deposit.exceeds')
  assert.equal(
    (await r.call('account.reverseMove', { id: 'dep-2:move', reversalId: 'dep-2:reversal' })).ok,
    true,
  )
  assert.equal((await r.collect({ id: 'dep-3', amount: '700' })).ok, true)
  assert.deepEqual(
    (await r.deposits()).map((row) => [row.id, row.state, row.unapplied]),
    [
      ['dep-1', 'paid', '300'],
      ['dep-2', 'reversed', '0'],
      ['dep-3', 'paid', '700'],
    ],
  )
})

test('D9 a deposit is set off against a posted invoice of the order, as far as both go', async (t) => {
  const r = await booked(t)
  await r.collect({ id: 'dep-1', percent: '30' })
  await r.collect({ id: 'dep-2', amount: '200', receivableAccountId: 'receivable-2' })
  await r.invoice('inv', false)
  const apply = (paymentId: string, invoiceId = 'inv') =>
    r.call('sale.applyDeposit', { orderId: 'order', paymentId, invoiceId })
  assert.equal(refusal(await apply('dep-1')), 'sale.error.deposit.invoicePosted')
  assert.equal((await r.call('account.postMove', { id: 'inv' })).ok, true)
  assert.equal(await r.owed('inv'), '1000')
  assert.deepEqual(await apply('dep-1'), { ok: true, id: 'dep-1:apply:inv', amount: '300' })
  assert.equal(await r.owed('inv'), '700')
  // Applying again changes nothing.
  assert.equal((await apply('dep-1')).ok, true)
  assert.equal(await r.owed('inv'), '700')
  assert.deepEqual(
    (await r.deposits()).map((row) => [row.id, row.unapplied]),
    [
      ['dep-1', '0'],
      ['dep-2', '200'],
    ],
  )
  // A deposit on another receivable account cannot settle this invoice.
  assert.equal(refusal(await apply('dep-2')), 'sale.error.deposit.account')
  // Only this order's invoices, only its deposits.
  await r.save('sale.createOrder', { id: 'other', partnerId: 'buyer', warehouseId: 'wh' })
  await r.add({
    id: 'other-line',
    orderId: 'other',
    productUomId: 'each',
    productUomQty: '1',
    priceUnit: '500',
  })
  await r.save('sale.confirmOrder', { id: 'other' })
  await r.save('sale.createInvoice', {
    id: 'inv-other',
    orderId: 'other',
    journalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  assert.equal((await r.call('account.postMove', { id: 'inv-other' })).ok, true)
  assert.equal(refusal(await apply('dep-1', 'inv-other')), 'sale.error.deposit.invoice')
  assert.equal(
    refusal(
      await r.call('sale.applyDeposit', { orderId: 'other', paymentId: 'dep-1', invoiceId: 'inv-other' }),
    ),
    'sale.error.deposit.missing',
  )
})

test('D9 a deposit larger than what is left owed stops at the invoice', async (t) => {
  const r = await booked(t)
  await r.collect({ id: 'dep-1', percent: '100' })
  await r.invoice('inv')
  // The customer also paid 400 of the invoice directly.
  const paid = await r.call('account.registerPayment', {
    id: 'cash',
    name: 'cash',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'buyer',
    journalId: 'bank',
    destinationAccountId: 'receivable',
    reconcileLineId: 'inv:counterpart',
    amount: '400',
  })
  assert.equal(paid.ok, true, JSON.stringify(paid))
  assert.equal(await r.owed('inv'), '600')
  assert.equal(
    (await r.call('sale.applyDeposit', { orderId: 'order', paymentId: 'dep-1', invoiceId: 'inv' })).amount,
    '600',
  )
  assert.equal(await r.owed('inv'), '0')
  assert.deepEqual(
    (await r.deposits()).map((row) => [row.id, row.unapplied]),
    [['dep-1', '400']],
  )
  assert.equal(
    refusal(await r.call('sale.applyDeposit', { orderId: 'order', paymentId: 'dep-1', invoiceId: 'inv-2' })),
    'sale.error.deposit.invoice',
  )
})

test('D9 collecting and applying deposits is the accountant’s; sellers read them on the order', async (t) => {
  const r = await booked(t)
  await r.collect({ id: 'dep-1', amount: '100' })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (role: string) => {
    await r.fixture('user.createUser', {
      id: role,
      login: role,
      password: 'test-password',
      name: role,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${role}-company`, userId: role, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${role}-role`, userId: role, roleId: `commerce.${role}` })
    const client = r.app.client.anonymous()
    await client.login({ login: role, password: 'test-password' })
    return client
  }
  const post = (client: Awaited<ReturnType<typeof login>>, fn: string, args: Row) =>
    client.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
  const deposit = {
    id: 'dep-2',
    orderId: 'order',
    journalId: 'bank',
    receivableAccountId: 'receivable',
    amount: '100',
  }
  const seller = await login('sales-representative')
  assert.equal((await post(seller, 'sale.collectDeposit', deposit)).status, 403)
  const context = (await (await seller.get('/admin/sales/record/order/context?lang=vi')).json()) as {
    data: Row
  }
  assert.deepEqual(
    ((context.data.record as Row).deposits as Row[]).map((row) => [
      row.id,
      String(row.amountLabel).replace(/\s/g, ' '),
    ]),
    [['dep-1', '100 ₫']],
  )
  assert.equal((context.data.permissions as Row).collectDeposit, false)
  const accountant = await login('accountant')
  assert.equal((await post(accountant, 'sale.collectDeposit', deposit)).status, 200)
})
