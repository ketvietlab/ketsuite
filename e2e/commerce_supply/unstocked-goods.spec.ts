import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// C29 (K-CONSU), on the Commerce deployment. Fixture: gift bags (TG-01) are not kept in stock;
// order-unstocked sold 4 to Spa Hoa Mai and its delivery is confirmed. The product is the spec's own.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const BAG = 'Túi giấy quà tặng'
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const status = (page: Page) => record(page).locator('[data-ui="record-page-status"]')

test('a warehouse operator holds and delivers goods not kept in stock, and the order counts them delivered', async ({
  page,
}) => {
  await signIn(page, 'thukho', '/admin/stock/transfers/order-unstocked%3Adelivery')
  await settled(page)
  await expect(record(page).getByRole('heading', { level: 1 })).toHaveText(/^HCM\/XK\/\d{4}$/)
  // Nothing in stock limits goods that are not kept there: holding takes all four.
  await record(page).getByRole('button', { name: 'Giữ hàng', exact: true }).click()
  await settled(page)
  await expect(status(page)).toContainText('Sẵn sàng')
  await expect(record(page).getByRole('alert')).toHaveCount(0)
  await expect(
    record(page)
      .getByRole('grid', { name: 'Đã lấy hàng', exact: true })
      .getByRole('row')
      .filter({ hasText: BAG }),
  ).toHaveCount(1)
  await record(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Hoàn tất' })
    .getByRole('button', { name: 'Hoàn tất', exact: true })
    .click()
  await expect(status(page)).toContainText('Hoàn tất')

  await page.context().clearCookies()
  await signIn(page, 'admin', '/admin/sales/orders/order-unstocked')
  await settled(page)
  // Ordered 4, delivered 4, none invoiced.
  await expect(
    record(page).getByRole('grid', { name: 'Sản phẩm' }).getByRole('row').filter({ hasText: BAG }),
  ).toHaveAccessibleName(/^TG-01 Túi giấy quà tặng Gói 4 5000 0% 4 0$/)
})
