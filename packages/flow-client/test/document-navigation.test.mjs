import assert from 'node:assert/strict'
import test from 'node:test'
import { retainedDocumentSnapshot } from '../dist/document-navigation.mjs'
import { flowShellData } from '@ketvietlab/flow-client/shell-model.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

function navigation() {
  const fixture = createOrganizationSession('baseline', 'page')
  const data = fixture.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    workspaceId: 'product',
    projectId: 'core',
    route: 'page',
    recordId: 'handoff',
  }).value
  const current = { ready: true, screen: 'page', workspaceId: 'product', project: 'core' }
  const next = {
    serverShell: true,
    screen: 'page',
    companyId: 'demo',
    workspaceId: 'product',
    project: 'core',
    scope: 'project',
    record: 'page-core-overview',
    chrome: flowShellData(data),
  }
  return { data, current, next }
}

test('document selections retain the scoped snapshot while revalidating, including archive and creation', () => {
  const { data, current, next } = navigation()
  for (const screen of ['page', 'pages', 'page-archived', 'page-new', 'page-child']) {
    const snapshot = retainedDocumentSnapshot(data, current, { ...next, screen })
    assert.ok(snapshot, screen)
    assert.equal(snapshot.tasks, data.tasks)
    assert.deepEqual(snapshot.pages, data.pages)
    assert.equal(snapshot.pages.find((page) => page.id === 'handoff').title, 'Quy ước bàn giao')
  }
})

test('document snapshot is discarded at tenant, owner, access and surface boundaries', () => {
  const { data, current, next } = navigation()
  for (const patch of [
    { companyId: 'other' },
    { workspaceId: 'operations' },
    { project: 'ops' },
    { scope: 'workspace' },
    { screen: 'all-pages' },
    { screen: 'board' },
    { chrome: null },
    { chrome: { ...next.chrome, problem: { code: 'forbidden' } } },
    { chrome: { ...next.chrome, capabilities: { ...next.chrome.capabilities, write: false } } },
    { chrome: { ...next.chrome, user: { ...next.chrome.user, id: 'another-user' } } },
    { chrome: { ...next.chrome, grants: [] } },
  ])
    assert.equal(retainedDocumentSnapshot(data, current, { ...next, ...patch }), null)
  assert.equal(retainedDocumentSnapshot(data, { ...current, ready: false }, next), null)
  assert.equal(retainedDocumentSnapshot(data, { ...current, screen: 'all-pages' }, next), null)
})

test('new SSR authorization removes inaccessible documents before the next read completes', () => {
  const { data, current, next } = navigation()
  const snapshot = retainedDocumentSnapshot(data, current, {
    ...next,
    chrome: { ...next.chrome, pages: next.chrome.pages.filter((page) => page.id !== 'handoff') },
  })
  assert.ok(snapshot)
  assert.equal(
    snapshot.pages.some((page) => page.id === 'handoff'),
    false,
  )
  assert.equal(
    data.pages.some((page) => page.id === 'handoff'),
    true,
  )
})

test('SSR prop serialization key order cannot invalidate an unchanged document access identity', () => {
  const { data, current, next } = navigation()
  const wireChrome = JSON.parse(
    JSON.stringify(next.chrome, (_, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  )
  assert.ok(retainedDocumentSnapshot(data, current, { ...next, chrome: wireChrome }))
})
