import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowTaskCard } from '../src/index.mjs'

test('task status constraints are readable in the native card without disabling task opening or ordering', () => {
  const output = renderToStaticString(
    FlowTaskCard({
      task: { id: 'task-1', title: 'Review output', priority: 'medium', due: 'Today' },
      statusHint: 'Waiting for reviewer; status cannot change.',
      onOpen: () => {},
      onMoveKey: () => {},
      onDropTask: () => {},
    }),
  )
  assert.match(output, /data-flow="task-card" type="button"/)
  assert.match(output, /data-flow="card-status-hint">Waiting for reviewer; status cannot change\.<\/span>/)
  assert.match(output, /data-flow-task-drop="item"/)
  assert.doesNotMatch(output, /disabled/)
})
