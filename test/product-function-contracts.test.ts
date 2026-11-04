import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseline } from './fixtures/product/function-contracts.ts'
import * as compatibility from '../packages/ketsuite/src/modules/product/functions.ts'
import * as registry from '../packages/ketsuite/src/modules/product/functions/index.ts'
import product from '../packages/ketsuite/src/modules/product/index.ts'
import { permissions } from '../packages/ketsuite/src/permission-catalogue/product.ts'
import { templatesFunctions } from '../packages/ketsuite/src/modules/product/functions/templates.ts'
import { variantsFunctions } from '../packages/ketsuite/src/modules/product/functions/variants.ts'
import { attributesFunctions } from '../packages/ketsuite/src/modules/product/functions/attributes.ts'
import { packagingFunctions } from '../packages/ketsuite/src/modules/product/functions/packaging.ts'
import { classificationFunctions } from '../packages/ketsuite/src/modules/product/functions/classification.ts'
import { costsFunctions } from '../packages/ketsuite/src/modules/product/functions/costs.ts'
import { comboFunctions } from '../packages/ketsuite/src/modules/product/functions/combos.ts'
import { tagFunctions } from '../packages/ketsuite/src/modules/product/functions/tags.ts'
import { categoryRecordFunctions } from '../packages/ketsuite/src/modules/product/functions/category-record.ts'
import { lifecycleFunctions } from '../packages/ketsuite/src/modules/product/functions/lifecycle.ts'

test('product registry matches the declared descriptors and permission assignments', () => {
  const contract = Object.fromEntries(
    Object.entries(registry.functions).map(([key, { handler: _handler, ...spec }]) => [key, spec]),
  )
  assert.deepEqual(JSON.parse(JSON.stringify({ contract, permissions })), baseline)
  assert.equal(product.functions, registry.functions)
  for (const group of [
    templatesFunctions,
    variantsFunctions,
    attributesFunctions,
    packagingFunctions,
    classificationFunctions,
    costsFunctions,
    lifecycleFunctions,
    categoryRecordFunctions,
    tagFunctions,
    comboFunctions,
  ])
    for (const [key, spec] of Object.entries(group))
      assert.equal(spec.handler.name, `${key}Handler`, `${key} has a named use-case handler`)
})

test('product registry rejects a duplicate before the later descriptor overwrites its owner', () => {
  const first = { saveTemplate: registry.functions.saveTemplate! }
  const second = { saveTemplate: registry.functions.saveVariant! }
  assert.throws(
    () => registry.assembleProductFunctions([first, second]),
    /Duplicate product function: saveTemplate/,
  )
  assert.equal(registry.assembleProductFunctions([first]).saveTemplate, first.saveTemplate)
})

test('product transactional consumers keep the original module exports and factory contract', () => {
  assert.equal(compatibility.functions, registry.functions)
  assert.equal(compatibility.saveTemplateFunction, registry.saveTemplateFunction)
  assert.equal(compatibility.describeVariants, registry.describeVariants)
  assert.equal(compatibility.attributeLinesOf, registry.attributeLinesOf)
  const { handler, ...transactional } = compatibility.saveTemplateFunction({ inTransaction: true })
  assert.equal(handler.name, 'saveTemplateHandler')
  assert.deepEqual(JSON.parse(JSON.stringify(transactional)), baseline.contract.saveTemplate)
})
