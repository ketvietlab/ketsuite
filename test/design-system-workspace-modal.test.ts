import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { ModalSheet } from '@ketvietlab/design-system'

test('workspace dialog opts into viewport width while preserving native modal route and accessible title', () => {
  for (const size of ['small', 'default', 'large', 'workspace'] as const) {
    const html = renderToStaticString(
      ModalSheet({
        id: 'test-order',
        title: 'Tạo đơn nháp',
        presentation: 'dialog',
        size,
        height: 'fixed',
        closeHref: '/orders',
        closeLabel: 'Đóng',
        body: 'Giỏ hàng',
      }),
    )
    assert.match(html, new RegExp(`data-size="${size}"`))
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="test-order-title"/)
    assert.match(html, /data-route-modal="true"/)
    assert.match(html, /data-height="fixed"/)
  }
})
