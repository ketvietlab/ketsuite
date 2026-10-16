import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocuments } from '@ketvietlab/flow-client/documents.mjs'

function harness({ write = true, failSave = false, holdSave = false } = {}) {
  let data = {
    company: { id: 'a' },
    pages: [{ id: 'doc', title: 'A document', version: 1, projectId: null, access: { write } }],
  }
  let confirmation, release
  const calls = [],
    navigations = []
  const documents = createDocuments({
    data: () => data,
    canWrite: () => write,
    screen: () => 'page',
    record: () => 'doc',
    project: () => null,
    workspaceId: () => '',
    confirmAction: (request) => {
      confirmation = request
      return true
    },
    navigate: (...args) => navigations.push(args),
    mutate: async (name, input, accepted) => {
      calls.push({ name, input })
      if (name === 'flow.entity.save') {
        if (holdSave)
          await new Promise((resolve) => {
            release = resolve
          })
        if (failSave) {
          failSave = false
          return false
        }
      }
      accepted?.({ id: input.entityId })
      return true
    },
  })
  return {
    documents,
    calls,
    navigations,
    confirmation: () => confirmation,
    switchCompany: () => {
      data = { ...data, company: { id: 'b' } }
    },
    release: () => release(),
  }
}
const edit = (documents) =>
  documents.edit('doc', {
    snapshot: 'edited',
    blocks: [{ id: 'body', type: 'p', delta: [{ insert: 'Keep this draft' }] }],
  })

test('document archive requests confirmation without writing and read-only documents cannot request it', () => {
  const h = harness()
  assert.equal(h.documents.requestArchive('doc'), true)
  assert.ok(h.confirmation())
  assert.equal(h.calls.length, 0)
  assert.equal(h.navigations.length, 0)
  assert.equal(h.documents.requestArchive('missing'), false)
  assert.equal(harness({ write: false }).documents.requestArchive('doc'), false)
  h.documents.dispose()
})

test('archive saves a dirty legacy document first, coalesces repeated confirmation and opens Archive after acceptance', async () => {
  const h = harness({ holdSave: true })
  edit(h.documents)
  h.documents.requestArchive('doc')
  const operation = h.confirmation().action()
  assert.strictEqual(h.confirmation().action(), operation)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].name, 'flow.entity.save')
  assert.match(JSON.stringify(h.calls[0].input.blocks), /Keep this draft/)
  assert.equal(h.navigations.length, 0)
  h.release()
  assert.equal(await operation, true)
  assert.deepEqual(
    h.calls.map((c) => c.name),
    ['flow.entity.save', 'flow.entity.action'],
  )
  assert.equal(h.calls[1].input.action, 'archive')
  assert.equal(h.navigations[0][0], 'page-archived')
  h.documents.dispose()
})

test('failed draft saving prevents archive, retains the draft and allows confirmation retry', async () => {
  const h = harness({ failSave: true })
  edit(h.documents)
  h.documents.requestArchive('doc')
  assert.equal(await h.confirmation().action(), false)
  assert.equal(h.documents.hasChanges(), true)
  assert.equal(h.calls.filter((c) => c.name === 'flow.entity.action').length, 0)
  assert.equal(await h.confirmation().action(), true)
  assert.equal(h.documents.hasChanges(), false)
  assert.equal(h.calls.filter((c) => c.name === 'flow.entity.action').length, 1)
  h.documents.dispose()
})

test('changing tenant while the pre-archive save is pending never archives the same ID in the new tenant', async () => {
  const h = harness({ holdSave: true })
  edit(h.documents)
  h.documents.requestArchive('doc')
  const operation = h.confirmation().action()
  h.switchCompany()
  h.release()
  assert.equal(await operation, false)
  assert.equal(h.calls.filter((c) => c.name === 'flow.entity.action').length, 0)
  h.documents.dispose()
})
