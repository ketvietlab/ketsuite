import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// C30 (K21), on the Commerce deployment. Fixture: order-bound sold 2 gift bags to Spa Hoa Mai and its
// delivery is confirmed. The order is the spec's own.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const record = (page: Page) => page.locator('[data-ui="record-page"]')
const fact = (page: Page, label: string) => record(page).locator(`dt:text-is("${label}") + dd`)

test('a sales delivery keeps its type, locations and products; its priority changes', async ({ page }) => {
  await signIn(page, 'thukho', '/admin/stock/transfers/order-bound%3Adelivery')
  await settled(page)
  // The products are the order's: no grid to add more.
  await expect(record(page).getByText('Túi giấy quà tặng')).toBeVisible()
  await expect(record(page).getByRole('button', { name: 'Thêm sản phẩm', exact: true })).toHaveCount(0)
  await expect(record(page).getByRole('button', { name: 'Lưu sản phẩm', exact: true })).toHaveCount(0)

  await record(page).getByRole('button', { name: 'Sửa', exact: true }).click()
  const edit = page.getByRole('dialog')
  await expect(edit.getByRole('textbox', { name: 'Tham chiếu' })).toBeVisible()
  for (const name of ['Loại hoạt động', 'Vị trí nguồn', 'Vị trí đích'])
    await expect(edit.getByRole('button', { name, exact: true })).toHaveCount(0)
  await edit.getByRole('checkbox', { name: 'Ưu tiên' }).check()
  await edit.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(record(page).getByRole('alert')).toHaveCount(0)
  await expect(fact(page, 'Vị trí đích')).toHaveText('Khách hàng')
  await expect(fact(page, 'Loại hoạt động')).toHaveText('Xuất kho')

  await record(page).getByRole('button', { name: 'Sửa', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Ưu tiên' })).toBeChecked()
})
