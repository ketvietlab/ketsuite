import type { Page } from '@playwright/test'
import {
  DESKTOP,
  MOBILE,
  fitsWidth,
  expect,
  gridLine,
  quotationGrid,
  saveGridLines,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// C21 (D31b), on the Commerce deployment, whose quotation writers recalculate benefits: every way to
// take money off a quotation sits in the Giảm giá menu next to the products: Giảm tay, Khuyến mãi, Nhập
// mã and Đổi điểm. The Ưu đãi và điểm block only reads; deleting a reward's row in the grid drops it.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const QUOTE = '/admin/sales/quotations/quote-benefits'
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const benefits = (page: Page) =>
  record(page)
    .locator('[data-ui="surface"]')
    .filter({ has: page.getByRole('heading', { name: 'Ưu đãi và điểm', exact: true }) })
const menu = async (page: Page) => {
  await record(page).getByRole('button', { name: 'Giảm giá', exact: true }).click()
  return page.getByRole('menuitem')
}
const choose = async (page: Page, item: string) => {
  await menu(page)
  await page.getByRole('menuitem', { name: item, exact: true }).click()
  return page.getByRole('dialog', { name: item })
}
const PROMOTION = 'Giảm 10% đơn từ 200.000'

test('a promotion applies by itself, leaves when its row is deleted and comes back from Khuyến mãi', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  // 360.000 before tax qualifies: the promotion's row takes 10% off.
  await expect(gridLine(page, PROMOTION)).toContainText('-36000')
  await expect(benefits(page)).toContainText(PROMOTION)
  // The applied table says what the reward gives, in the program list's words, not the name again.
  await expect(benefits(page).getByRole('cell', { name: 'Giảm 10% trên đơn', exact: true })).toBeVisible()
  // The block reads; nothing in it changes the quotation.
  await expect(benefits(page).getByRole('button')).toHaveCount(0)
  await expect(benefits(page).getByRole('link')).toHaveCount(0)
  // The promotion is on the quotation already, so the menu does not offer it.
  await expect(await menu(page)).toHaveText(['Giảm tay', 'Nhập mã', 'Đổi điểm'])
  await page.keyboard.press('Escape')
  // Deleting its row drops the promotion; a later save does not bring it back.
  await gridLine(page, PROMOTION).getByRole('gridcell').nth(1).click()
  await record(page).getByRole('button', { name: 'Xóa dòng' }).click()
  await saveGridLines(page)
  await expect(gridLine(page, PROMOTION)).toHaveCount(0)
  await expect(benefits(page)).not.toContainText(PROMOTION)
  await page.reload()
  await settled(page)
  await expect(gridLine(page, PROMOTION)).toHaveCount(0)
  // Khuyến mãi now offers it again.
  const dialog = await choose(page, 'Khuyến mãi')
  // Each choice names the program and what it gives; a promotion costs no points, so it says nothing of them.
  await expect(dialog).toContainText(`${PROMOTION} — Giảm 10% trên đơn`)
  await expect(dialog).not.toContainText(/điểm/i)
  await expect(dialog).not.toContainText('Thẻ thành viên')
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(gridLine(page, PROMOTION)).toContainText('-36000')
})

test('a code is checked where it is typed, then adds its row', async ({ page }) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  let dialog = await choose(page, 'Nhập mã')
  await dialog.getByLabel('Mã ưu đãi hoặc thẻ').fill('SAIMA')
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toContainText('Không tìm thấy mã này.')
  await expect(dialog.getByLabel('Mã ưu đãi hoặc thẻ')).toHaveValue('SAIMA')
  await dialog.getByLabel('Mã ưu đãi hoặc thẻ').fill('chaohe')
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(gridLine(page, 'Mã chào hè')).toContainText('-15000')
  await expect(benefits(page)).toContainText('Mã chào hè')
  // Deleting its row drops the code too.
  await gridLine(page, 'Mã chào hè').getByRole('gridcell').nth(1).click()
  await record(page).getByRole('button', { name: 'Xóa dòng' }).click()
  await saveGridLines(page)
  await expect(gridLine(page, 'Mã chào hè')).toHaveCount(0)
  dialog = await choose(page, 'Nhập mã')
  await expect(dialog.getByLabel('Mã ưu đãi hoặc thẻ')).toHaveValue('')
})

test('points buy a reward from Đổi điểm, held until the order is confirmed', async ({ page }) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  const dialog = await choose(page, 'Đổi điểm')
  // Đổi điểm lists the card's rewards, not the promotions.
  await expect(dialog).toContainText('Thẻ thành viên')
  await expect(dialog).toContainText('Thẻ thành viên — 50 điểm: Giảm 20.000 ₫ trên đơn')
  await expect(dialog).not.toContainText(PROMOTION)
  // Spent points are held, so this dialog says so.
  await expect(dialog).toContainText('Điểm tiêu được giữ chỗ')
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(gridLine(page, 'Thẻ thành viên')).toContainText('-20000')
  // Its 50 points are held for this quotation until it is confirmed.
  await expect(benefits(page)).toContainText(/Điểm thành viên đang giữ\s*50/)
  await expect(benefits(page).getByRole('row').filter({ hasText: 'Thẻ thành viên' }).first()).toBeVisible()
})

test('a spent card leaves the menu, unsaved lines hold a code back, and a reader has no menu', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await gridLine(page, 'Kem dưỡng').getByRole('gridcell').filter({ hasText: /^3$/ }).first().dblclick()
  await page.keyboard.type('4')
  await page.keyboard.press('Enter')
  // The points are spent on this quotation already, so Đổi điểm is gone; a code waits for the save.
  await expect(await menu(page)).toHaveText(['Giảm tay', 'Nhập mã'])
  await page.keyboard.press('Escape')
  const dialog = await choose(page, 'Nhập mã')
  await expect(dialog).toContainText('Lưu các thay đổi của báo giá trước khi thao tác ưu đãi.')
  await expect(dialog.getByLabel('Mã ưu đãi hoặc thẻ')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Áp dụng' })).toBeDisabled()
  await page.context().clearCookies()
  await signIn(page, 'reader', QUOTE)
  await expect(record(page).getByRole('heading', { level: 2, name: 'Sản phẩm' })).toBeVisible()
  await settled(page)
  await expect(benefits(page)).toContainText(PROMOTION)
  await expect(record(page).getByRole('button', { name: 'Giảm giá', exact: true })).toHaveCount(0)
})

test.describe('on a phone', () => {
  test.use({ viewport: MOBILE })
  test('the Giảm giá menu opens on the screen and its dialog takes the whole screen', async ({ page }) => {
    await signIn(page, 'admin', QUOTE)
    await expect(quotationGrid(page)).toBeVisible()
    await settled(page)
    const items = await menu(page)
    await expect(items.first()).toBeVisible()
    for (const item of await items.all()) {
      const box = (await item.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(MOBILE.width)
    }
    await fitsWidth(page)
    await page.getByRole('menuitem', { name: 'Nhập mã', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nhập mã' })
    await expect(dialog).toBeVisible()
    const box = (await dialog.boundingBox())!
    expect(Math.round(box.width)).toBe(MOBILE.width)
  })
})
