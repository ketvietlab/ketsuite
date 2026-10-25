import { expect, test } from '@playwright/test'

// The grouped presentation follows the theme: canvas, panels and hairlines per theme.
const palette = {
  light: {
    canvas: 'rgb(246, 246, 247)',
    panel: 'rgb(255, 255, 255)',
    line: 'rgb(226, 228, 232)',
    active: 'rgb(238, 240, 251)',
  },
  dark: {
    canvas: 'rgb(27, 31, 36)',
    panel: 'rgb(29, 34, 40)',
    line: 'rgba(255, 255, 255, 0.055)',
    active: 'rgba(89, 104, 223, 0.14)',
  },
} as const

for (const theme of ['light', 'dark'])
  for (const width of [1440, 390])
    for (const view of ['overview', 'orders', 'record', 'board']) {
      test(`sales demo / ${view} / ${theme} / ${width}`, async ({ page }, testInfo) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(`/demo?view=${view}&theme=${theme}`)
        await page.evaluate(() => document.fonts.ready)
        const colors = palette[theme as keyof typeof palette]
        // --kv-layout-gap insets the page and separates its cards: 12px, and 8px below 768px.
        const gap = width === 390 ? '8px' : '12px'
        const panelInset = width === 390 ? 12 : 16
        await expect(page.locator('main')).toHaveCount(1)
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('[data-ui="app-main"]')).toHaveCSS('background-color', colors.canvas)
        await expect(page.locator('[data-ui="app-main"]')).toHaveCSS('color-scheme', theme)
        await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS(
          'background-color',
          theme === 'light' ? 'rgb(247, 245, 245)' : 'rgb(23, 27, 32)',
        )
        await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS('border-radius', '0px')
        await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS('box-shadow', 'none')
        if (theme === 'light') {
          await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS(
            width === 390 ? 'border-bottom-color' : 'border-right-color',
            'rgb(233, 231, 232)',
          )
        }
        await expect(
          page.locator('[data-ui="app-sidebar"] [data-ui="navigation-item"][data-active="true"]'),
        ).toHaveCSS('background-color', colors.active)
        for (const header of await page.locator('main [data-ui$="-header"]').all())
          await expect(header).toHaveCSS('border-bottom-color', colors.line)
        for (const block of await page
          .locator(
            'main :is([data-ui="surface"], [data-ui="metric"], [data-ui="content-card"]):not([data-ui="record-page-aside"] *)',
          )
          .all()) {
          await expect(block).toHaveCSS('border-top-width', '1px')
          await expect(block).toHaveCSS('border-radius', '7px')
          await expect(block).toHaveCSS('box-shadow', 'none')
          await expect(block).toHaveCSS('background-color', colors.panel)
          // A titled table runs edge to edge; other panels keep their inset.
          const flush = (await block.locator('[data-ui="table-scroll"][data-framed="false"]').count()) > 0
          await expect(block).toHaveCSS('padding', flush ? '0px' : `${panelInset}px`)
          await expect(block).toHaveCSS('border-top-color', colors.line)
        }
        for (const region of await page
          .locator('main :is([data-ui$="-context"], [data-ui$="-header"])')
          .all())
          await expect(region).toHaveCSS('background-color', colors.canvas)
        for (const aside of await page.locator('main [data-ui="record-page-aside"]').all())
          await expect(aside).toHaveCSS('background-color', colors.panel)
        const framed =
          '[data-ui="surface"], [data-ui="metric"], [data-ui="content-card"], [data-ui="table-scroll"]:not([data-framed="false"])'
        expect(
          await page
            .locator(framed)
            .evaluateAll(
              (elements, selector) => elements.filter((element) => element.querySelector(selector)).length,
              framed,
            ),
        ).toBe(0)
        for (const surface of await page.locator('[data-ui="surface"][data-has-heading="true"]').all()) {
          await expect(surface).toHaveCSS('background-color', colors.panel)
          await expect(surface.locator('[data-ui="surface-title"]')).toHaveCSS('font-size', '14px')
          const geometry = await surface.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            const head = element.querySelector('[data-ui="surface-head"]')!
            const heading = head.getBoundingClientRect()
            const title = head.querySelector('[data-ui="surface-title"]')!.getBoundingClientRect()
            const content = head.nextElementSibling!.getBoundingClientRect()
            return {
              flush: getComputedStyle(element).paddingTop === '0px',
              inset: heading.left - bounds.left,
              top: heading.top - bounds.top,
              gap: content.top - heading.bottom,
              titleInset: title.left - bounds.left,
            }
          })
          // The title sits one inset (plus the 1px frame) in, whether the panel or its head owns the inset.
          expect(geometry.titleInset).toBe(panelInset + 1)
          if (geometry.flush) {
            expect(geometry.inset).toBe(1)
            expect(geometry.top).toBe(1)
            expect(geometry.gap).toBe(0)
            await expect(surface.locator('[data-ui="surface-head"]')).toHaveCSS('padding', `${panelInset}px`)
          } else {
            expect(geometry.inset).toBe(panelInset + 1)
            expect(geometry.top).toBe(panelInset + 1)
            expect(geometry.gap).toBe(8)
            await expect(surface.locator('[data-ui="surface-head"]')).toHaveCSS('padding', '0px')
          }
        }
        for (const table of await page.locator('[data-ui="table-scroll"][data-framed="false"]').all()) {
          await expect(table).toHaveCSS('border-top-width', '0px')
          await expect(table).toHaveCSS('border-radius', '0px')
          await expect(table).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
          await expect(table).toHaveCSS('margin-left', '0px')
          await expect(table).toHaveCSS('margin-right', '0px')
          const insets = await table.evaluate((element) => {
            const tableBounds = element.getBoundingClientRect()
            const parent = element.parentElement!
            const bounds = parent.getBoundingClientRect()
            const style = getComputedStyle(parent)
            return [
              tableBounds.left - bounds.left - parseFloat(style.borderLeftWidth),
              bounds.right - tableBounds.right - parseFloat(style.borderRightWidth),
            ]
          })
          expect(insets).toEqual([0, 0])
        }
        for (const heading of await page.locator('[data-ui="section-head"]').all())
          await expect(heading).toHaveCSS('border-bottom-width', '0px')
        for (const body of await page
          .locator(
            'main :is([data-ui="dashboard-page-body"], [data-ui="board-page-body"], [data-ui="record-page-body"])',
          )
          .all()) {
          // A board's columns start 16px below its header at every width.
          await expect(body).toHaveCSS('padding-top', view === 'board' ? '16px' : gap)
          if (view === 'board') {
            await expect(body).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
            await expect(page.locator('[data-ui="board-page"]')).toHaveCSS('background-color', colors.canvas)
          } else await expect(body).toHaveCSS('background-color', colors.canvas)
          await expect(body).toHaveCSS('padding-left', gap)
          await expect(body).toHaveCSS('padding-right', gap)
          for (const stack of await body.locator(':scope > [data-ui="stack"]').all())
            await expect(stack).toHaveCSS('row-gap', gap)
        }
        for (const grid of await page.locator('main [data-ui="grid"], .demo-overview-grid').all())
          await expect(grid).toHaveCSS('gap', gap)
        await expect(page.locator('[data-ui="table"] button')).toHaveCount(0)
        if (view === 'orders') {
          const pager = page.locator('[data-ui="list-chrome"] [data-ui="pager-bar"]')
          await expect(pager).toHaveCount(1)
          await expect(pager).toContainText('1–8 / 12 đơn hàng')
          await expect(page.locator('[data-ui="list-page-footer"], [data-ui="pager-pages"]')).toHaveCount(0)
          await expect(page.locator('[data-ui="bulk-actions"]')).toBeHidden()
          const pagerBox = await pager.boundingBox()
          const bodyBox = await page.locator('[data-ui="list-page-body"]').boundingBox()
          const searchBox = await page.locator('[data-ui="list-search"]').boundingBox()
          expect(pagerBox!.y + pagerBox!.height).toBeLessThanOrEqual(bodyBox!.y)
          const facets = page.locator('[data-row="query"] [data-ui="list-facets"]')
          const filtersBox = await facets.boundingBox()
          if (width === 1440) {
            expect(searchBox!.width).toBeLessThanOrEqual(512)
            expect(filtersBox!.x + filtersBox!.width).toBeLessThanOrEqual(pagerBox!.x)
            expect(searchBox!.x).toBeLessThan(filtersBox!.x)
            expect(Math.abs(searchBox!.y - filtersBox!.y)).toBeLessThanOrEqual(4)
            expect(Math.abs(filtersBox!.y - pagerBox!.y)).toBeLessThanOrEqual(4)
            expect(pagerBox!.x - (searchBox!.x + searchBox!.width)).toBeGreaterThan(8)
          } else {
            // On a phone the search, the filters and the pager each take their own row, in that order.
            expect(filtersBox!.y).toBeGreaterThanOrEqual(searchBox!.y + searchBox!.height - 1)
            expect(pagerBox!.y).toBeGreaterThanOrEqual(filtersBox!.y + filtersBox!.height - 1)
            const firstFacet = await page.locator('[data-ui="list-facet"]').nth(0).boundingBox()
            const secondFacet = await page.locator('[data-ui="list-facet"]').nth(1).boundingBox()
            expect(Math.abs(firstFacet!.y - secondFacet!.y)).toBeLessThanOrEqual(4)
          }
          const summaryBox = await pager.locator('[data-ui="pager-summary"]').boundingBox()
          const actionsBox = await pager.locator('[data-ui="pager-actions"]').boundingBox()
          expect(actionsBox!.x - (summaryBox!.x + summaryBox!.width)).toBe(8)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        if (view === 'record') {
          const metric = page.locator('[data-ui="record-page-aside"] [data-ui="metric"]')
          await expect(metric).toHaveCSS('border-top-width', '0px')
          await expect(metric).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
          // A label sits beside its control from 48rem in a column wider than 28rem, above it
          // otherwise; a lone checkbox leads with its box.
          const invalid = await page
            .locator('[data-ui="field"]:not([data-kind="checkbox"])')
            .evaluateAll((fields) =>
              fields.flatMap((field) => {
                const label = field.querySelector('[data-ui="field-label"]')?.getBoundingClientRect()
                const control = field
                  .querySelector('[data-ui="field-control"], [data-ui="field-options"]')
                  ?.getBoundingClientRect()
                if (!label || !control) return []
                const column = field.parentElement!
                const style = getComputedStyle(column)
                const inline =
                  column.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
                const beside = innerWidth >= 768 && inline > 28 * 16
                return (beside ? label.right > control.left - 7 : label.bottom > control.top + 1)
                  ? [field.textContent]
                  : []
              }),
            )
          expect(invalid).toEqual([])
        }
        await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true })
        if (view === 'overview') {
          await page.getByRole('link', { name: 'Tạo đơn hàng', exact: true }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await expect(page.getByRole('dialog')).toHaveCSS('background-color', colors.panel)
          await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '0px')
          // Focus moves into the sheet, to its first focusable control.
          expect(
            await page.getByRole('dialog').evaluate((dialog) => dialog.contains(document.activeElement)),
          ).toBe(true)
          expect(
            await page.locator('[data-ui="app-shell"]').evaluate((element) => (element as HTMLElement).inert),
          ).toBe(true)
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
          await page.screenshot({ path: testInfo.outputPath('create-sheet.png') })
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
        expect(errors).toEqual([])
      })
    }

