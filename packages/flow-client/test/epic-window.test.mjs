import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { registerFlowExtension } from '@ketvietlab/flow-client/extensions.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

const fixture = () => {
  const session = createOrganizationSession(),
    data = session.sessions.get('demo').data
  const epic = data.epics.find((e) => e.projectId === 'core')
  const template = data.tasks.find((t) => t.projectId === 'core')
  data.tasks = Array.from({ length: 52 }, (_, i) => ({
    ...structuredClone(template),
    id: 'EP-' + i,
    key: 'EP-' + i,
    title: 'Epic window task ' + i,
    epic: epic.id,
    order: i,
    archived: false,
    type: i >= 40 ? 'milestone' : 'task',
  }))
  return { session, epic }
}

test('Epic and milestone filters count and page their entire scoped collection', () => {
  const { session, epic } = fixture()
  for (const milestonesOnly of [false, true]) {
    let cursor,
      rows = []
    do {
      const page = session.call('flow.issue.list', {
        companyId: 'demo',
        projectId: 'core',
        epicId: epic.id,
        milestonesOnly,
        cursor,
        limit: 10,
      }).value
      assert.equal(page.total, milestonesOnly ? 12 : 52)
      rows.push(...page.tasks)
      cursor = page.cursor
      if (cursor)
        assert.equal(
          session.call('flow.issue.list', {
            companyId: 'demo',
            projectId: 'core',
            epicId: epic.id,
            milestonesOnly: !milestonesOnly,
            cursor,
            limit: 10,
          }).value.errors[0].code,
          'conflict',
        )
    } while (cursor)
    assert.equal(new Set(rows.map((t) => t.id)).size, milestonesOnly ? 12 : 52)
    assert.ok(rows.every((t) => t.epic === epic.id && (!milestonesOnly || t.type === 'milestone')))
  }
  assert.equal(
    session.call('flow.issue.list', { companyId: 'demo', projectId: 'core', milestonesOnly: true }).value
      .errors[0].code,
    'validation',
  )
})

test('Epic detail loads tasks and milestones independently even when bootstrap has no tasks', async () => {
  setFlowLocale('en')
  registerFlowExtension({
    name: 'installed-goals-without-epic-projection',
    routes: { goals: { title: 'Goals', pattern: 'workspace' } },
    create: () => ({}),
  })
  const { session, epic } = fixture(),
    calls = []
  const oldWindow = globalThis.window,
    oldObserver = globalThis.MutationObserver
  globalThis.window = new EventTarget()
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  const island = createFlowWorkspace(
    { screen: 'epic', project: 'core', record: epic.id },
    {
      call: createFnClient({
        fetch: async (url, request) => {
          const name = decodeURIComponent(url.split('/').pop()),
            input = JSON.parse(request.body)
          calls.push({ name, input })
          const response = session.call(name, input)
          if (name === 'flow.workspace.bootstrap') {
            response.value.tasks = []
            delete response.value.goals
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
    assert.equal(calls.find((c) => c.name === 'flow.workspace.bootstrap').input.recordId, epic.id)
    assert.equal(calls.filter((c) => c.name === 'flow.issue.list' && c.input.epicId === epic.id).length, 2)
    const html = renderToStaticString(island.view())
    assert.match(html, /Showing 10 of 52/)
    assert.match(html, /Showing 10 of 12/)
    assert.match(html, /Epic window task 40/)
    assert.doesNotMatch(html, /name="epic-goal"/)
  } finally {
    lifetime.abort()
    island.dispose()
    globalThis.window = oldWindow
    globalThis.MutationObserver = oldObserver
  }
})
