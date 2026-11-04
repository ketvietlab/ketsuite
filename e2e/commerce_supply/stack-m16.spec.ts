import type { Page } from '@playwright/test'
import {
  DESKTOP,
  expect,
  gridLine,
  recordReady,
  saveGridLines,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// M16 (#1432 D14, #1433 D7, #1434 K10, #1435 K15, #1436 K18), on the Commerce deployment. Fixture: quote-manual,
// a quotation to Spa Hoa Mai of 1 SR-13 at its list price of 150.000 ₫, made by the owner (Chủ doanh nghiệp);
// a second warehouse, Kho Hà Nội, and HCM/INT/0903, a confirmed transfer for the storekeeper to cancel.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const record = (page: Page) => page.locator('[data-ui="record-page"]')
const main = (page: Page) => page.locator('main')
const cell = (page: Page, line: string | RegExp, key: string) =>
  gridLine(page, line).locator(`[data-kg-key="${key}"]`)
const history = (page: Page) => record(page).getByRole('table', { name: 'Lịch sử thay đổi' })
/** Types into a cell of the lines grid, replacing it. */
const type = async (page: Page, line: string | RegExp, key: string, value: string) => {
  await cell(page, line, key).click()
  await page.keyboard.type(value)
  await page.keyboard.press('Enter')
}

test('D14 D7 a hand-typed price stays when the quantity changes, and the order’s history names who saved it', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/orders/quote-manual')
  await settled(page)
  await expect(history(page).getByRole('row').filter({ hasText: 'Tạo báo giá' })).toContainText(
    'Chủ doanh nghiệp',
  )
  await expect(cell(page, 'SR-13', 'priceUnit')).toContainText(/150[.,]?000/)
  await type(page, 'SR-13', 'priceUnit', '140000')
  await type(page, 'SR-13', 'productUomQty', '5')
  await saveGridLines(page)
  // D7: the save is on the history at once, by who saved it.
  await expect(history(page).getByRole('row').filter({ hasText: 'Lưu các dòng' })).toContainText(
    'Chủ doanh nghiệp',
  )
  // D14: read back, the negotiated price held through the quantity change.
  await page.reload()
  await settled(page)
  await expect(cell(page, 'SR-13', 'productUomQty')).toContainText('5')
  await expect(cell(page, 'SR-13', 'priceUnit')).toContainText(/140[.,]?000/)
})

test('K10 each warehouse has its own locations in the reader’s language; saving one as shown keeps it so', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/locations')
  await settled(page)
  const adjustment = main(page).getByRole('row').filter({ hasText: 'Điều chỉnh tồn kho' })
  // Each warehouse has its own.
  await expect(adjustment.filter({ hasText: 'Kho Hà Nội' })).toHaveCount(1)
  await expect(adjustment.filter({ hasText: 'Kho Hồ Chí Minh' })).toHaveCount(1)
  await expect(main(page)).not.toContainText('Inventory adjustment')
  await adjustment.filter({ hasText: 'Kho Hồ Chí Minh' }).getByRole('link').first().click()
  const modal = page.getByRole('dialog', { name: 'Điều chỉnh tồn kho' })
  await expect(modal.getByRole('heading', { name: 'Điều chỉnh tồn kho' })).toBeVisible()
  await expect(modal.getByRole('textbox', { name: 'Tên vị trí' })).toHaveValue('Điều chỉnh tồn kho')
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click()
  await settled(page)
  // Saved in Vietnamese as shown, it still reads in English for an English reader.
  await page.goto('/admin/stock/locations?lang=en')
  await settled(page)
  await expect(
    main(page)
      .getByRole('row')
      .filter({ hasText: 'Inventory adjustment' })
      .filter({ hasText: 'Kho Hồ Chí Minh' }),
  ).toBeVisible()
  await expect(main(page)).not.toContainText('Điều chỉnh tồn kho')
})

/** The new quotation's warehouse picker. */
const warehouse = (page: Page) => record(page).getByRole('button', { name: 'Kho hàng' })

test('K15 a new quotation preselects the one warehouse its maker works in', async ({ page }) => {
  // Two warehouses: Bán hàng Hà Nội works only in Kho Hà Nội.
  await signIn(page, 'banhanghn', '/admin/sales/quotations/new')
  await settled(page)
  await expect(warehouse(page)).toContainText('Kho Hà Nội')
})

test('K15 a new quotation leaves the warehouse empty for whoever works in none of several', async ({
  page,
}) => {
  await signIn(page, 'truongban', '/admin/sales/quotations/new')
  await settled(page)
  await expect(warehouse(page)).not.toContainText(/Kho Hà Nội|Kho Hồ Chí Minh/)
})

test('K15 a warehouse names its staff, and someone added there gets it on a new quotation', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/warehouses')
  await settled(page)
  await main(page).getByRole('row').filter({ hasText: 'Kho Hà Nội' }).getByRole('link').first().click()
  let modal = page.getByRole('dialog', { name: 'Kho Hà Nội' })
  await expect(modal).toBeVisible()
  // A multiple picker lists who is chosen as chips under its button.
  const chosen = (name: string) => modal.getByRole('listitem').filter({ hasText: name })
  await expect(chosen('Bán hàng Hà Nội')).toBeVisible()
  await modal.getByRole('button', { name: 'Nhân viên kho' }).click()
  const menu = page.locator('[id$="userIds-relation-menu"]')
  await menu.getByRole('option', { name: /Bán hàng mới/ }).click()
  // The list stays open for another pick; Escape closes it, not the warehouse.
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click()
  await settled(page)
  // Read back: the warehouse reopens from its address, with both.
  await page.reload()
  await settled(page)
  modal = page.getByRole('dialog', { name: 'Kho Hà Nội' })
  await expect(modal).toBeVisible()
  await expect(chosen('Bán hàng mới')).toBeVisible()
  await expect(chosen('Bán hàng Hà Nội')).toBeVisible()

  await page.context().clearCookies()
  await signIn(page, 'banhangmoi', '/admin/sales/quotations/new')
  await settled(page)
  await expect(warehouse(page)).toContainText('Kho Hà Nội')
})

test('K18 a storekeeper cancels a confirmed transfer, with a reason', async ({ page }) => {
  await signIn(page, 'thukho', '/admin/stock/transfers/picking-cancel-keeper')
  await recordReady(page, 'HCM/INT/0903')
  await settled(page)
  await record(page).getByRole('button', { name: 'Hủy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Hủy phiếu kho' })
  await dialog.getByLabel('Lý do hủy').fill('   ')
  await dialog.getByRole('button', { name: 'Hủy phiếu', exact: true }).click()
  await expect(dialog.getByText('Nhập lý do hủy phiếu.')).toBeVisible()
  await dialog.getByLabel('Lý do hủy').fill('Chuyển nhầm kệ')
  await dialog.getByRole('button', { name: 'Hủy phiếu', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(record(page).getByText('Đã hủy', { exact: true }).first()).toBeVisible()
  await expect(record(page).getByText('Chuyển nhầm kệ')).toBeVisible()
})
