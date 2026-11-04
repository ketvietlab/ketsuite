import type { Page } from '@playwright/test'
import { DESKTOP, expect, recordReady, settled, signIn, test } from '../product_backend/support.js'

// C26 (K22–K26), on the Commerce deployment. Fixture: 10 packs of SV-01 counted at 100.000 ₫; order
// order-cost of 4 sent 2 (200.000 ₫) and holds 2 on its backorder; HCM/IN/0026 then took in 2 at
// 200.000 ₫, so the company holds 10 worth 1.200.000 ₫, 120.000 ₫ each.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const SERUM = 'Serum giá vốn bình quân'
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const valuation = (page: Page) => page.getByRole('row').filter({ hasText: 'SV-01' })
/** The done transfer's Giá trị card: what it was worth and the entry it posted. */
const worth = (page: Page) =>
  record(page)
    .locator('[data-ui="surface"]')
    .filter({ has: page.getByRole('heading', { name: 'Giá trị', exact: true }) })

test('the stock value reads the average a dearer receipt left, and its entry opens the receipt again', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/valuation')
  await settled(page)
  // On hand, average cost and stock value (K22, K26).
  await expect(valuation(page)).toHaveAccessibleName(`SV-01 ${SERUM} 10 Gói 120.000 ₫ 1.200.000 ₫`)
  await page.goto('/admin/stock/transfers/receipt-cost')
  await recordReady(page, 'HCM/IN/0026')
  await settled(page)
  // The done receipt says what it was worth and opens the entry it posted on the stock journal (K23, K25).
  const value = worth(page)
  await expect(value).toContainText('Giá trị phiếu400.000 ₫')
  await value.getByRole('link', { name: /^KHO\// }).click()
  await expect(page).toHaveURL(/\/admin\/accounting\/entries\/stock-valuation%3Areceipt-cost/)
  // Its lines debit the goods and credit the goods in transit: 156 / 151.
  await expect(page.locator('main')).toContainText('156')
  await expect(page.locator('main')).toContainText('151')
  await page.getByRole('link', { name: 'HCM/IN/0026' }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/receipt-cost(\?|$)/)
  await recordReady(page, 'HCM/IN/0026')
})

test('a sales line costs what its goods took out, and the rest at the average once they go', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/orders/order-cost')
  await settled(page)
  const costs = record(page).getByRole('table', { name: 'Giá vốn của các dòng đã lưu' })
  const serum = costs.getByRole('row').filter({ hasText: SERUM })
  // 2 sent at 100.000 ₫ and 2 to send, counted at what they cost when the order last moved.
  await expect(serum).toContainText('100.000')
  const deliveries = record(page).getByRole('table', { name: 'Giao hàng' })
  await deliveries
    .getByRole('row')
    .filter({ hasNotText: 'Hoàn tất' })
    .filter({ hasText: SERUM })
    .getByRole('link')
    .click()
  await settled(page)
  // The two held are picked, then the backorder is done.
  const picked = record(page).getByRole('grid', { name: 'Đã lấy hàng', exact: true })
  await picked
    .getByRole('row')
    .filter({ hasText: SERUM })
    .getByRole('checkbox', { name: 'Đã lấy hàng' })
    .check()
  await record(page).getByRole('button', { name: 'Lưu dòng' }).click()
  await expect(picked.locator('[data-unsaved="true"]')).toHaveCount(0)
  await record(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Hoàn tất' })
    .getByRole('button', { name: 'Hoàn tất', exact: true })
    .click()
  await expect(record(page).locator('[data-ui="record-page-status"]')).toContainText('Hoàn tất')
  // The backorder took 2 × 120.000 ₫: the line now costs (200.000 + 240.000) ÷ 4 = 110.000 ₫ (K25),
  // and its margin is 4 × (250.000 − 110.000).
  await page.goto('/admin/sales/orders/order-cost')
  await settled(page)
  await expect(serum).toContainText('110.000')
  await expect(serum).toContainText('560.000')
  // The stock value took them out at the average.
  await page.goto('/admin/stock/valuation')
  await settled(page)
  await expect(valuation(page)).toHaveAccessibleName(`SV-01 ${SERUM} 8 Gói 120.000 ₫ 960.000 ₫`)
})

test('who may not see stock value finds the screen locked and no value on the receipt', async ({
  page,
  ui,
}) => {
  ui.allow(/^403 GET \/admin\/stock\/valuation$/u, 'the storekeeper is refused stock value on purpose')
  await signIn(page, 'thukho', '/admin/stock/valuation')
  await expect(page.locator('main')).toContainText('không xem được giá trị tồn kho')
  await page.goto('/admin/stock/transfers/receipt-cost')
  await recordReady(page, 'HCM/IN/0026')
  await settled(page)
  await expect(record(page).getByRole('heading', { name: 'Giá trị', exact: true })).toHaveCount(0)
  await expect(record(page).getByRole('columnheader', { name: 'Giá trị', exact: true })).toHaveCount(0)
})

test('a delivery done with nothing ticked goes as held; one holding nothing says there is nothing to do', async ({
  page,
  ui,
}) => {
  ui.allow(/^last screen alert: /u, 'completing a delivery that holds nothing is refused on purpose')
  await signIn(page, 'admin', '/admin/stock/transfers/delivery-held')
  await recordReady(page, 'HCM/OUT/0026')
  await settled(page)
  await record(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Hoàn tất' })
  await confirm.getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await expect(record(page).locator('[data-ui="record-page-status"]')).toContainText('Hoàn tất')
  // The two held left, at the 60.000 ₫ they were counted at.
  await expect(worth(page)).toContainText('Giá trị phiếu120.000 ₫')
  await page.goto('/admin/stock/transfers/delivery-idle')
  await recordReady(page, 'HCM/OUT/0027')
  await settled(page)
  await record(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await confirm.getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await expect(record(page).getByRole('alert')).toContainText(
    'Chưa có số lượng nào để hoàn tất: nhập Đã làm hoặc chờ có hàng.',
  )
})
