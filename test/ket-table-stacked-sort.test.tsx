import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { KetTable } from '../packages/design-system/src/interactions/ket-table/index.tsx'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'

const rows = [{ id: 'a', title: 'Tea', price: 45000 }]
const columns = [
  {
    key: 'title',
    label: 'Item',
    cell: (row: (typeof rows)[number]) => row.title,
    sortHref: '?sort=title',
    sortLabel: 'Sort item',
  },
  { key: 'price', label: 'Price', cell: (row: (typeof rows)[number]) => String(row.price) },
]

test('stacked KetTable exposes native sortable headers without making plain headers interactive', () => {
  const html = renderToString(
    <KetTable
      columns={columns}
      rows={rows}
      id={(row) => row.id}
      responsive="stack"
      labels={ketTableDemoConfig.labels}
      sort={{ field: 'title', direction: 'asc' }}
    />,
  )
  assert.match(html, /data-responsive="stack" data-has-sort="true"/)
  assert.match(html, /<th[^>]*data-col="title"[^>]*data-sortable="true"[^>]*aria-sort="ascending"/)
  assert.match(html, /<a data-ui="kt-sort-button" href="\?sort=title" aria-label="Sort item"/)
  const priceHeader = html.match(/<th[^>]*data-col="price"[^>]*>/)?.[0]
  assert.ok(priceHeader)
  assert.doesNotMatch(priceHeader, /data-sortable|aria-sort/)
  assert.equal((html.match(/data-ui="kt-sort-button"/g) ?? []).length, 1)
})

test('stacked KetTable without sorting retains its noninteractive header state', () => {
  const plain = columns.map(({ sortHref: _href, sortLabel: _label, ...column }) => column)
  const html = renderToString(
    <KetTable
      columns={plain}
      rows={rows}
      id={(row) => row.id}
      responsive="stack"
      labels={ketTableDemoConfig.labels}
    />,
  )
  assert.doesNotMatch(html, /data-has-sort|data-sortable|kt-sort-button/)
})
