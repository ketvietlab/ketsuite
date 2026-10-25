import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createOperationsState } from '../client/operations-state.mjs'
import { createOperations } from '../client/operations.mjs'
import { setFlowLocale } from '../client/i18n.mjs'

function click(node, label) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) {
      const handler = click(child, label)
      if (handler) return handler
    }
    return
  }
  if (node.items && node.render)
    return click(
      node.items.map((item, i) => node.render(item, i)),
      label,
    )
  if (!node.strings) return
  const index = node.strings.findIndex((part) => part.endsWith('on:click='))
  if (index >= 0 && node.strings[0].includes('<button') && renderToStaticString(node).includes(label))
    return node.values[index]
  return click(node.values, label)
}

test('calendar navigation reloads the displayed grid and incomplete pages do not claim no undated tasks', () => {
  setFlowLocale('en')
  let reloads = 0
  const data = { timezone: 'UTC', tasks: [], collectionPage: { cursor: 'next', total: 250 } }
  const operations = createOperations({
    data: () => data,
    filtered: () => [],
    filterbar: () => null,
    busy: () => false,
    reloadCalendar: () => reloads++,
  })
  const initial = operations.calendarWindow()
  assert.equal(new Date(initial.dueFrom).getUTCDay(), 1)
  assert.equal(new Date(initial.dueTo).getUTCDay(), 0)
  assert.equal(initial.includeUndated, true)
  assert.match(renderToStaticString(operations.view('calendar')), /250/)
  const next = click(operations.view('calendar'), 'Next')
  assert.equal(typeof next, 'function')
  next()
  assert.equal(reloads, 1)
  assert.ok(operations.calendarWindow().dueFrom > initial.dueFrom)
  const previous = click(operations.view('calendar'), 'Previous')
  previous()
  assert.equal(reloads, 2)
  assert.deepEqual(operations.calendarWindow(), initial)
})

test('calendar initially mounts three events per day and ten undated rows, expanding only on demand', () => {
  setFlowLocale('en')
  const tasks = Array.from({ length: 60 }, (_, i) => ({
    id: `ROW-${i}`,
    title: `Task ${i}`,
    status: 'todo',
    assigneeIds: [],
    dueDate: null,
  }))
  const data = { timezone: 'UTC', tasks, members: [], columns: [{ id: 'todo', label: 'Todo' }] }
  const operations = createOperations({
    data: () => data,
    filtered: () => tasks,
    filterbar: () => null,
    busy: () => false,
  })
  const range = operations.calendarWindow()
  tasks.slice(0, 20).forEach((task) => {
    task.dueDate = range.dueFrom
  })
  const first = renderToStaticString(operations.view('calendar'))
  assert.equal((first.match(/data-flow="calendar-event"/g) ?? []).length, 3)
  assert.match(first, /ROW-29/)
  assert.doesNotMatch(first, /ROW-30|ROW-19/)
  click(operations.view('calendar'), '17 remaining')()
  const expanded = renderToStaticString(operations.view('calendar'))
  assert.equal((expanded.match(/data-flow="calendar-event"/g) ?? []).length, 13)
  click(operations.view('calendar'), 'Collapse')()
  assert.equal(
    (renderToStaticString(operations.view('calendar')).match(/data-flow="calendar-event"/g) ?? []).length,
    3,
  )
})

test('lazy calendar and inbox controls share the read state and reset on a scope switch', () => {
  setFlowLocale('en')
  const data = { timezone: 'Pacific/Kiritimati', tasks: [], members: [] }
  const state = createOperationsState(() => data)
  state.date.set('2028-02-29')
  state.scale.set('week')
  state.inboxTab.set('all')
  const requested = state.calendarWindow()
  const operations = createOperations({
    state,
    data: () => data,
    filtered: () => [],
    filterbar: () => null,
    busy: () => false,
  })
  assert.deepEqual(operations.calendarWindow(), requested)
  assert.equal(operations.inboxFilter(), 'all')
  click(operations.view('calendar'), 'Next')()
  assert.equal(state.calendarWindow().dueFrom, '2028-03-06')
  assert.deepEqual(operations.calendarWindow(), state.calendarWindow())
  operations.reset()
  assert.equal(state.date(), '')
  assert.equal(state.inboxTab(), 'unread')
  assert.deepEqual(state.calendarLimits(), {})
})
