import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ContentCard, Thumbnail } from '@ketvietlab/design-system'

/** Hydration markers are not part of the structure under test. */
const markup = (view: Parameters<typeof renderToString>[0]) =>
  renderToString(view).replace(/<!--[\s\S]*?-->/g, '')

test('ContentCard keeps a catalogue picture beside all of its content when media is placed at the start', () => {
  const beside = markup(
    <ContentCard
      title="Apple"
      href="/products/apple"
      media={<Thumbnail alt="" />}
      mediaPlacement="start"
      summary="SKU-1"
      body="Available: 3"
      meta="10 ₫"
    />,
  )
  assert.match(beside, /^<article data-ui="content-card"[^>]*data-media="start">/)
  assert.match(
    beside,
    /<div data-ui="card-media"><span data-ui="thumbnail"[\s\S]*?<\/div><div data-ui="card-content"><header data-ui="card-head">[\s\S]*<div data-ui="card-meta">10 ₫<\/div><\/div><\/article>$/,
  )
  // The default keeps media above the card and adds no wrapper.
  for (const card of [
    markup(<ContentCard title="Banner" media={<img src="/a.jpg" alt="" />} body="Body" />),
    markup(<ContentCard title="Plain" mediaPlacement="start" body="No media, nothing to place" />),
  ]) {
    assert.doesNotMatch(card, /data-media=|data-ui="card-content"/)
  }

  const css = readFileSync('packages/design-system/src/layouts/layout/styles.css', 'utf8')
  assert.match(
    css,
    /\[data-ui="content-card"\]\[data-media="start"\] \{[^}]*grid-template-columns: 6rem minmax\(0, 1fr\);/,
  )
  assert.match(
    css,
    /> :is\(img, video, \[data-ui="thumbnail"\]\) \{[^}]*inline-size: 100%;[^}]*aspect-ratio: 1;/,
  )
  assert.match(
    css,
    /\[data-ui="card-content"\] > \[data-ui="card-meta"\] \{[^}]*align-self: stretch;[^}]*margin-top: auto;/,
    'the figure row spans the content and sits at its end',
  )
  assert.match(
    css,
    /\[data-ui="card-leading"\]:has\(> \[data-ui="thumbnail"\]\) \{[^}]*width: auto;[^}]*height: auto;[^}]*background: none;/,
    'a Thumbnail in the leading slot keeps its own size',
  )
})

test('a filter section panel is as wide as its values, not the 26rem the forms need', () => {
  const css = readFileSync('packages/design-system/src/interactions/search-filter/styles.css', 'utf8')
  assert.match(
    css,
    /\[data-variant="search-filter"\]\[data-section="filter"\]\s*\[data-ui="menu-panel"\] \{\s*inline-size: max-content;\s*min-inline-size: min\(max\(100%, 12rem\), 100cqi\);\s*\}/,
  )
  // The other sections keep the shared width for their forms.
  assert.match(css, /\[data-ui="menu-panel"\] \{[^}]*inline-size: min\(26rem, 100cqi\);/)
})

test('a between-aligned Inline spreads across its row in the backend kit', () => {
  const css = readFileSync('packages/ketsuite/src/modules/backend/design/controls.css', 'utf8')
  assert.match(css, /\[data-ui="inline"\] \{\s*display: inline-flex;/)
  assert.match(css, /\[data-ui="inline"\]\[data-align="between"\] \{\s*display: flex;\s*\}/)
})
