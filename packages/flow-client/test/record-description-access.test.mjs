import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canManageScope } from '../dist/access-model.mjs'

test('project descriptions inherit Workspace admin only through an active shared project', () => {
  const data = {
    company: { id: 'c' },
    user: { id: 'u' },
    members: [{ id: 'u', role: 'member', status: 'active' }],
    teams: [],
    workspaces: [{ id: 'w', companyId: 'c', access: 'restricted' }],
    projects: [{ id: 'p', companyId: 'c', workspaceId: 'w', access: 'workspace' }],
    grants: [{ scope: 'workspace', targetId: 'w', role: 'admin', subjectType: 'user', subjectId: 'u' }],
  }
  assert.equal(canManageScope(data, 'project', 'p'), true)
  data.grants[0].role = 'editor'
  assert.equal(canManageScope(data, 'project', 'p'), false)
  data.grants[0].role = 'admin'
  data.projects[0].access = 'restricted'
  assert.equal(canManageScope(data, 'project', 'p'), false)
  data.projects[0].access = 'workspace'
  data.members[0].role = 'guest'
  assert.equal(canManageScope(data, 'project', 'p'), false)
  data.members[0].role = 'member'
  data.members[0].status = 'suspended'
  assert.equal(canManageScope(data, 'project', 'p'), false)
})
