import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

const code = (result: Row) => {
  const error = (result.errors as Row[] | undefined)?.[0]
  return String(error?.messageKey ?? error?.code ?? '')
}
const blank = () => ({ added: [], updated: [], removed: [], order: null })
const DAY = 86400000

test('D20 the sales settings keep what is left out and refuse what makes no sense', async (t) => {
  const r = await setup(t)
  const config = async () => (await r.call('sale.getConfiguration', {})) as Row
  assert.deepEqual(
    (({
      quotationValidityDays,
      onlineSignature,
      onlinePayment,
      prepaymentPercent,
      lockConfirmed,
      goodsInvoicePolicy,
    }) => ({
      quotationValidityDays,
      onlineSignature,
      onlinePayment,
      prepaymentPercent,
      lockConfirmed,
      goodsInvoicePolicy,
    }))(await config()),
    {
      quotationValidityDays: null,
      onlineSignature: false,
      onlinePayment: false,
      prepaymentPercent: null,
      lockConfirmed: false,
      goodsInvoicePolicy: 'order',
    },
  )
  const save = (values: Row, expectedRevision = 0) =>
    r.call('sale.saveConfiguration', { ...values, expectedRevision })
  for (const days of [0, 366])
    assert.equal(
      code(await save({ quotationValidityDays: days })),
      'sale.error.configuration.validity',
      String(days),
    )
  assert.equal(code(await save({ onlinePayment: true })), 'sale.error.configuration.prepayment')
  for (const share of ['0', '100.01', '12.345', 'x'])
    assert.equal(
      code(await save({ onlinePayment: true, prepaymentPercent: share })),
      'sale.error.configuration.prepayment',
      share,
    )
  assert.equal(code(await save({ goodsInvoicePolicy: 'later' })), 'sale.error.configuration.invoicePolicy')

  await r.save('sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 })
  const saved = await save(
    { quotationValidityDays: 30, onlinePayment: true, prepaymentPercent: '30.50', onlineSignature: true },
    1,
  )
  assert.equal(saved.ok, true, JSON.stringify(saved))
  // A card saves only its own settings: the others keep theirs.
  await r.save('sale.saveConfiguration', {
    lockConfirmed: true,
    goodsInvoicePolicy: 'delivery',
    expectedRevision: 2,
  })
  const after = await config()
  assert.deepEqual(
    [
      after.requireProduct,
      after.quotationValidityDays,
      after.onlineSignature,
      after.onlinePayment,
      after.prepaymentPercent,
      after.lockConfirmed,
      after.goodsInvoicePolicy,
      after.revision,
    ],
    [true, 30, true, true, '30.5', true, 'delivery', 3],
  )
  assert.equal(code(await save({ lockConfirmed: false }, 2)), 'sale.error.configurationChanged')
  // Saving what is already saved changes nothing.
  assert.equal(Number((await save({ lockConfirmed: true }, 3)).revision), 3)
  // The prepayment can be cleared once payment is off.
  await r.save('sale.saveConfiguration', {
    onlinePayment: false,
    prepaymentPercent: null,
    expectedRevision: 3,
  })
  assert.deepEqual([(await config()).onlinePayment, (await config()).prepaymentPercent], [false, null])
})

test('D20 a new quotation starts valid for the default days and asks what the company asks', async (t) => {
  const r = await setup(t)
  await r.save('sale.saveConfiguration', {
    quotationValidityDays: 15,
    onlineSignature: true,
    onlinePayment: true,
    prepaymentPercent: '20',
    expectedRevision: 0,
  })
  await r.save('sale.createOrder', {
    id: 'q1',
    partnerId: 'buyer',
    warehouseId: 'wh',
    dateOrder: '2026-10-01T03:00:00.000Z',
  })
  const q1 = (await r.call('sale.getOrder', { id: 'q1' })) as Row
  assert.equal(Date.parse(String(q1.validityDate)) - Date.parse(String(q1.dateOrder)), 15 * DAY)
  // A validity named, or none, wins.
  await r.save('sale.createOrder', { id: 'q2', partnerId: 'buyer', warehouseId: 'wh', validityDate: null })
  assert.equal(((await r.call('sale.getOrder', { id: 'q2' })) as Row).validityDate, null)

  // Created on the quotation page without a template, it asks for a signature and a 20% prepayment.
  const created = await r.call('sale_template.createQuotation', {
    id: 'q3',
    partnerId: 'buyer',
    warehouseId: 'wh',
  })
  assert.equal(created.ok, true, JSON.stringify(created))
  const q3 = (await r.call('sale.getOrder', { id: 'q3' })) as Row
  assert.deepEqual(
    [q3.templateSignature, q3.templatePayment, Number(q3.templatePrepaymentPercent)],
    [true, true, 20],
  )
  // Settings changed later leave the quotations already made alone.
  const revision = Number(((await r.call('sale.getConfiguration', {})) as Row).revision)
  // Payment off: the prepayment it kept is not asked for.
  await r.save('sale.saveConfiguration', {
    quotationValidityDays: null,
    onlineSignature: false,
    onlinePayment: false,
    expectedRevision: revision,
  })
  assert.equal(((await r.call('sale.getConfiguration', {})) as Row).prepaymentPercent, '20')
  await r.save('sale_template.createQuotation', { id: 'q4', partnerId: 'buyer', warehouseId: 'wh' })
  const q4 = (await r.call('sale.getOrder', { id: 'q4' })) as Row
  assert.deepEqual(
    [q4.validityDate, q4.templateSignature, q4.templatePayment, q4.templatePrepaymentPercent],
    [null, false, false, null],
  )
  assert.equal(((await r.call('sale.getOrder', { id: 'q3' })) as Row).templateSignature, true)
})

test('D20 confirming locks the order when asked and fixes how each line is invoiced', async (t) => {
  const r = await setup(t)
  await r.save('product.saveRecord', {
    id: 'other-goods',
    name: 'Other goods',
    type: 'goods',
    defaultCode: 'OTHER',
    uomId: 'each',
    listPrice: '50',
    saleOk: true,
  })
  await r.save('product.saveRecord', {
    id: 'advice',
    name: 'Advice',
    type: 'service',
    defaultCode: 'ADVICE',
    uomId: 'each',
    listPrice: '70',
    saleOk: true,
  })
  const variant = async (templateId: string) =>
    String(((await r.call('product.listVariants', { templateId })) as unknown as Row[])[0]!.id)
  const [other, advice] = [await variant('other-goods'), await variant('advice')]
  // One product is invoiced by what was ordered whatever the company default says.
  await r.save('sale.setInvoicePolicy', { templateId: 'other-goods', invoicePolicy: 'order' })
  await r.save('sale.saveConfiguration', {
    lockConfirmed: true,
    goodsInvoicePolicy: 'delivery',
    expectedRevision: 0,
  })

  await r.add({ productUomId: 'each', productUomQty: '2' })
  await r.add({ id: 'other-line', productId: other, productUomId: 'each', productUomQty: '1' })
  await r.add({ id: 'advice-line', productId: advice, productUomId: 'each', productUomQty: '1' })
  const draft = (await r.call('sale.getOrder', { id: 'order' })) as Row
  assert.equal(draft.locked, false)
  await r.save('sale.confirmOrder', { id: 'order' })
  const order = async () => (await r.call('sale.getOrder', { id: 'order' })) as Row
  const policies = async () =>
    Object.fromEntries(
      ((await order()).lines as Row[]).map((line) => [line.id, [line.invoicePolicy, line.qtyToInvoice]]),
    )
  assert.equal((await order()).locked, true)
  assert.deepEqual(await policies(), {
    line: ['delivery', '0'],
    'other-line': ['order', '1'],
    'advice-line': ['order', '1'],
  })

  // The default changes; the order keeps how its lines were sold, and a line added now takes the new one.
  await r.save('sale.saveConfiguration', {
    lockConfirmed: true,
    goodsInvoicePolicy: 'order',
    expectedRevision: 1,
  })
  await r.save('sale.setInvoicePolicy', { templateId: 'other-goods', invoicePolicy: 'delivery' })
  await r.save('sale.lockOrder', { id: 'order', locked: false })
  assert.equal(((await order()).lines as Row[]).find((line) => line.id === 'line')!.invoicePolicy, 'delivery')
  await r.save('sale.saveConfiguration', { goodsInvoicePolicy: 'delivery', expectedRevision: 2 })
  const added = await r.call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: (await order()).revision,
    changes: {
      ...blank(),
      added: [{ id: 'later', index: 3, values: { productId: r.productId, productUomQty: 1 } }],
    },
  })
  assert.equal(added.ok, true, JSON.stringify(added))
  const lines = (await order()).lines as Row[]
  const later = lines.find((line) => !['line', 'other-line', 'advice-line'].includes(String(line.id)))!
  assert.deepEqual(
    [
      lines.find((line) => line.id === 'line')!.invoicePolicy,
      lines.find((line) => line.id === 'other-line')!.invoicePolicy,
      later.invoicePolicy,
    ],
    ['delivery', 'order', 'delivery'],
  )
  // The order's invoice status reads the lines' own policies: two lines wait on ordered quantities.
  assert.equal((await order()).invoiceStatus, 'to invoice')
})

