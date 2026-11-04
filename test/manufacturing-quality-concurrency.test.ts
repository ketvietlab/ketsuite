import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { qualityTemplateFunctions } from '../packages/ketsuite/src/modules/manufacturing/quality.ts'

// Deterministic interleaving: another connection commits after the first read but before this
// transaction acquires the template. HTTP tests alone may serialize requests on one connection.
test('quality template: an edit losing its revision before transaction entry cannot replace criteria', async () => {
  let stored: Row = { id: 'qc', companyId: 'acme', name: 'Original', version: 1 }
  let criteriaTouched = false
  const db = {
    select: async () => [{ ...stored }],
    compareAndSet: async (_model: string, _where: Row, expected: Row, patch: Row) => {
      if (stored.version !== expected.version) return false
      stored = { ...stored, ...patch }
      return true
    },
    update: async (_model: string, _where: Row, patch: Row) => {
      stored = { ...stored, ...patch }
    },
  }
  const context = {
    scope: { company: 'acme' },
    db,
    tx: async (run: (ctx: Ctx) => Promise<unknown>) => {
      stored = { ...stored, name: 'Other editor', version: 2 }
      return run(context as unknown as Ctx)
    },
    table: () => {
      criteriaTouched = true
      throw new Error('A stale edit must not reach the criterion replacement')
    },
  }
  const result = await qualityTemplateFunctions.saveQualityTemplate!.handler(context as unknown as Ctx, {
    id: 'qc',
    name: 'Stale editor',
    version: 1,
    criteria: [{ name: 'Appearance', kind: 'passFail' }],
  })
  assert.deepEqual(result, { ok: false, errors: [{ field: 'version', code: 'manufacturing.error.version' }] })
  assert.equal(stored.name, 'Other editor')
  assert.equal(stored.version, 2)
  assert.equal(criteriaTouched, false)
})
