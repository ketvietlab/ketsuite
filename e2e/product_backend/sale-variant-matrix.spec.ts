import type { Locator, Page } from '@playwright/test'
import { DESKTOP, expect, gridLine, recordReady, settled, signIn, test } from './support.js'

// C18 (D28): a product sold through a quantity grid is entered from Choose variants on the lines card.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const ROBE = 'Áo choàng nhập lưới'
const open = async (page: Page) => {
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Chọn biến thể' }).click()
  await page.getByRole('menuitem', { name: ROBE }).click()
  const dialog = page.getByRole('dialog', { name: `Chọn biến thể · ${ROBE}` })
  await expect(dialog).toBeVisible()
  return dialog
}
// Columns of the dialog's grid: the size, its unit, price, the quantity and its amount.
const QUANTITY = 3
const AMOUNT = 4
const sizeRow = (dialog: Locator, value: string) =>
  dialog
    .getByRole('grid', { name: ROBE })
    .getByRole('row')
    .filter({ has: dialog.page().getByRole('gridcell', { name: value, exact: true }) })
const quantity = (dialog: Locator, value: string) =>
  sizeRow(dialog, value).getByRole('gridcell').nth(QUANTITY)
const type = async (dialog: Locator, value: string, text: string) => {
  await quantity(dialog, value).dblclick()
  await dialog.page().keyboard.press('ControlOrMeta+a')
  await dialog.page().keyboard.type(text)
  await dialog.page().keyboard.press('Enter')
}

test('the quantity grid adds a line per size, and a cleared size takes its line away', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-matrix')
  await recordReady(page, /^S\d+/)
  await settled(page)
  let dialog = await open(page)
  // A row per size in its own order, with its price; the quantity is the one cell to edit, in the DS grid.
  await expect(dialog.locator('input:visible')).toHaveCount(0)
  await expect(dialog.getByRole('grid', { name: ROBE }).getByRole('row')).toHaveText([
    /Kích cỡ áo.*Đơn giá.*Số lượng.*Thành tiền/,
    /^S.*300\.000/,
    /^M.*300\.000/,
    /^L.*330\.000/,
    /^Tổng\s*0$/,
  ])
  await expect(sizeRow(dialog, 'M').getByRole('gridcell').nth(2)).toHaveAttribute('aria-readonly', 'true')
  await type(dialog, 'S', '2')
  await type(dialog, 'L', '1')
  await expect(sizeRow(dialog, 'S').getByRole('gridcell').nth(AMOUNT)).toContainText('600.000')
  // The footer sums the amounts: two S at 300.000 and one L at 330.000.
  await expect(dialog.getByRole('grid', { name: ROBE }).getByRole('row').last()).toContainText('930.000')
  await dialog.getByRole('button', { name: 'Lưu số lượng' }).click()
  await expect(dialog).toBeHidden()
  await expect(gridLine(page, `${ROBE} S`).getByRole('gridcell').nth(3)).toHaveText('2')
  await expect(gridLine(page, `${ROBE} L`).getByRole('gridcell').nth(3)).toHaveText('1')
  await expect(gridLine(page, `${ROBE} M`)).toHaveCount(0)
  // Opened again it shows what the order holds; a cleared size removes its line, the other stays.
  dialog = await open(page)
  await expect(quantity(dialog, 'S')).toHaveText('2')
  await quantity(dialog, 'S').click()
  await page.keyboard.press('Delete')
  await dialog.getByRole('button', { name: 'Lưu số lượng' }).click()
  await expect(dialog).toBeHidden()
  await expect(gridLine(page, `${ROBE} S`)).toHaveCount(0)
  await expect(gridLine(page, `${ROBE} L`).getByRole('gridcell').nth(3)).toHaveText('1')
})

test('a product switched to the quantity grid on its page is offered under Choose variants', async ({
  page,
}) => {
  // Picked inline on the line, it is not one of the quantity grids yet.
  await signIn(page, 'admin', '/admin/sales/quotations/quote-matrix')
  await recordReady(page, /^S\d+/)
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Chọn biến thể' }).click()
  await expect(page.getByRole('menuitem', { name: ROBE })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Áo choàng đổi cách chọn' })).toHaveCount(0)
  await page.goto('/admin/product/templates/robe-mode')
  await recordReady(page, 'Áo choàng đổi cách chọn')
  await settled(page)
  const mode = page.getByRole('combobox', { name: 'Chọn biến thể khi bán' })
  await expect(mode).toHaveValue('inline')
  await mode.selectOption({ label: 'Lưới số lượng' })
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Chọn biến thể khi bán' })).toHaveValue('matrix')
  await page.goto('/admin/sales/quotations/quote-matrix')
  await recordReady(page, /^S\d+/)
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Chọn biến thể' }).click()
  await expect(page.getByRole('menuitem', { name: 'Áo choàng đổi cách chọn' })).toBeVisible()
})
