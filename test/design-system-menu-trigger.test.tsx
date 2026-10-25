import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Menu } from '@ketvietlab/design-system'

const css = readFileSync('packages/design-system/src/interactions/menu/styles.css', 'utf8')
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`)
  assert.notEqual(start, -1, `missing ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

test('a plain menu trigger is a bare hit area whose content draws the face', () => {
  const markup = renderToString(
    <Menu
      id="more"
      label="More"
      triggerAppearance="plain"
      size="compact"
      trigger={<span class="tile">More</span>}
      items={[{ id: 'mute', label: 'Mute', value: 'mute' }]}
    />,
  )
  assert.match(markup, /data-ui="menu"[^>]*data-trigger="plain"/)
  // The trigger keeps its name and disclosure semantics.
  assert.match(markup, /data-ui="menu-trigger" role="button" aria-haspopup="menu"[^>]*aria-label="More"/)

  const plain = rule(
    ':where([data-kv-design-system]) [data-ui="menu"][data-trigger="plain"] [data-ui="menu-trigger"]',
  )
  for (const declaration of [
    'min-height: 0;',
    'padding: 0;',
    'border: 0;',
    'background: none;',
    'color: inherit;',
  ])
    assert.ok(plain.includes(declaration), declaration)
  // Declared after the compact size so a compact plain menu stays bare.
  assert.ok(
    css.indexOf('[data-trigger="plain"] [data-ui="menu-trigger"]') >
      css.indexOf('[data-size="compact"] [data-ui="menu-trigger"]'),
  )
})

test('the default trigger keeps its button frame and renders no appearance hook', () => {
  for (const triggerAppearance of [undefined, 'button'] as const) {
    const markup = renderToString(
      <Menu
        id="more"
        label="More"
        triggerAppearance={triggerAppearance}
        items={[{ id: 'mute', label: 'Mute' }]}
      />,
    )
    assert.doesNotMatch(markup, /data-trigger=/)
  }
})
