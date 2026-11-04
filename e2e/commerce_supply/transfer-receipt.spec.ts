import type { Page } from '@playwright/test'
import { DESKTOP, expect, recordReady, settled, signIn, test } from '../product_backend/support.js'

// C24 (K24, K30), on the Commerce deployment: a receipt opens on its page; its picked grid takes the lot
// and expiry of goods tracked by lot, and the unit cost from the owner or a stock manager only.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const RECEIPT = '/admin/stock/transfers/receipt-serum'
const transfer = (page: Page) => page.locator('[data-ui="record-page"]')
const picked = (page: Page) => transfer(page).getByRole('grid', { name: 'Đã lấy hàng', exact: true })
const header = (page: Page, name: string) => picked(page).getByRole('columnheader', { name, exact: true })
const line = (page: Page) => picked(page).getByRole('row').filter({ hasText: 'Serum theo lô' })
/** Types into a cell of the line, replacing it. */
const type = async (page: Page, column: number, value: string) => {
  await line(page).getByRole('gridcell').nth(column).click()
  await page.keyboard.type(value)
  await page.keyboard.press('Enter')
}

test('a receipt takes the lot and expiry in its picked grid, the unit cost only from those allowed', async ({
  page,
}) => {
  await signIn(page, 'thukho', RECEIPT)
  await recordReady(page, 'HCM/IN/0024')
  await settled(page)
  await expect(header(page, 'Số lô')).toBeVisible()
  await expect(header(page, 'Hạn dùng')).toBeVisible()
  // A warehouse operator neither sees nor sends the unit cost (K24).
  await expect(header(page, 'Đơn giá nhập')).toHaveCount(0)

  await page.context().clearCookies()
  await signIn(page, 'admin', RECEIPT)
  await recordReady(page, 'HCM/IN/0024')
  await settled(page)
  await expect(header(page, 'Đơn giá nhập')).toBeVisible()
  // A receipt holds nothing to pick yet: its line is added in the grid, then product, quantity, lot
  // number, expiry and unit cost are typed in turn.
  await transfer(page).getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('Serum')
  await page
    .getByRole('listbox', { name: 'Sản phẩm' })
    .getByRole('option', { name: /Serum theo lô/ })
    .click()
  await type(page, 1, '4')
  await type(page, 2, 'SR-2610')
  await line(page).getByRole('gridcell').nth(3).click()
  await page.keyboard.press('Enter')
  await picked(page).locator('[data-ui="kg-editor"]').fill('2027-10-31')
  await page.keyboard.press('Enter')
  // A receipt line is picked as it is added.
  await expect(line(page).getByRole('checkbox', { name: 'Đã lấy hàng' })).toBeChecked()
  await type(page, 5, '90000')
  await transfer(page).getByRole('button', { name: 'Lưu dòng' }).click()
  await expect(picked(page).locator('[data-unsaved="true"]')).toHaveCount(0)
  await expect(line(page)).toHaveAccessibleName(/^Serum theo lô 4 SR-2610 /)

  await transfer(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Hoàn tất' })
    .getByRole('button', { name: 'Hoàn tất', exact: true })
    .click()
  await expect(transfer(page).locator('[data-ui="record-page-status"]')).toContainText('Hoàn tất')
  // M11 (#1370): the done receipt prints as 01-VT, with values for who reads stock value.
  const prints = transfer(page).getByRole('group', { name: 'Bản in' })
  await expect(prints.getByRole('link', { name: 'In kèm giá trị' })).toBeVisible()
  await prints.getByRole('link', { name: 'In phiếu', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/receipt-serum\/print\?/)
  await expect(page.locator('main')).toContainText('SR-2610')
  await page.getByRole('link', { name: 'Quay lại phiếu kho' }).click()
  await recordReady(page, 'HCM/IN/0024')
  // The lot now exists and holds the four packs received.
  await page.goto('/admin/stock/lots?lang=vi')
  await settled(page)
  await expect(page.getByRole('row').filter({ hasText: 'SR-2610' })).toHaveAccessibleName(
    /^SR-2610 Serum theo lô · TM-024 — 4 /,
  )
})
