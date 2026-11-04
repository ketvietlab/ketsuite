import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// K40: the seed holds 12 jackets in Kho trung tâm and a confirmed delivery of 20 overdue since
// 5 January 2026 (WH/OUT/LATE), so the jacket runs short from today; the draft delivery of 3
// (WH/OUT/REVIEW) promises nothing yet.

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('stock-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

const today = (locale: 'vi' | 'en') =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date())

const product = 'Áo khoác kiểm kê KETSUITE · STOCK-JACKET'

test.describe.configure({ mode: 'serial' })
// Menu links carry no language: the browser's own picks it, as for a Vietnamese user.
test.use({ locale: 'vi-VN' })
test.beforeEach(async ({ page }) => login(page))

test('the list opens from the menu, reads on the client and puts the shortage first', async ({ page }) => {
  await page.goto('/admin/stock?lang=vi')
  await page.getByRole('link', { name: 'Dự báo tồn kho', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/forecast/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dự báo tồn kho')
  const row = page.getByRole('row').filter({ hasText: 'STOCK-JACKET' })
  await expect(row).toHaveCount(1)
  for (const text of ['Kho trung tâm', '12 Cái', '20', '-8', today('vi'), 'Thiếu hàng'])
    await expect(row).toContainText(text)
  // The status preset narrows the list: nothing has enough.
  await page.goto('/admin/stock/forecast?lang=vi&preset=ok')
  await expect(page.getByText('Không có dòng phù hợp')).toBeVisible()
})

test('a row opens the product page: when it runs short, which operation causes it, and what is left', async ({
  page,
}) => {
  await page.goto('/admin/stock/forecast?lang=vi')
  await page.getByRole('link', { name: product }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/forecast\/wh\/stock-template%3Adefault/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${product} · Kho trung tâm`)
  await expect(page.getByRole('alert')).toContainText(`Thiếu hàng từ ${today('vi')}`)
  await expect(page.getByRole('alert')).toContainText('Phiếu WH/OUT/LATE làm tồn xuống dưới 0.')
  const late = page.getByRole('row').filter({ hasText: 'WH/OUT/LATE' })
  for (const text of ['05/01/2026', 'Trễ hẹn', 'Xuất', '-20 Cái', '-8 Cái'])
    await expect(late).toContainText(text)
  // The draft delivery is not on its way yet: it is neither an operation nor on order.
  await expect(page.getByText('WH/OUT/REVIEW')).toHaveCount(0)
  const totals = page.getByRole('complementary', { name: 'Tổng' })
  await expect(totals).toContainText('Dùng được')
  await expect(totals).toContainText('Kho chưa có quy tắc bổ sung cho mặt hàng này.')
  await late.getByRole('link', { name: 'WH/OUT/LATE' }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/forecast-late/)
})

test('the help button opens the forecast guide and Escape gives focus back', async ({ page }) => {
  await page.goto('/admin/stock/forecast?lang=vi')
  await expect(page.getByRole('row').filter({ hasText: 'STOCK-JACKET' })).toHaveCount(1)
  const help = page.getByRole('button', { name: 'Hướng dẫn Dự báo tồn kho' })
  await help.click()
  const drawer = page.getByRole('dialog', { name: 'Dự báo tồn kho' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('heading', { name: 'Cách tính' })).toBeVisible()
  await expect(drawer.locator('svg').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(help).toBeFocused()
})

test('in English on a phone, dark: rows and operations read as cards, nothing overflows', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin/stock/forecast?lang=en')
  const row = page.getByRole('row').filter({ hasText: 'STOCK-JACKET' })
  await expect(row).toContainText('Short')
  await expect(row).toContainText(today('en'))
  const width = () => page.evaluate(() => document.documentElement.scrollWidth)
  expect(await width()).toBeLessThanOrEqual(390)
  await row.getByRole('link', { name: product }).click()
  await expect(page.getByRole('alert')).toContainText(`Short from ${today('en')}`)
  await expect(page.getByRole('row').filter({ hasText: 'WH/OUT/LATE' })).toContainText('Overdue')
  expect(await width()).toBeLessThanOrEqual(390)
  const scroll = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-ui="table-scroll"]')].map(
      (node) => node.scrollWidth - node.clientWidth,
    ),
  )
  expect(scroll.every((extra) => extra <= 0)).toBe(true)
})
