import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToStaticString as renderToString } from '@ketvietlab/ketjs-view'
import { CodeBlock } from '../packages/design-system/src/index.ts'
import { componentRegistry } from '../packages/design-system/src/catalogue/registry.ts'

test('CodeBlock is a named, keyboard-reachable region that keeps text literal', () => {
  const html = renderToString(
    <CodeBlock label="Response body" language="json" value={'{\n  "a": "<b>"\n}'} />,
  )
  assert.match(
    html,
    /^<pre data-ui="code-block" data-language="json" role="region" aria-label="Response body" tabindex="0"><code>/,
  )
  assert.match(html, /&lt;b&gt;/)
  assert.doesNotMatch(html, /data-wrap/)
  assert.match(renderToString(<CodeBlock label="curl" wrap value="curl" />), /data-wrap="true"/)
  assert.ok(componentRegistry.some((entry) => entry.name === 'CodeBlock'))
})

test('CodeBlock owns its frame, type and scrolling with tokens', () => {
  const css = readFileSync('packages/design-system/src/primitives/status/styles.css', 'utf8')
  const block = css.slice(
    css.indexOf('[data-ui="code-block"] {'),
    css.indexOf('[data-ui="code-block"][data-wrap="true"]'),
  )
  for (const rule of [
    'font-family: var(--kv-font-mono)',
    'font-size: var(--kv-text-xs)',
    'line-height: var(--kv-line-xs)',
    'border-radius: var(--kv-radius-md)',
    'background: var(--kv-color-surface-subtle)',
    'padding: var(--kv-space-3)',
    'overflow: auto',
    'white-space: pre',
    'max-block-size: calc(var(--kv-line-xs) * 24 + var(--kv-space-3) * 2)',
  ])
    assert.ok(block.includes(rule), rule)
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(/i)
  assert.match(css, /\[data-ui="code-block"\]\[data-wrap="true"\] \{\s*white-space: pre-wrap;/)
  assert.match(css, /\[data-ui="code-block"\]:focus-visible/)
})
