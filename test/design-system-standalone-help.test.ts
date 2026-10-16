import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { AppSwitcher, AppSwitcherHelp } from '@ketvietlab/design-system'

test('standalone help uses the same named native control and shared runtime hook as the rail', () => {
  const label = 'Screen guidance'
  const standalone = renderToStaticString(AppSwitcherHelp({ label }))
  const rail = renderToStaticString(
    AppSwitcher({ label: 'Apps', newTabLabel: 'New tab', activeId: 'chat', items: [], helpLabel: label }),
  )
  assert.match(standalone, /button type="button" data-ui="app-switcher-help" aria-label="Screen guidance"/)
  assert.match(standalone, /data-ui="icon"[^>]*aria-hidden="true"/)
  assert.ok(rail.includes(standalone))
  assert.equal((rail.match(/data-ui="app-switcher-help"/g) || []).length, 1)
})

test('the standalone trigger escapes host labels and does not instantiate a second rail', () => {
  const html = renderToStaticString(AppSwitcherHelp({ label: '<script>test</script>' }))
  assert.doesNotMatch(html, /<script>|data-ui="app-switcher"/)
  assert.match(html, /&lt;script&gt;/)
})
