import type { Page } from '@playwright/test'
import {
  DESKTOP,
  addGridLine,
  expect,
  gridLine,
  quotationGrid,
  saveGridLines,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// C25 (D33b, mock `applyGridLines`; owner 25/10): a confirmed order's grid adds, removes and reorders
// lines as a quotation's does. A line neither delivered nor invoiced may go or take another product,
// cancelling what it waited to deliver; new goods join the order's open delivery. A delivered line keeps
// its product and stays.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const ORDER = '/admin/sales/orders/order-grid'
const MASK = 'Mặt nạ giao theo số giao'
const GEL = 'Gel rửa mặt chưa có tồn'
const LOTION = 'Sữa dưỡng thể chờ giao'
const OIL = 'Dầu tẩy trang thêm sau'
const SCRUB = 'Tẩy tế bào chết thay thế'
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const cell = (page: Page, line: string | RegExp, key: string) =>
  gridLine(page, line).locator(`[data-kg-key="${key}"]`)
const deliveries = (page: Page) => record(page).getByRole('table', { name: 'Giao hàng' })
const delivery = (page: Page, product: string) =>
  deliveries(page).getByRole('row').filter({ hasText: product })

test('a confirmed order removes, re-products and adds waiting lines; a delivered one stays', async ({
  page,
}) => {
  await signIn(page, 'admin', ORDER)
  await settled(page)
  for (const name of ['Thêm dòng', 'Thêm nhóm hàng', 'Thêm ghi chú'])
    await expect(record(page).getByRole('button', { name, exact: true })).toBeVisible()
  // The mask went out: its product is fixed. The lotion only wait on the backorder.
  await expect(cell(page, MASK, 'productId')).toHaveAttribute('aria-readonly', 'true')
  await expect(cell(page, LOTION, 'productId')).toHaveAttribute('data-editable', 'true')
  // Its delivery closed what it left at 0 and the rest waits on the backorder.
  const backorder = await delivery(page, LOTION)
    .filter({ hasNotText: 'Hoàn tất' })
    .getByRole('link')
    .getAttribute('href')
  expect(backorder).toMatch(/backorder/)

  await cell(page, GEL, 'name').click()
  await record(page).getByRole('button', { name: 'Xóa dòng' }).click()
  await cell(page, LOTION, 'productId').click()
  await page.keyboard.type('TB-01')
  await page.getByRole('option', { name: /TB-01/ }).click()
  await addGridLine(page, { search: 'DT-01', option: /DT-01/, quantity: '3' })
  await record(page).getByRole('button', { name: 'Thêm nhóm hàng', exact: true }).click()
  await page.keyboard.type('Hàng thêm')
  await page.keyboard.press('Enter')
  await saveGridLines(page)
  // The section stays where it was added, after the new oil.
  const rows = quotationGrid(page).locator('[data-ui="kg-row"]')
  await expect(rows.last()).toHaveText(/Hàng thêm/)
  await expect(rows.nth(-2)).toHaveText(/DT-01/)

  await expect(gridLine(page, GEL)).toHaveCount(0)
  await expect(gridLine(page, LOTION)).toHaveCount(0)
  // The re-producted line keeps its quantity and takes the scrub's name and price.
  await expect(gridLine(page, SCRUB)).toHaveAccessibleName(/TB-01 Tẩy tế bào chết thay thế Gói 2 95000 /)
  await expect(gridLine(page, OIL)).toHaveAccessibleName(/DT-01 Dầu tẩy trang thêm sau Gói 3 150000 /)
  await expect(gridLine(page, MASK)).toHaveCount(1)
  // The gel and the lotion no longer wait; the scrub and the new oil join the open backorder.
  await expect(delivery(page, GEL)).toHaveCount(0)
  await expect(delivery(page, LOTION)).toHaveCount(0)
  for (const product of [SCRUB, OIL])
    await expect(delivery(page, product).getByRole('link')).toHaveAttribute('href', backorder!)

  await delivery(page, OIL).getByRole('link').click()
  await settled(page)
  // The backorder lost every line it waited for in the same save and stays open for the new ones.
  await expect(record(page).locator('[data-ui="record-page-status"]')).not.toContainText('Đã hủy')
  const moves = record(page).getByRole('grid', { name: 'Sản phẩm', exact: true })
  await expect(moves.getByRole('row').filter({ hasText: OIL })).toHaveCount(1)
  await expect(moves.getByRole('row').filter({ hasText: SCRUB })).toHaveCount(1)
  // What the gel and the lotion waited for stays on the delivery, cancelled.
  for (const gone of [GEL, LOTION])
    await expect(moves.getByRole('row').filter({ hasText: gone })).toContainText('Đã hủy')
})

test('a confirmed order refuses to remove a delivered line and names it', async ({ page, ui }) => {
  ui.allow(/^last screen alert: Chưa lưu được/u, 'removing the delivered mask is refused on purpose')
  await signIn(page, 'admin', ORDER)
  await settled(page)
  await cell(page, MASK, 'name').click()
  await record(page).getByRole('button', { name: 'Xóa dòng' }).click()
  await record(page).getByRole('button', { name: 'Lưu các dòng' }).click()
  await expect(record(page).getByRole('alert')).toContainText(
    `Dòng “${MASK}” đã giao hoặc đã lập hoá đơn nên không xoá hay đổi sản phẩm, đơn vị được.`,
  )
  // Nothing was removed: read again, the mask is still on the order.
  await page.goto(ORDER)
  await settled(page)
  await expect(gridLine(page, MASK)).toHaveCount(1)
})

test('a confirmed order refuses less than was delivered and names the line and the least', async ({
  page,
  ui,
}) => {
  ui.allow(/^last screen alert: Chưa lưu được/u, 'going under what was delivered is refused on purpose')
  await signIn(page, 'admin', ORDER)
  await settled(page)
  await cell(page, MASK, 'productUomQty').click()
  await page.keyboard.type('0')
  await page.keyboard.press('Enter')
  await record(page).getByRole('button', { name: 'Lưu các dòng' }).click()
  await expect(record(page).getByRole('alert')).toContainText(
    `Dòng “${MASK}”: số lượng không được nhỏ hơn 1, số đã giao hoặc đã lập hoá đơn.`,
  )
})
