import {
  DESKTOP,
  expect,
  fitsWidth,
  listReady,
  MOBILE,
  pickFromMenu,
  productRow,
  recordReady,
  refusedAsEmpty,
  settled,
  signIn,
  test,
} from './support.js'

// P20/P23 beyond the happy paths in product-page.spec.ts and list.spec.ts: what a duplicate
// carries over, an archive an open quotation refuses (alone and in bulk), and who has the
// commands at all.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const T = '/admin/product/templates'
const SUNSCREEN = 'Kem chống nắng có báo giá'
// A storable product with nothing on hand says so at the top of its page.
const OUT_OF_STOCK = /^last screen alert: Hết hàng/u
const OPEN_DOCUMENTS =
  'Sản phẩm còn trên báo giá hoặc phiếu kho chưa hoàn tất. Hoàn tất hoặc bỏ sản phẩm khỏi chứng từ trước khi lưu trữ.'

test('a duplicate carries the shelf life and the own income account, and writes nothing until created', async ({
  page,
  ui,
}) => {
  ui.allow(OUT_OF_STOCK, 'the copy tracks lots and has none yet')
  await signIn(page, 'admin', `${T}/sunscreen-quote`)
  await recordReady(page, SUNSCREEN)
  await settled(page)
  await page.getByRole('link', { name: 'Nhân bản', exact: true }).click()
  await expect(page).toHaveURL(/\/templates\/new\?duplicate=sunscreen-quote\b/)
  await recordReady(page, 'Tạo sản phẩm')
  await expect(page.getByRole('textbox', { name: 'Tên sản phẩm' })).toHaveValue(`${SUNSCREEN} (bản sao)`)
  for (const name of ['Mã nội bộ', 'Barcode', 'Giá vốn'])
    await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Giá bán' })).toHaveValue('420.000')
  await expect(page.getByRole('combobox', { name: 'Truy xuất', exact: true })).toHaveValue('lot')
  await expect(page.getByRole('textbox', { name: 'Hạn dùng (tháng)' })).toHaveValue('24')
  await expect(page.getByRole('textbox', { name: 'Cảnh báo trước hạn (ngày)' })).toHaveValue('30')
  await expect(page.getByRole('button', { name: 'Tài khoản doanh thu' })).toHaveText(
    /5111 · Doanh thu bán hàng hoá/,
  )

  // Leaving the page leaves nothing behind.
  await page.getByRole('button', { name: 'Hủy' }).click()
  await listReady(page)
  await page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' }).fill('bản sao')
  await expect(page).toHaveURL(/[?&]q=/)
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(0)

  await page.goto(`${T}/new?duplicate=sunscreen-quote`)
  await recordReady(page, 'Tạo sản phẩm')
  await settled(page)
  await page.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Kem nhân bản theo lô')
  await page.getByRole('textbox', { name: 'Mã nội bộ' }).fill('KCN-02')
  await page.getByRole('button', { name: 'Tạo sản phẩm' }).click()
  await expect(page).not.toHaveURL(/\/templates\/(?:new|sunscreen-quote)\b/)
  await recordReady(page, 'Kem nhân bản theo lô')
  await page.reload()
  await recordReady(page, 'Kem nhân bản theo lô')
  await expect(page.getByRole('textbox', { name: 'Hạn dùng (tháng)' })).toHaveValue('24')
  await expect(page.getByRole('button', { name: 'Tài khoản doanh thu' })).toHaveText(
    /5111 · Doanh thu bán hàng hoá/,
  )
})

