import { recordWriteEffects } from '../packages/ketsuite/src/modules/pricing/record-writer.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseline } from './fixtures/pricing/function-contracts.ts'
import * as compatibility from '../packages/ketsuite/src/modules/pricing/functions.ts'
import {
  functions,
  assemblePricingFunctions,
} from '../packages/ketsuite/src/modules/pricing/functions/index.ts'
import { PACKAGING_EFFECTS } from '../packages/ketsuite/src/modules/pricing/packaging.ts'
import { permissions } from '../packages/ketsuite/src/permission-catalogue/pricing.ts'

test('Pricing preserves legacy descriptors with explicit packaging, category and D30 graph lock effects', () => {
  assert.equal(compatibility.functions, functions)
  const expected = structuredClone(baseline) as Record<
    string,
    { input: Record<string, string>; effects: string[] }
  >
  expected.savePricelistItem!.input.uomId = 'id?'
  expected.savePricelist!.effects.unshift(
    ...recordWriteEffects,
    'read:pricing.Namespace',
    'write:pricing.Namespace',
  )
  expected.savePricelist!.input.items = 'json?'
  expected.savePricelist!.input.expectedRevision = 'text?'
  expected.savePricelistItem!.effects.unshift(
    ...PACKAGING_EFFECTS,
    'read:pricing.Namespace',
    'write:pricing.Namespace',
  )
  expected.savePricelist!.effects.push(
    'read:pricing.PricelistItem',
    'read:product.Category',
    'write:product.Category',
  )
  expected.savePricelistItem!.effects.splice(
    expected.savePricelistItem!.effects.indexOf('read:product.Category') + 1,
    0,
    'write:product.Category',
  )
  const actual = Object.fromEntries(
    Object.entries(functions)
      .filter(([key]) => !['priceForLine', 'listRuleUnits'].includes(key))
      .map(([key, { handler, ...spec }]) => {
        assert.equal(handler.name, `${key}Handler`)
        return [key, spec]
      }),
  )
  assert.deepEqual(actual, expected)
  assert.deepEqual(permissions.functions.priceForLine, permissions.functions.priceFor)
  assert.throws(() => assemblePricingFunctions([functions, functions]), /Duplicate pricing function:/)
})
