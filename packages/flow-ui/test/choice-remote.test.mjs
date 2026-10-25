import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowChoiceField } from '../src/choice-field.mjs'
const render = (remote, open = true) =>
  renderToStaticString(
    FlowChoiceField({
      id: 'status',
      label: 'Status',
      value: 'one',
      options: [{ value: 'one', label: 'One', content: 'One' }],
      onChange() {},
      menu: { open, onToggle() {} },
      remote,
    }),
  )
test('remote choices keep status/recovery outside the listbox and defer all closed content', () => {
  const loading = render({ loading: true, onRetry() {} })
  assert.match(loading, /aria-haspopup="dialog"/)
  assert.match(loading, /role="status"/)
  assert.match(loading, /role="listbox"[^>]*aria-busy="true"/)
  const error = render({ loading: false, error: 'Read failed', onRetry() {} })
  assert.match(error, /role="alert">Read failed/)
  assert.ok(error.indexOf('role="alert"') < error.indexOf('role="listbox"'))
  const closed = render({ loading: true, error: 'Read failed', onRetry() {} }, false)
  assert.doesNotMatch(closed, /role="status"|role="alert"|role="option"/)
})

test('remote single choices keep search and pagination outside listbox and retain selected labels', () => {
  const html = renderToStaticString(
    FlowChoiceField({
      id: 'project',
      label: 'Project',
      value: 'outside',
      selected: { label: 'Selected project', content: 'Selected project' },
      options: [],
      onChange() {},
      remote: { query: 'last project', loading: false, onQuery() {}, onRetry() {}, onMore() {} },
    }),
  )
  assert.match(html, /Selected project/)
  assert.match(html, /type="search"[^>]*value="last project"/)
  // A search inside a form must not read as a draft to the leave guard, which compares named fields.
  assert.doesNotMatch(html.match(/<input[^>]*type="search"[^>]*>/)[0], /\bname=/)
  assert.ok(html.indexOf('data-flow-choice-search') < html.indexOf('role="listbox"'))
  const closed = render({ query: 'private', loading: false, onQuery() {}, onRetry() {}, onMore() {} }, false)
  assert.doesNotMatch(closed, /type="search"|role="option"/)
})

test('remote tag pickers defer closed content, search through the consumer and keep selected chips', async () => {
  const { FlowTagPicker } = await import('../src/workspace.mjs')
  const queries = []
  const picker = (remote, open = true) =>
    FlowTagPicker({
      id: 'subjects',
      label: 'Teams',
      placeholder: 'Select a Team',
      value: ['kept'],
      options: [{ id: 'kept', title: 'Kept team' }],
      onChange() {},
      menu: { open, onToggle() {} },
      remote: { query: 'ops', total: 0, onQuery: (q) => queries.push(q), onRetry() {}, ...remote },
    })
  const closed = renderToStaticString(picker({ loading: true }, false))
  assert.match(closed, /Kept team/, 'a chosen Team stays visible while the menu is closed')
  assert.doesNotMatch(closed, /type="text"|role="status"|data-flow="tag-option"/)
  const loading = renderToStaticString(picker({ loading: true }))
  assert.match(loading, /type="text"[^>]*value="ops"/)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /role="status"/)
  assert.doesNotMatch(loading, /No available options/, 'a pending search is not an empty result')
  const failed = renderToStaticString(picker({ loading: false, error: 'Read failed' }))
  assert.match(failed, /role="alert">Read failed/)
  const empty = renderToStaticString(picker({ loading: false, total: 0 }))
  assert.match(empty, /No available options/)
  const more = renderToStaticString(picker({ loading: false, total: 30, onMore() {} }))
  assert.match(more, /More options/)
  assert.doesNotMatch(more, /No available options/)
  const view = picker({ loading: false, total: 1 })
  const search = (node) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(search).find(Boolean) ?? null
    if (!node.strings) return null
    for (let i = 0; i < node.values.length; i++)
      if (node.strings[i].endsWith('on:input=')) return node.values[i]
    return node.values.map(search).find(Boolean) ?? null
  }
  search(view)({ currentTarget: { value: 'platform' } })
  assert.deepEqual(queries, ['platform'], 'typing asks the consumer instead of hiding loaded rows')
})
