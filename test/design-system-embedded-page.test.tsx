import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { EmbeddedPage } from '@ketvietlab/design-system'

test('an embedded page is the screen: a hidden heading and one sandboxed, named frame', () => {
  const html = renderToString(
    <EmbeddedPage src="https://example.com/intro?a=1&b=2" title="Product introduction" />,
  )
  assert.match(html, /^<section data-ui="embedded-page">/)
  assert.match(html, /<h1 data-ui="visually-hidden">(?:<!--[^>]*-->)*Product introduction/)
  const frame = html.match(/<iframe[^>]*>/)?.[0] ?? ''
  assert.match(frame, /data-ui="embedded-page-frame"/)
  assert.match(frame, /src="https:\/\/example\.com\/intro\?a=1&amp;b=2"/)
  assert.match(frame, /title="Product introduction"/)
  assert.match(frame, /referrerpolicy="strict-origin-when-cross-origin"/)
  // The other page may run and open pop-ups, but never navigate the screen around it.
  const sandbox = frame.match(/sandbox="([^"]*)"/)?.[1]?.split(' ') ?? []
  assert.deepEqual(sandbox.toSorted(), [
    'allow-forms',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-same-origin',
    'allow-scripts',
  ])
  assert.equal((html.match(/<iframe/g) ?? []).length, 1)
})

test('an embedded page takes the height the location bar leaves and lets the frame scroll inside', () => {
  const css = readFileSync('packages/design-system/src/patterns/embedded-page/styles.css', 'utf8')
  const holds = String.raw`:has\(> \[data-ui="embedded-page"\], > \* > \[data-ui="embedded-page"\]\)`
  // The column is viewport-high and the page grows into it: a location bar taller on touch screens
  // than the top bar token must not make the document scroll.
  assert.match(
    css,
    new RegExp(
      String.raw`\[data-ui="app-main"\]${holds} \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-block-size: 100dvh;`,
    ),
  )
  assert.match(
    css,
    new RegExp(
      String.raw`\[data-has-topbar="true"\]\s*> \[data-ui="app-main"\]${holds} \{[^}]*min-block-size: calc\(100dvh - var\(--kv-app-topbar-height\)\);`,
    ),
  )
  assert.match(css, /\[data-ui="embedded-page"\] \{[^}]*flex: 1 1 auto;[^}]*min-block-size: 24rem;/)
  assert.doesNotMatch(css, /\[data-ui="embedded-page"\] \{[^}]*block-size: calc/)
  assert.match(css, /\[data-ui="embedded-page-frame"\] \{[^}]*flex: 1;[^}]*border: 0;/)
  const backend = readFileSync('packages/ketsuite/src/modules/backend/design/lists.css', 'utf8')
  assert.match(
    backend,
    /\[data-ui="content"\]:has\(> \[data-ui="embedded-page"\]\) \{[^}]*display: flex;[^}]*flex: 1 1 auto;[^}]*flex-direction: column;[^}]*padding: 0;/,
  )
  const all = readFileSync('packages/design-system/src/styles.css', 'utf8')
  assert.match(all, /@import "\.\/patterns\/embedded-page\/styles\.css";/)
})
