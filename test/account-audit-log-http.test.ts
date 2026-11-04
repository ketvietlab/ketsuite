import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { AUDIT_CHANGE_LIMIT, changedFields } from '../packages/ketsuite/src/modules/account/audit.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const path = '/admin/accounting/audit-log'
// The page without the renderer's hydration markers, so a pattern can span an element.
const page = async (response: Response) => (await response.text()).replace(/<!--k\[?-->/gu, '')
const has = (html: string, pattern: RegExp) => assert.ok(pattern.test(html), String(pattern))

test('the audit log lists postings and reversals newest first, by name, and opens one read only', async (t) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await seedAccountingTestFixture(fixture)
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Kế toán Trưởng',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const empty = await page(await app.client.get(`${path}?lang=vi`))
  has(empty, /Chưa có sự kiện nào/)

  await app.client.call('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Khách lẻ' })
  const created = await app.client.call<Row>('account.createInvoice', {
    id: 'audit-invoice',
    journalId: 'core-sales',
    moveType: 'out_invoice',
    partnerId: 'buyer',
    invoiceDate: '2026-03-02T00:00:00.000Z',
    accountingDate: '2026-03-02',
    documentDate: '2026-03-02',
    description: 'audit-invoice',
    quantity: '1',
    priceUnit: '500000',
    lineAccountId: 'core-revenue',
    counterpartAccountId: 'core-receivable',
  })
  assert.equal(created.value.ok, true, JSON.stringify(created.value))
  assert.equal((await app.client.call<Row>('account.postMove', { id: 'audit-invoice' })).value.ok, true)
  const reversed = await app.client.call<Row>('account.reverseMove', {
    id: 'audit-invoice',
    reversalId: 'audit-reversal',
    accountingDate: '2026-03-05',
    reason: 'Sai đơn giá',
  })
  assert.equal(reversed.value.ok, true, JSON.stringify(reversed.value))
  const moves = (await app.client.call<Row[]>('account.listMoves', {})).value
  const name = String(moves.find((row) => row.id === 'audit-invoice')?.name)

  const listed = await app.client.get(`${path}?lang=vi`)
  assert.equal(listed.status, 200)
  const html = await page(listed)
  has(html, /<h1[^>]*>[^<]*Nhật ký kiểm toán/)
  // Who did it, by name in the table; the account menu also names the viewer, so look in the column.
  has(html, /data-col="actorName"[^>]*>Kế toán Trưởng</)
  has(html, /Sai đơn giá/)
  // The reversal is the newer event, so it comes first; both name the invoice, not its id.
  const reversal = html.indexOf('data-ui="badge" data-tone="warning" data-value="reversed"')
  const posting = html.indexOf('data-ui="badge" data-tone="positive" data-value="posted"')
  assert.ok(reversal > 0 && posting > reversal, `${reversal} ${posting}`)
  assert.ok(html.includes(`Chứng từ · ${name}`), name)
  // The reversal entry is posted in its own right, so it is a posting too.
  has(html, /Tổng: 3 · Ghi sổ: 2 · Đảo: 1/)

  const reversalEvent = `move:audit-invoice:reversed:audit-reversal`
  const opened = await app.client.get(`${path}?lang=vi&event=${encodeURIComponent(reversalEvent)}`)
  assert.equal(opened.status, 200)
  const modal = await page(opened)
  has(modal, /data-ui="modal-sheet"/)
  has(modal, /id="account-audit-event-title"[^>]*>Đảo bút toán · /)
  // The subject and the related reversal open their documents, each named once.
  has(modal, /href="\/admin\/accounting\/customer-invoices\/audit-invoice\?lang=vi"/)
  has(modal, /Chứng từ liên quan/)
  has(modal, /href="\/admin\/accounting\/entries\/audit-reversal\?lang=vi"/)
  assert.doesNotMatch(modal, /Bút toán gốc|Bút toán đảo/)
  has(modal, /Sự kiện này không ghi thêm chi tiết/)
  // Closing keeps the list's own query and drops only the event.
  has(modal, /data-ui="modal-close" href="\/admin\/accounting\/audit-log\?lang=vi"/)

  assert.equal((await app.client.get(`${path}?lang=vi&event=nope`)).status, 404)

  const english = await page(await app.client.get(`${path}?lang=en`))
  has(english, /Audit log/)
  has(english, /data-value="reversed">Reversed</)
})

