import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { HOOKS, OWNERS, ResourceList, WorkspacePage } from '@ketvietlab/design-system'

// Selectors are compared with their whitespace collapsed: the formatter may wrap a long one.
const rule = (file: string, selector: string) => {
  const sheet = readFileSync(file, 'utf8').replace(/\s+/g, ' ')
  const at = sheet.indexOf(`${selector} {`)
  assert.notEqual(at, -1, `missing rule ${selector}`)
  return sheet.slice(at, sheet.indexOf('}', at))
}
const workspaceSheet = 'packages/design-system/src/patterns/workspace-page/styles.css'
const listSheet = 'packages/design-system/src/data-display/resource-list/styles.css'
const rows = [
  { id: 'tx-1', ref: 'FT001', partner: 'Công ty Phương Nam' },
  { id: 'tx-2', ref: 'FT002', partner: 'Khách sạn Hải Âu' },
]
const queue = (currentId?: string) => (
  <ResourceList
    label="Unmatched transactions"
    rows={rows}
    id={(row) => row.id}
    href={(row) => `?id=${row.id}`}
    primary={(row) => row.ref}
    secondary={(row) => row.partner}
    currentId={currentId}
  />
)
const plain = (html: string) => html.replace(/<!--.*?-->/gs, '')

test('a workspace with a master puts the list beside the detail it works on, named for assistive tech', () => {
  const html = plain(
    renderToString(
      <WorkspacePage
        title="Bank reconciliation"
        variant="operational"
        master={queue('tx-2')}
        masterLabel="Unmatched transactions"
        body={<p>Match area</p>}
      />,
    ),
  )
  assert.match(
    html,
    /<div data-ui="dashboard-page-body"><div data-ui="workspace-split"><section data-ui="workspace-master" aria-label="Unmatched transactions"><div><ul data-ui="resource-list"/,
  )
  assert.match(html, /<div data-ui="workspace-detail"><p>Match area<\/p><\/div>/)
  // Without a master the body is unchanged.
  const single = plain(renderToString(<WorkspacePage title="Defaults" body={<p>Form</p>} />))
  assert.match(single, /<div data-ui="dashboard-page-body"><p>Form<\/p><\/div>/)
  assert.doesNotMatch(single, /workspace-split/)
  for (const hook of ['workspace-split', 'workspace-master', 'workspace-detail'])
    assert.ok(HOOKS.includes(hook), hook)
  assert.deepEqual(OWNERS.workspaceSplit, ['workspace-split', 'workspace-master', 'workspace-detail'])
})

test('the split wraps by the room it has, not by viewport, and owns one gap', () => {
  const split = rule(workspaceSheet, ':where([data-kv-design-system]) [data-ui="workspace-split"]')
  assert.match(split, /flex-wrap: wrap;/)
  assert.match(split, /gap: var\(--kv-gap-section\);/)
  const master = rule(workspaceSheet, ':where([data-kv-design-system]) [data-ui="workspace-master"]')
  assert.match(master, /flex: 1 1 20rem;/)
  assert.match(master, /overflow: auto;/)
  const detail = rule(workspaceSheet, ':where([data-kv-design-system]) [data-ui="workspace-detail"]')
  // The detail takes the free space and wraps under the master before it drops below 60% or
  // the 38rem a table needs; nothing later in the rule loosens that floor.
  assert.match(detail, /flex: 999 1 0;/)
  assert.match(detail, /min-inline-size: min\(100%, max\(60%, 38rem\)\);/)
  assert.doesNotMatch(detail, /min-width/)
  assert.doesNotMatch(
    readFileSync(workspaceSheet, 'utf8'),
    /workspace-(split|master|detail)[^{]*\{[^}]*margin/,
  )
})

test('a resource list marks the item open beside it as current, by more than colour', () => {
  const html = plain(renderToString(queue('tx-2')))
  assert.match(
    html,
    /<li data-ui="resource-list-item" data-current="true"><a data-ui="resource-list-link" href="\?id=tx-2" aria-current="true">/,
  )
  assert.equal(html.match(/aria-current/g)?.length, 1)
  assert.equal(html.match(/data-current/g)?.length, 1)
  assert.doesNotMatch(plain(renderToString(queue())), /aria-current|data-current/)
  const current = rule(
    listSheet,
    ':where([data-kv-design-system]) [data-ui="resource-list-item"][data-current="true"]',
  )
  assert.match(current, /background: var\(--kv-nav-selected\);/)
  assert.match(current, /box-shadow: inset 3px 0 0 var\(--kv-color-accent\);/)
  // Without selection boxes the link takes the free column, not the leading auto one.
  const unselectable = rule(
    listSheet,
    ':where([data-kv-design-system]) [data-ui="resource-list-item"]:not(:has(> [data-ui="resource-list-select"]))',
  )
  assert.match(unselectable, /grid-template-columns: minmax\(0, 1fr\) auto;/)
})
