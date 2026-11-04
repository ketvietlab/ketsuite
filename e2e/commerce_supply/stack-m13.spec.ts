import type { Locator, Page } from '@playwright/test'
import { DESKTOP, expect, recordReady, settled, signIn, test } from '../product_backend/support.js'

// M13 (#1405–#1413 Sales, #1414 Stock navigation), on the Commerce deployment. Fixture: SR-13 is not kept
// in stock; Nhà thuốc Bình An owes 300.000 ₫ on order-credit against a limit of 100.000 ₫ and has
// quote-credit open; Bảng giá VIP takes 20% off; quote-reprice is Spa Hoa Mai's draft of one SR-13;
// Salon Ngọc Trâm's order-deposit is confirmed at 300.000 ₫. None of them has a pricelist.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const record = (page: Page) => page.locator('[data-ui="record-page"]')
const main = (page: Page) => page.locator('main')
const row = (page: Page, text: string | RegExp) => main(page).getByRole('row').filter({ hasText: text })
const term = (page: Page, name: string) => record(page).locator(`dt:text-is("${name}") + dd`)
/** Picks a record from a DS relation picker by its field's name. */
const pick = async (scope: Locator, field: string, option: string) => {
  await scope.getByRole('button', { name: field, exact: true }).click()
  await scope.page().getByRole('option', { name: option, exact: true }).click()
}
const QUOTE = '/admin/sales/quotations/quote-reprice'

