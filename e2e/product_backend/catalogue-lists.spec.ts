import type { Page } from '@playwright/test'
import { DESKTOP, expect, fitsWidth, listReady, MOBILE, rowNames, settled, signIn, test } from './support.js'

// C5 (P12, P13, P16): the Products list priced "From" its cheapest selling variant and
// ordered as Vietnamese reads, the Variants list one row per SKU, and who sees costs.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const PRODUCTS = '/admin/product/templates'
const VARIANTS = '/admin/product/variants'
const variantTable = (page: Page) =>
  page.getByRole('region', { name: 'Biến thể sản phẩm' }).getByRole('table')
const variantsReady = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Biến thể sản phẩm' })).toBeVisible()
  await settled(page)
}
const variantRow = (page: Page, name: RegExp) => variantTable(page).getByRole('row', { name })

test('names sort as Vietnamese reads them: Á beside A, not after Z', async ({ page }) => {
  await signIn(page, 'admin', PRODUCTS)
  await listReady(page)
  // The default order is by name: "Áo choàng…" sits among the A's on the first page.
  const first = await rowNames(page)
  expect(first).toContain('Áo choàng bỏ cỡ')
  expect(first.indexOf('Áo choàng bỏ cỡ')).toBeLessThan(first.indexOf('Bông tẩy trang 120 miếng'))
  await page.getByRole('link', { name: 'Sản phẩm, sắp xếp giảm dần' }).click()
  await expect(page).toHaveURL(/sort=name%3Adesc/)
  await listReady(page)
  expect(await rowNames(page)).not.toContain('Áo choàng bỏ cỡ')
})

test('a product with variants is priced from its cheapest selling one and counts them', async ({ page }) => {
  await signIn(page, 'admin', `${PRODUCTS}?q=${encodeURIComponent('áo choàng chia')}`)
  await listReady(page)
  const row = page.locator('[data-product-list="true"] tbody tr').filter({ hasText: 'Áo choàng chia nhóm' })
  await expect(row).toContainText('Từ 250.000 ₫')
  await expect(row).toContainText('ACR')
  await expect(row.getByRole('cell').filter({ hasText: /^3$/ })).toHaveCount(1)
  // The mock's word for a category, on the list and on the product page alike.
  await expect(page.getByRole('columnheader', { name: 'Nhóm sản phẩm' })).toBeVisible()
  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Áo choàng chia nhóm' })).toBeVisible()
  await expect(page.getByText('Nhóm sản phẩm', { exact: true }).first()).toBeVisible()
})

test('the variants list shows one row per SKU with its values, prices, costs and stock', async ({ page }) => {
  await signIn(page, 'admin', VARIANTS)
  await variantsReady(page)
  const headers = variantTable(page).getByRole('columnheader')
  for (const name of ['Sản phẩm', 'Mã nội bộ', 'Barcode', 'Giá bán', 'Giá vốn', 'Tồn thực tế', 'Khả dụng'])
    await expect(headers.filter({ hasText: name })).toHaveCount(1)

  // Search covers codes, barcodes, names and attribute values, folding accents.
  const search = page.getByRole('searchbox', { name: 'Tìm biến thể' })
  await search.fill('ACD')
  await expect(page).toHaveURL(/q=ACD/)
  await expect(variantTable(page).getByRole('row')).toHaveCount(4)
  await expect(variantRow(page, /^Áo choàng bỏ cỡ M ACDA/)).toContainText('4')
  await expect(variantRow(page, /^Áo choàng bỏ cỡ L ACDB/)).toContainText('280.000 ₫')
  await search.fill('serum b5')
  await expect(variantRow(page, /^Serum B5 phục hồi 30ml/)).toContainText('150.000 ₫')
  await search.fill('cotton')
  await expect(variantRow(page, /^Khăn mặt hai chất liệu Cotton/)).toBeVisible()

  // A row opens its product, and Back returns to the same search.
  await variantTable(page).getByRole('link', { name: 'Khăn mặt hai chất liệu Cotton' }).click()
  await expect(page).toHaveURL(/\/admin\/product\/templates\/towel-face\b/)
  await expect(page.getByRole('heading', { level: 1, name: 'Khăn mặt hai chất liệu' })).toBeVisible()
  await page.goBack()
  await variantsReady(page)
  await expect(page.getByRole('searchbox', { name: 'Tìm biến thể' })).toHaveValue('cotton')
})

test('the variants list filters by type and status and sorts by code', async ({ page }) => {
  await signIn(page, 'admin', VARIANTS)
  await variantsReady(page)
  await page.getByRole('link', { name: 'Mã nội bộ, sắp xếp tăng dần' }).click()
  await expect(page).toHaveURL(/sort=code/)
  // SKUs without a code come after the coded ones, whichever way the column sorts.
  await expect(variantTable(page).getByRole('row').nth(1).getByRole('cell').nth(1)).not.toHaveText('—')
  await page.getByRole('link', { name: 'Mã nội bộ, sắp xếp giảm dần' }).click()
  await expect(page).toHaveURL(/dir=desc/)
  await expect(variantTable(page).getByRole('row').nth(1).getByRole('cell').nth(1)).not.toHaveText('—')
  await page.getByRole('button', { name: /^Loại:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Dịch vụ' }).click()
  await expect(page).toHaveURL(/type=service/)
  for (const row of await variantTable(page).getByRole('row').all())
    await expect(row).not.toContainText('Áo choàng')
  await page.getByRole('link', { name: /^Ngừng bán/ }).click()
  await expect(page).toHaveURL(/status=archived/)
})

for (const [login, label, cost] of [
  ['bookkeeper', 'Kế toán', true],
  ['role-sales-representative', 'Nhân viên bán hàng', true],
  ['role-warehouse-operator', 'Thủ kho', false],
] as const)
  test(`costs on the variants list: ${label} ${cost ? 'sees them' : 'does not'} (P16)`, async ({ page }) => {
    await signIn(page, login, VARIANTS)
    await variantsReady(page)
    const headers = variantTable(page).getByRole('columnheader')
    await expect(headers.filter({ hasText: 'Giá vốn' })).toHaveCount(cost ? 1 : 0)
    await expect(headers.filter({ hasText: 'Giá bán' })).toHaveCount(1)
  })

test('the Product menu lists Products, Variants, Attributes and Units, marking the one open', async ({
  page,
}) => {
  await signIn(page, 'admin', VARIANTS)
  await variantsReady(page)
  const items = page.locator('a[data-ui="navigation-item"]')
  await expect(items.and(page.locator('[aria-current="page"]'))).toHaveText('Biến thể')
  for (const [name, href] of [
    ['Sản phẩm', PRODUCTS],
    ['Biến thể', VARIANTS],
    ['Thuộc tính', '/admin/product/attributes'],
    ['Đơn vị tính', '/admin/product/uoms'],
  ])
    await expect(items.filter({ hasText: new RegExp(`^${name}$`) })).toHaveAttribute('href', href)
})

test.describe('in English on a phone', () => {
  test.use({ viewport: MOBILE, locale: 'en-US' })

  test('the variants list reads in English and fits', async ({ page }) => {
    await signIn(page, 'admin', `${VARIANTS}?lang=en`, 'en')
    await expect(page.getByRole('heading', { level: 1, name: 'Product variants' })).toBeVisible()
    await settled(page)
    await expect(page.getByRole('searchbox', { name: 'Search variants' })).toBeVisible()
    await fitsWidth(page)
  })
})
