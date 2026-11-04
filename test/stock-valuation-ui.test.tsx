import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { pickingGridConfig } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-grid.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'

type Context = Parameters<NonNullable<typeof transferModalDefinition.body>>[0]
const context = (data: Record<string, unknown>, state = 'assigned'): Context =>
  ({
    kind: 'stock.transfer',
    creating: false,
    data: {
      record: {
        id: 'receipt',
        name: 'WH/IN/0001',
        state,
        moves: [
          {
            id: 'move',
            name: 'Goods',
            productUomQty: '6',
            valuedReceipt: true,
            lines: [{ id: 'line', moveId: 'move', quantity: '6', picked: true }],
          },
        ],
      },
      choices: {},
      permissions: {},
      ...data,
    },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
  }) as unknown as Context

const draft = {
  currency: 'VND',
  drafts: [{ moveLineId: 'line', unitCost: null, averageCost: '1300' }],
  lines: [],
  total: '0',
  accountMoveName: null,
  entryHref: null,
}

test('K25 a storekeeper reads the transfer without unit costs or values', () => {
  const html = renderToString(<>{transferModalDefinition.body!(context({ valuation: null }))}</>)
  assert.doesNotMatch(html, /modal\.unitCost|modal\.value|1\.300|1,300/)
})

test('K24 a manager prices a blank receipt line in the lines grid; a reader sees the average it takes', () => {
  const manager = context({
    valuation: draft,
    permissions: { savePickingLines: true, setReceiptUnitCost: true },
  })
  const html = renderToString(<>{transferModalDefinition.body!(manager)}</>)
  assert.match(html, /data-island="backend\.ket-grid"/)
  assert.doesNotMatch(html, /data-record-dialog="cost"/)
  const grid = pickingGridConfig(manager)
  const cost = grid.columns.find((column) => column.key === 'unitCost')!
  assert.deepEqual(
    [cost.type, cost.lockedBy, cost.placeholder, cost.hint],
    ['number', 'costLocked', 'stock_backend.modal.averageCost', 'stock_backend.modal.unitCostHint'],
  )
  assert.deepEqual([grid.rows[0]!.unitCost, grid.rows[0]!.costLocked], [null, false])
  // Without the right to set it, the default is shown but not offered.
  const reader = renderToString(<>{transferModalDefinition.body!(context({ valuation: draft }))}</>)
  assert.match(reader, /stock_backend\.modal\.averageCost: 1\.300/)
  assert.doesNotMatch(reader, /backend\.ket-grid|data-record-dialog="cost"/)
})

test('K25 a completed transfer shows each line value, the transfer value and its stock entry', () => {
  const done = {
    ...draft,
    drafts: [],
    lines: [{ moveLineId: 'line', value: '9000' }],
    total: '9000',
    accountMoveName: 'KHO/2030/00001',
    entryHref: '/admin/accounting/entries/stock-valuation%3Areceipt',
  }
  const html = renderToString(<>{transferModalDefinition.body!(context({ valuation: done }, 'done'))}</>)
  assert.match(html, /stock_backend\.modal\.value/)
  assert.match(html, /stock_backend\.modal\.pickingValue/)
  assert.match(html, /9\.000/)
  assert.match(html, /KHO\/2030\/00001/)
  assert.match(html, /href="\/admin\/accounting\/entries\/stock-valuation%3Areceipt"/)
})
