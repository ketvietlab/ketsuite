import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'

// K10 (#1426): each warehouse owns its vendor, customer, scrap and adjustment locations; what it made reads in
// the reader's language on the list, in the record modal and in its pickers, and a name someone typed stays.
test('a warehouse makes its own locations, and they read in the reader language', async (t) => {
  const r = await setup(t)
  await r.save('stock.saveWarehouse', { id: 'north', name: 'North', code: 'NO' })
  await r.save('stock.saveLocation', { id: 'shelf', name: 'Inventory adjustment', usage: 'internal' })
  const listed = (await r.call('stock.listLocations', {})) as unknown as Row[]
  for (const warehouse of ['wh', 'north'])
    assert.deepEqual(
      ['supplier', 'customer', 'scrap', 'adjustment'].map((suffix) => {
        const row = listed.find((location) => location.id === `${warehouse}:${suffix}`)
        return [row?.usage, row?.warehouseId]
      }),
      [
        ['supplier', warehouse],
        ['customer', warehouse],
        ['scrap', warehouse],
        ['inventory', warehouse],
      ],
    )

  const page = async (lang: 'vi' | 'en') => {
    const response = await r.app.client.request(`/admin/stock/locations?lang=${lang}`)
    assert.equal(response.status, 200)
    return response.text()
  }
  const vi = await page('vi')
  assert.match(vi, /data-row="wh:adjustment"[\s\S]*?Điều chỉnh tồn kho/)
  assert.match(vi, /data-row="north:adjustment"[\s\S]*?Điều chỉnh tồn kho/)
  assert.match(vi, /data-row="shelf"[\s\S]*?Inventory adjustment/)
  assert.match(vi, /id="stock-locations-help"/)
  assert.match(await page('en'), /data-row="wh:adjustment"[\s\S]*?Inventory adjustment/)

  const modal = async (lang: 'vi' | 'en', id: string) =>
    (
      await (
        await r.app.client.request(
          `/admin/stock/record/location/${encodeURIComponent(id)}/context?lang=${lang}`,
        )
      ).json()
    ).data
  const opened = await modal('vi', 'wh:adjustment')
  assert.equal(opened.record.name, 'Điều chỉnh tồn kho')
  assert.equal(opened.choices.locations.find((row: Row) => row.id === 'north:customer')?.name, 'Khách hàng')
  assert.equal((await modal('en', 'wh:adjustment')).record.name, 'Inventory adjustment')
  assert.equal((await modal('vi', 'shelf')).record.name, 'Inventory adjustment')

  // Saved as shown, the translated name is not written: the warehouse's name stays, in every language; a
  // name typed over it is kept.
  const save = stockConfigurationDefinition('location').commands!.save!
  const submit = (data: Row, name: string) => {
    const form = new FormData()
    form.set('name', name)
    return save.input(form, { id: 'wh:adjustment', creating: false, data } as never, {}) as Row
  }
  assert.equal(submit(opened, 'Điều chỉnh tồn kho').name, 'Inventory adjustment')
  assert.equal(submit(opened, 'Chênh lệch kiểm kê').name, 'Chênh lệch kiểm kê')
  assert.equal(submit(await modal('vi', 'shelf'), 'Inventory adjustment').name, 'Inventory adjustment')
  await r.save('stock.saveLocation', {
    ...submit(opened, 'Điều chỉnh tồn kho'),
    usage: 'inventory',
  })
  assert.equal((await modal('en', 'wh:adjustment')).record.name, 'Inventory adjustment')
  assert.equal((await modal('vi', 'wh:adjustment')).record.name, 'Điều chỉnh tồn kho')
})
