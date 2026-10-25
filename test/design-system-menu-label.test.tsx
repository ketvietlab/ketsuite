import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Menu } from '@ketvietlab/design-system'

test('searchable menu empty-state labels keep stable identity and explicit visibility', () => {
  for (const hidden of [true, false, undefined]) {
    const markup = renderToString(
      <Menu
        id="labels"
        label="Labels"
        items={[{ id: 'empty', kind: 'label', label: 'No matching labels', hidden }]}
      />,
    )
    assert.match(markup, /data-ui="menu-label" id="labels-empty-label"/)
    assert.match(markup, /No matching labels/)
    if (hidden) assert.match(markup, /role="presentation" hidden/)
    else assert.doesNotMatch(markup, /role="presentation" hidden/)
  }
})
