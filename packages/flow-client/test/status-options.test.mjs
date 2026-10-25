import test from 'node:test'
import assert from 'node:assert/strict'
import { createStatusOptions } from '../client/status-options.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { taskStatusDefinition, statusKind } from '@ketvietlab/flow-client/project-catalogs.mjs'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
test('current status snapshots describe omitted definitions without overriding an optimistic move', () => {
  const old = { id: 'old', label: 'Previous', kind: 'todo' },
    next = { id: 'next', label: 'Finished', kind: 'done' }
  assert.equal(taskStatusDefinition({ columns: [] }, { status: 'old', statusDefinition: old }), old)
  assert.equal(taskStatusDefinition({ columns: [next] }, { status: 'next', statusDefinition: old }), next)
  assert.equal(statusKind({ columns: [next] }, { status: 'next', statusDefinition: old }), 'done')
  assert.equal(taskStatusDefinition({}, undefined), undefined)
})
test('status choices ignore stale project, closed menu and former Company responses', async () => {
  const calls = []
  let company = 'one'
  const picker = createStatusOptions({
    companyId: () => company,
    call: (name, input, options) => new Promise((resolve) => calls.push({ name, input, options, resolve })),
  })
  picker.open('first', 'p1')
  picker.open('second', 'p2')
  assert.equal(calls[0].options.signal.aborted, true)
  assert.equal(calls[1].name, 'flow.project.statusOptions')
  calls[0].resolve({ items: [{ id: 'wrong' }] })
  await tick()
  assert.deepEqual(picker.state().items, [])
  calls[1].resolve({ items: [{ id: 'right' }] })
  await tick()
  assert.equal(picker.state().items[0].id, 'right')
  picker.open('third', 'p3')
  company = 'two'
  calls[2].resolve({ items: [{ id: 'old-company' }] })
  await tick()
  assert.deepEqual(picker.state().items, [])
  picker.open('fourth', 'p4')
  picker.close('third')
  assert.equal(picker.state().id, 'fourth')
  picker.close('fourth')
  calls[3].resolve({ items: [{ id: 'closed' }] })
  await tick()
  assert.equal(picker.state().id, '')
  assert.deepEqual(picker.state().items, [])
  picker.dispose()
})
test('status option failures expose retry and revocation clears choices once', async () => {
  let count = 0,
    refused = 0
  const picker = createStatusOptions({
    companyId: () => 'one',
    onRefusal: () => refused++,
    call: async () => {
      if (count++ === 0) throw new Error('Offline')
      if (count === 3) throw Object.assign(new Error('Removed'), { code: 'forbidden' })
      return { items: [{ id: 'todo' }] }
    },
  })
  picker.open('field', 'project')
  await tick()
  assert.equal(picker.state().error, 'Offline')
  await picker.retry()
  assert.equal(picker.state().items[0].id, 'todo')
  await picker.retry()
  assert.equal(refused, 1)
  assert.deepEqual(picker.state().items, [])
  picker.dispose()
})
test('Atlas status options use the authorized project catalog', () => {
  const owner = createOrganizationSession()
  const result = owner.call('flow.project.statusOptions', { companyId: 'demo', projectId: 'core' }).value
  assert.ok(result.items.length >= 4)
  assert.ok(result.items.every((item) => item.id && item.label && item.kind))
  const guest = createOrganizationSession('guest')
  assert.equal(
    guest.call('flow.project.statusOptions', { companyId: 'demo', projectId: 'core' }).value.errors[0].code,
    'forbidden',
  )
})
