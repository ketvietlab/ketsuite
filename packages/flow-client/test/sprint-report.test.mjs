import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

const fixture = () => {
  const session = createOrganizationSession(),
    d = session.sessions.get('demo').data
  const sprint = d.sprints.find((s) => s.projectId === 'core')
  Object.assign(sprint, {
    state: 'closed',
    version: 3,
    report: {
      closedAt: '2026-10-13T00:00:00Z',
      committedPoints: 150,
      completed: 75,
      carried: 0,
      carryTo: 'Backlog',
      tasks: Array.from({ length: 75 }, (_, i) => ({
        id: 'SAVED-' + i,
        title: 'Historical title ' + i,
        points: 2,
        status: 'done',
      })),
      taskIds: Array.from({ length: 75 }, (_, i) => 'SAVED-' + i),
    },
  })
  return { session, sprint }
}

test('closed reports use fenced bounded historical reads and bootstrap has no report bodies', () => {
  const { session, sprint } = fixture()
  const bootstrap = session.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    route: 'sprint-report',
    projectId: sprint.projectId,
    recordId: sprint.id,
  }).value
  assert.ok(bootstrap.sprints.every((s) => !s.report && !s.closeReport))
  const read = (extra = {}) =>
    session.call('flow.sprint.report', {
      companyId: 'demo',
      id: sprint.id,
      projectId: sprint.projectId,
      ...extra,
    }).value
  const first = read()
  assert.equal(first.tasks.length, 10)
  assert.equal(first.total, 75)
  assert.equal(first.report.tasks, undefined)
  assert.equal(first.report.taskIds, undefined)
  let cursor,
    tasks = []
  do {
    const page = read({ cursor })
    tasks.push(...page.tasks)
    cursor = page.cursor
  } while (cursor)
  assert.equal(new Set(tasks.map((t) => t.id)).size, 75)
  assert.deepEqual(tasks, sprint.report.tasks)
  sprint.version++
  assert.equal(read({ cursor: first.cursor }).errors[0].code, 'conflict')
  assert.equal(read({ limit: 51 }).errors[0].code, 'validation')
  assert.equal(read({ cursor: Buffer.from('null').toString('base64url') }).errors[0].code, 'validation')
})

test('report route fetches its record separately and renders only its first historical page', async () => {
  setFlowLocale('en')
  const { session, sprint } = fixture(),
    calls = []
  const oldWindow = globalThis.window,
    oldObserver = globalThis.MutationObserver
  globalThis.window = new EventTarget()
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  const island = createFlowWorkspace(
    { screen: 'sprint-report', project: sprint.projectId, record: sprint.id },
    {
      call: createFnClient({
        fetch: async (url, request) => {
          const name = decodeURIComponent(url.split('/').pop()),
            input = JSON.parse(request.body)
          calls.push({ name, input })
          return new Response(JSON.stringify(session.call(name, input)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      }),
    },
  )
  const lifetime = new AbortController()
  const root = Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    querySelector: () => null,
    querySelectorAll: () => [],
  })
  try {
    island.mount({ root, lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(calls.find((c) => c.name === 'flow.workspace.bootstrap').input.recordId, sprint.id)
    assert.equal(calls.filter((c) => c.name === 'flow.sprint.report').length, 1)
    const html = renderToStaticString(island.view())
    assert.match(html, /Historical title 9/)
    assert.doesNotMatch(html, /Historical title 10|This sprint is still open/)
    assert.match(html, /Showing 10 of 75/)
  } finally {
    lifetime.abort()
    island.dispose()
    globalThis.window = oldWindow
    globalThis.MutationObserver = oldObserver
  }
})
