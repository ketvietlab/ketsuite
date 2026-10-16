import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHIPPING_STATUSES, isShippingStatus } from '../packages/ketsuite/src/shipping.ts'

test('shipping v1 is the exact 20-state provider-neutral uppercase contract', () => {
  const documented =
    'waiting request_received processing_picked_up picking_up delay_pickup picked_up waiting_on_the_way on_the_way contact_delivery_company out_for_delivery delay_delivery inform_recipient undeliverable waiting_for_return delivered delivered_cod returning returned returned_cod canceled'.split(
      ' ',
    )
  assert.deepEqual(
    SHIPPING_STATUSES,
    documented.map((value) => value.toUpperCase()),
  )
  assert.equal(new Set(SHIPPING_STATUSES).size, 20)
  for (const value of documented) {
    assert.equal(isShippingStatus(value), false)
    assert.equal(isShippingStatus(value.toUpperCase()), true)
  }
  for (const value of [null, undefined, 13, {}, 'FAILED', 'DELIVERED ', 'RETURNED_PARTIAL'])
    assert.equal(isShippingStatus(value), false)
})
