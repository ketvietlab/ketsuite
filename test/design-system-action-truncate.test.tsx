import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Button, LinkButton } from '@ketvietlab/design-system'

test('record-value actions truncate without losing their accessible label or full-value tooltip', () => {
  const label = 'Ngọc Trâm · Công ty Phân phối Trái cây và Thực phẩm Két Việt'
  for (const view of [
    <Button label={label} truncateLabel />,
    <LinkButton label={label} href="/customer" truncateLabel />,
  ]) {
    const rendered = renderToString(view)
    assert.ok(rendered.includes(`title="${label}"`))
    assert.match(rendered, /data-ui="action-label" data-truncate="true"/)
    assert.match(rendered, /data-ui="text"[^>]*data-truncate="true"/)
    assert.ok(rendered.includes(label))
  }
  assert.doesNotMatch(renderToString(<Button label="Save" />), /data-truncate="true"/)
  const css = readFileSync('packages/design-system/src/primitives/actions/styles.css', 'utf8')
  assert.match(
    css,
    /\[data-ui="action-label"\]\[data-truncate="true"\]\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/,
  )
})
