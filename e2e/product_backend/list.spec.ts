import {
  DESKTOP,
  evidence,
  expect,
  fitsWidth,
  listReady,
  MOBILE,
  pickFromMenu,
  productRow,
  rowNames,
  signIn,
  test,
} from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })
test.beforeEach(async ({ page }) => {
  await signIn(page)
  await listReady(page)
})

test('the list is three islands in the page slots: the bar, the rows and the pager', async ({
  page,
}, info) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Sản phẩm' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tạo sản phẩm' })).toHaveAttribute(
    'href',
    /\/admin\/product\/templates\/new\b/,
  )
  const controls = page.locator('[data-ui="list-page-controls"]')
  await expect(controls.locator('[data-island="product.template-list-controls"]')).toHaveCount(1)
  await expect(controls.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' })).toHaveAttribute(
    'placeholder',
    'Tìm mã, tên sản phẩm…',
  )
  const body = page.locator('[data-ui="list-page-body"]')
  await expect(body.locator('[data-island="product.template-list"]')).toHaveCount(1)
  await expect(body.getByRole('search')).toHaveCount(0)
  await expect(body.locator('tbody tr')).toHaveCount(30)
  const footer = page.locator('[data-ui="list-page-footer"]')
  await expect(footer.locator('[data-island="product.template-list-footer"]')).toHaveCount(1)
  await expect(footer.getByRole('link', { name: 'Trang sau' })).toBeVisible()
  // The name column is sorted A→Z by default and says so.
  await expect(page.getByRole('link', { name: 'Sản phẩm, sắp xếp giảm dần' })).toBeVisible()
  await evidence(page, info, 'list-desktop')
})

test('searches by name and by code as the user types, with no button to press', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' })
  await search.fill('serum')
  await expect(page).toHaveURL(/[?&]q=serum\b/)
  await listReady(page)
  expect(await rowNames(page)).toEqual(['Serum B5 phục hồi 30ml'])

  await search.fill('MAU-07')
  await expect(page).toHaveURL(/[?&]q=MAU-07\b/)
  await listReady(page)
  expect(await rowNames(page)).toEqual(['Sản phẩm mẫu 07'])

  await search.fill('không có sản phẩm này')
  await listReady(page)
  await expect(page.locator('[data-product-list="true"]')).toContainText('không có sản phẩm này')
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(0)
})

test('filters by type and by status, and clears the filters', async ({ page }) => {
  await pickFromMenu(page, /^Loại:/, 'Dịch vụ')
  await expect(page).toHaveURL(/preset=/)
  await listReady(page)
  expect(await rowNames(page)).toEqual(['Dịch vụ soi da'])
  await page.getByRole('button', { name: 'Xoá bộ lọc' }).click()
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(30)

  await pickFromMenu(page, /^Trạng thái:/, 'Hết hàng')
  await listReady(page)
  await expect(productRow(page, 'Bông tẩy trang 120 miếng')).toHaveCount(1)
  await expect(productRow(page, 'Serum B5 phục hồi 30ml')).toHaveCount(0)

  await page.getByRole('button', { name: 'Xoá bộ lọc' }).click()
  await pickFromMenu(page, /^Trạng thái:/, 'Có thể bán')
  await listReady(page)
  await expect(productRow(page, 'Niacinamide nguyên liệu')).toHaveCount(0)
  await expect(productRow(page, 'Serum B5 phục hồi 30ml')).toHaveCount(1)

  // Archived products stay out of the list until asked for.
  await page.getByRole('button', { name: 'Xoá bộ lọc' }).click()
  await page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' }).fill('Mặt nạ')
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(0)
  await pickFromMenu(page, /^Trạng thái:/, 'Bao gồm đã lưu trữ')
  await listReady(page)
  await expect(productRow(page, 'Mặt nạ ngừng bán')).toHaveCount(1)
})

test('sorts from the column headers', async ({ page }) => {
  await page.getByRole('link', { name: 'Giá bán, sắp xếp tăng dần' }).click()
  await expect(page).toHaveURL(/sort=listPrice/)
  await listReady(page)
  expect((await rowNames(page))[0]).toBe('Bông tẩy trang 120 miếng')
  await page.getByRole('link', { name: 'Giá bán, sắp xếp giảm dần' }).click()
  await listReady(page)
  expect((await rowNames(page))[0]).toBe('Niacinamide nguyên liệu')
})

test('groups by category', async ({ page }, info) => {
  await pickFromMenu(page, /^Nhóm:/, 'Danh mục')
  await expect(page).toHaveURL(/group=/)
  await listReady(page)
  const groups = page.locator('[data-product-list="true"] [data-ui="kt-group-row"]')
  await expect(groups.filter({ hasText: 'Chăm sóc da' })).toHaveCount(1)
  await expect(groups.filter({ hasText: 'Nguyên liệu' })).toHaveCount(1)
  await evidence(page, info, 'list-grouped')
})

test('pages forward and back', async ({ page }) => {
  const first = await rowNames(page)
  await page.getByRole('link', { name: 'Trang sau' }).click()
  await expect(page).toHaveURL(/page=2/)
  await listReady(page)
  const second = await rowNames(page)
  expect(second.length).toBeGreaterThan(0)
  expect(second.some((name) => first.includes(name))).toBe(false)
  await page.getByRole('link', { name: 'Trang trước' }).click()
  await listReady(page)
  expect(await rowNames(page)).toEqual(first)
})

