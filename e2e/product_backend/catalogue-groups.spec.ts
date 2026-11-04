import type { Page } from '@playwright/test'
import { DESKTOP, expect, listReady, productRow, recordReady, settled, signIn, test } from './support.js'

// C9 (P39–P42): product categories as a tree named by their full path, who may rename or move
// one and who only sets its accounts; product tags, chosen on the product page, filtered and
// searched on the list, an archived one kept where it is already used.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const CATEGORIES = '/admin/product/categories'
const TAGS = '/admin/product/tags'
const categoryRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })
const categoriesReady = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Nhóm sản phẩm' })).toBeVisible()
  await expect(categoryRow(page, 'Chăm sóc da')).toBeVisible()
  await settled(page)
}
const menu = (page: Page, name: string) => page.locator(`[id$="-${name}-relation-menu"]`)

test('a category is listed by its full name; filtering by it includes its children’s products', async ({
  page,
}) => {
  await signIn(page, 'admin', CATEGORIES)
  await categoriesReady(page)
  await expect(categoryRow(page, 'Chăm sóc da / Làm sạch')).toContainText('1')
  // The parent's products include the child's: the list filtered by "Chăm sóc da" shows a
  // product filed only under "Chăm sóc da / Làm sạch".
  const filter = Buffer.from(
    JSON.stringify({ kind: 'rule', field: 'categoryId', operator: 'equals', value: 'skincare' }),
  ).toString('base64url')
  await page.goto(`/admin/product/templates?filter=${filter}&q=${encodeURIComponent('sữa rửa mặt')}`)
  await listReady(page)
  await expect(productRow(page, 'Sữa rửa mặt tạo bọt')).toContainText('Chăm sóc da / Làm sạch')
})

