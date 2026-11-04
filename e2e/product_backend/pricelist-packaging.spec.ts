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

// C8 (P37): a pricelist rule may price one packaging of a variant; a quotation line sold in that
// packaging takes the rule's price for one package, a line in the base unit keeps its own price.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const page_ = (page: Page) => page.locator('[data-ui="record-page"]')

test('a rule for a variant chooses only that product’s packagings, and lists the packaging it prices', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/pricing/pricelists/promo')
  await expect(page_(page).getByRole('heading', { level: 1, name: 'Khuyến mãi lốc' })).toBeVisible()
  await settled(page)
  // A page, not a modal: its way out goes back to the list.
  await expect(page_(page).getByRole('button', { name: 'Về danh sách' })).toBeVisible()
  // The rules are a grid: a new rule takes its scope first, then only the cells that scope opens.
  const rules = page_(page).getByRole('grid', { name: 'Quy tắc giá' })
  await page_(page).getByRole('button', { name: 'Thêm quy tắc' }).click()
  // The scope names the mock's term for a category.
  const scope = page.getByRole('listbox', { name: 'Áp dụng cho' })
  await expect(scope.getByRole('option', { name: 'Nhóm sản phẩm' })).toHaveCount(1)
  await scope.getByRole('option', { name: 'Biến thể sản phẩm' }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('nuoc suoi loc')
  await page.getByRole('option', { name: /Nước suối lốc/ }).click()
  // Tab passes the template and category cells the scope keeps shut, to the packaging: only this
  // product's own packaging is offered.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  const units = page.getByRole('listbox', { name: 'Đóng gói' }).getByRole('option')
  await expect(units.filter({ hasText: /^Lốc 4 cái/ })).toHaveCount(1)
  await expect(units.filter({ hasText: /^Hộp|^Thùng|^Chai/ })).toHaveCount(0)
  await units.filter({ hasText: /^Lốc 4 cái/ }).click()
  const rule = rules.getByRole('row').filter({ hasText: 'Lốc 4 cái' })
  await rule.getByRole('gridcell').nth(9).dblclick()
  await page.keyboard.type('180000')
  await page.keyboard.press('Enter')
  await page_(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(rules.locator('[data-unsaved="true"]')).toHaveCount(0)
  await page.reload()
  await expect(rule).toContainText('Nước suối lốc')
  await expect(rule).toContainText('180.000')
})

// The quotation is a page of its own; its lines grid is on it.
const QUOTE = '/admin/sales/quotations/quote-wholesale'
const water = { search: 'nuoc suoi loc', option: /^NSL Nước suối lốc/ }

test('a quotation on that pricelist prices a package line by the rule, a unit line by the product', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await addGridLine(page, { ...water, unit: /^Lốc 4 cái/ })
  // The rule chose a packaging, so a line in the product's own unit keeps the list price.
  await addGridLine(page, water)
  await saveGridLines(page)
  // The rule's price is for one package, not four times it.
  const pack = gridLine(page, /Lốc 4 cái/)
  await expect(pack).toContainText('180000')
  await expect(pack).not.toContainText('720000')
  await expect(gridLine(page, /Cái/).filter({ hasNotText: /Lốc 4 cái/ })).toContainText('50000')
})
