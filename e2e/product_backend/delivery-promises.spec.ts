import type { Page } from '@playwright/test'
import { DESKTOP, expect, recordReady, settled, signIn, test } from './support.js'

// C12 (P51): a product's customer lead time, and the expected and committed delivery dates of a
// quotation: earliest when available items ship, latest when the order ships at once.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const recordPage = (page: Page) => page.locator('[data-ui="record-page"]')
// The company runs on Vietnam time; dates read as the page writes them.
const day = (offset: number) => {
  const date = new Date(Date.now() + offset * 86_400_000)
  return new Intl.DateTimeFormat('vi', { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(date)
}
const plan = (page: Page) =>
  recordPage(page)
    .locator('form')
    .filter({ has: page.getByRole('combobox', { name: 'Chính sách giao hàng' }) })
const rail = (page: Page) => page.getByRole('complementary', { name: /Kế hoạch giao hàng/ })
const fact = (page: Page, term: string) =>
  rail(page).getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::dd[1]')

test('a product carries its customer lead time, 0–365 days', async ({ page, ui }) => {
  ui.allow(/alert: Hết hàng/, 'the tissues have no stock')
  await signIn(page, 'admin', '/admin/product/templates/lead-tissue')
  await recordReady(page, 'Khăn giấy giao sau')
  await settled(page)
  const days = recordPage(page).getByRole('spinbutton', { name: 'Giao cho khách sau (ngày)' })
  await expect(days).toHaveValue('2')
  // Past a year the field itself refuses: the browser keeps the form from posting.
  await days.fill('400')
  await recordPage(page).getByRole('button', { name: 'Lưu thay đổi' }).click()
  expect(await days.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true)
  await days.fill('3')
  await recordPage(page).getByRole('button', { name: 'Lưu thay đổi' }).click()
  await settled(page)
  await page.reload()
  await recordReady(page, 'Khăn giấy giao sau')
  await expect(recordPage(page).getByRole('spinbutton', { name: 'Giao cho khách sau (ngày)' })).toHaveValue(
    '3',
  )
})

test('a warehouse manager reads the lead time locked, told why once', async ({ page, ui }) => {
  ui.allow(/alert: Hết hàng/, 'the tissues have no stock')
  await signIn(page, 'stockkeeper', '/admin/product/templates/lead-tissue')
  await recordReady(page, 'Khăn giấy giao sau')
  await settled(page)
  await expect(recordPage(page).getByRole('spinbutton', { name: 'Giao cho khách sau (ngày)' })).toBeDisabled()
  await expect(
    recordPage(page).getByText(/^Thông tin chung do người quản lý sản phẩm cập nhật\./),
  ).toHaveCount(1)
})

test('a quotation expects its delivery earliest when items ship as available, latest at once', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-delivery')
  await recordReady(page, /^S\d+/)
  await settled(page)
  // The soap ships today; the wipes in two days.
  await expect(plan(page)).toContainText(`Ngày dự kiến giao: ${day(0)}`)
  await expect(fact(page, 'Ngày dự kiến giao')).toHaveText(day(0))
  await plan(page)
    .getByRole('combobox', { name: 'Chính sách giao hàng' })
    .selectOption({ label: 'Giao một lần' })
  await plan(page).getByRole('button', { name: 'Lưu kế hoạch giao' }).click()
  await expect(plan(page)).toContainText(`Ngày dự kiến giao: ${day(2)}`)
  await expect(fact(page, 'Ngày dự kiến giao')).toHaveText(day(2))
  await expect(fact(page, 'Chính sách giao hàng')).toHaveText('Giao một lần')
})

test('a committed date schedules the delivery the confirmed order ships', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-delivery-sold')
  await recordReady(page, /^S\d+/)
  await settled(page)
  const committed = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  await plan(page).getByRole('textbox', { name: 'Ngày cam kết giao' }).fill(committed)
  await plan(page).getByRole('button', { name: 'Lưu kế hoạch giao' }).click()
  await expect(fact(page, 'Ngày cam kết giao')).toHaveText(day(5))
  await recordPage(page).getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page).toHaveURL(/\/admin\/sales\/orders\/quote-delivery-sold/)
  await recordReady(page, /^S\d+/)
  await recordPage(page).getByRole('table', { name: 'Giao hàng' }).getByRole('link').first().click()
  // The delivery takes its warehouse's next delivery number (C28); it is scheduled on the committed date.
  await recordReady(page, /\/XK\/\d{4}$/)
  const [y, m, d] = committed.split('-')
  // The transfer page (C24) names it among its facts, at midnight where the company is, in the short
  // Vietnamese form: day and month without a leading zero.
  await expect(
    page
      .locator('[data-ui="record-page"]')
      .getByRole('term')
      .filter({ hasText: /^Ngày dự kiến$/ })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(`00:00 ${Number(d)}/${Number(m)}/${y!.slice(2)}`)
})

test('a quotation of services only expects no delivery', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-service-only')
  await recordReady(page, /^S\d+/)
  await settled(page)
  await expect(plan(page)).toContainText('Ngày dự kiến giao: —')
})
