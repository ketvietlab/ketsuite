import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { Button } from '@ketvietlab/design-system'

test('logo choices keep native button semantics, accessible names and selection independent from image loading', () => {
  const html = renderToStaticString(
    Button({ label: 'Giao Hàng Nhanh', logo: { src: '/ghn.svg' }, pressed: true, disabled: true }),
  )
  assert.match(html, /type="button"/)
  assert.match(html, /aria-label="Giao Hàng Nhanh"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /disabled/)
  assert.match(html, /data-ui="action-logo"[^>]*src="\/ghn.svg"[^>]*alt=""/)
  assert.match(html, /data-ui="action-selection" aria-hidden="true"/)
  const standard = renderToStaticString(Button({ label: 'Save draft' }))
  assert.doesNotMatch(standard, /data-logo="true"|action-logo|action-selection/)
  assert.match(standard, /Save draft/)
  const busy = renderToStaticString(
    Button({ label: 'Loading carrier', logo: { src: '/ghn.svg' }, loading: true }),
  )
  assert.match(busy, /aria-busy="true"/)
  assert.match(busy, /data-ui="action-spinner"/)
  assert.match(busy, /disabled/)
})
