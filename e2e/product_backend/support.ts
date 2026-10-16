import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { PASSWORD } from './fixtures/users.mjs'

export { expect }

/**
 * What a person would see go wrong on a screen, read from the page as it stands: an alert
 * showing, a message key or error code instead of words, a value the page failed to format.
 */
export const visibleProblems = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const problems: string[] = []
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'
    }
    for (const alert of document.querySelectorAll('[role="alert"]'))
      if (shown(alert) && (alert.textContent ?? '').trim())
        problems.push(`alert: ${(alert.textContent ?? '').trim().replace(/\s+/gu, ' ').slice(0, 160)}`)
    const text = document.body?.innerText ?? ''
    const leaks = [
      // A message key the screen printed instead of its words: `product_backend.create.title`.
      /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\.[a-zA-Z][a-zA-Z0-9]*){2,}\b/gu,
      /\b(?:recordModal|ws|search|validation|backend)\.[a-zA-Z][a-zA-Z0-9]*\b/gu,
      /\bE_[A-Z][A-Z_]{2,}\b/gu,
      /\[object Object\]|\bundefined\b|\bNaN\b|Invalid Date/gu,
    ]
    for (const pattern of leaks)
      for (const match of text.match(pattern) ?? []) problems.push(`on screen: ${match}`)
    return problems
  })

type UiGuard = {
  /** Tolerates a problem this test brings about on purpose, and says why. */
  allow: (pattern: RegExp, why: string) => void
  /** Reads the screen as it stands now, for a test that walks several screens. */
  check: (where: string) => Promise<void>
}

/**
 * Every spec runs under this guard: an uncaught exception, a console error, a request the
 * server refused or that failed, and anything on the last screen a person would read as an
 * error fail the test, unless the test says it brought that about on purpose.
 */
export const test = base.extend<{ ui: UiGuard }>({
  ui: [
    async ({ page }, use) => {
      const problems: string[] = []
      const allowed: RegExp[] = []
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`))
      page.on('console', (message) => {
        // A refused resource is reported below with its address; the console line has none.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
          problems.push(`console: ${message.text().slice(0, 200)}`)
      })
      page.on('response', (response) => {
        if (response.status() < 400) return
        const url = new URL(response.url())
        problems.push(`${response.status()} ${response.request().method()} ${url.pathname}${url.search}`)
      })
      page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? ''
        // Leaving a page cancels what it was still loading; that is not a failure anyone sees.
        if (failure.includes('ERR_ABORTED')) return
        const url = new URL(request.url())
        problems.push(`failed ${request.method()} ${url.pathname}: ${failure}`)
      })
      const guard: UiGuard = {
        allow: (pattern) => {
          allowed.push(pattern)
        },
        check: async (where) => {
          for (const problem of await visibleProblems(page)) problems.push(`${where} ${problem}`)
        },
      }
      await use(guard)
      if (!page.isClosed()) await guard.check('last screen').catch(() => {})
      const unexpected = problems.filter((problem) => !allowed.some((pattern) => pattern.test(problem)))
      expect(unexpected, 'what a person would have seen go wrong').toEqual([])
    },
    { auto: true },
  ],
})

const here = dirname(fileURLToPath(import.meta.url))
const artifacts = join(here, 'artifacts')

/** A file the fixtures ship, for the upload a person would make. */
export const fixtureFile = (name: string) => join(here, 'fixtures', name)

export const DESKTOP = { width: 1440, height: 900 }
export const MOBILE = { width: 390, height: 844 }

/** Signs in through the login form, the way a person does, and lands on `next`. */
export const signIn = async (
  page: Page,
  login: 'admin' | 'viewer' | 'reader' | 'outsider' = 'admin',
  next = '/admin/product/templates',
  lang: 'vi' | 'en' = 'vi',
) => {
  await page.goto(`/login?lang=${lang}&next=${encodeURIComponent(next)}`)
  await page.locator('input[name="login"]').fill(login)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
  // The screen's scripts (islands, Help, menus) are wired once the page has loaded.
  await page.waitForLoadState('load')
}

/**
 * A server-rendered screen's islands have loaded their bundles and taken over their markup.
 * They do so after the load event, and text typed into the server's copy of a control is lost.
 */
export const settled = async (page: Page) => {
  await page.waitForLoadState('networkidle')
}

/** The browser refuses to submit a required field left empty, before anything reaches the server. */
export const refusedAsEmpty = async (field: Locator) => {
  await expect
    .poll(() => field.evaluate((element) => (element as HTMLInputElement).validity.valueMissing))
    .toBe(true)
}

/** The product list has finished its read: its rows are on screen and nothing is loading. */
export const listReady = async (page: Page) => {
  await expect(page.locator('[data-product-list="true"]')).toHaveAttribute('aria-busy', 'false')
}

/** A product's own page has rendered its record: the heading carries the product's name. */
export const recordReady = async (page: Page, name: string | RegExp) => {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** A row of the product list (table view), by the product's name. */
export const productRow = (page: Page, name: string) =>
  page.locator('[data-product-list="true"] tbody tr').filter({ hasText: name })

/** Names of the rows the list shows, top to bottom (the name line, without the code under it). */
export const rowNames = async (page: Page) =>
  page
    .locator('[data-product-list="true"] [data-ui="kt-row-link"]')
    .evaluateAll((links) =>
      links.map((link) => (link.querySelector('[data-ui="text"]')?.textContent ?? '').trim()),
    )

/** Opens a SearchFilter menu (Loại, Trạng thái, Nhóm…) and picks one of its options. */
export const pickFromMenu = async (page: Page, menu: RegExp, option: string) => {
  const search = page.getByRole('search', { name: 'Tìm và lọc sản phẩm' })
  await search.getByRole('button', { name: menu }).click()
  await search.getByRole('button', { name: option, exact: true }).click()
}

/** The page does not scroll sideways: nothing is wider than the viewport. */
export const fitsWidth = async (page: Page) => {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client)
}

/** Writes a full-page screenshot next to the spec's other evidence (never committed). */
export const evidence = async (page: Page, info: TestInfo, name: string) => {
  const spec =
    info.file
      .split('/')
      .pop()
      ?.replace(/\.spec\.ts$/u, '') ?? 'product'
  const path = join(artifacts, spec, `${name}.png`)
  await mkdir(dirname(path), { recursive: true })
  await page.screenshot({ path, fullPage: true })
}
