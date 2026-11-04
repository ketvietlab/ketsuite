import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { boot } from './fixtures/sale/commerce.ts'
import { importModalDefinition as definition } from '../packages/ketsuite/src/modules/product_backend/modal/import-modal-view.tsx'
import type { ImportModalData } from '../packages/ketsuite/src/modules/product_backend/imports/shared.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
test('P52 native import form retains raw refusals and the receipt has no writable controls', () => {
  const data: ImportModalData = {
    lang: 'en',
    timezone: 'Asia/Ho_Chi_Minh',
    record: { id: 'import', name: 'NHAP/0001', data: 'saved source', occurredAt: '2026-10-23T01:30:00Z' },
    items: [],
    permissions: { create: true },
    download: '/admin/product/imports/export?lang=en',
  }
  const c: RecordModalContext<ImportModalData> = {
    id: 'import',
    kind: 'product.import',
    creating: true,
    tab: '',
    data,
    t: (key) => key,
    outcome: () => null,
    fieldError: (name) => (name === 'data' ? 'Row 3 refused' : null),
    draft: () => '  invalid\tdata\nkept  ',
    draftChecked: (_name, _value, fallback = false) => fallback,
    busy: false,
    dialog: null,
    href: () => '',
    state: (_key, fallback = '') => fallback,
  }
  const html = renderToString(definition.body!(c) as TemplateResult)
  assert.match(html, /Row 3 refused/)
  assert.match(html, / {2}invalid\tdata\nkept {2}/)
  assert.match(html, /name="data"/)
  assert.ok(html.includes(data.download.replaceAll('&', '&amp;')))
  const form = new FormData()
  form.set('data', '  raw source  ')
  assert.deepEqual(definition.commands!.save!.input!(form, c, {}), {
    id: 'import',
    data: '  raw source  ',
    locale: 'en',
  })
  assert.equal(definition.commands!.save!.after, 'open')
  const saved = { ...c, creating: false }
  const readOnly = renderToString(definition.body!(saved) as TemplateResult)
  assert.match(readOnly, /readonly/)
  assert.match(readOnly, /saved source/)
  // Company time zone, in the product history form (no seconds or zone name).
  assert.match(readOnly, />23 Oct 2026, 08:30</)
  assert.doesNotMatch(readOnly, /name="data"/)
  assert.doesNotMatch(renderToString(definition.actions!(saved) as TemplateResult), /type="submit"/)
})
test('P52 native list, modal context, export and product history resolve one receipt', async (t) => {
  const r = await boot(t)
  await r.save('product.importProducts', {
    id: 'receipt',
    data: 'Product code\tProduct name\tUnit\nTEA\tTea\tEach',
  })
  const context = await r.call('product_backend.importContext', { id: 'receipt', locale: 'en' })
  const data = context.data as ImportModalData
  assert.equal(data.record.name, 'NHAP/0001')
  assert.equal(data.timezone, 'Asia/Ho_Chi_Minh')
  assert.equal(data.record.actorName, 'Owner')
  assert.ok(data.items[0]?.href.includes('/admin/product/templates/'))
  const list = await r.call('product_backend.searchImports', {
    href: '/admin/product/imports?lang=en&company=acme&q=NHAP',
    q: 'NHAP',
    page: 1,
    pageSize: 1,
  })
  assert.equal(list.total, 1)
  assert.ok(String((list.rows as Row[])[0]?.editHref).includes('record='))
  assert.ok(!JSON.stringify(list).includes('Product code'))
  const id = String(data.items[0]!.templateId)
  const product = await r.call('product.templateModalContext', { id, locale: 'en' })
  assert.deepEqual((product.data as Row).imports, [{ id: 'receipt', name: 'NHAP/0001' }])
  const page = await r.app.client.get('/admin/product/imports?lang=en')
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /product.import-controls/)
  assert.match(html, /product.import-results/)
  assert.match(html, /product.import-footer/)
  const csv = await r.app.client.get('/admin/product/imports/export?lang=en')
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-disposition') ?? '', /product-import.csv/)
  assert.match(await csv.text(), /Product code/)
})

test('P54 collection CSVs keep filters and visible columns with a product- filename', async (t) => {
  const r = await boot(t)
  await r.save('product.importProducts', {
    id: 'csv',
    data: 'Product code\tProduct name\tUnit\nTEA\tTea\tEach\nCOFFEE\tCoffee\tEach',
  })
  for (const route of ['templates', 'variants']) {
    const response = await r.app.client.get(`/admin/product/${route}/export?lang=en&q=Tea`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition') ?? '', /filename="product-/)
    const csv = await response.text()
    assert.match(csv, /Tea/)
    assert.doesNotMatch(csv, /Coffee/)
    assert.doesNotMatch(csv, /product_backend/)
    assert.equal(csv.split('\r\n').length, 2)
    assert.match(csv, /Product/)
  }
})