test('archiving needs a reason and is refused while an open quotation holds the product', async ({
  page,
  ui,
}) => {
  ui.allow(/^\d{3} POST /u, 'the archive is refused on purpose')
  ui.allow(OUT_OF_STOCK, 'the product tracks lots and has none yet')
  await signIn(page, 'admin', `${T}/sunscreen-quote`)
  await recordReady(page, SUNSCREEN)
  await settled(page)
  await page.getByRole('button', { name: 'Lưu trữ', exact: true }).click()
  const archive = page.getByRole('dialog', { name: 'Lưu trữ' })
  const reason = archive.getByRole('textbox', { name: 'Lý do lưu trữ' })
  await archive.getByRole('button', { name: 'Lưu trữ' }).click()
  await refusedAsEmpty(reason)

  await reason.fill('Ngừng nhập')
  await archive.getByRole('button', { name: 'Lưu trữ' }).click()
  await expect(archive.getByText(OPEN_DOCUMENTS)).toBeVisible()

  await page.goto(`${T}/sunscreen-quote`)
  await recordReady(page, SUNSCREEN)
  await expect(page.getByText('Đang bán', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Khôi phục', exact: true })).toHaveCount(0)
})

test('a bulk archive with one refused product archives none of them', async ({ page, ui }) => {
  ui.allow(/^\d{3} POST /u, 'the archive is refused on purpose')
  await signIn(page, 'admin')
  await listReady(page)
  await page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' }).fill('chống nắng')
  await expect(page).toHaveURL(/[?&]q=/)
  await listReady(page)
  await productRow(page, SUNSCREEN).getByRole('checkbox').check()
  await productRow(page, 'Gel chống nắng không báo giá').getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Lưu trữ' }).click()
  const confirm = page.getByRole('dialog')
  await confirm.getByRole('textbox', { name: 'Lý do lưu trữ' }).fill('Hết mùa nắng')
  await confirm.getByRole('button', { name: 'Lưu trữ' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Chưa lưu trữ sản phẩm nào. Cần lý do lưu trữ; sản phẩm có báo giá hoặc phiếu kho chưa hoàn tất phải xử lý trước.',
  )
  // The refusal keeps the search the selection was made in.
  await expect(page.getByRole('searchbox', { name: 'Tìm và lọc sản phẩm' })).toHaveValue('chống nắng')

  await page.goto(`${T}?q=${encodeURIComponent('chống nắng')}`)
  await listReady(page)
  await expect(productRow(page, SUNSCREEN)).toHaveCount(1)
  await expect(productRow(page, 'Gel chống nắng không báo giá')).toHaveCount(1)
  await pickFromMenu(page, /^Trạng thái:/, 'Bao gồm đã lưu trữ')
  await listReady(page)
  await expect(page.locator('[data-product-list="true"] tbody tr')).toHaveCount(2)
})

// The commands are for who may change the product's life, not for each role that edits a field.
for (const login of ['role-sales-representative', 'stockkeeper', 'bookkeeper'] as const)
  test(`${login} has no duplicate, archive or restore`, async ({ page }) => {
    for (const [path, name] of [
      [`${T}/toner-groups`, 'Toner chia nhóm trường'],
      [`${T}/old-mask`, 'Mặt nạ ngừng bán'],
    ] as const) {
      await page.goto('about:blank')
      await signIn(page, login, path)
      await recordReady(page, name)
      await settled(page)
      for (const command of ['Lưu trữ', 'Khôi phục'])
        await expect(page.getByRole('button', { name: command, exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Nhân bản', exact: true })).toHaveCount(0)
      await page.context().clearCookies()
    }
  })

test('the status history reads in English', async ({ page }) => {
  await signIn(page, 'admin', `${T}/old-mask?lang=en`, 'en')
  await recordReady(page, 'Mặt nạ ngừng bán')
  const history = page.getByRole('list', { name: 'Status history' })
  await expect(history).toContainText('Ngừng kinh doanh mặt hàng mẫu')
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
})

test.describe('on a phone, dark', () => {
  test.use({ viewport: MOBILE, colorScheme: 'dark' })

  test('the history fits and the archive dialog keeps its gutter', async ({ page }) => {
    await signIn(page, 'admin', `${T}/old-mask`)
    await recordReady(page, 'Mặt nạ ngừng bán')
    await settled(page)
    await expect(page.getByRole('list', { name: 'Lịch sử trạng thái' })).toBeVisible()
    await fitsWidth(page)

    await page.goto(`${T}/toner-groups`)
    await recordReady(page, 'Toner chia nhóm trường')
    await settled(page)
    await page.getByRole('button', { name: 'Lưu trữ', exact: true }).click()
    const archive = page.getByRole('dialog', { name: 'Lưu trữ' })
    await expect(archive.getByRole('textbox', { name: 'Lý do lưu trữ' })).toBeVisible()
    // A confirmation stays a centred card with a 16px gutter on a phone (DS ConfirmDialog).
    const box = await archive.boundingBox()
    expect(box?.x).toBeCloseTo(16, 0)
    expect(box?.width).toBeCloseTo(MOBILE.width - 32, 0)
    await page.keyboard.press('Escape')
    await expect(archive).toBeHidden()
  })
})
