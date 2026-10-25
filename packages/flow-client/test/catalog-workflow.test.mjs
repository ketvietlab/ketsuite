import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixtureSession } from '../atlas/store.mjs'

const save = (fixture, input, key = 'save') =>
  fixture.call('flow.entity.save', { ...input, idempotencyKey: key }).value

test('status rename preserves its group when omitted and never changes task identity or versions', () => {
  const f = createFixtureSession()
  const tasks = structuredClone(f.data.tasks)
  const result = save(f, { collection: 'columns', entityId: 'progress', title: 'Doing' })
  assert.equal(result.id, 'progress')
  const column = f.data.columns.find((column) => column.id === 'progress')
  assert.equal(column.kind, 'progress')
  assert.equal(column.label, 'Doing')
  assert.equal(column.labelKey, undefined)
  assert.deepEqual(f.data.tasks, tasks)
})

test('status group changes refuse used statuses, including archived task references', () => {
  const f = createFixtureSession()
  for (const task of f.data.tasks) task.archived = true
  const result = save(f, { collection: 'columns', entityId: 'progress', title: 'Doing', kind: 'done' })
  assert.equal(result.ok, false)
  assert.ok(result.fields.kind)
  assert.equal(f.data.columns.find((column) => column.id === 'progress').kind, 'progress')
})

test('unused status reclassification retains every required group and accepts a safe replacement', () => {
  const f = createFixtureSession()
  f.data.tasks = []
  const input = { collection: 'columns', entityId: 'progress', title: 'Completed', kind: 'done' }
  assert.equal(save(f, input, 'last-progress').ok, false)
  assert.match(
    save(f, { collection: 'columns', title: 'Alternate progress', kind: 'progress' }, 'replacement').id,
    /^columns-/,
  )
  assert.equal(save(f, input, 'safe-reclassify').id, 'progress')
  assert.equal(f.data.columns.find((column) => column.id === 'progress').kind, 'done')
})

test('catalog enums reject unsupported status groups and icons while omitted type icon is preserved', () => {
  const f = createFixtureSession()
  for (const kind of ['unexpected', 4, {}]) {
    const result = save(
      f,
      { collection: 'columns', title: 'New status', kind },
      `kind-${JSON.stringify(kind)}`,
    )
    assert.equal(result.ok, false)
    assert.ok(result.fields.kind)
  }
  assert.equal(
    save(f, { collection: 'types', entityId: 'bug', title: 'Defect', icon: 'flag' }, 'type-icon').id,
    'bug',
  )
  assert.equal(save(f, { collection: 'types', entityId: 'bug', title: 'Issue' }, 'type-rename').id, 'bug')
  assert.equal(f.data.types.find((type) => type.id === 'bug').icon, 'flag')
  const invalid = save(
    f,
    { collection: 'types', entityId: 'bug', title: 'Issue', icon: 'unsupported' },
    'invalid-icon',
  )
  assert.equal(invalid.ok, false)
  assert.ok(invalid.fields.icon)
  assert.equal(f.data.types.find((type) => type.id === 'bug').icon, 'flag')
})

test('catalog names are unique within an owner and domain, without blocking names in another project', () => {
  const f = createFixtureSession()
  const duplicate = save(f, { collection: 'types', title: ' story ', icon: 'list' }, 'duplicate')
  assert.equal(duplicate.ok, false)
  assert.ok(duplicate.fields.title)
  assert.equal(
    typeof save(f, { collection: 'types', projectId: 'core', title: 'Story', icon: 'list' }, 'own-type').id,
    'string',
  )
  f.data.tags.push({ id: 'project-tech', projectId: 'core', title: f.data.tags[0].title, color: 'blue' })
  assert.equal(
    save(
      f,
      { collection: 'tags', entityId: 'project-tech', title: f.data.tags[0].title, color: 'green' },
      'own-label',
    ).id,
    'project-tech',
  )
})

test('malformed catalog titles return field errors instead of throwing or storing coerced values', () => {
  const f = createFixtureSession()
  for (const collection of ['columns', 'types', 'fields', 'tags']) {
    for (const title of [null, [], {}, true, 1]) {
      const result = save(f, { collection, title, kind: 'text' }, `${collection}-${JSON.stringify(title)}`)
      assert.equal(result.ok, false)
      assert.ok(result.fields.title)
    }
  }
})
