import type { Page } from '@playwright/test'
import { DESKTOP, expect, recordReady, settled, signIn, test } from './support.js'

// C10 (P44–P47): combo choices kept on their own screen, a combo product that sells them, a
// combo line on a quotation split into one item per choice, and an order that ships the items.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const COMBOS = '/admin/product/combos'
const choiceRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })
const combosReady = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Lựa chọn combo' })).toBeVisible()
  await expect(choiceRow(page, 'Tinh dầu dưỡng')).toBeVisible()
  await settled(page)
}
const recordPage = (page: Page) => page.locator('[data-ui="record-page"]')

test('a combo choice name is unique in any case; a choice in use cannot be archived', async ({ page }) => {
  await signIn(page, 'admin', COMBOS)
  await combosReady(page)
  // Items and the combo products that use each choice.
  await expect(choiceRow(page, 'Tinh dầu dưỡng')).toContainText('2')
  await expect(choiceRow(page, 'Lựa chọn chưa dùng')).toContainText('0')

  await page.getByRole('link', { name: 'Tạo lựa chọn combo' }).click()
  const create = page.getByRole('dialog', { name: 'Lựa chọn combo mới' })
  await expect(create).toBeVisible()
  await settled(page)
  await create.getByRole('textbox', { name: 'Tên lựa chọn' }).fill('TINH DẦU DƯỠNG')
  await create.getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('tui qua')
  await page.getByRole('option', { name: /Túi quà vải/ }).click()
  await create.getByRole('button', { name: 'Tạo lựa chọn combo' }).click()
  await expect(create).toContainText('Đã có lựa chọn combo cùng tên, kể cả lựa chọn đã lưu trữ.')
  await page.keyboard.press('Escape')

  // In use by a combo product: no archive; unused: archived.
  await page.goto(`${COMBOS}?record=product.combo%3Acombo-serum`)
  const used = page.getByRole('dialog', { name: 'Sửa lựa chọn combo' })
  await expect(used).toContainText('Combo dưỡng ẩm mùa đông')
  await expect(used.getByRole('button', { name: 'Lưu trữ' })).toHaveCount(0)
  await page.goto(`${COMBOS}?record=product.combo%3Acombo-spare`)
  const spare = page.getByRole('dialog', { name: 'Sửa lựa chọn combo' })
  await settled(page)
  await spare.getByRole('button', { name: 'Lưu trữ' }).click()
  await page.getByRole('dialog', { name: 'Lưu trữ' }).getByRole('button', { name: 'Lưu trữ' }).click()
  await expect(spare).toBeHidden()
  await expect(choiceRow(page, 'Lựa chọn chưa dùng')).toHaveCount(0)
})

test('an item is a selling product that is not itself a combo', async ({ page }) => {
  await signIn(page, 'admin', `${COMBOS}?record=product.combo%3Acombo-gift`)
  const dialog = page.getByRole('dialog', { name: 'Sửa lựa chọn combo' })
  await expect(dialog).toBeVisible()
  await settled(page)
  await dialog.getByRole('button', { name: 'Thêm dòng' }).click()
  // "dưỡng" names both the oils and the combo: only the oils are offered.
  await page.keyboard.type('duong')
  await expect(page.getByRole('option', { name: /Tinh dầu dưỡng sáng/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Combo dưỡng ẩm/ })).toHaveCount(0)
})

test('a combo product names its choices, sits in no category and has no variants or stock', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/product/templates/winter-combo')
  await recordReady(page, 'Combo dưỡng ẩm mùa đông')
  await settled(page)
  const record = recordPage(page)
  await expect(record.getByRole('combobox', { name: 'Loại' })).toBeDisabled()
  await expect(record.getByRole('button', { name: 'Nhóm sản phẩm' })).toContainText('Không thuộc nhóm')
  const choices = record.getByRole('group', { name: 'Lựa chọn combo' })
  await expect(choices.getByRole('listitem')).toHaveText([/Tinh dầu dưỡng/, /Quà kèm/])
  for (const name of ['Biến thể', 'Đóng gói', 'Tồn kho'])
    await expect(record.getByRole('heading', { level: 2, name, exact: true })).toHaveCount(0)
})

