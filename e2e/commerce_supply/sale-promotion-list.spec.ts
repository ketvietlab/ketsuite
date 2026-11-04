import { readFile } from 'node:fs/promises'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// W12b (#1745), on the Commerce deployment: Khuyến mãi lists what a program gives and how often it was
// used, as the mock does, so a manager reads a program without opening it.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

test('Khuyến mãi shows each program code, reward, end date and usage', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/promotions')
  await settled(page)
  await expect(page.getByRole('columnheader')).toHaveText([
    'Tên chương trình',
    'Loại',
    'Mã',
    'Phần thưởng',
    'Áp dụng đến',
    'Đã dùng',
    'Trạng thái',
  ])
  const cells = (name: string) => page.getByRole('row').filter({ hasText: name }).getByRole('cell')
  await expect(cells('Giảm 10% đơn từ 200.000')).toHaveText([
    'Giảm 10% đơn từ 200.000',
    'Tự động',
    '',
    'Giảm 10% trên đơn',
    '—',
    // The seeded sales that already took it; other specs may confirm more.
    /^\d+$/,
    'Đang sử dụng',
  ])
  await expect(cells('Mã chào hè')).toHaveText([
    'Mã chào hè',
    'Mã giảm giá',
    'CHAOHE',
    'Giảm 15.000 ₫ trên đơn',
    '—',
    /^\d+$/,
    'Đang sử dụng',
  ])
  // A card's reward is bought with points.
  await expect(cells('Thẻ thành viên').nth(3)).toHaveText('50 điểm: Giảm 20.000 ₫ trên đơn')
  // Xuất CSV downloads the same columns.
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Xuất CSV', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('promotions.csv')
  const csv = await readFile(await file.path(), 'utf8')
  expect(csv.split('\r\n')[0]).toContain('"Tên chương trình","Loại","Mã","Phần thưởng"')
  expect(csv).toContain('"Mã chào hè","Mã giảm giá","CHAOHE"')
})

test('a program page keeps the 12px page gutter, lays fields in two columns and sums up the reward', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/promotions')
  await settled(page)
  await page.getByRole('link', { name: 'Mã chào hè', exact: true }).click()
  const record = page.locator('[data-ui="record-page"]')
  await expect(record.getByRole('heading', { level: 1 })).toHaveText('Mã chào hè')
  // The page owns the gutter: the content pane adds none of its own, so the gutter is 12px, not 24px.
  const padding = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).paddingLeft)
  expect(await padding('[data-ui="content"]')).toBe('0px')
  expect(await padding('[data-ui="record-page-header"]')).toBe('12px')
  const main = await page.locator('[data-ui="app-main"]').boundingBox()
  const heading = await record.getByRole('heading', { level: 1 }).boundingBox()
  expect(Math.round(heading!.x - main!.x)).toBe(12)
  // The type sits under the name and the reward is summed up above the form, as in the mock.
  await expect(record.locator('[data-ui="record-page-header"]')).toContainText('Mã giảm giá')
  await expect(record.getByText('Giảm 15.000 ₫ trên đơn', { exact: true })).toBeVisible()
  // Two columns: the name and the type share a row.
  const name = await page.getByLabel('Tên chương trình').boundingBox()
  const kind = await page.locator('#promotion-programType').boundingBox()
  expect(Math.abs(name!.y - kind!.y)).toBeLessThan(4)
  expect(kind!.x).toBeGreaterThan(name!.x + name!.width)
})
