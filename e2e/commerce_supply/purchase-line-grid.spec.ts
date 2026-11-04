import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// M9 (#1363), on the Commerce deployment: a request for quotation's lines are edited in one KetGrid in the
// order's record modal and saved at once; the RFQ page only reads them.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const RFQ = '/admin/purchase/rfqs/rfq-grid'
const grid = (page: Page) => page.getByRole('grid', { name: 'Sản phẩm', exact: true })
const row = (page: Page, text: string) => grid(page).getByRole('row').filter({ hasText: text })
/** Types into a cell of a row, replacing it. */
const type = async (page: Page, text: string, column: number, value: string) => {
  await row(page, text).getByRole('gridcell').nth(column).click()
  await page.keyboard.type(value)
  await page.keyboard.press('Enter')
}

test('an RFQ’s lines are changed and added in its grid, saved at once, and the page reads them', async ({
  page,
}) => {
  await signIn(page, 'admin', RFQ)
  await settled(page)
  const lines = page.locator('main').getByRole('table').filter({ hasText: 'Bông tẩy trang 120 miếng' })
  await expect(lines).toBeVisible()
  // The planned date reads as the record modal writes it, not as a stored ISO date.
  await expect(page.locator('main')).toContainText(/Ngày dự kiến nhận: \d{1,2} thg \d{1,2}, \d{4}/)
  await page.locator('main').getByRole('link', { name: 'Sửa các dòng', exact: true }).click()
  await expect(grid(page)).toBeVisible()
  await settled(page)

  // The saved line takes a new quantity; a new line is a product found as it is typed, with its price.
  await type(page, 'TM-001', 1, '120')
  await page.getByRole('dialog').getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('TM-002')
  await page
    .getByRole('listbox', { name: 'Sản phẩm' })
    .getByRole('option', { name: /TM-002/ })
    .click()
  await type(page, 'TM-002', 1, '50')
  await type(page, 'TM-002', 4, '24000')
  await expect(grid(page).locator('[data-unsaved="true"]')).not.toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu các dòng' }).click()
  await expect(grid(page).locator('[data-unsaved="true"]')).toHaveCount(0)

  // The page reads both lines and the total of 120 × 17.200 ₫ and 50 × 24.000 ₫.
  await page.goto(RFQ)
  await settled(page)
  await expect(lines.getByRole('row').filter({ hasText: 'Bông tẩy trang 120 miếng' })).toContainText('120')
  await expect(lines.getByRole('row').filter({ hasText: 'Bông tẩy trang mini' })).toContainText('50')
  await expect(page.locator('main')).toContainText(/3\.264\.000\s₫/)
})

test('a refused save keeps the grid as typed, says why once and changes nothing', async ({ page, ui }) => {
  ui.allow(/^last screen alert: Chưa lưu được/u, 'a quantity of 0 is refused on purpose')
  await signIn(page, 'admin', RFQ)
  await settled(page)
  const lines = page.locator('main').getByRole('table').filter({ hasText: 'Bông tẩy trang 120 miếng' })
  // The page only reads its lines: no field or button inside them.
  await expect(lines.locator('input, select, button')).toHaveCount(0)
  const pads = lines.getByRole('row').filter({ hasText: 'Bông tẩy trang 120 miếng' }).getByRole('cell')
  const before = await pads.allInnerTexts()
  await page.locator('main').getByRole('link', { name: 'Sửa các dòng', exact: true }).click()
  await expect(grid(page)).toBeVisible()
  await settled(page)

  const dialog = page.getByRole('dialog')
  await type(page, 'TM-001', 1, '0')
  // An unsaved grid is not sent to the vendor.
  await expect(dialog.getByRole('button', { name: 'Đánh dấu đã gửi' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Lưu các dòng' }).click()
  await expect(dialog.locator('[data-ui="notice"]')).toHaveCount(1)
  await expect(dialog.locator('[data-ui="notice"]')).toContainText('Chưa lưu được')
  await expect(row(page, 'TM-001').getByRole('gridcell').nth(1)).toHaveText('0')
  await expect(dialog.getByRole('button', { name: 'Đánh dấu đã gửi' })).toBeDisabled()

  // Nothing was written: the page reads the line as before.
  await page.goto(RFQ)
  await settled(page)
  await expect(pads).toHaveText(before)
})

test('the grid’s guide opens beside it and Escape closes the guide only', async ({ page }) => {
  await signIn(page, 'admin', RFQ)
  await settled(page)
  await page.locator('main').getByRole('link', { name: 'Sửa các dòng', exact: true }).click()
  await expect(grid(page)).toBeVisible()
  await settled(page)
  const dialog = page.getByRole('dialog').filter({ has: grid(page) })
  const guide = dialog.getByRole('button', { name: 'Hướng dẫn', exact: true })
  await guide.click()
  const drawer = page.locator('[data-ui="help-drawer"]:visible')
  await expect(drawer).toContainText('Yêu cầu báo giá và đơn mua')
  await expect(drawer).toContainText('Thêm và sửa dòng')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(grid(page)).toBeVisible()
  await expect(guide).toBeFocused()
})
