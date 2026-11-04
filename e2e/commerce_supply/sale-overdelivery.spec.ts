import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// C23 (D33a), on the Commerce deployment: a delivery to a customer may ship more than was ordered, never
// more than is on hand. The order counts the extra as delivered: a product invoiced as delivered invoices
// it, named in Tạo hoá đơn; one invoiced as ordered leaves the order an upselling opportunity.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const ORDER = '/admin/sales/orders/order-over'
const MASK = 'Mặt nạ giao theo số giao'
const CREAM = 'Kem dưỡng có tồn'
const main = (page: Page) => page.locator('main')
const transfer = (page: Page) => page.locator('[data-ui="record-page"]')
// The delivery is a page (C24): a move's row in Sản phẩm reads its unit, demand, what its picked lines
// hold (Đã làm) and its state; its picked lines are typed into Đã lấy hàng and saved at once.
const move = (page: Page, name: string) =>
  transfer(page)
    .getByRole('grid', { name: 'Sản phẩm', exact: true })
    .getByRole('row')
    .filter({ hasText: name })
const picked = (page: Page, name: string) =>
  transfer(page)
    .getByRole('grid', { name: 'Đã lấy hàng', exact: true })
    .getByRole('row')
    .filter({ hasText: name })
const record = async (page: Page, name: string, quantity: string) => {
  await picked(page, name).getByRole('gridcell').nth(1).click()
  await page.keyboard.type(quantity)
  await page.keyboard.press('Enter')
  await picked(page, name).getByRole('checkbox', { name: 'Đã lấy hàng' }).click()
  await transfer(page).getByRole('button', { name: 'Lưu dòng' }).click()
  await expect(transfer(page).locator('[data-unsaved="true"]')).toHaveCount(0)
}

test('the delivery ships more than ordered with a warning, then the order invoices the extra', async ({
  page,
}) => {
  await signIn(page, 'admin', ORDER)
  await settled(page)
  // The order's Giao hàng table opens the delivery.
  await page
    .locator('[data-ui="record-page"]')
    .getByRole('table', { name: 'Giao hàng' })
    .getByRole('row')
    .filter({ hasText: MASK })
    .getByRole('link')
    .click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/order-over%3Adelivery/)
  await settled(page)
  const state = transfer(page).locator('[data-ui="record-page-status"]')
  await transfer(page).getByRole('button', { name: 'Xác nhận' }).click()
  await expect(state).toContainText('Chờ hàng')
  await transfer(page).getByRole('button', { name: 'Giữ hàng' }).click()
  await expect(state).toContainText('Sẵn sàng')
  await expect(main(page).getByText('Xuất vượt nhu cầu')).toHaveCount(0)
  // Three masks and two creams against two and one: the page warns, nothing refuses.
  await record(page, MASK, '3')
  await expect(picked(page, MASK).getByRole('gridcell').nth(1)).toHaveText('3')
  await expect(move(page, MASK)).toHaveAccessibleName(/Gói 2 3 /)
  // The notice stands on the page, not in a card of its own (a `has` locator is searched inside the card).
  const warning = page.getByRole('status').filter({ hasText: 'Xuất vượt nhu cầu' })
  await expect(main(page).locator(warning)).toBeVisible()
  await expect(main(page).locator('[data-ui="surface"]').filter({ has: warning })).toHaveCount(0)
  await record(page, CREAM, '2')
  await expect(move(page, CREAM)).toHaveAccessibleName(/Gói 1 2 /)
  await transfer(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Hoàn tất' })
    .getByRole('button', { name: 'Hoàn tất', exact: true })
    .click()
  await expect(state).toContainText('Hoàn tất')

  await page.goto(ORDER)
  await settled(page)
  const order = page.locator('[data-ui="record-page"]')
  // Its line grid reads ordered, price, discount, delivered and invoiced last.
  const line = order.locator('[data-ui="kg-row"]').filter({ hasText: MASK })
  // The completed delivery already counts on the order, extra included, without Đồng bộ giao hàng (R1).
  await expect(line).toHaveAccessibleName(/ Gói 2 50000 0% 3 0$/)
  await order.getByRole('button', { name: 'Tạo hoá đơn' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Có hàng giao vượt số đặt')).toBeVisible()
  // The mask goes out as delivered, extra included; the cream as ordered, without its extra.
  await expect(dialog.getByRole('row').filter({ hasText: MASK })).toContainText('Gồm 1 giao vượt (đặt 2)')
  await expect(dialog.getByRole('row').filter({ hasText: MASK })).toContainText('3 Gói')
  await expect(dialog.getByRole('row').filter({ hasText: CREAM })).toContainText('1 Gói')
  await expect(dialog.getByRole('row').filter({ hasText: CREAM })).not.toContainText('giao vượt')
  // Nothing is filled in for the seller (R4): the journal and both accounts are picked by hand.
  for (const [field, option] of [
    ['Sổ nhật ký bán hàng', 'Sổ bán hàng'],
    ['Tài khoản doanh thu', 'Doanh thu bán hàng'],
    ['Tài khoản phải thu', 'Phải thu của khách hàng'],
  ]) {
    await dialog.getByRole('button', { name: field, exact: true }).click()
    await dialog.getByRole('option', { name: option, exact: true }).click()
  }
  await dialog.getByRole('button', { name: 'Tạo hoá đơn' }).click()
  await expect(dialog).toHaveCount(0)
  // Nothing is left to invoice, and the cream went out beyond its order: an upselling opportunity.
  await expect(line).toHaveAccessibleName(/ Gói 2 50000 0% 3 3$/)
  await expect(order.getByRole('definition').filter({ hasText: 'Cơ hội bán thêm' })).toBeVisible()
})