test('sales demo: ListChrome paging preserves the query and has no footer', async ({ page }) => {
  await page.goto('/demo?view=orders&theme=dark&q=SO&sort=asc')
  const chrome = page.locator('[data-ui="list-chrome"]')
  // An unavailable page link stays in place, disabled, so the pager does not shift.
  await expect(chrome.getByRole('link', { name: 'Trang trước', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await chrome.getByRole('link', { name: 'Trang sau', exact: true }).click()
  await expect(chrome).toContainText('9–12 / 12 đơn hàng')
  await expect(page.locator('[data-ui="row"]')).toHaveCount(4)
  const url = new URL(page.url())
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    q: 'SO',
    sort: 'asc',
    theme: 'dark',
    page: '2',
  })
  await expect(chrome.getByRole('link', { name: 'Trang sau', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await chrome.getByRole('link', { name: 'Trang trước', exact: true }).click()
  await expect(chrome).toContainText('1–8 / 12 đơn hàng')
  await page.getByRole('searchbox').fill('no-such-customer')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(chrome).toContainText('0–0 / 0 đơn hàng')
  await expect(chrome.locator('[data-ui="pager-link"][data-disabled="true"]')).toHaveCount(2)
  await expect(page.locator('[data-ui="list-page-footer"]')).toHaveCount(0)
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({
    q: 'no-such-customer',
    sort: 'asc',
    theme: 'dark',
  })
})

test('sales demo: search, pagination, bulk state, edit, history and export', async ({ page }) => {
  await page.goto('/demo?view=orders')
  await page.getByRole('searchbox').fill('Mùa Hạ')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(page.locator('[data-ui="row"]')).toHaveCount(1)
  await page.getByLabel('Chọn tất cả', { exact: true }).check()
  await expect(page.getByText('1 đơn được chọn')).toBeVisible()
  await page.getByRole('button', { name: 'Chuyển bước tiếp theo' }).click()
  await expect(page.getByText('Đã lưu thay đổi')).toBeVisible()
  await expect(page.locator('[data-ui="row"]')).toContainText('Đang chuẩn bị')
  const customerCell = await page.locator('[data-ui="row"] [data-col="customer"]').boundingBox()
  expect(customerCell).not.toBeNull()
  await page.mouse.click(
    customerCell!.x + customerCell!.width / 2,
    customerCell!.y + customerCell!.height / 2,
  )
  await expect(page.locator('h1')).toHaveText('SO-1042')
  await page.getByRole('textbox', { name: 'Ghi chú', exact: true }).fill('Giao tại cửa phía Đông.')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByRole('textbox', { name: 'Ghi chú', exact: true })).toHaveValue(
    'Giao tại cửa phía Đông.',
  )
  await page.getByRole('link', { name: 'Hoạt động', exact: false }).click()
  await page.getByLabel('Nội dung', { exact: false }).fill('Đã xác nhận lịch giao với khách.')
  await page.getByRole('button', { name: 'Thêm ghi nhận' }).click()
  await expect(page.locator('[data-ui="record-page-body"]')).toContainText('Đã xác nhận lịch giao với khách.')
  await page.getByRole('link', { name: 'Chứng từ', exact: false }).click()
  await expect(page.getByText('Chưa có chứng từ')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Xuất bảng kê' }).click()
  expect((await download).suggestedFilename()).toBe('orders.csv')
  await page.goto('/demo?view=orders&page=2')
  await expect(page.locator('[data-ui="row"]')).toHaveCount(4)
  await page.getByRole('searchbox').fill('no-such-customer')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(page.getByText('Không tìm thấy đơn hàng')).toBeVisible()
  await page.getByRole('link', { name: 'Xóa bộ lọc' }).click()
  await expect(page.locator('[data-ui="row"]')).toHaveCount(8)
})

test('sales demo: create, validation, confirmation and keyboard modal', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const rejected = await request.post('/demo/action', {
    form: {
      intent: 'create',
      return: '/demo',
      customer: '',
      address: '',
      product: 'CF-01',
      quantity: '0',
      date: '',
    },
  })
  expect(rejected.status()).toBe(422)
  expect(await rejected.text()).toContain('Vui lòng nhập khách hàng.')
  await page.goto('/demo?modal=create')
  // The customer is picked from the directory.
  const customer = page.getByRole('group', { name: 'Khách hàng' })
  await customer.getByRole('button', { name: 'Khách hàng' }).click()
  await page.getByRole('option', { name: 'Mùa Hạ Riverside', exact: true }).click()
  await page.getByLabel('Địa chỉ giao', { exact: false }).fill('12 Thảo Điền')
  await page.getByLabel('Email', { exact: true }).fill('demo@example.com')
  await page.getByRole('button', { name: 'Tạo đơn hàng', exact: true }).click()
  await expect(page).toHaveURL(/view=record/)
  await expect(page.getByRole('group', { name: 'Khách hàng' }).locator('select')).toHaveValue(
    'mua-ha-riverside',
  )
  await page.getByRole('link', { name: 'Chuyển trạng thái' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Đang chuẩn bị')
  await dialog.getByRole('button', { name: 'Xác nhận' }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('link', { name: 'Đóng', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page.locator('[data-ui="record-page-status"]')).toContainText('Đang chuẩn bị')
  await page.reload()
  await expect(page.getByRole('group', { name: 'Khách hàng' }).locator('select')).toHaveValue(
    'mua-ha-riverside',
  )
})
