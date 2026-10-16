import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appliesTo,
  incompatibleFieldValues,
  validateCustomFields,
} from '@ketvietlab/flow-client/custom-fields.mjs'
import { createFixtureSession } from '../atlas/store.mjs'

test('a project-owned field never applies outside its owner, even when its filter says all', () => {
  const field = { id: 'owned', projectId: 'core', appliesTo: 'all' }
  assert.equal(appliesTo(field, 'core'), true)
  assert.equal(appliesTo(field, 'ops'), false)
  assert.equal(appliesTo({ ...field, archived: true }, 'core'), false)
  assert.equal(appliesTo({ ...field, projectId: null }, 'ops'), true)
})

test('number and date values cannot pass through coercion or impossible calendar dates', () => {
  const number = [{ id: 'value', title: 'Value', kind: 'number' }]
  for (const value of [true, false, [], ['12'], {}, '   ', Infinity, 'Infinity'])
    assert.ok(validateCustomFields(number, { value }, 'core'), String(value))
  for (const value of [0, -12.5, '0', ' 12.5 '])
    assert.equal(validateCustomFields(number, { value }, 'core'), null)
  const date = [{ id: 'value', title: 'Date', kind: 'date' }]
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01', ['2026-01-01']])
    assert.ok(validateCustomFields(date, { value }, 'core'), String(value))
  for (const value of ['2024-02-29', '2026-02-28', '2026-12-31'])
    assert.equal(validateCustomFields(date, { value }, 'core'), null)
})

test('field compatibility includes existing and archived values but permits missing values until completion', () => {
  const field = { id: 'env', kind: 'number', appliesTo: 'core', required: true }
  const tasks = [
    { projectId: 'core', customFields: { env: 'Production' } },
    { projectId: 'core', archived: true, customFields: { env: 'Staging' } },
    { projectId: 'core', customFields: { env: '12' } },
    { projectId: 'core', customFields: {} },
    { projectId: 'ops', customFields: { env: 'Production' } },
  ]
  assert.equal(incompatibleFieldValues(field, tasks), 2)
  assert.equal(incompatibleFieldValues({ ...field, projectId: 'ops', appliesTo: 'all' }, tasks), 1)
})

test('changing a used field type or deleting a used option is refused without altering tasks or metadata', () => {
  const session = createFixtureSession()
  for (const task of session.data.tasks) task.customFields = {}
  const task = session.data.tasks.find((task) => task.projectId === 'core')
  task.customFields = { env: 'Production' }
  const field = session.data.fields.find((field) => field.id === 'env')
  const before = structuredClone(field)
  const save = (patch, key) =>
    session.call('flow.entity.save', {
      collection: 'fields',
      entityId: 'env',
      title: field.title,
      kind: 'select',
      options: 'Production\nStaging',
      appliesTo: 'all',
      required: 'false',
      idempotencyKey: key,
      ...patch,
    }).value
  const change = save({ kind: 'number' }, 'kind')
  assert.equal(change.ok, false)
  assert.ok(change.fields.kind)
  const remove = save({ options: 'Staging' }, 'option')
  assert.equal(remove.ok, false)
  assert.ok(remove.fields.options)
  assert.deepEqual(field, before)
  assert.equal(task.customFields.env, 'Production')
  assert.equal(save({ options: 'Production\nStaging\nPreview' }, 'extend').id, 'env')
  assert.deepEqual(field.options, ['Production', 'Staging', 'Preview'])
})

test('catalog edits preserve omitted ownership and reject owner/filter changes beyond that scope', () => {
  const session = createFixtureSession()
  const field = {
    id: 'project-field',
    title: 'Project field',
    kind: 'text',
    projectId: 'core',
    appliesTo: 'core',
  }
  session.data.fields.push(field)
  const save = (patch, key) =>
    session.call('flow.entity.save', {
      collection: 'fields',
      entityId: field.id,
      title: field.title,
      kind: 'text',
      appliesTo: 'core',
      required: 'false',
      idempotencyKey: key,
      ...patch,
    }).value
  assert.equal(save({}, 'retain').id, field.id)
  assert.equal(field.projectId, 'core')
  assert.equal(save({ projectId: 'ops' }, 'move').ok, false)
  assert.equal(save({ appliesTo: 'ops' }, 'filter').ok, false)
  assert.equal(save({ projectId: 'gone' }, 'gone').ok, false)
  assert.equal(field.projectId, 'core')
  assert.equal(field.appliesTo, 'core')
})

test('a metadata-only rename does not require unrelated legacy values to be migrated', () => {
  const session = createFixtureSession()
  const field = session.data.fields.find((field) => field.id === 'env')
  field.kind = 'number'
  field.options = []
  session.data.tasks[0].customFields = { env: 'legacy value' }
  const result = session.call('flow.entity.save', {
    collection: 'fields',
    entityId: 'env',
    title: 'Renamed field',
    kind: 'number',
    appliesTo: 'all',
    required: 'false',
    idempotencyKey: 'rename-only',
  }).value
  assert.equal(result.id, 'env')
  assert.equal(field.title, 'Renamed field')
  assert.equal(session.data.tasks[0].customFields.env, 'legacy value')
})
