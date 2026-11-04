import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const authored = import.meta.url.endsWith('.ts')
const css = readFileSync(
  fileURLToPath(
    new URL(
      authored
        ? '../packages/website-client/client/ds-gaps.css'
        : '../../packages/website-client/client/ds-gaps.css',
      import.meta.url,
    ),
  ),
  'utf8',
)

test('narrow Builder panels stack fields but keep a checkbox beside its label', () => {
  const start = css.indexOf('GAP ds-narrow-workspace-controls')
  assert.ok(start >= 0, 'the narrow-panel gap rule is present')
  const block = css.slice(start, css.indexOf('/* A select and its chevron', start))
  // Stacking a checkbox field put its label in a second, zero-width column under the box: the
  // template confirmation read "ôi đồng ý" with the box over the first letter.
  const stacked = block.split('\n').filter((line) => line.trim().startsWith('[data-ui="field"]'))
  assert.equal(stacked.length, 2)
  for (const line of stacked) assert.match(line, /:not\(\[data-kind="checkbox"\], \[data-kind="switch"\]\)/)
})
