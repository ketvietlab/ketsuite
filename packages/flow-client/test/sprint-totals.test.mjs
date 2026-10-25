import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { statusKind } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('Atlas sprint totals count the authorized active collection, not the task window', () => {
  const fixture = createOrganizationSession()
  const data = fixture.call('flow.workspace.bootstrap', { companyId: 'demo', route: 'sprints' }).value
  for (const sprint of data.sprints) {
    const tasks = data.tasks.filter(
      (t) => !t.archived && t.projectId === sprint.projectId && t.sprint === sprint.title,
    )
    const pending = tasks.filter((t) => statusKind(data, t) !== 'done')
    assert.deepEqual(sprint.taskTotals, {
      total: tasks.length,
      done: tasks.length - pending.length,
      points: tasks.reduce((n, t) => n + Number(t.points ?? 0), 0),
      pending: pending.length,
      pendingPoints: pending.reduce((n, t) => n + Number(t.points ?? 0), 0),
    })
    let cursor,
      rows = []
    do {
      const page = fixture.call('flow.issue.list', {
        companyId: 'demo',
        projectId: sprint.projectId,
        sprintId: sprint.id,
        unfinishedOnly: true,
        cursor,
        limit: 2,
      }).value
      assert.equal(page.total, pending.length)
      rows.push(...page.tasks)
      cursor = page.cursor
      if (cursor)
        assert.equal(
          fixture.call('flow.issue.list', {
            companyId: 'demo',
            projectId: sprint.projectId,
            backlog: true,
            cursor,
          }).value.errors[0].code,
          'conflict',
        )
    } while (cursor)
    assert.equal(new Set(rows.map((t) => t.id)).size, pending.length)
  }
})

test('sprint list and close confirmation use authoritative totals outside their preview', async () => {
  setFlowLocale('en')
  const fixture = createOrganizationSession()
  const active = fixture.sessions.get('demo').data.sprints.find((s) => s.state === 'active')
  assert.ok(active)
  const oldWindow = globalThis.window,
    oldObserver = globalThis.MutationObserver
  globalThis.window = new EventTarget()
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  try {
    for (const screen of ['sprints', 'sprint-close']) {
      const island = createFlowWorkspace(
        { screen, project: active.projectId, record: active.id },
        {
          call: createFnClient({
            fetch: async (url, request) => {
              const name = decodeURIComponent(url.split('/').pop()),
                input = JSON.parse(request.body)
              const response = fixture.call(name, input)
              if (name === 'flow.workspace.bootstrap') {
                response.value.tasks = []
                response.value.sprints.find((s) => s.id === active.id).taskTotals = {
                  total: 52,
                  done: 1,
                  points: 130,
                  pending: 51,
                  pendingPoints: 127.5,
                }
              }
              return new Response(JSON.stringify(response), {
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
        const output = renderToStaticString(island.view())
        assert.match(output, screen === 'sprints' ? /130.*1.*52/ : /51.*127\.5/)
      } finally {
        lifetime.abort()
        island.dispose()
      }
    }
  } finally {
    globalThis.window = oldWindow
    globalThis.MutationObserver = oldObserver
  }
})
