import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest, sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import {
  addShelfLifeMonths,
  lotDatePatch,
  lotAvailable,
} from '../packages/ketsuite/src/modules/stock/lot-policy.ts'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'
import { legacyModules } from './fixtures/legacy-modules.ts'

async function boot(t: TestContext) {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = async (fn: string, input: Row, company = 'acme') =>
    (await app.fixture.call<Row>(fn, input, { scope: { company, branches: null } })).value
  for (const id of ['acme', 'other']) {
    await fixture('partner.savePartner', { id: `${id}-party`, kind: 'company', name: id })
    await fixture('company.saveCompany', { id, partnerId: `${id}-party`, currency: 'VND' })
  }
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'test-password',
    name: 'Owner',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-acme', userId: 'owner', companyId: 'acme' })
  await app.client.login({ login: 'owner', password: 'test-password' })
  const call = async (fn: string, input: Row) => (await app.client.call<Row>(fn, input)).value
  const save = async (fn: string, input: Row) => {
    const result = await call(fn, input)
    assert.notEqual(result.ok, false, JSON.stringify(result))
    return result
  }
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  await save('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'each', relativeFactor: '6' })
  await save('uom.saveUnit', { id: 'carton', name: 'Carton', relativeUomId: 'each', relativeFactor: '24' })
  const create = (id: string, defaultCode: string) =>
    call('product.saveRecord', { id, name: id, type: 'goods', defaultCode, uomId: 'each' })
  const get = async (id: string): Promise<Row> => {
    const template = await call('product.getTemplate', { id })
    const defaultVariant = (template.variants as Row[]).find((row) => row.combinationKey === '')
    return { ...template, defaultCode: defaultVariant?.defaultCode, barcode: defaultVariant?.barcode }
  }
  return { app, deployment, fixture, call, save, create, get }
}

async function stocked(t: TestContext) {
  const base = await boot(t)
  const { save } = base
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await save('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' })
  await save('stock.savePickingType', {
    id: 'out',
    name: 'Delivery',
    code: 'outgoing',
    defaultLocationSrcId: 'wh:stock',
    defaultLocationDestId: 'customer',
  })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    isStorable: true,
    tracking: 'lot',
    shelfLifeMonths: 12,
    bestBeforeDays: 30,
    removalDays: 10,
    alertDays: 45,
  })
  const lot = async (id: string, expirationDate: string, extra: Row = {}) => {
    await save('stock.createLot', { id, productId: 'goods:default', name: id, expirationDate, ...extra })
    await save('stock.adjustInventory', {
      id: `count-${id}`,
      productId: 'goods:default',
      locationId: 'wh:stock',
      inventoryLocationId: 'adjustment',
      countedQuantity: '5',
      productUomId: 'each',
      lotId: id,
    })
  }
  const move = async (id: string, quantity = '4') => {
    await save('stock.createPicking', { id: `pick-${id}`, name: id, pickingTypeId: 'out' })
    await save('stock.addMove', {
      id,
      name: id,
      pickingId: `pick-${id}`,
      productId: 'goods:default',
      productUomId: 'each',
      productUomQty: quantity,
    })
    await save('stock.confirmPicking', { id: `pick-${id}` })
  }
  const lots = async () =>
    (await base.app.client.call<Row[]>('stock.listLots', { productId: 'goods:default' })).value
  return { ...base, lot, move, lots }
}

test('lot calendar defaults clamp month ends and preserve explicit overrides when expiry shifts', () => {
  assert.equal(addShelfLifeMonths('2024-01-31T00:00:00Z', 1), '2024-02-29T00:00:00.000Z')
  assert.equal(addShelfLifeMonths('2024-02-29T00:00:00Z', 12), '2025-02-28T00:00:00.000Z')
  const template = { shelfLifeMonths: 12, bestBeforeDays: 30, removalDays: 10, alertDays: 45 }
  const dates = lotDatePatch({ manufacturingDate: '2030-01-31T00:00:00Z' }, undefined, template)
  assert.equal(dates.expirationDate, '2031-01-31T00:00:00.000Z')
  assert.equal(dates.removalDate, '2031-01-21T00:00:00.000Z')
  const overridden = { ...dates, ...lotDatePatch({ removalDate: '2031-01-02T00:00:00Z' }, dates, template) }
  const shifted = lotDatePatch({ expirationDate: '2031-02-28T00:00:00Z' }, overridden, template)
  assert.equal(shifted.bestBeforeDate, '2031-01-29T00:00:00.000Z')
  assert.equal(shifted.removalDate, undefined)
  assert.equal(lotAvailable({ active: true, removalDate: '2000-01-01' }), false)
  assert.equal(lotAvailable({ active: true, quarantined: true }), false)
})

