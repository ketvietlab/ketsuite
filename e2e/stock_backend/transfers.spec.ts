import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'transfers')

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
    test(`renders transfers in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/stock/transfers?lang=${locale}`)
      await expect(page.locator('[data-ui="app-main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'WH/OUT/REVIEW' })).toBeVisible()
      await page.locator('a[href*="record=stock.transfer%3Anew"]').click()
      const create = page.getByRole('dialog')
      await expect(create.locator('input[name="name"]')).toBeVisible()

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
        path: join(artifacts, `transfers-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

test('creates a transfer and opens it from the list', async ({ page }) => {
  await page.goto('/admin/stock/transfers?lang=vi')
  await page.getByRole('link', { name: 'Tạo mới' }).click()
  const create = page.getByRole('dialog')
  await create.locator('input[name="name"]').fill('WH/OUT/E2E')
  await create.locator('select[name="pickingTypeId"]').selectOption('wh:outgoing')
  await create.locator('input[name="scheduledDate"]').fill('2026-08-22')
  await create.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/record=stock\.transfer%3A(?!new)/)
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'WH/OUT/E2E' })).toBeVisible()
  await page.goto('/admin/stock/transfers?lang=vi')
  const transfer = page.getByRole('link', { name: 'WH/OUT/E2E' })
  await expect(transfer).toBeVisible()
  await transfer.click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'WH/OUT/E2E' })).toBeVisible()
})
