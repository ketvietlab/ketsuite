import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FnSpec } from '@ketvietlab/ketjs'
import {
  functions,
  assemblePurchaseFunctions,
} from '../packages/ketsuite/src/modules/purchase/functions/index.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../packages/ketsuite/src/modules/user/authorization.ts'
import { baseline } from './fixtures/purchase/function-contracts.ts'

test('purchase refactor preserves legacy descriptors and declares the P48 supplier grid boundary', () => {
  const contract = Object.fromEntries(
    Object.entries(functions).map(([key, { handler, ...spec }]) => {
      assert.equal(handler.name, `${key}Handler`)
      return [key, spec]
    }),
  )
  const expected = structuredClone(baseline) as Record<string, Omit<FnSpec, 'handler'>>
  for (const key of ['addLine', 'updateLine'])
    expected[key]!.effects = [...expected[key]!.effects!, 'read:partner.Partner']
  expected.saveSupplierInfo!.effects = [...expected.saveSupplierInfo!.effects!, 'write:product.Template']
  const reads = [
    ...AUTHORIZATION_READ_EFFECTS,
    'read:purchase.SupplierInfo',
    'read:product.Template',
    'read:partner.Partner',
    'read:product.Product',
    'read:uom.Unit',
    'read:company.Company',
  ]
  expected.getProductSuppliers = { input: { templateId: 'id' }, effects: reads, agent: true }
  expected.listSupplierPartners = {
    input: { search: 'text?', limit: 'int?' },
    effects: ['read:partner.Partner', 'read:partner.Role'],
    agent: true,
  }
  expected.applyProductSupplierGrid = {
    input: { templateId: 'id', expectedRevision: 'text', changes: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'text?', errors: 'json?' },
    effects: [...reads, 'write:purchase.SupplierInfo', 'write:product.Template'],
    idempotent: true,
    agent: true,
  }
  // The RFQ line grid saves at once what adding, changing and removing a line each write.
  expected.saveLines = {
    input: { id: 'id', lines: 'json?', removed: 'json?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...['addLine', 'updateLine', 'removeLine'].flatMap((key) => expected[key]!.effects!),
      ...AUTHORIZATION_READ_EFFECTS,
    ],
    idempotent: true,
  }
  const normalize = (value: object) =>
    JSON.parse(JSON.stringify(value, (key, item) => (key === 'effects' ? [...new Set(item)].sort() : item)))
  assert.deepEqual(normalize(contract), normalize(expected))
})

test('purchase registry rejects duplicate function ownership before overwriting descriptors', () => {
  assert.throws(() => assemblePurchaseFunctions([functions, functions]), /Duplicate purchase function:/)
})
