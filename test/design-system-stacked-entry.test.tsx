import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Button, DataTable, Field } from '@ketvietlab/design-system'

// An entry row (the last row of a document's line table) names its inputs by the column headers. A
// stacked table on a phone has no header row and its title cell shows no column name, so the inputs
// there must show their own labels, and the row's commands need no "Actions" caption.

const sheet = readFileSync('packages/design-system/src/patterns/data-table/styles.css', 'utf8')
const stacked = sheet.slice(sheet.indexOf('@media (max-width: 47.9375rem)'))
const block = (marker: string) => {
  const at = stacked.indexOf(marker)
  assert.notEqual(at, -1, `missing ${marker}`)
  return stacked.slice(at, stacked.indexOf('}', at) + 1)
}

test('a stacked title cell shows the labels its fields hid behind the column header', () => {
  const label = block('[data-ui="field"][data-label-hidden="true"]\n      > [data-ui="field-label"] {')
  assert.match(label, /position: static;/u)
  assert.match(label, /clip-path: none;/u)
  assert.match(label, /width: auto;/u)
  assert.match(label, /grid-row: 1;/u)
  // Named like the other cells of the stacked row, in their muted small type.
  assert.match(label, /color: var\(--kv-text-muted\);/u)
  assert.match(label, /font-size: var\(--kv-text-sm\);/u)
  const scope = stacked.slice(stacked.lastIndexOf(':where', stacked.indexOf(label)), stacked.indexOf(label))
  assert.match(scope, /\[data-responsive="stack"\]/u, 'only a stacked table')
  assert.match(
    scope,
    /:is\(\[data-ui="cell"\]:first-child, \[data-ui="select-cell"\] \+ \[data-ui="cell"\]\)/u,
    'only the title cell, whose column name is not shown',
  )
  const below = block('> :not([data-ui="field-label"]) {')
  assert.match(below, /grid-row: auto;/u, 'the control follows its label instead of sharing its row')
  const select = block('> select[data-ui="field-control"] {')
  assert.match(select, /grid-row: 2;/u, 'a select and its chevron stay together under the label')
  // The rule sits inside the phone breakpoint, where the header row is hidden.
  assert.ok(stacked.indexOf(label) > 0)
  assert.ok(sheet.indexOf(label) > sheet.indexOf('@media (max-width: 47.9375rem)'))
})

test('a column of row commands drops its name when stacked and keeps the commands at the end', () => {
  const html = renderToString(
    <DataTable
      label="Dòng"
      rows={[{ id: 'add' }]}
      id={(row: { id: string }) => row.id}
      responsive="stack"
      columns={[
        {
          key: 'label',
          label: 'Diễn giải',
          priority: 'primary',
          cell: () => Field({ id: 'line-label', name: 'line-label', label: 'Diễn giải', labelHidden: true }),
        },
        {
          key: 'actions',
          label: 'Thao tác',
          kind: 'actions',
          cell: () => Button({ label: 'Thêm dòng', type: 'submit' }),
        },
      ]}
    />,
  )
  assert.match(html, /<td[^>]*data-col="actions"[^>]*data-kind="actions"[^>]*data-label="Thao tác"/u)
  assert.match(html, /data-label-hidden="true"/u)
  const actions = block('[data-ui="cell"][data-kind="actions"] {')
  assert.match(actions, /justify-content: flex-end;/u)
  assert.match(block('[data-ui="cell"][data-kind="actions"]::before {'), /display: none;/u)
})
