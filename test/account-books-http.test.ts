import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { parseListState, tableNameFor } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import {
  customerInvoiceListSearch,
  journalEntryListSearch,
} from '../packages/ketsuite/src/modules/account_backend/search.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const bootBooks = async (t: TestContext) => {
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
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  // The first accounting screen installs the company's setup row.
  await app.client.get('/admin/accounting/books?lang=vi')

  const entry = async (
    id: string,
    date: string,
    debit: string,
    credit: string,
    amount: string,
    name: string,
  ) => {
    await app.client.call('account.createMove', {
      id,
      journalId: 'core-general',
      moveType: 'entry',
      accountingDate: date,
      ref: id,
    })
    await app.client.call('account.addMoveLine', {
      id: `${id}:debit`,
      moveId: id,
      name,
      accountId: debit,
      debit: amount,
    })
    await app.client.call('account.addMoveLine', {
      id: `${id}:credit`,
      moveId: id,
      name,
      accountId: credit,
      credit: amount,
    })
    await app.client.call('account.postMove', { id })
  }
  await entry('book-opening', '2026-05-31', 'core-bank', 'core-revenue', '1000000', 'Opening deposit')
  // Somebody typed a formula into the description; the spreadsheet must not run it.
  await entry('book-inflow', '2026-06-10', 'core-bank', 'core-revenue', '250000', '=HYPERLINK("x")')
  await entry('book-outflow', '2026-06-20', 'core-expense', 'core-bank', '1400000', 'Rent')
  return app
}

test('accounting books HTTP: a bank book opens on its account, carries its balance and exports in form order', async (t) => {
  const app = await bootBooks(t)
  const q = app.adapter!.quoteIdent.bind(app.adapter)
  // A standard that numbers its books; the Vietnamese one fills these at install.
  await app.adapter!.run(
    `UPDATE ${q(tableNameFor('account.Setup'))} SET ${q('bookForms')} = '{"bank":"S08-DN","general_ledger":"S03b-DN","partner":"S31-DN"}'`,
  )
  const base = '/admin/accounting/books?lang=vi&book=bank&dateFrom=2026-06-01&dateTo=2026-06-30'
  const html = await (await app.client.get(base)).text()
  assert.match(html, /Mẫu số S08-DN/)
  // The account picker offers the accounts the book is kept for and nothing else.
  const picker = html.slice(
    html.indexOf('name="accountId"'),
    html.indexOf('</select>', html.indexOf('name="accountId"')),
  )
  assert.match(picker, /value="core-bank"[^>]*selected/)
  assert.doesNotMatch(picker, /core-revenue|core-cash/)
  assert.match(html, /data-col="running"/)
  assert.match(html, /data-col="contra"/)
  // Opening 1,000,000; +250,000 then -1,400,000 leaves the bank overdrawn by 150,000.
  assert.match(html, /1[.,]250[.,]000/)
  assert.match(html, /-150[.,]000|−150[.,]000|\(150[.,]000\)/)

  // A cash account carried over from another book is not the bank book's to print.
  const switched = await (await app.client.get(`${base}&accountId=core-cash`)).text()
  assert.match(switched, /value="core-bank"[^>]*selected/)
  assert.doesNotMatch(switched, /không mở cho tài khoản/)

  const csvResponse = await app.client.get(`${base}&format=csv`)
  assert.equal(csvResponse.status, 200)
  assert.match(String(csvResponse.headers.get('content-type')), /text\/csv/)
  assert.match(
    String(csvResponse.headers.get('content-disposition')),
    /S08-DN_BANK_2026-06-01_2026-06-30\.csv/,
  )
  const csv = await csvResponse.text()
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n')
  assert.deepEqual(lines[0]!.split(','), [
    'Ngày hạch toán',
    'Số chứng từ',
    'Ngày chứng từ',
    'Diễn giải',
    'TK đối ứng',
    'Nợ',
    'Có',
    'Số dư lũy kế',
  ])
  assert.deepEqual(lines[1]!.split(','), ['', '', '', 'Đầu kỳ', '', '', '', '1000000'])
  assert.equal(lines.length, 6)
  // The typed formula arrives as text; the ledger's own negative balance stays a number.
  assert.match(lines[2]!, /^2026-06-10,[^,]*,[^,]*,"'=HYPERLINK\(""x""\)",REV,250000,0,1250000$/)
  assert.match(lines[3]!, /^2026-06-20,[^,]*,[^,]*,Rent,EXP,0,1400000,-150000$/)
  assert.deepEqual(lines[4]!.split(','), ['', '', '', 'Cộng số phát sinh', '', '250000', '1400000', ''])
  assert.deepEqual(lines[5]!.split(','), ['', '', '', 'Cuối kỳ', '', '', '', '-150000'])

  // The ledger and the partner statement name their forms too.
  assert.match(
    await (await app.client.get('/admin/accounting/general-ledger?lang=vi')).text(),
    /Mẫu số S03b-DN/,
  )
  assert.match(
    await (await app.client.get('/admin/accounting/partner-statement?lang=vi')).text(),
    /Mẫu số S31-DN/,
  )
})

