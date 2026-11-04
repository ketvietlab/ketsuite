import type { Page } from '@playwright/test'
import { DESKTOP, expect, recordReady, settled, signIn, test } from '../product_backend/support.js'

// M14 (#1414 Stock navigation, #1415–#1421 Stock), on the Commerce deployment. Fixture: SL-14 kept by lot,
// SL-HET (3) expired ten days ago and SL-CON (5) good for a year; HCM/INT/0901 an empty draft;
// HCM/INT/0902 a confirmed transfer of a toner with no stock; HCM/IN/0064 a done receipt of 2 CN-64 at
// 100.000 ₫.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const record = (page: Page) => page.locator('[data-ui="record-page"]')
const main = (page: Page) => page.locator('main')
const row = (page: Page, text: string | RegExp) => main(page).getByRole('row').filter({ hasText: text })
const sidebar = (page: Page) =>
  page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Tổng quan kho' }) })

test('K6 K21 K53 a queue per kind of transfer lights in the sidebar; Stock configuration is behind the gear', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/transfers?preset=deliveries')
  await settled(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Phiếu xuất kho' })).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Phiếu xuất kho', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(sidebar(page).getByRole('link', { name: 'Lô hàng', exact: true })).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Kho hàng', exact: true })).toHaveCount(0)
  await page.goto('/admin/settings')
  await settled(page)
  const stock = main(page).getByRole('article', { name: 'Kho', exact: true })
  for (const link of ['Kho hàng', 'Vị trí', 'Loại hoạt động', 'Tuyến cung ứng', 'Kế toán kho'])
    await expect(stock.getByRole('link', { name: link, exact: true })).toBeVisible()
})

test('K18 an empty draft cannot be confirmed, and a transfer is cancelled only with a reason', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/transfers/picking-empty')
  await recordReady(page, 'HCM/INT/0901')
  await settled(page)
  await expect(record(page).getByRole('button', { name: 'Xác nhận', exact: true })).toBeDisabled()
  await expect(record(page).getByRole('status').filter({ hasText: 'Phiếu chưa có dòng' })).toBeVisible()
  await page.goto('/admin/stock/transfers/picking-cancel')
  await recordReady(page, 'HCM/INT/0902')
  await settled(page)
  await record(page).getByRole('button', { name: 'Hủy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Hủy phiếu kho' })
  // Spaces are no reason.
  await dialog.getByLabel('Lý do hủy').fill('   ')
  await dialog.getByRole('button', { name: 'Hủy phiếu', exact: true }).click()
  await expect(dialog.getByText('Nhập lý do hủy phiếu.')).toBeVisible()
  await dialog.getByLabel('Lý do hủy').fill('Kho nhận không còn chỗ')
  await dialog.getByRole('button', { name: 'Hủy phiếu', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(record(page).getByText('Đã hủy', { exact: true }).first()).toBeVisible()
  await expect(record(page).getByText('Kho nhận không còn chỗ')).toBeVisible()
})

test('K13 K28 the lots list says which lot expired, and stock on hand holds nothing of it for use', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/lots?q=SL-')
  await settled(page)
  await expect(row(page, 'SL-HET')).toHaveAccessibleName(/^SL-HET Serum hạn dùng · SL-14 — 3 \S+ Hết hạn$/)
  await expect(row(page, 'SL-CON')).toHaveAccessibleName(/^SL-CON Serum hạn dùng · SL-14 — 5 \S+ Còn hạn$/)
  await page.goto('/admin/stock/inventory?q=SL-14')
  await settled(page)
  // On hand, held, fit for use, then the row's history and replenishment links.
  await expect(row(page, 'SL-HET')).toHaveAccessibleName(/ 3 0 0 Lịch sử Bổ sung$/)
  await expect(row(page, 'SL-CON')).toHaveAccessibleName(/ 5 0 5 Lịch sử Bổ sung$/)
})

