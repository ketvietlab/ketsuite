import { expect, test } from '@playwright/test'

// The catalogue shows one component group per page.
const groups = [
  'actions',
  'status',
  'feedback',
  'fields',
  'field-states',
  'layouts',
  'application-structure',
  'navigation',
  'patterns',
  'interactions',
  'form-controls',
  'data-operations',
  'record-workspace',
] as const
const screenshots: Record<string, (typeof groups)[number]> = {
  button: 'actions',
  'advanced-fields': 'field-states',
  'form-page': 'patterns',
  'workspace-canvas': 'application-structure',
  'list-chrome': 'patterns',
}

for (const theme of ['light', 'dark']) {
  test(`primary action contrast / ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/components/actions?theme=${theme}`)
    const action = page.locator('#button [data-variant="primary"]')
    const contrast = () =>
      action.evaluate((element) => {
        const style = getComputedStyle(element)
        const luminance = (color: string) =>
          color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((value) => value / 255)
            .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
            .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
        const text = luminance(style.color)
        const background = luminance(style.backgroundColor)
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05)
      })
    expect(await contrast()).toBeGreaterThanOrEqual(4.5)
    await action.hover()
    await expect.poll(contrast).toBeGreaterThanOrEqual(4.5)
    await expect(action).toHaveCSS('color', 'rgb(255, 255, 255)')
  })
}

