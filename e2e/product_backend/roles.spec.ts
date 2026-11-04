import { DESKTOP, expect, listReady, recordReady, settled, signIn, test } from './support.js'

// The product screens through the Commerce job roles a tenant assigns. Each role signs in
// from the start and reads the list, a product, the variants and a variant without the
// page or any of its islands meeting a refusal: a role that holds the screen but not a
// lookup on it (units, for one) still gets the screen. The other specs build roles for
// what they test; this one uses the roles people are given.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const ROLES = [
  ['bookkeeper', 'commerce.accountant'],
  ['stockkeeper', 'commerce.warehouse-manager'],
  ['role-company-administrator', 'commerce.company-administrator'],
  ['role-tenant-auditor', 'commerce.tenant-auditor'],
  ['role-sales-manager', 'commerce.sales-manager'],
  ['role-sales-representative', 'commerce.sales-representative'],
  ['role-purchasing-manager', 'commerce.purchasing-manager'],
  ['role-purchasing-operator', 'commerce.purchasing-operator'],
  ['role-warehouse-operator', 'commerce.warehouse-operator'],
] as const

const SERUM = 'Serum B5 phục hồi 30ml'

for (const [login, role] of ROLES)
  test(`${role} opens the product screens from the start`, async ({ page, ui }) => {
    await signIn(page, login, '/admin')
    await expect(page).not.toHaveURL(/\/login/)
    for (const [path, ready] of [
      ['/admin/product/templates', () => listReady(page)],
      ['/admin/product/templates/serum', () => recordReady(page, SERUM)],
      [
        '/admin/product/variants',
        () => expect(page.getByRole('heading', { level: 1, name: 'Biến thể' })).toBeVisible(),
      ],
      ['/admin/product/templates/cream/variants/cream:default', () => recordReady(page, '30ml')],
    ] as const) {
      await page.goto(path)
      await ready()
      await settled(page)
      await ui.check(`${role} ${path}`)
    }
  })