test('D11 D12 a customer over its limit is flagged on the list, its page and its quotation, which still confirms', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/customers')
  await settled(page)
  await expect(row(page, 'Nhà thuốc Bình An')).toContainText(/300\.000\s₫\s*Vượt hạn mức\s*100\.000\s₫/)
  await expect(row(page, 'Salon Ngọc Trâm')).not.toContainText('Vượt hạn mức')
  await page.goto('/admin/sales/quotations/quote-credit')
  await settled(page)
  // The quotation counts itself: 300.000 ₫ confirmed and 150.000 ₫ quoted.
  await expect(record(page).getByRole('status').filter({ hasText: 'Vượt hạn mức công nợ' })).toContainText(
    'công nợ của Nhà thuốc Bình An là 450.000 ₫, vượt hạn mức 100.000 ₫',
  )
  await expect(record(page).getByRole('button', { name: 'Xác nhận', exact: true })).toBeEnabled()
  // A limit above what it owes clears the warning.
  await page.goto('/admin/sales/customers/debtor')
  await recordReady(page, 'Nhà thuốc Bình An')
  await settled(page)
  await record(page).getByRole('button', { name: 'Sửa hạn mức và điều khoản' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Hạn mức công nợ').fill('1000000')
  await dialog.getByRole('button', { name: 'Lưu hạn mức' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(record(page).getByRole('status').filter({ hasText: 'Vượt hạn mức' })).toHaveCount(0)
  await expect(record(page).getByText('1.000.000 ₫')).toBeVisible()
})

test('D14 a quotation takes another pricelist, and Cập nhật giá prices its lines again', async ({ page }) => {
  await signIn(page, 'admin', QUOTE)
  await settled(page)
  await expect(term(page, 'Bảng giá')).toHaveText('—')
  await record(page).getByRole('button', { name: 'Cập nhật giá', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Cập nhật giá' })
  await pick(dialog, 'Bảng giá', 'Bảng giá VIP')
  await dialog.getByRole('button', { name: 'Cập nhật giá', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(term(page, 'Bảng giá')).toHaveText('Bảng giá VIP')
  // 150.000 ₫ less 20%.
  await expect(term(page, 'Tổng tiền')).toHaveText(/^120\.000\s₫$/)
})

test('D15 a tag made behind the gear goes on a quotation, which a search by the tag finds', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/tags')
  await settled(page)
  await main(page).getByRole('link', { name: 'Tạo thẻ', exact: true }).click()
  const created = page.getByRole('dialog', { name: 'Thẻ bán hàng mới' })
  await created.getByLabel('Tên thẻ').fill('Khách sỉ')
  await created.getByRole('button', { name: 'Tạo thẻ', exact: true }).click()
  await expect(created).toHaveCount(0)
  await expect(row(page, 'Khách sỉ')).toHaveCount(1)
  await page.goto(QUOTE)
  await settled(page)
  await record(page).getByRole('button', { name: 'Sửa thẻ', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa thẻ' })
  await pick(dialog, 'Thẻ', 'Khách sỉ')
  await dialog.getByRole('button', { name: 'Lưu thẻ', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(term(page, 'Thẻ')).toHaveText('Khách sỉ')
  await page.goto('/admin/sales/quotations')
  await settled(page)
  await page.getByRole('searchbox', { name: 'Tìm và lọc' }).fill('Khách sỉ')
  await page.keyboard.press('Enter')
  await expect(main(page).getByRole('row').filter({ hasText: 'Spa Hoa Mai' })).toHaveCount(1)
  await expect(main(page).getByRole('row').filter({ hasText: 'Nhà thuốc Bình An' })).toHaveCount(0)
})

test('D16 a sales team made behind the gear is the team of a quotation, kept with its salesperson', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/teams')
  await settled(page)
  await main(page).getByRole('link', { name: 'Tạo đội', exact: true }).click()
  const created = page.getByRole('dialog', { name: 'Đội bán hàng mới' })
  await created.getByLabel('Tên đội').fill('Đội miền Nam')
  await pick(created, 'Trưởng đội', 'Chủ doanh nghiệp')
  await created.getByLabel('Chỉ tiêu tháng').fill('5000000')
  await created.getByRole('button', { name: 'Tạo đội', exact: true }).click()
  await expect(created).toHaveCount(0)
  await expect(row(page, 'Đội miền Nam')).toHaveCount(1)
  await page.goto(QUOTE)
  await settled(page)
  await record(page).getByRole('button', { name: 'Sửa người bán', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa người bán' })
  await pick(dialog, 'Đội bán hàng', 'Đội miền Nam')
  await dialog.getByRole('button', { name: 'Lưu người bán', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(term(page, 'Người bán')).toHaveText('Chủ doanh nghiệp')
  await expect(term(page, 'Đội bán hàng')).toHaveText('Đội miền Nam')
})

test('D20 each card of the sales configuration saves alone, and online payment needs its share', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/configuration')
  await settled(page)
  const days = page.getByRole('spinbutton', { name: 'Hiệu lực báo giá (ngày)' })
  const quotations = page.locator('form').filter({ has: days })
  const online = page.getByRole('checkbox', { name: 'Yêu cầu thanh toán trực tuyến' })
  const share = page.getByRole('spinbutton', { name: 'Trả trước (%)' })
  await online.check()
  await share.fill('')
  await quotations.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(
    quotations.getByText('Nhập phần trăm trả trước lớn hơn 0 và tối đa 100 khi bật thanh toán trực tuyến.'),
  ).toBeVisible()
  await page.reload()
  await settled(page)
  await expect(page.getByRole('checkbox', { name: 'Yêu cầu thanh toán trực tuyến' })).not.toBeChecked()
  try {
    await page.getByRole('spinbutton', { name: 'Hiệu lực báo giá (ngày)' }).fill('30')
    await quotations.getByRole('button', { name: 'Lưu', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('spinbutton', { name: 'Hiệu lực báo giá (ngày)' })).toHaveValue('30')
  } finally {
    // The setting is the company's: the other specs make quotations too.
    await page.getByRole('spinbutton', { name: 'Hiệu lực báo giá (ngày)' }).fill('')
    await quotations.getByRole('button', { name: 'Lưu', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('spinbutton', { name: 'Hiệu lực báo giá (ngày)' })).toHaveValue('')
  }
})

test('D21 a product’s own invoicing policy is set in its modal and the list counts it as set', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/invoicing-policies')
  await settled(page)
  await page.getByRole('searchbox', { name: 'Tìm mã, tên hoặc nhóm sản phẩm…' }).fill('SR-13')
  await page.keyboard.press('Enter')
  // The facets count what the search finds.
  const own = main(page)
    .getByRole('navigation', { name: 'Thiết lập' })
    .getByRole('link', { name: /^Đặt riêng/ })
  await expect(own).toHaveText(/^Đặt riêng\s*0$/)
  await main(page).getByRole('link', { name: 'SR-13', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sữa rửa mặt bán hàng' })
  await dialog.getByRole('combobox', { name: 'Xuất hoá đơn theo' }).selectOption({ label: 'Số lượng giao' })
  await dialog.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row(page, 'SR-13')).toContainText(/Số lượng giao\s*Đặt riêng/)
  await expect(own).toHaveText(/^Đặt riêng\s*1$/)
})

test('D18 D19 the overview counts the month and the analysis groups sales by customer, in Vietnamese numbers', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales')
  await settled(page)
  await expect(main(page).getByRole('link', { name: /^Doanh số [\d.]+\s₫/ })).toBeVisible()
  await main(page).getByRole('link', { name: 'Phân tích', exact: true }).click()
  await settled(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Phân tích bán hàng' })).toBeVisible()
  // R5: a share is written with a decimal comma.
  await expect(main(page).getByText(/^Tỷ suất: \d+,\d%/)).toBeVisible()
  // R8: the choices are one bar of three selects that apply as they change and keep each other.
  const choices = main(page).getByRole('form', { name: 'Chọn số liệu' })
  await expect(choices.getByRole('combobox')).toHaveCount(3)
  // The period is not said twice: the figures name only what they are compared with.
  const chosen = await choices.getByRole('combobox', { name: 'Kỳ' }).inputValue()
  await expect(
    main(page).getByRole('heading', { level: 2, name: `So với Năm ${Number(chosen) - 1}` }),
  ).toBeVisible()
  await expect(main(page).getByRole('heading', { level: 2, name: `Năm ${chosen}`, exact: true })).toHaveCount(
    0,
  )
  await choices.getByRole('combobox', { name: 'Nhóm theo' }).selectOption({ label: 'Theo khách hàng' })
  await expect(page).toHaveURL(/groupBy=partner/)
  await settled(page)
  await expect(row(page, 'Nhà thuốc Bình An')).toContainText(/300\.000\s₫.*\d+,\d%/)
  await choices.getByRole('combobox', { name: 'Số đo' }).selectOption({ label: 'Số đơn' })
  await expect(page).toHaveURL(/measure=orders/)
  await settled(page)
  await expect(choices.getByRole('combobox', { name: 'Nhóm theo' })).toHaveValue('partner')
  await expect(main(page).getByRole('heading', { name: 'Số đơn theo khách hàng' })).toBeVisible()
  // In English the point is a decimal point.
  await page.goto('/admin/sales/analysis?lang=en')
  await settled(page)
  await expect(main(page).getByText(/^Margin: \d+\.\d%/)).toBeVisible()
  // A choice keeps the language the page was opened in.
  await main(page)
    .getByRole('form', { name: 'Analysis choices' })
    .getByRole('combobox', { name: 'Group by' })
    .selectOption({ label: 'By customer' })
  await expect(page).toHaveURL(/lang=en.*groupBy=partner/)
  await settled(page)
  await expect(main(page).getByRole('heading', { name: 'Sales by customer' })).toBeVisible()
})

test('D6 the Sales sidebar keeps daily work; its configuration is a block of its own behind the gear', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/orders?preset=to%20invoice')
  await settled(page)
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Cần xuất hoá đơn' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Bảng giá', exact: true })).toHaveCount(
    0,
  )
  await page.goto('/admin/settings')
  await settled(page)
  // R4: Sales has its block beside Product and Stock, not among the system settings.
  const block = (name: string) => main(page).getByRole('article', { name, exact: true })
  for (const link of [
    'Cấu hình bán hàng',
    'Mẫu bán hàng',
    'Khuyến mãi',
    'Thẻ bán hàng',
    'Đội bán hàng',
    'Chính sách xuất hoá đơn',
  ])
    await expect(block('Bán hàng').getByRole('link', { name: link, exact: true })).toBeVisible()
  await expect(block('Hệ thống').getByRole('link', { name: 'Cấu hình bán hàng' })).toHaveCount(0)
})

test('D9 an accountant collects a deposit on a confirmed order into the bank', async ({ page }) => {
  await signIn(page, 'ketoan', '/admin/sales/orders/order-deposit')
  await settled(page)
  const card = record(page)
    .locator('[data-ui="surface"]')
    .filter({
      has: page.getByRole('heading', { name: 'Tiền đặt cọc', exact: true }),
    })
  await card.getByRole('button', { name: 'Thu đặt cọc', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Thu đặt cọc' })
  await dialog.getByLabel('Giá trị').fill('50')
  await pick(dialog, 'Sổ thu tiền', 'Ngân hàng')
  await pick(dialog, 'Tài khoản phải thu', 'Phải thu của khách hàng')
  await dialog.getByRole('button', { name: 'Thu đặt cọc', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  // Half of 300.000 ₫, not yet taken off an invoice.
  await expect(card.getByRole('row').filter({ hasText: /^BNK\// })).toContainText(/150\.000\s₫.*150\.000\s₫/)
})
