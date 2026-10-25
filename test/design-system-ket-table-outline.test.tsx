import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { KetTable } from '@ketvietlab/design-system'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'

type Row = { id: string; name: string; level: number | null; emphasis: string | null; amount: string }
const rows: Row[] = [
  { id: '100', name: 'Current assets', level: 0, emphasis: 'group', amount: '528229831' },
  { id: '111', name: 'Cash', level: 2, emphasis: null, amount: '187900000' },
  { id: '222', name: 'Cost', level: 9, emphasis: 'bold', amount: '48000000' },
  { id: '270', name: 'Total assets', level: null, emphasis: 'total', amount: '564229831' },
]
const render = (extra: Record<string, unknown> = {}) =>
  renderToString(
    <KetTable
      rows={rows}
      id={(row: Row) => row.id}
      rowLevel={(row: Row) => row.level}
      rowEmphasis={(row: Row) => row.emphasis as 'group' | 'total' | null}
      columns={[
        { key: 'name', label: 'Indicator', cell: (row: Row) => row.name },
        { key: 'amount', label: 'Amount', align: 'end', cell: (row: Row) => row.amount },
      ]}
      labels={ketTableDemoConfig.labels}
      {...extra}
    />,
  )
const rowOf = (html: string, id: string) =>
  html.match(new RegExp(`<tr[^>]*data-row="${id}"[^>]*>`))?.[0] ?? ''

test('an outlined KetTable marks each row with its level and emphasis, and nothing else', () => {
  const html = render()
  // A row at the top carries no level; its emphasis still reads.
  assert.doesNotMatch(rowOf(html, '100'), /data-level|--kt-row-level/)
  assert.match(rowOf(html, '100'), /data-emphasis="group"/)
  assert.match(rowOf(html, '111'), /data-level="2"/)
  assert.match(rowOf(html, '111'), /style="--kt-row-level: 2"/)
  assert.doesNotMatch(rowOf(html, '111'), /data-emphasis/)
  // A deeper level stops at four steps; an unknown emphasis is dropped, not passed through.
  assert.match(rowOf(html, '222'), /data-level="4"/)
  assert.doesNotMatch(rowOf(html, '222'), /data-emphasis/)
  assert.match(rowOf(html, '270'), /data-emphasis="total"/)
  assert.doesNotMatch(rowOf(html, '270'), /data-level/)
})

test('a KetTable without an outline renders its rows as before', () => {
  const html = renderToString(
    <KetTable
      rows={rows}
      id={(row: Row) => row.id}
      columns={[{ key: 'name', label: 'Indicator', cell: (row: Row) => row.name }]}
      labels={ketTableDemoConfig.labels}
    />,
  )
  assert.doesNotMatch(html, /data-level|data-emphasis|--kt-row-level/)
})

test('the outline indents the subject cell, past a selection cell, and stacked rows do not', () => {
  const css = readFileSync('packages/design-system/src/interactions/ket-table/styles.css', 'utf8')
  const desktop = css.slice(0, css.indexOf('@media (max-width: 47.9375rem)'))
  assert.match(
    desktop,
    /\[data-ui="kt-row"\]\[data-level\]\s*> \[data-ui="kt-cell"\]:is\(:first-child, \[data-ui="kt-select-cell"\] \+ \*\) \{\s*padding-inline-start: calc\(var\(--kv-space-3\) \+ var\(--kt-row-level, 0\) \* var\(--kv-space-4\)\);/,
  )
  assert.match(
    desktop,
    /\[data-ui="kt-row"\]\[data-emphasis\] > \[data-ui="kt-cell"\] \{\s*font-weight: var\(--kv-weight-semibold\);/,
  )
  assert.match(
    desktop,
    /\[data-ui="kt-row"\]\[data-emphasis="total"\] > \[data-ui="kt-cell"\] \{\s*border-top: 1px solid var\(--kv-border-strong\);/,
  )
  const stacked = css.slice(css.indexOf('@media (max-width: 47.9375rem)'))
  assert.match(
    stacked,
    /\[data-responsive="stack"\]\s*\[data-ui="kt-row"\]\[data-level\]\s*> \[data-ui="kt-cell"\] \{\s*padding-inline-start: var\(--kv-space-3\);/,
  )
  assert.match(
    stacked,
    /\[data-responsive="stack"\]\s*\[data-ui="kt-row"\]\[data-emphasis="total"\]\s*> \[data-ui="kt-cell"\] \{\s*border-top: 0;/,
  )
})
