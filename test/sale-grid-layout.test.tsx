import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { RecordPage } from '@ketvietlab/design-system'
import { recordPageFrame } from '../packages/ketsuite/src/ui/record-modal.tsx'
import { saleLineGridConfig } from '../packages/ketsuite/src/modules/sale_backend/modal/line-grid.tsx'
import {
  saleOrderModalDefinition,
  type SaleOrderModalData,
} from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'

test('wide record rails preserve explicit reading order through native and public frames', () => {
  for (const order of ['before', 'after'] as const) {
    for (const frame of [RecordPage, recordPageFrame]) {
      const html = renderToString(
        frame({
          title: 'Order',
          body: 'EDITING_BODY',
          aside: 'REFERENCE_RAIL',
          asideWhenStacked: order,
          asideBreakpoint: 'wide',
        }),
      )
      assert.match(html, /data-aside-breakpoint="wide"/)
      assert.equal(html.indexOf('REFERENCE_RAIL') < html.indexOf('EDITING_BODY'), order === 'before')
    }
  }
  assert.doesNotMatch(
    renderToString(RecordPage({ title: 'Default', body: 'body', aside: 'rail' })),
    /data-aside-breakpoint/,
  )
  assert.equal(saleOrderModalDefinition.pageAsideWhenStacked, 'after')
  assert.equal(saleOrderModalDefinition.pageAsideBreakpoint, 'wide')
})

test('Commerce line cells keep compact SKU codes, searchable names and a grid below the 1064px measure', () => {
  const c = {
    kind: 'sale.order',
    id: 'order',
    busy: false,
    data: {
      record: {
        currency: 'VND',
        state: 'draft',
        lines: [
          {
            id: 'line',
            productId: 'legacy',
            productCode: 'OLD-42',
            name: 'Historical item',
            productUomId: 'each',
            productUomQty: '1',
            priceUnit: '100',
            discount: '0',
          },
          {
            id: 'free',
            productId: null,
            productCode: null,
            name: 'Consultation',
            productUomId: null,
            productUomQty: '1',
            priceUnit: '100',
            discount: '0',
          },
        ],
      },
      choices: { variants: [{ id: 'sku', defaultCode: 'SKU-42', displayName: 'A long product name' }] },
      lang: 'en',
    },
    draft: (_name: string, fallback = '') => fallback,
    t: (key: string) => key,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const grid = saleLineGridConfig(c)
  assert.ok(28 + grid.columns.reduce((total, column) => total + Number(column.width ?? 0), 0) <= 1064)
  const products = grid.columns.find((column) => column.key === 'productId')!
  assert.deepEqual(
    products.options!.find((option) => option.value === 'sku'),
    { value: 'sku', label: 'SKU-42', description: 'A long product name' },
  )
  assert.equal(products.options!.find((option) => option.value === 'legacy')!.label, 'OLD-42')
  assert.ok(!products.options!.some((option) => option.value === 'null'))
  assert.equal(grid.rows[1]!.name, 'Consultation')
  assert.equal(products.search!.descriptionField, 'displayName')
  assert.equal(products.search!.labelFallbackField, 'displayName')
})

test('remote grid options preserve identity and full descriptions with compact-label fallbacks', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          value: [
            { id: 'sku', code: 'SKU-42', fullName: 'A long product name' },
            { id: 'legacy', code: '', fullName: 'Uncoded legacy item' },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  )
  const [column] = ketGridOptions({
    label: 'Lines',
    rows: [],
    columns: [
      {
        key: 'productId',
        label: 'Product',
        type: 'combobox',
        search: {
          listFunction: 'product.listVariants',
          labelField: 'code',
          labelFallbackField: 'fullName',
          descriptionField: 'fullName',
        },
      },
    ],
  }).columns
  assert.deepEqual(await column!.search!('item', { row: {}, signal: new AbortController().signal }), [
    { value: 'sku', label: 'SKU-42', description: 'A long product name' },
    { value: 'legacy', label: 'Uncoded legacy item', description: 'Uncoded legacy item' },
  ])
})
