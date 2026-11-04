import type { Page } from '@playwright/test'
import {
  DESKTOP,
  MOBILE,
  evidence,
  expect,
  fitsWidth,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// Vendor bill matching (#1737), on the Commerce deployment: a vendor bill shows how it compares with its
// purchase order, a bill priced 8% above its order (2% allowed) cannot be posted, and holding it keeps
// the reason while the vendor corrects it.

test.use({ locale: 'vi-VN' })

const BILLS = '/admin/accounting/vendor-bills'
/** The bill's matching block: the section under its own heading. */
const matching = (page: Page) =>
  page
    .locator('main section[data-ui="section"]')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Đối chiếu đơn mua', exact: true }) })

test('a bill off its order price is refused, held with a reason and listed as held (desktop)', async ({
  page,
}, info) => {
  await page.setViewportSize(DESKTOP)
  await signIn(page, 'admin', `${BILLS}/bill-off`)
  await settled(page)
  const block = matching(page)
  await expect(block).toContainText('Lệch đơn mua')
  await expect(block).toContainText('Dung sai giá 2%')
  await expect(block).toContainText('Lệch giá 8%')
  // Why it does not match is in view beside the rail, not scrolled off the table's end.
  await expect(block.locator('td[data-col="result"]').first()).toBeInViewport()
  await fitsWidth(page)
  await evidence(page, info, 'bill-mismatch-desktop')

  // The guide explains why posting is refused and how holding works.
  await page.getByRole('button', { name: 'Hướng dẫn màn hình' }).click()
  await expect(page.getByRole('heading', { name: 'Hoá đơn nhà cung cấp' })).toBeVisible()
  await expect(page.getByText(/Hoá đơn lệch thì/).filter({ visible: true })).toHaveCount(1)
  await expect(page.locator('#account-vendor-bill-help [data-ui="mermaid"]')).toHaveAttribute(
    'data-state',
    'ready',
  )
  await evidence(page, info, 'bill-help-desktop')
  await page.keyboard.press('Escape')

  await page.locator('main').getByRole('button', { name: 'Ghi sổ', exact: true }).click()
  await settled(page)
  await expect(page.getByText(/Đơn giá dòng “.*” \(PO\d+\) lệch quá 2% so với đơn mua/)).toBeVisible()
  await expect(page.locator('main').getByText('Nháp', { exact: true }).first()).toBeVisible()

  await matching(page).getByLabel('Lý do tạm giữ').fill('NCC báo giá mới 27.000 ₫, chờ xác nhận')
  await matching(page).getByRole('button', { name: 'Tạm giữ hoá đơn', exact: true }).click()
  await settled(page)
  await expect(matching(page)).toContainText('NCC báo giá mới 27.000 ₫, chờ xác nhận')
  await expect(matching(page).getByRole('button', { name: 'Bỏ tạm giữ', exact: true })).toBeVisible()
  await evidence(page, info, 'bill-held-desktop')

  await page.goto(`${BILLS}?lang=vi`)
  await settled(page)
  await expect(page.locator('[data-row="bill-off"] [data-col="matching"]')).toContainText('Đang tạm giữ')
  await expect(page.locator('[data-row="bill-match"] [data-col="matching"]')).toContainText('Khớp')
  await evidence(page, info, 'bills-list-desktop')
})

test('a bill that matches its order posts', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await signIn(page, 'admin', `${BILLS}/bill-match`)
  await settled(page)
  await expect(matching(page)).toContainText('Khớp đơn mua')
  await page.locator('main').getByRole('button', { name: 'Ghi sổ', exact: true }).click()
  await settled(page)
  await expect(page.locator('main').getByText('Đã ghi sổ', { exact: true }).first()).toBeVisible()
})

test('the matching stays readable on a phone', async ({ page }, info) => {
  await page.setViewportSize(MOBILE)
  await signIn(page, 'admin', `${BILLS}/bill-off`)
  await settled(page)
  await expect(matching(page)).toContainText('Lệch đơn mua')
  await fitsWidth(page)
  await evidence(page, info, 'bill-mismatch-mobile')
})

test('the purchasing settings save the price tolerance on its own', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await signIn(page, 'admin', '/admin/purchase/configuration')
  await settled(page)
  const tolerance = page.getByLabel('Dung sai giá (%)', { exact: true })
  await expect(tolerance).toHaveValue('2')
  await tolerance.fill('5')
  await page
    .locator('#purchase-configuration-matching')
    .getByRole('button', { name: 'Lưu', exact: true })
    .click()
  await settled(page)
  await page.reload()
  await settled(page)
  await expect(page.getByLabel('Dung sai giá (%)', { exact: true })).toHaveValue('5')
  await expect(page.getByLabel('Ngưỡng duyệt cấp 1', { exact: true })).toHaveValue('50000000')
})
