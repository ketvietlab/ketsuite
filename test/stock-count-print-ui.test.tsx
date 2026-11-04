import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { CountPrint } from '../packages/ketsuite/src/modules/stock_backend/screens/count-print.tsx'
const _ = ((key: string) => key) as Translator
const data = {
  company: { name: 'Test company' },
  committee: [{ id: 'a', name: 'Nguyen An', title: 'Manager', role: 'Chair' }],
  name: 'WH/KK/1',
  startedAt: '2030-01-31T05:00:00Z',
  timezone: 'Asia/Ho_Chi_Minh',
  warehouse: 'Main',
  resolution: 'Investigate',
  currency: 'VND',
  lines: [
    {
      id: '1',
      product: 'Goods',
      expected: 10,
      counted: 8,
      difference: -2,
      qualityGood: 6,
      qualityPoor: 1,
      qualityLost: 1,
      bookValue: '10000',
      physicalValue: '8000',
      differenceValue: '-2000',
    },
  ],
}
test('05-VT prints committee, quality, time and resolution; quantity copies omit value columns', () => {
  const plain = renderToString(
    CountPrint({ _, data: { ...data, valued: false }, back: '/admin/stock/counts' }),
  )
  for (const text of [
    'Nguyen An',
    'Manager',
    'Chair',
    'Investigate',
    'qualityGood',
    'qualityPoor',
    'qualityLost',
    '31/01/2030',
    '12:00',
  ])
    assert.ok(plain.includes(text), text)
  assert.ok(!plain.includes('stock_backend.count.value'))
  assert.ok(!plain.includes('10.000'))
  const valued = renderToString(
    CountPrint({ _, data: { ...data, valued: true }, back: '/admin/stock/counts' }),
  )
  assert.ok(valued.includes('stock_backend.count.value'))
  assert.ok(valued.includes('stock_backend.count.difference'))
})
