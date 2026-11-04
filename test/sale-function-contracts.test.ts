import * as compatibility from '../packages/ketsuite/src/modules/sale/functions.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseline } from './fixtures/sale/function-contracts.ts'
import { functions, assembleSaleFunctions } from '../packages/ketsuite/src/modules/sale/functions/index.ts'
import { permissions } from '../packages/ketsuite/src/permission-catalogue/sale.ts'

test('sale capability refactor preserves every descriptor and permission assignment', () => {
  assert.equal(compatibility.functions, functions)
  const contract = Object.fromEntries(
    Object.entries(functions).map(([key, { handler, ...spec }]) => {
      assert.equal(handler.name, `${key}Handler`)
      return [key, spec]
    }),
  )
  // The baseline records P36, line costs and combos, and a line's optional unit (C6, D24).
  const expected = structuredClone(baseline)
  delete contract.getLineCosts
  delete contract.applyLineGrid
  delete contract.listLineUnits
  // Update prices runs the line grid's writer, so it carries the grid's effects (D14).
  delete contract.updatePrices
  const { getLineCosts, listLineUnits, applyLineGrid, updatePrices, ...existingPermissions } =
    permissions.functions
  assert.deepEqual(updatePrices, ['operate', 'quote-operate'])
  for (const effect of functions.applyLineGrid!.effects!)
    assert.ok(functions.updatePrices!.effects!.includes(effect), effect)
  assert.deepEqual(getLineCosts, ['sensitive', 'cost', 'sale.sensitive-data'])
  assert.deepEqual(listLineUnits, ['read', 'quote-operate'])
  assert.deepEqual(applyLineGrid, ['operate', 'quote-operate'])
  assert.deepEqual(
    JSON.parse(JSON.stringify({ contract, permissions: { ...permissions, functions: existingPermissions } })),
    expected,
  )
})

test('sale registry rejects duplicate capability ownership', () => {
  assert.throws(() => assembleSaleFunctions([functions, functions]), /Duplicate sale function:/)
})
