import { test, expect } from '../product_backend/support.js'
import { countFixture } from './fixtures/count-adjustment.mjs'

// Dedicated isolated commerce fixture. Authentication is server-side fixture setup;
// the browser never types a password and all business actions use the real UI/HTTP boundary.
test('2014 adjustment → independent approval → settlement → 05-VT', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await countFixture(4316)
  try {
    // The load event does not wait for the KetJS bootstrap; the date picker and record
    // runtime are mounted once it publishes its navigation.
    const openAs = async (role: string, path?: string) => {
      await page.goto(`${fixture.url}/_fixture/role/${role}`)
      if (path) await page.goto(`${fixture.url}${path}`)
      await page.waitForFunction(
        () => (globalThis as { __ketNavigation?: unknown }).__ketNavigation !== undefined,
      )
    }
    const dialog = () => page.getByRole('dialog').last()
    const cell = async (gridName: string, index: number, label: string, value: string) => {
      const grid = page.getByRole('grid', { name: gridName, exact: true })
      await grid.getByRole('gridcell').nth(index).press('Enter')
      await grid.getByRole('textbox', { name: label, exact: true }).fill(value)
      await grid.getByRole('textbox', { name: label, exact: true }).press('Enter')
    }
    await openAs('keeper')
    await page.getByRole('link', { name: 'Điều chỉnh tồn kho', exact: true }).click()
    await dialog().getByRole('button', { name: 'Sản phẩm', exact: true }).click()
    await page.getByRole('option', { name: 'Goods · GOODS', exact: true }).click()
    await dialog().getByRole('button', { name: 'Vị trí', exact: true }).click()
    await page.getByRole('option', { name: 'Stock', exact: true }).click()
    await dialog().getByRole('button', { name: 'Mở phiên kiểm kê', exact: true }).click()
    await expect(page.getByRole('grid', { name: 'Dòng kiểm kê', exact: true })).toBeVisible()
    const path = new URL(page.url()).pathname + new URL(page.url()).search
    const record = new URL(page.url()).searchParams.get('record')!
    const id = record.slice('stock.countSession:'.length)
    const keeper = fixture.clients.get('keeper')!
    const onHand = async () =>
      (
        await keeper.call<{ quantity: string }[]>('stock.listQuants', {
          productId: fixture.productId,
          locationId: 'wh:stock',
        })
      ).value.reduce((sum, row) => sum + Number(row.quantity), 0)
    expect(await onHand()).toBe(10)
    await cell('Dòng kiểm kê', 1, 'Số đếm', '8')
    await expect(page.getByRole('gridcell', { name: '8', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await cell('Dòng kiểm kê', 2, 'Còn tốt', '6')
    await cell('Dòng kiểm kê', 3, 'Kém phẩm chất', '1')
    await cell('Dòng kiểm kê', 4, 'Mất phẩm chất', '1')
    await page
      .getByRole('grid', { name: 'Dòng kiểm kê', exact: true })
      .getByRole('gridcell')
      .nth(5)
      .press('Enter')
    await page.getByRole('option', { name: 'Hư hỏng', exact: true }).click()
    await page.getByRole('button', { name: 'Lưu số đếm', exact: true }).click()
    await expect(dialog().getByText('Thay đổi đã được ghi nhận.')).toBeVisible()
    await page.getByRole('button', { name: 'Thêm dòng', exact: true }).click()
    await page.getByRole('textbox', { name: 'Họ và tên', exact: true }).fill('Nguyễn An')
    await page.getByRole('textbox', { name: 'Họ và tên', exact: true }).press('Enter')
    await cell('Ban kiểm kê', 1, 'Chức vụ', 'Thủ kho')
    await cell('Ban kiểm kê', 2, 'Vai trò', 'Thành viên')
    await page.getByRole('textbox', { name: 'Ý kiến giải quyết', exact: true }).fill('Xác minh hàng hư hỏng')
    await page.getByRole('button', { name: 'Lưu thông tin biên bản', exact: true }).click()
    await expect(page.getByRole('gridcell', { name: 'Nguyễn An', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
    await dialog().getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
    await expect(dialog().getByText('Chờ duyệt', { exact: true })).toBeVisible()
    expect(await onHand()).toBe(10)
    await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toHaveCount(0)
    await openAs('manager', path)
    await page.getByRole('button', { name: 'Duyệt', exact: true }).click()
    await dialog().getByRole('button', { name: 'Duyệt', exact: true }).click()
    await expect(dialog().getByText('Đã điều chỉnh', { exact: true })).toBeVisible()
    expect(await onHand()).toBe(8)
    await openAs('accountant', path)
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
    // The date field types into its visible dd/mm/yyyy box; the native date input beside it
    // only carries the value the form posts.
    const settlementDate = page
      .getByRole('textbox', { name: 'Ngày xử lý', exact: true })
      .and(page.getByPlaceholder('dd/mm/yyyy'))
    await settlementDate.fill(date)
    await settlementDate.press('Tab')
    await page
      .getByRole('grid', { name: 'Xử lý chênh lệch', exact: true })
      .getByRole('gridcell')
      .last()
      .press('Enter')
    await page.getByRole('option', { name: '632 · Giá vốn', exact: true }).click()
    await page.getByRole('button', { name: 'Xử lý chênh lệch', exact: true }).click()
    await dialog().getByRole('button', { name: 'Xử lý chênh lệch', exact: true }).click()
    await expect(dialog().getByText('Đã xử lý', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'In 05-VT có giá trị', exact: true }).click()
    await expect(page.getByText('Nguyễn An', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '10.000 ₫', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: '-2.000 ₫', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Quay lại phiên kiểm kê', exact: true }).click()
    await expect(dialog()).toBeVisible()
    await openAs('keeper', `/admin/stock/count-session/${encodeURIComponent(id)}/print?lang=en`)
    await expect(page.getByRole('cell', { name: '10.000 ₫', exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await openAs('keeper', path.replace('lang=vi', 'lang=en'))
    await expect(page.getByRole('link', { name: 'Print 05-VT with values', exact: true })).toHaveCount(0)
  } finally {
    await fixture.close()
  }
})
