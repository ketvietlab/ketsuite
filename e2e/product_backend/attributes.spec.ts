import type { Page } from '@playwright/test'
import { DESKTOP, expect, refusedAsEmpty, settled, signIn, test } from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const ATTRIBUTES = '/admin/product/attributes'
const row = (page: Page, name: string) => page.getByRole('row', { name: new RegExp(`^${name}\\b`) })

test('lists every attribute with its values, how it shows and whether it makes variants', async ({
  page,
}) => {
  await signIn(page, 'admin', ATTRIBUTES)
  await expect(page.getByRole('heading', { level: 1, name: 'Thuộc tính sản phẩm' })).toBeVisible()
  await expect(row(page, 'Dung tích')).toContainText('15ml')
  await expect(row(page, 'Dung tích')).toContainText('Danh sách chọn')
  await expect(row(page, 'Dung tích')).toContainText('Luôn tạo biến thể')
  await expect(row(page, 'Tông màu')).toContainText('Hồng đất')
  await expect(row(page, 'Tông màu')).toContainText('Màu sắc')
  await expect(row(page, 'Mùi hương')).toContainText('Chưa có giá trị')
  await expect(row(page, 'Mùi hương')).toContainText('Không tạo biến thể')
})

test('search narrows the attributes', async ({ page }) => {
  await signIn(page, 'admin', ATTRIBUTES)
  await settled(page)
  await page.getByRole('searchbox', { name: 'Tìm thuộc tính…' }).fill('tông')
  await page.getByRole('searchbox', { name: 'Tìm thuộc tính…' }).press('Enter')
  await expect(row(page, 'Tông màu')).toBeVisible()
  await expect(row(page, 'Dung tích')).toHaveCount(0)
})

test('creates an attribute with its values', async ({ page }) => {
  await signIn(page, 'admin', ATTRIBUTES)
  await page.getByRole('link', { name: 'Thuộc tính mới' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thuộc tính mới' })
  await dialog.getByRole('textbox', { name: 'Tên', exact: true }).fill('Chất liệu')
  await dialog.getByRole('combobox', { name: 'Kiểu hiển thị' }).selectOption({ label: 'Nút dạng thẻ' })
  const values = dialog.getByRole('list', { name: 'Giá trị' })
  for (const value of ['Giấy', 'Nhựa']) {
    await dialog.getByRole('button', { name: 'Thêm giá trị' }).click()
    await values.getByRole('textbox', { name: 'Tên giá trị' }).last().fill(value)
  }
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(row(page, 'Chất liệu')).toContainText('Giấy')
  await expect(row(page, 'Chất liệu')).toContainText('Nhựa')
  await expect(row(page, 'Chất liệu')).toContainText('Nút dạng thẻ')
})

test('an attribute without a name is not created', async ({ page }) => {
  await signIn(page, 'admin', `${ATTRIBUTES}?record=product.attribute%3Anew`)
  const dialog = page.getByRole('dialog', { name: 'Thuộc tính mới' })
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await refusedAsEmpty(dialog.getByRole('textbox', { name: 'Tên', exact: true }))
  await expect(dialog).toBeVisible()
})

test('adds a value to an attribute that had none', async ({ page }) => {
  await signIn(page, 'admin', ATTRIBUTES)
  await row(page, 'Mùi hương').getByRole('link', { name: 'Mùi hương' }).click()
  const dialog = page.getByRole('dialog', { name: 'Mùi hương' })
  await dialog.getByRole('button', { name: 'Thêm giá trị' }).click()
  await dialog
    .getByRole('list', { name: 'Giá trị' })
    .getByRole('textbox', { name: 'Tên giá trị' })
    .fill('Trà xanh')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(row(page, 'Mùi hương')).toContainText('Trà xanh')
})

test('a value list that allows several picks cannot make variants', async ({ page, ui }) => {
  ui.allow(/^\d{3} POST /u, 'the attribute is refused on purpose')
  await signIn(page, 'admin', `${ATTRIBUTES}?record=product.attribute%3Anew`)
  const dialog = page.getByRole('dialog', { name: 'Thuộc tính mới' })
  await settled(page)
  await dialog.getByRole('textbox', { name: 'Tên', exact: true }).fill('Thành phần')
  await dialog.getByRole('combobox', { name: 'Kiểu hiển thị' }).selectOption({ label: 'Chọn nhiều' })
  await dialog.getByRole('combobox', { name: 'Tạo biến thể' }).selectOption({ label: 'Luôn tạo biến thể' })
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).toContainText('Nhiều ô chọn chỉ dùng với Không tạo biến thể.')
  await expect(dialog).toBeVisible()
  await page.goto(ATTRIBUTES)
  await expect(row(page, 'Thành phần')).toHaveCount(0)
})

test('an attribute products use keeps how it makes variants, stays active and keeps its used values', async ({
  page,
  ui,
}) => {
  ui.allow(/^\d{3} POST /u, 'removing a used value is refused on purpose')
  await signIn(page, 'admin', ATTRIBUTES)
  await expect(row(page, 'Kích cỡ áo')).toContainText('S')
  await expect(row(page, 'Kích cỡ áo')).toContainText('Luôn tạo biến thể')
  await row(page, 'Kích cỡ áo').getByRole('link', { name: 'Kích cỡ áo' }).click()
  const dialog = page.getByRole('dialog', { name: 'Kích cỡ áo' })
  await expect(dialog.getByRole('combobox', { name: 'Tạo biến thể' })).toBeDisabled()
  await expect(dialog).toContainText(
    'Không thể đổi cách tạo biến thể khi thuộc tính đang được sản phẩm sử dụng.',
  )
  await expect(dialog.getByRole('button', { name: 'Lưu trữ' })).toBeDisabled()

  const values = dialog.getByRole('list', { name: 'Giá trị' })
  // S, M, L: M is in stock on one product and on sale on others.
  const m = values.getByRole('listitem').nth(1)
  await expect(m.getByRole('textbox', { name: 'Tên giá trị' })).toHaveValue('M')
  await m.getByRole('button', { name: 'Gỡ giá trị' }).click()
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).toContainText('Không thể xoá giá trị đang được sản phẩm sử dụng.')
})

test('renaming a value renames the variants made from it', async ({ page }) => {
  await signIn(page, 'admin', ATTRIBUTES)
  await row(page, 'Loại khăn').getByRole('link', { name: 'Loại khăn' }).click()
  const dialog = page.getByRole('dialog', { name: 'Loại khăn' })
  const names = dialog.getByRole('list', { name: 'Giá trị' }).getByRole('textbox', { name: 'Tên giá trị' })
  await expect(names.nth(1)).toHaveValue('Tre')
  await names.nth(1).fill('Sợi tre')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.goto('/admin/product/templates/towel-face')
  await expect(page.getByRole('heading', { level: 1, name: 'Khăn mặt hai chất liệu' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Biến thể' })
  await expect(table.getByRole('link', { name: 'Sợi tre' })).toBeVisible()
  await expect(table.getByRole('link', { name: 'Tre', exact: true })).toHaveCount(0)
})
