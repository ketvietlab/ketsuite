import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { accessFor, canManageScope } from '@ketvietlab/flow-client/access-model.mjs'

const command = (session, action, input = {}, key = crypto.randomUUID()) =>
  session.call('flow.organization.command', {
    companyId: 'demo',
    expectedRevision: session.sessions.get('demo').data.organizationRevision,
    action,
    idempotencyKey: key,
    ...input,
  }).value

test('Team removal can clean up revoked members, while additions and archived targets remain guarded', () => {
  const fixture = createOrganizationSession(),
    data = fixture.sessions.get('demo').data
  data.members.find((member) => member.id === 'bao').status = 'revoked'
  assert.equal(
    command(fixture, 'team.member', { id: 'engineering', memberId: 'bao' }).errors[0].code,
    'validation',
  )
  assert.equal(
    command(fixture, 'team.member', { id: 'engineering', memberId: 'bao', remove: 'false' }).errors[0].code,
    'validation',
  )
  assert.equal(
    command(fixture, 'team.member', { id: 'engineering', memberId: 'bao', remove: true }).errors,
    undefined,
  )
  assert.equal(data.teams.find((team) => team.id === 'engineering').memberIds.includes('bao'), false)
  data.teams.find((team) => team.id === 'engineering').archived = true
  const before = structuredClone(data.teams),
    revision = data.organizationRevision
  assert.equal(
    command(fixture, 'team.member', { id: 'engineering', memberId: 'mai', remove: true }).errors[0].code,
    'validation',
  )
  assert.deepEqual(data.teams, before)
  assert.equal(data.organizationRevision, revision)
})

test('access grants refuse archived destinations and Teams without replacing existing grants', () => {
  const fixture = createOrganizationSession(),
    data = fixture.sessions.get('demo').data
  for (const [collection, targetId, subjectType, subjectId] of [
    ['projects', 'core', 'user', 'bao'],
    ['workspaces', 'product', 'user', 'bao'],
    ['teams', 'engineering', 'team', 'engineering'],
  ]) {
    const record = data[collection].find((record) => record.id === targetId)
    record.archived = true
    const before = structuredClone(data.grants),
      revision = data.organizationRevision
    const result = command(fixture, 'access.grant', {
      scope: collection === 'workspaces' ? 'workspace' : 'project',
      targetId: collection === 'teams' ? 'core' : targetId,
      subjectType,
      subjectId,
      role: 'viewer',
    })
    assert.equal(result.errors[0].code, 'validation')
    assert.deepEqual(data.grants, before)
    assert.equal(data.organizationRevision, revision)
    record.archived = false
  }
})

test('archived Teams cannot contribute read or administration rights; independent direct grants survive', () => {
  const fixture = createOrganizationSession('member'),
    data = fixture.sessions.get('demo').data
  const project = data.projects.find((project) => project.id === 'core')
  data.grants.find((grant) => grant.id === 'g1').role = 'admin'
  assert.equal(canManageScope(data, 'workspace', 'product', 'bao'), true)
  assert.ok(accessFor(data, project, 'bao').role)
  data.teams.find((team) => team.id === 'engineering').archived = true
  assert.equal(canManageScope(data, 'workspace', 'product', 'bao'), false)
  assert.equal(accessFor(data, project, 'bao').role, null)
  const denied = fixture.call('flow.workspace.bootstrap', { companyId: 'demo', workspaceId: 'product' }).value
  assert.equal(denied.ok, false)
  data.grants.push({
    id: 'direct-bao',
    scope: 'project',
    targetId: 'core',
    subjectType: 'user',
    subjectId: 'bao',
    role: 'viewer',
  })
  assert.equal(accessFor(data, project, 'bao').role, 'viewer')
  const allowed = fixture.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    workspaceId: 'product',
  }).value
  assert.deepEqual(
    allowed.projects.map((project) => project.id),
    ['core'],
  )
})

