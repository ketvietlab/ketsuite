import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Server-rendered hosts (the KétChat LiveView bridge) emit combobox options as buttons; they
// must lose the native button chrome and read like the link options the component renders.
test('combobox button options keep the link option layout', () => {
  const css = readFileSync(
    new URL('../packages/design-system/src/forms/combobox/styles.css', import.meta.url),
    'utf8',
  )
  const rule = css.match(/button\[data-ui="combobox-option"\]\s*\{([^}]*)\}/)
  assert.ok(rule, 'button option rule')
  for (const declaration of [
    'inline-size: 100%',
    'border: 0',
    'background: none',
    'font: inherit',
    'text-align: start',
  ]) {
    assert.ok(rule[1].includes(`${declaration};`), declaration)
  }
})
