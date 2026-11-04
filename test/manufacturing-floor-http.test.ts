import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

test('manufacturing floor HTTP: overuse is confirmed, components go back, scrap posts to cost of goods and output is weighed', async (t) => {
  const r = await boot(t)
  for (const [id, accountType] of [
    ['156', 'asset_current'],
    ['151', 'asset_current'],
    ['1541', 'asset_current'],
    ['632', 'expense_direct_cost'],
    ['33811', 'liability_current'],
    ['13811', 'asset_receivable'],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile: false })
  await r.save('account.saveJournal', { id: 'kho', name: 'Kho', code: 'KHO', type: 'general' })
  await r.save('stock.saveAccountingSetting', {
    journalId: 'kho',
    valuationAccountId: '156',
    supplierAccountId: '151',
    productionAccountId: '1541',
    cogsAccountId: '632',
    gainAccountId: '33811',
    lossAccountId: '13811',
  })
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'production', name: 'Sản xuất', usage: 'production' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Kiểm kê', usage: 'inventory' })
  const variant: Record<string, string> = {}
  for (const [id, name, cost, stock] of [
    ['nl1', 'NL-001', '62000', '50'],
    ['nl2', 'NL-002', '98000', '20'],
    ['xp', 'XP-01A', '0', null],
  ] as const) {
    await r.save('product.saveRecord', {
      id,
      name,
      type: 'goods',
      defaultCode: name,
      uomId: 'each',
      listPrice: '0',
    })
    await r.save('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
    variant[id] = String(
      ((await r.call('product.listVariants', { templateId: id })) as unknown as Row[])[0]!.id,
    )
    await r.save('product.setCost', { productId: variant[id], standardPrice: cost })
    if (stock)
      await r.save('stock.adjustInventory', {
        id: `seed-${id}`,
        productId: variant[id],
        locationId: 'wh:stock',
        inventoryLocationId: 'count',
        countedQuantity: stock,
        productUomId: 'each',
      })
  }
  await r.save('manufacturing.saveBom', {
    id: 'xp-bom',
    code: 'XP-01',
    productId: variant.xp,
    productQty: '100',
    productUomId: 'each',
    consumption: 'warning',
    unitWeight: '0.05',
    weightTolerance: '5',
    lines: [
      { id: 'nl1-line', productId: variant.nl1, productQty: '3', productUomId: 'each' },
      { id: 'nl2-line', productId: variant.nl2, productQty: '2', productUomId: 'each' },
    ],
  })
  await r.save('manufacturing.saveProduction', {
    id: 'mo-4',
    name: 'HCM/SX/0004',
    bomId: 'xp-bom',
    productQty: '100',
    productUomId: 'each',
    sourceLocationId: 'wh:stock',
    productionLocationId: 'production',
    destinationLocationId: 'wh:stock',
    scheduledStart: '2026-10-29T01:00:00.000Z',
  })
  await r.save('manufacturing.confirmProduction', { id: 'mo-4', version: 1 })
  const path = '/admin/manufacturing/orders/mo-4?lang=vi'
  const post = (values: Record<string, string>) =>
    r.app.client.post(path, new URLSearchParams(values), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })
  const usage = async () =>
    ((await r.call('manufacturing.getConsumption', { id: 'mo-4' })).components as Row[]).find(
      (entry) => entry.productId === variant.nl1,
    )!

  const page = await (await r.app.client.get(path)).text()
  assert.match(page, /Xác nhận dùng quá định mức/)
  assert.match(page, /Khối lượng mẻ này \(kg\)/)
  assert.match(page, /id="manufacturing-order-scrap"/)
  const grid = (consumed: string) =>
    JSON.stringify({
      added: [],
      updated: [{ id: variant.nl1, values: { consumed } }],
      removed: [],
      order: null,
    })
  const warned = await post({ action: 'consume', components: grid('4') })
  assert.equal(warned.status, 200)
  assert.match(await warned.text(), /NL-001: dùng quá định mức \(cần 3\)/)
  assert.equal((await post({ action: 'consume', components: grid('4'), confirmOveruse: '1' })).status, 303)
  assert.equal((await usage()).consumed, '4')

  const tooMuch = await post({ action: 'return', productId: variant.nl1, quantity: '5' })
  assert.match(await tooMuch.text(), /Trả nhiều hơn số đã dùng \(đang dùng 4\)/)
  assert.equal((await post({ action: 'return', productId: variant.nl1, quantity: '1' })).status, 303)
  assert.deepEqual([(await usage()).consumed, (await usage()).returned], ['3', '1'])

  const noReason = await post({ action: 'scrap', productId: variant.nl2, quantity: '0.5', reason: '' })
  assert.match(await noReason.text(), /Cần nhập lý do/)
  assert.equal(
    (await post({ action: 'scrap', productId: variant.nl2, quantity: '0.5', reason: 'Đổ vỡ khi nấu' }))
      .status,
    303,
  )
  const scrapPickings = (
    (await r.app.adapter!.all(sql('SELECT DISTINCT "pickingId" FROM stock_valuation_layer WHERE kind = ?'), [
      'scrap',
    ])) as Row[]
  ).map((row) => String(row.pickingId))
  const posted = async (account: string, side: 'debit' | 'credit') =>
    Number(
      (
        (await r.app.adapter!.all(
          sql(
            `SELECT SUM(${side}) AS total FROM account_move_line WHERE "accountId" = ? AND "moveId" IN (SELECT "accountMoveId" FROM stock_valuation_layer WHERE "pickingId" = ?)`,
          ),
          [account, scrapPickings[0]],
        )) as Row[]
      )[0]?.total ?? 0,
    )
  // Python: 0.5 × 98,000 = 49,000.
  assert.equal(scrapPickings.length, 1)
  assert.deepEqual([await posted('632', 'debit'), await posted('156', 'credit')], [49_000, 49_000])

  // Python: 100 × 0.05 kg ± 5% = 4.75 – 5.25 kg.
  const heavy = await post({ action: 'output', quantity: '100', weight: '6' })
  assert.equal(heavy.status, 200)
  assert.match(await heavy.text(), /Khối lượng phải từ 4.75 đến 5.25 kg/)
  assert.equal((await post({ action: 'output', quantity: '100', weight: '5.2' })).status, 303)
  assert.equal((await r.call('manufacturing.getProduction', { id: 'mo-4' })).quantityProduced, '100')
})
