import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { tableNameFor } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const page = async (response: Response) => (await response.text()).replace(/<!--k\[?-->/gu, '')

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await seedAccountingTestFixture(fixture)
  await fixture('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Khách lẻ' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Kế toán',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

const invoice = (id: string, extra: Record<string, unknown>) => ({
  id,
  journalId: 'core-sales',
  moveType: 'out_invoice',
  partnerId: 'buyer',
  invoiceDate: '2026-03-02T00:00:00.000Z',
  accountingDate: '2026-03-02',
  documentDate: '2026-03-02',
  description: id,
  quantity: '1',
  priceUnit: '500000',
  lineAccountId: 'core-revenue',
  counterpartAccountId: 'core-receivable',
  ...extra,
})

test('A1 due date: without a term the document keeps the due date typed, never before it was issued', async (t) => {
  const app = await boot(t)
  const due = async (id: string) =>
    String(
      ((await app.client.call<Row[]>('account.listMoves', {})).value.find((row) => row.id === id) ?? {})
        .invoiceDateDue,
    ).slice(0, 10)

  const typed = await app.client.call<Row>(
    'account.createInvoice',
    invoice('due-typed', { invoiceDateDue: '2026-03-20' }),
  )
  assert.equal(typed.value.ok, true, JSON.stringify(typed.value))
  assert.equal(await due('due-typed'), '2026-03-20')

  const early = await app.client.call<Row>(
    'account.createInvoice',
    invoice('due-early', { invoiceDateDue: '2026-03-01' }),
  )
  assert.equal((early.value.errors as Row[])[0]!.code, 'account.error.dueBeforeInvoice')

  // A term sets the date: thirty days on, whatever was typed.
  const termed = await app.client.call<Row>(
    'account.createInvoice',
    invoice('due-term', { paymentTermId: 'core-net30', invoiceDateDue: '2026-03-05' }),
  )
  assert.equal(termed.value.ok, true, JSON.stringify(termed.value))
  assert.equal(await due('due-term'), '2026-04-01')

  // With neither, the document is due the day it was issued, as before.
  await app.client.call('account.createInvoice', invoice('due-none', {}))
  assert.equal(await due('due-none'), '2026-03-02')

  const form = await page(await app.client.get('/admin/accounting/customer-invoices/new?lang=vi'))
  assert.match(form, /name="invoiceDateDue"/)
  assert.match(form, /Chỉ nhập khi không chọn điều khoản thanh toán/)
})

test('A1 defaults: an account the standard pins reads beside the form and cannot be changed', async (t) => {
  const app = await boot(t)
  await app.client.get('/admin/accounting/defaults?lang=vi')
  const q = app.adapter!.quoteIdent.bind(app.adapter)
  await app.adapter!.run(
    `UPDATE ${q(tableNameFor('account.Defaults'))} SET ${q('pinned')} = '{"receivableAccountId":"core-receivable"}', ${q('receivableAccountId')} = 'core-receivable'`,
  )
  const html = await page(await app.client.get('/admin/accounting/defaults?lang=vi'))
  assert.match(html, /Cố định theo chuẩn kế toán/)
  assert.match(html, /AR · Trade receivables/)
  // Pinned is off the form; the payable default it does not pin is still offered.
  assert.doesNotMatch(html, /name="receivableAccountId"/)
  assert.match(html, /name="payableAccountId"/)

  await app.client.call('account.saveAccount', {
    id: 'ar-other',
    code: 'AR2',
    name: 'Other receivables',
    accountType: 'asset_receivable',
  })
  const refused = await app.client.call<Row>('account.saveDefaults', { receivableAccountId: 'ar-other' })
  assert.equal((refused.value.errors as Row[])[0]!.code, 'account.error.defaultPinned')
  // Saving the form, which no longer posts it, keeps the pinned account.
  assert.equal(
    (await app.client.call<Row>('account.saveDefaults', { payableAccountId: 'core-payable' })).value.ok,
    true,
  )
  const held = (await app.client.call<Row>('account.getDefaults', {})).value
  assert.equal(held.receivableAccountId, 'core-receivable')
})