for (const theme of ['light', 'dark'])
  for (const width of [390, 768, 1024, 1440]) {
    test(`component geometry / ${theme} / ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      for (const density of ['compact', 'default', 'comfortable'])
        for (const group of groups) {
          await page.goto(`/components/${group}?theme=${theme}&density=${density}`)
          await page.evaluate(() => document.fonts.ready)
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
          const duplicates = await page.locator('[id]').evaluateAll((nodes) => {
            const ids = nodes.map((node) => node.id)
            return ids.filter((id, i) => ids.indexOf(id) !== i)
          })
          expect(duplicates).toEqual([])
          await expect(page.locator('main')).toHaveCount(1)
          for (const button of await page.locator('[data-icon-only="true"]').all()) {
            const bounds = await button.boundingBox()
            if (bounds) expect(bounds.width, group).toBeCloseTo(bounds.height, 0)
          }
          const inputs = await page
            .locator('input[data-ui="field-control"]:not([type="checkbox"])')
            .evaluateAll((nodes) =>
              nodes
                .filter((node) => {
                  // An enhanced control hides the native input it replaces (a date-time picker's).
                  if (node.getClientRects().length === 0) return false
                  const input = node.getBoundingClientRect()
                  const field = node.closest('[data-ui="field"]')!.getBoundingClientRect()
                  return input.width < 48 || input.right > field.right + 1 || input.left < field.left - 1
                })
                .map((node) => node.id),
            )
          expect(inputs, group).toEqual([])
          // A label sits beside its control from 48rem in a column wider than 28rem (the column is
          // whatever holds the fields), and above it otherwise; a lone checkbox leads with its box, and a
          // part of a composite control (a date-time picker's time) names itself to assistive tech only.
          const stackedFields = await page
            .locator(
              '[data-ui="field"]:not([data-kind="group"]):not([data-kind="checkbox"]):not([data-label-hidden="true"])',
            )
            .evaluateAll((fields) =>
              fields.flatMap((field) => {
                const label = field.querySelector(':scope > [data-ui="field-label"]')?.getBoundingClientRect()
                const control = field
                  .querySelector(':scope > :is([data-ui="field-control"], [data-ui="field-options"])')
                  ?.getBoundingClientRect()
                if (!label || !control?.width) return []
                const column = field.parentElement!
                const style = getComputedStyle(column)
                const inline =
                  column.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
                const beside = innerWidth >= 768 && inline > 28 * 16
                const misplaced = beside
                  ? label.right > control.left - 7 ||
                    label.top >= control.bottom ||
                    control.top >= label.bottom
                  : label.bottom > control.top + 1
                return misplaced ? [field.textContent?.trim()] : []
              }),
            )
          expect(stackedFields, group).toEqual([])
          if (group === 'patterns') {
            const facts = page.locator('#form-page [data-ui="form-page-aside"] [data-ui="stack"] > span')
            await expect(facts).toHaveCount(2)
            const factBoxes = await facts.evaluateAll((nodes) =>
              nodes.map((node) => ({
                top: node.getBoundingClientRect().top,
                bottom: node.getBoundingClientRect().bottom,
              })),
            )
            expect(factBoxes[1].top - factBoxes[0].bottom).toBeGreaterThanOrEqual(8)
          }
          if (group === 'field-states') {
            expect(
              await page.locator('#settings-reference').evaluate((node: HTMLInputElement) => node.readOnly),
            ).toBe(true)
            await expect(page.locator('#settings-locked')).toBeDisabled()
            await expect(page.locator('#settings-street-error')).toBeVisible()
            // The field's stroke is an inset shadow; an invalid field draws it in the danger tone.
            expect(
              await page.locator('#settings-city').evaluate((node) => getComputedStyle(node).boxShadow),
            ).not.toBe(
              await page.locator('#settings-street').evaluate((node) => getComputedStyle(node).boxShadow),
            )
          }
          if (group === 'actions')
            await expect(page.getByRole('button', { name: 'Opening record', exact: true })).toBeDisabled()
          if (group === 'navigation')
            await expect(page.locator('#navigation-items [data-ui="tabs"]')).toHaveCSS(
              'border-bottom-width',
              '1px',
            )
          if (group === 'application-structure') {
            const canvas = page.locator('#workspace-canvas [data-ui="board-page-body"]')
            const columns = canvas.locator(':scope > [data-ui="grid"] > [data-ui="section"]')
            const positions = await columns.evaluateAll((nodes) =>
              nodes.map((node) => {
                const rect = node.getBoundingClientRect()
                return { top: rect.top, width: rect.width }
              }),
            )
            expect(positions).toHaveLength(3)
            for (const column of positions) {
              expect(column.width).toBeGreaterThanOrEqual(255)
              expect(column.top).toBeCloseTo(positions[0].top, 0)
            }
          }
          if (density === 'default' && [390, 1440].includes(width))
            for (const [id, owner] of Object.entries(screenshots))
              if (owner === group)
                await page
                  .locator(`[data-ui="catalogue-specimen"]#${id}`)
                  .screenshot({ path: testInfo.outputPath(`${id}.png`) })
        }
    })
  }

for (const width of [390, 1440]) {
  test(`row navigation and selection remain independent / ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/components/patterns?theme=light')
    const row = page.locator('#data-table [data-ui="row"]').first()
    await row.scrollIntoViewIfNeeded()
    await expect(row.locator('a')).toHaveCount(1)
    const checkbox = row.locator('[data-ui="row-select"]')
    await checkbox.uncheck()
    await expect(page).not.toHaveURL(/#SO-/)
    const cell = row.locator('[data-ui="cell"]').nth(1)
    const bounds = await cell.boundingBox()
    await page.mouse.click(bounds!.x + bounds!.width - 4, bounds!.y + bounds!.height / 2)
    await expect(page).toHaveURL(/#SO-1042$/)
    await expect(checkbox).not.toBeChecked()
    await row.locator('a').focus()
    await expect(row).toHaveCSS('outline-width', '2px')
  })
}

test('bulk commands submit selected row IDs and empty query chrome takes no space', async ({ page }) => {
  await page.goto('/specimens/bulk')
  await expect(page.locator('[data-ui="list-chrome-row"]')).toBeHidden()
  await page.getByRole('button', { name: 'Approve' }).click()
  const query = new URL(page.url()).searchParams
  expect(query.getAll('ids')).toEqual(['A'])
  expect(query.get('intent')).toBe('approve')
})
