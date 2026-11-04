import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// C28 (K17), on the Commerce deployment: transfers take their warehouse's number by kind (HCM/NK, HCM/XK,
// HCM/CK), whether a sales order, a return or a person makes them; a typed reference stays.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const record = (page: Page) => page.locator('[data-ui="record-page"]')
const heading = (page: Page) => record(page).getByRole('heading', { level: 1 })

const create = async (page: Page, reference?: string) => {
  await page.goto('/admin/stock/transfers/new?lang=vi')
  await settled(page)
  const field = record(page).getByRole('textbox', { name: 'Tham chiếu' })
  // Left blank, it is numbered.
  await expect(field).toHaveAccessibleDescription(/Để trống thì phiếu lấy số kế tiếp của kho theo loại/)
  if (reference) await field.fill(reference)
  await record(page).getByRole('button', { name: 'Loại hoạt động', exact: true }).click()
  // Each operation type names its warehouse under it.
  await page.getByRole('option', { name: /^Điều chuyển nội bộ\s*Kho Hồ Chí Minh/ }).click()
  await record(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/stock\/transfers\/(?!new)[^/?]+\?/)
}

test('a transfer made with no reference takes the next internal number; a typed one stays', async ({
  page,
}) => {
  await signIn(page, 'thukho', '/admin/stock/transfers?lang=vi')
  await create(page)
  await expect(heading(page)).toHaveText(/^HCM\/CK\/\d{4}$/)
  const first = Number((await heading(page).textContent())!.trim().slice(-4))
  await create(page, 'Đổi kệ E2E')
  await expect(heading(page)).toHaveText('Đổi kệ E2E')
  await create(page)
  await expect(heading(page)).toHaveText(`HCM/CK/${String(first + 1).padStart(4, '0')}`)
})

test("a sales order's delivery goes out under the warehouse's delivery number", async ({ page }) => {
  await signIn(page, 'thukho', '/admin/stock/transfers/order-return%3Adelivery')
  await settled(page)
  await expect(heading(page)).toHaveText(/^HCM\/XK\/\d{4}$/)
})
