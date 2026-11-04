import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compileReportTemplate, renderReportHtml, type Row } from '@ketvietlab/ketjs'
import stock from '../packages/ketsuite/src/modules/stock/index.ts'
import { REPORT_FILTERS } from '../packages/ketsuite/src/modules/report/routes.ts'
import { amountWords } from '../packages/ketsuite/src/ui/amount-words.ts'
import { setup } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

/**
 * Two lots received (LOT-A 5 at 1 000, LOT-B 4 at 1 300), a delivery of 7 for `buyer` that holds
 * LOT-A 5 and LOT-B 2 by expiry, and a reader who prints.
 */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('partner.saveAddress', {
    id: 'buyer-delivery',
    partnerId: 'buyer',
    use: 'delivery',
    street: '12 Lê Lợi',
    city: 'Hà Nội',
    country: 'VN',
    isDefault: true,
  })
  const picking = async (id: string, type: 'incoming' | 'outgoing', quantity: string) => {
    await r.save('stock.createPicking', { id, name: id.toUpperCase(), pickingTypeId: `wh:${type}` })
    await r.app.adapter!.run(sql(`UPDATE stock_picking SET "partnerId" = ? WHERE id = ?`), ['buyer', id])
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
      origin: `SO-${id}`,
    })
    await r.save('stock.confirmPicking', { id })
  }
  const complete = (id: string) => r.call('stock.completePicking', { id, createBackorder: false })
  for (const [id, lot, expiry, quantity, cost] of [
    ['in-a', 'LOT-A', '2031-03-01', '5', '1000'],
    ['in-b', 'LOT-B', '2031-06-01', '4', '1300'],
  ] as const) {
    await picking(id, 'incoming', quantity)
    const prepared = await r.call('stock.prepareReceiptLot', {
      id: `${id}-line`,
      moveId: `${id}-move`,
      quantity,
      name: lot,
      expirationDate: expiry,
    })
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    assert.equal((await r.call('stock.setReceiptUnitCost', { id: `${id}-line`, unitCost: cost })).ok, true)
    if (id === 'in-a') assert.equal((await complete(id)).ok, true)
  }
  await picking('out', 'outgoing', '7')
  return { ...r, picking, complete }
}

const report = async (r: Awaited<ReturnType<typeof seed>>, fn: string, id: string) =>
  (await r.call(`stock.${fn}`, { id })) as Row | null
const rows = (data: Row) =>
  (data.lines as Row[]).flatMap((line) =>
    (line.rows as Row[]).map((row) => [row.lot, row.expiry, row.demand, row.held, row.quantity]),
  )

test('K65 an open receipt prints the lots and expiry entered, with nothing done and no values', async (t) => {
  const r = await seed(t)
  const data = (await report(r, 'getReceiptReport', 'in-b'))!
  assert.equal((data.voucher as Row).title, 'stock.report.receipt')
  assert.equal((data.voucher as Row).form, 'stock.report.receiptForm')
  assert.deepEqual(rows(data), [['LOT-B', '2031-06-01', '4', '', '']])
  assert.deepEqual((data.partner as Row).name, 'Buyer')
  assert.match(String((data.partner as Row).address), /12 Lê Lợi/)
  assert.equal(data.origin, 'SO-in-b')
  assert.equal(data.showHeld, false)
  assert.equal(data.valued, false)
  // A copy with values waits for the receipt to be done, and a receipt is no delivery.
  assert.equal(await report(r, 'getValuedReceiptReport', 'in-b'), null)
  assert.equal(await report(r, 'getDeliveryReport', 'in-b'), null)
  assert.equal(await report(r, 'getReceiptReport', 'missing'), null)
})