test('Commerce shelf life is atomic, bounded and applies to new lots without rewriting existing dates', async (t) => {
  const { save, call, lots, get } = await stocked(t)
  await save('stock.createLot', {
    id: 'dated',
    productId: 'goods:default',
    name: 'Dated',
    manufacturingDate: '2030-01-31T00:00:00Z',
  })
  const before = (await lots())[0]!
  assert.equal(before.expirationDate, '2031-01-31T00:00:00.000Z')
  for (const shelfLifeMonths of [0, 121]) {
    const rejected = await call('product.saveRecord', {
      id: 'goods',
      name: 'Must roll back',
      type: 'goods',
      expectedRevisionId: (await get('goods')).revisionId,
      shelfLifeMonths,
    })
    assert.equal(rejected.ok, false)
    assert.equal((await get('goods')).name, 'Goods')
  }
  await save('stock.configureProduct', {
    templateId: 'goods',
    isStorable: true,
    tracking: 'lot',
    shelfLifeMonths: 2,
  })
  assert.deepEqual((await lots())[0], before)
  await save('stock.createLot', {
    id: 'next',
    productId: 'goods:default',
    name: 'Next',
    manufacturingDate: '2030-01-31T00:00:00Z',
  })
  assert.equal((await lots()).find((row) => row.id === 'next')!.expirationDate, '2030-03-31T00:00:00.000Z')
  const invalid = await call('stock.saveLot', {
    id: 'dated',
    productId: 'goods:default',
    name: 'Dated',
    manufacturingDate: '2032-01-01T00:00:00Z',
  })
  assert.equal(invalid.ok, false)
  assert.deepEqual(
    (await lots()).find((row) => row.id === 'dated'),
    before,
  )
})

test('Commerce FEFO uses removal dates, skips blocked lots, reassigns open reservations and records quarantine history', async (t) => {
  const { app, lot, move, save, call, lots } = await stocked(t)
  await lot('z-early', '2031-07-01T00:00:00Z', { removalDate: '2031-02-01T00:00:00Z' })
  await lot('a-later', '2031-05-01T00:00:00Z')
  await lot('removed', '2031-08-01T00:00:00Z', { removalDate: '2000-01-01T00:00:00Z' })
  await move('sale')
  await save('stock.reserveMove', { id: 'sale' })
  let lines = await app.adapter!.all(`SELECT * FROM stock_move_line WHERE "moveId" = 'sale'`)
  assert.equal(lines[0]!.lotId, 'z-early')
  const before = (await lots()).find((row) => row.id === 'z-early')!
  assert.equal(
    (
      await call('stock.saveLot', {
        id: before.id,
        productId: before.productId,
        name: before.name,
        quarantined: true,
        reason: '',
      })
    ).ok,
    false,
  )
  await save('stock.saveLot', {
    id: 'z-early',
    productId: 'goods:default',
    name: 'z-early',
    quarantined: true,
    reason: 'Quality inspection',
    expectedRevisionId: before.revisionId,
  })
  lines = await app.adapter!.all(`SELECT * FROM stock_move_line WHERE "moveId" = 'sale'`)
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.lotId, 'a-later')
  const history = (await app.client.call<Row[]>('stock.listLotHistory', { lotId: 'z-early' })).value
  assert.equal(history[0]!.reason, 'Quality inspection')
  assert.equal((history[0]!.after as Row).quarantined, true)
  const blocked = await call('stock.saveMoveLine', {
    id: 'manual-blocked',
    moveId: 'sale',
    quantity: '1',
    lotId: 'removed',
  })
  assert.equal(blocked.ok, false)
  await save('stock.completePicking', { id: 'pick-sale' })
  const done = await app.adapter!.all(`SELECT * FROM stock_move_line WHERE "moveId" = 'sale'`)
  assert.equal(done[0]!.lotId, 'a-later', 'completion consumes the exact reserved lot')
  assert.equal(Number(done[0]!.quantity), 4)
})

