import type { Page } from '@playwright/test'
import { DESKTOP, expect, settled, signIn, test } from '../product_backend/support.js'

// M15 (#1431, K7 K45–K49), on the Commerce deployment: shipping with the company's own carriers. Fixture:
// GHN (default; 20.000 ₫ the first kilogram, 5.000 ₫ each one begun after it, 1,5% of COD) and Viettel
// Post; deliveries of 2 GH-15 (300.000 ₫, paid on delivery), each to its own customer: Khách giao A with no
// parcel, B and C in the queue, D booked, E failed, F a draft, G brought back by Viettel Post, H delivered
// by GHN.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const main = (page: Page) => page.locator('main')
const record = (page: Page) => page.locator('[data-ui="record-page"]')
const row = (page: Page, text: string | RegExp) => main(page).getByRole('row').filter({ hasText: text })
const badge = (page: Page) => record(page).locator('header [data-ui="badge"]').first()
/** Takes a step of the record page that asks first, and answers the question with the same step. */
const step = async (page: Page, name: string) => {
  await record(page).getByRole('button', { name, exact: true }).click()
  const confirm = page.getByRole('dialog')
  await confirm.getByRole('button', { name, exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await settled(page)
}

test('K48 K51 the delivery overview counts what is under way, and each figure opens the parcels it counts', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/delivery')
  await settled(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan giao hàng' })).toBeVisible()
  await expect(row(page, 'Giao Hàng Nhanh')).toBeVisible()
  await main(page)
    .getByRole('link', { name: /Không giao được/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Danh sách vận đơn' })).toBeVisible()
  await settled(page)
  await expect(row(page, 'Khách giao E')).toContainText('Giao không thành công')
  await expect(row(page, /Khách giao [A-DF-H]/)).toHaveCount(0)
})

test('K48 ticked deliveries become draft parcels; ticked parcels are handed over, the others skipped with why', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/delivery/dispatch')
  await settled(page)
  await expect(row(page, 'Khách giao B')).toContainText('Chưa có vận đơn')
  for (const customer of ['Khách giao B', 'Khách giao C'])
    await row(page, customer).getByRole('checkbox').check()
  await main(page).getByRole('button', { name: 'Tạo vận đơn', exact: true }).click()
  await expect(
    main(page).locator('[data-ui="notice"]').filter({ hasText: 'Đã tạo 2 vận đơn nháp' }),
  ).toBeVisible()
  await expect(row(page, 'Khách giao B')).toContainText('Chờ đặt vận chuyển')
  // The run leaves nothing ticked: none counted, and nothing to run again.
  await expect(main(page).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await expect(main(page)).toContainText('Đã chọn 0 dòng trên trang này')
  await expect(main(page).getByRole('button', { name: 'Tạo vận đơn', exact: true })).toBeDisabled()

  await page.goto('/admin/stock/shipments')
  await settled(page)
  for (const customer of ['Khách giao D', 'Khách giao B'])
    await row(page, customer).getByRole('checkbox').check()
  await main(page).getByRole('button', { name: 'Bàn giao các vận đơn đã chọn', exact: true }).click()
  const told = main(page).locator('[data-ui="notice"]').filter({ hasText: 'Đã bàn giao 1 vận đơn' })
  await expect(told).toBeVisible()
  await expect(told).toContainText('chưa đặt vận chuyển hoặc đã bàn giao')
  await expect(row(page, 'Khách giao D')).toContainText('Đang giao')
  await expect(row(page, 'Khách giao B')).toContainText('Nháp')
})

test('K47 the accountant draws up GHN’s statement, posts its fees and settles the rest through the bank', async ({
  page,
}) => {
  await signIn(page, 'ketoan', '/admin/stock/delivery-statements')
  await settled(page)
  await main(page).getByRole('link', { name: 'Tạo mới', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bảng đối soát mới' })).toBeVisible()
  await settled(page)
  await record(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^GHN\/DS\/\d{4}$/ })).toBeVisible()
  await settled(page)
  // H delivered 300.000 ₫ by GHN: 20.000 ₫ for its kilogram and 4.500 ₫ for collecting it.
  await expect(record(page).getByRole('row').filter({ hasText: 'Khách giao H' })).toBeVisible()
  await expect(record(page)).toContainText(/275\.500\s₫/)
  await step(page, 'Ghi sổ')
  await expect(badge(page)).toHaveText('Chờ tất toán')
  await expect(record(page).getByRole('link', { name: /^KHO\// })).toBeVisible()
  await record(page).getByRole('button', { name: 'Tất toán', exact: true }).click()
  const settle = page.getByRole('dialog')
  // The only bank journal with a default account is offered first.
  await expect(settle.getByRole('combobox', { name: 'Sổ nhận tiền' })).toHaveValue('journal-bank')
  await settle.getByRole('button', { name: 'Tất toán', exact: true }).click()
  await expect(settle).toHaveCount(0)
  await settled(page)
  await expect(badge(page)).toHaveText('Đã tất toán')
  await expect(record(page).getByRole('link', { name: /^BNK\// })).toBeVisible()
})

test('K46 a delivery makes its parcel; it is booked at the carrier’s fees, fails with a reason and is delivered again with its COD on the books', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/transfers/ship-a%3Adelivery')
  await settled(page)
  await record(page).getByRole('button', { name: 'Tạo vận đơn', exact: true }).click()
  await settled(page)
  await record(page)
    .getByRole('link', { name: /\/VD\/\d{4}$/ })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: /\/VD\/\d{4}$/ })).toBeVisible()
  await settled(page)
  await expect(badge(page)).toHaveText('Nháp')
  await expect(record(page).getByLabel('Thu hộ (COD)')).toHaveValue(/300[.,]?000/)
  const weight = record(page).getByLabel('Khối lượng (kg)')
  await weight.fill('2.4')
  // Booking with the weight not yet saved asks to save it, without fees of the saved parcel.
  await record(page).getByRole('button', { name: 'Đặt vận chuyển', exact: true }).click()
  const book = page.getByRole('dialog')
  await expect(book).toContainText('Lưu các thay đổi')
  await book.getByRole('button', { name: 'Đặt vận chuyển', exact: true }).click()
  await expect(book).toHaveCount(0)
  await settled(page)
  await expect(badge(page)).toHaveText('Chờ bàn giao')
  // 2,4 kg: 20.000 ₫ + 2 × 5.000 ₫, and 1,5% of 300.000 ₫.
  await expect(record(page)).toContainText(/GHN\d+/)
  await expect(record(page)).toContainText(/34\.500\s₫/)
  await step(page, 'Bàn giao')
  await expect(badge(page)).toHaveText('Đang giao')

  await record(page).getByRole('button', { name: 'Giao không thành công', exact: true }).click()
  const fail = page.getByRole('dialog')
  await fail.getByRole('button', { name: 'Giao không thành công', exact: true }).click()
  await expect(fail).toBeVisible()
  await fail.getByLabel('Lý do không giao được').fill('Khách không nghe máy')
  await fail.getByRole('button', { name: 'Giao không thành công', exact: true }).click()
  await expect(fail).toHaveCount(0)
  await settled(page)
  await expect(badge(page)).toHaveText('Giao không thành công')
  await expect(record(page)).toContainText('Khách không nghe máy')
  await step(page, 'Giao lại')
  await expect(badge(page)).toHaveText('Đang giao')
  await step(page, 'Giao thành công')
  await expect(badge(page)).toHaveText('Đã giao')
  await expect(record(page).getByRole('link', { name: /^KHO\// })).toBeVisible()
})

test('K46 a failed parcel comes back on a return of its delivery', async ({ page }) => {
  await signIn(page, 'admin', '/admin/stock/shipments/parcel-e')
  await settled(page)
  await expect(badge(page)).toHaveText('Giao không thành công')
  await expect(record(page)).toContainText('Khách hẹn lại ngày khác')
  await step(page, 'Hoàn hàng')
  await expect(badge(page)).toHaveText('Đã hoàn hàng')
  // Its return is a receipt: the parcel's page links it.
  await expect(record(page).getByRole('link', { name: /^HCM\/NK\/\d{4}$/ })).toBeVisible()
})

test('K46 a parcel is cancelled only with a reason, and its delivery goes back to the queue', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/stock/shipments/parcel-f')
  await settled(page)
  await record(page).getByRole('button', { name: 'Hủy vận đơn', exact: true }).click()
  const cancel = page.getByRole('dialog')
  await cancel.getByRole('button', { name: 'Hủy vận đơn', exact: true }).click()
  await expect(cancel).toBeVisible()
  // Spaces are no reason either: the server refuses them and the dialog stays.
  await cancel.getByLabel('Lý do hủy').fill('   ')
  await cancel.getByRole('button', { name: 'Hủy vận đơn', exact: true }).click()
  await expect(cancel.getByLabel('Lý do hủy')).toHaveAttribute('aria-invalid', 'true')
  await expect(badge(page)).toHaveText('Nháp')
  await cancel.getByLabel('Lý do hủy').fill('Khách đổi sang nhận tại cửa hàng')
  await cancel.getByRole('button', { name: 'Hủy vận đơn', exact: true }).click()
  await expect(cancel).toHaveCount(0)
  await settled(page)
  await expect(badge(page)).toHaveText('Đã hủy')
  await page.goto('/admin/stock/delivery/dispatch')
  await settled(page)
  await expect(row(page, 'Khách giao F')).toContainText('Chưa có vận đơn')
})

test('K47 a carrier statement is cancelled only with a reason', async ({ page }) => {
  await signIn(page, 'ketoan', '/admin/stock/delivery-statements/new')
  await settled(page)
  await record(page).getByRole('button', { name: 'Đơn vị vận chuyển', exact: true }).click()
  await page.getByRole('option', { name: 'Viettel Post', exact: true }).click()
  await record(page).getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^VTP\/DS\/\d{4}$/ })).toBeVisible()
  await settled(page)
  await expect(record(page).getByRole('row').filter({ hasText: 'Khách giao G' })).toContainText(
    'Đã hoàn hàng',
  )
  await record(page).getByRole('button', { name: 'Hủy bảng đối soát', exact: true }).click()
  const cancel = page.getByRole('dialog')
  await cancel.getByRole('button', { name: 'Hủy bảng đối soát', exact: true }).click()
  await expect(cancel).toBeVisible()
  await cancel.getByLabel('Lý do hủy').fill('Hãng gửi lại bảng khác')
  await cancel.getByRole('button', { name: 'Hủy bảng đối soát', exact: true }).click()
  await expect(cancel).toHaveCount(0)
  await settled(page)
  await expect(badge(page)).toHaveText('Đã hủy')
  await expect(record(page)).toContainText('Hãng gửi lại bảng khác')
})

test('K48 a seller reads a parcel but takes no step on it and sees no statement', async ({ page, ui }) => {
  ui.allow(
    /^403 GET \/admin\/stock\/delivery-statements$/u,
    'a seller is refused carrier statements on purpose',
  )
  await signIn(page, 'banhang', '/admin/stock/shipments/parcel-d')
  await settled(page)
  await expect(badge(page)).toHaveText(/Chờ bàn giao|Đang giao/)
  for (const name of ['Bàn giao', 'Hủy vận đơn', 'Giao thành công', 'Giao không thành công'])
    await expect(record(page).getByRole('button', { name, exact: true })).toHaveCount(0)
  await page.goto('/admin/stock/delivery-statements')
  await expect(main(page)).toContainText('Vai trò này không xem đối soát vận chuyển')
})

test('K45 carriers are behind the gear: a code is fixed, the default stays in use, and a new default releases the old', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/settings')
  await settled(page)
  await main(page)
    .getByRole('article', { name: 'Kho', exact: true })
    .getByRole('link', { name: 'Đơn vị vận chuyển', exact: true })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đơn vị vận chuyển' })).toBeVisible()
  await settled(page)
  await row(page, 'Giao Hàng Nhanh').getByRole('link').first().click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByLabel('Mã hãng')).toBeDisabled()
  await expect(modal.getByRole('button', { name: 'Ngừng dùng hãng', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await row(page, 'Viettel Post').getByRole('link').first().click()
  await modal.getByRole('combobox', { name: 'Hãng mặc định' }).selectOption({ label: 'Có' })
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click()
  await settled(page)
  await page.goto('/admin/stock/carriers')
  await settled(page)
  await expect(row(page, 'Viettel Post')).toContainText('Có')
  // The list marks only the default.
  await expect(row(page, 'Giao Hàng Nhanh')).not.toContainText('Có')
})
