import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseline } from './fixtures/account/function-contracts.ts'
import * as compatibility from '../packages/ketsuite/src/modules/account/functions.ts'
import {
  functions,
  assembleAccountFunctions,
} from '../packages/ketsuite/src/modules/account/functions/index.ts'
import { permissions } from '../packages/ketsuite/src/permission-catalogue/account.ts'

test('account capability split preserves the 38 existing descriptors and permission contracts', () => {
  const contract = Object.fromEntries(
    Object.entries(functions)
      .filter(([key]) => key in baseline.contract)
      .map(([key, { handler: _handler, ...spec }]) => {
        const clean = structuredClone(spec)
        if (key === 'createInvoice' || key === 'addMoveLine') {
          assert.equal((clean.input as Record<string, unknown>).lineKind, 'text?')
          delete (clean.input as Record<string, unknown>).lineKind
        }
        if (key === 'getDefaults' || key === 'saveDefaults') {
          const shape = key === 'getDefaults' ? clean.output : clean.input
          for (const field of ['goodsPurchaseAccountId', 'servicePurchaseAccountId']) {
            assert.equal((shape as Record<string, unknown>)[field], 'id?')
            delete (shape as Record<string, unknown>)[field]
          }
        }
        if (key === 'previewAccounts' || key === 'createInvoice')
          clean.effects = clean.effects?.filter(
            (effect) => !['read:account.ProductAccount', 'read:product.Category'].includes(effect),
          )
        return [key, clean]
      }),
  )
  assert.deepEqual(JSON.parse(JSON.stringify(contract)), baseline.contract)
  // Capabilities added after the split carry their own tests; the baseline pins the ones it moved.
  const {
    getProductAccounts: _read,
    setProductAccounts: _write,
    listNettablePartners: _nettable,
    previewNetting: _preview,
    postNetting: _post,
    reverseNetting: _reverse,
    ...existing
  } = permissions.functions
  assert.deepEqual(existing, baseline.permissions.functions)
  assert.deepEqual(
    permissions.bundles.filter((bundle) => bundle !== 'product-accounting'),
    baseline.permissions.bundles,
  )
  assert.equal(compatibility.functions, functions)
  assert.equal(Object.keys(functions).length, 40)
  for (const [key, spec] of Object.entries(functions)) assert.equal(spec.handler.name, `${key}Handler`)
})

test('account registry refuses duplicate capability keys', () => {
  assert.throws(() => assembleAccountFunctions([functions, functions]), /Duplicate account function/)
})
