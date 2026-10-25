import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('shared Atlas exchange response previews without changing tasks and retries without duplicates', () => {
  const session = createOrganizationSession('baseline')
  const call = (name, input = {}) => session.call(name, { companyId: 'demo', ...input }).value
  const data = call('flow.workspace.bootstrap', { route: 'my-work' }),
    projectId = data.projects[0].id
  const exported = call('flow.issue.export', { projectId, limit: 1 })
  assert.equal(exported.ok, true)
  assert.equal(exported.rows.length, 1)
  const input = {
    projectId,
    schema: 'flow.task-exchange',
    version: 1,
    mode: 'create',
    importId: 'atlas-file',
    rows: [{ sourceId: 'one', title: 'Exchange from shared client' }],
    idempotencyKey: 'atlas-preview',
  }
  const before = call('flow.issue.export', { projectId, limit: 100 }).rows.length
  const preview = call('flow.issue.importPreview', input)
  assert.equal(preview.valid, true)
  assert.equal(call('flow.issue.export', { projectId, limit: 100 }).rows.length, before)
  const args = { ...input, previewDigest: preview.previewDigest, idempotencyKey: 'atlas-apply' }
  const applied = call('flow.issue.importApply', args)
  assert.equal(applied.imported, 1)
  assert.deepEqual(call('flow.issue.importApply', args), applied)
  assert.equal(call('flow.issue.export', { projectId, limit: 100 }).rows.length, before + 1)
  const repeated = { ...input, idempotencyKey: 'atlas-preview-again' },
    anotherPreview = call('flow.issue.importPreview', repeated)
  const repeat = call('flow.issue.importApply', {
    ...repeated,
    previewDigest: anotherPreview.previewDigest,
    idempotencyKey: 'atlas-apply-again',
  })
  assert.equal(repeat.replayed, 1)
})
