import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { compileReportTemplate, renderReportHtml, type ReportNode } from '@ketvietlab/ketjs/pdf'
import { REPORT_FILTERS } from '../packages/ketsuite/src/modules/report/routes.ts'
import sale from '../packages/ketsuite/src/modules/sale/index.ts'
import { reports } from '../packages/ketsuite/src/modules/sale/reports.ts'
import { setup } from './fixtures/sale/commerce.ts'

async function seeded(t: Parameters<typeof setup>[0]) {
  const r = await setup(t)
  // Insert out of display order to distinguish storage order from document order.
  await r.save('sale.addLine', {
    id: 'z-main',
    orderId: 'order',
    name: 'Lắp đặt',
    sequence: 600,
    productUomQty: '1',
    priceUnit: '50',
  })
  for (const [id, displayType, name, sequence] of [
    ['s-main', 'section', 'Dịch vụ chính', 500],
    ['s-option', 'section', 'Thiết bị <b>tùy chọn</b>', 100],
    ['note', 'note', 'Giữ nguyên & kiểm tra', 300],
    ['empty', 'section', 'Phần trống', 700],
  ] as const)
    await r.save('sale.addLine', { id, orderId: 'order', displayType, name, sequence, productUomQty: '0' })
  await r.add({ id: 'optional-goods', sequence: 200 })
  await r.save('sale.addLine', {
    id: 'optional-service',
    orderId: 'order',
    name: 'Bảo trì',
    sequence: 400,
    productUomQty: '1',
    priceUnit: '100',
  })
  const before = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.setOptionalSections', {
    id: 'order',
    sectionIds: ['s-option'],
    expectedRevision: before.revision,
  })
  return r
}
const documentFor = (name: string, data: Row, locale: 'vi' | 'en') =>
  compileReportTemplate(reports[name]!.template!, {
    translate: (key: string) => String(sale.messages?.[locale]?.[key.replace(/^sale\./u, '')] ?? key),
    filters: REPORT_FILTERS(locale),
  }).render(data)
const elements = (node: ReportNode, tag: string): ReportNode[] =>
  node.kind === 'text'
    ? []
    : [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => elements(child, tag))]

test('D25 reports preserve sequence, optional tags and escaped structural text without commercial cells', async (t) => {
  const r = await seeded(t)
  const data = await r.call('sale.getQuotationReport', { id: 'order' })
  assert.deepEqual(
    (data.lines as Row[]).map((line) => line.id),
    ['s-option', 'optional-goods', 'note', 'optional-service', 's-main', 'z-main', 'empty'],
  )
  const blocks = data.blocks as Row[]
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['section', 'lines', 'note', 'lines', 'section', 'lines', 'section'],
  )
  assert.equal(blocks[0]!.optional, true)
  assert.equal(blocks[4]!.optional, false)
  assert.equal(data.amountTotal, '50')
  assert.ok(!JSON.stringify(data).includes('unitCost'))
  for (const locale of ['vi', 'en'] as const) {
    const doc = documentFor('quotation', data, locale)
    const html = renderReportHtml(doc)
    assert.match(html, locale === 'vi' ? /· Tùy chọn/ : /· Optional/)
    assert.match(html, /Thiết bị &lt;b&gt;tùy chọn&lt;\/b&gt;/)
    assert.match(html, /Giữ nguyên &amp; kiểm tra/)
    assert.equal(elements(doc, 'td').length, 18, 'only three commercial rows have six cells each')
    assert.equal(elements(doc, 'table').length, 3)
    assert.equal(
      elements(doc, 'thead').length,
      1,
      'one repeatable header, not one per section on every PDF page',
    )
    const textBlocks = elements(doc, 'text')
      .map((node) => renderReportHtml({ kind: 'element', tag: 'report', attrs: {}, children: [node] }))
      .join('')
    assert.match(textBlocks, /Dịch vụ chính/)
    assert.match(textBlocks, /Phần trống/)
    assert.ok(
      html.indexOf('Thiết bị') < html.indexOf('Giữ nguyên') &&
        html.indexOf('Giữ nguyên') < html.indexOf('Dịch vụ chính'),
    )
  }
})

test('D25 confirmed sales orders and pro-formas retain optional zero rows and the same section layout', async (t) => {
  const r = await seeded(t)
  await r.save('sale.confirmOrder', { id: 'order' })
  for (const [fn, report] of [
    ['getSalesOrderReport', 'salesOrder'],
    ['getProformaReport', 'proforma'],
  ] as const) {
    const data = await r.call('sale.' + fn, { id: 'order' })
    const optional = (data.lines as Row[]).find((line) => line.id === 'optional-goods')!
    assert.equal(Number(optional.productUomQty), 0)
    assert.equal(data.amountTotal, '50')
    assert.match(renderReportHtml(documentFor(report, data, 'en')), /· Optional/)
  }
  assert.equal(await r.call('sale.getQuotationReport', { id: 'order' }), null)
})

test('D25 report blocks remain active-company scoped and ordinary unsectioned documents retain one table', async (t) => {
  const r = await setup(t)
  await r.add()
  const data = await r.call('sale.getQuotationReport', { id: 'order' })
  assert.equal(elements(documentFor('quotation', data, 'en'), 'table').length, 1)
  assert.equal(elements(documentFor('quotation', data, 'en'), 'td').length, 6)
  const foreign = await r.app.fixture.call(
    'sale.getQuotationReport',
    { id: 'order' },
    { scope: { company: 'other', companies: ['acme', 'other'], branches: null } },
  )
  assert.equal(foreign.value, null)
})
