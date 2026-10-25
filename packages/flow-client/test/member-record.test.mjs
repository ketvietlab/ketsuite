import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('direct member editor reads its target beyond the initial directory page', async () => {
  const fixture = createOrganizationSession()
  const data = fixture.sessions.get('demo').data
  for (let i = 0; i < 105; i++)
    data.members.push({
      id: `extra-${i}`,
      name: `A person ${i}`,
      email: `extra-${i}@example.test`,
      role: 'member',
      status: 'active',
      version: 1,
    })
  data.members.push({
    id: 'outside-member',
    name: 'ZZZ outside directory',
    email: 'outside@example.test',
    role: 'member',
    status: 'active',
    version: 1,
  })
  const oldWindow = globalThis.window,
    oldObserver = globalThis.MutationObserver
  globalThis.window = new EventTarget()
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  let bootstrap
  const island = createFlowWorkspace(
    { screen: 'member-edit', record: 'outside-member' },
    {
      call: createFnClient({
        fetch: async (url, request) => {
          const name = decodeURIComponent(url.split('/').pop()),
            input = JSON.parse(request.body)
          if (name === 'flow.workspace.bootstrap') bootstrap = input
          return new Response(JSON.stringify(fixture.call(name, input)), {
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
    assert.equal(bootstrap.recordId, 'outside-member')
    const output = renderToStaticString(island.view())
    assert.match(output, /outside@example\.test/)
    assert.match(output, /ZZZ outside directory/)
  } finally {
    lifetime.abort()
    island.dispose()
    globalThis.window = oldWindow
    globalThis.MutationObserver = oldObserver
  }
})
