import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { RecordRail } from '@ketvietlab/design-system'

const sheet = readFileSync('packages/design-system/src/record/composition/styles.css', 'utf8')
const rule = (selector: string) => {
  const at = sheet.indexOf(`${selector} {`)
  assert.notEqual(at, -1, `missing rule ${selector}`)
  return sheet.slice(at, sheet.indexOf('}', at))
}

test('record rail stacks its sections itself, with one gap and one divider between them', () => {
  const html = renderToString(
    <RecordRail
      label="Record context"
      sections={[
        { id: 'customer', title: 'Customer', body: 'Ngọc Linh' },
        { id: 'owner', title: 'Owner', body: 'Sales operations' },
      ]}
    />,
  ).replace(/<!--.*?-->/gs, '')
  // Sections are the rail's direct children, so the rail is the owner of the space between them.
  assert.match(html, /<aside data-ui="record-rail" aria-label="Record context"><section data-ui="section"/)
  assert.equal(html.match(/<section data-ui="section"/g)?.length, 2)

  const rail = rule(':where([data-kv-design-system]) [data-ui="record-rail"]')
  assert.match(rail, /display: grid;/)
  assert.match(rail, /align-content: start;/)
  assert.match(rail, /gap: var\(--kv-layout-gap\);/)
  assert.match(rail, /min-width: 0;/)

  // The divider follows the rail's children, not the private hooks of the component inside them.
  const divider = rule(':where([data-kv-design-system]) [data-ui="record-rail"] > * + *')
  assert.match(divider, /padding-block-start: var\(--kv-layout-gap\);/)
  assert.match(divider, /border-block-start: 1px solid var\(--kv-panel-border\);/)
  // A section never adds its own margin to the rail's gap.
  assert.doesNotMatch(sheet, /record-rail[^{]*\{[^}]*margin/)
})
