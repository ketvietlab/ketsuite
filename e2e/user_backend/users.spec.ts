import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The people list (`/admin/users`): a frame from the server and three islands over one paged read
// (`/admin/users/read`). Every choice is followed in place with one read, the URL and Back follow it,
// every state a read can end in shows and recovers, and the bulk form changes the people checked.
// The fixture (fixtures/server.mjs) seeds 36 active people: "Khách Cổng", "Nhân viên 01"–"34" (01–05
// at "Két Bắc", 02 holding "Thu ngân") and "Quản trị viên", plus "Người Đã Nghỉ", who has left.

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'users')

const LIST = '[data-user-people-list="true"]'
const ROWS = `${LIST} [data-ui="kt-row"]`

/** Opens a screen and waits for the KetJS bootstrap, which the load event does not wait for. */
const open = async (page: Page, path: string) => {
  await page.goto(path)
  await page.waitForFunction(
    () => (globalThis as { __ketNavigation?: unknown }).__ketNavigation !== undefined,
  )
}

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('user-list-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

const rowCount = (page: Page, count: number) =>
  page.waitForFunction(
    ([selector, expected]) => document.querySelectorAll(selector as string).length === expected,
    [ROWS, count] as const,
  )
const footer = (page: Page) => page.locator('[data-user-people-list-footer="true"]')
const names = (page: Page) => page.locator(`${LIST} [data-ui="kt-row-link"]`).allInnerTexts()

/** A followed link must not load the page: a value kept on `window` survives an in-place change only. */
const mark = (page: Page) => page.evaluate(() => ((window as { __kvMark?: string }).__kvMark = 'kept'))
const marked = async (page: Page) =>
  expect(await page.evaluate(() => (window as { __kvMark?: string }).__kvMark)).toBe('kept')

const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true)

let errors: string[] = []
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page)
})
test.afterEach(() => expect(errors).toEqual([]))

test('the first page is one read, and the pager and Back are followed in place', async ({ page }) => {
  const reads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/admin/users/read')
      reads.push(JSON.parse(request.postData() ?? '{}').href)
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/admin/users?lang=vi')
  await expect(page.getByRole('heading', { name: 'Người dùng', exact: true })).toBeVisible()
  await rowCount(page, 30)
  await expect(footer(page)).toContainText('1–30 / 36')
  expect((await names(page))[0]).toBe('Khách Cổng')
  expect(reads).toEqual(['/admin/users?lang=vi'])
  // Full authority is said on the row that holds it.
  await expect(
    page.locator(`${LIST} [data-ui="kt-row"]`).filter({ hasText: 'Quản trị toàn hệ thống' }),
  ).toHaveCount(0)
  await noOverflow(page)
  await page.screenshot({ path: join(artifacts, 'list-1440.png') })

  await mark(page)
  await footer(page).getByRole('link', { name: 'Trang sau', exact: true }).click()
  await expect(page).toHaveURL(/[?&]page=2/)
  await rowCount(page, 6)
  await expect(footer(page)).toContainText('31–36 / 36')
  await expect(
    page.locator(`${LIST} [data-ui="kt-row"]`).filter({ hasText: 'Quản trị toàn hệ thống' }),
  ).toHaveCount(1)
  await page.goBack()
  await expect(page).not.toHaveURL(/page=/)
  await rowCount(page, 30)
  await marked(page)
})

test('typing narrows after a pause: the first pause pushes, a later one replaces, Back leaves the search', async ({
  page,
}) => {
  await open(page, '/admin/users?lang=vi')
  await rowCount(page, 30)
  await mark(page)
  const bar = page.locator('[data-user-people-list-controls="true"] [data-ui="search-filter-input"]')
  await bar.fill('Nhân viên 0')
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'Nhân viên 0')
  await rowCount(page, 9)
  await bar.fill('Nhân viên 05')
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'Nhân viên 05')
  await rowCount(page, 1)
  await page.goBack()
  await expect(page).toHaveURL((url) => !url.searchParams.has('q'))
  await rowCount(page, 30)
  await marked(page)
})

