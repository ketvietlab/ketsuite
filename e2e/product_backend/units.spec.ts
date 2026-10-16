import type { Page } from '@playwright/test'
import { DESKTOP, evidence, expect, fitsWidth, MOBILE, signIn, test } from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const UNITS = '/admin/product/uoms'
const units = (page: Page) => page.getByRole('region', { name: 'Đơn vị tính' })
const unit = (page: Page, name: string) =>
  units(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }) })

test('groups units by family, reference unit first, with the status counts', async ({ page }, info) => {
  await signIn(page, 'admin', UNITS)
  await expect(page.getByRole('heading', { level: 1, name: 'Đơn vị tính' })).toBeVisible()
  const status = page.getByRole('navigation', { name: 'Trạng thái' })
  await expect(status.getByRole('link', { name: 'Đang dùng 5' })).toBeVisible()
  await expect(status.getByRole('link', { name: 'Lưu trữ 1' })).toBeVisible()
  await expect(status.getByRole('link', { name: 'Tất cả 6' })).toBeVisible()

  await expect(unit(page, 'Hộp 6 cái')).toContainText('1 Hộp 6 cái = 6 Cái')
  await expect(unit(page, 'g')).toContainText('1 g = 0,001 kg')
  await expect(unit(page, 'Chai')).toContainText('Đơn vị gốc')
  // A unit products already count in keeps its conversion.
  await expect(units(page).getByRole('link', { name: 'Cái Đã khoá quy đổi', exact: true })).toBeVisible()
  await expect(unit(page, 'Thùng cũ')).toHaveCount(0)
  await evidence(page, info, 'units')
})

test('search narrows the units', async ({ page }) => {
  await signIn(page, 'admin', UNITS)
  const search = page.getByRole('search')
  await search.getByRole('searchbox', { name: 'Tìm đơn vị' }).fill('hộp')
  await search.getByRole('button', { name: 'Tìm' }).click()
  await expect(page).toHaveURL(/q=h%E1%BB%99p|q=hộp/)
  await expect(unit(page, 'Hộp 6 cái')).toBeVisible()
  await expect(unit(page, 'Chai')).toHaveCount(0)
  await expect(unit(page, 'kg')).toHaveCount(0)
})

test('archived units are under their own status', async ({ page }) => {
  await signIn(page, 'admin', UNITS)
  await page.getByRole('navigation', { name: 'Trạng thái' }).getByRole('link', { name: 'Lưu trữ 1' }).click()
  await expect(page).toHaveURL(/status=archived/)
  await expect(unit(page, 'Thùng cũ')).toBeVisible()
  await expect(unit(page, 'Chai')).toHaveCount(0)
})

test('creates a unit that packs another, with how many it holds', async ({ page }) => {
  await signIn(page, 'admin', UNITS)
  await page.getByRole('link', { name: 'Tạo đơn vị' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo đơn vị tính' })
  await dialog.getByRole('textbox', { name: 'Tên đơn vị' }).fill('Thùng 12 chai')
  // How many it holds is asked only once it refers to another unit.
  await expect(dialog.getByRole('textbox', { name: 'Số lượng' })).toHaveCount(0)
  await dialog.getByRole('combobox', { name: 'Đơn vị tham chiếu' }).selectOption({ label: 'Chai' })
  await dialog.getByRole('textbox', { name: 'Số lượng' }).fill('12')
  await dialog.getByRole('button', { name: 'Tạo đơn vị' }).click()
  await expect(dialog).toBeHidden()
  await expect(unit(page, 'Thùng 12 chai')).toContainText('1 Thùng 12 chai = 12 Chai')
})

test('a name another unit already has is refused', async ({ page }) => {
  await signIn(page, 'admin', `${UNITS}?record=product.uom%3Anew`)
  const dialog = page.getByRole('dialog', { name: 'Tạo đơn vị tính' })
  await dialog.getByRole('textbox', { name: 'Tên đơn vị' }).fill('Chai')
  await dialog.getByRole('button', { name: 'Tạo đơn vị' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Tên đơn vị' })).toHaveAttribute('aria-invalid', 'true')
})

test.describe('on a phone', () => {
  test.use({ viewport: MOBILE })

  test('the units fit the screen', async ({ page }, info) => {
    await signIn(page, 'admin', UNITS)
    await expect(unit(page, 'Hộp 6 cái')).toBeVisible()
    await fitsWidth(page)
    await evidence(page, info, 'units-phone')
  })
})
