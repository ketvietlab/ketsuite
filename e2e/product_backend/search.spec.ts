import type { Page } from '@playwright/test'
import { DESKTOP, expect, listReady, settled, signIn, test } from './support.js'

// C15 (P57, P58): the top bar opens one search across the catalogue lists, archived records stay
// out, each result opens where its own list would, and an old modal bookmark reaches the page.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const SEARCH = '/admin/product/search'
const results = (page: Page) => page.locator('main table tbody tr')
const result = (page: Page, name: string, kind: string) =>
  results(page).filter({ hasText: name }).filter({ hasText: kind })
const search = async (page: Page, q: string) => {
  await page.getByRole('searchbox', { name: 'Tên, mã hoặc barcode' }).fill(q)
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(q).replace(/%20/g, '(\\+|%20)')}`))
  await settled(page)
}

test('the top bar opens one search over products, SKUs and the catalogue around them', async ({ page }) => {
  await signIn(page)
  await listReady(page)
  await page.getByRole('link', { name: 'Tìm trong Sản phẩm' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tìm trong Sản phẩm' })).toBeVisible()
  await settled(page)
  // Nothing has been looked for yet, so nothing is "not found".
  await expect(page.getByRole('main')).toContainText('Tìm theo tên, mã hoặc barcode')
  await expect(page.getByRole('main')).not.toContainText('Không có kết quả')

  await search(page, 'Dung tích')
  await expect(result(page, 'Gel rửa mặt hai dung tích', 'Sản phẩm')).toHaveCount(1)
  const skus = result(page, 'Gel rửa mặt hai dung tích', 'Biến thể / SKU')
  await expect(skus).toHaveCount(2)
  // Each SKU reads with its own values, so the two are told apart.
  const first = await skus.nth(0).locator('td').first().innerText()
  const second = await skus.nth(1).locator('td').first().innerText()
  expect(first).toMatch(/^Gel rửa mặt hai dung tích · /)
  expect(second).not.toEqual(first)
  await expect(result(page, 'Dung tích', 'Thuộc tính')).toHaveCount(1)
  await search(page, 'Hộp 6')
  await expect(result(page, 'Hộp 6 cái', 'Đơn vị tính')).toHaveCount(1)
  await search(page, 'Bán chạy')
  await expect(result(page, 'Bán chạy', 'Thẻ')).toHaveCount(1)

  // Archived records stay out, as on their list.
  await search(page, 'Mặt nạ ngừng bán')
  await expect(results(page)).toHaveCount(0)
  await expect(page.getByRole('main')).toContainText('Không có kết quả')
})

test('a list filter carried into the search does not narrow it', async ({ page }) => {
  await signIn(page, 'admin', `${SEARCH}?q=Dung+t%C3%ADch`)
  await settled(page)
  const plain = await results(page).allInnerTexts()
  await page.goto(`${SEARCH}?q=Dung+t%C3%ADch&preset=notSold&status=archived`)
  await settled(page)
  expect(await results(page).allInnerTexts()).toEqual(plain)
})

test('a SKU opens its product page and a configuration record opens its modal on its list', async ({
  page,
}) => {
  await signIn(page, 'admin', `${SEARCH}?q=Gel+r%E1%BB%ADa`)
  await settled(page)
  await result(page, 'Gel rửa mặt hai dung tích', 'Biến thể / SKU').first().click()
  await expect(page).toHaveURL(/\/admin\/product\/templates\/[^/?]+/)
  await expect(page.getByRole('heading', { level: 1, name: 'Gel rửa mặt hai dung tích' })).toBeVisible()

  await page.goto(`${SEARCH}?q=H%E1%BB%99p+6`)
  await settled(page)
  await result(page, 'Hộp 6 cái', 'Đơn vị tính').click()
  await expect(page).toHaveURL(/\/admin\/product\/uoms.*record=/)
  const unit = page.getByRole('dialog', { name: 'Sửa đơn vị tính' })
  await expect(unit).toBeVisible()
  await expect(unit.getByRole('textbox', { name: /Tên/ }).first()).toHaveValue('Hộp 6 cái')
})

test('an old product modal bookmark reaches the product page, and back goes to the list', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/product/templates?record=product.template:skin-check')
  await expect(page).toHaveURL(/\/admin\/product\/templates\/skin-check\?/)
  await expect(page.getByRole('heading', { level: 1, name: 'Dịch vụ soi da' })).toBeVisible()
  await settled(page)
  await page.getByRole('button', { name: 'Về danh sách', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/product\/templates(\?|$)/)
  await listReady(page)
})
