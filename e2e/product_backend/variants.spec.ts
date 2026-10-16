import { DESKTOP, expect, recordReady, signIn, test } from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

test('configuring an attribute turns the chosen values into variants', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/mist-variants')
  await recordReady(page, 'Xịt khoáng nhiều dung tích')
  await expect(page.getByText('Sản phẩm chưa có biến thể')).toBeVisible()
  await page.getByRole('button', { name: 'Cấu hình thuộc tính' }).click()

  const dialog = page.getByRole('dialog', { name: 'Cấu hình thuộc tính' })
  // Only attributes that make variants are offered here.
  const add = dialog.getByRole('combobox', { name: 'Thêm thuộc tính' })
  await expect(add.getByRole('option', { name: 'Mùi hương' })).toHaveCount(0)
  await add.selectOption({ label: 'Dung tích' })
  await expect(dialog.getByRole('heading', { name: 'Dung tích' })).toBeVisible()
  const values = dialog.getByRole('group', { name: 'Giá trị' })
  await values.getByRole('checkbox', { name: '15ml' }).check()
  await values.getByRole('checkbox', { name: '50ml' }).check()
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toBeHidden()

  const table = page.getByRole('table', { name: 'Biến thể' })
  await expect(table.getByRole('link', { name: '15ml' })).toBeVisible()
  await expect(table.getByRole('link', { name: '50ml' })).toBeVisible()
  await expect(table.getByRole('link', { name: '30ml' })).toHaveCount(0)

  await page.reload()
  await recordReady(page, 'Xịt khoáng nhiều dung tích')
  await expect(page.getByRole('table', { name: 'Biến thể' }).getByRole('row')).toHaveCount(3)
})

test('cancelling the configuration asks first, then leaves the product as it was', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/gel-variants')
  await recordReady(page, 'Gel rửa mặt hai dung tích')
  await page.getByRole('button', { name: 'Cấu hình thuộc tính' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cấu hình thuộc tính' })
  await dialog.getByRole('group', { name: 'Giá trị' }).getByRole('checkbox', { name: '50ml' }).check()
  // The record runtime asks with the browser's own confirm before it drops a change.
  const asked: string[] = []
  page.once('dialog', async (question) => {
    asked.push(question.message())
    await question.accept()
  })
  await dialog.getByRole('button', { name: 'Hủy' }).click()
  await expect.poll(() => asked).toEqual(['Bỏ các thay đổi chưa lưu?'])
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('table', { name: 'Biến thể' }).getByRole('link', { name: '50ml' })).toHaveCount(
    0,
  )
})

test('edits one variant in its dialog: code, barcode and cost', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/gel-variants')
  await recordReady(page, 'Gel rửa mặt hai dung tích')
  const table = page.getByRole('table', { name: 'Biến thể' })
  await table.getByRole('link', { name: '15ml' }).click()

  const dialog = page.getByRole('dialog', { name: 'Sửa biến thể · 15ml' })
  await dialog.getByRole('textbox', { name: 'Mã nội bộ' }).fill('GEL-15')
  await dialog.getByRole('textbox', { name: 'Barcode' }).fill('8938501230029')
  await dialog.getByRole('textbox', { name: 'Giá vốn' }).fill('80000')
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()

  const row = table.getByRole('row', { name: /^15ml/ })
  await expect(row).toContainText('GEL-15')
  await expect(row).toContainText('8938501230029')
  await expect(row).toContainText('80.000 ₫')

  await page.reload()
  await recordReady(page, 'Gel rửa mặt hai dung tích')
  await expect(
    page.getByRole('table', { name: 'Biến thể' }).getByRole('row', { name: /^15ml/ }),
  ).toContainText('GEL-15')
})

test('a variant has its own page, reached from the product images', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/cream?tab=media')
  const row = page.getByRole('row', { name: /^30ml/ })
  await row.getByRole('link', { name: 'Chỉnh sửa hình ảnh biến thể' }).click()
  await expect(page).toHaveURL(/\/admin\/product\/templates\/cream\/variants\/cream:capacity-30ml\b/)
  await recordReady(page, '30ml')
  await expect(page.getByText('Mẫu sản phẩm: Kem dưỡng ẩm ban đêm')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Nội dung biến thể' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Hình ảnh' })).toBeVisible()
})
