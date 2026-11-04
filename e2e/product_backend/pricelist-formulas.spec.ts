import type { Page } from '@playwright/test'
import {
  DESKTOP,
  addGridLine,
  expect,
  gridLine,
  quotationGrid,
  saveGridLines,
  settled,
  signIn,
  test,
} from './support.js'

// C19 (D30): a formula rule prices from another pricelist, marks up, rounds and adds a surcharge; a
// rule that would make a pricelist price from itself is refused, and so is stopping a pricelist
// another active one prices from.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const page_ = (page: Page) => page.locator('[data-ui="record-page"]')
const rules = (page: Page) => page_(page).getByRole('grid', { name: 'Quy tắc giá' })
// Cells of a rule row, in the grid's column order.
const DISCOUNT = 10
const ROUND = 11
const SURCHARGE = 12

/** Adds a rule for every product computed by formula on another pricelist, chosen by name. */
const addFormulaRule = async (page: Page, base: string, others: { offered: string[]; hidden: string }) => {
  await page_(page).getByRole('button', { name: 'Thêm quy tắc' }).click()
  await page
    .getByRole('listbox', { name: 'Áp dụng cho' })
    .getByRole('option', { name: 'Tất cả sản phẩm' })
    .click()
  // Tab passes the product, template, category and packaging cells a global rule keeps shut.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.getByRole('listbox', { name: 'Cách tính' }).getByRole('option', { name: 'Công thức' }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  // Only a formula starts from the cost.
  const bases = page.getByRole('listbox', { name: 'Tính trên' }).getByRole('option')
  await expect(bases).toHaveText(['Giá bán', 'Giá vốn', 'Bảng giá khác'])
  await bases.filter({ hasText: 'Bảng giá khác' }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  // Any other active pricelist, never this one.
  const lists = page.getByRole('listbox', { name: 'Bảng giá gốc' }).getByRole('option')
  for (const name of others.offered) await expect(lists.filter({ hasText: name })).toHaveCount(1)
  await expect(lists.filter({ hasText: others.hidden })).toHaveCount(0)
  await lists.filter({ hasText: base }).click()
}

test('a formula rule prices from another pricelist, marks up, rounds, then adds its surcharge', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/pricing/pricelists/markup')
  await expect(page_(page).getByRole('heading', { level: 1, name: 'Giá đại lý' })).toBeVisible()
  await settled(page)
  await addFormulaRule(page, 'Giá sỉ', { offered: ['Giá sỉ', 'Khuyến mãi lốc'], hidden: 'Giá đại lý' })
  const rule = rules(page).getByRole('row').filter({ hasText: 'Giá sỉ' })
  // A negative discount marks up.
  await rule.getByRole('gridcell').nth(DISCOUNT).dblclick()
  await page.keyboard.type('-15')
  await page.keyboard.press('Enter')
  // The rounding steps read as amounts.
  await rule.getByRole('gridcell').nth(ROUND).dblclick()
  const steps = page.getByRole('listbox', { name: 'Làm tròn' }).getByRole('option')
  await expect(steps).toHaveText(['Không làm tròn', '100', '1.000', '10.000'])
  await steps.filter({ hasText: /^10\.000$/ }).click()
  await rule.getByRole('gridcell').nth(SURCHARGE).dblclick()
  await page.keyboard.type('500')
  await page.keyboard.press('Enter')
  await page_(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(rules(page).locator('[data-unsaved="true"]')).toHaveCount(0)
  await page.reload()
  await expect(rule).toContainText('Công thức')
  await expect(rule).toContainText('Bảng giá khác')
  await expect(rule).toContainText('10.000')
  // A quotation on it: Giá sỉ has no rule for a single bottle, so a bottle starts from the list price,
  // 50.000 + 15% = 57.500, rounded to 60.000, plus 500.
  await page.goto('/admin/sales/quotations/quote-markup')
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  const water = { search: 'nuoc suoi loc', option: /^NSL Nước suối lốc/ }
  await addGridLine(page, water)
  // A pack of 4 starts from Giá sỉ's pack price: 180.000 + 15% = 207.000, rounded to 210.000; the
  // rule names no packaging, so its surcharge is per bottle: 4 × 500.
  await addGridLine(page, { ...water, unit: /^Lốc 4 cái/ })
  await saveGridLines(page)
  await expect(gridLine(page, /Cái/).filter({ hasNotText: /Lốc 4 cái/ })).toContainText('60500')
  await expect(gridLine(page, /Lốc 4 cái/)).toContainText('212000')
})

test('a rule that would make a pricelist price from itself is refused, naming its row', async ({ page }) => {
  // Giá cửa hàng already prices from Giá sỉ.
  await signIn(page, 'admin', '/admin/pricing/pricelists/wholesale')
  await expect(page_(page).getByRole('heading', { level: 1, name: 'Giá sỉ' })).toBeVisible()
  await settled(page)
  await addFormulaRule(page, 'Giá cửa hàng', { offered: ['Giá cửa hàng'], hidden: 'Giá sỉ' })
  await page_(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page_(page).locator('[data-ui="notice"]')).toContainText(
    'Dòng 2: Quy tắc tạo vòng bảng giá. Hãy chọn bảng giá gốc khác.',
  )
  // Nothing was written; the rule being added stays to be fixed.
  await expect(rules(page).locator('[data-unsaved="true"]')).not.toHaveCount(0)
  await page.reload()
  await expect(rules(page).getByRole('row').filter({ hasText: 'Giá cửa hàng' })).toHaveCount(0)
})

test('a pricelist another active pricelist prices from cannot be stopped', async ({ page }) => {
  await signIn(page, 'admin', '/admin/pricing/pricelists/wholesale')
  await settled(page)
  const active = page_(page).getByRole('checkbox', { name: 'Đang hoạt động' })
  await expect(active).toBeChecked()
  await active.uncheck()
  await page_(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page_(page)).toContainText('Bảng giá đang là giá gốc của một bảng giá còn dùng.')
  await page.reload()
  await expect(page_(page).getByRole('checkbox', { name: 'Đang hoạt động' })).toBeChecked()
})

test('an edit put back leaves the page unchanged: back to the list asks nothing', async ({ page }) => {
  await signIn(page, 'admin', '/admin/pricing/pricelists/promo')
  await settled(page)
  const name = page.getByRole('textbox', { name: 'Tên', exact: true })
  const before = await name.inputValue()
  await name.fill(before + ' mới')
  await name.fill(before)
  await name.blur()
  // The untouched rules grid counts as no change, so nothing asks to discard.
  await page_(page).getByRole('button', { name: 'Về danh sách' }).click()
  await expect(page).toHaveURL(/\/admin\/pricing\/pricelists$/)
  await expect(page.getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' })).toHaveCount(0)
})
