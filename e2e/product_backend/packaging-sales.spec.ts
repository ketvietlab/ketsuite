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

// C7 (P36a): a quotation line sells in the product's unit or one of its packagings, priced for it.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

// A quotation is a page of its own; its lines grid is on it, not in a dialog.
const QUOTE = '/admin/sales/quotations/quote-pack'
const water = { search: 'nuoc suoi loc', option: /^NSL Nước suối lốc/ }

test('a quotation line sells in a packaging of the product, priced for it', async ({ page }) => {
  await signIn(page, 'admin', QUOTE)
  await expect(quotationGrid(page)).toBeVisible()
  await settled(page)
  // Only the product's own unit and its packaging: no other unit of the family, nor another family.
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type(water.search)
  await page.getByRole('option', { name: water.option }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  const units = page.getByRole('listbox', { name: 'Đơn vị tính' }).getByRole('option')
  await expect(units).toHaveText([/^Cái/, /^Lốc 4 cái/])
  await units.filter({ hasText: /^Lốc 4 cái/ }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  // Left empty, the unit is the product's own, at its own price.
  await addGridLine(page, water)
  await saveGridLines(page)
  // One pack of four at the list price of one each.
  const pack = gridLine(page, /Lốc 4 cái/)
  await expect(pack).toContainText('Nước suối lốc')
  await expect(pack).toContainText('200000')
  const each = gridLine(page, /Cái/).filter({ hasNotText: /Lốc 4 cái/ })
  await expect(each).toContainText('Nước suối lốc')
  await expect(each).toContainText('50000')
})
