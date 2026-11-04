import { DESKTOP, expect, gridLine, recordReady, saveGridLines, settled, signIn, test } from './support.js'

// C18 (D26): a margin typed on a quotation line sets the unit price that earns it.

test.use({ viewport: DESKTOP, locale: 'vi-VN' })

const PRICE = 4
const MARGIN = 7
const PERCENT = 8

test('typing a margin or a margin % sets the unit price; a line without a cost keeps its margin shut', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/sales/quotations/quote-margin')
  await recordReady(page, /^S\d+/)
  await settled(page)
  const serum = gridLine(page, 'Serum B5 phục hồi 30ml')
  const cell = (index: number) => serum.getByRole('gridcell').nth(index)
  // Two at 350.000 over a cost of 150.000: 400.000 margin, 57%.
  await expect(cell(PRICE)).toHaveText('350000')
  await expect(cell(MARGIN)).toContainText('400.000')
  const type = async (index: number, value: string) => {
    await cell(index).dblclick()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(value)
    await page.keyboard.press('Enter')
  }
  // 500.000 over two: (150.000 + 250.000) a unit.
  await type(MARGIN, '500000')
  await expect(cell(PRICE)).toHaveText('400000')
  // 50%: 150.000 / (1 − 0.5).
  await type(PERCENT, '50')
  await expect(cell(PRICE)).toHaveText('300000')
  await saveGridLines(page)
  await page.reload()
  await recordReady(page, /^S\d+/)
  await expect(cell(PRICE)).toHaveText('300000')
  // A line without a product has no cost to work back from.
  const advice = gridLine(page, 'Tư vấn da')
  await advice.getByRole('gridcell').nth(MARGIN).dblclick()
  await expect(advice.getByRole('textbox')).toHaveCount(0)
  await expect(advice.getByRole('gridcell').nth(MARGIN)).toHaveAttribute('aria-readonly', 'true')
})
