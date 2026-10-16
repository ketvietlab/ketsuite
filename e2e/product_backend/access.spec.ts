import type { Locator } from '@playwright/test'
import { DESKTOP, expect, listReady, productRow, recordReady, signIn, test } from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

test('who may only view the catalogue reads it, with nothing to change', async ({ page }) => {
  await signIn(page, 'viewer')
  await listReady(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Sản phẩm' })).toBeVisible()
  await expect(productRow(page, 'Serum B5 phục hồi 30ml')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tạo sản phẩm' })).toHaveCount(0)
  // Nothing to archive in bulk, so nothing to select.
  await expect(page.locator('[data-product-list="true"] input[type="checkbox"]')).toHaveCount(0)
})

test('who may only view sees no way to create an attribute or a unit', async ({ page }) => {
  await signIn(page, 'viewer', '/admin/product/attributes')
  await expect(page.getByRole('row', { name: /^Dung tích/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Thuộc tính mới' })).toHaveCount(0)
  await page.goto('/admin/product/uoms')
  await expect(page.getByRole('link', { name: 'Hộp 6 cái', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tạo đơn vị' })).toHaveCount(0)
})

test('who may read the catalogue but not stock still gets the list, from the catalogue', async ({ page }) => {
  await signIn(page, 'reader')
  await listReady(page)
  await expect(productRow(page, 'Serum B5 phục hồi 30ml')).toBeVisible()
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(30)
})

test('who may only view opens a product without the commands that change it', async ({ page }) => {
  await signIn(page, 'viewer', '/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  await expect(page.getByRole('button', { name: 'Về danh sách' })).toBeVisible()
  for (const name of ['Lưu thay đổi', 'Nhân bản', 'Lưu trữ', 'Thêm ảnh', 'Cấu hình thuộc tính'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  // The conversation and activities are for who may follow the product; a viewer gets neither panel.
  await expect(page.getByRole('heading', { level: 2, name: 'Hoạt động', exact: true })).toHaveCount(0)
})

/** Whether each picture in the region has loaded, by its address: a broken one is `false`. */
const pictures = (region: Locator) =>
  region
    .locator('img')
    .evaluateAll((images) =>
      images.map((image) => [
        image.getAttribute('src'),
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
      ]),
    )

test('who may see product images sees them, on the list and on the product', async ({ page }) => {
  await signIn(page, 'viewer')
  await listReady(page)
  await expect
    .poll(() => pictures(productRow(page, 'Serum B5 phục hồi 30ml')))
    .toEqual([['/admin/product/images/serum-front-file', true]])
  await page.goto('/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  const gallery = page.getByRole('group', { name: 'Hình ảnh' })
  await expect(gallery.getByRole('figure')).toHaveCount(2)
  await expect.poll(async () => (await pictures(gallery)).every(([, loaded]) => loaded)).toBe(true)
})

test('who may not see product images is shown none, not a broken picture for each', async ({ page }) => {
  await signIn(page, 'reader')
  await listReady(page)
  await expect(productRow(page, 'Serum B5 phục hồi 30ml')).toBeVisible()
  await expect(page.locator('[data-product-list="true"] img')).toHaveCount(0)
  await page.goto('/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  await expect(page.getByRole('heading', { level: 2, name: 'Hình ảnh', exact: true })).toHaveCount(0)
  await expect(page.locator('main img')).toHaveCount(0)
})

test('the inbox and activity counts are for who may read them', async ({ page }) => {
  await signIn(page, 'admin')
  await listReady(page)
  await expect(page.locator('[data-ui="mail-indicator"]')).toHaveCount(1)
  await expect(page.locator('[data-ui="activity-indicator"]')).toHaveCount(1)
  await page.context().clearCookies()
  await signIn(page, 'viewer')
  await listReady(page)
  await expect(page.locator('[data-ui="mail-indicator"]')).toHaveCount(0)
  await expect(page.locator('[data-ui="activity-indicator"]')).toHaveCount(0)
})

test('the server refuses a change from who may only view, whatever the screen shows', async ({ page }) => {
  await signIn(page, 'viewer', '/admin/product/templates/serum')
  const answer = await page.request.post('/_ket/fn/product.archiveTemplate', {
    data: { id: 'serum', active: false, confirmed: true, expectedRevisionId: 'initial' },
  })
  expect(answer.status()).toBe(403)
})

test('who has no part in the catalogue is told so, not shown an empty list', async ({ page, ui }) => {
  // The refusal is what this test is about: the screens answer 403 and say so, and the
  // page keeps the error code under the message for whoever they ask for help.
  ui.allow(/^403 GET \/admin\/product\/templates(\/serum)?$/u, 'the screens refuse an outsider')
  ui.allow(
    /^last screen alert: (E_FN_NOT_PERMITTED )?Bạn không có quyền mở màn hình này/u,
    'the refusal is the message',
  )
  ui.allow(/^last screen on screen: E_FN_NOT_PERMITTED$/u, 'the code stays on the page for support')
  await signIn(page, 'outsider')
  const refusal = page.getByRole('alert')
  await expect(refusal).toContainText('Bạn không có quyền mở màn hình này')
  await expect(refusal.getByRole('link', { name: 'Quay lại trang đầu' })).toHaveAttribute('href', '/admin')
  await expect(page.locator('[data-product-list="true"]')).toHaveCount(0)

  await page.goto('/admin/product/templates/serum')
  await expect(page.getByRole('alert')).toContainText('Bạn không có quyền mở màn hình này')
  await expect(page.getByRole('heading', { level: 1, name: 'Serum B5 phục hồi 30ml' })).toHaveCount(0)
})
