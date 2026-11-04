import type { Page } from '@playwright/test'
import { DESKTOP, MOBILE, expect, recordReady, settled, signIn, test } from './support.js'

// A quotation is a page of its own, not a modal over its list: a list row and Create
// Quotation open pages, Back returns to the list, and the page's header and aside carry
// what the former server page did (print, loyalty, conversation).

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const recordPage = (page: Page) => page.locator('[data-ui="record-page"]')
// A quotation or an order edits its lines as a grid (D33b).
const lines = (page: Page) => recordPage(page).getByRole('grid', { name: 'Sản phẩm' })

test('a quotation opens from its list as a page, and Back to list returns to it', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations')
  await page.getByRole('row').filter({ hasText: 'Nhà sách Trang' }).first().click()
  await expect(page).toHaveURL(
    /\/admin\/sales\/quotations\/quote-page\?returnTo=%2Fadmin%2Fsales%2Fquotations/,
  )
  await recordReady(page, /^S\d+/)
  await expect(lines(page)).toBeVisible()
  // A page, not a modal: nothing else on the screen turns inert behind it.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The header prints the documents of its state and opens the order's loyalty.
  await expect(recordPage(page).getByRole('link', { name: 'BÁO GIÁ' })).toHaveAttribute(
    'href',
    /^\/reports\/sale\.quotation\/quote-page/,
  )
  await expect(recordPage(page).getByRole('link', { name: 'Mở ưu đãi Loyalty' })).toHaveAttribute(
    'href',
    /^\/admin\/loyalty\/orders\/sale\/quote-page/,
  )
  // Its conversation and activities sit beside it.
  const aside = recordPage(page).locator('[data-ui="record-page-aside"]')
  await expect(aside).toContainText('Trao đổi và hoạt động của đơn bán')
  await expect(aside.locator('[data-island="mail.chatter"]')).toHaveCount(1)
  await settled(page)
  await recordPage(page).getByRole('button', { name: 'Về danh sách' }).click()
  await expect(page).toHaveURL(/\/admin\/sales\/quotations(\?|$)/)
  await expect(page.getByRole('row').filter({ hasText: 'Nhà sách Trang' }).first()).toBeVisible()
})

test('Create Quotation opens a page, and the created quotation takes its place', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations')
  await page.getByRole('link', { name: 'Tạo báo giá' }).first().click()
  await expect(page).toHaveURL(/\/admin\/sales\/quotations\/new/)
  await recordReady(page, 'Tạo báo giá')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await settled(page)
  // The customer is searched on the server, past what the page preloaded.
  await recordPage(page).getByRole('button', { name: 'Khách hàng' }).click()
  const customers = page.locator('[id$="partnerId-relation-menu"]')
  await customers.getByRole('searchbox').fill('Nhà sách')
  await customers.getByRole('option', { name: /Nhà sách Trang/ }).click()
  await recordPage(page).getByRole('button', { name: 'Kho hàng' }).click()
  await page
    .locator('[id$="warehouseId-relation-menu"]')
    .getByRole('option', { name: /Kho Hồ Chí Minh/ })
    .click()
  await recordPage(page).getByRole('button', { name: 'Tạo báo giá' }).click()
  // `new` gives way to the quotation's id, and its lines grid takes the first line.
  await expect(page).toHaveURL(/\/admin\/sales\/quotations\/(?!new)[^/?]+/)
  await recordReady(page, /^S\d+/)
  await expect(lines(page)).toBeVisible()
  await expect(recordPage(page).getByRole('button', { name: 'Thêm dòng' })).toBeVisible()
  await expect(recordPage(page).getByRole('button', { name: 'Lưu các dòng' })).toBeVisible()
})

test('on a phone the quotation stays a page with its lines table', async ({ page }) => {
  await page.setViewportSize(MOBILE)
  await signIn(page, 'admin', '/admin/sales/quotations/quote-page')
  await recordReady(page, /^S\d+/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(lines(page)).toBeVisible()
})

// D22: the lines grid keeps its measure, so the rail moves below the lines on a page narrower than
// 91.5rem (1440 with the menus) and stands beside them on a wide screen; either way the grid does not
// scroll sideways.
test('the rail sits below the lines grid at 1440 and beside it on a wide screen', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-page')
  const placement = async () => {
    await recordReady(page, /^S\d+/)
    await expect(lines(page)).toBeVisible()
    const grid = (await lines(page).boundingBox())!
    const aside = (await recordPage(page).locator('[data-ui="record-page-aside"]').boundingBox())!
    const scrolls = await lines(page).evaluate((element) => element.scrollWidth > element.clientWidth + 1)
    return { grid, aside, scrolls }
  }
  let at = await placement()
  expect(at.aside.y).toBeGreaterThanOrEqual(at.grid.y + at.grid.height)
  expect(at.scrolls).toBe(false)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.reload()
  at = await placement()
  expect(at.aside.x).toBeGreaterThanOrEqual(at.grid.x + at.grid.width)
  expect(at.aside.y).toBeLessThan(at.grid.y + at.grid.height)
  expect(at.scrolls).toBe(false)
})

test('a draft quotation edits its lines in a grid and saves them together', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-grid')
  await recordReady(page, /^S\d+/)
  await expect(lines(page)).toBeVisible()
  await settled(page)
  // A new row takes the product first, searched on the server, then its unit and quantity.
  await recordPage(page).getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('nuoc suoi loc')
  // The picker names a variant by its code, then its name; the description column follows it.
  await page.getByRole('option', { name: /^NSL Nước suối lốc/ }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  // Only the product's own unit and its packaging.
  await expect(page.getByRole('listbox', { name: 'Đơn vị tính' }).getByRole('option')).toHaveText([
    /^Cái/,
    /^Lốc 4 cái/,
  ])
  await page.getByRole('option', { name: /^Lốc 4 cái/ }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  // The grid prices the pack of four from the pricelist as it is entered; the description is the
  // product's name once saved.
  const entered = lines(page).getByRole('row').filter({ hasText: 'NSL' })
  await expect(entered).toContainText('200000')
  await recordPage(page).getByRole('button', { name: 'Lưu các dòng' }).click()
  const row = lines(page).getByRole('row').filter({ hasText: 'Nước suối lốc' })
  // Saved at once, and still there when the page is read again.
  await expect(row).toContainText('200000')
  await page.reload()
  await recordReady(page, /^S\d+/)
  await expect(row).toContainText('Lốc 4 cái')
  await expect(row).toContainText('200000')
  await expect(recordPage(page).getByRole('definition').filter({ hasText: '400.000' }).first()).toBeVisible()
  // Confirmed, the quotation is an order: the page moves to its address among the orders, and its
  // lines stay a grid (D33b) with the line kept.
  await settled(page)
  await recordPage(page).getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page).toHaveURL(/\/admin\/sales\/orders\/quote-grid(\?|$)/)
  await recordReady(page, /^S\d+/)
  await expect(recordPage(page).getByText('Đơn bán hàng', { exact: true }).first()).toBeVisible()
  await expect(lines(page)).toContainText('Nước suối lốc')
})
