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

// Vendor price validity (#1737), on the Commerce deployment: the vendor price list says whether each
// price applies today and filters on it, and a price saved for today alone is in force all day.

test.use({ locale: 'vi-VN' })

const LIST = '/admin/purchase/vendor-pricelists'
const validity = (page: Page, id: string) => page.locator(`[data-row="${id}"] [data-col="validity"]`)
const rows = async (page: Page) =>
  (
    await page
      .locator('[data-row]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-row')))
  )
    .filter((id): id is string => Boolean(id))
    .sort()

test('the vendor price list shows each price validity, filters on it and explains it (desktop)', async ({
  page,
}, info) => {
  await page.setViewportSize(DESKTOP)
  await signIn(page, 'admin', LIST)
  await settled(page)
  await expect(page.getByRole('columnheader', { name: 'Hiệu lực' })).toBeVisible()
  await expect(validity(page, 'swab-today')).toContainText('Đang hiệu lực')
  await expect(validity(page, 'swab-ended')).toContainText('Hết hạn')
  await expect(validity(page, 'swab-ended')).toContainText('1/1/25 – 31/12/25')
  await expect(validity(page, 'swab-later')).toContainText('Sắp hiệu lực')
  await expect(validity(page, 'swab-later')).toContainText('Từ 1/1/99')
  await expect(validity(page, 'pads-east')).toContainText('Không giới hạn')
  await fitsWidth(page)
  await evidence(page, info, 'list-desktop')

  // The presets the search bar writes narrow the list to one state.
  await page.goto(`${LIST}?lang=vi&preset=expired`)
  await settled(page)
  expect(await rows(page)).toEqual(['swab-ended'])
  await page.goto(`${LIST}?lang=vi&preset=upcoming`)
  await settled(page)
  expect(await rows(page)).toEqual(['swab-later'])
  await page.goto(`${LIST}?lang=vi&preset=current`)
  await settled(page)
  expect(await rows(page)).toContain('swab-today')
  expect(await rows(page)).not.toContain('swab-ended')

  // The screen's Help explains the column and how a request for quotation picks a price.
  await page.goto(`${LIST}?lang=vi`)
  await settled(page)
  await page.getByRole('button', { name: 'Hướng dẫn màn hình' }).click()
  const help = page.getByRole('dialog', { name: 'Bảng giá nhà cung cấp' })
  await expect(help).toBeVisible()
  await expect(help.getByRole('heading', { name: 'Yêu cầu báo giá chọn giá thế nào' })).toBeVisible()
  await expect(help).toContainText('ngày kết thúc vẫn được tính trọn')
  await evidence(page, info, 'help-desktop')
})

test('the vendor price list keeps the validity readable on a phone', async ({ page }, info) => {
  await page.setViewportSize(MOBILE)
  await signIn(page, 'admin', LIST)
  await settled(page)
  await expect(validity(page, 'swab-today')).toContainText('Đang hiệu lực')
  await expect(validity(page, 'swab-ended')).toContainText('Hết hạn')
  await fitsWidth(page)
  // The table scrolls sideways inside its card on a phone; the column is there to scroll to.
  await validity(page, 'swab-ended').scrollIntoViewIfNeeded()
  await expect(validity(page, 'swab-ended')).toBeInViewport()
  await fitsWidth(page)
  await evidence(page, info, 'list-mobile')
})
