import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'tiers')

/**
 * Opens a screen and waits for the KetJS bootstrap, which the load event does not
 * wait for. Row links and the shell behavior that saves a dirty form before a link
 * leaves are mounted by it; the bootstrap publishes its navigation once islands and
 * behaviors are mounted.
 */
const open = async (page: Page, path: string) => {
  await page.goto(path)
  await page.waitForFunction(
    () => (globalThis as { __ketNavigation?: unknown }).__ketNavigation !== undefined,
  )
}

const login = async (page: Page, lang: 'vi' | 'en' = 'vi') => {
  await page.goto(`/login?lang=${lang}`)
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('loyalty-demo')
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
  test(`renders per-tier assessment periods on ${viewport.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await open(page, '/admin/loyalty/tiers?lang=vi')

    await expect(page.getByRole('heading', { name: 'Hạng thành viên' })).toBeVisible()
    await expect(page.locator('select[name="programId"]')).toHaveCount(0)
    await expect(page.getByText('Chính sách xét hạng')).toHaveCount(0)
    await expect(page.locator('input[name="windowMonths"]')).toHaveCount(0)
    await expect(page.locator('[data-ui="kt-row"]')).toHaveCount(4)

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport)
    await page.screenshot({ path: join(artifacts, `${viewport.name}-light.png`), fullPage: true })
  })
}

test('opens tier editing from the row and keeps archive separate from editing', async ({ page }) => {
  await open(page, '/admin/loyalty/tiers?lang=vi')
  const gold = page.locator('[data-ui="kt-row"]').filter({ hasText: 'Vàng' })
  await expect(gold).toHaveAttribute('data-row-href', /modal=tier.*tier=gold/)
  await gold.locator('[data-ui="kt-cell"]').first().click()
  await expect(page).toHaveURL(/modal=tier.*tier=gold/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('input[name="name"]')).toHaveValue('Vàng')
  await expect(page.locator('input[name="windowMonths"]')).toHaveValue('12')
  await expect(page.getByRole('button', { name: 'Lưu trữ' })).toBeVisible()
})

test('renders English without untranslated Loyalty keys', async ({ page }) => {
  await open(page, '/admin/loyalty/tiers?lang=en')
  await expect(page.getByRole('heading', { name: 'Membership tiers' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Spend period (months)' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/loyalty(?:_backend)?\.[A-Za-z]/)
})

test('saves a dirty program before following Loyalty navigation', async ({ page }) => {
  await open(page, '/admin/loyalty/programs/ket-club?lang=en')
  const name = page.locator('input[name="name"]')
  await name.fill('Két Club updated')
  page.once('dialog', async (dialog) => dialog.accept())
  await page.getByRole('link', { name: 'Membership tiers', exact: true }).click()

  await expect(page).toHaveURL(/\/admin\/loyalty\/tiers(?:\?|$)/)
  await open(page, '/admin/loyalty/programs/ket-club?lang=en')
  await expect(page.locator('input[name="name"]')).toHaveValue('Két Club updated')
})
