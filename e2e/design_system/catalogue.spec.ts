import { expect, test } from '@playwright/test'

test('renders every component group and persists catalogue preferences', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?theme=dark&density=default')

  // The index links one page per component group and counts the specimens they hold.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const groups = [
    ...new Set(
      await page
        .locator('a[href^="/components/"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')!.split('?')[0])),
    ),
  ]
  expect(groups).toHaveLength(13)
  const announced = Number(
    /(\d+)\s*executable specimens/.exec(
      (await page.locator('[data-ui="catalogue-metrics"]').textContent()) ?? '',
    )?.[1],
  )
  expect(announced).toBeGreaterThan(0)
  await expect(page.getByRole('link', { name: 'Dark', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Default', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )

  const theme = await page.locator('[data-ui="catalogue"]').evaluate((element) => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    titleFont: getComputedStyle(element.querySelector('[data-ui="catalogue-title"]') as HTMLElement)
      .fontFamily,
  }))
  expect(theme.color).not.toBe('rgb(23, 25, 22)')
  expect(theme.titleFont).toContain('Inter')

  let specimens = 0
  for (const group of groups) {
    await page.goto(`${group}?theme=dark&density=default`)
    const count = await page.locator('[data-ui="catalogue-specimen"]').count()
    expect(count, group).toBeGreaterThan(0)
    specimens += count
    // The preferences carry from page to page.
    await expect(page.getByRole('link', { name: 'Dark', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
  expect(specimens).toBe(announced)

  await page.goto('/components/patterns?theme=dark&density=default')
  await expect(page.locator('#data-table [data-ui="row"]')).toHaveCount(3)
  await expect(page.locator('#record-form [data-ui="field"]')).toHaveCount(3)
  await expect(page.locator('#modal-sheet [role="dialog"]')).toBeVisible()
  await expect(page.locator('[data-ui="metric"]').first()).toHaveCSS('border-radius', '7px')
  await expect(page.locator('[data-ui="action"]').first()).toHaveCSS('min-height', '32px')
  await expect(page.locator('#data-table [data-ui="col"]').first()).toHaveCSS('height', '42px')
  await expect(page.locator('#data-table [data-ui="row"]').first()).toHaveCSS('height', '40px')
  await page.goto('/components/application-structure?theme=dark&density=default')
  await expect(page.locator('#app-shell [data-ui="app-right-rail"]')).toHaveCSS('border-radius', '0px')
  await expect(page.locator('#app-shell [data-ui="app-sidebar"]')).toHaveCSS('border-radius', '0px')

  await page.goto('/?theme=dark&density=default')
  await page.getByRole('link', { name: 'Light', exact: true }).click()
  await expect(page).toHaveURL(/theme=light&density=default/)
  await expect(page.locator('[data-ui="catalogue"]')).toHaveAttribute('data-theme', 'light')

  await page.screenshot({ path: testInfo.outputPath('catalogue-desktop-light.png'), fullPage: true })
})

test('keeps the catalogue and component stages inside a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/components/patterns?theme=dark&density=comfortable')
  await expect(page.locator('#data-table')).toHaveCount(1)

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    railHeight: document.querySelector<HTMLElement>('[data-ui="catalogue-rail"]')?.getBoundingClientRect()
      .height,
    firstActionHeight: document.querySelector<HTMLElement>('[data-ui="action"]')?.getBoundingClientRect()
      .height,
  }))
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
  expect(dimensions.railHeight).toBeLessThan(80)
  expect(dimensions.firstActionHeight).toBeGreaterThanOrEqual(36)

  await page.locator('#data-table').scrollIntoViewIfNeeded()
  await expect(page.locator('#data-table [data-ui="table-scroll"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('catalogue-mobile-dark.png'), fullPage: true })
})