test('D20 a line sold by delivered quantities is not invoiced before it is delivered', async (t) => {
  const r = await setup(t)
  await r.save('sale.saveConfiguration', { goodsInvoicePolicy: 'delivery', expectedRevision: 0 })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  await r.save('sale.confirmOrder', { id: 'order' })
  // The product names no policy of its own, so only the line knows it waits for delivery.
  const order = (await r.call('sale.getOrder', { id: 'order' })) as Row
  assert.deepEqual([order.invoiceStatus, (order.lines as Row[])[0]!.invoicePolicy], ['no', 'delivery'])
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  const invoice = await r.call('sale.createInvoice', {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  assert.equal(invoice.ok, false, JSON.stringify(invoice))
})

test('D20 sales managers keep the sales settings; sellers and accountants read them', async (t) => {
  const r = await setup(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const expected = {
    'commerce.sales-manager': [200, 200],
    'commerce.company-administrator': [200, 200],
    'commerce.sales-representative': [403, 200],
    'commerce.accountant': [403, 200],
    'commerce.warehouse-operator': [403, 403],
  } as const
  let revision = 0
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
    const saved = await client.request('/_ket/fn/sale.saveConfiguration', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `${id}-save` },
      body: JSON.stringify({ quotationValidityDays: 10 + revision, expectedRevision: revision }),
    })
    assert.equal(saved.status, save, roleId)
    if (saved.status === 200) revision++
    assert.equal((await client.request('/admin/sales/configuration?lang=vi')).status, read, roleId)
  }
  const context = (await (await r.app.client.get('/admin/sales/configuration/context?lang=vi')).json()) as Row
  assert.equal(((context.data as Row).record as Row).quotationValidityDays, 11)
  assert.equal((context.messages as Row)['sale_backend.configuration.lock'], 'Khoá đơn khi xác nhận')
})