test('company and role choices come with the read, combine, and clearing drops them', async ({ page }) => {
  await open(page, '/admin/users?lang=vi')
  await rowCount(page, 30)
  await mark(page)
  const controls = page.locator('[data-user-people-list-controls="true"]')
  await controls.getByRole('button', { name: 'Công ty', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Két Bắc' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('company') === 'north')
  await rowCount(page, 5)
  await controls.getByRole('button', { name: 'Vai trò công việc', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Thu ngân' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('role') === 'cashier')
  await rowCount(page, 1)
  expect(await names(page)).toEqual(['Nhân viên 02'])
  await expect(controls.getByRole('button', { name: 'Công ty: Két Bắc', exact: true })).toBeVisible()
  await page.screenshot({ path: join(artifacts, 'company-role.png') })

  // Another company with that role leaves nobody, and the way out drops both questions.
  await controls.getByRole('button', { name: 'Công ty: Két Bắc', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Két Việt' }).click()
  await expect(page.locator(LIST).getByText('Không có người dùng phù hợp', { exact: true })).toBeVisible()
  await page.locator(LIST).getByRole('link', { name: 'Xoá bộ lọc', exact: true }).click()
  await expect(page).toHaveURL((url) => !url.searchParams.has('company') && !url.searchParams.has('role'))
  await rowCount(page, 30)
  await marked(page)
})

test('a column header sorts in place, and a column can be hidden', async ({ page }) => {
  await open(page, '/admin/users?lang=vi')
  await rowCount(page, 30)
  await page.locator(LIST).getByRole('link', { name: 'Tên, sắp xếp giảm dần', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('sort') === 'name:desc')
  // The full administrator's name carries their badge.
  await expect.poll(async () => (await names(page))[0]?.split('\n')[0]).toBe('Quản trị viên')
  await page.getByRole('button', { name: 'Chọn cột' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.has('columns'))
  await expect(page.locator(`${LIST} [data-col="email"]`)).toHaveCount(0)
})

test('a person opens on their page, and Back returns to their row', async ({ page }) => {
  await open(page, '/admin/users?lang=vi&q=Nh%C3%A2n%20vi%C3%AAn%2007')
  await rowCount(page, 1)
  await page.locator(LIST).getByRole('link', { name: 'Nhân viên 07', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/users\/staff-07\?/)
  await expect(page.locator('[data-ui="record-page"]')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL((url) => url.pathname === '/admin/users' && url.searchParams.has('q'))
  await expect(
    page.locator(`${LIST} [data-ui="kt-row"][data-row="staff-07"][data-current="true"]`),
  ).toBeVisible()
})

test('a failed read keeps the rows and retries; offline recovers by itself; a refusal shows nobody', async ({
  page,
  context,
}) => {
  await open(page, '/admin/users?lang=vi')
  await rowCount(page, 30)
  await page.route('**/admin/users/read**', (route) => route.fulfill({ status: 500, body: '{}' }), {
    times: 1,
  })
  await footer(page).getByRole('link', { name: 'Trang sau', exact: true }).click()
  await expect(page.locator(LIST).getByText('Không tải được danh sách', { exact: true })).toBeVisible()
  await expect(page.locator(ROWS)).toHaveCount(30)
  await page.locator(LIST).getByRole('button', { name: 'Thử lại', exact: true }).click()
  await rowCount(page, 6)

  await context.setOffline(true)
  await footer(page).getByRole('link', { name: 'Trang trước', exact: true }).click()
  await expect(page.locator(LIST).getByText('Mất kết nối mạng', { exact: true })).toBeVisible()
  await context.setOffline(false)
  await rowCount(page, 30)

  await page.route('**/admin/users/read**', (route) => route.fulfill({ status: 403, body: '{}' }), {
    times: 1,
  })
  await page.reload()
  await expect(
    page.locator(LIST).getByText('Bạn không có quyền xem danh sách này', { exact: true }),
  ).toBeVisible()
  await expect(page.locator(ROWS)).toHaveCount(0)
  await page.screenshot({ path: join(artifacts, 'denied.png') })
})

test('the guide opens beside the list on a desktop and over it on a phone, where nothing scrolls sideways', async ({
  page,
}) => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await open(page, '/admin/users?lang=vi')
    await rowCount(page, 30)
    await noOverflow(page)
    const phone = viewport.width < 768
    if (phone) {
      await expect(page.locator(`${LIST} [data-ui="ket-table"]`)).toHaveAttribute('data-responsive', 'stack')
      await page.screenshot({ path: join(artifacts, 'list-390.png') })
      await page.locator('[data-ui="navigation-toggle"]').click()
    }
    await page.locator('[data-ui="app-switcher-help"]').click()
    const drawer = page.locator('dialog[data-ui="help-drawer"]')
    await expect(drawer.getByRole('heading', { name: 'Người dùng', exact: true })).toBeVisible()
    await expect(drawer.getByRole('heading', { name: 'Đổi nhiều người cùng lúc' })).toBeVisible()
    expect(await drawer.evaluate((element) => element.matches(':modal'))).toBe(phone)
    await page.screenshot({ path: join(artifacts, `help-${viewport.name}.png`) })
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  }
})

test('in English the list reads in English', async ({ page }) => {
  await open(page, '/admin/users?lang=en&q=Kh%C3%A1ch')
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
  await rowCount(page, 1)
  await expect(page.locator(LIST).getByText('Customer / partner', { exact: true })).toBeVisible()
})

test('checked people are made inactive and active again; a new page unchecks the rows', async ({ page }) => {
  await open(page, '/admin/users?lang=vi&page=2')
  await rowCount(page, 6)
  const bulk = page.locator('[data-ui="list-page-selection"]')
  const box = (id: string) =>
    page.locator(`${LIST} [data-ui="kt-row"][data-row="${id}"] [data-ui="kt-row-select"]`)
  // A row checked on one page is not carried to the next.
  await box('staff-30').check()
  await expect(bulk).toBeVisible()
  await footer(page).getByRole('link', { name: 'Trang trước', exact: true }).click()
  await rowCount(page, 30)
  await expect(bulk).toBeHidden()
  await page.goBack()
  await rowCount(page, 6)
  await expect(box('staff-30')).not.toBeChecked()

  // Checked on the second page, sent, and back on the second page with the two gone.
  await box('staff-33').check()
  await box('staff-34').check()
  await expect(bulk.locator('[data-ui="bulk-count"]')).toHaveText('2')
  await page.screenshot({ path: join(artifacts, 'bulk.png') })
  await bulk.getByRole('button', { name: 'Ngừng hoạt động', exact: true }).click()
  await expect(page).toHaveURL(
    (url) => url.pathname === '/admin/users' && url.searchParams.get('page') === '2',
  )
  await page.waitForFunction(
    () => (globalThis as { __ketNavigation?: unknown }).__ketNavigation !== undefined,
  )
  await rowCount(page, 4)
  await expect(footer(page)).toContainText('31–34 / 34')

  // With the archived included, the same two are made active again.
  await open(page, '/admin/users?lang=vi&archived=1&q=Nh%C3%A2n%20vi%C3%AAn%203')
  await rowCount(page, 5)
  await box('staff-33').check()
  await box('staff-34').check()
  await bulk.getByRole('button', { name: 'Bật hoạt động', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('archived') === '1')
  await open(page, '/admin/users?lang=vi')
  await rowCount(page, 30)
  await expect(footer(page)).toContainText('1–30 / 36')
})
