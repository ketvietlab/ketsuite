import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowGlobalSearch } from '../src/global-search.mjs'
import { FlowTaskRow } from '../src/index.mjs'
import { FlowSearchTrigger, FlowSpotlight } from '../src/workspace.mjs'

const props = {
  id: 'global',
  query: '',
  open: false,
  groups: [],
  onQuery() {},
  onOpen() {},
  onClose() {},
  onActive() {},
  onSelect() {},
  onRetry() {},
}
test('one named search combobox controls a non-modal result list and exposes loading, error and selection', () => {
  const output = renderToStaticString(
    FlowGlobalSearch({
      ...props,
      open: true,
      groups: [
        {
          id: 'tasks',
          label: 'Tasks',
          items: [{ id: 'task:one', title: '<Task>', description: 'Long content', icon: 'list' }],
        },
      ],
    }),
  )
  assert.equal((output.match(/<input/g) ?? []).length, 1)
  assert.match(output, /type="search" role="combobox"/)
  assert.match(output, /aria-controls="global-results"/)
  assert.match(output, /aria-activedescendant="global-option-task%3Aone"/)
  assert.match(output, /role="option" aria-selected="true"/)
  assert.match(output, /&lt;Task&gt;/)
  assert.doesNotMatch(output, /<dialog|autofocus/)
  assert.match(
    renderToStaticString(FlowGlobalSearch({ ...props, open: true, loading: true })),
    /aria-busy="true"/,
  )
  assert.match(
    renderToStaticString(FlowGlobalSearch({ ...props, open: true, error: 'Try reconnecting' })),
    /role="alert"/,
  )
  assert.match(renderToStaticString(FlowGlobalSearch({ ...props, disabled: true })), /disabled/)
})
test('task rows keep a full accessible identifier when the shared key track elides a long ID', () => {
  const output = renderToStaticString(
    FlowTaskRow({
      task: { id: 'LONG-PROJECT-123456789', title: 'Title', status: 'todo', priority: 'normal', due: '' },
      selected: false,
      onSelect() {},
      onOpen() {},
    }),
  )
  assert.match(output, /data-flow="task-id" title="LONG-PROJECT-123456789"/)
  assert.match(output, /data-flow="task-title">Title/)
})

test('sidebar launcher associates one native Spotlight dialog and exposes disabled and expanded states', () => {
  const closed = renderToStaticString(FlowSearchTrigger({ onClick() {}, disabled: true }))
  assert.match(closed, /<button[^>]*disabled[^>]*aria-haspopup="dialog" aria-expanded="false"/)
  assert.doesNotMatch(closed, /<input|aria-controls/)
  const opened = renderToStaticString(FlowSearchTrigger({ onClick() {}, open: true, dialogId: 'command' }))
  assert.match(opened, /aria-expanded="true" aria-controls="command"/)
})

test('Spotlight owns the only search input and hides stale options during loading or error', () => {
  const base = {
    ...props,
    activeId: '',
    scope: 'Flow',
    groups: [{ id: 'tasks', label: 'Tasks', items: [{ id: 'task:one', title: '<Task>', icon: 'list' }] }],
  }
  const ready = renderToStaticString(FlowSpotlight(base))
  assert.match(ready, /<dialog[^>]*data-size="spotlight"/)
  assert.equal((ready.match(/<input/g) ?? []).length, 1)
  assert.match(ready, /id="global-input"[^>]*type="search" role="combobox"/)
  assert.match(ready, /aria-activedescendant="global-option-task%3Aone"/)
  assert.match(ready, /autofocus/)
  assert.match(ready, /&lt;Task&gt;/)
  const loading = renderToStaticString(FlowSpotlight({ ...base, loading: true }))
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /role="status"/)
  assert.doesNotMatch(loading, /role="option"|aria-activedescendant|&lt;Task&gt;/)
  const error = renderToStaticString(FlowSpotlight({ ...base, error: 'Reconnect' }))
  assert.match(error, /role="alert"/)
  assert.doesNotMatch(error, /role="option"|aria-activedescendant/)
})

test('Spotlight consumes Escape before the native search field clears its query and ignores IME composition', () => {
  const handler = (node) => {
    if (!node || typeof node !== 'object') return null
    for (let i = 0; i < (node.values?.length ?? 0); i++) {
      if (node.strings[i].trimEnd().endsWith('on:keydown=')) return node.values[i]
      const child = handler(node.values[i])
      if (child) return child
    }
    return null
  }
  let closed = 0,
    prevented = 0,
    stopped = 0
  const keydown = handler(
    FlowSpotlight({ ...props, query: 'Keep query', scope: 'Flow', activeId: '', onClose: () => closed++ }),
  )
  assert.equal(typeof keydown, 'function')
  keydown({ key: 'Escape', isComposing: true })
  assert.equal(closed, 0)
  keydown({ key: 'Escape', preventDefault: () => prevented++, stopPropagation: () => stopped++ })
  assert.deepEqual([closed, prevented, stopped], [1, 1, 1])
})
