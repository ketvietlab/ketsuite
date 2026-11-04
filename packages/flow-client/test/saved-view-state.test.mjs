import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareFlowCommand } from '../client/command-contract.mjs'
import { savedViewDestination } from '../client/saved-view-state.mjs'

test('saved My Work views preserve route, filtering, sort and grouping across entry points', () => {
  assert.deepEqual(
    savedViewDestination({
      id: 'v',
      sourceRoute: 'my-work',
      query: 'review',
      status: 'open',
      sort: 'priority',
      group: 'none',
    }),
    {
      route: 'my-work',
      params: { project: '', view: 'v', q: 'review', status: 'open', sort: 'priority', group: 'none' },
    },
  )
})

test('project views keep workspace context and reject arbitrary stored destinations', () => {
  const view = {
    id: 'v',
    projectId: 'p',
    workspaceId: 'w',
    sourceRoute: 'board',
    query: 'review',
    status: 'all',
  }
  assert.equal(savedViewDestination(view).route, 'board')
  assert.deepEqual(savedViewDestination({ ...view, sourceRoute: 'organization-settings' }), {
    route: 'project-issues',
    params: { project: 'p', workspace: 'w', view: 'v', q: 'review', status: 'all' },
  })
  assert.equal(savedViewDestination({ id: 'old', projectId: 'p' }).route, 'project-issues')
})

test('native saved view commands capture the operations revision and owner record version', () => {
  const data = { operationsRevision: 8, organizationRevision: 99, views: [{ id: 'v', version: 3 }] }
  for (const name of ['flow.view.save', 'flow.view.archive', 'flow.view.restore'])
    assert.deepEqual(prepareFlowCommand(name, { id: 'v' }, data), {
      id: 'v',
      expectedRevision: 8,
      expectedVersion: 3,
    })
  assert.equal(prepareFlowCommand('flow.view.save', { expectedRevision: 7 }, data).expectedRevision, 7)
})
