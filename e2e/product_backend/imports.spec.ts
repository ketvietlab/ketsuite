import type { Page } from '@playwright/test'
import { DESKTOP, expect, listReady, settled, signIn, test } from './support.js'

// C13 (P52–P54): an import is one record, rows are variants, one bad row writes nothing, the
// export reads back unchanged, and a reader holds the history without the import command.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const IMPORTS = '/admin/product/imports'
// Pasted from a spreadsheet: tab separated, Vietnamese headers in any order, a thousand separator.
const sheet = (rows: string[][]) => rows.map((row) => row.join('\t')).join('\n')
const HEADER = ['Tên sản phẩm', 'Mã sản phẩm', 'Đơn vị', 'Giá bán']
const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Nhập sản phẩm' })

const openNew = async (page: Page, signedIn = false) => {
  if (signedIn) await page.goto('/admin/product/templates')
  else await signIn(page, 'admin', '/admin/product/templates')
  await listReady(page)
  // The products list opens a new import beside its other actions (P52).
  await page.getByRole('link', { name: 'Nhập', exact: true }).click()
  await expect(importDialog(page)).toBeVisible()
  await settled(page)
}

test('one bad row writes nothing and names its row and column', async ({ page, ui }) => {
  ui.allow(/422 POST/, 'the import is refused on purpose')
  await openNew(page)
  await importDialog(page)
    .getByRole('textbox', { name: 'Dữ liệu nhập' })
    .fill(
      sheet([
        HEADER,
        ['Toner nhập lỗi', 'IMPERR-1', 'Cái', '120000'],
        ['Toner nhập lỗi 2', 'IMPERR-2', 'Thùng', '1'],
      ]),
    )
  await importDialog(page).getByRole('button', { name: 'Nhập', exact: true }).click()
  await expect(importDialog(page)).toContainText(
    'Dòng 3, cột Đơn vị: Không tìm thấy lựa chọn đang hoạt động.',
  )
  // The good row before it was not written either.
  await page.goto('/admin/product/templates?q=IMPERR')
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(0)
})

test('an import creates products in one record, and the same rows again change nothing', async ({ page }) => {
  const rows = sheet([
    HEADER,
    ['Nước hoa hồng nhập', 'IMP-01', 'Cái', '159.000'],
    ['Sữa rửa mặt nhập', 'imp-02', 'Cái', '89,000'],
  ])
  await openNew(page)
  await expect(importDialog(page).getByRole('link', { name: 'Tải danh sách sản phẩm để sửa' })).toBeVisible()
  // Its guide says why a download can be refused and what the message names.
  await expect(importDialog(page)).toContainText('thông báo nêu tên chúng để sửa trước')
  await importDialog(page).getByRole('textbox', { name: 'Dữ liệu nhập' }).fill(rows)
  await importDialog(page).getByRole('button', { name: 'Nhập', exact: true }).click()
  // The record reads back: who imported, rows, products created and changed.
  const record = page.getByRole('dialog').filter({ hasText: /NHAP\/\d{4}/ })
  await expect(record).toContainText('Số dòng')
  const fact = (term: string) =>
    record.getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::dd[1]')
  await expect(fact('Số dòng')).toHaveText('2')
  await expect(fact('Sản phẩm mới')).toHaveText('2')
  await expect(fact('Sản phẩm thay đổi')).toHaveText('0')
  await expect(record.getByRole('heading', { name: 'Sản phẩm trong lần nhập' })).toBeVisible()
  await expect(record.getByRole('link', { name: 'IMP-01 · Nước hoa hồng nhập' })).toBeVisible()
  // The time reads like the product history beside it, in the company's time zone.
  await expect(fact('Thời điểm')).toHaveText(/^\d{2}:\d{2} \d{1,2} thg \d{1,2}, \d{4}$/)
  // 159.000 is a hundred and fifty-nine thousand.
  await page.goto('/admin/product/templates?q=IMP-0')
  await listReady(page)
  await expect(
    page.locator('[data-product-list="true"] tbody tr').filter({ hasText: 'Nước hoa hồng nhập' }),
  ).toContainText('159.000')

  // Pasted again, nothing differs: nothing is saved or counted.
  await openNew(page, true)
  await importDialog(page).getByRole('textbox', { name: 'Dữ liệu nhập' }).fill(rows)
  await importDialog(page).getByRole('button', { name: 'Nhập', exact: true }).click()
  const again = page.getByRole('dialog').filter({ hasText: /NHAP\/\d{4}/ })
  await expect(
    again.getByRole('term').filter({ hasText: 'Sản phẩm mới' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('0')
  await expect(
    again
      .getByRole('term')
      .filter({ hasText: 'Sản phẩm thay đổi' })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('0')
})

test('a warehouse operator reads the import history and exports without costs, but cannot import', async ({
  page,
}) => {
  await signIn(page, 'role-warehouse-operator', IMPORTS)
  await settled(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Nhập sản phẩm' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Nhập', exact: true })).toHaveCount(0)
  // The history lists the imports made above, with the time in the product history's form.
  const first = page
    .getByRole('row')
    .filter({ hasText: /NHAP\/\d{4}/ })
    .first()
  await expect(first.getByRole('cell').nth(1)).toHaveText(/^\d{2}:\d{2} \d{1,2} thg \d{1,2}, \d{4}$/)
  // Products kept from before codes were required cannot round-trip: the export names them
  // instead of handing back a sheet that would import as new products (P54).
  const exported = await page.request.get('/admin/product/imports/export')
  expect(exported.status()).toBe(422)
  const message = await exported.text()
  expect(message).toMatch(
    /^Một số sản phẩm thiếu mã ổn định hoặc thuộc tính đầy đủ: .+ và \d+ sản phẩm khác\. Sửa các bản ghi đó trước khi xuất\.$/,
  )
  expect(message).toContain('Son dưỡng có ảnh')
})
