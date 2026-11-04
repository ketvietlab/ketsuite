import type { Page } from '@playwright/test'
import {
  DESKTOP,
  expect,
  productRow,
  recordReady,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// C16 (P8, P14, P16, P35, P51), on the Commerce deployment: one Theo dõi field for inventory
// tracking, locked while stock is on hand; the saved invoicing policy and costs by read
// permission; the packaging grid saved with the product; a transfer opened by link.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const CREAM = '/admin/product/templates/cream'
const GEL = '/admin/product/templates/gel'
const tracking = (page: Page) => page.locator('select[name="inventoryTracking"]')
const packaging = (page: Page) => page.getByRole('grid', { name: 'Đơn vị quy đổi & đóng gói' })
const packagingCard = (page: Page) => page.locator('[id^="product-packaging-grid"]')
// The record, without the screen help that names the same fields.
const record = (page: Page) => page.locator('#product-record')

const open = async (page: Page, login: 'admin' | 'thukho', path: string, name: string) => {
  await signIn(page, login, path)
  await recordReady(page, name)
  await settled(page)
}

test('tracking by lot is one choice of the Theo dõi field, and is kept after saving', async ({
  page,
  ui,
}) => {
  ui.allow(/alert: Hết hàng/, 'the product has no stock yet')
  await open(page, 'admin', GEL, 'Gel rửa mặt chưa có tồn')
  await expect(tracking(page)).toBeEnabled()
  const choices = await tracking(page).locator('option').allTextContents()
  expect(choices).toEqual(['Không theo dõi tồn', 'Theo số lượng', 'Theo lô'])
  await expect(tracking(page)).toHaveValue('quantity')
  await tracking(page).selectOption({ label: 'Theo lô' })
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await settled(page)
  await page.reload()
  await recordReady(page, 'Gel rửa mặt chưa có tồn')
  await expect(tracking(page)).toHaveValue('lot')
})

test('stock on hand locks the Theo dõi field and says how to change it', async ({ page }) => {
  await open(page, 'admin', CREAM, 'Kem dưỡng có tồn')
  await expect(tracking(page)).toBeDisabled()
  await expect(tracking(page)).toHaveValue('quantity')
  await expect(page.locator('#product-record-inventoryTracking-help')).toHaveText(
    'Còn tồn kho hoặc hàng đang giữ. Đưa tồn về 0 trước khi đổi cấu hình kho hoặc giá vốn.',
  )
})

test('the saved invoicing policy and costs show to those allowed to read them', async ({ page, ui }) => {
  ui.allow(/alert: Hết hàng/, 'the product has no stock yet')
  await open(page, 'admin', GEL, 'Gel rửa mặt chưa có tồn')
  await expect(record(page).getByText('Cơ sở lập hoá đơn', { exact: true })).toBeVisible()
  await expect(record(page).getByText('Theo số lượng giao', { exact: true })).toBeVisible()
  await expect(record(page).getByText('Giá vốn', { exact: true }).first()).toBeVisible()
  await page.goto(CREAM)
  await recordReady(page, 'Kem dưỡng có tồn')
  await expect(record(page).getByText('Theo số lượng đặt', { exact: true })).toBeVisible()
  // The screen guide sends people to the menu entry by its name.
  await page.getByRole('button', { name: 'Hướng dẫn màn hình' }).click()
  await expect(page.getByRole('heading', { name: 'Trang sản phẩm' })).toBeVisible()
  await expect(
    page.getByText(/thay đổi tại Bán hàng → Chính sách lập hoá đơn/).filter({ visible: true }),
  ).toHaveCount(1)
  await page.keyboard.press('Escape')

  // A warehouse operator reads how the product is tracked, not its policy or its costs. (The
  // closed screen help names them too, so only what is on screen counts.)
  await page.context().clearCookies()
  await open(page, 'thukho', CREAM, 'Kem dưỡng có tồn')
  await expect(tracking(page)).toHaveCount(0)
  const tracked = page.getByRole('term').filter({ hasText: /^Theo dõi$/ })
  await expect(tracked).toBeVisible()
  await expect(tracked.locator('xpath=following-sibling::dd[1]')).toHaveText('Theo số lượng')
  const shown = (text: string) => page.getByText(text).filter({ visible: true })
  await expect(shown('Cơ sở lập hoá đơn')).toHaveCount(0)
  await expect(shown('Theo số lượng đặt')).toHaveCount(0)
  // P16: costs are left out, and the page says so instead of showing nothing (or a zero).
  await expect(page.getByRole('term').filter({ hasText: /^Giá vốn/ })).toHaveCount(0)
  await expect(shown('Vai trò hiện tại không xem giá vốn và lợi nhuận.')).toHaveCount(1)
})

test('a packaging row saves with the product, and a bad barcode keeps the draft', async ({ page, ui }) => {
  ui.allow(/Chưa lưu được|Nhập GTIN/, 'the barcode is refused on purpose')
  await open(page, 'admin', CREAM, 'Kem dưỡng có tồn')
  await packagingCard(page).getByRole('button', { name: 'Thêm dòng' }).click()
  await page.getByRole('listbox').last().getByRole('option', { name: 'Hộp 6 gói · 6 Gói' }).click()
  const row = packaging(page).getByRole('row').nth(1)
  await expect(row).toContainText('Hộp 6 gói')
  await row.getByRole('gridcell').nth(1).dblclick()
  await page.keyboard.type('8934567890128')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  const refusal = 'Nhập GTIN gồm 8, 12, 13 hoặc 14 chữ số và đúng số kiểm tra GS1.'
  await expect(page.getByRole('alert').filter({ hasText: 'Chưa lưu được' })).toContainText(refusal)
  // The row and the typed barcode are still there to correct.
  await expect(row.getByRole('gridcell').nth(1)).toHaveText('8934567890128')
  await row.getByRole('gridcell').nth(1).dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('8934567890120')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Chưa lưu được' })).toHaveCount(0)
  await settled(page)
  await page.reload()
  await recordReady(page, 'Kem dưỡng có tồn')
  await expect(packaging(page).getByRole('row').nth(1)).toContainText('Hộp 6 gói')
  await expect(packaging(page).getByRole('row').nth(1)).toContainText('8934567890120')
  // The product list finds the product by its packaging barcode.
  await page.goto('/admin/product/templates?q=8934567890120')
  await expect(productRow(page, 'Kem dưỡng có tồn')).toBeVisible()
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(1)

  // A warehouse operator reads the row and cannot change it.
  await page.context().clearCookies()
  await open(page, 'thukho', CREAM, 'Kem dưỡng có tồn')
  await expect(packaging(page)).toContainText('8934567890120')
  await expect(packagingCard(page).getByRole('button', { name: 'Thêm dòng' })).toHaveCount(0)
  await expect(packagingCard(page).getByRole('button', { name: 'Xóa dòng' })).toHaveCount(0)
})

test('a transfer opened by link offers each person only what they may do', async ({ page }) => {
  const TRANSFER = '/admin/stock/transfers/delivery-cream'
  // The transfer is a page (C24): its products and picked lines are grids, its conversation the rail.
  const transfer = page.locator('[data-ui="record-page"]')
  const products = transfer.getByRole('grid', { name: 'Sản phẩm', exact: true })
  const picked = transfer.getByRole('grid', { name: 'Đã lấy hàng', exact: true })
  await signIn(page, 'admin', TRANSFER)
  await recordReady(page, 'HCM/OUT/0001')
  await settled(page)
  await expect(transfer.getByRole('button', { name: 'Xác nhận' })).toBeVisible()
  await expect(transfer.getByRole('button', { name: 'Hủy' })).toBeVisible()
  // The line names its unit, as the product does.
  await expect(products.getByRole('row').filter({ hasText: 'Kem dưỡng có tồn' })).toHaveAccessibleName(
    /Gói 2 Nháp$/,
  )
  await expect(page.getByRole('complementary').getByText('Gửi tin nhắn')).toBeVisible()
  // Only the lots of the product a line picks are offered: the ledger refuses any other.
  await transfer.getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('Kem')
  await page
    .getByRole('listbox', { name: 'Sản phẩm' })
    .getByRole('option', { name: /Kem dưỡng có tồn/ })
    .click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox', { name: 'Lô / Sê-ri' }).getByRole('option')).toHaveText(['KD-2601'])
  await page.keyboard.press('Escape')
  await expect(picked.getByRole('row')).toHaveCount(2)

  await page.context().clearCookies()
  await signIn(page, 'thukho', TRANSFER)
  await recordReady(page, 'HCM/OUT/0001')
  await settled(page)
  await expect(products.getByRole('row').filter({ hasText: 'Kem dưỡng có tồn' })).toHaveAccessibleName(
    /Gói 2 Nháp$/,
  )
  // The storekeeper confirms, completes and cancels transfers (K21, owner 26/10/2026), but does not
  // write in its conversation.
  await expect(transfer.getByRole('button', { name: 'Xác nhận' })).toBeVisible()
  await expect(transfer.getByRole('button', { name: 'Hủy' })).toBeVisible()
  await expect(page.getByText('Gửi tin nhắn')).toHaveCount(0)
  await expect(transfer.getByRole('button', { name: 'Thêm sản phẩm' })).toBeVisible()
})
