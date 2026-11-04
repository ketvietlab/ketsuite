// Vendor bill matching (#1737): a vendor bill drafted from a purchase order is compared with the
// order when it is posted, over real HTTP on the Commerce deployment.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createCommerceTestDeployment as createTestDeployment } from './commerce-test-deployment.ts'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { openStore } from '../apps/ketsuite/config.ts'

const ketsuite = createCommerceDeployment(openStore)
const BILL = '/admin/accounting/vendor-bills/bill-1'
const FORM = { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' }
/** Without the renderer's hydration markers, so markup reads as its text. */
const plain = (html: string) => html.replace(/<!--k\[?-->/g, '')

async function boot(t: TestContext, received = '2') {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Nhà cung cấp ABC' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value
  await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'goods',
    name: 'Bàn làm việc',
    type: 'goods',
    uomId: 'unit',
    listPrice: '2000000',
    purchaseOk: true,
  })
  await call('product.saveVariant', {
    id: 'desk',
    templateId: 'goods',
    defaultCode: 'BAN-01',
    combinationKey: '',
  })
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await call('stock.saveLocation', { id: 'supplier', name: 'Nhà cung cấp', usage: 'supplier' })
  await call('stock.saveLocation', { id: 'stock', name: 'Kho chính', usage: 'internal' })
  await call('stock.savePickingType', {
    id: 'incoming',
    name: 'Nhập hàng',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  for (const [id, code, name, accountType] of [
    ['expense', '6421', 'Chi phí mua hàng', 'expense'],
    ['payable', '331', 'Phải trả nhà cung cấp', 'liability_payable'],
    ['tax', '1331', 'Thuế GTGT được khấu trừ', 'asset_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', {
    id: 'purchase-journal',
    name: 'Mua hàng',
    code: 'PUR',
    type: 'purchase',
  })
  await call('account.saveTax', {
    id: 'vat10',
    name: 'GTGT 10%',
    typeTaxUse: 'purchase',
    amountType: 'percent',
    amount: '10',
  })
  // Two desks ordered at 1.500.000 less 5% (1.425.000 net), `received` of them received, then billed.
  await call('purchase.createOrder', {
    id: 'po-1',
    partnerId: 'vendor',
    pickingTypeId: 'incoming',
    dateOrder: '2026-08-20T00:00:00.000Z',
  })
  await call('purchase.addLine', {
    id: 'po-1:line',
    orderId: 'po-1',
    productId: 'desk',
    productQty: '2',
    productUomId: 'unit',
    priceUnit: '1500000',
    discount: '5',
    taxId: 'vat10',
  })
  await call('purchase.confirmOrder', { id: 'po-1' })
  await call('stock.confirmPicking', { id: 'po-1:receipt' })
  await call('stock.saveMoveLine', {
    id: 'receipt-line',
    moveId: 'po-1:line:receipt',
    quantity: received,
    picked: true,
  })
  await call('stock.completePicking', {
    id: 'po-1:receipt',
    ...(received === '2' ? {} : { createBackorder: false }),
  })
  await call('purchase.syncReceipts', { id: 'po-1' })
  const bill = (id: string) =>
    call('purchase.createVendorBill', {
      id,
      orderId: 'po-1',
      journalId: 'purchase-journal',
      expenseAccountId: 'expense',
      payableAccountId: 'payable',
      taxAccountId: 'tax',
    })
  await bill('bill-1')
  // What an accountant typing the vendor's figures into the draft would write.
  const edit = (id: string, values: { quantity?: string; priceUnit?: string }) =>
    e2e.adapter!.exec(
      `UPDATE account_move_line SET ${Object.entries(values)
        .map(([key, value]) => `"${key}" = '${value}'`)
        .join(', ')} WHERE "moveId" = '${id}' AND "productId" IS NOT NULL`,
    )
  const post = (id: string) => call('account.postMove', { id })
  const match = (id = 'bill-1') => call('purchase.getBillMatch', { id })
  const tolerance = async (value: string) => {
    const config = await call('purchase.getConfiguration')
    return call('purchase.saveConfiguration', { priceTolerance: value, expectedRevision: config.revision })
  }
  return { e2e, call, bill, edit, post, match, tolerance }
}

test('#1737 a bill that matches its order posts, and posting lifts its hold', async (t) => {
  const r = await boot(t)
  const before = (await r.match()) as Row & { lines: Row[] }
  assert.equal(before.status, 'ok')
  assert.equal(before.tolerance, null)
  assert.deepEqual(
    before.lines.map((line) => [line.ordered, line.received, line.allowed, line.billedBefore, line.quantity]),
    [['2', '2', '2', '0', '2']],
  )
  assert.equal(Number(before.lines[0]!.expectedPrice), 1425000)
  assert.equal((await r.call('purchase.holdBill', { id: 'bill-1', reason: '  ' })).ok, false)
  assert.deepEqual(await r.call('purchase.holdBill', { id: 'bill-1', reason: 'NCC xuất thiếu mã số thuế' }), {
    ok: true,
    id: 'bill-1',
  })
  assert.equal(((await r.match()).hold as Row).reason, 'NCC xuất thiếu mã số thuế')
  assert.deepEqual(await r.call('purchase.listBillMatches', { ids: ['bill-1', 'missing'] }), [
    { id: 'bill-1', status: 'ok', held: true },
  ])
  assert.equal((await r.post('bill-1')).ok, true)
  assert.equal((await r.match()).hold, null)
  const refused = await r.call('purchase.holdBill', { id: 'bill-1', reason: 'Quá muộn' })
  assert.equal(((refused.errors as Row[])[0] as Row).code, 'purchase.error.bill.notDraft')
})

test('#1737 a bill above the received quantity is not posted, and says which line', async (t) => {
  const r = await boot(t)
  await r.edit('bill-1', { quantity: '3' })
  const match = (await r.match()) as Row & { lines: Row[] }
  assert.equal(match.status, 'mismatch')
  assert.equal(match.lines[0]!.quantityIssue, true)
  const refused = await r.post('bill-1')
  assert.equal(refused.ok, false)
  assert.deepEqual((refused.errors as Row[])[0], {
    field: 'lines',
    code: 'purchase.error.bill.quantity',
    params: { line: 'Bàn làm việc', order: 'PO00001', billed: '3', allowed: '2' },
  })
  assert.equal((await r.call('account.getMove', { id: 'bill-1' })).state, 'draft')
  // Within what was received it posts.
  await r.edit('bill-1', { quantity: '2' })
  assert.equal((await r.post('bill-1')).ok, true)
})

test('#1737 a bill is matched against what was received, not what was ordered', async (t) => {
  const r = await boot(t, '1')
  const match = (await r.match()) as Row & { lines: Row[] }
  assert.deepEqual(
    [match.lines[0]!.ordered, match.lines[0]!.received, match.lines[0]!.quantity],
    ['2', '1', '1'],
  )
  await r.edit('bill-1', { quantity: '2' })
  const refused = await r.post('bill-1')
  assert.equal(((refused.errors as Row[])[0] as Row).code, 'purchase.error.bill.quantity')
})

test('#1737 what other posted bills billed counts against the line', async (t) => {
  const r = await boot(t)
  await r.edit('bill-1', { quantity: '1' })
  assert.equal((await r.post('bill-1')).ok, true)
  await r.bill('bill-2')
  const second = (await r.match('bill-2')) as Row & { lines: Row[] }
  assert.deepEqual([second.lines[0]!.billedBefore, second.lines[0]!.quantity], ['1', '1'])
  await r.edit('bill-2', { quantity: '2' })
  const refused = await r.post('bill-2')
  assert.equal(
    ((refused.errors as Row[])[0] as Row).params &&
      (((refused.errors as Row[])[0] as Row).params as Row).billed,
    '3',
  )
  await r.edit('bill-2', { quantity: '1' })
  assert.equal((await r.post('bill-2')).ok, true)
})

test('#1737 a price tolerance refuses a bill priced too far from its order, and none compares nothing', async (t) => {
  const r = await boot(t)
  // 1.560.000 less the bill's 5% is 1.482.000: 4% above the order's 1.425.000.
  await r.edit('bill-1', { priceUnit: '1560000' })
  assert.equal((await r.match()).status, 'ok', 'without a tolerance prices are not compared')
  assert.equal((await r.tolerance('2')).ok, true)
  const off = (await r.match()) as Row & { lines: Row[] }
  assert.equal(off.status, 'mismatch')
  assert.equal(off.lines[0]!.priceIssue, true)
  assert.equal(off.lines[0]!.drift, 4)
  const refused = await r.post('bill-1')
  assert.equal(((refused.errors as Row[])[0] as Row).code, 'purchase.error.bill.price')
  // 1.515.000 less 5% is 1.439.250: 1% above, within 2%.
  await r.edit('bill-1', { priceUnit: '1515000' })
  assert.equal((await r.match()).status, 'ok')
  assert.equal((await r.post('bill-1')).ok, true)
})

test('#1737 the price tolerance is a percentage from 0 to 100, and empty clears it', async (t) => {
  const r = await boot(t)
  for (const value of ['101', '-1', 'abc', '2.345']) {
    const refused = await r.tolerance(value)
    assert.deepEqual(refused.errors, [
      { field: 'priceTolerance', code: 'purchase.error.configuration.tolerance' },
    ])
  }
  assert.equal((await r.tolerance('0')).priceTolerance, '0')
  assert.equal((await r.call('purchase.getConfiguration')).priceTolerance, '0')
  // Saving the tolerance alone keeps the approval thresholds.
  const config = await r.call('purchase.getConfiguration')
  await r.call('purchase.saveConfiguration', {
    approvalAmount: '50000000',
    expectedRevision: config.revision,
  })
  assert.equal((await r.tolerance('')).priceTolerance, null)
  assert.equal((await r.call('purchase.getConfiguration')).approvalAmount, '50000000')
})

test('#1737 the bill page shows the matching, holds with a reason and refuses a mismatched post', async (t) => {
  const r = await boot(t)
  const page = async () =>
    plain(await (await r.e2e.client.get(`${BILL}?lang=vi`, { headers: { accept: 'text/html' } })).text())
  const first = await page()
  assert.match(first, /Đối chiếu đơn mua[\s\S]*?data-value="ok"[^>]*>(?:<span[^>]*>)?Khớp đơn mua</)
  assert.match(first, /Chưa đặt dung sai giá nên không so đơn giá/)
  assert.match(first, /id="account-bill-hold-form"[\s\S]*?name="reason"/)
  // The vendor bills guide rides along on the bill and on its list.
  assert.match(first, /id="account-vendor-bill-help"[\s\S]*?Hoá đơn lệch thì/)

  const held = await r.e2e.client.post(
    `${BILL}?lang=vi`,
    new URLSearchParams({ action: 'hold', reason: 'NCC xuất thiếu mã số thuế' }),
    { headers: FORM },
  )
  assert.equal(held.status, 200)
  const after = plain(await held.text())
  assert.match(after, /Hoá đơn đang tạm giữ[\s\S]*?NCC xuất thiếu mã số thuế/)
  assert.match(after, /id="account-bill-release-form"/)
  const list = plain(
    await (
      await r.e2e.client.get('/admin/accounting/vendor-bills?lang=vi', { headers: { accept: 'text/html' } })
    ).text(),
  )
  assert.match(list, /data-col="matching"[\s\S]*?data-value="held"/)
  assert.match(list, /id="account-vendor-bill-help"/)

  await r.edit('bill-1', { quantity: '3' })
  const refused = await r.e2e.client.post(`${BILL}?lang=vi`, new URLSearchParams({ action: 'post' }), {
    headers: FORM,
  })
  const text = plain(await refused.text())
  assert.match(text, /Dòng “Bàn làm việc” \(PO00001\) sẽ được lập hoá đơn 3, vượt số được phép là 2/)
  assert.match(text, /data-value="quantity"[^>]*>(?:<span[^>]*>)?Vượt số lượng</)
  assert.equal((await r.call('account.getMove', { id: 'bill-1' })).state, 'draft')

  const released = await r.e2e.client.post(
    `${BILL}?lang=vi`,
    new URLSearchParams({ action: 'release-hold' }),
    {
      headers: FORM,
    },
  )
  assert.doesNotMatch(plain(await released.text()), /Hoá đơn đang tạm giữ/)
})
