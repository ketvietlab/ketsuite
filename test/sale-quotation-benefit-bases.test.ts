import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saleRewardBases } from '../packages/ketsuite/src/modules/loyalty/sale-policy.ts'
import type { OrderSnapshot, OrderLineSnapshot } from '../packages/ketsuite/src/modules/loyalty/types.ts'
const line = (id: string, untaxed: string, extra: Partial<OrderLineSnapshot> = {}): OrderLineSnapshot => ({
  id,
  productId: id,
  quantity: 1,
  untaxed,
  total: untaxed,
  lineKind: 'product',
  taxKey: '[]',
  ...extra,
})
const snapshot = (lines: OrderLineSnapshot[]): OrderSnapshot => ({
  orderType: 'sale',
  orderId: 'quote',
  currency: 'VND',
  date: '2026-10-24',
  lines,
  saleProgramOrder: ['first', 'second'],
})

test('D31e remaining bases conserve exact minor units above Number precision and never cross tax groups', () => {
  const data = snapshot([
    line('a', '9007199254740993001'),
    line('b', '3', { taxKey: '["vat"]' }),
    line('manual', '-1', { lineKind: 'discount' }),
    line('other-tax', '-2', { lineKind: 'discount', taxKey: '["vat"]' }),
  ])
  assert.deepEqual(saleRewardBases(data, { programId: 'first' }, new Set()), [
    { id: 'a', base: 9007199254740993000n },
    { id: 'b', base: 1n },
  ])
})

test('D31e allocation cannot assign more than a line base and ignores its own and later program discounts', () => {
  const data = snapshot([
    line('a', '1'),
    line('b', '1'),
    line('c', '1'),
    line('manual', '-1', { lineKind: 'discount' }),
    line('own', '-1', { lineKind: 'discount', loyaltyProgramId: 'first' }),
    line('later', '-1', { lineKind: 'discount', loyaltyProgramId: 'second' }),
  ])
  const bases = saleRewardBases(data, { programId: 'first' }, new Set())
  assert.equal(
    bases.reduce((sum, row) => sum + row.base, 0n),
    2n,
  )
  assert.ok(bases.every((row) => row.base <= 1n))
  assert.equal(
    saleRewardBases(data, { programId: 'second' }, new Set()).reduce((sum, row) => sum + row.base, 0n),
    1n,
  )
})
