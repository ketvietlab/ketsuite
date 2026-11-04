import type { Page } from '@playwright/test'
import { DESKTOP, expect, recordReady, settled, signIn, test } from '../product_backend/support.js'

// M12 (#1389 K63a, #1400 K63b, #1404 D8/D10), on the Commerce deployment. Fixture: NH-01 counted 4 at
// 50.000 ₫; HCM/IN/0040 took in 2 MN-40 at 100.000 ₫; accountant `ketoan`; confirmed order order-billed of
// 2 SD-40 invoiced as ordered. Each product is the spec's own.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const record = (page: Page) => page.locator('[data-ui="record-page"]')
const row = (page: Page, text: string) => page.locator('main').getByRole('row').filter({ hasText: text })

test('the move analysis lists the count and the aging puts it under 30 days, at the average', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/analysis?q=NH-01')
  await settled(page)
  // Kind, state, demand, done, value, what is left of it and its value.
  await expect(row(page, 'NH-01').first()).toHaveAccessibleName(
    /NH-01\] Nước hoa hồng tồn kho Điều chỉnh kiểm kê Hoàn tất 4 4 Gói 200\.000\s₫ 4 200\.000\s₫$/,
  )
  await page.goto('/admin/stock/aging?q=NH-01')
  await settled(page)
  // All 4 came in within 30 days.
  await expect(row(page, 'NH-01')).toHaveAccessibleName(
    /^NH-01 Nước hoa hồng tồn kho Kho Hồ Chí Minh 4 Gói 4 0 0 0 \S+ 200\.000\s₫$/,
  )
})

test('an accountant adjusts the value of a received line, and the average follows', async ({ page }) => {
  await signIn(page, 'ketoan', '/admin/stock/transfers/receipt-reval')
  await recordReady(page, 'HCM/IN/0040')
  await settled(page)
  await record(page).getByRole('button', { name: 'Điều chỉnh giá trị', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Điều chỉnh giá trị hàng nhập' })
  await dialog.getByLabel('Số tiền điều chỉnh').fill('20000')
  await dialog.getByRole('radio', { name: /^Hàng mua đang đi đường/ }).check()
  await dialog.getByLabel('Lý do').fill('Nhà cung cấp sửa giá')
  await dialog.getByRole('button', { name: 'Ghi điều chỉnh' }).click()
  await expect(dialog).toHaveCount(0)
  const adjustments = record(page).getByRole('table', { name: 'Điều chỉnh giá trị' })
  await expect(adjustments.getByRole('row').filter({ hasText: 'MN-40' })).toContainText('20.000')
  await expect(adjustments.getByRole('link', { name: /^KHO\// })).toBeVisible()
  // 200.000 ₫ received plus 20.000 ₫: 2 at 110.000 ₫.
  await page.goto('/admin/stock/valuation?q=MN-40')
  await settled(page)
  await expect(row(page, 'MN-40')).toContainText(/2.*110\.000\s₫.*220\.000\s₫/)
})

test('an accountant invoices a sales order, cancels the draft, and the order can be invoiced again', async ({
  page,
}) => {
  await signIn(page, 'ketoan', '/admin/sales/orders/order-billed')
  await settled(page)
  const order = record(page)
  await order.getByRole('button', { name: 'Tạo hoá đơn' }).click()
  const dialog = page.getByRole('dialog')
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
  await expect(order.getByRole('button', { name: 'Tạo hoá đơn' })).toHaveCount(0)
  await expect(order.getByRole('definition').filter({ hasText: 'Đã lập đủ' })).toBeVisible()
  // The draft invoice is cancelled from accounting (D10): it no longer counts.
  await order.getByRole('table', { name: 'Hoá đơn' }).getByRole('link').first().click()
  await settled(page)
  await page.getByRole('button', { name: 'Huỷ', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ghi sổ' })).toHaveCount(0)
  await page.goto('/admin/sales/orders/order-billed')
  await settled(page)
  await expect(order.getByRole('definition').filter({ hasText: 'Chờ lập hoá đơn' })).toBeVisible()
  await expect(order.getByRole('button', { name: 'Tạo hoá đơn' })).toBeVisible()
})