test('K65 a delivery prints a row a lot: held before it is done, delivered and valued after', async (t) => {
  const r = await seed(t)
  assert.equal((await r.complete('in-b')).ok, true)
  assert.equal((await r.call('stock.assignPicking', { id: 'out' })).ok, true)
  const open = (await report(r, 'getDeliveryReport', 'out'))!
  // What was asked reads once; the lots held for it follow by expiry, the done column blank.
  assert.deepEqual(rows(open), [
    ['LOT-A', '2031-03-01', '7', '5', ''],
    ['LOT-B', '2031-06-01', '', '2', ''],
  ])
  assert.equal(open.showHeld, true)
  assert.equal((open.lines as Row[])[0]!.uom, 'Each')
  assert.equal((open.lines as Row[])[0]!.code, 'GOODS')
  assert.equal((open.voucher as Row).partner, 'stock.report.receiver')
  assert.equal((await r.complete('out')).ok, true)
  const done = (await report(r, 'getDeliveryReport', 'out'))!
  assert.deepEqual(rows(done), [
    ['LOT-A', '2031-03-01', '7', '', '5'],
    ['LOT-B', '2031-06-01', '', '', '2'],
  ])
  assert.equal(done.showHeld, false)
  assert.equal(done.total, '')
  assert.ok((done.lines as Row[]).every((line) => (line.rows as Row[]).every((row) => row.amount === '')))
  // The valued copy prices each lot at what the books took for it, and the lots add up to the total.
  const valued = (await report(r, 'getValuedDeliveryReport', 'out'))!
  const priced = (valued.lines as Row[]).flatMap((line) => line.rows as Row[])
  const booked = (await r.call('stock.getPickingValuation', { id: 'out' })) as Row
  assert.equal(valued.total, booked.total)
  assert.equal(
    priced.reduce((sum, row) => sum + Number(row.amount), 0),
    Number(booked.total),
  )
  // The amount is what was booked; the unit cost beside it is that amount a unit, rounded to the đồng.
  for (const row of priced)
    assert.equal(
      Number(row.unitCost),
      Math.round(Number(row.amount) / Number(row.quantity)),
      JSON.stringify(row),
    )
  assert.equal(valued.valued, true)
})

test('K65 the template prints the voucher, its lots and, valued, the total in words', async (t) => {
  const r = await seed(t)
  assert.equal((await r.complete('in-b')).ok, true)
  assert.equal((await r.call('stock.assignPicking', { id: 'out' })).ok, true)
  assert.equal((await r.complete('out')).ok, true)
  const html = (lang: 'vi' | 'en', name: string, data: Row) => {
    const messages = (stock.messages as Record<string, Record<string, string>>)[lang]!
    return renderReportHtml(
      compileReportTemplate(stock.reports![name]!.template, {
        name,
        translate: (key: string) => messages[key.replace(/^stock\./, '')] ?? key,
        filters: REPORT_FILTERS(lang),
      }).render(data),
    )
  }
  const plain = html('vi', 'delivery', (await report(r, 'getDeliveryReport', 'out'))!)
  for (const text of [
    'PHIẾU XUẤT KHO',
    'Mẫu số 02-VT',
    'Họ và tên người nhận hàng: Buyer',
    '12 Lê Lợi',
    'SO-out',
  ])
    assert.ok(plain.includes(text), text)
  for (const text of [
    'LOT-A',
    '2031-03-01',
    'LOT-B',
    'Thực xuất',
    'Thủ kho',
    'Kế toán trưởng',
    '(Ký, họ tên)',
  ])
    assert.ok(plain.includes(text), text)
  assert.ok(!plain.includes('Thành tiền'))
  assert.ok(!plain.includes('stock.report.'), 'every label is translated')
  const data = (await report(r, 'getValuedDeliveryReport', 'out'))!
  const valued = html('vi', 'deliveryValued', data)
  assert.ok(valued.includes('Thành tiền'))
  assert.ok(valued.includes(amountWords(data.total, 'vi')), amountWords(data.total, 'vi'))
  const english = html('en', 'deliveryValued', data)
  assert.ok(english.includes('DELIVERY NOTE') && english.includes('Template 02-VT'))
  assert.ok(english.includes(amountWords(data.total, 'en')))
  // An internal transfer has no form number and no partner line.
  await r.save('stock.createPicking', { id: 'move', name: 'MOVE', pickingTypeId: 'wh:internal' })
  const internal = html('vi', 'internalTransfer', (await report(r, 'getInternalTransferReport', 'move'))!)
  assert.ok(internal.includes('PHIẾU CHUYỂN KHO'))
  assert.ok(!internal.includes('Mẫu số') && !internal.includes('Họ và tên'))
})

