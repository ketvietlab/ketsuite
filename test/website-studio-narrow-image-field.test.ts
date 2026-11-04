import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync(new URL('../packages/website-client/client/ds-gaps.css', import.meta.url), 'utf8')

/**
 * In a narrow Builder panel every field stacks its control under its label. The logo picker's control
 * is the Website's own `.website-theme-logo` wrapper, which the stacking rule did not list: it stayed
 * in the second column and left the label alone on the left half of the panel.
 */
test('narrow Builder panels stack the logo picker under its label like every other control', () => {
  const narrow = css.slice(css.indexOf('@container (max-width: 28rem)'))
  const stacked = narrow.slice(0, narrow.indexOf('grid-column: 1;'))
  for (const part of ['field-control', 'drop-zone', 'field-options', 'field-help', 'field-error'])
    assert.match(stacked, new RegExp(`\\[data-ui="${part}"\\]`), part)
  assert.match(stacked, /\.website-theme-logo\b/, 'the logo picker')
})
