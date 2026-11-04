import type { Page } from '@playwright/test'
import { DESKTOP, expect, gridLine, recordReady, settled, signIn, test } from './support.js'

// C18 (D27): an order's catalogue page adds and changes its lines; who only reads sees it read-only.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const QUOTE = '/admin/sales/quotations/quote-catalogue'
const SERUM = 'Serum B5 phục hồi 30ml'
const card = (page: Page, name: string) =>
  page.locator('[data-island="sale.catalogue"] [data-ui="content-card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  })

test('the catalogue adds a variant to the order and changes its quantity, then returns to the order', async ({
  page,
}) => {
  await signIn(page, 'admin', QUOTE)
  await recordReady(page, /^S\d+/)
  await settled(page)
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Danh mục' }).click()
  await expect(page).toHaveURL(/\/admin\/sales\/catalogue\/quote-catalogue/)
  // Searched without accents; the filter stays in the address.
  await page.getByRole('textbox', { name: 'Tìm tên, mã hoặc barcode' }).fill('serum b5')
  await page.getByRole('button', { name: 'Lọc', exact: true }).click()
  await expect(page).toHaveURL(/search=serum\+b5/)
  const serum = card(page, SERUM)
  await expect(serum).toContainText('350.000 ₫')
  await serum.getByRole('button', { name: 'Thêm' }).click()
  const quantity = serum.getByRole('textbox', { name: `Số lượng · ${SERUM}` })
  await expect(quantity).toHaveValue('1')
  await serum.getByRole('button', { name: `Tăng số lượng · ${SERUM}` }).click()
  await expect(quantity).toHaveValue('2')
  await page.getByRole('link', { name: 'Về đơn bán' }).click()
  await recordReady(page, /^S\d+/)
  await expect(gridLine(page, SERUM).getByRole('gridcell').nth(3)).toHaveText('2')
  // Down to nothing, the line goes.
  await page.goBack()
  await expect(quantity).toHaveValue('2')
  await serum.getByRole('button', { name: `Giảm số lượng · ${SERUM}` }).click()
  await serum.getByRole('button', { name: `Giảm số lượng · ${SERUM}` }).click()
  await expect(serum.getByRole('button', { name: 'Thêm' })).toBeVisible()
  await page.getByRole('link', { name: 'Về đơn bán' }).click()
  await recordReady(page, /^S\d+/)
  await expect(gridLine(page, SERUM)).toHaveCount(0)
})

test("the catalogue lists a product's variants in the order of their values, as the line picker does", async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/catalogue/quote-catalogue?search=ao+choang+bo')
  await expect(page.locator('[data-island="sale.catalogue"]').getByRole('heading', { level: 3 })).toHaveText([
    'Áo choàng bỏ cỡ S',
    'Áo choàng bỏ cỡ M',
    'Áo choàng bỏ cỡ L',
  ])
})

test('who only reads the order sees its catalogue without changing it', async ({ page }) => {
  await signIn(page, 'role-tenant-auditor', '/admin/sales/catalogue/quote-catalogue?search=serum')
  await expect(page.getByText('Đơn này chỉ xem danh mục.')).toBeVisible()
  await expect(card(page, SERUM)).toContainText('350.000 ₫')
  await expect(card(page, SERUM).getByRole('button')).toHaveCount(0)
})