test('a new combo product needs a choice', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/new')
  await recordReady(page, 'Tạo sản phẩm')
  await settled(page)
  const record = recordPage(page)
  await record.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Combo chưa có lựa chọn')
  await record.getByRole('textbox', { name: 'Mã nội bộ' }).fill('CB-02')
  await record.getByRole('combobox', { name: 'Loại' }).selectOption({ label: 'Combo' })
  await record.getByRole('textbox', { name: 'Giá bán' }).fill('100000')
  await record.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  // Nothing is created: the page opens the empty, required choice field for the user.
  await expect(record.getByRole('button', { name: 'Lựa chọn combo' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(page).toHaveURL(/\/templates\/new/)
})

// A quotation's lines are a grid.
const lines = (page: Page) => recordPage(page).getByRole('grid', { name: 'Sản phẩm' })
const gridRow = (page: Page, name: string) => lines(page).getByRole('row').filter({ hasText: name })

test('a combo line splits its price over one item per choice; an item swaps only within its choice', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-combo')
  await recordReady(page, /^S\d+/)
  await settled(page)
  await recordPage(page).getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('combo duong am')
  // The picker names a product by its code, then its name; the description column follows it.
  await page.getByRole('option', { name: /^CB-01 Combo dưỡng ẩm/ }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.getByRole('listbox', { name: 'Đơn vị tính' }).getByRole('option', { name: /^Cái/ }).click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  await recordPage(page).getByRole('button', { name: 'Lưu các dòng' }).click()
  // 590.000 by list price, 300.000 : 50.000; the last item takes the remainder.
  await expect(gridRow(page, 'Tinh dầu dưỡng sáng')).toContainText('505714')
  await expect(gridRow(page, 'Túi quà vải')).toContainText('84286')
  await expect(
    recordPage(page).getByRole('definition').filter({ hasText: '1.180.000 ₫' }).first(),
  ).toBeVisible()

  // The item's quantity follows the combo line; its product changes only within its choice.
  const oil = gridRow(page, 'Tinh dầu dưỡng sáng')
  await oil.getByRole('gridcell').nth(3).dblclick()
  await expect(oil.getByRole('spinbutton')).toHaveCount(0)
  await oil.getByRole('gridcell').first().dblclick()
  const offered = page.getByRole('listbox').last().getByRole('option')
  await expect(offered).toHaveCount(2)
  for (const name of ['Tinh dầu dưỡng sáng', 'Tinh dầu dưỡng ẩm'])
    await expect(offered.filter({ hasText: name })).toHaveCount(1)
  await offered.filter({ hasText: 'Tinh dầu dưỡng ẩm' }).click()
  await page.keyboard.press('Enter')
  await recordPage(page).getByRole('button', { name: 'Lưu các dòng' }).click()
  // 320.000 : 50.000 now, plus the item's own 60.000 extra.
  await expect(gridRow(page, 'Tinh dầu dưỡng ẩm')).toContainText('570270')
  await expect(gridRow(page, 'Túi quà vải')).toContainText('79730')
})

test('a confirmed combo order ships its items, not the combo line', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-combo-sold')
  await recordReady(page, /^S\d+/)
  await settled(page)
  await recordPage(page).getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page).toHaveURL(/\/admin\/sales\/orders\/quote-combo-sold/)
  await recordReady(page, /^S\d+/)
  const deliveries = recordPage(page).getByRole('table', { name: 'Giao hàng' })
  await expect(deliveries.getByRole('row')).toHaveCount(3)
  await expect(deliveries).toContainText('Tinh dầu dưỡng sáng')
  await expect(deliveries).toContainText('Túi quà vải')
  await expect(deliveries).not.toContainText('Combo dưỡng ẩm')
  // States read as words, and an order with no invoice yet says so in Vietnamese.
  await expect(deliveries).not.toContainText('draft')
  await expect(recordPage(page).getByText('Chưa có hoá đơn')).toBeVisible()
})

test('the invoicing policy list leaves combos out', async ({ page }) => {
  await signIn(page, 'admin', '/admin/sales/invoicing-policies')
  await settled(page)
  // "dưỡng" names both the oils and the combo: the oils are listed, the combo is not (it
  // invoices as its items).
  await page.getByRole('searchbox', { name: 'Tìm mã, tên hoặc nhóm sản phẩm…' }).fill('dưỡng')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('row').filter({ hasText: 'Tinh dầu dưỡng sáng' })).toHaveCount(1)
  await expect(page.getByText('Combo dưỡng ẩm mùa đông')).toHaveCount(0)
})
