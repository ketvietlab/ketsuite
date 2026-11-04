import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boot } from './fixtures/sale/commerce.ts'

test('invoice tax pickers offer only the rates in effect on the invoice date', async (t) => {
  const { app, save } = await boot(t)
  await save('account.saveAccount', {
    id: 'vat-out',
    code: '33311',
    name: 'Thuế GTGT đầu ra',
    accountType: 'liability_current',
  })
  const tax = (id: string, name: string, dates: Record<string, string>) =>
    save('account.saveTax', {
      id,
      name,
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount: '8',
      accountId: 'vat-out',
      ...dates,
    })
  await tax('vat-ended', 'GTGT 8% đã hết hạn', { validTo: '2020-12-31' })
  await tax('vat-later', 'GTGT 8% chưa hiệu lực', { validFrom: '2999-01-01' })
  await tax('vat-now', 'GTGT 8% đang áp dụng', {})

  const page = await (await app.client.request('/admin/accounting/customer-invoices/new?lang=vi')).text()
  assert.match(page, /GTGT 8% đang áp dụng/u)
  assert.doesNotMatch(page, /GTGT 8% đã hết hạn/u)
  assert.doesNotMatch(page, /GTGT 8% chưa hiệu lực/u)
  // Both tax pickers reload their rates from the invoice date the reader picks.
  assert.equal(
    page.match(
      /listInputFields(?:&quot;|")\s*:\s*\{(?:&quot;|")on(?:&quot;|")\s*:\s*(?:&quot;|")invoiceDate/gu,
    )?.length,
    2,
  )
  // The invoice date starts filled, so the pickers are ready before the reader touches it.
  assert.match(page, /name="invoiceDate"[^>]*value="\d{4}-\d{2}-\d{2}"/u)
})