test('K65 amounts read in words as a voucher writes them', () => {
  for (const [value, words] of [
    ['0', 'Không đồng'],
    ['15', 'Mười lăm đồng'],
    ['21', 'Hai mươi mốt đồng'],
    ['104', 'Một trăm linh bốn đồng'],
    ['1005', 'Một nghìn không trăm linh năm đồng'],
    ['24000', 'Hai mươi tư nghìn đồng'],
    ['1250000', 'Một triệu hai trăm năm mươi nghìn đồng'],
    ['3000000000', 'Ba tỷ đồng'],
    ['9100.5', 'Chín nghìn một trăm đồng năm mươi xu'],
  ])
    assert.equal(amountWords(value, 'vi'), words)
  assert.equal(amountWords('1250000', 'en'), 'One million two hundred fifty thousand dong')
  assert.equal(amountWords('12.5', 'en', 'USD'), 'Twelve US dollars and fifty cents')
  assert.equal(amountWords('123456789012345678901', 'vi').startsWith('Một trăm hai mươi ba tỷ tỷ'), true)
})

test('K65 the transfer offers its printed copies, the valued one only once done to who reads value', async (t) => {
  const r = await seed(t)
  await r.fixture('user.saveRole', { id: 'printer', name: 'Printer' })
  await r.fixture('user.createUser', {
    id: 'printer',
    login: 'printer',
    password: 'test-password',
    name: 'Printer',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'printer-company', userId: 'printer', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'printer-role', userId: 'printer', roleId: 'printer' })
  const grant = async (fnKey: string) =>
    assert.notEqual(
      (await r.fixture('user.grantFunction', { id: fnKey, roleId: 'printer', fnKey })).ok,
      false,
    )
  const printer = r.app.client.anonymous()
  await printer.login({ login: 'printer', password: 'test-password' })
  const offered = async (id: string) => {
    const response = await printer.get(`/admin/stock/transfer/${id}/context?lang=vi&company=acme`)
    assert.equal(response.status, 200)
    return ((await response.json()) as { data: { reports: Row[] } }).data.reports
  }
  for (const fn of ['getPicking', 'listPickingTypes', 'getDeliveryReport', 'getReceiptReport'])
    await grant(`stock.${fn}`)
  assert.deepEqual(await offered('out'), [
    { label: 'In phiếu', href: '/admin/stock/transfers/out/print?lang=vi&company=acme' },
  ])
  // Before it is done a delivery prints what is held for it, and no value.
  assert.equal((await r.complete('in-b')).ok, true)
  assert.equal((await r.call('stock.assignPicking', { id: 'out' })).ok, true)
  const held = await printer.get('/admin/stock/transfers/out/print?lang=vi&company=acme')
  assert.equal(held.status, 200)
  const heldPage = await held.text()
  assert.equal(
    (await printer.post('/admin/stock/transfers/out/print?lang=vi&company=acme', new URLSearchParams()))
      .status,
    405,
  )
  for (const expected of [
    'PHIẾU XUẤT KHO',
    'Mẫu số 02-VT',
    'Ngày 31 tháng 01 năm 2030',
    '01/03/2031',
    'Đã giữ',
    'LOT-A',
    'LOT-B',
    '12 Lê Lợi',
    'Thủ kho',
    '(Ký, họ tên)',
  ])
    assert.ok(heldPage.includes(expected), expected)
  assert.ok(!heldPage.includes('Đơn giá'))
  // #1813: the warehouse's own places read in the reader's language, not their English seed names.
  assert.match(heldPage, />Tồn kho</)
  assert.match(heldPage, />Khách hàng</)
  assert.doesNotMatch(heldPage, />(?:Stock|Customer)</)
  await grant('stock.getValuedReceiptReport')
  await grant('stock.getValuedDeliveryReport')
  // Nothing is booked before the delivery is done, so its valued copy waits.
  assert.equal((await offered('out')).length, 1)
  assert.equal(
    (await printer.get('/admin/stock/transfers/out/print?lang=vi&company=acme&values=1')).status,
    404,
  )
  assert.deepEqual(await offered('in-a'), [
    { label: 'In phiếu', href: '/admin/stock/transfers/in-a/print?lang=vi&company=acme' },
    { label: 'In kèm giá trị', href: '/admin/stock/transfers/in-a/print?lang=vi&company=acme&values=1' },
  ])
  const valued = await printer.get('/admin/stock/transfers/in-a/print?lang=vi&company=acme&values=1')
  assert.equal(valued.status, 200)
  assert.match(valued.headers.get('content-type') ?? '', /text\/html/)
  const valuedPage = await valued.text()
  // The copy with values is still form 01-VT, its title the form's; only the menu tells the copies apart.
  for (const expected of [
    'PHIẾU NHẬP KHO',
    'Mẫu số 01-VT',
    'Đơn giá',
    'LOT-A',
    'Năm nghìn đồng',
    'Kế toán trưởng',
  ])
    assert.ok(valuedPage.includes(expected), expected)
  assert.match(valuedPage, /5\.000\s₫/u)
  assert.ok(
    valuedPage.includes('href="/admin/stock/transfers/in-a?lang=vi&amp;company=acme"'),
    'back to the transfer',
  )
  const english = await (
    await printer.get('/admin/stock/transfers/in-a/print?lang=en&company=acme&values=1')
  ).text()
  for (const expected of [
    'GOODS RECEIPT NOTE',
    'Template 01-VT',
    'Date 31/01/2030',
    'Unit cost',
    'Five thousand dong',
    'Storekeeper',
  ])
    assert.ok(english.includes(expected), expected)
  // Without the valuation grant the valued copy is neither offered nor printed; the plain one still is.
  const reader = await r.fixture('user.revokeFunction', {
    roleId: 'printer',
    fnKey: 'stock.getValuedReceiptReport',
  })
  assert.notEqual(reader.ok, false, JSON.stringify(reader))
  assert.equal((await offered('in-a')).length, 1)
  assert.equal(
    (await printer.get('/admin/stock/transfers/in-a/print?lang=vi&company=acme&values=1')).status,
    404,
  )
  const plain = await (await printer.get('/admin/stock/transfers/in-a/print?lang=vi&company=acme')).text()
  assert.ok(plain.includes('PHIẾU NHẬP KHO') && !plain.includes('Đơn giá'))
})

