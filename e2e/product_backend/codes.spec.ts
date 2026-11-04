import type { Page } from '@playwright/test'
import { DESKTOP, expect, fitsWidth, MOBILE, recordReady, settled, signIn, test } from './support.js'

// P21/P22/P41 on the product page: a code is saved in capitals and belongs to one product
// in the company, a barcode is a GS1 GTIN no other SKU holds, and a product posts to the
// accounts it chooses or, left empty, to its category's and then the company's.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const T = '/admin/product/templates'

const startNew = async (page: Page, name: string, code: string) => {
  await signIn(page, 'admin', `${T}/new`)
  await recordReady(page, 'Tạo sản phẩm')
  await page.getByRole('textbox', { name: 'Tên sản phẩm' }).fill(name)
  await page.getByRole('textbox', { name: 'Mã nội bộ' }).fill(code)
  await page.getByRole('textbox', { name: 'Giá bán' }).fill('120000')
}

test('a typed code is saved in capitals, and a barcode with a wrong check digit is refused at its field', async ({
  page,
}) => {
  await startNew(page, 'Nước hoa hồng mã thường', 'nhh-01')
  await page.getByRole('textbox', { name: 'Barcode' }).fill('8938501230050')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(
    page.getByText('Nhập GTIN gồm 8, 12, 13 hoặc 14 chữ số và đúng số kiểm tra GS1.'),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/templates\/new\b/)
  // The draft is kept: only the barcode needs another try.
  await expect(page.getByRole('textbox', { name: 'Tên sản phẩm' })).toHaveValue('Nước hoa hồng mã thường')

  await page.getByRole('textbox', { name: 'Barcode' }).fill('8938501230058')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(page).not.toHaveURL(/\/templates\/new\b/)
  await recordReady(page, 'Nước hoa hồng mã thường')
  await page.reload()
  await recordReady(page, 'Nước hoa hồng mã thường')
  await expect(page.getByRole('textbox', { name: 'Mã nội bộ' })).toHaveValue('NHH-01')
  await expect(page.getByRole('textbox', { name: 'Barcode' })).toHaveValue('8938501230058')
})

test('a code or a barcode another product holds is refused, written in any case', async ({ page }) => {
  await startNew(page, 'Serum trùng mã', 'sr-b5-30')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(
    page.getByText('Mã này đã được một sản phẩm hoặc biến thể trong công ty sử dụng.'),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/templates\/new\b/)

  await page.getByRole('textbox', { name: 'Mã nội bộ' }).fill('SR-B5-31')
  await page.getByRole('textbox', { name: 'Barcode' }).fill('8938501230034')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(page.getByText('Barcode này đã thuộc một biến thể hoặc đóng gói trong công ty.')).toBeVisible()
  await expect(page).toHaveURL(/\/templates\/new\b/)

  // The same GTIN written with a leading zero is the same barcode.
  await page.getByRole('textbox', { name: 'Barcode' }).fill('08938501230034')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(page.getByText('Barcode này đã thuộc một biến thể hoặc đóng gói trong công ty.')).toBeVisible()
  await expect(page).toHaveURL(/\/templates\/new\b/)
})

test('a product posts to the income account it chooses, and back to the company default once cleared', async ({
  page,
}) => {
  const income = () => page.getByRole('button', { name: 'Tài khoản doanh thu' })
  const choose = async (label: string) => {
    await income().click()
    await page.getByRole('option', { name: label }).click()
  }
  const saveAndReload = async () => {
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByText('Thay đổi đã được ghi nhận.')).toBeVisible()
    await page.reload()
    await recordReady(page, 'Toner chia nhóm trường')
  }
  await signIn(page, 'admin', `${T}/toner-groups`)
  await recordReady(page, 'Toner chia nhóm trường')
  await expect(income()).toHaveText(/Theo nhóm hoặc công ty/)
  await expect(page.getByText('Hiện dùng: 511 · Doanh thu bán hàng')).toBeVisible()

  await choose('5111 · Doanh thu bán hàng hoá')
  await saveAndReload()
  await expect(income()).toHaveText(/5111 · Doanh thu bán hàng hoá/)
  await expect(page.getByText('Hiện dùng: 5111 · Doanh thu bán hàng hoá')).toBeVisible()

  await choose('Theo nhóm hoặc công ty')
  await saveAndReload()
  await expect(income()).toHaveText(/Theo nhóm hoặc công ty/)
  await expect(page.getByText('Hiện dùng: 511 · Doanh thu bán hàng')).toBeVisible()
})

test('a product with no accounts of its own posts through its category, then the company', async ({
  page,
}) => {
  await signIn(page, 'admin', `${T}/gift-box`)
  await recordReady(page, 'Hộp quà dưỡng da')
  await expect(page.getByRole('button', { name: 'Tài khoản doanh thu' })).toHaveText(/Theo nhóm hoặc công ty/)
  await expect(page.getByText('Hiện dùng: 5118 · Doanh thu khác')).toBeVisible()
  // Goods buy into stock; the category sets no purchase account, so the company's applies.
  await expect(page.getByText('Hiện dùng: 156 · Hàng hoá')).toBeVisible()
})

test('the accountant sets the posting accounts; roles that do not read them see no accounting card', async ({
  page,
}) => {
  await signIn(page, 'bookkeeper', `${T}/gift-box`)
  await recordReady(page, 'Hộp quà dưỡng da')
  await settled(page)
  await expect(page.getByRole('button', { name: 'Tài khoản doanh thu' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Tài khoản mua hàng' })).toBeEnabled()
  for (const login of ['role-sales-manager', 'stockkeeper', 'role-sales-representative'] as const) {
    await page.context().clearCookies()
    await signIn(page, login, `${T}/gift-box`)
    await recordReady(page, 'Hộp quà dưỡng da')
    await settled(page)
    await expect(page.getByRole('button', { name: 'Tài khoản doanh thu' }), login).toHaveCount(0)
    await expect(page.getByText(/Hiện dùng: \d+/u), login).toHaveCount(0)
  }
})

test('codes and accounts read in English', async ({ page }) => {
  await signIn(page, 'admin', `${T}/new?lang=en`, 'en')
  await recordReady(page, 'Create product')
  await page.getByRole('textbox', { name: 'Product name' }).fill('Rose water in English')
  await page.getByRole('textbox', { name: 'Internal reference' }).fill('-ab')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(
    page.getByText('Use 2–20 letters, digits or hyphens for the code, starting with a letter or digit.'),
  ).toBeVisible()
  await page.goto(`${T}/gift-box?lang=en`)
  await recordReady(page, 'Hộp quà dưỡng da')
  await expect(page.getByText('Currently uses: 5118 · Doanh thu khác')).toBeVisible()
})

test.describe('on a phone', () => {
  test.use({ viewport: MOBILE })

  test('the accounting card fits and its picker opens across the screen', async ({ page }) => {
    await signIn(page, 'bookkeeper', `${T}/gift-box`)
    await recordReady(page, 'Hộp quà dưỡng da')
    await settled(page)
    const income = page.getByRole('button', { name: 'Tài khoản doanh thu' })
    await income.scrollIntoViewIfNeeded()
    await fitsWidth(page)
    await income.click()
    const option = page.getByRole('option', { name: '5111 · Doanh thu bán hàng hoá' })
    await expect(option).toBeVisible()
    const box = await option.boundingBox()
    expect(box, 'the option is on screen').not.toBeNull()
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= MOBILE.width).toBe(true)
    await page.keyboard.press('Escape')
  })
})
