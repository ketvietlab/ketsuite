import type { Page } from '@playwright/test'
import { DESKTOP, expect, fixtureFile, recordReady, signIn, test } from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const gallery = (page: Page) => page.getByRole('group', { name: 'Hình ảnh' }).getByRole('figure')

/** On the product page: "Thêm ảnh" opens a small dialog where the file is picked, then uploaded. */
const addImage = async (page: Page, file: string) => {
  await page.getByRole('button', { name: 'Thêm ảnh' }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm ảnh' })
  await dialog.getByLabel('Tệp ảnh').setInputFiles(fixtureFile(file))
  // The picked file shows before it is sent.
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByRole('button', { name: 'Tải ảnh lên' }).click()
  await expect(dialog).toBeHidden()
}

test('adds the first image from a file and it becomes the cover', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/soap-upload')
  await recordReady(page, 'Xà phòng cần ảnh')
  await expect(page.getByText('Chưa có ảnh', { exact: true })).toBeVisible()
  await addImage(page, 'serum-front.png')
  await expect(gallery(page)).toHaveCount(1)
  await expect(gallery(page).first()).toContainText('Ảnh bìa')
  // The image is served back, not only previewed from the picked file.
  await expect
    .poll(() =>
      gallery(page)
        .first()
        .getByRole('img')
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)

  await page.reload()
  await recordReady(page, 'Xà phòng cần ảnh')
  await expect(gallery(page)).toHaveCount(1)
})

test('removing an image leaves the others, and the first stays the cover', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/balm-remove')
  await recordReady(page, 'Son dưỡng bỏ ảnh')
  await expect(gallery(page)).toHaveCount(2)
  await expect(gallery(page).first().getByRole('img')).toHaveAccessibleName('Ảnh giữ lại')
  await gallery(page)
    .filter({ has: page.getByRole('img', { name: 'Ảnh cần gỡ' }) })
    .getByRole('button', { name: 'Gỡ ảnh' })
    .click()
  const confirm = page.getByRole('dialog', { name: 'Gỡ ảnh' })
  await confirm.getByRole('button', { name: 'Gỡ ảnh' }).click()
  await expect(confirm).toBeHidden()
  await expect(gallery(page)).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'Ảnh cần gỡ' })).toHaveCount(0)

  await page.reload()
  await recordReady(page, 'Son dưỡng bỏ ảnh')
  await expect(gallery(page)).toHaveCount(1)
  await expect(gallery(page).first()).toContainText('Ảnh bìa')
})

test('the images tab makes another image the cover', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/balm-media?tab=media')
  const cards = page.getByRole('article').filter({ has: page.getByRole('img') })
  await expect(cards).toHaveCount(2)
  await expect(cards.first().getByRole('img')).toHaveAccessibleName('Son dưỡng mặt trước')
  await expect(cards.first()).toContainText('Ảnh chính')
  await cards.nth(1).getByRole('button', { name: 'Đặt làm ảnh chính' }).click()
  const side = cards.filter({ has: page.getByRole('img', { name: 'Son dưỡng mặt bên' }) })
  const front = cards.filter({ has: page.getByRole('img', { name: 'Son dưỡng mặt trước' }) })
  await expect(side).toContainText('Ảnh chính')
  await expect(front).not.toContainText('Ảnh chính')

  // The product page shows the same cover.
  await page.goto('/admin/product/templates/balm-media')
  await recordReady(page, 'Son dưỡng có ảnh')
  await expect(
    gallery(page).filter({ has: page.getByRole('img', { name: 'Son dưỡng mặt bên' }) }),
  ).toContainText('Ảnh bìa')
})

test('a variant takes its own image on its page', async ({ page }) => {
  await signIn(
    page,
    'admin',
    '/admin/product/templates/gel-variants/variants/gel-variants:capacity-30ml?tab=media',
  )
  await recordReady(page, '30ml')
  await expect(page.getByRole('link', { name: /^Hình ảnh 0/ })).toBeVisible()
  // Here the file field is the control: choosing a file sends it.
  await page.locator('[data-ui="media-file-input"]').setInputFiles(fixtureFile('serum-box.png'))
  await expect(page.getByRole('link', { name: /^Hình ảnh 1/ })).toBeVisible()
  await expect(page.getByText('Chưa có hình ảnh.')).toHaveCount(0)
})
