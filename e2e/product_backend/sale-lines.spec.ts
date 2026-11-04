import type { Page } from '@playwright/test'
import { DESKTOP, expect, gridLine, recordReady, saveGridLines, settled, signIn, test } from './support.js'

// C17 (D24, D25): a line with only a description, the Require a product setting, and optional sections.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const recordPage = (page: Page) => page.locator('[data-ui="record-page"]')

test('a line with only a description is sold without a product, delivered never, invoiced as ordered', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-free')
  await recordReady(page, /^S\d+/)
  await settled(page)
  await recordPage(page).getByRole('button', { name: 'Thêm dòng' }).click()
  // No product: leave the picker and type the line's description instead.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Phí lắp đặt tại nhà')
  await page.keyboard.press('Enter')
  // Past the unit, which a line without a product leaves empty, to the quantity.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type('1')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('300000')
  await page.keyboard.press('Enter')
  await saveGridLines(page)
  const line = gridLine(page, 'Phí lắp đặt tại nhà')
  await expect(line).toContainText('300000')
  await expect(recordPage(page).getByRole('definition').filter({ hasText: '300.000' }).first()).toBeVisible()
  // Confirmed, it ships nothing and is to invoice for the quantity ordered.
  await settled(page)
  await recordPage(page).getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page).toHaveURL(/\/admin\/sales\/orders\/quote-free(\?|$)/)
  await recordReady(page, /^S\d+/)
  await expect(recordPage(page).getByRole('table', { name: 'Giao hàng' })).toHaveCount(0)
  await expect(recordPage(page).getByRole('definition').filter({ hasText: 'Chờ lập hoá đơn' })).toBeVisible()
  // It costs nothing, so all it sells for is margin.
  await expect(
    recordPage(page).getByRole('row').filter({ hasText: 'Phí lắp đặt tại nhà' }).last(),
  ).toContainText('300.000 ₫')
})

test('Require a product refuses to confirm a quotation with a free line, and names the line', async ({
  page,
  ui,
}) => {
  ui.allow(/Tư vấn tại chỗ/u, 'the refusal names the free line')
  await signIn(page, 'admin', '/admin/sales/configuration')
  await settled(page)
  const required = page.getByRole('checkbox', { name: 'Bắt buộc sản phẩm' })
  await expect(required).not.toBeChecked()
  await required.check()
  // Each tab of the configuration saves its own form (D20).
  await page
    .locator('form')
    .filter({ has: required })
    .getByRole('button', { name: 'Lưu', exact: true })
    .click()
  await expect(required).toBeChecked()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Bắt buộc sản phẩm' })).toBeChecked()
  try {
    await page.goto('/admin/sales/quotations/quote-required')
    await recordReady(page, /^S\d+/)
    await settled(page)
    await recordPage(page).getByRole('button', { name: 'Xác nhận' }).click()
    await expect(
      page.getByText('Dòng “Tư vấn tại chỗ” cần gắn sản phẩm trước khi xác nhận.').first(),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/sales\/quotations\/quote-required/)
  } finally {
    // The setting is the company's: the other specs confirm quotations too.
    await page.goto('/admin/sales/configuration')
    await settled(page)
    const again = page.getByRole('checkbox', { name: 'Bắt buộc sản phẩm' })
    await again.uncheck()
    await page
      .locator('form')
      .filter({ has: again })
      .getByRole('button', { name: 'Lưu', exact: true })
      .click()
    await page.reload()
    await expect(page.getByRole('checkbox', { name: 'Bắt buộc sản phẩm' })).not.toBeChecked()
  }
})

test('an optional section leaves its lines at no quantity, tagged, until the seller sets one', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-optional')
  await recordReady(page, /^S\d+/)
  await settled(page)
  const total = () => recordPage(page).getByRole('definition').filter({ hasText: /₫$/ })
  const choose = async (checked: boolean) => {
    await recordPage(page).getByRole('button', { name: 'Nhóm hàng tùy chọn' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nhóm hàng tùy chọn' })
    const box = dialog.getByRole('checkbox', { name: 'Phụ kiện kèm theo' })
    await (checked ? box.check() : box.uncheck())
    await dialog.getByRole('button', { name: 'Lưu các dòng' }).click()
    await expect(dialog).toBeHidden()
  }
  const section = gridLine(page, 'Phụ kiện kèm theo')
  const gift = gridLine(page, 'Khăn quà tặng')
  await expect(gift.getByRole('gridcell').nth(3)).toHaveText('2')
  await choose(true)
  // Its lines drop to no quantity and out of the total; the section says it is optional.
  await expect(gift.getByRole('gridcell').nth(3)).toHaveText('0')
  await expect(section.getByRole('gridcell').first()).toHaveAttribute('aria-description', 'Tùy chọn')
  await expect(total().filter({ hasText: '500.000' }).first()).toBeVisible()
  // The seller sets a quantity; choosing the same sections again keeps it.
  await gift.getByRole('gridcell').nth(3).dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('1')
  await page.keyboard.press('Enter')
  await saveGridLines(page)
  await choose(true)
  await expect(gift.getByRole('gridcell').nth(3)).toHaveText('1')
  // No longer optional, the section keeps the quantity and loses the tag.
  await choose(false)
  await expect(gift.getByRole('gridcell').nth(3)).toHaveText('1')
  await expect(section.getByRole('gridcell').first()).not.toHaveAttribute('aria-description', 'Tùy chọn')
  await expect(total().filter({ hasText: '550.000' }).first()).toBeVisible()
})

test('who only reads a quotation has no optional sections to choose', async ({ page }) => {
  await signIn(page, 'role-tenant-auditor', '/admin/sales/quotations/quote-optional')
  await recordReady(page, /^S\d+/)
  await expect(recordPage(page).getByText('Phụ kiện kèm theo').first()).toBeVisible()
  await expect(recordPage(page).getByRole('button', { name: 'Nhóm hàng tùy chọn' })).toHaveCount(0)
})