test('switches to cards and back to the table', async ({ page }, info) => {
  await page.getByRole('link', { name: 'Dạng thẻ' }).click()
  await expect(page).toHaveURL(/view=kanban/)
  await expect(page.getByRole('link', { name: 'Dạng thẻ' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-product-list="true"] table')).toHaveCount(0)
  await expect(page.locator('[data-product-list="true"]')).toContainText('Serum B5 phục hồi 30ml')
  await evidence(page, info, 'list-cards')
  await page.getByRole('link', { name: 'Dạng bảng' }).click()
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] table')).toHaveCount(1)
})

test('opens a product on its page and comes back to the same search', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' }).fill('serum')
  await expect(page).toHaveURL(/q=serum/)
  await listReady(page)
  await productRow(page, 'Serum B5 phục hồi 30ml').getByRole('link').first().click()
  await expect(page).toHaveURL(/\/admin\/product\/templates\/serum(?:\?|$)/)
  await expect(page.getByRole('heading', { level: 1, name: 'Serum B5 phục hồi 30ml' })).toBeVisible()
  await page.getByRole('button', { name: 'Về danh sách' }).click()
  await expect(page).toHaveURL(/\/admin\/product\/templates\?.*q=serum/)
  await listReady(page)
  expect(await rowNames(page)).toEqual(['Serum B5 phục hồi 30ml'])
})

test('ticking the checkbox cell selects the row without opening it', async ({ page }) => {
  const row = productRow(page, 'Serum B5 phục hồi 30ml')
  await row.getByRole('checkbox').check()
  await expect(page).toHaveURL(/\/admin\/product\/templates(?:\?|$)/)
  await expect(page.getByRole('checkbox', { name: 'Chọn tất cả dòng' })).toHaveJSProperty(
    'indeterminate',
    true,
  )
  await page.getByRole('checkbox', { name: 'Chọn tất cả dòng' }).check()
  await expect(
    page.locator('[data-product-list="true"] tbody input[type="checkbox"]:not(:checked)'),
  ).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Chọn tất cả dòng' }).uncheck()
  await expect(page.locator('[data-product-list="true"] tbody input[type="checkbox"]:checked')).toHaveCount(0)
})

test('archives the selected products after a confirmation', async ({ page }, info) => {
  await page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' }).fill('Lotion')
  await listReady(page)
  await productRow(page, 'Lotion hàng loạt').getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Lưu trữ' }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm).toBeVisible()
  await evidence(page, info, 'bulk-archive-confirm')
  await confirm.getByRole('button', { name: 'Lưu trữ' }).click()
  await listReady(page)
  await expect(productRow(page, 'Lotion hàng loạt')).toHaveCount(0)
  await pickFromMenu(page, /^Trạng thái:/, 'Bao gồm đã lưu trữ')
  await listReady(page)
  await expect(productRow(page, 'Lotion hàng loạt')).toHaveCount(1)
})

test('saves the current filter, reopens it, makes it the default and deletes it', async ({ page }) => {
  const search = page.getByRole('search', { name: 'Tìm và lọc sản phẩm' })
  const saved = search.getByRole('button', { name: /^Đã lưu/ })
  await pickFromMenu(page, /^Loại:/, 'Dịch vụ')
  await listReady(page)
  await saved.click()
  await search.getByRole('link', { name: 'Lưu bộ lọc này' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lưu tìm kiếm hiện tại' })
  await dialog.getByRole('textbox', { name: 'Tên' }).fill('Dịch vụ của tôi')
  await dialog.getByRole('button', { name: 'Lưu yêu thích' }).click()
  await listReady(page)
  await expect(search.getByRole('button', { name: 'Đã lưu: Dịch vụ của tôi' })).toBeVisible()
  await expect(search.getByRole('button', { name: 'Loại: Dịch vụ' })).toBeVisible()
  expect(await rowNames(page)).toEqual(['Dịch vụ soi da'])

  // A fresh list is unfiltered until the saved filter is picked again.
  await page.goto('/admin/product/templates')
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(30)
  await saved.click()
  await search.getByRole('button', { name: 'Dịch vụ của tôi', exact: true }).click()
  await listReady(page)
  await expect(search.getByRole('button', { name: 'Loại: Dịch vụ' })).toBeVisible()
  expect(await rowNames(page)).toEqual(['Dịch vụ soi da'])

  // As the default, it is where the list opens.
  await saved.click()
  const makeDefault = search.getByRole('button', { name: 'Đặt làm mặc định' })
  await makeDefault.click()
  // The star fills only once the server has accepted the change.
  await expect(makeDefault).toHaveAttribute('data-default', 'true')
  await expect(search.getByRole('alert')).toHaveCount(0)
  await page.goto('/admin/product/templates')
  await expect(page).toHaveURL(/favorite=/)
  await listReady(page)
  expect(await rowNames(page)).toEqual(['Dịch vụ soi da'])

  // Deleted, the list opens unfiltered again for the specs that follow.
  await saved.click()
  await search.getByRole('button', { name: 'Xóa: Dịch vụ của tôi' }).click()
  await expect(search.getByRole('button', { name: 'Dịch vụ của tôi', exact: true })).toHaveCount(0)
  await expect(search.getByRole('alert')).toHaveCount(0)
  await page.goto('/admin/product/templates')
  await expect(page).not.toHaveURL(/favorite=/)
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(30)
})

test('reads in English', async ({ page }) => {
  await page.goto('/admin/product/templates?lang=en')
  await listReady(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create product' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search and filter products' })).toHaveAttribute(
    'placeholder',
    'Search code or product name…',
  )
})

test.describe('on a phone', () => {
  test.use({ viewport: MOBILE })

  test('keeps the search and the rows in the width of the screen', async ({ page }, info) => {
    await expect(page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' })).toBeVisible()
    await expect(productRow(page, 'Serum B5 phục hồi 30ml')).toBeVisible()
    await fitsWidth(page)
    await evidence(page, info, 'list-mobile')
  })
})
