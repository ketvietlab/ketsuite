import type { Page } from '@playwright/test'
import {
  DESKTOP,
  addGridLine,
  expect,
  quotationGrid,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// C22 (D32), on the Commerce deployment: with Cảnh báo khi bán on, a customer and a product carry a note
// the order shows to the salesperson, customer first, never blocking. The customer's page reads the note
// and edits it in a dialog, so the page keeps its one save button.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const SPA = '/admin/partner/partners/spa'
const CREAM = '/admin/product/templates/cream'
const QUOTE = '/admin/sales/quotations/quote-warning'
const CANCELLED = '/admin/sales/quotations/quote-warning-cancelled'
const SPA_NOTE = 'Khách hay đổi ý, xác nhận lại số lượng trước khi chốt.'
const CREAM_NOTE = 'Hỏi khách da nhạy cảm trước khi bán.'
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const card = (page: Page) =>
  page
    .locator('[data-ui="surface"]')
    .filter({ has: page.getByRole('heading', { name: 'Cảnh báo khi bán', exact: true }) })
const notices = (page: Page) => record(page).locator('[data-ui="notice"]').filter({ hasText: 'Lưu ý về' })
const setWarnings = async (page: Page, on: boolean) => {
  await signIn(page, 'admin', '/admin/sales/configuration')
  const box = page.getByRole('checkbox', { name: 'Cảnh báo khi bán' })
  await box.setChecked(on)
  // Each tab of the configuration saves its own form (D20).
  await page.locator('form').filter({ has: box }).getByRole('button', { name: 'Lưu', exact: true }).click()
  await page.goto('/admin/sales/configuration')
  await expect(page.getByRole('checkbox', { name: 'Cảnh báo khi bán' })).toBeChecked({ checked: on })
}

test('warnings are off until the sales configuration turns them on', async ({ page }) => {
  await signIn(page, 'admin', SPA)
  await expect(page.getByRole('heading', { level: 1, name: 'Spa Hoa Mai' })).toBeVisible()
  await settled(page)
  await expect(card(page)).toHaveCount(0)
  await page.context().clearCookies()
  await setWarnings(page, true)
})

test('the customer page reads the warning and edits it in a dialog, beside its one save button', async ({
  page,
}) => {
  await signIn(page, 'admin', SPA)
  await expect(card(page)).toContainText('Chưa có cảnh báo cho khách này.')
  // The conversation stays for who may read it; a reader without it gets no failing panel (last test).
  await expect(page.getByRole('heading', { name: 'Thảo luận' })).toBeVisible()
  // The warning has no field or save button of its own on the page: Lưu thông tin is not it.
  await expect(card(page).getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /cảnh báo/i })).toHaveText(['Sửa cảnh báo'])
  await card(page).getByRole('button', { name: 'Sửa cảnh báo' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cảnh báo khi bán' })
  await expect(dialog.getByLabel('Cảnh báo khi bán')).toHaveAttribute('maxlength', '300')
  await dialog.getByLabel('Cảnh báo khi bán').fill(SPA_NOTE)
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(card(page)).toContainText(SPA_NOTE)
  await page.reload()
  await expect(card(page)).toContainText(SPA_NOTE)
})

test('a product keeps its warning with the product', async ({ page }) => {
  await signIn(page, 'admin', CREAM)
  const field = page.getByRole('textbox', { name: 'Cảnh báo khi bán' })
  await expect(field).toHaveAttribute('maxlength', '300')
  await field.fill(CREAM_NOTE)
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByText('Thay đổi đã được ghi nhận.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Cảnh báo khi bán' })).toHaveValue(CREAM_NOTE)
})

test('the quotation shows the customer first, then each product, unsaved lines included', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await expect(notices(page)).toHaveText([
    new RegExp(`^Lưu ý về Spa Hoa Mai:?\\s*${SPA_NOTE}$`),
    new RegExp(`^Lưu ý về Kem dưỡng có tồn:?\\s*${CREAM_NOTE}$`),
  ])
  // The notices stand on the page, not in a card of their own.
  await expect(notices(page).first().locator('xpath=ancestor::*[@data-ui="surface"]')).toHaveCount(0)
  // A line not saved yet brings its product's warning at once; nothing is blocked.
  await addGridLine(page, { search: 'TM-001', option: /Bông tẩy trang 120 miếng/, quantity: '1' })
  await expect(notices(page)).toHaveCount(3)
  await expect(notices(page).nth(2)).toContainText('Lưu ý về Bông tẩy trang 120 miếng')
  await expect(record(page).getByRole('button', { name: 'Xác nhận' })).toBeEnabled()
})

test('a cancelled order shows no warning; a reader sees the warning but cannot edit it', async ({ page }) => {
  await signIn(page, 'admin', CANCELLED)
  await expect(record(page).getByRole('heading', { level: 2, name: 'Sản phẩm' })).toBeVisible()
  await settled(page)
  await expect(notices(page)).toHaveCount(0)
  await page.context().clearCookies()
  await signIn(page, 'reader', SPA)
  await expect(card(page)).toContainText(SPA_NOTE)
  await expect(card(page).getByRole('button', { name: 'Sửa cảnh báo' })).toHaveCount(0)
})

test('turned off again, the customer page and the quotation show no warning', async ({ page }) => {
  await setWarnings(page, false)
  await page.goto(QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await expect(notices(page)).toHaveCount(0)
  await page.goto(SPA)
  await expect(page.getByRole('heading', { level: 1, name: 'Spa Hoa Mai' })).toBeVisible()
  await settled(page)
  await expect(card(page)).toHaveCount(0)
})
