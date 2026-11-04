import type { Page } from '@playwright/test'
import { DESKTOP, expect, gridLine, quotationGrid, settled, signIn, test } from './support.js'

// C20 (D31a): Giảm tay, under the quotation's Giảm giá menu, takes a percentage or an untaxed amount
// off the order as one discount line per tax, or puts a percentage in every sales line's discount column.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const QUOTE = '/admin/sales/quotations/quote-discount'
const page_ = (page: Page) => page.locator('[data-ui="record-page"]')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Giảm tay' })
const openManual = async (page: Page) => {
  await page_(page).getByRole('button', { name: 'Giảm giá', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Giảm tay' }).click()
}
const discountLines = (page: Page) => gridLine(page, 'Chiết khấu đơn hàng')

const applyDiscount = async (page: Page, mode: string, value: string) => {
  await openManual(page)
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByLabel('Giá trị')).toHaveAttribute('inputmode', 'decimal')
  await dialog(page).getByLabel('Cách giảm').selectOption({ label: mode })
  await dialog(page).getByLabel('Giá trị').fill(value)
  await dialog(page).getByRole('button', { name: 'Áp dụng' }).click()
}

test('a percentage off the order becomes a discount line per tax, and a new discount replaces it', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  // 300.000 under 10% and 100.000 under 5%: 10% off is 30.000 and 10.000.
  await applyDiscount(page, 'Phần trăm trên đơn', '10')
  await expect(dialog(page)).toHaveCount(0)
  await expect(discountLines(page)).toHaveCount(2)
  await expect(discountLines(page).filter({ hasText: 'VAT 10%' })).toContainText('-30000')
  await expect(discountLines(page).filter({ hasText: 'VAT 5%' })).toContainText('-10000')
  // 20.000 before tax replaces it, shared 3 : 1.
  await applyDiscount(page, 'Số tiền trước thuế', '20000')
  await expect(discountLines(page)).toHaveCount(2)
  await expect(discountLines(page).filter({ hasText: 'VAT 10%' })).toContainText('-15000')
  await expect(discountLines(page).filter({ hasText: 'VAT 5%' })).toContainText('-5000')
  // A discount line is not edited by hand: its cells stay read-only.
  for (const cell of await discountLines(page).first().getByRole('gridcell').all()) {
    const editable = await cell.getAttribute('aria-readonly')
    if (editable !== null) expect(editable).toBe('true')
  }
  // More than the goods is refused in the dialog, which stays open with the value; nothing changes.
  await applyDiscount(page, 'Số tiền trước thuế', '500000')
  await expect(dialog(page).getByRole('textbox', { name: 'Giá trị' })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog(page)).toContainText('Khoản giảm không được vượt tiền hàng trước thuế.')
  await expect(discountLines(page).filter({ hasText: 'VAT 10%' })).toContainText('-15000')
  // Zero takes the order discount off.
  await dialog(page).getByRole('textbox', { name: 'Giá trị' }).fill('0')
  await dialog(page).getByRole('button', { name: 'Áp dụng' }).click()
  await expect(discountLines(page)).toHaveCount(0)
})

test('a percentage for each line goes in every sales line’s discount column', async ({ page }) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await applyDiscount(page, 'Phần trăm cho từng dòng', '5')
  await expect(dialog(page)).toHaveCount(0)
  for (const name of [/Sữa rửa mặt tạo bọt|SRM/, /Túi quà vải|TQV/])
    await expect(gridLine(page, name)).toContainText('5%')
  await expect(discountLines(page)).toHaveCount(0)
})

test('the dialog asks to save first when the quotation has unsaved edits, and a viewer has no button', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await gridLine(page, /Túi quà vải|TQV/)
    .getByRole('gridcell')
    .filter({ hasText: /^2$/ })
    .first()
    .dblclick()
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await openManual(page)
  await expect(dialog(page)).toContainText('Lưu các thay đổi của báo giá trước khi giảm giá.')
  // Nothing to fill until the edits are saved.
  await expect(dialog(page).getByLabel('Giá trị')).toHaveCount(0)
  await expect(dialog(page).getByRole('button', { name: 'Áp dụng' })).toBeDisabled()
  await page.context().clearCookies()
  await signIn(page, 'role-tenant-auditor', QUOTE)
  // A viewer reads the lines as a table, not a grid.
  await expect(page_(page).getByRole('heading', { level: 2, name: 'Sản phẩm' })).toBeVisible()
  await settled(page)
  await expect(page_(page).getByRole('button', { name: 'Giảm giá', exact: true })).toHaveCount(0)
})
