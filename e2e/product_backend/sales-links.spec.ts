import type { Page } from '@playwright/test'
import {
  DESKTOP,
  addGridLine,
  expect,
  gridLine,
  quotationGrid,
  recordReady,
  saveGridLines,
  settled,
  signIn,
  test,
} from './support.js'

// C6 (P24, P29, P32): a quotation line picks a variant by its full name, stock rows and lots
// open the product they hold, and the product's Sold card opens its sales by variant.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

// A quotation is a page of its own; who may edit its lines does so in a grid on it (D33b), who
// may only read them reads a table.
const QUOTE = '/admin/sales/quotations/quote-picker'
const quoteLines = (page: Page) =>
  page.locator('[data-ui="record-page"]').getByRole('table', { name: 'Sản phẩm' })
const lineRow = (page: Page, name: string) => quoteLines(page).getByRole('row').filter({ hasText: name })

test('a quotation line picks a variant by its full name, accents optional, sizes in order', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('ao choang bo')
  const options = page.getByRole('listbox', { name: 'Sản phẩm' }).getByRole('option')
  await expect(options).toHaveText([/Áo choàng bỏ cỡ S/, /Áo choàng bỏ cỡ M/, /Áo choàng bỏ cỡ L/])
  await options.filter({ hasText: /Áo choàng bỏ cỡ M/ }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.getByRole('listbox', { name: 'Đơn vị tính' }).getByRole('option', { name: /^Cái/ }).click()
  await saveGridLines(page)
  await expect(gridLine(page, 'Áo choàng bỏ cỡ M')).toHaveCount(1)
  await expect(gridLine(page, 'Áo choàng bỏ cỡ M')).toContainText('Cái')
  // The line went straight onto the quotation: no dialog in between.
  await expect(page.getByRole('dialog', { name: 'Thêm dòng' })).toHaveCount(0)
})

test('a grid line left without a unit sells in the product unit', async ({ page }) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  await addGridLine(page, { search: 'ao choang da ban', option: /Áo choàng đã bán S/, quantity: '3' })
  await saveGridLines(page)
  const small = gridLine(page, 'Áo choàng đã bán S')
  await expect(small).toHaveCount(1)
  await expect(small).toContainText('Cái')
  await expect(small).toContainText('3')
})

test('a negative quantity is refused in its cell, in words, and nothing is saved', async ({ page }) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  const small = gridLine(page, 'Áo choàng đã bán S')
  await small.getByRole('gridcell').nth(3).dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('-2')
  await page.keyboard.press('Enter')
  await expect(small.getByRole('gridcell').nth(3)).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('[data-ui="record-page"]').getByText('Tối thiểu 0').first()).toBeVisible()
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Lưu các dòng' }).click()
  await expect(quotationGrid(page)).not.toContainText('sale.error')
  await page.reload()
  await expect(gridLine(page, 'Áo choàng đã bán S')).toContainText('3')
})

test('who may read quotations but not edit lines reads the table without the add row', async ({ page }) => {
  await signIn(page, 'role-tenant-auditor', QUOTE)
  await expect(quoteLines(page)).toBeVisible()
  await settled(page)
  await expect(lineRow(page, 'Áo choàng bỏ cỡ M')).toHaveCount(1)
  await expect(quotationGrid(page)).toHaveCount(0)
  await expect(quoteLines(page).getByRole('button', { name: 'Thêm dòng' })).toHaveCount(0)
  await expect(quoteLines(page).getByRole('spinbutton')).toHaveCount(0)
})

test('a stock row and a lot open the product page they belong to', async ({ page, ui }) => {
  ui.allow(/^last screen alert: Hết hàng/u, 'the sunscreen tracks lots and has none on hand')
  await signIn(page, 'admin', '/admin/stock/inventory')
  const row = page.getByRole('row').filter({ hasText: 'ACDA' })
  await expect(row.getByRole('link', { name: /Áo choàng bỏ cỡ/ })).toHaveAttribute(
    'href',
    /\/admin\/product\/templates\/robe-drop\b/,
  )
  await row.getByRole('link', { name: /Áo choàng bỏ cỡ/ }).click()
  await recordReady(page, 'Áo choàng bỏ cỡ')

  await page.goto('/admin/stock/lots?record=stock.lot%3Alot-seeded')
  await expect(page.getByRole('heading', { name: 'KCN-250601' }).first()).toBeVisible()
  const product = page.getByRole('dialog', { name: 'KCN-250601' }).getByRole('link', { name: 'Mở sản phẩm' })
  await expect(product).toHaveAttribute('href', /\/admin\/product\/templates\/sunscreen-quote\b/)
  await product.click()
  await recordReady(page, 'Kem chống nắng có báo giá')
})

test('the Sold card opens the sales by variant, and a variant opens its orders', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/robe-sold')
  await recordReady(page, 'Áo choàng đã bán')
  // Two confirmed orders sold four; the quotation sold nothing yet.
  const sold = page.getByRole('link', { name: /Đã bán 30 ngày/ })
  await expect(sold).toContainText('4')
  await expect(sold).toContainText('2 đơn')
  await sold.click()
  await expect(page).toHaveURL(/\/admin\/sales\/analysis\?templateId=robe-sold/)
  await expect(page.getByRole('heading', { level: 1, name: 'Phân tích bán hàng' })).toBeVisible()
  await expect(page.getByText('Áo choàng đã bán · 30 ngày gần đây')).toBeVisible()
  const small = page.getByRole('row').filter({ hasText: 'Áo choàng đã bán S' })
  await expect(small).toContainText('3')
  await expect(page.getByRole('row').filter({ hasText: 'Áo choàng đã bán L' })).toHaveCount(0)
  await small.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/admin\/sales\/orders\?productId=/)
  const orders = page.getByRole('row').filter({ hasText: /S0000\d/ })
  await expect(orders).toHaveCount(2)
})
