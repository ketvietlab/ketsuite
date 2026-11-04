import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('Commerce order reads expose current SKU codes without replacing historical line descriptions', async (t) => {
  const { call, add, save } = await setup(t)
  await add({ name: 'Negotiated product description' })
  await save('sale.addLine', {
    id: 'free',
    orderId: 'order',
    name: 'Advice',
    productUomQty: '1',
    priceUnit: '100',
  })
  const order = await call('sale.getOrder', { id: 'order' })
  const lines = order.lines as Row[]
  assert.equal(lines.find((line) => line.id === 'line')!.productCode, 'GOODS')
  assert.equal(lines.find((line) => line.id === 'line')!.name, 'Negotiated product description')
  assert.equal(lines.find((line) => line.id === 'free')!.productCode, null)
  assert.ok(lines.every((line) => !('unitCost' in line)))
})
