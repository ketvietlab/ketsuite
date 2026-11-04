import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickingGridConfig } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-grid.tsx'

test('K30 receipt preparation carries quantity, lot name and calendar expiry in the transfer grid', () => {
  const c = {
    kind: 'stock.transfer',
    id: 'receipt',
    data: {
      record: {
        id: 'receipt',
        state: 'assigned',
        moves: [
          {
            id: 'move',
            name: 'Serum',
            receiptLotInput: true,
            productUomQty: '5',
            lines: [
              {
                id: 'line',
                moveId: 'move',
                quantity: '3',
                receiptLotName: 'BATCH-1',
                receiptLotNumber: 'BATCH-1',
                receiptExpiryDate: '2031-01-01',
                picked: true,
              },
            ],
          },
        ],
      },
      choices: {},
      permissions: { savePickingLines: true, prepareReceiptLot: true },
    },
    draft: (_key: string, fallback: string) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
  } as unknown as Parameters<typeof pickingGridConfig>[0]
  const grid = pickingGridConfig(c)
  assert.deepEqual(
    grid.columns.map((column) => column.key),
    ['moveId', 'quantity', 'name', 'expirationDate', 'picked'],
  )
  assert.equal(grid.columns.find((column) => column.key === 'expirationDate')?.type, 'date')
  assert.deepEqual(
    [grid.rows[0]!.quantity, grid.rows[0]!.name, grid.rows[0]!.expirationDate, grid.rows[0]!.receiptLocked],
    [3, 'BATCH-1', '2031-01-01', false],
  )
  assert.equal(grid.locale, 'vi-VN')
  // The calendar and the grid's words follow the page language.
  const page = globalThis as { document?: unknown }
  const previous = page.document
  page.document = { documentElement: { lang: 'en' } }
  try {
    const english = pickingGridConfig(c)
    assert.equal(english.locale, 'en-US')
    assert.deepEqual(english.labels, {})
  } finally {
    if (previous === undefined) delete page.document
    else page.document = previous
  }
})
