import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { AppShell, AppSwitcher } from '@ketvietlab/design-system'
import { exampleApplications } from '../packages/design-system/src/catalogue/application-switcher.ts'
import { createDemo2Routes } from '../apps/design-system/demo.tsx'

test('application switcher is SSR chrome with one active app and native new-tab links', () => {
  const html = renderToString(
    <AppShell
      applications={{ ...exampleApplications, activeId: 'stay' }}
      sidebar="Navigation"
      main="Content"
    />,
  )
  assert.equal((html.match(/data-ui="app-switcher"/g) ?? []).length, 1)
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length, 5)
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1)
  assert.match(html, /data-app-id="stay" data-active="true" aria-current="page"/)
  assert.ok(html.indexOf('data-ui="app-switcher"') < html.indexOf('data-ui="app-sidebar"'))
  assert.match(html, /data-ui="app-switcher-footer"/)
  assert.match(html, /data-ui="app-switcher-help" aria-label="Screen help"/)
  assert.ok(html.indexOf('data-ui="app-switcher-help"') < html.indexOf('data-ui="app-switcher-settings"'))
  assert.match(html, /data-placement="right"/)
  assert.match(html, /aria-label="Settings" title="Settings"/)
  assert.match(html, /href="#settings-application"/)
  assert.match(html, /aria-label="Stay · Open in a new tab"/)
  assert.match(html, /data-ui="app-switcher-tooltip" aria-hidden="true">(?:<!--[^>]*-->)*Stay/)
  const escaped = renderToString(
    <AppSwitcher
      {...exampleApplications}
      items={[{ id: 'x', label: '<unsafe>', href: '/?x=1&y=2', icon: 'globe' }]}
    />,
  )
  assert.doesNotMatch(escaped, /<unsafe>/)
  assert.match(escaped, /&lt;unsafe&gt;/)
  assert.match(escaped, /href="\/\?x=1&amp;y=2"/)
})

test('demo app placeholders preserve selection through menu navigation and stay outside fragments', () => {
  const routes = createDemo2Routes()
  for (const locale of ['vi', 'en']) {
    const url = new URL(`http://localhost/demo2?app=stay&lang=${locale}&theme=dark`)
    const html = String(routes['/demo2'](url).body)
    assert.match(html, /data-app-id="stay" data-active="true"/)
    assert.match(html, /href="\/demo2\?theme=dark[^"<>]*app=stay[^"<>]*view=orders/)
    assert.match(html, locale === 'en' ? /Accounting/ : /Kế toán/)
    assert.match(html, locale === 'en' ? /aria-label="Settings"/ : /aria-label="Cài đặt"/)
    const fragment = String(routes['/demo2'](url, { headers: { 'x-ket-navigation': 'fragment-v1' } }).body)
    assert.doesNotMatch(fragment, /data-ui="app-switcher"/)
  }
})

test('switcher layout keeps a dark desktop rail and reveals it only with the mobile drawer', () => {
  const css = readFileSync('packages/design-system/src/layouts/shell/styles.css', 'utf8')
  assert.match(css, /grid-template-columns: var\(--kv-app-switcher-width\) var\(--kv-sidebar-width\)/)
  assert.match(css, /background: var\(--kv-app-switcher-bg\)/)
  assert.match(css, /app-switcher-item"\][^{}]+:is\(:hover, :focus-visible\)/)
  assert.match(css, /app-shell"\] > \[data-ui="app-switcher"\] \{\s*display: none/)
  assert.match(css, /navigation-drawer"\] > \[data-ui="app-switcher"\]/)
})

test('hosts can hide help/settings and expose coming-soon apps without a navigation destination', () => {
  const html = renderToString(
    <AppSwitcher
      {...exampleApplications}
      helpLabel={undefined}
      settings={undefined}
      items={[{ id: 'phone', label: 'Phone', icon: 'phone', unavailableLabel: 'Sắp ra mắt' }]}
    />,
  )
  assert.doesNotMatch(html, /app-switcher-help|app-switcher-settings|href=|target=/)
  assert.match(html, /role="link" aria-disabled="true" tabindex="0"/)
  assert.match(html, /aria-label="Phone · Sắp ra mắt"/)
})
