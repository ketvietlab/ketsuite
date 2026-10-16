import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import * as DS from '@ketvietlab/design-system'

test('Thumbnail renders product media with stable geometry and a non-person fallback', () => {
  const html = renderToStaticString(DS.Thumbnail({ src: '/apple.jpg', alt: 'Red apple' }))
  assert.match(html, /data-ui="thumbnail" data-size="default" data-fit="cover"/)
  assert.match(html, /role="img" aria-label="Red apple"/)
  assert.match(html, /src="\/apple.jpg" alt="" loading="lazy" decoding="async"/)
  assert.doesNotMatch(html, /avatar|initials/)
  const empty = renderToStaticString(DS.Thumbnail({ alt: 'No product photo', size: 'small' }))
  assert.match(empty, /data-empty="true" role="img" aria-label="No product photo"/)
  assert.doesNotMatch(empty, /<img/)
  assert.match(empty, /data-ui="icon"/)
  const decorative = renderToStaticString(DS.Thumbnail({ src: '/apple.jpg', alt: '' }))
  assert.match(decorative, /alt=""/)
  assert.doesNotMatch(decorative, /aria-label=/)
})
