import type { Page } from '@playwright/test'
import { DESKTOP, expect, fitsWidth, MOBILE, recordReady, settled, signIn, test } from './support.js'

// P17: the product page has three field groups. Each role edits its own group on the
// same page and saves it with the one save; the others are shown, not editable, and
// the server refuses a changed value in them whatever the page sent.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const PRODUCT = '/admin/product/templates/toner-groups'
const NAME = 'Toner chia nhóm trường'
const SERUM = 'Serum B5 phục hồi 30ml'

const save = async (page: Page) => {
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByText('Thay đổi đã được ghi nhận.')).toBeVisible()
}

test('a warehouse manager edits the barcode and nothing of the general or cost fields', async ({ page }) => {
  await signIn(page, 'stockkeeper', PRODUCT)
  await recordReady(page, NAME)
  // The form is live once its own group is editable; only then is an absent control absent.
  const barcode = page.getByRole('textbox', { name: 'Barcode' })
  await expect(barcode).toBeEditable()
  // The general fields are shown and locked for this role.
  await expect(page.getByRole('textbox', { name: 'Tên sản phẩm' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Giá bán' })).toBeDisabled()
  // The Commerce warehouse manager reads the cost (P16) but does not set it (P17).
  await expect(page.getByRole('textbox', { name: 'Giá vốn' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Giá vốn' })).not.toBeEditable()
  await barcode.fill('8938501230041')
  // The HS code is stock setup too, as on a variant.
  await page.getByRole('textbox', { name: 'Mã HS' }).fill('3304.99')
  await save(page)

  await page.reload()
  await recordReady(page, NAME)
  await expect(page.getByRole('textbox', { name: 'Barcode' })).toHaveValue('8938501230041')
  await expect(page.getByRole('textbox', { name: 'Mã HS' })).toHaveValue('330499')
})

test('an accountant edits the cost and nothing of the general or stock fields', async ({ page }) => {
  await signIn(page, 'bookkeeper', PRODUCT)
  await recordReady(page, NAME)
  const cost = page.getByRole('textbox', { name: 'Giá vốn' })
  await expect(cost).toBeEditable()
  await expect(page.getByRole('textbox', { name: 'Tên sản phẩm' })).toBeDisabled()
  await expect(page.getByText('Chỉ xem thông tin chung')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Barcode' })).not.toBeEditable()
  await expect(page.getByRole('textbox', { name: 'Mã HS' })).not.toBeEditable()
  await cost.fill('95000')
  await save(page)

  await page.reload()
  await recordReady(page, NAME)
  await expect(page.getByRole('textbox', { name: 'Giá vốn' })).toHaveValue('95.000')
})

test('the server refuses a general field changed by a role that holds only the stock setup', async ({
  page,
}) => {
  await signIn(page, 'stockkeeper', PRODUCT)
  const read = await page.request.post('/_ket/fn/product.getTemplate', { data: { id: 'toner-groups' } })
  const saved = await read.json()
  const template = saved.value ?? saved
  const answer = await page.request.post('/_ket/fn/product.saveRecord', {
    data: {
      id: 'toner-groups',
      name: template.name,
      type: template.type,
      expectedRevisionId: template.revisionId,
      listPrice: '1',
    },
  })
  expect(answer.status()).toBe(403)
})

test('an accountant signs in from the start and opens the product screens', async ({ page }) => {
  // The job role reads products but not the unit catalogue: the screens still open. Since D8 (#1404) it
  // also reads partners and sales orders, so it lands on the contacts, the first screen it may open.
  await signIn(page, 'bookkeeper', '/admin')
  await expect(page).toHaveURL(/\/admin\/partner\/partners/)
  await expect(page.getByText('E_FN_NOT_PERMITTED')).toHaveCount(0)
  await page.goto('/admin/product/templates')
  await expect(page.getByRole('heading', { name: 'Sản phẩm', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /Bông tẩy trang 120 miếng/ })).toBeVisible()
  await expect(page.getByText('E_FN_NOT_PERMITTED')).toHaveCount(0)
  await page.goto('/admin/product/variants')
  await expect(page.getByRole('heading', { name: 'Biến thể', level: 1 })).toBeVisible()
  await expect(page.getByText('E_FN_NOT_PERMITTED')).toHaveCount(0)
})

test('the administrator changes all three groups with the one save', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/toner-all')
  await recordReady(page, 'Toner đủ ba nhóm')
  const cost = page.getByRole('textbox', { name: 'Giá vốn' })
  await expect(cost).toBeEditable()
  await page.getByRole('textbox', { name: 'Giá bán' }).fill('240000')
  await page.getByRole('textbox', { name: 'Barcode' }).fill('8938501230065')
  await page.getByRole('textbox', { name: 'Mã HS' }).fill('3304.10')
  await cost.fill('95000')
  await save(page)

  await page.reload()
  await recordReady(page, 'Toner đủ ba nhóm')
  await expect(page.getByRole('textbox', { name: 'Giá bán' })).toHaveValue('240.000')
  await expect(page.getByRole('textbox', { name: 'Barcode' })).toHaveValue('8938501230065')
  await expect(page.getByRole('textbox', { name: 'Mã HS' })).toHaveValue('330410')
  await expect(page.getByRole('textbox', { name: 'Giá vốn' })).toHaveValue('95.000')
})

test('stock on hand locks the stock setup for the warehouse manager and the cost for the accountant', async ({
  page,
}) => {
  const reason = 'Còn tồn kho hoặc hàng đang giữ. Đưa tồn về 0 trước khi đổi cấu hình kho hoặc giá vốn.'
  await signIn(page, 'stockkeeper', '/admin/product/templates/serum')
  await recordReady(page, SERUM)
  await expect(page.getByRole('textbox', { name: 'Barcode' })).toBeEditable()
  await expect(page.getByRole('checkbox', { name: 'Theo dõi tồn kho', exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Truy xuất', exact: true })).toBeDisabled()
  await expect(page.getByText(reason).first()).toBeVisible()

  await page.context().clearCookies()
  await signIn(page, 'bookkeeper', '/admin/product/templates/serum')
  await recordReady(page, SERUM)
  await settled(page)
  await expect(page.getByRole('textbox', { name: 'Giá vốn' })).toBeDisabled()
  await expect(page.getByText(reason).first()).toBeVisible()
})

// Who only reads products: no command changes the product, and each field is read only.
for (const [login, seesCost] of [
  ['role-sales-representative', true],
  ['role-tenant-auditor', true],
  ['role-warehouse-operator', false],
] as const)
  test(`${login} reads the product with nothing to change${seesCost ? '' : ', without its cost'}`, async ({
    page,
  }) => {
    await signIn(page, login, PRODUCT)
    await recordReady(page, NAME)
    await settled(page)
    for (const name of ['Lưu thay đổi', 'Lưu trữ', 'Khôi phục'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Nhân bản', exact: true })).toHaveCount(0)
    // Every control of the record; the global search the shell keeps in main is not one.
    const editable = page
      .locator('main')
      .locator(
        'input:not([type="hidden"]):not([type="search"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])',
      )
    await expect(editable).toHaveCount(0)
    // Read only, the cost is a figure in the price section, not a field.
    await expect(page.getByRole('term').filter({ hasText: /^Giá vốn$/u })).toHaveCount(seesCost ? 1 : 0)
    await expect(page.getByRole('article').filter({ hasText: 'Biên lợi nhuận' })).toHaveCount(
      seesCost ? 1 : 0,
    )
  })

test('the type and the unit are fixed once a product exists', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/serum')
  await recordReady(page, SERUM)
  await settled(page)
  await expect(page.getByRole('combobox', { name: 'Loại', exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Đơn vị tính', exact: true })).toBeDisabled()
  await expect(
    page.getByText('Đơn vị tính cố định sau khi tạo: đơn hàng và tồn kho đã ghi số lượng theo đơn vị này.'),
  ).toBeVisible()
})

test('an accountant reads why a field is locked in English', async ({ page }) => {
  await signIn(page, 'bookkeeper', `${PRODUCT}?lang=en`, 'en')
  await recordReady(page, NAME)
  await expect(page.getByRole('textbox', { name: 'Cost' })).toBeEditable()
  await expect(page.getByText('The HS code is set up by the stock manager.')).toBeVisible()
  await expect(page.getByText('The barcode is set up by the stock manager.')).toBeVisible()
})

test.describe('on a phone, dark', () => {
  test.use({ viewport: MOBILE, colorScheme: 'dark' })

  test('an accountant reads the locked groups and still saves', async ({ page }) => {
    await signIn(page, 'bookkeeper', PRODUCT)
    await recordReady(page, NAME)
    await expect(page.getByRole('textbox', { name: 'Giá vốn' })).toBeEditable()
    await expect(page.getByText('Chỉ xem thông tin chung')).toBeVisible()
    await expect(page.getByText('Mã HS do Quản lý kho thiết lập.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled()
    await fitsWidth(page)
  })
})