test('K51 a stock overview tile counts the rows of the list it opens', async ({ page }) => {
  await signIn(page, 'admin', '/admin/stock')
  await settled(page)
  const tile = main(page).getByRole('link', { name: /^Phiếu xuất chờ hàng \d+/ })
  const count = Number((await tile.getByRole('paragraph').nth(1).textContent())?.trim())
  expect(count).toBeGreaterThan(0)
  await expect(main(page).getByText('1 lô đã hết hạn còn tồn')).toBeVisible()
  await tile.click()
  await settled(page)
  await expect(
    main(page)
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: /^HCM\// }) }),
  ).toHaveCount(count)
  // K18: a confirmed receipt reads as ready, so the receipts tile's list finds it under Sẵn sàng.
  await page.goto('/admin/stock')
  await settled(page)
  const receipts = main(page).getByRole('link', { name: /^Phiếu nhập chờ nhận \d+/ })
  const open = Number((await receipts.getByRole('paragraph').nth(1).textContent())?.trim())
  expect(open).toBeGreaterThan(0)
  await receipts.click()
  await settled(page)
  const rows = main(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: /^HCM\// }) })
  await expect(rows).toHaveCount(open)
  await expect(rows.filter({ hasText: 'Sẵn sàng' }).first()).toBeVisible()
})

test('K52 the moves history lists this month’s done moves, a lot per row', async ({ page }) => {
  await signIn(page, 'admin', '/admin/stock/moves?preset=thisMonth')
  await settled(page)
  await expect(row(page, 'HCM/IN/0064')).toHaveAccessibleName(
    /\[CN-64\] Kem chống nắng chi phí .* 2 Gói Nhập kho$/,
  )
  await page.goto('/admin/stock/moves?preset=thisMonth&q=SL-HET')
  await settled(page)
  await expect(
    main(page)
      .getByRole('row')
      .filter({ hasText: /\[SL-14\]/ }),
  ).toHaveCount(1)
  await expect(row(page, /\[SL-14\]/)).toHaveAccessibleName(/ SL-HET .* 3 Gói Điều chỉnh kiểm kê$/)
})

test('K32 an expired lot says so above its page, traces where it came from and counts it', async ({
  page,
  ui,
}) => {
  ui.allow(/Lô đã hết hạn/u, 'the expired lot says so above its page (K32)')
  await signIn(page, 'admin', '/admin/stock/lots/lot-expired')
  await recordReady(page, 'SL-HET')
  await settled(page)
  await expect(main(page).getByRole('alert').filter({ hasText: 'Lô đã hết hạn' })).toBeVisible()
  const trace = record(page)
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Chứng từ gốc' }) })
  await expect(trace.getByRole('row').filter({ hasText: 'Điều chỉnh kiểm kê' })).toContainText('3 Gói')
  for (const [name, value] of [
    ['Đã nhập', '3'],
    ['Đang tồn', '3'],
    ['Đã giao', '0'],
  ])
    await expect(page.locator(`dt:text-is("${name}") + dd`)).toHaveText(value)
})

test('K55 the topbar searches Stock from a Stock screen and a found transfer opens', async ({ page }) => {
  await signIn(page, 'admin', '/admin/stock/transfers')
  await settled(page)
  await main(page).getByRole('link', { name: 'Tìm trong Kho', exact: true }).click()
  await settled(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Tìm trong Kho' })).toBeVisible()
  const box = page.getByRole('searchbox', { name: 'Số phiếu, lô, mã hoặc tên' })
  await box.fill('SL-HET')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(row(page, 'SL-HET').first()).toBeVisible()
  await box.fill('HCM/IN/0064')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(row(page, 'HCM/IN/0064')).toContainText(/Nhập kho.*Kem chống nắng chi phí · CN-64.*Hoàn tất$/)
  await row(page, 'HCM/IN/0064').getByText('HCM/IN/0064').click()
  await recordReady(page, 'HCM/IN/0064')
})

test('K64 a landed cost opened from its receipt is posted and raises the stock value', async ({ page }) => {
  await signIn(page, 'admin', '/admin/stock/transfers/receipt-landed')
  await recordReady(page, 'HCM/IN/0064')
  await settled(page)
  await record(page).getByRole('link', { name: 'Thêm chi phí mua kho', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Phiếu chi phí mua kho mới' })).toBeVisible()
  await settled(page)
  await expect(main(page).getByRole('status').filter({ hasText: 'Từ phiếu nhập' })).toContainText(
    'HCM/IN/0064',
  )
  await record(page).getByRole('button', { name: 'Nhà cung cấp', exact: true }).click()
  await page.getByRole('option', { name: 'Công ty CP Hóa mỹ phẩm Đông Á', exact: true }).click()
  await record(page).getByRole('button', { name: 'Thêm dòng', exact: true }).click()
  await page.keyboard.type('Phí vận chuyển')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type('20000')
  await page.keyboard.press('Enter')
  // Saved, it is a draft with its number; posting asks first.
  await record(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await recordReady(page, /^CPMT\/\d{4}\/\d{4}$/)
  await settled(page)
  await record(page).getByRole('button', { name: 'Ghi sổ', exact: true }).click()
  const confirm = page.getByRole('dialog')
  await confirm.getByRole('button', { name: 'Ghi sổ', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  const allocations = record(page)
    .locator('[data-ui="surface"]')
    .filter({ has: page.getByRole('heading', { name: 'Phân bổ', exact: true }) })
  // All of it still on hand: into stock, none into the cost of sales.
  await expect(allocations.getByRole('row').filter({ hasText: 'CN-64' })).toHaveAccessibleName(
    /^HCM\/IN\/0064 Kem chống nắng chi phí · CN-64 Phí vận chuyển 20\.000\s₫ 20\.000\s₫ 0\s₫$/,
  )
  // 200.000 ₫ received and 20.000 ₫ landed: 2 at 110.000 ₫.
  await page.goto('/admin/stock/valuation?q=CN-64')
  await settled(page)
  await expect(row(page, 'CN-64')).toContainText(/2.*110\.000\s₫.*220\.000\s₫/)
})