test('Commerce refuses an expiry edit on picked stock and rechecks dates at completion', async (t) => {
  const { app, lot, move, save, call } = await stocked(t)
  await lot('picked', '2031-08-01T00:00:00Z')
  await move('picked-sale')
  await save('stock.reserveMove', { id: 'picked-sale' })
  const line = (await app.adapter!.all(`SELECT * FROM stock_move_line WHERE "moveId" = 'picked-sale'`))[0]!
  await save('stock.saveMoveLine', {
    id: line.id,
    moveId: 'picked-sale',
    quantity: '4',
    lotId: 'picked',
    picked: true,
  })
  const refused = await call('stock.saveLot', {
    id: 'picked',
    productId: 'goods:default',
    name: 'picked',
    quarantined: true,
    reason: 'Inspection',
  })
  assert.equal(refused.ok, false)
  assert.equal((refused.errors as Row[])[0]!.code, 'stock.error.lotPicked')
  // Simulate the clock passing a date after picking without changing the reserved identity.
  await app.adapter!.exec(
    `UPDATE stock_lot SET "removalDate" = '2000-01-01T00:00:00.000Z' WHERE id = 'picked'`,
  )
  const completion = await call('stock.completePicking', { id: 'pick-picked-sale' })
  assert.equal(completion.ok, false)
  assert.equal((completion.errors as Row[])[0]!.code, 'stock.error.lotUnavailable')
  const quant = (
    await app.adapter!.all(
      `SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "lotId" = 'picked' AND "locationId" = 'wh:stock'`,
    )
  )[0]!
  assert.equal(Number(quant.quantity), 5)
  assert.equal(Number(quant.reservedQuantity), 4)
})

test('Commerce lot dates preserve manual overrides, reject impossible offsets and filter alerts by their own date', async (t) => {
  const { save, call, lots, app } = await stocked(t)
  await save('stock.createLot', {
    id: 'override',
    productId: 'goods:default',
    name: 'Override',
    expirationDate: '2031-06-01T00:00:00Z',
    removalDate: '2031-02-01T00:00:00Z',
    alertDate: '2000-01-01T00:00:00Z',
  })
  const before = (await lots())[0]!
  await save('stock.saveLot', {
    id: 'override',
    productId: 'goods:default',
    name: 'Override',
    expirationDate: '2031-07-01T00:00:00Z',
    expectedRevisionId: before.revisionId,
  })
  const after = (await lots())[0]!
  assert.equal(after.removalDate, before.removalDate)
  assert.equal(after.alertDate, before.alertDate)
  assert.equal(after.bestBeforeDate, '2031-06-01T00:00:00.000Z')
  const stale = await call('stock.saveLot', {
    id: 'override',
    productId: 'goods:default',
    name: 'Lost edit',
    expectedRevisionId: before.revisionId,
  })
  assert.equal(stale.ok, false)
  const invalid = await call('stock.saveLot', {
    id: 'override',
    productId: 'goods:default',
    name: 'Invalid date',
    removalDate: '2032-01-01T00:00:00Z',
  })
  assert.equal(invalid.ok, false)
  assert.deepEqual((await lots())[0], after)
  const alerts = (await app.client.call<Row[]>('stock.listLots', { status: 'alert' })).value
  assert.deepEqual(
    alerts.map((row) => row.id),
    ['override'],
  )
})

test('Commerce serializes quarantine against a competing reservation without keeping blocked stock reserved', async (t) => {
  const { app, lot, move, call, save } = await stocked(t)
  await lot('race', '2031-07-01T00:00:00Z')
  await move('race-sale')
  const quarantine = {
    id: 'race',
    productId: 'goods:default',
    name: 'race',
    quarantined: true,
    reason: 'Quality inspection',
  }
  const results = await Promise.allSettled([
    call('stock.reserveMove', { id: 'race-sale' }),
    call('stock.saveLot', quarantine),
  ])
  for (const result of results)
    if (result.status === 'rejected') assert.match(String(result.reason), /changed|conflict/i)
  if (results[1]!.status === 'rejected') await save('stock.saveLot', quarantine)
  const quants = await app.adapter!.all(`SELECT * FROM stock_quant WHERE "lotId" = 'race'`)
  assert.ok(quants.every((row) => Number(row.reservedQuantity) === 0))
  const lines = await app.adapter!.all(`SELECT * FROM stock_move_line WHERE "moveId" = 'race-sale'`)
  assert.equal(lines.length, 0)
})

