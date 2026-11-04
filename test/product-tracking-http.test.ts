import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import {
  templateModalDefinition,
  type TemplateModalData,
} from '../packages/ketsuite/src/modules/product_backend/modal/product-modal-view.tsx'
import { productBackendWith } from '../packages/ketsuite/src/modules/product_backend/with-options.ts'
import productBackend from '../packages/ketsuite/src/modules/product_backend/index.ts'
import { boot } from './fixtures/sale/commerce.ts'

function context(data: TemplateModalData): RecordModalContext<TemplateModalData> {
  return {
    kind: 'product.template',
    id: data.record.id,
    creating: false,
    tab: '',
    data,
    t: (key) => key,
    outcome: () => null,
    fieldError: () => null,
    draft: (_name, fallback = '') => fallback,
    draftChecked: (_name, _value, fallback = false) => fallback,
    busy: false,
    dialog: null,
    href: () => '',
    presentation: 'page',
    state: (_key, fallback = '') => fallback,
  }
}
function command(data: TemplateModalData, mode: string) {
  const form = new FormData()
  for (const [key, value] of Object.entries({
    name: data.record.name,
    defaultCode: 'ITEM',
    uomId: 'each',
    listPrice: '100',
    inventoryTracking: mode,
    saleOk: '1',
    purchaseOk: '1',
  }))
    form.set(key, value)
  return templateModalDefinition.commands!.save!.input!(form, context(data), {})
}

test('P8 Commerce context opts in without replacing domain functions', async (t) => {
  assert.equal(productBackendWith(), productBackend)
  assert.equal(productBackendWith({ combinedInventoryTracking: false }), productBackend)
  assert.equal(productBackendWith({ combinedInventoryTracking: true }).functions, productBackend.functions)
  const r = await boot(t)
  for (const lang of ['vi', 'en']) {
    const response = await r.app.client.get(`/admin/product/templates/new/context?lang=${lang}`)
    assert.equal(response.status, 200)
    const body = (await response.json()) as { data: TemplateModalData; messages: Row }
    assert.equal(body.data.inventoryTracking, 'combined')
    assert.equal(
      body.messages['product_backend.ws.field.inventoryTracking'],
      lang === 'vi' ? 'Theo dõi' : 'Tracking',
    )
  }
})

test('P8 Commerce form persists all tracking modes without changing product identity', async (t) => {
  const r = await boot(t)
  await r.save('product.saveRecord', {
    id: 'item',
    name: 'Item',
    defaultCode: 'ITEM',
    type: 'goods',
    uomId: 'each',
    isStorable: true,
    tracking: 'none',
  })
  for (const [mode, isStorable, tracking] of [
    ['none', false, 'none'],
    ['quantity', true, 'none'],
    ['lot', true, 'lot'],
  ] as const) {
    const response = await r.app.client.get('/admin/product/templates/item/context?lang=en')
    assert.equal(response.status, 200)
    const { data } = (await response.json()) as { data: TemplateModalData }
    const result = await r.call('product.saveRecord', command(data, mode))
    assert.equal(result.ok, true, JSON.stringify(result))
    const stored = await r.call('stock.getProductConfig', { templateId: 'item' })
    assert.equal(stored.isStorable, isStorable)
    assert.equal(stored.tracking, tracking)
    assert.equal((await r.call('product.getVariant', { id: 'item:default' })).id, 'item:default')
  }
})

test('P8 Commerce rejects a stale form after stock arrives and preserves legacy serial setup', async (t) => {
  const r = await boot(t)
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await r.save('product.saveRecord', {
    id: 'item',
    name: 'Item',
    defaultCode: 'ITEM',
    type: 'goods',
    uomId: 'each',
    isStorable: true,
    tracking: 'none',
  })
  const response = await r.app.client.get('/admin/product/templates/item/context?lang=en')
  const { data } = (await response.json()) as { data: TemplateModalData }
  await r.save('stock.adjustInventory', {
    id: 'count',
    productId: 'item:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '3',
    productUomId: 'each',
  })
  const refused = await r.call('product.saveRecord', command(data, 'lot'))
  assert.equal(refused.ok, false)
  assert.match(JSON.stringify(refused), /expectedRevisionId/)
  const freshResponse = await r.app.client.get('/admin/product/templates/item/context?lang=en')
  const fresh = ((await freshResponse.json()) as { data: TemplateModalData }).data
  assert.equal(fresh.record.stockLocked, true)
  const forced = await r.call('product.saveRecord', {
    ...command(data, 'lot'),
    expectedRevisionId: fresh.record.revisionId,
  })
  assert.equal(forced.ok, false)
  assert.match(JSON.stringify(forced), /stock|tracking|isStorable/i)
  assert.equal((await r.call('stock.getProductConfig', { templateId: 'item' })).tracking, 'none')
  await r.save('product.saveRecord', {
    id: 'legacy',
    name: 'Legacy serial',
    defaultCode: 'SERIAL',
    type: 'goods',
    uomId: 'each',
    isStorable: true,
    tracking: 'serial',
  })
  const serialResponse = await r.app.client.get('/admin/product/templates/legacy/context?lang=en')
  const serial = ((await serialResponse.json()) as { data: TemplateModalData }).data
  assert.equal(serial.record.tracking, 'serial')
  const input = command(serial, 'none')
  assert.equal(Object.hasOwn(input, 'tracking'), false)
  assert.equal(Object.hasOwn(input, 'isStorable'), false)
  input.defaultCode = 'SERIAL'
  const saved = await r.call('product.saveRecord', input)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal((await r.call('stock.getProductConfig', { templateId: 'legacy' })).tracking, 'serial')
})
