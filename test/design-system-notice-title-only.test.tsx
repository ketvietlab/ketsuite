import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Notice } from '@ketvietlab/design-system'

const sheet = readFileSync('packages/design-system/src/primitives/feedback/styles.css', 'utf8')
const plain = (html: string) => html.replace(/<!--.*?-->/gs, '')
const ruleAfter = (marker: string) => {
  const at = sheet.indexOf(marker)
  assert.notEqual(at, -1, `missing ${marker}`)
  return sheet.slice(sheet.lastIndexOf('}', at) + 1, sheet.indexOf('}', at) + 1)
}

test('a notice with only a title reads as one sentence: no colon, no empty message line', () => {
  // The message slot stays in the markup (runtimes fill it later); its text is empty.
  const html = plain(
    renderToString(
      <Notice title="Only the chief accountant may book a difference." message="" tone="warning" />,
    ),
  )
  assert.match(html, /<p data-ui="notice-message"><span[^>]*><\/span><\/p>/)
  const colon = ruleAfter('[data-ui="notice-title"]::after {\n    content: none;')
  assert.match(
    colon,
    /\[data-ui="notice-copy"\]:not\(:has\(\[data-ui="notice-message"\] > :not\(:empty\)\)\)/,
  )
  const line = ruleAfter('[data-ui="notice-message"]:not(:has(> :not(:empty))) {')
  assert.match(line, /display: none;/)
  // With a message the title still introduces it.
  assert.match(sheet, /\[data-ui="notice-title"\]::after \{\s*content: ":";/)
  const full = plain(renderToString(<Notice title="Saved" message="The rule applies to new lines." />))
  assert.match(full, /<p data-ui="notice-message"><span[^>]*>The rule applies to new lines\.<\/span><\/p>/)
})
