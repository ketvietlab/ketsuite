import type { Page } from '@playwright/test'
import { DESKTOP, expect, listReady, productRow, settled, signIn, test } from './support.js'

// C14 (P55): ticked products change together through the product save, one refusal changes none,
// a value already right is not counted, and each run is a SUA/… line in every product's history.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const BULK = 'Sữa tắm sửa loạt'
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Sửa hàng loạt' })

const tick = async (page: Page, names: string[]) => {
  await page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' }).fill('sửa loạt')
  await listReady(page)
  for (const name of names) await productRow(page, name).getByRole('checkbox').check()
  await expect(page.getByText(`Đã chọn ${names.length} sản phẩm trên trang này`)).toBeVisible()
}
const pick = async (page: Page, field: string, option: string) => {
  await dialog(page).getByRole('button', { name: field }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await settled(page)
}
const apply = async (page: Page, field: string, value: string) => {
  await page.getByRole('button', { name: 'Sửa hàng loạt' }).click()
  await expect(dialog(page)).toBeVisible()
  await settled(page)
  await pick(page, 'Trường cần đổi', field)
  await dialog(page).getByRole('textbox', { name: 'Giá trị mới' }).fill(value)
  await dialog(page).getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await listReady(page)
}
const history = async (page: Page) => {
  await page.goto('/admin/product/templates/bulk-a')
  await settled(page)
  const text = await page.locator('main').innerText()
  return text.split('\n').filter((line) => /^SUA\/\d{4} · /.test(line))
}

test('a price set on two ticked products is one SUA line in each history, and setting it again adds none', async ({
  page,
}) => {
  await signIn(page)
  await listReady(page)
  await tick(page, [`${BULK} A`, `${BULK} B`])
  await page.getByRole('button', { name: 'Sửa hàng loạt' }).click()
  await expect(dialog(page)).toBeVisible()
  await settled(page)
  await expect(dialog(page)).toContainText(`${BULK} A, ${BULK} B`)
  // Nothing is picked for the reader: the field reads "Chọn…" and Apply waits for it.
  await expect(dialog(page).getByRole('button', { name: 'Trường cần đổi' })).toHaveText(/^Chọn…/)
  await expect(dialog(page).getByRole('button', { name: 'Áp dụng' })).toBeDisabled()
  await dialog(page).getByRole('button', { name: 'Trường cần đổi' }).click()
  await expect(page.getByRole('listbox').last().getByRole('option')).toHaveText([
    'Nhóm sản phẩm',
    'Thêm thẻ',
    'Bỏ thẻ',
    'Thuế',
    'Giá bán',
    'Có thể bán',
    'Có thể mua',
    'Giao cho khách sau',
    'Theo dõi tồn',
  ])
  await page.keyboard.press('Escape')
  await dialog(page).getByRole('button', { name: 'Hủy' }).click()
  await expect(dialog(page)).toHaveCount(0)
  // The dialog opened by navigation, so the list comes back without the ticks (G1).
  await listReady(page)
  await tick(page, [`${BULK} A`, `${BULK} B`])

  await apply(page, 'Giá bán', '65000')
  await expect(productRow(page, `${BULK} A`)).toContainText('65.000 ₫')
  await expect(productRow(page, `${BULK} B`)).toContainText('65.000 ₫')
  await expect(productRow(page, `${BULK} có tồn`)).toContainText('56.000 ₫')
  const first = await history(page)
  expect(first).toHaveLength(1)
  expect(first[0]).toMatch(/^SUA\/\d{4} · Quản trị sản phẩm · Giá bán: 65\.000\s₫ · 2\/2$/)

  // The same price again, written another way, changes nothing, so no product's history grows.
  await page.goto('/admin/product/templates')
  await listReady(page)
  await tick(page, [`${BULK} A`, `${BULK} B`])
  await apply(page, 'Giá bán', '65000.00')
  expect(await history(page)).toEqual(first)
})

test('one product refused leaves every ticked product as it was, naming it by code', async ({ page }) => {
  await signIn(page)
  await listReady(page)
  const before = await history(page)
  await page.goto('/admin/product/templates')
  await listReady(page)
  await tick(page, [`${BULK} A`, `${BULK} có tồn`])
  await page.getByRole('button', { name: 'Sửa hàng loạt' }).click()
  await expect(dialog(page)).toBeVisible()
  await settled(page)
  await pick(page, 'Trường cần đổi', 'Theo dõi tồn')
  await pick(page, 'Giá trị mới', 'Không')
  await dialog(page).getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog(page)).toContainText(
    'Sản phẩm BK-03: Theo dõi tồn bị khóa do đã có tồn kho. Không sản phẩm nào đã đổi.',
  )
  await dialog(page).getByRole('button', { name: 'Hủy' }).click()
  expect(await history(page)).toEqual(before)
})

test('a warehouse manager who may not edit the catalogue is offered no bulk edit', async ({ page }) => {
  await signIn(page, 'stockkeeper')
  await listReady(page)
  await page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' }).fill('sửa loạt')
  await listReady(page)
  await expect(productRow(page, `${BULK} A`)).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Sửa hàng loạt' })).toHaveCount(0)
})
