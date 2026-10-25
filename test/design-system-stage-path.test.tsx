import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { RecordPage, StagePath } from '@ketvietlab/design-system'

const sheet = readFileSync('packages/design-system/src/record/stage-path/styles.css', 'utf8')
const rule = (selector: string) => {
  const at = sheet.indexOf(`${selector} {`)
  assert.notEqual(at, -1, `missing rule ${selector}`)
  return sheet.slice(at, sheet.indexOf('}', at))
}
const render = (steps: Parameters<typeof StagePath>[0]['steps']) =>
  renderToString(<StagePath label="Sales path" completeLabel="completed" steps={steps} />).replace(
    /<!--.*?-->/gs,
    '',
  )

test('a stage path names where one record stands, in words as well as colour', () => {
  const html = render([
    { id: 'qualified', label: 'Qualified', state: 'complete', href: '#qualified' },
    { id: 'proposal', label: 'Proposal', state: 'current', href: '#proposal' },
    { id: 'close', label: 'Close', state: 'upcoming', href: '#close' },
  ])
  assert.match(html, /^<ol data-ui="stage-path" aria-label="Sales path">/)
  // The current step is where the record is, so it is announced and is not a link to itself.
  assert.match(html, /<span data-ui="stage-path-label" aria-current="step">/)
  assert.doesNotMatch(html, /href="#proposal"/)
  assert.equal(html.match(/aria-current/g)?.length, 1)
  // A passed step says so, and its check is decoration.
  assert.match(
    html,
    /<a data-ui="stage-path-label" href="#qualified"><span data-ui="stage-path-marker" aria-hidden="true"><svg data-ui="icon"[^>]*>[\s\S]*?<\/svg><\/span><span data-ui="stage-path-text">Qualified<\/span><span data-ui="text"[^>]*data-visually-hidden="true">, completed<\/span><\/a>/,
  )
  // A step ahead carries its number for the folded path only.
  assert.match(
    html,
    /<span data-ui="stage-path-marker" aria-hidden="true">3<\/span><span data-ui="stage-path-text">Close<\/span>/,
  )
  // A path has no counts or percentages, and names are never cut off behind a tooltip.
  assert.doesNotMatch(html, /%|title=/)
})

test('a closed outcome takes its tone once it is the current step', () => {
  const html = render([
    { id: 'proposal', label: 'Proposal', state: 'complete' },
    { id: 'lost', label: 'Lost', state: 'current', tone: 'danger' },
  ])
  assert.match(html, /<li data-ui="stage-path-step" data-state="current" data-tone="danger">/)
  assert.match(
    rule(
      '[data-ui="stage-path-step"][data-state="current"][data-tone="danger"]\n    [data-ui="stage-path-label"]::before',
    ),
    /background: var\(--kv-color-danger\);/,
  )
})

test('the chevron is drawn behind the step, so a focus ring is never clipped', () => {
  const shape = rule(':where([data-kv-design-system]) [data-ui="stage-path-label"]::before')
  assert.match(shape, /clip-path: polygon\(/)
  assert.match(shape, /z-index: -1;/)
  assert.doesNotMatch(
    rule(':where([data-kv-design-system]) [data-ui="stage-path-label"]'),
    /clip-path|overflow/,
  )
  assert.match(
    rule(':where([data-kv-design-system]) a[data-ui="stage-path-label"]:focus-visible'),
    /outline: 2px solid var\(--kv-color-focus\);/,
  )
  // The path measures its own width and folds every step but the current one.
  assert.match(
    rule(':where([data-kv-design-system]) [data-ui="stage-path"]'),
    /container: stage-path \/ inline-size;/,
  )
  const fold = sheet.slice(sheet.indexOf('@container stage-path (max-width: 47.9375rem)'))
  assert.match(fold, /\[data-ui="stage-path-step"\]:not\(\[data-state="current"\]\) \{\s*flex: 0 0 2\.75rem;/)
  assert.match(
    fold,
    /:not\(\[data-state="current"\]\)\s*\[data-ui="stage-path-text"\] \{\s*position: absolute;/,
  )
})

test("a record page carries its path as the header's last row, apart from the working controller", () => {
  const path = (
    <StagePath
      label="Sales path"
      completeLabel="completed"
      steps={[{ id: 'a', label: 'Qualified', state: 'current' }]}
    />
  )
  const html = renderToString(
    <RecordPage title="Deal" meta="OP-1 · Ngọc Linh" path={path} body="Body" />,
  ).replace(/<!--.*?-->/gs, '')
  // The header owns the gap and the inset around the path, so the path adds none of its own.
  assert.match(
    html,
    /<header data-ui="record-page-header"[^>]*>[\s\S]*<div data-ui="record-page-meta"[^>]*>OP-1 · Ngọc Linh<\/div><div data-ui="record-page-path"><ol data-ui="stage-path"[\s\S]*<\/ol><\/div><\/header>/,
  )
  assert.doesNotMatch(html, /record-page-controller/)
  // `margin: 0` only resets the list; no rule spaces the path from its neighbours.
  assert.doesNotMatch(sheet, /margin(?!: 0;)/)
})
