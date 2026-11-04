import { DESKTOP, expect, recordReady, settled, signIn, test } from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

test('a successful cost save refreshes the retained input together with its margin', async ({
  page,
}, _info) => {
  await signIn(page, 'admin', '/admin/product/templates/cost-refresh')
  await recordReady(page, 'Cost refresh specimen')
  const cost = page.getByRole('textbox', { name: 'Giá vốn', exact: true })
  await expect(cost).toHaveValue('100.000')
  await cost.fill('120.000')
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await expect(cost).toHaveValue('120.000')
  await expect(page.getByRole('article').filter({ hasText: 'Biên lợi nhuận' })).toContainText('52%')
  await page.reload()
  await settled(page)
  await expect(cost).toHaveValue('120.000')
})

test('physical stock locks cost and stock setup while allowing other product edits', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  await expect(page.getByRole('textbox', { name: 'Giá vốn', exact: true })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'Theo dõi tồn kho', exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Truy xuất', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Tên sản phẩm', exact: true })).toBeEnabled()
})
