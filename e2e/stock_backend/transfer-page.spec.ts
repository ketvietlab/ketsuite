import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// C24 (K24/K30): a transfer opens one way, as a page like the sales order (owner 25-10-2026). Its
// products and its picked lines are KetGrids saved at once; its conversation is the page's rail.

const transferPath = '/admin/stock/transfers/transfer-review'

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('stock-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const grid = (page: Page, name: string) => record(page).getByRole('grid', { name, exact: true })
const row = (scope: Locator, text: string) => scope.getByRole('row').filter({ hasText: text })
/** Types into the active cell, replacing it, and picks the option it offers. */
const choose = async (page: Page, list: string, typed: string, option: string | RegExp) => {
  await page.keyboard.type(typed)
  await page.getByRole('listbox', { name: list }).getByRole('option', { name: option }).click()
}

test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ page }) => login(page))

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    test(`renders the transfer page in ${locale} on ${viewport.name}`, async ({ page }) => {
      const vi = locale === 'vi'
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`${transferPath}?lang=${locale}`)
      await expect(record(page).getByRole('heading', { level: 1 })).toHaveText('WH/OUT/REVIEW')
      await expect(row(grid(page, vi ? 'Sản phẩm' : 'Products'), 'STOCK-JACKET')).toBeVisible()
      await expect(grid(page, vi ? 'Đã lấy hàng' : 'Picked')).toBeVisible()
      // The conversation is the page's rail, not a dialog.
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(
        page.getByRole('complementary', {
          name: vi ? 'Trao đổi và hoạt động của dịch chuyển' : 'Transfer conversation and activities',
        }),
      ).toBeVisible()
      await expect(page.locator('[data-ui="chatter-loading"], [data-ui="activity-loading"]')).toHaveCount(0)
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }))
      expect(scroll).toBeLessThanOrEqual(client)
      // The page's Help explains the page.
      await record(page)
        .getByRole('button', { name: vi ? 'Hướng dẫn màn hình' : 'Screen help' })
        .click()
      await expect(page.locator('#stock-transfer-help')).toContainText(
        vi ? 'Phiếu mở thành một trang riêng' : 'A transfer opens on its own page',
      )
    })
  }
}

test('the list and its create button open the page; Back returns to the list', async ({ page }) => {
  await page.goto('/admin/stock/transfers?lang=vi')
  await page.getByRole('link', { name: 'Tạo mới' }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/new\?/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await record(page).getByRole('textbox', { name: 'Tham chiếu' }).fill('WH/INT/E2E')
  // Relation fields are the design system's pickers, the warehouse's own names in Vietnamese.
  await record(page).getByRole('button', { name: 'Loại hoạt động', exact: true }).click()
  // Each operation type names its warehouse under it.
  await page.getByRole('option', { name: /^Điều chuyển nội bộ\s*Kho trung tâm/ }).click()
  await record(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/(?!new)[^/?]+\?/)
  await expect(record(page).getByRole('heading', { level: 1 })).toHaveText('WH/INT/E2E')
  await record(page).getByRole('button', { name: 'Về danh sách' }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\?/)
  await page.getByRole('link', { name: 'WH/INT/E2E' }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/(?!new)[^/?]+\?/)
  await expect(record(page).getByRole('heading', { level: 1 })).toHaveText('WH/INT/E2E')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('adds a product in the grid, reserves, picks in the grid and completes', async ({ page }) => {
  await page.goto(`${transferPath}?lang=vi`)
  const state = record(page).locator('[data-ui="record-page-status"]')
  const products = grid(page, 'Sản phẩm')
  await record(page).getByRole('button', { name: 'Thêm sản phẩm' }).click()
  await choose(page, 'Sản phẩm', 'Áo', /STOCK-JACKET/)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  await record(page).getByRole('button', { name: 'Lưu sản phẩm' }).click()
  await expect(products.locator('[data-unsaved="true"]')).toHaveCount(0)
  await expect(products.getByRole('row')).toHaveCount(3)

  await record(page).getByRole('button', { name: 'Xác nhận' }).click()
  // K18: confirmed but holding nothing yet, the delivery waits for its goods; held, it is ready.
  await expect(state).toContainText('Chờ hàng')
  await record(page).getByRole('button', { name: 'Giữ hàng' }).click()
  await expect(state).toContainText('Sẵn sàng')

  // Reserving fills the picked grid with a line per move. The new jacket goes out one short: its
  // quantity is typed in its cell; both lines are ticked as picked.
  const picked = grid(page, 'Đã lấy hàng')
  await expect(picked.getByRole('row')).toHaveCount(3)
  const added = row(picked, 'STOCK-JACKET')
  await added.getByRole('gridcell').nth(1).click()
  await page.keyboard.type('1')
  await page.keyboard.press('Enter')
  for (const index of [1, 2])
    await picked.getByRole('row').nth(index).getByRole('checkbox', { name: 'Đã lấy hàng' }).click()
  await expect(picked.getByRole('checkbox', { name: 'Đã lấy hàng', checked: true })).toHaveCount(2)
  await record(page).getByRole('button', { name: 'Lưu dòng' }).click()
  await expect(picked.locator('[data-unsaved="true"]')).toHaveCount(0)
  await expect(added.getByRole('gridcell').nth(1)).toHaveText('1')

  // Completing one short asks what becomes of the rest.
  await record(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Hoàn tất' })
  await expect(dialog.getByRole('radio', { name: 'Hoàn tất và tạo đơn bù' })).toBeChecked()
  await dialog.getByRole('radio', { name: 'Hoàn tất, không tạo đơn bù' }).check()
  await dialog.getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await expect(state).toContainText('Hoàn tất')
  await expect(record(page).getByRole('button', { name: 'Xác nhận' })).toHaveCount(0)
  await expect(record(page).getByRole('button', { name: 'Thêm sản phẩm' })).toHaveCount(0)
})