test('K65 the storekeeper prints the plain copy; the copy with values is for who reads stock value', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const reader = async (roleId: string) => {
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
    return async (search: string) =>
      (await client.get(`/admin/stock/transfers/in-a/print?lang=vi&company=acme${search}`)).status
  }
  const expected = {
    'commerce.warehouse-operator': [200, 404],
    'commerce.warehouse-manager': [200, 200],
    'commerce.sales-representative': [404, 404],
  }
  for (const [roleId, [plain, valued]] of Object.entries(expected)) {
    const print = await reader(roleId)
    assert.equal(await print(''), plain, `${roleId} plain`)
    assert.equal(await print('&values=1'), valued, `${roleId} values`)
  }
})

test('K65 a delivery with no partner, as a sales channel package makes, prints no receiver and no address', async (t) => {
  const r = await seed(t)
  // A channel order keeps its own delivery address; the picking it makes names no partner, so the copy must
  // not fall back to some partner's default address.
  await r.save('stock.createPicking', { id: 'pkg', name: 'Delivery PCK-1', pickingTypeId: 'wh:outgoing' })
  await r.save('stock.addMove', {
    id: 'pkg-move',
    pickingId: 'pkg',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '1',
    origin: 'PCK-1',
  })
  const data = (await report(r, 'getDeliveryReport', 'pkg'))!
  assert.deepEqual(data.partner, { name: '', address: '' })
  assert.equal(data.origin, 'PCK-1')
})
