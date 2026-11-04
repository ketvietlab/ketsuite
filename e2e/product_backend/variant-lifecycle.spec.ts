import type { Page } from '@playwright/test'
import { DESKTOP, expect, fitsWidth, MOBILE, recordReady, settled, signIn, test } from './support.js'

// C4 (P27–P31): what configuring attributes does to the SKUs a product already has, the
// variant dialog each role opens, stopping a variant, and what a duplicate makes.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const T = '/admin/product/templates'
const variants = (page: Page) => page.getByRole('table', { name: 'Biến thể' })
const variantRow = (page: Page, size: string) =>
  variants(page).getByRole('row', { name: new RegExp(`^${size}\\b`) })

const configure = async (page: Page) => {
  await page.getByRole('button', { name: 'Cấu hình thuộc tính' }).click()
  return page.getByRole('dialog', { name: 'Cấu hình thuộc tính' })
}
const sizes = (dialog: ReturnType<Page['getByRole']>) =>
  dialog.getByRole('group', { name: 'Giá trị' }).first()

test('the first configuration keeps the product code for the first size and prices L with its extra', async ({
  page,
}) => {
  await signIn(page, 'admin', `${T}/towel-first`)
  await recordReady(page, 'Khăn tắm cấu hình lần đầu')
  await settled(page)
  const dialog = await configure(page)
  await dialog.getByRole('combobox', { name: 'Thêm thuộc tính' }).selectOption({ label: 'Kích cỡ áo' })
  await sizes(dialog).getByRole('checkbox', { name: 'Tất cả' }).check()
  // Each chosen value opens its extra, starting from the attribute's own.
  await expect(dialog.getByRole('textbox', { name: 'Phụ thu L' })).toHaveValue('30.000')
  await expect(dialog.getByRole('textbox', { name: 'Phụ thu S' })).toHaveValue('0')
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toBeHidden()

  await expect(variantRow(page, 'S')).toContainText('KT')
  await expect(variantRow(page, 'M')).toContainText('KTA')
  await expect(variantRow(page, 'L')).toContainText('KTB')
  await expect(variantRow(page, 'L')).toContainText('150.000 ₫')
  await expect(variantRow(page, 'M')).toContainText('120.000 ₫')
  await page.reload()
  await recordReady(page, 'Khăn tắm cấu hình lần đầu')
  await expect(variants(page).getByRole('row')).toHaveCount(4)
})

test('a size with stock or on an open quotation stays; an unused one leaves the product', async ({
  page,
  ui,
}) => {
  ui.allow(/^\d{3} POST /u, 'the configuration is refused on purpose')
  await signIn(page, 'admin', `${T}/robe-drop`)
  await recordReady(page, 'Áo choàng bỏ cỡ')
  await settled(page)

  // M has four on hand.
  let dialog = await configure(page)
  await sizes(dialog).getByRole('checkbox', { name: 'M', exact: true }).uncheck()
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toContainText(
    'Áo choàng bỏ cỡ · M · ACDA: còn tồn kho hoặc hàng đang giữ. Xuất hết hoặc chuyển tồn trước khi bỏ biến thể.',
  )
  await sizes(dialog).getByRole('checkbox', { name: 'M', exact: true }).check()
  // L is on a quotation nobody has finished.
  await sizes(dialog).getByRole('checkbox', { name: 'L', exact: true }).uncheck()
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toContainText(
    'Áo choàng bỏ cỡ · L · ACDB: còn trên chứng từ chưa hoàn tất. Hoàn tất hoặc hủy chứng từ trước khi bỏ biến thể.',
  )
  await sizes(dialog).getByRole('checkbox', { name: 'L', exact: true }).check()
  // S was never used: it goes.
  await sizes(dialog).getByRole('checkbox', { name: 'S', exact: true }).uncheck()
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toBeHidden()
  await expect(variantRow(page, 'S')).toHaveCount(0)
  await expect(variantRow(page, 'M')).toContainText('ACDA')
  await expect(variantRow(page, 'L')).toContainText('ACDB')

  await page.reload()
  await recordReady(page, 'Áo choàng bỏ cỡ')
  await expect(variantRow(page, 'S')).toHaveCount(0)
  // Putting S back makes it sell again under its old code.
  dialog = await configure(page)
  await sizes(dialog).getByRole('checkbox', { name: 'S', exact: true }).check()
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toBeHidden()
  await expect(variantRow(page, 'S')).toContainText('Đang bán')
  await expect(variantRow(page, 'S')).toContainText('ACD')
})