test('role changes preserve revoked membership and only explicit boolean restoration reactivates it', () => {
  const fixture = createOrganizationSession(),
    data = fixture.sessions.get('demo').data
  const member = data.members.find((member) => member.id === 'bao'),
    tasks = structuredClone(data.tasks)
  command(fixture, 'member.update', { id: 'bao', role: 'member', revoke: true })
  assert.equal(member.status, 'revoked')
  command(fixture, 'member.update', { id: 'bao', role: 'admin' })
  assert.equal(member.role, 'admin')
  assert.equal(member.status, 'revoked')
  assert.equal(canManageScope(data, 'company', 'demo', 'bao'), false)
  const revision = data.organizationRevision
  assert.equal(
    command(fixture, 'member.update', { id: 'bao', role: 'member', revoke: 'false' }).errors[0].code,
    'validation',
  )
  assert.equal(member.role, 'admin')
  assert.equal(data.organizationRevision, revision)
  command(fixture, 'member.update', { id: 'bao', role: 'admin', revoke: false })
  assert.equal(member.status, 'active')
  assert.equal(canManageScope(data, 'company', 'demo', 'bao'), true)
  assert.deepEqual(data.tasks, tasks)
})

test('explicit missing, foreign and archived organization record IDs never create replacements', () => {
  const f = createOrganizationSession(),
    d = f.sessions.get('demo').data
  for (const [action, collection, archived] of [
    ['team.save', 'teams', 'engineering'],
    ['workspace.save', 'workspaces', 'lab'],
  ]) {
    d[collection].find((record) => record.id === archived).archived = true
    for (const id of ['missing', `north-${archived}`, archived]) {
      const before = structuredClone(d[collection]),
        revision = d.organizationRevision
      assert.equal(command(f, action, { id, title: 'Replacement' }).errors[0].code, 'notFound')
      assert.deepEqual(d[collection], before)
      assert.equal(d.organizationRevision, revision)
    }
  }
})

test('renaming a Workspace or Team preserves omitted description, access and membership', () => {
  const f = createOrganizationSession(),
    d = f.sessions.get('demo').data
  for (const [action, collection, id] of [
    ['workspace.save', 'workspaces', 'operations'],
    ['team.save', 'teams', 'engineering'],
  ]) {
    const record = d[collection].find((record) => record.id === id),
      before = structuredClone(record)
    assert.equal(command(f, action, { id, title: 'Renamed' }).id, id)
    assert.equal(record.title, 'Renamed')
    assert.equal(record.description, before.description)
    assert.equal(record.access, before.access ?? 'private')
    assert.deepEqual(record.memberIds, before.memberIds)
  }
})

test('malformed names, descriptions and workspace access return validation before mutation', () => {
  const f = createOrganizationSession(),
    d = f.sessions.get('demo').data
  for (const action of ['workspace.save', 'team.save', 'company.save']) {
    for (const title of [null, {}, [], true, 4]) {
      const before = structuredClone(d)
      const result = command(f, action, { title })
      assert.equal(result.ok, false)
      assert.ok(result.fields.title)
      assert.deepEqual(d, before)
    }
  }
  for (const input of [
    { title: 'Valid', description: {} },
    { title: 'Valid', access: 'public' },
  ]) {
    const before = structuredClone(d)
    assert.equal(command(f, 'workspace.save', input).ok, false)
    assert.deepEqual(d, before)
  }
})

test('creation without an ID and its replay create exactly one record', () => {
  const f = createOrganizationSession(),
    d = f.sessions.get('demo').data
  for (const [action, collection] of [
    ['workspace.save', 'workspaces'],
    ['team.save', 'teams'],
  ]) {
    const count = d[collection].length,
      revision = d.organizationRevision
    const result = command(f, action, { title: 'New record' }, action)
    assert.ok(result.id)
    assert.equal(d[collection].length, count + 1)
    assert.equal(d.organizationRevision, revision + 1)
    assert.deepEqual(command(f, action, { title: 'New record' }, action), result)
    assert.equal(d[collection].length, count + 1)
    assert.equal(d.organizationRevision, revision + 1)
  }
})

test('Workspace administration does not grant organization-wide creation rights', () => {
  const f = createOrganizationSession('member'),
    d = f.sessions.get('demo').data
  d.grants = [
    {
      id: 'manage-product',
      scope: 'workspace',
      targetId: 'product',
      subjectType: 'user',
      subjectId: 'bao',
      role: 'admin',
    },
  ]
  assert.equal(command(f, 'workspace.save', { title: 'New workspace' }).errors[0].code, 'forbidden')
  assert.equal(command(f, 'workspace.save', { id: 'product', title: 'Managed product' }).id, 'product')
})
