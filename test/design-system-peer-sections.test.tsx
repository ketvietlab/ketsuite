import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Disclosure, Section, Stack, Surface } from '../packages/design-system/src/layouts/layout/index.tsx'

test('peer sections: native composition gives the parent one divider contract and preserves disclosure semantics', () => {
  const output = renderToString(
    <Surface
      title="Call"
      body={
        <Stack
          divided
          items={[
            <Section title="Result" body="Reached the customer" />,
            <Disclosure summary="Additional information" body="Internal note" />,
            <Section title="Next contact" body="Tomorrow" />,
          ]}
        />
      }
    />,
  )
  assert.equal((output.match(/data-divided="true"/g) ?? []).length, 1)
  assert.equal((output.match(/data-ui="surface"/g) ?? []).length, 1)
  assert.equal((output.match(/data-ui="section"/g) ?? []).length, 2)
  assert.match(output, /<details data-ui="disclosure"[\s\S]*?<summary[\s\S]*?Additional information/)
  assert.doesNotMatch(output, /<hr|style=/)
})

test('peer sections: parent hairlines outrank child frame resets in surfaces and flat presentation', () => {
  const css = readFileSync(
    new URL('../packages/design-system/src/layouts/layout/styles.css', import.meta.url),
    'utf8',
  )
  const [, selector, declarations] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) =>
    selector.includes('[data-divided="true"]'),
  )!
  // Flattening selectors have at most four class/attribute terms. The parent has five,
  // including :first-child, so a later border:0 reset cannot remove its boundary.
  assert.doesNotMatch(selector, /:where/)
  assert.match(selector, /\[data-kv-design-system\]/)
  assert.match(selector, />\s*:not\(:first-child\)/)
  assert.match(declarations, /border-block-start:\s*1px solid var\(--kv-panel-border\)/)
  assert.match(declarations, /padding-block-start:\s*var\(--kv-stack-gap\)/)
  assert.doesNotMatch(declarations, /!important/)
})
