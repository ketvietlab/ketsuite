import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('Atlas project options share the bounded native shape, filters and scope-fenced cursors', () => {
  const fixture = createOrganizationSession('baseline', 'projects')
  const call = (args) => fixture.call('flow.project.options', { companyId: 'demo', ...args }).value
  const all = fixture
    .call('flow.workspace.bootstrap', { companyId: 'demo', route: 'projects' })
    .value.projects.filter((p) => !p.archived)
  const first = call({ limit: 1 })
  assert.equal(first.total, all.length)
  assert.equal(first.items.length, 1)
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['code', 'id', 'title', 'workspaceId'])
  const ids = [first.items[0].id]
  let cursor = first.cursor
  while (cursor) {
    const page = call({ limit: 1, cursor })
    ids.push(...page.items.map((p) => p.id))
    cursor = page.cursor
  }
  assert.equal(new Set(ids).size, all.length)
  assert.equal(call({ limit: 51 }).errors[0].code, 'validation')
  assert.equal(call({ cursor: Buffer.from('null').toString('base64url') }).errors[0].code, 'validation')
  if (first.cursor) assert.equal(call({ cursor: first.cursor, query: 'changed' }).errors[0].code, 'conflict')
  assert.equal(
    call({ query: first.items[0].code }).items.some((p) => p.id === first.items[0].id),
    true,
  )
})
