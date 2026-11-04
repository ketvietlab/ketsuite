import type { Page } from '@playwright/test'
import { DESKTOP, expect, listReady, pickFromMenu, rowNames, settled, signIn, test } from './support.js'

// C14 (P56): a filter shared within the company reads for everyone and edits for its owner only,
// a name repeats for no one's own filters even in another case, and SKUs filter by lot tracking.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const saved = (page: Page) => page.getByRole('button', { name: /^Đã lưu/ })
const saveCurrent = async (page: Page, name: string, share: boolean) => {
  await saved(page).click()
  await page.getByRole('menuitem', { name: 'Lưu bộ lọc này' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lưu bộ lọc' })
  await expect(dialog).toBeVisible()
  await settled(page)
  await dialog.getByRole('textbox', { name: 'Tên bộ lọc' }).fill(name)
  if (share) await dialog.getByRole('checkbox', { name: 'Chia sẻ trong công ty' }).check()
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  return dialog
}

test('a filter shared within the company reads for a colleague, who may not edit it', async ({ browser }) => {
  const owner = await browser.newPage()
  await signIn(owner)
  await listReady(owner)
  await pickFromMenu(owner, /^Công dụng:/, 'Không bán')
  await listReady(owner)
  const kept = await rowNames(owner)
  expect(kept).toContain('Niacinamide nguyên liệu')
  const dialog = await saveCurrent(owner, 'Nguyên liệu không bán', true)
  await expect(dialog).toHaveCount(0)
  await listReady(owner)
  await expect(owner.getByRole('button', { name: 'Đã lưu: Nguyên liệu không bán' })).toBeVisible()
  // The owner edits it under its own name.
  await saved(owner).click()
  await expect(owner.getByRole('menuitem', { name: 'Sửa bộ lọc "Nguyên liệu không bán"' })).toBeVisible()
  await owner.close()

  const colleague = await browser.newPage()
  await signIn(colleague, 'stockkeeper')
  await listReady(colleague)
  await saved(colleague).click()
  await colleague.getByRole('menuitemcheckbox', { name: 'Nguyên liệu không bán · Chia sẻ' }).click()
  await listReady(colleague)
  await expect(colleague.getByRole('button', { name: 'Đã lưu: Nguyên liệu không bán' })).toBeVisible()
  await expect(colleague.getByRole('button', { name: 'Công dụng: Không bán' })).toBeVisible()
  expect(await rowNames(colleague)).toEqual(kept)
  // Someone else's filter reads only: there is nothing to edit.
  await saved(colleague).click()
  await expect(colleague.getByRole('menuitem', { name: /^Sửa bộ lọc/ })).toHaveCount(0)
  await colleague.close()
})

test('a name already used by one of my filters is refused in any case', async ({ page }) => {
  await signIn(page)
  await listReady(page)
  await pickFromMenu(page, /^Công dụng:/, 'Có thể mua')
  await listReady(page)
  const dialog = await saveCurrent(page, 'NGUYÊN LIỆU KHÔNG BÁN', false)
  await expect(dialog.getByRole('textbox', { name: 'Tên bộ lọc' })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Hủy' }).click()
})

test('SKUs filter by lot tracking, taken from the product that holds them', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/variants')
  await expect(page.getByRole('heading', { level: 1, name: 'Biến thể sản phẩm' })).toBeVisible()
  await settled(page)
  await page.getByRole('button', { name: /^Công dụng:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Theo dõi theo lô' }).click()
  await expect(page).toHaveURL(/use=tracked/)
  await settled(page)
  const table = page.getByRole('region', { name: 'Biến thể sản phẩm' }).getByRole('table')
  await expect(table.getByRole('row', { name: /Kem chống nắng có báo giá/ })).toHaveCount(1)
  await expect(table.getByRole('row', { name: /Bông tẩy trang 120 miếng/ })).toHaveCount(0)
})
