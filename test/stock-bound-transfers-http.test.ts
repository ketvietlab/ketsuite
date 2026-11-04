import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('K21 a sales delivery and its return keep their type, ends and products; their date and priority change', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: false, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'shelf', name: 'Shelf', usage: 'internal' })
  await r.add({ productUomId: 'each', productUomQty: '3' })
  await r.save('sale.confirmOrder', { id: 'order' })
  const delivery = await r.call('stock.getPicking', { id: 'order:delivery' })
  assert.equal(delivery.bound, true)
  const save = (input: Row) =>
    r.call('stock.savePicking', {
      id: 'order:delivery',
      name: delivery.name,
      pickingTypeId: delivery.pickingTypeId,
      locationId: delivery.locationId,
      locationDestId: delivery.locationDestId,
      ...input,
    })
  const refusal = { ok: false, errors: [{ field: 'locationId', messageKey: 'stock.error.pickingBound' }] }
  assert.deepEqual(await save({ locationId: 'shelf' }), refusal)
  assert.deepEqual(await save({ pickingTypeId: 'wh:internal' }), refusal)
  assert.equal((await save({ priority: true, scheduledDate: '2030-02-03T00:00:00.000Z' })).ok, true)
  const saved = await r.call('stock.getPicking', { id: 'order:delivery' })
  assert.deepEqual(
    [saved.priority, saved.locationId, saved.locationDestId],
    [true, delivery.locationId, delivery.locationDestId],
  )
  const added = await r.call('stock.addMoves', {
    pickingId: 'order:delivery',
    moves: [{ id: 'extra', name: 'Goods', productId: r.productId, productUomId: 'each', productUomQty: '1' }],
  })
  assert.deepEqual(added, {
    ok: false,
    errors: [{ field: 'pickingId', messageKey: 'stock.error.pickingBound' }],
  })
  // #1818: calling stock.addMove itself is refused the same way, and adds nothing.
  const addOne = (pickingId: string) =>
    r.call('stock.addMove', {
      id: `${pickingId}:extra`,
      name: 'Goods',
      pickingId,
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '1',
    })
  assert.deepEqual(await addOne('order:delivery'), {
    ok: false,
    errors: [{ field: 'pickingId', messageKey: 'stock.error.pickingBound' }],
  })
  assert.equal(((await r.call('stock.getPicking', { id: 'order:delivery' })).moves as Row[]).length, 1)

  // Its return follows the delivery the same way.
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  assert.equal((await r.call('stock.completePicking', { id: 'order:delivery' })).ok, true)
  assert.equal((await r.call('stock.createReturn', { id: 'order:delivery', returnId: 'back' })).ok, true)
  assert.equal((await r.call('stock.getPicking', { id: 'back' })).bound, true)
  assert.equal(
    (
      await r.call('stock.addMoves', {
        pickingId: 'back',
        moves: [
          { id: 'extra', name: 'Goods', productId: r.productId, productUomId: 'each', productUomQty: '1' },
        ],
      })
    ).ok,
    false,
  )

  assert.equal((await addOne('back')).ok, false)

  // A transfer of the warehouse's own changes its ends and takes products.
  await r.save('stock.createPicking', { id: 'own', pickingTypeId: 'wh:internal' })
  assert.equal((await r.call('stock.getPicking', { id: 'own' })).bound, false)
  const own = await r.call('stock.getPicking', { id: 'own' })
  assert.equal(
    (
      await r.call('stock.savePicking', {
        id: 'own',
        name: own.name,
        pickingTypeId: own.pickingTypeId,
        locationId: 'shelf',
      })
    ).ok,
    true,
  )
  const ownSaved = await r.call('stock.getPicking', { id: 'own' })
  assert.deepEqual([ownSaved.locationId, ownSaved.locationDestId], ['shelf', own.locationDestId])
  assert.equal(
    (
      await r.call('stock.addMoves', {
        pickingId: 'own',
        moves: [
          { id: 'own-1', name: 'Goods', productId: r.productId, productUomId: 'each', productUomQty: '1' },
        ],
      })
    ).ok,
    true,
  )
})
