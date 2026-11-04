import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountingGuideFor } from '../packages/ketsuite/src/modules/account_backend/screens/help-content.ts'
import { boot } from './fixtures/sale/commerce.ts'

// Every screen account_backend serves under /admin/accounting, without a record id.
const screens = [
  '/admin/accounting',
  '/admin/accounting/customer-invoices',
  '/admin/accounting/customer-invoices/new',
  '/admin/accounting/vendor-bills',
  '/admin/accounting/vendor-bills/new',
  '/admin/accounting/entries',
  '/admin/accounting/payments',
  '/admin/accounting/payments/new',
  '/admin/accounting/trial-balance',
  '/admin/accounting/general-ledger',
  '/admin/accounting/partner-statement',
  '/admin/accounting/books',
  '/admin/accounting/opening-balances',
  '/admin/accounting/opening-balances/new',
  '/admin/accounting/nettings',
  '/admin/accounting/period-closes',
  '/admin/accounting/accounts',
  '/admin/accounting/accounts/new',
  '/admin/accounting/journals',
  '/admin/accounting/journals/new',
  '/admin/accounting/taxes',
  '/admin/accounting/taxes/new',
  '/admin/accounting/terms',
  '/admin/accounting/defaults',
  '/admin/accounting/audit-log',
]

test('every accounting screen has a Vietnamese and an English guide', () => {
  for (const path of screens) {
    const guide = accountingGuideFor(path)
    assert.ok(guide, `${path} has no guide`)
    for (const lang of ['vi', 'en'] as const) {
      assert.match(guide[lang].title, /\S/u, `${path} ${lang} title`)
      assert.match(guide[lang].source, /^## /mu, `${path} ${lang} source has no section`)
    }
    assert.notEqual(guide.vi.source, guide.en.source, `${path} guide is not translated`)
  }
  // Screens other modules serve under the same prefix bring their own guide, or none.
  assert.equal(accountingGuideFor('/admin/accounting/aging'), null)
  assert.equal(accountingGuideFor('/admin/sales'), null)
})

const reports = new Set([
  '/admin/accounting/trial-balance',
  '/admin/accounting/general-ledger',
  '/admin/accounting/partner-statement',
  '/admin/accounting/books',
])

test('accounting screens draw their guide in the content slot', async (t) => {
  const { app } = await boot(t)
  for (const lang of ['vi', 'en'] as const)
    for (const path of screens) {
      const response = await app.client.request(`${path}?lang=${lang}`)
      assert.equal(response.status, 200, `${path} ${lang}`)
      const html = await response.text()
      assert.equal(html.match(/id="account-screen-help"/gu)?.length, 1, `${path} ${lang} help drawer`)
      assert.ok(html.includes(accountingGuideFor(path)![lang].title), `${path} ${lang} guide title`)
      // Report headers carry no static lead text (design-system page header rule).
      if (reports.has(path))
        assert.doesNotMatch(html, /data-ui="record-subtitle"/u, `${path} ${lang} subtitle`)
    }
})