test('Commerce lot audit retains initial quarantine and explicitly cleared dates', async (t) => {
  const { app, save } = await stocked(t)
  await save('stock.createLot', {
    id: 'initial-quarantine',
    productId: 'goods:default',
    name: 'Initial quarantine',
    expirationDate: '2031-07-01T00:00:00Z',
    quarantined: true,
    reason: 'Quality inspection',
  })
  const history = async () =>
    (await app.client.call<Row[]>('stock.listLotHistory', { lotId: 'initial-quarantine' })).value
  const initial = (await history())[0]!
  assert.ok(initial, 'Creating a quarantined lot must record its reason and actor')
  assert.equal(initial.reason, 'Quality inspection')
  assert.equal(initial.actorId, 'owner')
  assert.equal((initial.after as Row).quarantined, true)
  await save('stock.saveLot', {
    id: 'initial-quarantine',
    productId: 'goods:default',
    name: 'Initial quarantine',
    alertDate: null,
    reason: 'Clear alert',
  })
  const cleared = (await history()).find((row) => row.reason === 'Clear alert')!
  assert.ok(cleared, 'Clearing a date must remain visible in the audit trail')
  assert.equal((cleared.before as Row).alertDate, '2031-05-17T00:00:00.000Z')
  assert.equal((cleared.after as Row).alertDate, null)
  const newPage = await app.client.get('/admin/stock/lots/new?lang=en')
  assert.equal(newPage.status, 200)
  assert.match(newPage.url, /record=stock.lot%3Anew/)
  const context = await app.client.get('/admin/stock/record/lot/new/context?lang=en')
  assert.equal(context.status, 200)
  assert.equal(((await context.json()) as { data: { save: boolean } }).data.save, true)
})

test('Commerce lot migration retains existing expiry and the former private removal column', async (t) => {
  const { app, deployment, lot } = await stocked(t)
  await lot('legacy', '2031-07-01T00:00:00Z', { removalDate: '2031-06-01T00:00:00Z' })
  const adapter = app.adapter!
  const newLotFields = [
    'manufacturingDate',
    'bestBeforeDate',
    'alertDate',
    'automaticDates',
    'quarantined',
    'revisionId',
  ]
  const newProductFields = ['shelfLifeMonths', 'bestBeforeDays', 'removalDays', 'alertDays']
  const oldModules = legacyModules(
    deployment.modules.map((module) => {
      if (typeof module === 'string' || module.name !== 'stock') return module
      const { LotHistory: _history, ...models } = module.models!
      const lot = models.Lot!
      return {
        ...module,
        version: '0.1.1',
        models: {
          ...models,
          Lot: {
            ...lot,
            fields: Object.fromEntries(
              Object.entries(lot.fields).filter(([field]) => !newLotFields.includes(field)),
            ),
          },
        },
        extend: {
          ...module.extend,
          'product.Template': Object.fromEntries(
            Object.entries(module.extend!['product.Template']!).filter(
              ([field]) => !newProductFields.includes(field),
            ),
          ),
        },
      }
    }),
  )
  await adapter.exec('DROP TABLE stock_lot_history')
  for (const field of newLotFields) await adapter.exec(`ALTER TABLE stock_lot DROP COLUMN "${field}"`)
  for (const field of newProductFields)
    await adapter.exec(`ALTER TABLE product_template DROP COLUMN "${field}"`)
  const placeholder = adapter.name === 'postgres' ? '$1' : '?'
  await adapter.run(`UPDATE ket_migration SET schema = ${placeholder} WHERE id = 1`, [
    JSON.stringify(schemaFromManifest(compose(oldModules, { headless: true, companies: true }))),
  ])
  const manifest = compose(deployment.modules, { headless: true, companies: true })
  await migrateOne(adapter, manifest)
  const row = (await adapter.all(`SELECT * FROM stock_lot WHERE id = 'legacy'`))[0]!
  assert.equal(new Date(String(row.expirationDate)).toISOString(), '2031-07-01T00:00:00.000Z')
  assert.equal(new Date(String(row.removalDate)).toISOString(), '2031-06-01T00:00:00.000Z')
  for (const field of newLotFields) assert.equal(row[field], null)
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})
