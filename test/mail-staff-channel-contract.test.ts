import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notificationDestinationOf } from '../packages/ketsuite/src/modules/mail_staff_channel/channel-routes.ts'

test('staff notification destinations preserve opaque public record identifiers', () => {
  for (const [targetModel, kind] of [
    ['partner.Partner', 'partner'],
    ['product.Template', 'product_template'],
    ['crm.Case', 'crm_case'],
    ['sale.Order', 'sales_order'],
    ['stock.Picking', 'warehouse_picking'],
  ]) {
    assert.deepEqual(notificationDestinationOf({ targetModel, targetId: 'record,opaque-id' }), {
      kind,
      id: 'record,opaque-id',
    })
  }
})

test('unknown and missing notification targets do not create navigation destinations', () => {
  assert.equal(notificationDestinationOf({ targetModel: 'private.Subject', targetId: '42' }), null)
  assert.equal(notificationDestinationOf({ targetModel: 'partner.Partner', targetId: '' }), null)
  assert.equal(notificationDestinationOf({ targetModel: 'partner.Partner' }), null)
})
