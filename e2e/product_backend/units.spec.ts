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
  await expect(status.getByRole('link', { name: 'Đang dùng 6' })).toBeVisible()
  await expect(status.getByRole('link', { name: 'Lưu trữ 1' })).toBeVisible()
  await expect(status.getByRole('link', { name: 'Tất cả 7' })).toBeVisible()

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
  // Names compare without case: "chai" is the "Chai" already there (P33).
  await dialog.getByRole('textbox', { name: 'Tên đơn vị' }).fill('chai')
  await dialog.getByRole('button', { name: 'Tạo đơn vị' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Tên đơn vị' })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog).toContainText('Đã có đơn vị mang tên này.')
})

// C7 (P33, P34): one level of units, and a unit in use keeps what documents counted in it.
const COMMAND = '/admin/product/uoms/command'
const referenceChoices = (page: Page) =>
  page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Đơn vị tham chiếu' })
    .locator('option')
    .allTextContents()

test('a unit refers only to a reference unit: the catalogue keeps one level', async ({ page }) => {
  await signIn(page, 'admin', `${UNITS}?record=product.uom%3Anew`)
  await expect(page.getByRole('dialog', { name: 'Tạo đơn vị tính' })).toBeVisible()
  const choices = await referenceChoices(page)
  expect(choices).toEqual(expect.arrayContaining(['— Đơn vị gốc —', 'Cái', 'Chai', 'kg']))
  // Units that already count in another one are not references, nor is an archived one.
  // A choice reads "name · quantity reference" when it counts in another unit, so compare names.
  const names = choices.map((choice) => choice.split(' · ')[0])
  for (const name of ['g', 'Hộp 6 cái', 'Lốc 4 cái', 'Thùng cũ']) expect(names).not.toContain(name)
})

test('a unit others count in stays a reference unit', async ({ page }) => {
  await signIn(page, 'admin', `${UNITS}?record=product.uom%3Akg`)
  const dialog = page.getByRole('dialog', { name: 'Sửa đơn vị tính' })
  await expect(dialog).toContainText('Đã có đơn vị quy về đơn vị này')
  expect(await referenceChoices(page)).toEqual(['— Đơn vị gốc —'])
})

test('a name runs to 20 characters, on the form and at the server', async ({ page }) => {
  await signIn(page, 'admin', `${UNITS}?record=product.uom%3Anew`)
  const name = page.getByRole('dialog').getByRole('textbox', { name: 'Tên đơn vị' })
  await name.fill('Thùng hai mươi bốn chai nhựa')
  await expect(name).toHaveValue('Thùng hai mươi bốn c')
  const answer = await page.request.post(COMMAND, {
    data: { name: 'Thùng hai mươi bốn chai nhựa', active: true },
  })
  const body = (await answer.json()) as { value: { ok: boolean; errors: { field: string; code: string }[] } }
  expect(body.value.ok).toBe(false)
  expect(body.value.errors.map((error) => [error.field, error.code])).toEqual([['name', 'nameLength']])
})

test('a unit in use keeps its name and conversion; the server refuses a change', async ({ page }) => {
  await signIn(page, 'admin', `${UNITS}?record=product.uom%3Apack-4`)
  const dialog = page.getByRole('dialog', { name: 'Sửa đơn vị tính' })
  await expect(dialog).toContainText('Đơn vị đã được dùng')
  await expect(dialog.getByRole('textbox', { name: 'Tên đơn vị' })).toBeDisabled()
  await expect(dialog.getByRole('combobox', { name: 'Đơn vị tham chiếu' })).toBeDisabled()
  await expect(dialog.getByRole('textbox', { name: 'Số lượng' })).toBeDisabled()
  const answer = await page.request.post(COMMAND, {
    data: { id: 'pack-4', name: 'Lốc 6 cái', referenceId: 'unit', factor: '6', active: true },
  })
  expect(answer.status()).toBe(409)
  await page.reload()
  await expect(unit(page, 'Lốc 4 cái Đã khoá quy đổi')).toContainText('1 Lốc 4 cái = 4 Cái')
})

test('a unit a packaging still uses is not archived', async ({ page }) => {
  await signIn(page, 'admin', `${UNITS}?record=product.uom%3Apack-4`)
  const dialog = page.getByRole('dialog', { name: 'Sửa đơn vị tính' })
  await dialog.getByRole('checkbox', { name: 'Đang dùng' }).uncheck()
  await dialog.getByRole('button', { name: 'Lưu đơn vị' }).click()
  await expect(dialog).toContainText('Còn 1 sản phẩm hoặc đóng gói đang dùng đơn vị này')
  await page.goto(`${UNITS}?status=archived`)
  await expect(unit(page, 'Thùng cũ')).toBeVisible()
  await expect(units(page).getByRole('link', { name: /^Lốc 4 cái/ })).toHaveCount(0)
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
