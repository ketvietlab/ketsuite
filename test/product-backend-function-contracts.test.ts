import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseline } from './fixtures/product/backend-function-contracts.ts'
import { functions as compatibility } from '../packages/ketsuite/src/modules/product_backend/functions.ts'
import {
  functions,
  assembleProductBackendFunctions,
} from '../packages/ketsuite/src/modules/product_backend/functions/index.ts'
import { permissions } from '../packages/ketsuite/src/permission-catalogue/product_backend.ts'

test('Product backend capability split retains each existing descriptor and permission', () => {
  assert.equal(compatibility, functions)
  for (const [key, expected] of Object.entries(baseline.contract)) {
    const { handler: _handler, ...actual } = functions[key]!
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, key)
    assert.deepEqual(
      permissions.functions[key as keyof typeof permissions.functions],
      baseline.permissions.functions[key as keyof typeof baseline.permissions.functions],
    )
  }
  for (const key of [
    'searchUnits',
    'unitContext',
    'applyAttributeSearchFilter',
    'searchVariants',
    'searchTemplates',
  ])
    assert.equal(functions[key]!.handler.name, `${key}Handler`)
  assert.throws(
    () => assembleProductBackendFunctions([functions, functions]),
    /Duplicate product backend function/,
  )
})
