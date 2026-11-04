import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseline } from './fixtures/stock/function-contracts.ts'
import * as compatibility from '../packages/ketsuite/src/modules/stock/functions.ts'
import { assembleStockFunctions, functions } from '../packages/ketsuite/src/modules/stock/functions/index.ts'
import stock from '../packages/ketsuite/src/modules/stock/index.ts'
import { permissions } from '../packages/ketsuite/src/permission-catalogue/stock.ts'

test('Stock capability split preserves every descriptor, permission and public consumer export', () => {
  const contract = Object.fromEntries(
    Object.entries(functions).map(([key, { handler, ...spec }]) => {
      assert.equal(handler.name, `${key}Handler`, `${key} owns a named handler`)
      assert.equal(stock.functions?.[key], functions[key])
      return [key, spec]
    }),
  )
  assert.deepEqual(JSON.parse(JSON.stringify({ contract, permissions })), baseline)
  assert.equal(compatibility.functions, functions)
  assert.deepEqual(compatibility.TRACKING, ['none', 'lot', 'serial'])
})

test('Stock registry refuses duplicate capabilities before any descriptor is lost', () => {
  assert.throws(
    () =>
      assembleStockFunctions([
        { saveWarehouse: functions.saveWarehouse! },
        { saveWarehouse: functions.saveLocation! },
      ]),
    /Duplicate stock function: saveWarehouse/,
  )
})
