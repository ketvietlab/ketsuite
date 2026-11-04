import { DESKTOP, expect, gridLine, recordReady, settled, signIn, test } from './support.js'

// C18 (D29): a section saved as a template carries its products and quantities, not its prices.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

test('a section saved as a template is added to another quotation at that order’s prices', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-template-from')
  await recordReady(page, /^S\d+/)
  await settled(page)
  // The menu opens its dialog over the quotation page, which has no Info tab to send it to.
  await page
    .locator('[data-ui="record-page"]')
    .getByRole('button', { name: 'Nhóm hàng mẫu', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Lưu “Bộ chăm sóc tối” làm mẫu' }).click()
  const save = page.getByRole('dialog', { name: 'Lưu nhóm hàng làm mẫu' })
  await expect(save).toBeVisible()
  await expect(save).toContainText('Giá được tính lại khi chèn vào đơn.')
  await save.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(save).toBeHidden()

  await page.goto('/admin/sales/quotations/quote-template-to')
  await recordReady(page, /^S\d+/)
  await settled(page)
  await page.locator('[data-ui="record-page"]').getByRole('button', { name: 'Thêm nhóm hàng mẫu' }).click()
  const add = page.getByRole('dialog', { name: 'Thêm nhóm hàng mẫu' })
  await expect(add).toBeVisible()
  await add.getByRole('button', { name: /Nhóm hàng mẫu/ }).click()
  await page.getByRole('option', { name: /Bộ chăm sóc tối/ }).click()
  await add.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(add).toBeHidden()
  await settled(page)
  // Kept after a reload: the section and its product at this order's price, not the 999.000 it had.
  await page.reload()
  await recordReady(page, /^S\d+/)
  await settled(page)
  await expect(gridLine(page, /Bộ chăm sóc tối/)).toBeVisible()
  const serum = gridLine(page, /SR-B5-30/)
  await expect(serum).toContainText('350000')
  await expect(serum).not.toContainText('999000')
  await expect(page.locator('[data-ui="record-page"]')).toContainText(/Tổng tiền\s*700\.000\s₫/)
})

test('who only reads a quotation neither saves its sections nor adds one from a template', async ({
  page,
}) => {
  await signIn(page, 'role-tenant-auditor', '/admin/sales/quotations/quote-template-from')
  await recordReady(page, /^S\d+/)
  const record = page.locator('[data-ui="record-page"]')
  await expect(record.getByText('Bộ chăm sóc tối').first()).toBeVisible()
  await expect(record.getByRole('button', { name: 'Nhóm hàng mẫu', exact: true })).toHaveCount(0)
  await expect(record.getByRole('button', { name: 'Thêm nhóm hàng mẫu' })).toHaveCount(0)
})
