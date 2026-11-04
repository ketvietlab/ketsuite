import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'
import { createGridModel } from '../packages/design-system/src/interactions/ket-grid/model.ts'
import { resolveColumn } from '../packages/design-system/src/interactions/ket-grid/columns.ts'
import { catalogueDraftInput } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { createSaleCatalogueView } from '../packages/ketsuite/src/ui/client/sale-catalogue-view.tsx'
import { catalogueMessages } from '../packages/ketsuite/src/modules/sale_backend/catalogue-messages.ts'

test('D27 constant write sets distinguish manual price, automatic selection and inverse margin', () => {
  const row = { id: 'line', product: 'a', quantity: 2, price: '100', cost: '60', automatic: true }
  const options = ketGridOptions({
    label: 'Lines',
    rows: [row],
    draftFlags: ['automatic'],
    columns: [
      { key: 'product', label: 'Product', type: 'text', editable: true, writeSets: { automatic: true } },
      { key: 'price', label: 'Price', type: 'text', editable: true, writeSets: { automatic: false } },
      {
        key: 'margin',
        label: 'Margin',
        type: 'money',
        editable: true,
        writeSets: { automatic: false },
        compute: {
          multiply: ['quantity', 'price'],
          less: ['quantity', 'cost'],
          solve: { field: 'price', digits: 0 },
        },
      },
    ],
  })
  const grid = createGridModel({
    columns: options.columns.map((column) =>
      resolveColumn(column, { locale: 'en', currency: 'VND', yes: 'Yes', no: 'No' }),
    ),
    rows: [row],
    draftFlags: options.draftFlags,
    createRow: null,
    rowId: (row) => String(row.id),
    rowEditable: () => true,
    rowRemovable: () => true,
    readOnly: false,
    messages: { required: '', belowMin: '', aboveMax: '', conflict: '', removedElsewhere: '' },
  })
  grid.edit([{ id: 'line', key: 'margin', value: 100 }], 'edit')
  assert.equal(grid.entry('line')!.row.price, '110')
  assert.equal(grid.entry('line')!.row.automatic, false)
  grid.undo()
  assert.equal(grid.entry('line')!.row.automatic, true)
  grid.edit([{ id: 'line', key: 'price', value: '80' }], 'edit')
  assert.equal(grid.entry('line')!.row.automatic, false)
  grid.edit([{ id: 'line', key: 'product', value: 'b' }], 'edit')
  assert.equal(grid.entry('line')!.row.automatic, true)
  grid.restoreDraft(
    {
      added: [],
      updated: [{ id: 'line', values: { product: 'b', price: '80', automatic: true, cost: '999' } }],
      removed: [],
      order: null,
    },
    { add: true, remove: true, order: true },
  )
  assert.equal(grid.entry('line')!.row.automatic, true)
  assert.equal(grid.entry('line')!.row.cost, '60')
  grid.edit([{ id: 'line', key: 'margin', value: Number.NaN }], 'edit')
  assert.equal(grid.entry('line')!.row.automatic, true)
  grid.setReadOnly(true)
  grid.restore([{ id: 'line', values: { automatic: false } }])
  assert.equal(grid.entry('line')!.row.automatic, true)
})

test('D27 catalogue navigation reads captured parent drafts and preserves unchanged delivery dates', () => {
  const changes = {
    added: [],
    updated: [{ id: 'line', values: { productUomQty: 3 } }],
    removed: [],
    order: null,
  }
  const c = {
    id: 'order',
    data: {
      permissions: { applyLineGrid: true },
      record: {
        revision: 4,
        state: 'draft',
        commitmentDay: '2026-10-25',
        commitmentDate: '2026-10-24T17:00:00Z',
        shippingPolicy: 'direct',
        invoices: [],
      },
    },
    draft: (_name: string, fallback: string) => fallback,
    recordDraft: (name: string, fallback: string) =>
      name === 'lines' ? JSON.stringify(changes) : name === 'shippingPolicy' ? 'one' : fallback,
  } as unknown as RecordModalContext<SaleOrderModalData>
  assert.deepEqual(catalogueDraftInput(c), {
    id: 'order',
    expectedRevision: 4,
    changes,
    shippingPolicy: 'one',
  })
})

test('D27 catalogue SSR shows accessible quantities only for editable orders and an honest empty state', () => {
  const props = {
    id: 'order',
    data: {
      ok: true,
      order: { state: 'draft', revision: 1 },
      rows: [
        { id: 'sku', name: 'Coffee', code: 'CF', price: '10', currency: 'VND', unit: 'Each', quantity: '0' },
      ],
      total: 1,
      page: 1,
      pageSize: 24,
      categories: [],
      attributes: [],
    },
    editable: true,
    filters: {},
    labels: catalogueMessages.en,
    lang: 'en',
    href: '/admin/sales/catalogue/order',
  }
  const html = renderToString(createSaleCatalogueView(props).view!())
  assert.match(html, /Increase quantity · Coffee/)
  assert.match(html, /data-sku="sku"/)
  assert.match(html, /name="quantity"/)
  const readOnly = renderToString(createSaleCatalogueView({ ...props, editable: false }).view!())
  assert.doesNotMatch(readOnly, /data-sku=/)
  assert.match(readOnly, /read-only catalogue/)
  const empty = renderToString(
    createSaleCatalogueView({ ...props, data: { ...props.data, rows: [] } }).view!(),
  )
  assert.match(empty, /No matching products/)
})

test('D27 user draft flags cannot overwrite row, tier or column locks', () => {
  const options = ketGridOptions({
    label: 'Lines',
    rows: [],
    lockedField: 'locked',
    tiers: { key: 'price', by: 'quantity', steps: {}, lockedBy: 'tierLocked' },
    draftFlags: ['automatic', 'locked', 'tierLocked', 'costLocked'],
    columns: [{ key: 'price', label: 'Price', type: 'text', editable: true, lockedBy: 'costLocked' }],
  })
  assert.deepEqual(options.draftFlags, ['automatic'])
})
