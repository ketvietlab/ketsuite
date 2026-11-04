import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boot } from './fixtures/sale/commerce.ts'

// Every accounting document screen loads units of measure alongside accounts, journals and taxes
// (`account_backend` `common` → `uom.listUnits`), so a role that posts documents must be able to
// read them; without `uom.view` the Commerce accountant met "no permission" on all three lists.
test('the Commerce accountant opens customer invoices, payments and journal entries', async (t) => {
  const { app, fixture } = await boot(t)
  await app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await fixture('user.createUser', {
    id: 'accountant',
    login: 'accountant',
    password: 'test-password',
    name: 'Kế toán',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'accountant-acme', userId: 'accountant', companyId: 'acme' })
  assert.equal(
    (
      await fixture('user.assignRole', {
        id: 'accountant-role',
        userId: 'accountant',
        roleId: 'commerce.accountant',
      })
    ).ok,
    true,
  )
  const client = app.client.anonymous()
  await client.login({ login: 'accountant', password: 'test-password' })

  const statuses: Record<string, number> = {}
  for (const path of [
    '/admin/accounting/customer-invoices',
    '/admin/accounting/payments',
    '/admin/accounting/entries',
  ])
    statuses[path] = (await client.request(`${path}?lang=vi`)).status
  assert.deepEqual(statuses, {
    '/admin/accounting/customer-invoices': 200,
    '/admin/accounting/payments': 200,
    '/admin/accounting/entries': 200,
  })
})
