import type { Page } from '@playwright/test'
import {
  DESKTOP,
  MOBILE,
  evidence,
  expect,
  fitsWidth,
  recordReady,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// C11 (P48–P50), on the Commerce deployment: a product's suppliers in the order they are tried,
// who sees their prices, a partner that only supplies kept out of a sale's customers, and a
// supplier replenishment rule that names the supplier the quantity selects and asks it for a quotation
// that purchasing finds among the stock demands (#1737).

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const PADS = '/admin/product/templates/pads'
const suppliers = (page: Page) => page.getByRole('grid', { name: 'Nhà cung cấp' })

test('a product lists its suppliers in the order they are tried, suppliers first in its picker', async ({
  page,
  ui,
}) => {
  ui.allow(/alert: Hết hàng/, 'the product has no stock yet: that is what replenishment is for')
  await signIn(page, 'admin', PADS)
  await recordReady(page, 'Bông tẩy trang 120 miếng')
  await settled(page)
  const rows = suppliers(page).getByRole('row')
  await expect(rows.nth(1)).toContainText('Công ty CP Hóa mỹ phẩm Đông Á')
  await expect(rows.nth(1)).toContainText('17200')
  await expect(rows.nth(2)).toContainText('Công ty TNHH Bông Sen Việt')
  await expect(suppliers(page).getByRole('columnheader', { name: /Giá mua/ })).toBeVisible()
  // A new row's partner: the company's suppliers come before its other partners. The packaging
  // grid above has an add button of its own.
  await page.locator('[id^="product-supplier-grid"]').getByRole('button', { name: 'Thêm dòng' }).click()
  const offered = page.getByRole('listbox').last().getByRole('option')
  await expect(offered.first()).toBeVisible()
  const names = await offered.allTextContents()
  expect(names.slice(0, 2).sort()).toEqual(['Công ty CP Hóa mỹ phẩm Đông Á', 'Công ty TNHH Bông Sen Việt'])
  expect(names).toContain('Spa Hoa Mai')
})

test('a warehouse operator reads the suppliers without their purchase prices', async ({ page, ui }) => {
  ui.allow(/alert: Hết hàng/, 'the product has no stock yet: that is what replenishment is for')
  await signIn(page, 'thukho', PADS)
  await recordReady(page, 'Bông tẩy trang 120 miếng')
  await settled(page)
  await expect(suppliers(page)).toContainText('Công ty TNHH Bông Sen Việt')
  await expect(suppliers(page).getByRole('columnheader', { name: /Giá mua/ })).toHaveCount(0)
  await expect(suppliers(page)).not.toContainText('17200')
})

test('a quotation’s customer picker leaves out a partner that only supplies', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations/new')
  await settled(page)
  await page.getByRole('button', { name: 'Khách hàng' }).click()
  const search = page.getByRole('searchbox').last()
  // "Công ty" names both suppliers; neither is offered. (Partner search matches accents as typed.)
  await search.fill('Công ty')
  await expect(page.getByText('Chưa có bản ghi nào.').last()).toBeVisible()
  await expect(page.getByRole('option', { name: /Đông Á|Bông Sen/ })).toHaveCount(0)
  // A customer, and a partner nobody has bought from or sold to yet, are.
  await search.fill('spa')
  await expect(page.getByRole('option', { name: /Spa Hoa Mai/ })).toBeVisible()
  await search.fill('Cửa hàng')
  await expect(page.getByRole('option', { name: /Cửa hàng Mới Mở/ })).toBeVisible()
})

