import type { Page } from '@playwright/test'
import {
  DESKTOP,
  MOBILE,
  evidence,
  expect,
  fitsWidth,
  settled,
  signIn,
  test,
} from '../product_backend/support.js'

// Approval by amount (#1737), on the Commerce deployment: the company's two thresholds live behind the
// rail's gear, and an RFQ from them waits for a purchasing manager, then a final approver.

test.use({ locale: 'vi-VN' })

const SETTINGS = '/admin/purchase/configuration'
const RFQ = '/admin/purchase/rfqs/rfq-approval'
/** The order's Approval block: the section under its own heading. */
const facts = (page: Page) =>
  page
    .locator('main section[data-ui="section"]')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Phê duyệt', exact: true }) })
const command = (page: Page, name: string) => page.locator('main').getByRole('button', { name, exact: true })

for (const [width, viewport] of [
  ['desktop', DESKTOP],
  ['mobile', MOBILE],
] as const)
  test(`the purchasing settings show and save the approval thresholds (${width})`, async ({ page }, info) => {
    await page.setViewportSize(viewport)
    await signIn(page, 'admin', SETTINGS)
    await settled(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Cấu hình mua hàng' })).toBeVisible()
    const first = page.getByLabel('Ngưỡng duyệt cấp 1', { exact: true })
    const final = page.getByLabel('Ngưỡng duyệt cấp cuối', { exact: true })
    await expect(first).toHaveValue('50000000')
    await expect(final).toHaveValue('200000000')
    await fitsWidth(page)
    await evidence(page, info, `settings-${width}`)

    // A final threshold not above the first is refused where it was typed, and nothing changes.
    await final.fill('40000000')
    await page
      .locator('#purchase-configuration-approval')
      .getByRole('button', { name: 'Lưu', exact: true })
      .click()
    await expect(
      page.getByText('Ngưỡng duyệt cấp cuối cần ngưỡng cấp 1 và phải lớn hơn ngưỡng đó.'),
    ).toBeVisible()
    await expect(final).toHaveAttribute('aria-invalid', 'true')
    await page.reload()
    await settled(page)
    await expect(final).toHaveValue('200000000')
  })

test('an RFQ from both thresholds is sent for approval and needs a manager, then a final approver', async ({
  page,
}, info) => {
  await page.setViewportSize(DESKTOP)
  await signIn(page, 'admin', RFQ)
  await settled(page)
  await expect(facts(page)).toContainText('Hai cấp: quản lý mua hàng, rồi người duyệt cấp cuối')
  // From a threshold, sending for approval is the only way to confirm.
  await expect(command(page, 'Xác nhận đơn')).toHaveCount(0)
  await command(page, 'Gửi duyệt').click()
  await settled(page)
  await expect(page.locator('main')).toContainText('Chờ duyệt')
  await expect(facts(page)).toContainText('Còn chờ')
  await expect(facts(page)).toContainText('Quản lý mua hàng · Người duyệt cấp cuối')

  await command(page, 'Phê duyệt').click()
  await settled(page)
  await expect(facts(page)).toContainText('Quản lý mua hàng: Chủ doanh nghiệp')
  await expect(command(page, 'Phê duyệt')).toHaveCount(0)
  await expect(facts(page)).toContainText(/Còn chờ\s*Người duyệt cấp cuối/)
  await evidence(page, info, 'order-waiting-final-desktop')

  await command(page, 'Duyệt cấp cuối').click()
  await settled(page)
  await expect(page.locator('main')).toContainText('Đơn mua hàng')
  await expect(facts(page)).toContainText('Người duyệt cấp cuối: Chủ doanh nghiệp')
  await expect(command(page, 'Duyệt cấp cuối')).toHaveCount(0)
})

test('the settings speak English to an English reader', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await signIn(page, 'admin', `${SETTINGS}?lang=en`, 'en')
  await settled(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Purchasing settings' })).toBeVisible()
  await expect(page.getByLabel('Level 1 approval threshold', { exact: true })).toHaveValue('50000000')
  await expect(page.getByLabel('Final approval threshold', { exact: true })).toBeVisible()
})

test('in its record modal on a phone, an RFQ from the first threshold waits for one manager', async ({
  page,
}, info) => {
  await page.setViewportSize(MOBILE)
  await signIn(page, 'admin', '/admin/purchase/rfqs?record=purchase.order%3Arfq-approval-one')
  await settled(page)
  const sheet = page.getByRole('dialog')
  const block = sheet
    .locator('section[data-ui="section"]')
    .filter({ has: page.getByRole('heading', { name: 'Phê duyệt', exact: true }) })
  await expect(block).toContainText('Một cấp: quản lý mua hàng')
  await expect(sheet.getByRole('button', { name: 'Xác nhận đơn', exact: true })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
  await expect(block).toContainText(/Còn chờ\s*Quản lý mua hàng/)
  await expect(sheet.getByRole('button', { name: 'Duyệt cấp cuối', exact: true })).toBeVisible()
  await evidence(page, info, 'modal-waiting-mobile')
  await sheet.getByRole('button', { name: 'Phê duyệt', exact: true }).click()
  await expect(sheet).toContainText('Đơn mua hàng')
  await expect(block).toContainText('Quản lý mua hàng: Chủ doanh nghiệp')
  await fitsWidth(page)
})