test('more than fifty combinations are refused before anything is written', async ({ page, ui }) => {
  ui.allow(/^\d{3} POST /u, 'the configuration is refused on purpose')
  await signIn(page, 'admin', `${T}/towel-many`)
  await recordReady(page, 'Khăn quá nhiều cỡ')
  await settled(page)
  const dialog = await configure(page)
  for (const name of ['Lưới A', 'Lưới B']) {
    await dialog.getByRole('combobox', { name: 'Thêm thuộc tính' }).selectOption({ label: name })
    await dialog
      .getByRole('group', { name: 'Giá trị' })
      .last()
      .getByRole('checkbox', { name: 'Tất cả' })
      .check()
  }
  await dialog.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(dialog).toContainText('Tổ hợp này tạo 56 biến thể; tối đa 50. Bớt giá trị hoặc tách sản phẩm.')
  await page.reload()
  await recordReady(page, 'Khăn quá nhiều cỡ')
  await expect(page.getByText('Sản phẩm chưa có biến thể')).toBeVisible()
})

test('the stock manager saves a variant barcode and HS code and sees the catalogue fields locked', async ({
  page,
  ui,
}) => {
  ui.allow(/^\d{3} POST /u, 'the HS code is refused on purpose')
  await signIn(page, 'stockkeeper', `${T}/robe-roles`)
  await recordReady(page, 'Áo choàng chia nhóm')
  await settled(page)
  await variants(page).getByRole('link', { name: 'M' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa biến thể · M' })
  await expect(dialog).toContainText('Chỉ xem thông tin chung')
  for (const name of ['Mã nội bộ', 'Giá bán riêng'])
    await expect(dialog.getByRole('textbox', { name })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: 'Đang bán biến thể này' })).toBeDisabled()
  await expect(dialog.getByRole('textbox', { name: 'Giá vốn' })).toHaveCount(0)

  await dialog.getByRole('textbox', { name: 'Barcode' }).fill('8938500000201')
  await dialog.getByRole('textbox', { name: 'Mã HS' }).fill('12')
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toContainText('Mã HS gồm 4 đến 10 chữ số.')
  await dialog.getByRole('textbox', { name: 'Mã HS' }).fill('6302.60')
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()
  await expect(variantRow(page, 'M')).toContainText('8938500000201')

  await page.reload()
  await recordReady(page, 'Áo choàng chia nhóm')
  await variants(page).getByRole('link', { name: 'M' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Sửa biến thể · M' }).getByRole('textbox', { name: 'Mã HS' }),
  ).toHaveValue('630260')
})

test('the accountant sets a variant cost and nothing else', async ({ page }) => {
  await signIn(page, 'bookkeeper', `${T}/robe-roles`)
  await recordReady(page, 'Áo choàng chia nhóm')
  await settled(page)
  await variants(page).getByRole('link', { name: 'L' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa biến thể · L' })
  await expect(dialog).toContainText('Chỉ xem thông tin chung')
  for (const name of ['Mã nội bộ', 'Barcode', 'Mã HS'])
    await expect(dialog.getByRole('textbox', { name })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'Giá vốn' }).fill('95000')
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()
  await expect(variantRow(page, 'L')).toContainText('95.000 ₫')
})

test('who only sells sees the variants and opens none of them', async ({ page }) => {
  await signIn(page, 'role-sales-representative', `${T}/robe-roles`)
  await recordReady(page, 'Áo choàng chia nhóm')
  await expect(variantRow(page, 'M')).toBeVisible()
  await expect(variants(page).getByRole('link')).toHaveCount(0)
})

test('a variant price of its own replaces the product price plus extra', async ({ page }) => {
  await signIn(page, 'admin', `${T}/robe-roles`)
  await recordReady(page, 'Áo choàng chia nhóm')
  await settled(page)
  await expect(variantRow(page, 'L')).toContainText('280.000 ₫')
  await variants(page).getByRole('link', { name: 'L' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa biến thể · L' })
  await expect(dialog).toContainText('Để trống để bán theo giá sản phẩm cộng phụ thu: 280.000 ₫.')
  await dialog.getByRole('textbox', { name: 'Giá bán riêng' }).fill('265000')
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()
  await expect(variantRow(page, 'L')).toContainText('265.000 ₫')
})

test('a variant stops selling unless it is on an open document or the last one selling', async ({
  page,
  ui,
}) => {
  ui.allow(/^\d{3} POST /u, 'stopping is refused on purpose')
  ui.allow(/^last screen alert: Chưa lưu được/u, 'the last refusal is still on screen')
  // L of robe-drop is on an open quotation.
  await signIn(page, 'admin', `${T}/robe-drop`)
  await recordReady(page, 'Áo choàng bỏ cỡ')
  await settled(page)
  await variants(page).getByRole('link', { name: 'L' }).click()
  let dialog = page.getByRole('dialog', { name: 'Sửa biến thể · L' })
  await dialog.getByRole('checkbox', { name: 'Đang bán biến thể này' }).uncheck()
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toContainText('còn trên chứng từ chưa hoàn tất')
  await dialog.getByRole('button', { name: 'Hủy' }).click()
  await page
    .getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' })
    .getByRole('button', { name: 'Bỏ nội dung' })
    .click()

  await page.goto(`${T}/robe-stop`)
  await recordReady(page, 'Áo choàng ngừng bán')
  await settled(page)
  await variants(page).getByRole('link', { name: 'S' }).click()
  dialog = page.getByRole('dialog', { name: 'Sửa biến thể · S' })
  await dialog.getByRole('checkbox', { name: 'Đang bán biến thể này' }).uncheck()
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()
  await expect(variantRow(page, 'S')).toContainText('Không bán')

  // M is now the only size selling.
  await variants(page).getByRole('link', { name: 'M' }).click()
  dialog = page.getByRole('dialog', { name: 'Sửa biến thể · M' })
  await dialog.getByRole('checkbox', { name: 'Đang bán biến thể này' }).uncheck()
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toContainText(
    'Áo choàng ngừng bán: phải còn ít nhất một biến thể đang dùng. Muốn ngừng bán hẳn, hãy lưu trữ sản phẩm.',
  )
})

test('a duplicate makes the same sizes under new codes, without barcodes or cost', async ({ page }) => {
  await signIn(page, 'admin', `${T}/new?duplicate=robe-copy`)
  await recordReady(page, 'Tạo sản phẩm')
  await settled(page)
  await expect(
    page.getByText(
      'Tạo sản phẩm sẽ sinh 3 biến thể theo thuộc tính và phụ thu của sản phẩm gốc, với mã mới, chưa có barcode và giá vốn.',
    ),
  ).toBeVisible()
  await page.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Áo choàng bản sao')
  await page.getByRole('textbox', { name: 'Mã nội bộ' }).fill('ACB')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(page).not.toHaveURL(/\/templates\/new\b/)
  await recordReady(page, 'Áo choàng bản sao')
  await expect(variantRow(page, 'S')).toContainText('ACB')
  await expect(variantRow(page, 'M')).toContainText('ACBA')
  await expect(variantRow(page, 'L')).toContainText('ACBB')
  await expect(variantRow(page, 'L')).toContainText('280.000 ₫')
})

test.describe('in English on a phone', () => {
  test.use({ viewport: MOBILE, locale: 'en-US' })

  test('the stock manager reads the locked notice and the variant dialog fits', async ({ page }) => {
    await signIn(page, 'stockkeeper', `${T}/robe-roles?lang=en`, 'en')
    await recordReady(page, 'Áo choàng chia nhóm')
    await settled(page)
    await page.getByRole('table', { name: 'Variants' }).getByRole('link', { name: 'S' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit variant · S' })
    await expect(dialog).toContainText('General details are read-only')
    await expect(dialog.getByRole('textbox', { name: 'HS code' })).toBeEditable()
    await fitsWidth(page)
  })
})