const pick = async (page: Page, field: string, typed: string, option: RegExp) => {
  await page.getByRole('button', { name: field, exact: true }).click()
  await page.keyboard.type(typed)
  await page.getByRole('option', { name: option }).first().click()
}
const newRule = async (page: Page, product: string, code: string) => {
  await signIn(page, 'admin', '/admin/stock/replenishment/new')
  await settled(page)
  // Typed without accents, as people do: the picker folds them, and lists only that product.
  await page.getByRole('button', { name: 'Sản phẩm', exact: true }).click()
  await page.keyboard.type(product)
  const offered = page.locator('[id$="productId-relation-menu"]').getByRole('option')
  await expect(offered).toHaveCount(1)
  await offered.filter({ hasText: code }).click()
  await pick(page, 'Kho hàng', 'kho', /Kho Hồ Chí Minh/)
  // K10: the warehouse's own stock location reads in the reader's language.
  await pick(page, 'Vị trí', 'ton kho', /Tồn kho/)
  await page.getByRole('spinbutton', { name: 'Tồn tối thiểu' }).fill('100')
  await page.getByRole('spinbutton', { name: 'Tồn tối đa' }).fill('300')
  // The route's lead time is a number; a supplier's may stay empty.
  await expect(page.getByRole('spinbutton', { name: 'Thời gian chờ (ngày)' })).toHaveValue('0')
  await page.getByRole('combobox', { name: 'Nguồn hàng' }).selectOption({ label: 'Nhà cung cấp' })
  await expect(page.getByRole('spinbutton', { name: 'Thời gian chờ (ngày)' })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Nhà cung cấp', exact: true })).toContainText('Theo sản phẩm')
}
const summary = (page: Page) => page.getByRole('complementary').filter({ hasText: 'Tóm tắt bổ sung' })
const fact = (page: Page, term: string) =>
  summary(page).getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::dd[1]')

test('a supplier rule left to the product names, and asks for a quotation from, the supplier its quantity selects', async ({
  page,
}, info) => {
  await newRule(page, 'bong tay trang 120', 'TM-001')
  // Đông Á's request for TM-001 (M9: 100 packs, 120 once the line grid spec has edited it) is on order
  // already (#1737): below 150, the rule tops up to 300.
  await page.getByRole('spinbutton', { name: 'Tồn tối thiểu' }).fill('150')
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/replenishment\/[^/?]+\?/)
  await settled(page)
  await expect(fact(page, 'Đã đặt, chưa nhận')).toHaveText(/^(100|120)$/)
  const asked = String(300 - Number(await fact(page, 'Đã đặt, chưa nhận').textContent()))
  // The rest falls short of Đông Á's 500, reaches Bông Sen Việt's 100 (P49). Left empty, the
  // look-ahead is the first supplier's ten days (P50).
  await expect(fact(page, 'Cần đặt')).toHaveText(asked)
  await expect(fact(page, 'Nguồn hàng')).toHaveText('Công ty TNHH Bông Sen Việt')
  await expect(fact(page, 'Thời gian chờ (ngày)')).toHaveText('10')

  await page.getByRole('button', { name: 'Chạy bổ sung' }).click()
  await page
    .getByRole('dialog', { name: 'Chạy bổ sung' })
    .getByRole('button', { name: 'Chạy bổ sung' })
    .click()
  // #1737: running it asks Bông Sen Việt for a quotation; the rule shows it on order.
  await settled(page)
  await expect(page).toHaveURL(/\/admin\/stock\/replenishment\/[^/?]+\?/)
  await expect(fact(page, 'Đã đặt, chưa nhận')).toHaveText('300')
  await expect(fact(page, 'Cần đặt')).toHaveText('0')
  await evidence(page, info, 'rule-after-run-desktop')

  // Purchasing finds it among the stock demands, priced from the vendor price list.
  await page.goto('/admin/purchase?lang=vi')
  await settled(page)
  const demands = page
    .locator('main section[data-ui="section"]')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Nhu cầu bổ sung từ kho', exact: true }) })
  const row = demands.getByRole('row').filter({ hasText: 'Công ty TNHH Bông Sen Việt' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Kho Hồ Chí Minh')
  await expect(row).toContainText('RFQ')
  await fitsWidth(page)
  await evidence(page, info, 'purchase-demands-desktop')
  await row.click()
  const rfq = page.getByRole('dialog').filter({ hasText: 'Công ty TNHH Bông Sen Việt' })
  await expect(rfq).toContainText(asked)
  await expect(rfq).toContainText('18.000')
  await evidence(page, info, 'purchase-demand-rfq-desktop')
  await page.keyboard.press('Escape')

  // The overview's guide says where these come from.
  await page.getByRole('button', { name: 'Hướng dẫn màn hình' }).click()
  await expect(page.locator('#purchase-overview-help')).toContainText('Nhu cầu bổ sung từ kho')
  await expect(page.locator('#purchase-overview-help [data-ui="mermaid"]')).toHaveAttribute(
    'data-state',
    'ready',
  )
  await evidence(page, info, 'purchase-overview-help-desktop')
})

test('the stock demands stay readable on a phone', async ({ page }, info) => {
  await page.setViewportSize(MOBILE)
  await signIn(page, 'admin', '/admin/purchase?lang=vi')
  await settled(page)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Nhu cầu bổ sung từ kho', exact: true }),
  ).toBeVisible()
  await fitsWidth(page)
  await evidence(page, info, 'purchase-demands-mobile')
})

test('a rule that names its supplier uses that supplier', async ({ page }) => {
  await newRule(page, 'bong tay trang mini', 'TM-002')
  await page.getByRole('button', { name: 'Nhà cung cấp', exact: true }).click()
  const menu = page.locator('[id$="vendorId-relation-menu"]')
  await expect(menu.getByRole('option')).toHaveCount(3)
  await menu.getByRole('option', { name: /Đông Á/ }).click()
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/replenishment\/[^/?]+\?/)
  await settled(page)
  await expect(fact(page, 'Nguồn hàng')).toHaveText('Công ty CP Hóa mỹ phẩm Đông Á')
  await expect(fact(page, 'Thời gian chờ (ngày)')).toHaveText('10')
})

test('a product nobody supplies needs a lead time of its own', async ({ page, ui }) => {
  ui.allow(/422 POST/, 'the rule is refused on purpose')
  await newRule(page, 'khan bong', 'KB-01')
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(
    page.getByText('Thời gian chờ là số nguyên 0–365; chỉ để trống cho nguồn nhà cung cấp có trên sản phẩm.'),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/replenishment\/new/)
})