test('accounting books HTTP: the general journal lists every account and carries no balance', async (t) => {
  const app = await bootBooks(t)
  const html = await (
    await app.client.get(
      '/admin/accounting/books?lang=en&book=general_journal&dateFrom=2026-06-01&dateTo=2026-06-30',
    )
  ).text()
  // Markup, not words: the screen's Help mentions running balances and form numbers.
  assert.doesNotMatch(html, /data-col="running"|data-col="contra"|name="accountId"|data-ui="record-subtitle"/)
  assert.match(html, /data-col="account"/)
  const csv = (
    await (
      await app.client.get(
        '/admin/accounting/books?lang=en&book=general_journal&dateFrom=2026-06-01&dateTo=2026-06-30&format=csv',
      )
    ).text()
  )
    .replace(/^\uFEFF/, '')
    .split('\r\n')
  assert.deepEqual(csv[0]!.split(','), [
    'Accounting date',
    'Document number',
    'Document date',
    'Description',
    'Account',
    'Debit',
    'Credit',
  ])
  // Four lines and the totals; no opening or closing balance to print.
  assert.equal(csv.length, 6)
  assert.deepEqual(csv[5]!.split(','), ['', '', '', 'Period totals', '', '1650000', '1650000'])
})

test("accounting close HTTP: each list holding drafts gets its own line, opening it on the period's drafts", async (t) => {
  const app = await bootBooks(t)
  // Two entries and an invoice left in draft inside June; one entry in July does not count.
  for (const [id, journalId, moveType, date] of [
    ['draft-entry-1', 'core-general', 'entry', '2026-06-05'],
    ['draft-entry-2', 'core-general', 'entry', '2026-06-25'],
    ['draft-invoice', 'core-sales', 'out_invoice', '2026-06-15'],
    ['draft-july', 'core-general', 'entry', '2026-07-02'],
  ])
    await app.client.call('account.createMove', {
      id,
      journalId,
      moveType,
      accountingDate: date,
      ...(moveType === 'out_invoice' ? { partnerId: 'acme-party' } : {}),
    })
  await app.client.call('account.createClosePeriod', {
    id: 'close-june',
    periodKey: '2026-06',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
  })
  await app.client.call('account.refreshClosePeriod', { id: 'close-june' })
  const html = (await (await app.client.get('/admin/accounting/period-closes/close-june?lang=en')).text())
    .replace(/<!--[^>]*-->/g, '')
    .replace(/&amp;/g, '&')
  assert.match(html, />2 journal entries still in draft</)
  assert.match(html, />1 customer invoices still in draft</)
  // No vendor bill is in draft, so that list gets no line.
  assert.doesNotMatch(html, /vendor bills still in draft/)

  const hrefOf = (path: string) => {
    const found = html.match(new RegExp(`href="(${path}\\?[^"]*)"`))
    assert.ok(found, `a link to ${path}`)
    return new URL(found[1]!, 'http://ket.local')
  }
  for (const [path, spec] of [
    ['/admin/accounting/entries', journalEntryListSearch],
    ['/admin/accounting/customer-invoices', customerInvoiceListSearch],
  ] as const) {
    const href = hrefOf(path)
    assert.equal(href.searchParams.get('lang'), 'en')
    const { state } = parseListState(spec, href)
    assert.deepEqual(state.presets, ['draft'])
    assert.deepEqual(
      state.filters.map((filter) => ({ ...filter })),
      [{ kind: 'rule', field: 'accountingDate', operator: 'between', value: ['2026-06-01', '2026-06-30'] }],
    )
  }
  // The balance check opens the trial balance of the same dates.
  assert.match(
    html,
    /href="\/admin\/accounting\/trial-balance\?dateFrom=2026-06-01&dateTo=2026-06-30&lang=en"[^>]*>[^<]*Open the trial balance for this period/,
  )
})
