import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from './support.js'

// K27–K31 as far as the product's shelf life reaches a lot: a new lot takes its expiry from
// the manufacturing date and the product's months, the alert follows the expiry, the dates
// keep their order, quarantine needs a reason, and who only reads stock reads lots.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const LOTS = '/admin/stock/lots'

const lotsReady = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Lô và số sê-ri' })).toBeVisible()
  await settled(page)
}

/** A date of the lot form, by its label; the calendar button beside it is labelled after it. */
const date = (page: Page, label: string) => page.getByRole('dialog').getByLabel(label, { exact: true })

const openLot = async (page: Page, name: string) => {
  await page.goto(LOTS)
  await lotsReady(page)
  await page.getByRole('link', { name, exact: true }).click()
  const lot = page.getByRole('dialog')
  await expect(lot.getByRole('heading', { name, exact: true })).toBeVisible()
  await settled(page)
  return lot
}

const openCreate = async (page: Page) => {
  await page.getByRole('link', { name: 'Tạo mới' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Tạo lô hoặc số sê-ri' })).toBeVisible()
  await settled(page)
  const product = dialog.getByRole('combobox', { name: 'Sản phẩm' })
  const value = await product
    .locator('option', { hasText: 'Kem chống nắng có báo giá' })
    .getAttribute('value')
  await product.selectOption(value ?? '')
  return dialog
}

test('a new lot takes its expiry from the manufacturing date and the shelf life', async ({ page }) => {
  await signIn(page, 'admin', LOTS)
  await lotsReady(page)
  const dialog = await openCreate(page)
  await dialog.getByRole('textbox', { name: 'Số lô / sê-ri' }).fill('KCN-260101')
  await date(page, 'Ngày sản xuất').fill('2026-01-01')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await settled(page)

  await openLot(page, 'KCN-260101')
  await expect(date(page, 'Hạn dùng')).toHaveValue('2028-01-01')
  await expect(date(page, 'Ngày cảnh báo')).toHaveValue('2027-12-02')

  // Moving the expiry moves the alert with it.
  await date(page, 'Hạn dùng').fill('2027-12-31')
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu', exact: true }).click()
  await settled(page)
  await openLot(page, 'KCN-260101')
  await expect(date(page, 'Hạn dùng')).toHaveValue('2027-12-31')
  await expect(date(page, 'Ngày cảnh báo')).toHaveValue('2027-12-01')
})

test('a manufacturing date after the expiry is refused', async ({ page, ui }) => {
  ui.allow(/^\d{3} POST /u, 'the dates are refused on purpose')
  ui.allow(/^last screen alert: /u, 'the refusal is the message')
  await signIn(page, 'admin', LOTS)
  await lotsReady(page)
  const dialog = await openCreate(page)
  await dialog.getByRole('textbox', { name: 'Số lô / sê-ri' }).fill('KCN-BAD')
  await date(page, 'Ngày sản xuất').fill('2027-06-01')
  await date(page, 'Hạn dùng').fill('2027-01-01')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(
    page.getByText('Ngày sản xuất phải trước hạn dùng; các mốc khác không được sau hạn dùng.').first(),
  ).toBeVisible()
  await page.goto(LOTS)
  await lotsReady(page)
  await expect(page.getByRole('link', { name: 'KCN-BAD' })).toHaveCount(0)
})

test('quarantine needs a reason and the history keeps it', async ({ page, ui }) => {
  ui.allow(/^\d{3} POST /u, 'the missing reason is refused on purpose')
  ui.allow(/^last screen alert: /u, 'the refusal is the message')
  await signIn(page, 'admin', LOTS)
  const lot = await openLot(page, 'KCN-250601')
  await lot.getByRole('combobox', { name: 'Cách ly' }).selectOption('true')
  await lot.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.getByText('Nhập lý do cách ly hoặc bỏ cách ly lô.').first()).toBeVisible()

  await page.getByRole('dialog').getByRole('textbox', { name: 'Lý do thay đổi' }).fill('Chờ kiểm nghiệm')
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu', exact: true }).click()
  await settled(page)
  const saved = await openLot(page, 'KCN-250601')
  await expect(saved.getByRole('combobox', { name: 'Cách ly' })).toHaveValue('true')
  await expect(saved).toContainText('Chờ kiểm nghiệm')
})

test('who only reads stock opens a lot without changing it', async ({ page, ui }) => {
  ui.allow(/Lô đang cách ly/u, 'the quarantined lot says so above its page (K32)')
  await signIn(page, 'role-warehouse-operator', LOTS)
  await lotsReady(page)
  await expect(page.getByRole('link', { name: 'Tạo mới' })).toHaveCount(0)
  const lot = await openLot(page, 'KCN-250601')
  await expect(lot.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)
})
