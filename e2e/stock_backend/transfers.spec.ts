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
      // Creating a transfer opens its page (C24), not a dialog.
      await page.locator('a[href^="/admin/stock/transfers/new?"]').click()
      await expect(page).toHaveURL(/\/admin\/stock\/transfers\/new\?/)
      const create = page.locator('[data-ui="record-page"]')
      await expect(create.locator('input[name="name"]')).toBeVisible()
      // K60: the priority is a labelled checkbox of the form, measured apart from the fields.
      await expect(
        create.getByRole('checkbox', { name: locale === 'vi' ? 'Ưu tiên' : 'Priority' }),
      ).toBeVisible()

      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        visibleControls: [
          ...document.querySelectorAll<HTMLElement>(
            // Text and number fields and selects; a checkbox keeps the DS checkbox size.
            // Relation fields are pickers: their trigger is the control, their inner inputs are not.
            '[data-ui="record-page"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), [data-ui="record-page"] select:not([data-ui="relation-native"]), [data-ui="record-page"] button[id^="transfer-record-"]',
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
