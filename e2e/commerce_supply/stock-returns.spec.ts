import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// C27 (K19), on the Commerce deployment. Fixture: 5 TH-01 counted; order-return sold 3 to Spa Hoa Mai and
// its delivery shipped all 3. The product is the spec's own.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const OIL = 'Tinh dầu khách trả'
const DELIVERY = '/admin/stock/transfers/order-return%3Adelivery'
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const status = (page: Page) => record(page).locator('[data-ui="record-page-status"]')
/** A fact of the Information block, read as its label and value. */
const fact = (page: Page, label: string) => record(page).locator(`dt:text-is("${label}") + dd`)
const picked = (page: Page) => record(page).getByRole('grid', { name: 'Đã lấy hàng', exact: true })

test('a warehouse operator returns part of a delivery; each page opens the other and the order delivers less', async ({
  page,
}) => {
  await signIn(page, 'thukho', DELIVERY)
  await settled(page)
  await expect(status(page)).toContainText('Hoàn tất')
  // The delivery deals with a customer, not a supplier.
  await expect(fact(page, 'Khách hàng')).toHaveText('Spa Hoa Mai')
  await expect(record(page).locator('dt:text-is("Nhà cung cấp")')).toHaveCount(0)
  const delivery = (await record(page).getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''

  // Return makes the return receipt and opens it.
  await record(page).getByRole('button', { name: 'Trả hàng', exact: true }).click()
  await expect(record(page).getByRole('heading', { level: 1 })).not.toHaveText(delivery)
  await settled(page)
  // K18 (C27 G2): a return receipt holds nothing, so once confirmed it is ready to receive.
  await expect(status(page)).toContainText('Sẵn sàng')
  await expect(record(page).getByRole('status').filter({ hasText: 'Phiếu trả hàng' })).toContainText(
    'Ghi số khách trả thực tế ở lưới Đã lấy hàng',
  )
  await expect(fact(page, 'Khách hàng')).toHaveText('Spa Hoa Mai')
  await expect(fact(page, 'Trả hàng của').getByRole('link')).toHaveText(delivery)
  // A return receipt holds nothing and its products are the delivery's (K21).
  await expect(record(page).getByRole('button', { name: 'Giữ hàng', exact: true })).toHaveCount(0)
  await expect(record(page).getByRole('button', { name: 'Thêm sản phẩm', exact: true })).toHaveCount(0)
  const back = (await record(page).getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''
  // A return comes in, numbered as the warehouse's receipts are (C28).
  expect(back).toMatch(/^HCM\/NK\/\d{4}$/)

  // One of the three came back.
  await record(page).getByRole('button', { name: 'Thêm dòng' }).click()
  await page.keyboard.type('Tinh dầu')
  await page
    .getByRole('listbox', { name: 'Sản phẩm' })
    .getByRole('option', { name: new RegExp(OIL) })
    .click()
  const line = picked(page).getByRole('row').filter({ hasText: OIL })
  await line.getByRole('gridcell').nth(1).click()
  await page.keyboard.type('1')
  await page.keyboard.press('Enter')
  await expect(line.getByRole('checkbox', { name: 'Đã lấy hàng' })).toBeChecked()
  await record(page).getByRole('button', { name: 'Lưu dòng' }).click()
  await expect(picked(page).locator('[data-unsaved="true"]')).toHaveCount(0)
  await record(page).getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  // The other two stay with the customer: no backorder waits for them.
  const validate = page.getByRole('dialog', { name: 'Hoàn tất' })
  await validate.getByRole('radio', { name: 'Hoàn tất, không tạo đơn bù' }).check()
  await validate.getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  await expect(status(page)).toContainText('Hoàn tất')
  // A done return no longer explains how to fill it.
  await expect(record(page).getByRole('status').filter({ hasText: 'Phiếu trả hàng' })).toHaveCount(0)

  // The delivery lists the return, and the 2 still out with the customer may come back.
  await fact(page, 'Trả hàng của').getByRole('link').click()
  await expect(record(page).getByRole('heading', { level: 1 })).toHaveText(delivery)
  await settled(page)
  await expect(fact(page, 'Phiếu trả').getByRole('link')).toHaveText(back)
  await expect(record(page).getByRole('button', { name: 'Trả hàng', exact: true })).toBeVisible()

  // The storekeeper completes transfers but does not read sales orders.
  await page.context().clearCookies()
  await signIn(page, 'admin', '/admin/sales/orders/order-return')
  await settled(page)
  // Ordered 3, delivered 3 less the 1 returned, none invoiced.
  await expect(
    record(page).getByRole('grid', { name: 'Sản phẩm' }).getByRole('row').filter({ hasText: OIL }),
  ).toHaveAccessibleName(/^TH-01 Tinh dầu khách trả Gói 3 150000 0% 2 0$/)
})

test('who may only read transfers sees the customer but is not offered a return', async ({ page }) => {
  await signIn(page, 'reader', DELIVERY)
  await settled(page)
  await expect(status(page)).toContainText('Hoàn tất')
  await expect(fact(page, 'Khách hàng')).toHaveText('Spa Hoa Mai')
  await expect(record(page).getByRole('button', { name: 'Trả hàng', exact: true })).toHaveCount(0)
})
