import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'inventory')

/**
 * Opens a screen and waits for the KetJS bootstrap, which the load event does not
 * wait for. The adjustment link opens its modal through the runtime the bootstrap
 * mounts; the bootstrap publishes its navigation once islands and behaviors are
 * mounted.
 */
const open = async (page: Page, path: string) => {
  await page.goto(path)
  await page.waitForFunction(
    () => (globalThis as { __ketNavigation?: unknown }).__ketNavigation !== undefined,
  )
}

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('stock-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    test(`renders inventory in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await open(page, `/admin/stock/inventory?lang=${locale}`)
      await expect(page.locator('[data-ui="app-main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)
      await expect(page.locator('[data-ui="kt-row"]')).toHaveCount(1)
      await page.locator('a[href*="record=stock.count%3Anew"]').click()
      const adjustment = page.getByRole('dialog')
      await expect(adjustment.locator('select[name="productId"]')).toBeVisible()

      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        visibleControls: [
          ...document.querySelectorAll<HTMLElement>(
            '[role="dialog"] input:not([type="hidden"]), [role="dialog"] select',
          ),
        ]
          .filter((control) => control.getBoundingClientRect().height > 0)
          .map((control) => control.getBoundingClientRect().height),
      }))
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      // The design-system control height: 2rem, and 2.25rem below 768px where a
      // fingertip needs the target.
      const fieldHeight = viewport.width < 768 ? 36 : 32
      expect(metrics.visibleControls.length).toBeGreaterThan(0)
      expect(metrics.visibleControls).toEqual(metrics.visibleControls.map(() => fieldHeight))
      await page.screenshot({
        path: join(artifacts, `inventory-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

test('applies an inventory count and refreshes the balance', async ({ page }) => {
  await open(page, '/admin/stock/inventory?lang=vi')
  await page.getByRole('link', { name: 'Điều chỉnh tồn kho' }).click()
  const adjustment = page.getByRole('dialog')
  await adjustment.locator('select[name="productId"]').selectOption('stock-template:default')
  await adjustment.locator('select[name="locationId"]').selectOption('wh:stock')
  await adjustment.locator('input[name="countedQuantity"]').fill('15')
  await adjustment.locator('select[name="inventoryLocationId"]').selectOption('inventory')
  await adjustment.getByRole('button', { name: 'Xem chênh lệch' }).click()
  await expect(adjustment.locator('[data-ui="notice"]')).toContainText('Chưa ghi nhận thay đổi')

  await adjustment.getByRole('button', { name: 'Áp dụng kiểm kê' }).click()
  await expect(adjustment).toHaveCount(0)
  await expect(page.locator('[data-ui="kt-row"]')).toContainText('15')
})
