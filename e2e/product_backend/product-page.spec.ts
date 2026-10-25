import {
  DESKTOP,
  evidence,
  expect,
  fitsWidth,
  MOBILE,
  recordReady,
  refusedAsEmpty,
  settled,
  signIn,
  test,
} from './support.js'

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const rail = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Tóm tắt' })

test('reads one product: the figures, the rail and every section of the page', async ({ page }, info) => {
  await signIn(page, 'admin', '/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  for (const name of ['Về danh sách', 'Nhân bản', 'Lưu trữ', 'Lưu thay đổi'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()

  // A complete product has nothing to fix, so the rail starts at its completeness.
  await expect(rail(page).getByRole('heading', { name: 'Cần xử lý' })).toHaveCount(0)
  await expect(rail(page).getByRole('progressbar', { name: 'Đủ thông tin để bán' })).toBeVisible()
  await expect(rail(page).getByRole('definition').first()).toHaveText('SR-B5-30')

  // The figures: stock on hand, margin from the saved cost.
  await expect(page.getByRole('article').filter({ hasText: 'Tồn kho' })).toContainText('40 Cái')
  await expect(page.getByRole('article').filter({ hasText: 'Biên lợi nhuận' })).toContainText('57,1%')
  await expect(page.getByRole('article').filter({ hasText: 'Biên lợi nhuận' })).toContainText(
    'Lãi 200.000 ₫ mỗi Cái',
  )

  for (const section of [
    'Thông tin chung',
    'Hình ảnh',
    'Giá & lợi nhuận',
    'Kho & vận chuyển',
    'Tồn theo kho',
    'Biến thể',
    'Nhà cung cấp',
    'Hoạt động',
  ])
    await expect(page.getByRole('heading', { level: 2, name: section, exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Tên sản phẩm' })).toHaveValue('Serum B5 phục hồi 30ml')
  await expect(page.getByRole('textbox', { name: 'Barcode' })).toHaveValue('8938501230012')
  await expect(page.getByRole('textbox', { name: 'Giá bán' })).toHaveValue('350.000')
  await expect(page.getByRole('textbox', { name: 'Giá vốn' })).toHaveValue('150.000')

  // The cover is the first image; stock is per warehouse, and stock on hand locks the unit.
  const images = page.getByRole('group', { name: 'Hình ảnh' }).getByRole('figure')
  await expect(images).toHaveCount(2)
  await expect(images.first().getByRole('img')).toHaveAccessibleName('Chai serum')
  await expect(images.first()).toContainText('Ảnh bìa')
  const stock = page
    .getByRole('table', { name: 'Tồn theo kho' })
    .getByRole('row', { name: /Kho Hồ Chí Minh/ })
  await expect(stock.getByRole('cell').nth(1)).toHaveText('40')
  await expect(page.getByRole('combobox', { name: 'Đơn vị tính' })).toBeDisabled()
  await evidence(page, info, 'serum')
})

test('what a product still lacks is listed, and each item leads to its field', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/cream')
  await recordReady(page, 'Kem dưỡng ẩm ban đêm')
  await expect(rail(page).getByRole('heading', { name: 'Cần xử lý' })).toBeVisible()
  await expect(rail(page)).toContainText('2 biến thể đang bán chưa có barcode')
  await expect(rail(page).getByRole('progressbar', { name: 'Đã có 1/7 thông tin' })).toBeVisible()
  const description = rail(page).getByRole('link', { name: 'Mô tả bán hàng' })
  await expect(description).toHaveAttribute('href', '#product-record-description')
  await description.click()
  await expect(page.getByRole('textbox', { name: 'Mô tả bán hàng' })).toBeInViewport()

  // With variants, codes and costs live on each variant.
  const variants = page.getByRole('table', { name: 'Biến thể' })
  await expect(variants.getByRole('link', { name: '30ml' })).toBeVisible()
  await expect(variants.getByRole('link', { name: '50ml' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Mã nội bộ' })).toHaveCount(0)
})

test('edits a product and the change holds after a reload', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/toner-edit')
  await recordReady(page, 'Toner cân bằng (sửa)')
  await page.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Toner cân bằng da')
  await page.getByRole('textbox', { name: 'Giá bán' }).fill('235000')
  await page.getByRole('textbox', { name: 'Mô tả bán hàng' }).fill('Cân bằng độ ẩm sau rửa mặt.')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await recordReady(page, 'Toner cân bằng da')

  await page.reload()
  await recordReady(page, 'Toner cân bằng da')
  await expect(page.getByRole('textbox', { name: 'Giá bán' })).toHaveValue('235.000')
  await expect(page.getByRole('textbox', { name: 'Mô tả bán hàng' })).toHaveValue(
    'Cân bằng độ ẩm sau rửa mặt.',
  )
})

test('a product without a name is not saved', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/toner-edit')
  const name = page.getByRole('textbox', { name: 'Tên sản phẩm' })
  await expect(name).not.toHaveValue('')
  const before = await name.inputValue()
  await name.fill('')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await refusedAsEmpty(name)

  await page.reload()
  await recordReady(page, before)
})

test('archives a product and restores it', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/toner-archive')
  await recordReady(page, 'Toner cân bằng (lưu trữ)')
  // Both ways ask first, in a small dialog that says what changes.
  await page.getByRole('button', { name: 'Lưu trữ', exact: true }).click()
  const archive = page.getByRole('dialog', { name: 'Lưu trữ' })
  await expect(archive).toContainText('có thể khôi phục bất cứ lúc nào')
  await archive.getByRole('button', { name: 'Lưu trữ' }).click()
  await expect(archive).toBeHidden()
  const restoreButton = page.getByRole('button', { name: 'Khôi phục', exact: true })
  await expect(restoreButton).toBeVisible()
  await expect(page.getByText('Đang bán', { exact: true })).toHaveCount(0)

  await page.reload()
  await recordReady(page, 'Toner cân bằng (lưu trữ)')
  await restoreButton.click()
  const restore = page.getByRole('dialog', { name: 'Khôi phục' })
  await restore.getByRole('button', { name: 'Khôi phục' }).click()
  await expect(restore).toBeHidden()
  await expect(page.getByRole('button', { name: 'Lưu trữ', exact: true })).toBeVisible()
  await expect(page.getByText('Đang bán', { exact: true })).toBeVisible()
})

test('duplicates a product into a new one without its code', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/toner-copy')
  await recordReady(page, 'Toner để nhân bản')
  await page.getByRole('button', { name: 'Nhân bản' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nhân bản' })
  const copyName = dialog.getByRole('textbox', { name: 'Tên sản phẩm mới' })
  await expect(copyName).toHaveValue('Toner để nhân bản (bản sao)')
  await copyName.fill('Toner nhân bản cho quầy 2')
  await dialog.getByRole('button', { name: 'Nhân bản' }).click()
  await expect(page).not.toHaveURL(/\/templates\/toner-copy\b/)
  await recordReady(page, 'Toner nhân bản cho quầy 2')
  await expect(page.getByRole('textbox', { name: 'Mã nội bộ' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Giá bán' })).toHaveValue('220.000')
})

test('creates a product from the new page', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/new')
  await recordReady(page, 'Tạo sản phẩm')
  // Nothing chosen yet, the unit is the first one offered, not the last.
  await expect(page.getByRole('combobox', { name: 'Đơn vị tính' })).toHaveValue('unit')
  await page.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Sữa rửa mặt dịu nhẹ')
  await page.getByRole('textbox', { name: 'Mã nội bộ' }).fill('SRM-001')
  await page.getByRole('textbox', { name: 'Giá bán' }).fill('185000')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(page).not.toHaveURL(/\/templates\/new\b/)
  await recordReady(page, 'Sữa rửa mặt dịu nhẹ')

  await page.reload()
  await recordReady(page, 'Sữa rửa mặt dịu nhẹ')
  await expect(page.getByRole('textbox', { name: 'Mã nội bộ' })).toHaveValue('SRM-001')
  await expect(page.getByRole('textbox', { name: 'Giá bán' })).toHaveValue('185.000')
  await expect(page.getByRole('combobox', { name: 'Đơn vị tính' })).toHaveValue('unit')
})

test('a new product without a name is not created', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/new')
  await recordReady(page, 'Tạo sản phẩm')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await refusedAsEmpty(page.getByRole('textbox', { name: 'Tên sản phẩm' }))
  await expect(page).toHaveURL(/\/templates\/new\b/)
})

test('the screen guide opens from the rail and Escape closes it', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/serum')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  await settled(page)
  const trigger = page.getByRole('button', { name: 'Hướng dẫn màn hình' })
  await trigger.click()
  const guide = page.getByRole('heading', { name: 'Trang sản phẩm' })
  await expect(guide).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nhân bản và lưu trữ' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('reads in English', async ({ page }) => {
  await signIn(page, 'admin', '/admin/product/templates/serum?lang=en', 'en')
  await recordReady(page, 'Serum B5 phục hồi 30ml')
  for (const name of ['Back to list', 'Save changes'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: 'General information', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Product name' })).toHaveValue('Serum B5 phục hồi 30ml')
})

test.describe('on a phone', () => {
  test.use({ viewport: MOBILE })

  test('the page fits the screen and keeps its commands', async ({ page }, info) => {
    await signIn(page, 'admin', '/admin/product/templates/serum')
    await recordReady(page, 'Serum B5 phục hồi 30ml')
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Tên sản phẩm' })).toBeVisible()
    await fitsWidth(page)
    await evidence(page, info, 'serum-phone')
  })
})
