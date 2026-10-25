import test from 'node:test'
import assert from 'node:assert/strict'
import { taskTags, taskFields, taskTypeDefinition } from '../client/project-catalogs.mjs'

test('task detail uses its own project definitions beyond the bootstrap catalog window', () => {
  const data = { projects: [], tags: [{ id: 'other', title: 'Other' }], fields: [{ id: 'other' }], types: [] }
  const task = {
    projectId: 'p',
    typeId: 'custom',
    type: 'code',
    typeDefinition: { id: 'custom', code: 'code', title: 'Custom type' },
    tags: ['archived'],
    tagDefinitions: [{ id: 'archived', title: 'Still readable', archived: true }],
    catalogs: {
      projectId: 'p',
      tags: [{ id: 'available', title: 'Available' }],
      fields: [{ id: 'required', required: true }],
    },
  }
  assert.deepEqual(
    taskTags(data, 'p', task).map((t) => t.id),
    ['available', 'archived'],
  )
  assert.equal(taskTags(data, 'p', task)[1].archived, true)
  assert.equal(taskFields(data, task)[0].id, 'required')
  assert.equal(taskTypeDefinition(data, task).title, 'Custom type')
  assert.deepEqual(taskTags(data, 'other', task), data.tags)
  assert.deepEqual(taskFields(data, { ...task, projectId: 'other' }), data.fields)
  assert.equal(taskTypeDefinition(data, { ...task, typeId: 'new', type: 'new' }), undefined)
  assert.equal(taskTypeDefinition(data, { ...task, type: 'new' }), undefined)
  assert.equal(
    taskTags(data, 'p', { ...task, tags: [] }).some((t) => t.id === 'archived'),
    false,
  )
})

test('unselected project forms use the bootstrap catalog without a task snapshot', () => {
  const data = { projects: [], tags: [{ id: 'company-label' }], fields: [{ id: 'company-field' }] }
  assert.deepEqual(taskTags(data, undefined), data.tags)
  assert.equal(taskFields(data), data.fields)
  assert.equal(taskFields(data, {}), data.fields)
})