test('an edit to the configuration is logged as the fields it changed, before and after', async (t) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await seedAccountingTestFixture(fixture)
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Kế toán Trưởng',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const events = async () =>
    (await app.client.call<Row[]>('account.listAuditEvents', {})).value.filter(
      (row) => row.action === 'updated',
    )

  // Creating a record and saving it again unchanged are not edits.
  const account = { id: 'audit-acc', code: 'AUD', name: 'Tạm ứng', accountType: 'asset_current' }
  assert.equal((await app.client.call<Row>('account.saveAccount', account)).value.ok, true)
  assert.equal((await app.client.call<Row>('account.saveAccount', account)).value.ok, true)
  assert.deepEqual(await events(), [])

  await app.client.call('account.saveAccount', { ...account, name: 'Tạm ứng nhân viên', active: false })
  await app.client.call('account.saveJournal', {
    id: 'core-sales',
    name: 'Bán hàng',
    code: 'SAL',
    type: 'sale',
  })
  await app.client.call('account.savePaymentTerm', { id: 'core-net30', name: 'Net 30', note: 'Ba mươi ngày' })
  // The form posts every default; only the income account changes.
  const held = (await app.client.call<Row>('account.getDefaults', {})).value
  await app.client.call('account.saveDefaults', {
    ...Object.fromEntries(Object.entries(held).filter(([key]) => key.endsWith('AccountId'))),
    incomeAccountId: 'core-other-revenue',
  })
  const tax = (await app.client.call<Row[]>('account.listTaxes', {})).value.find(
    (row) => row.id === 'core-sale-tax',
  )!
  await app.client.call('account.saveTax', {
    ...Object.fromEntries(
      Object.entries(tax).filter(
        ([key, value]) => value !== null && !['companyId', 'revision'].includes(key),
      ),
    ),
    description: 'Thuế GTGT đầu ra',
  })
  const edits = await events()
  const of = (type: string) => edits.find((row) => row.subjectType === type)
  assert.deepEqual(of('account')?.details, {
    before: { active: true, name: 'Tạm ứng' },
    after: { active: false, name: 'Tạm ứng nhân viên' },
  })
  assert.equal(of('account')?.subjectId, 'audit-acc')
  assert.equal(of('account')?.actorId, 'admin')
  assert.deepEqual(of('journal')?.details, { before: { name: 'Sales' }, after: { name: 'Bán hàng' } })
  assert.deepEqual(of('paymentTerm')?.details, { before: { note: null }, after: { note: 'Ba mươi ngày' } })
  const detailsOf = (type: string) => {
    const found = of(type)
    assert.ok(found, type)
    return found.details as { before: Row; after: Row }
  }
  assert.deepEqual(Object.keys(detailsOf('defaults').after), ['incomeAccountId'])
  assert.equal(detailsOf('defaults').after.incomeAccountId, 'core-other-revenue')
  assert.deepEqual(detailsOf('tax').after, { description: 'Thuế GTGT đầu ra' })
  assert.equal(edits.length, 5)

  const opened = await page(
    await app.client.get(`${path}?lang=vi&event=${encodeURIComponent(String(of('account')?.id))}`),
  )
  // A read-only event is a dialog over the log, not a side panel.
  const sheet = opened.indexOf('aria-labelledby="account-audit-event-title"')
  const layer = opened.slice(opened.lastIndexOf('data-ui="modal-layer"', sheet), sheet)
  has(layer, /^data-ui="modal-layer"[^>]*data-presentation="dialog"/)
  has(opened, /id="account-audit-event-title"[^>]*>Sửa · AUD · Tạm ứng nhân viên/)
  has(opened, /href="\/admin\/accounting\/accounts\?lang=vi&amp;edit=audit-acc"/)
  has(opened, /Trường thay đổi/)
  // Each changed field once, by its label, with what it was and what it became.
  has(opened, />Tên<\/[^>]+>[\s\S]*?>Tạm ứng<[\s\S]*?>Tạm ứng nhân viên</)
  has(opened, />Đang sử dụng<\/[^>]+>[\s\S]*?>Có<[\s\S]*?>Không</)
  assert.doesNotMatch(opened, /Sự kiện này không ghi thêm chi tiết/)

  // An account a default points at reads by its code and name.
  const defaults = await page(
    await app.client.get(`${path}?lang=en&event=${encodeURIComponent(String(of('defaults')?.id))}`),
  )
  has(defaults, /Edited · Default accounts/)
  has(defaults, /href="\/admin\/accounting\/defaults\?lang=en"/)
  has(defaults, />REV\.OTHER · Other revenue</)
})

test('a change keeps the plain fields that differ, at most thirty, and none of the row bookkeeping', () => {
  // Saving what was already there is no change.
  assert.equal(changedFields({ name: 'A', active: true }, { name: 'A', active: true }), null)
  assert.deepEqual(
    changedFields(
      { id: 'x', revision: 1, updatedAt: 'a', name: 'A', tags: ['a'], note: null },
      { id: 'x', revision: 2, updatedAt: 'b', name: 'B', tags: ['b'], note: '' },
    ),
    { before: { name: 'A' }, after: { name: 'B' } },
  )
  const wide = (value: number) =>
    Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`f${String(index).padStart(2, '0')}`, value]),
    )
  const many = changedFields(wide(1), wide(2))!
  assert.equal(Object.keys(many.after).length, AUDIT_CHANGE_LIMIT)
  assert.equal(AUDIT_CHANGE_LIMIT, 30)
})
