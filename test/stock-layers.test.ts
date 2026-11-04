import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { agingBucket, stockLayers } from '../packages/ketsuite/src/modules/stock/analysis.ts'

/** Just enough of a context for the layer read: company-scoped rows matched on every field asked for. */
const context = (tables: Record<string, Row[]>): Ctx =>
  ({
    scope: { company: 'acme' },
    db: {
      select: async (model: string, where: Row) =>
        (tables[model] ?? []).filter((row) =>
          Object.entries(where).every(([key, value]) => key === 'companyId' || row[key] === value),
        ),
    },
  }) as unknown as Ctx

const locations = [
  { id: 'stock', usage: 'internal', warehouseId: 'wh' },
  { id: 'east', usage: 'internal', warehouseId: 'east' },
  { id: 'vendor', usage: 'supplier' },
  { id: 'customer', usage: 'customer' },
]
/** A done transfer of one line: `[id, from, to, quantity, done at]`. */
const ledger = (moves: Array<[string, string, string, string, string]>): Record<string, Row[]> => ({
  'stock.Location': locations,
  'stock.Picking': moves.map(([id, , , , at]) => ({ id, name: id, state: 'done', dateDone: at })),
  'stock.Move': moves.map(([id, from, to]) => ({
    id,
    pickingId: id,
    productId: 'goods',
    locationId: from,
    locationDestId: to,
    state: 'done',
  })),
  'stock.MoveLine': moves.map(([id, from, to, quantity]) => ({
    id: `${id}-line`,
    moveId: id,
    pickingId: id,
    locationId: from,
    locationDestId: to,
    quantity,
    quantityProductUom: quantity,
  })),
})
const left = async (tables: Record<string, Row[]>) =>
  Object.fromEntries((await stockLayers(context(tables))).map((layer) => [layer.moveId, String(layer.left)]))

test('K63 layers are spent oldest first, location by location', async () => {
  const tables = ledger([
    ['in-1', 'vendor', 'stock', '3', '2030-01-01T05:00:00.000Z'],
    ['in-2', 'vendor', 'stock', '4', '2030-01-02T05:00:00.000Z'],
    ['move', 'stock', 'east', '2', '2030-01-03T05:00:00.000Z'],
    ['out', 'stock', 'customer', '3', '2030-01-04T05:00:00.000Z'],
    ['out-east', 'east', 'customer', '1', '2030-01-05T05:00:00.000Z'],
  ])
  tables['stock.Quant'] = [
    { productId: 'goods', locationId: 'stock', quantity: '2', inDate: '2030-01-01T05:00:00.000Z' },
    { productId: 'goods', locationId: 'east', quantity: '1', inDate: '2030-01-03T05:00:00.000Z' },
  ]
  // in-1's three go first (two to east, one out), then two of in-2's; east spends its one arrival.
  assert.deepEqual(await left(tables), { 'in-1': '0', 'in-2': '2000000', move: '1000000' })
})

test('K63 what left a location short comes out of its next arrival, and arrivals come first at the same moment', async () => {
  const tables = ledger([
    ['out', 'stock', 'customer', '2', '2030-01-01T05:00:00.000Z'],
    ['in-1', 'vendor', 'stock', '5', '2030-01-02T05:00:00.000Z'],
    ['same-out', 'stock', 'customer', '1', '2030-01-03T05:00:00.000Z'],
    ['same-in', 'vendor', 'stock', '1', '2030-01-03T05:00:00.000Z'],
  ])
  tables['stock.Quant'] = [{ productId: 'goods', locationId: 'stock', quantity: '3', inDate: '' }]
  // The two that left before anything came take the first two of in-1; the later issue takes the third.
  assert.deepEqual(await left(tables), { 'in-1': '2000000', 'same-in': '1000000' })
})

test('K63 the aging buckets close at 30, 60 and 90 days', () => {
  assert.deepEqual([0, 30, 31, 60, 61, 90, 91, 400].map(agingBucket), [0, 0, 1, 1, 2, 2, 3, 3])
})