test('a new category refuses a slash and a name its parent already has, in any case', async ({ page }) => {
  await signIn(page, 'admin', CATEGORIES)
  await categoriesReady(page)
  await page.getByRole('link', { name: 'Tạo nhóm' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nhóm sản phẩm mới' })
  await expect(dialog).toBeVisible()
  await settled(page)
  // The parent and the accounts are pickers, not native selects.
  await expect(dialog.getByRole('combobox')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Nhóm cha' }).click()
  await menu(page, 'parent').getByRole('option', { name: 'Chăm sóc da', exact: true }).click()
  const name = dialog.getByRole('textbox', { name: 'Tên nhóm' })
  const create = dialog.getByRole('button', { name: 'Tạo nhóm' })

  await name.fill('Mặt / Môi')
  await create.click()
  await expect(dialog).toContainText('Tên nhóm không được chứa dấu /.')
  await name.fill('LÀM SẠCH')
  await create.click()
  await expect(dialog).toContainText('Đã có nhóm cùng tên trong nhóm cha này.')
  await name.fill('Tẩy trang')
  await create.click()
  await expect(dialog).toBeHidden()
  await expect(categoryRow(page, 'Chăm sóc da / Tẩy trang')).toBeVisible()
})

test('a category cannot move under itself or its child, nor be archived while in use', async ({ page }) => {
  await signIn(page, 'admin', CATEGORIES)
  await categoriesReady(page)
  await categoryRow(page, 'Chăm sóc da').getByRole('link', { name: 'Chăm sóc da', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa nhóm sản phẩm' })
  await expect(dialog).toBeVisible()
  await settled(page)
  await dialog.getByRole('button', { name: 'Nhóm cha' }).click()
  const parents = menu(page, 'parent').getByRole('option')
  await expect(parents.filter({ hasText: 'Nguyên liệu' })).toHaveCount(1)
  await expect(parents.filter({ hasText: 'Chăm sóc da' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // Products and a child still use it: archiving waits until they leave.
  await expect(dialog).toContainText(
    'Chỉ lưu trữ sau khi không còn sản phẩm, nhóm con hoặc bảng giá đang dùng.',
  )
  await expect(dialog.getByRole('button', { name: 'Lưu trữ' })).toBeDisabled()
})

test('the accountant sets a category’s accounts but neither renames nor moves it', async ({ page }) => {
  await signIn(page, 'bookkeeper', CATEGORIES)
  await categoriesReady(page)
  await expect(page.getByRole('link', { name: 'Tạo nhóm' })).toHaveCount(0)
  await categoryRow(page, 'Chăm sóc da / Làm sạch').getByRole('link').first().click()
  const dialog = page.getByRole('dialog', { name: 'Sửa nhóm sản phẩm' })
  await expect(dialog).toBeVisible()
  await settled(page)
  await expect(dialog.getByRole('textbox', { name: 'Tên nhóm' })).not.toBeEditable()
  await expect(dialog.getByRole('button', { name: 'Nhóm cha' })).toBeDisabled()
  const income = dialog.getByRole('button', { name: 'Tài khoản doanh thu' })
  await expect(income).toBeEnabled()
  await income.click()
  await menu(page, 'income').getByRole('option', { name: /^5118/ }).click()
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()
  await expect(categoryRow(page, 'Chăm sóc da / Làm sạch')).toContainText('5118')
})

test('a tag name is unique across active and archived tags', async ({ page }) => {
  await signIn(page, 'admin', TAGS)
  await expect(page.getByRole('heading', { level: 1, name: 'Thẻ sản phẩm' })).toBeVisible()
  await settled(page)
  await page.getByRole('link', { name: 'Tạo thẻ' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thẻ sản phẩm mới' })
  await expect(dialog).toBeVisible()
  await settled(page)
  const name = dialog.getByRole('textbox', { name: 'Tên thẻ' })
  const create = dialog.getByRole('button', { name: 'Tạo thẻ' })
  for (const taken of ['bán chạy', 'HÀNG CŨ']) {
    await name.fill(taken)
    await create.click()
    await expect(dialog).toContainText('Đã có thẻ cùng tên, kể cả thẻ đã lưu trữ.')
  }
  await name.fill('Mới')
  await create.click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: /^Mới/ })).toHaveCount(1)
})

test('the product page chooses active tags and keeps an archived one it already carries', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/product/templates/foam-clean')
  await recordReady(page, 'Sữa rửa mặt tạo bọt')
  await settled(page)
  // A category reads by its full name here too (P40).
  await expect(page.getByRole('button', { name: 'Nhóm sản phẩm' })).toContainText('Chăm sóc da / Làm sạch')
  const field = page.getByRole('group', { name: 'Thẻ sản phẩm' })
  await expect(field).toContainText('Bán chạy')
  await expect(field).toContainText('Hàng cũ')
  await field.getByRole('button').first().click()
  const options = menu(page, 'tagIds').getByRole('option')
  await expect(options.filter({ hasText: 'Da nhạy cảm' })).toHaveCount(1)
  // The archived tag this product carries stays chosen; it is offered to no other product.
  await expect(options.filter({ hasText: 'Hàng cũ' })).toHaveAttribute('aria-selected', 'true')
  await options.filter({ hasText: 'Da nhạy cảm' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await settled(page)
  // Read back from the server: the saved product carries all three.
  await page.reload()
  await recordReady(page, 'Sữa rửa mặt tạo bọt')
  for (const tag of ['Bán chạy', 'Da nhạy cảm', 'Hàng cũ']) await expect(field).toContainText(tag)
})

test('the product list filters by a tag, archived ones too, and finds products by tag name', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/product/templates')
  await listReady(page)
  await settled(page)
  await page.getByRole('button', { name: 'Thẻ: Mọi thẻ' }).click()
  await page.getByRole('menuitemradio', { name: 'Hàng cũ' }).click()
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(1)
  await expect(productRow(page, 'Sữa rửa mặt tạo bọt')).toBeVisible()

  await page.goto(`/admin/product/templates?q=${encodeURIComponent('ban chay')}`)
  await listReady(page)
  await expect(productRow(page, 'Sữa rửa mặt tạo bọt')).toBeVisible()
})

test('an archived tag is not offered to a product that does not carry it', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  await settled(page)
  await page
    .getByRole('group', { name: 'Thẻ sản phẩm' })
    .getByRole('button', { name: 'Thẻ sản phẩm' })
    .click()
  const options = menu(page, 'tagIds').getByRole('option')
  await expect(options.filter({ hasText: 'Bán chạy' })).toHaveCount(1)
  await expect(options.filter({ hasText: 'Hàng cũ' })).toHaveCount(0)
})

test('the product page’s category picker finds a category typed without accents', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  await settled(page)
  await page.getByRole('button', { name: 'Nhóm sản phẩm' }).click()
  await page.getByRole('button', { name: 'Xem thêm…' }).click()
  const browse = page.getByRole('dialog', { name: 'Nhóm sản phẩm' })
  // Typed without accents, as people do.
  await browse.getByRole('searchbox').fill('lam sach')
  const found = browse.getByRole('listitem').filter({ hasText: 'Chăm sóc da / Làm sạch' })
  await found.getByRole('button', { name: 'Chọn' }).click()
  await expect(page.getByRole('button', { name: 'Nhóm sản phẩm' })).toContainText('Chăm sóc da / Làm sạch')
})
