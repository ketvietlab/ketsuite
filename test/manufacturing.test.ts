import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, manufacturing, partner, product, stock, uom, user } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user, uom, product, stock, manufacturing]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot(componentTracking: 'none' | 'lot' = 'none') {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  await call('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' }, adapter)
  for (const [templateId, productId, name, tracking] of [
    ['fruit-template', 'fruit', 'Fruit', componentTracking],
    ['basket-template', 'basket', 'Fruit basket', 'none'],
  ]) {
    await call(
      'product.saveTemplate',
      { id: templateId, name, type: 'goods', uomId: 'kg', listPrice: '0' },
      adapter,
    )
    await call(
      'product.saveVariant',
      { id: productId, templateId, combinationKey: '', defaultCode: productId.toUpperCase() },
      adapter,
    )
    await call('stock.configureProduct', { templateId, isStorable: true, tracking }, adapter)
  }
  for (const [id, name, usage] of [
    ['stock', 'Stock', 'internal'],
    ['production', 'Production', 'production'],
    ['finished', 'Finished goods', 'internal'],
    ['inventory', 'Inventory adjustment', 'inventory'],
  ])
    await call('stock.saveLocation', { id, name, usage }, adapter)
  if (componentTracking === 'lot')
    await call('stock.createLot', { id: 'fruit-lot', productId: 'fruit', name: 'FRUIT/001' }, adapter)
  await call(
    'stock.adjustInventory',
    {
      id: 'seed-fruit',
      productId: 'fruit',
      locationId: 'stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '100',
      lotId: componentTracking === 'lot' ? 'fruit-lot' : undefined,
      productUomId: 'kg',
    },
    adapter,
  )
  return adapter
}

test('manufacturing: a BOM drives component consumption, work orders, and finished stock', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveWorkCenter',
      { id: 'packing', code: 'PACK', name: 'Packing', capacity: '2' },
      adapter,
    )
    const bom = (
      await call(
        'manufacturing.saveBom',
        {
          id: 'basket-bom',
          code: 'BASKET-01',
          productId: 'basket',
          productQty: '10',
          productUomId: 'kg',
          operations: [
            {
              id: 'pack-operation',
              name: 'Pack basket',
              workCenterId: 'packing',
              durationExpected: 15,
            },
          ],
          lines: [
            {
              id: 'fruit-line',
              productId: 'fruit',
              productQty: '12',
              productUomId: 'kg',
              operationId: 'pack-operation',
            },
          ],
        },
        adapter,
      )
    ).value as Row
    assert.equal(bom.ok, true)

    const saved = (
      await call(
        'manufacturing.saveProduction',
        {
          id: 'mo-1',
          name: 'MO/0001',
          bomId: 'basket-bom',
          productQty: '20',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart: '2026-08-24T08:00:00.000Z',
        },
        adapter,
      )
    ).value as Row
    assert.equal(saved.version, 1)

    const confirmed = (await call('manufacturing.confirmProduction', { id: 'mo-1', version: 1 }, adapter))
      .value as Row
    assert.equal(confirmed.ok, true)
    assert.deepEqual(confirmed.shortages, [])

    let production = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    assert.equal(production.state, 'confirmed')
    assert.equal((production.workOrders as Row[]).length, 1)
    const raw = (production.moves as Row[]).find((entry) => entry.kind === 'component')!
    assert.equal(
      Number((raw.move as Row).productUomQty),
      24,
      'BOM demand scales with the production quantity',
    )

    const work = (production.workOrders as Row[])[0]!
    await call('manufacturing.startWorkOrder', { id: work.id, version: work.version }, adapter)
    const active = ((await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row)
      .workOrders as Row[]
    await call('manufacturing.finishWorkOrder', { id: active[0]!.id, version: active[0]!.version }, adapter)

    production = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    const completed = (
      await call(
        'manufacturing.completeProduction',
        { id: 'mo-1', version: production.version, producedQuantity: '20' },
        adapter,
      )
    ).value as Row
    assert.equal(completed.ok, true)
    const balances = await adapter.all(
      'SELECT "productId", "locationId", quantity FROM stock_quant WHERE "locationId" IN (?, ?) ORDER BY "productId", "locationId"',
      ['stock', 'finished'],
    )
    assert.equal(Number(balances.find((row) => row.productId === 'fruit')!.quantity), 76)
    assert.equal(Number(balances.find((row) => row.productId === 'basket')!.quantity), 20)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a picked component reservation is not reserved and consumed twice', async () => {
  const adapter = await boot('lot')
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'tracked-bom',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-tracked',
        name: 'MO/TRACKED',
        bomId: 'tracked-bom',
        productQty: '20',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T08:00:00.000Z',
      },
      adapter,
    )
    await call('manufacturing.confirmProduction', { id: 'mo-tracked', version: 1 }, adapter)
    const production = (await call('manufacturing.getProduction', { id: 'mo-tracked' }, adapter)).value as Row
    const component = (production.moves as Row[]).find((entry) => entry.kind === 'component')!
    const move = component.move as Row
    const lines = await adapter.all('SELECT id, quantity, "lotId" FROM stock_move_line WHERE "moveId" = ?', [
      move.id,
    ])
    assert.equal(lines.length, 1)
    await call(
      'stock.saveMoveLine',
      {
        id: lines[0]!.id,
        moveId: move.id,
        quantity: lines[0]!.quantity,
        lotId: lines[0]!.lotId,
        picked: true,
      },
      adapter,
    )
    const completed = (
      await call(
        'manufacturing.completeProduction',
        { id: 'mo-tracked', version: production.version, producedQuantity: '20' },
        adapter,
      )
    ).value as Row
    assert.equal(completed.ok, true)
    const balance = await adapter.all(
      'SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?',
      ['fruit', 'stock'],
    )
    assert.equal(Number(balance[0]!.quantity), 76)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: completion fails closed when components are short', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'short-bom',
        productId: 'basket',
        productQty: '1',
        productUomId: 'kg',
        lines: [{ productId: 'fruit', productQty: '150', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-short',
        name: 'MO/SHORT',
        bomId: 'short-bom',
        productQty: '1',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T08:00:00.000Z',
      },
      adapter,
    )
    const confirmed = (await call('manufacturing.confirmProduction', { id: 'mo-short', version: 1 }, adapter))
      .value as Row
    assert.equal((confirmed.shortages as Row[])[0]!.quantity, '50')
    const completed = (
      await call('manufacturing.completeProduction', { id: 'mo-short', version: 2 }, adapter)
    ).value as Row
    assert.equal(completed.ok, false)
    assert.equal((completed.errors as Row[])[0]!.code, 'manufacturing.error.stockShortage')
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a BOM in use cannot be rewritten under its production orders', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveWorkCenter',
      { id: 'packing', code: 'PACK', name: 'Packing', capacity: '2' },
      adapter,
    )
    const bom = {
      id: 'bom-1',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      operations: [
        { id: 'op-a', name: 'Op A', workCenterId: 'packing', durationExpected: 5 },
        { id: 'op-b', name: 'Op B', workCenterId: 'packing', durationExpected: 5 },
      ],
      lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
    }
    await call('manufacturing.saveBom', bom, adapter)
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-1',
        name: 'MO-1',
        bomId: 'bom-1',
        productQty: '10',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T00:00:00.000Z',
      },
      adapter,
    )
    await call('manufacturing.confirmProduction', { id: 'mo-1', version: 1 }, adapter)

    // Saving a BOM rewrites its operations. A confirmed order's work orders
    // point at those rows by id, through a reference the schema says cannot be
    // null — so an edit that drops one leaves a work order pointing at nothing.
    const refused = (
      await call('manufacturing.saveBom', { ...bom, operations: [bom.operations[0]] }, adapter)
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Array<{ code: string }>)[0]?.code, 'manufacturing.error.bomInUse')

    const operations = await adapter.all('SELECT id FROM manufacturing_operation ORDER BY id')
    const workOrders = await adapter.all('SELECT "operationId" FROM manufacturing_work_order')
    const known = new Set(operations.map((row) => String(row.id)))
    assert.deepEqual(
      workOrders.filter((row) => !known.has(String(row.operationId))),
      [],
      'no work order may point at an operation that no longer exists',
    )

    // Once the order is out of the way the BOM is editable again: refusing
    // forever would make a BOM write-once the first time it produced anything.
    await call('manufacturing.cancelProduction', { id: 'mo-1', version: 2 }, adapter)
    assert.equal(
      (
        (await call('manufacturing.saveBom', { ...bom, operations: [bom.operations[0]] }, adapter))
          .value as Row
      ).ok,
      true,
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: confirming twice reports the shortage both times', async () => {
  const adapter = await boot()
  try {
    // 500kg demanded against the 100kg the fixture stocks.
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-short',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '500', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-short',
        name: 'MO-SHORT',
        bomId: 'bom-short',
        productQty: '10',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T00:00:00.000Z',
      },
      adapter,
    )
    const first = (await call('manufacturing.confirmProduction', { id: 'mo-short', version: 1 }, adapter))
      .value as Row
    assert.deepEqual(first.shortages, [{ moveId: 'mo-short:raw:l1', quantity: '400' }])

    // The second press used to answer with an empty list — reporting "nothing
    // missing" to an operator staring at a 400kg hole, and reporting it most
    // confidently in the case where the first attempt reserved nothing at all.
    const second = (await call('manufacturing.confirmProduction', { id: 'mo-short', version: 1 }, adapter))
      .value as Row
    assert.deepEqual(second.shortages, first.shortages)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a production order is created once, however many callers ask', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-1',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    const args = {
      id: 'mo-race',
      name: 'MO-RACE',
      bomId: 'bom-1',
      productQty: '10',
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: '2026-08-24T00:00:00.000Z',
    }
    // Two operators pressing create, or a browser resubmitting the form. Every
    // caller must get ok — the function declares itself idempotent — and one
    // row may exist.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call('manufacturing.saveProduction', args, adapter)),
    )
    for (const result of results) assert.equal((result.value as Row).ok, true)
    assert.equal((await adapter.all('SELECT COUNT(*) c FROM manufacturing_production'))[0]!.c, 1)

    // And a name already taken is refused rather than duplicated: the name is
    // what `origin` stamps on every move this order makes.
    const clash = (await call('manufacturing.saveProduction', { ...args, id: 'mo-other' }, adapter))
      .value as Row
    assert.equal(clash.ok, false)
    assert.equal((clash.errors as Array<{ field: string }>)[0]?.field, 'name')
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a completion interrupted after the components are gone finishes on retry', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-1',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-1',
        name: 'MO-1',
        bomId: 'bom-1',
        productQty: '10',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T00:00:00.000Z',
      },
      adapter,
    )
    await call('manufacturing.confirmProduction', { id: 'mo-1', version: 1 }, adapter)

    // Completion cannot run in one transaction — every stock command it calls
    // opens one of its own — so what stands in for atomicity is `to_close` plus
    // the picking states. This is that guarantee: the crash leaves the
    // components consumed and no output booked, which is the worst moment for
    // it to happen.
    await adapter.all(
      "UPDATE manufacturing_production SET state='to_close', version=version+1 WHERE id='mo-1'",
    )
    await call('stock.completePicking', { id: 'mo-1:components', createBackorder: false }, adapter)
    assert.equal(
      (
        await adapter.all(
          'SELECT quantity FROM stock_quant WHERE "productId" = \'fruit\' AND "locationId" = \'stock\'',
        )
      )[0]!.quantity,
      '88',
      'the components are gone',
    )

    const stuck = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    const finished = (
      await call('manufacturing.completeProduction', { id: 'mo-1', version: Number(stuck.version) }, adapter)
    ).value as Row
    assert.equal(finished.ok, true)
    assert.equal(
      ((await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row).state,
      'done',
    )
    assert.equal(
      (
        await adapter.all(
          'SELECT quantity FROM stock_quant WHERE "productId" = \'basket\' AND "locationId" = \'finished\'',
        )
      )[0]!.quantity,
      '10',
      'the retry books the output the crash never got to',
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a production detail reads its own moves, not the factory ledger', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-1',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    for (const id of ['mo-a', 'mo-b']) {
      await call(
        'manufacturing.saveProduction',
        {
          id,
          name: id.toUpperCase(),
          bomId: 'bom-1',
          productQty: '10',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart: '2026-08-24T00:00:00.000Z',
        },
        adapter,
      )
      await call('manufacturing.confirmProduction', { id, version: 1 }, adapter)
    }
    // Both orders have moves. The narrowed read must still return exactly one
    // order's, and every link must resolve — an unresolved move on the detail
    // screen would look like a data loss rather than a bad query.
    const detail = (await call('manufacturing.getProduction', { id: 'mo-a' }, adapter)).value as Row
    const moves = detail.moves as Array<{ moveId: string; move: Row | null }>
    assert.equal(moves.length > 0, true)
    for (const link of moves) {
      assert.notEqual(link.move, null, `${link.moveId} did not resolve`)
      assert.match(String(link.moveId), /^mo-a:/u)
    }
  } finally {
    await adapter.close()
  }
})

test('manufacturing: work centers check their code and money, archive, and queue open work orders', async () => {
  const adapter = await boot()
  try {
    const save = async (input: Record<string, unknown>) =>
      (await call('manufacturing.saveWorkCenter', { name: 'Packing', ...input }, adapter)).value as Row
    const code = (result: Row) => (result.errors as Array<{ code: string }> | undefined)?.[0]?.code
    assert.equal(code(await save({ id: 'bad', code: 'PACK LINE' })), 'manufacturing.error.codeInvalid')
    assert.equal(code(await save({ id: 'long', code: 'PACKAGING-01' })), 'manufacturing.error.codeInvalid')
    assert.equal(
      code(await save({ id: 'free', code: 'FREE', costPerHour: '1.5' })),
      'manufacturing.error.moneyInvalid',
    )
    assert.equal(
      code(await save({ id: 'neg', code: 'NEG', costPerHour: '-1' })),
      'manufacturing.error.moneyInvalid',
    )
    assert.equal(
      code(await save({ id: 'zero', code: 'ZERO', capacity: '0' })),
      'manufacturing.error.capacityInvalid',
    )
    // The code is said and printed in capitals, so a lower-case one is stored as such.
    assert.equal((await save({ id: 'packing', code: 'pack-1', skill: 'pack', capacity: '2' })).ok, true)
    assert.equal(code(await save({ id: 'other', code: 'PACK-1' })), 'manufacturing.error.codeTaken')
    // An edit that leaves the skill out keeps it.
    assert.equal((await save({ id: 'packing', code: 'PACK-1', name: 'Đóng gói' })).ok, true)
    let [center] = (await call('manufacturing.listWorkCenters', {}, adapter)).value as Row[]
    assert.deepEqual([center.code, center.name, center.skill], ['PACK-1', 'Đóng gói', 'pack'])

    await call(
      'manufacturing.saveBom',
      {
        id: 'basket-bom',
        code: 'BASKET-01',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        operations: [
          { id: 'cut', name: 'Cut', workCenterId: 'packing', durationExpected: 5, sequence: 1 },
          { id: 'pack', name: 'Pack', workCenterId: 'packing', durationExpected: 15, sequence: 2 },
        ],
        lines: [{ id: 'fruit-line', productId: 'fruit', productQty: '1', productUomId: 'kg' }],
      },
      adapter,
    )
    for (const [id, name, scheduledStart] of [
      ['mo-late', 'MO/0002', '2026-08-25T08:00:00.000Z'],
      ['mo-soon', 'MO/0001', '2026-08-24T08:00:00.000Z'],
    ]) {
      await call(
        'manufacturing.saveProduction',
        {
          id,
          name,
          bomId: 'basket-bom',
          productQty: '10',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart,
        },
        adapter,
      )
      await call('manufacturing.confirmProduction', { id, version: 1 }, adapter)
    }
    const queueOf = async () =>
      (
        ((await call('manufacturing.getWorkCenter', { id: 'packing' }, adapter)).value as Row).queue as Row[]
      ).map((row) => `${String(row.productionName)} ${String(row.name)} ${String(row.state)}`)
    // Ready steps first, each group by the order's scheduled start, then by sequence.
    assert.deepEqual(await queueOf(), [
      'MO/0001 Cut ready',
      'MO/0002 Cut ready',
      'MO/0001 Pack pending',
      'MO/0002 Pack pending',
    ])
    const late = (
      (await adapter.all(
        'SELECT id, version FROM manufacturing_work_order WHERE "productionId" = ? AND name = ?',
        ['mo-late', 'Cut'],
      )) as Row[]
    )[0]
    assert.equal(
      (
        (await call('manufacturing.startWorkOrder', { id: late.id, version: late.version }, adapter))
          .value as Row
      ).ok,
      true,
    )
    // Running work leads the queue, whatever its order's date.
    assert.equal((await queueOf())[0], 'MO/0002 Cut in_progress')

    assert.equal(
      ((await call('manufacturing.archiveWorkCenter', { id: 'packing' }, adapter)).value as Row).ok,
      true,
    )
    assert.deepEqual((await call('manufacturing.listWorkCenters', {}, adapter)).value, [])
    assert.equal(
      ((await call('manufacturing.restoreWorkCenter', { id: 'packing' }, adapter)).value as Row).ok,
      true,
    )
    ;[center] = (await call('manufacturing.listWorkCenters', {}, adapter)).value as Row[]
    assert.equal(center.active, true)
    assert.equal(
      code((await call('manufacturing.archiveWorkCenter', { id: 'missing' }, adapter)).value as Row),
      'manufacturing.error.missing',
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: BOM versions need another approver, carry loss and timing, and leave confirmed orders alone', async () => {
  const adapter = await boot()
  try {
    const as = (actor: string) => (name: string, args: Record<string, unknown>) =>
      callFn(name, args, { adapter, manifest, scope, actor }).then((result) => result.value as Row)
    for (const id of ['foreman', 'owner'])
      await call('user.createUser', { id, login: id, password: 'synthetic-password', name: id }, adapter)
    const foreman = as('foreman')
    const owner = as('owner')
    const errorsOf = (result: Row) =>
      (result.errors as Array<{ field: string; code: string; params?: { line: number } }>).map((error) =>
        `${error.field} ${error.code} ${String(error.params?.line ?? '')}`.trim(),
      )
    await foreman('manufacturing.saveWorkCenter', { id: 'cook', code: 'NAU', name: 'Nấu' })
    const bom = (lines: Row[], operations: Row[] = []) => ({
      id: 'jam-v1',
      code: 'BTP-02',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      consumption: 'warning',
      draft: true,
      lines,
      operations,
    })

    // Each refusal names its row, counted from 1.
    assert.deepEqual(
      errorsOf(
        await foreman(
          'manufacturing.saveBom',
          bom(
            [
              { productId: 'fruit', productQty: '1', productUomId: 'kg' },
              { productId: '', productQty: '1', productUomId: 'kg' },
              { productId: 'fruit', productQty: '1', productUomId: 'kg', lossPercent: '51' },
            ],
            [{ name: 'Nấu', durationExpected: 30 }],
          ),
        ),
      ),
      [
        'operations.0.workCenterId manufacturing.error.operationCenter 1',
        'lines.1.productId manufacturing.error.lineProduct 2',
        'lines.2.lossPercent manufacturing.error.lineLoss 3',
      ],
    )
    assert.deepEqual(
      errorsOf(await foreman('manufacturing.saveBom', { ...bom([]), consumption: 'sometimes' })),
      ['consumption manufacturing.error.invalid'],
    )
    const saved = await foreman(
      'manufacturing.saveBom',
      bom(
        [
          {
            id: 'jam-fruit',
            productId: 'fruit',
            productQty: '0.25',
            productUomId: 'kg',
            lossPercent: '2',
            operationId: 'jam-cook',
          },
        ],
        [
          { id: 'jam-cook', name: 'Nấu', workCenterId: 'cook', durationExpected: 30, timeMode: 'quantity' },
          { id: 'jam-cure', name: 'Ủ', workCenterId: 'cook', durationExpected: 600, timeMode: 'fixed' },
        ],
      ),
    )
    assert.equal(saved.ok, true, JSON.stringify(saved))
    // A draft makes nothing until it is approved.
    assert.equal(
      (
        await foreman('manufacturing.saveProduction', {
          id: 'mo-draft',
          name: 'LSX/0000',
          bomId: 'jam-v1',
          productQty: '20',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart: '2026-10-29T01:00:00.000Z',
        })
      ).ok,
      false,
    )
    assert.equal((await foreman('manufacturing.submitBom', { id: 'jam-v1', reason: '' })).ok, false)
    assert.equal(
      (await foreman('manufacturing.submitBom', { id: 'jam-v1', reason: 'Công thức đầu' })).ok,
      true,
    )
    // A version in review is a record: it does not change.
    assert.deepEqual(errorsOf(await foreman('manufacturing.saveBom', bom([]))), [
      'state manufacturing.error.state',
    ])
    // Whoever submitted it does not approve it.
    assert.deepEqual(errorsOf(await foreman('manufacturing.approveBom', { id: 'jam-v1' })), [
      'approvedBy manufacturing.error.sameReviewer',
    ])
    assert.equal((await owner('manufacturing.approveBom', { id: 'jam-v1' })).ok, true)

    await foreman('manufacturing.saveProduction', {
      id: 'mo-3',
      name: 'HCM/SX/0003',
      bomId: 'jam-v1',
      productQty: '20',
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: '2026-10-29T01:00:00.000Z',
    })
    assert.equal((await owner('manufacturing.confirmProduction', { id: 'mo-3', version: 1 })).ok, true)
    const demand = async () =>
      (
        await adapter.all('SELECT m."productUomQty" AS quantity FROM stock_move m WHERE m.id = ?', [
          'mo-3:raw:jam-fruit',
        ])
      )[0]?.quantity
    // 0.25 kg a 10 kg batch with 2% loss, for 20 kg: Python 0.25 * 1.02 * 20 / 10 = 0.51.
    assert.equal(String(await demand()), '0.51')
    const minutes = (
      (await adapter.all(
        'SELECT name, "durationExpected" AS minutes FROM manufacturing_work_order ORDER BY sequence',
      )) as Row[]
    ).map((row) => `${String(row.name)} ${String(row.minutes)}`)
    // Cooking scales with the order (30 × 2); curing a batch does not.
    assert.deepEqual(minutes, ['Nấu 60', 'Ủ 600'])

    // A new version starts as a draft copy without the code; asking twice answers the same draft.
    const next = await foreman('manufacturing.newBomVersion', { id: 'jam-v1', newId: 'jam-v2' })
    assert.deepEqual([next.ok, next.id, next.version], [true, 'jam-v2', 2])
    assert.equal(
      (await foreman('manufacturing.newBomVersion', { id: 'jam-v1', newId: 'jam-v9' })).id,
      'jam-v2',
    )
    const draft = (await foreman('manufacturing.getBom', { id: 'jam-v2' })) as Row
    assert.deepEqual(
      [
        draft.state,
        draft.code,
        draft.familyCode,
        (draft.lines as Row[]).length,
        (draft.versions as Row[]).length,
      ],
      ['draft', null, 'BTP-02', 1, 2],
    )
    const [line] = draft.lines as Row[]
    assert.equal(line?.operationId, 'jam-v2:operation:10', 'the copy points at its own operation')
    await foreman('manufacturing.saveBom', {
      id: 'jam-v2',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      lines: [{ productId: 'fruit', productQty: '0.3', productUomId: 'kg' }],
      operations: [],
    })
    await foreman('manufacturing.submitBom', { id: 'jam-v2', reason: 'Tăng trái cây' })
    assert.equal((await owner('manufacturing.rejectBom', { id: 'jam-v2', reason: '' })).ok, false)
    assert.equal(
      (await owner('manufacturing.rejectBom', { id: 'jam-v2', reason: 'Thiếu công đoạn' })).ok,
      true,
    )
    await foreman('manufacturing.submitBom', { id: 'jam-v2', reason: 'Tăng trái cây' })
    assert.equal((await owner('manufacturing.approveBom', { id: 'jam-v2' })).ok, true)

    const family = (
      (await foreman('manufacturing.listBoms', { includeArchived: true })) as unknown as Row[]
    ).map((row) => `${String(row.id)} ${String(row.state)} ${String(row.code)} ${String(row.familyCode)}`)
    assert.deepEqual(family, ['jam-v2 active BTP-02 BTP-02', 'jam-v1 archived null BTP-02'])
    // The order confirmed on version 1 keeps its numbers.
    assert.equal(String(await demand()), '0.51')
    assert.equal((await foreman('manufacturing.archiveBom', { id: 'jam-v1' })).ok, true)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: the queue orders the floor and says whether components are there, coming or short', async () => {
  const adapter = await boot()
  try {
    const ok = async (name: string, args: Record<string, unknown>) => {
      const result = (await call(name, args, adapter)).value as Row
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    // 12 kg of fruit makes 10 kg of baskets; 100 kg are in stock.
    await ok('manufacturing.saveBom', {
      id: 'basket-bom',
      code: 'BASKET-01',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      lines: [{ id: 'fruit-line', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
    })
    // 40 kg of fruit on its way from a supplier.
    await ok('stock.saveLocation', { id: 'vendor', name: 'Vendor', usage: 'supplier' })
    await ok('stock.savePickingType', {
      id: 'receipts',
      name: 'Receipts',
      code: 'incoming',
      defaultLocationSrcId: 'vendor',
      defaultLocationDestId: 'stock',
    })
    await ok('stock.createPicking', {
      id: 'po-in',
      name: 'PO/IN',
      pickingTypeId: 'receipts',
      locationId: 'vendor',
      locationDestId: 'stock',
    })
    await ok('stock.addMove', {
      id: 'po-in-fruit',
      name: 'Fruit',
      pickingId: 'po-in',
      productId: 'fruit',
      productUomId: 'kg',
      productUomQty: '40',
    })
    await ok('stock.confirmPicking', { id: 'po-in' })

    const order = (id: string, name: string, quantity: string, start: string, extra: Row = {}) =>
      ok('manufacturing.saveProduction', {
        id,
        name,
        productId: 'basket',
        productQty: quantity,
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: start,
        ...extra,
      })
    await order('mo-4', 'HCM/SX/0004', '10', '2026-10-30T01:00:00.000Z')
    await order('mo-2', 'HCM/SX/0002', '50', '2026-10-28T01:00:00.000Z')
    await order('mo-3', 'HCM/SX/0003', '50', '2026-10-29T01:00:00.000Z')
    await order('mo-5', 'HCM/SX/0005', '5', '2026-10-31T01:00:00.000Z', { priority: 1 })
    await order('mo-7', 'HCM/SX/0007', '5', '2026-10-27T01:00:00.000Z')
    await order('mo-8', 'HCM/SX/0008', '10', '2026-11-01T01:00:00.000Z')
    await order('mo-6', 'HCM/SX/0006', '1', '2026-10-26T01:00:00.000Z')
    for (const id of ['mo-4', 'mo-2', 'mo-3']) await ok('manufacturing.confirmProduction', { id, version: 1 })
    await ok('manufacturing.startProduction', { id: 'mo-4', version: 2 })
    await ok('manufacturing.cancelProduction', { id: 'mo-6', version: 1, reason: 'Khách huỷ đơn' })

    // Python: 100 on hand; 0004 takes 12 (88 left), 0002 takes 60 (28), 0003 needs 60 = 28 + 32
    // of the 40 coming (8 left coming). Drafts need 6, 6 and 12 against 0 + 8, without taking.
    const queue = ((await call('manufacturing.productionQueue', {}, adapter)).value as Row[]).map(
      (row) => `${String(row.name)} ${String(row.state)} ${String(row.material)}`,
    )
    assert.deepEqual(queue, [
      'HCM/SX/0004 in_progress ready',
      'HCM/SX/0002 confirmed ready',
      'HCM/SX/0003 confirmed waiting',
      // Priority first, then the scheduled start.
      'HCM/SX/0005 draft waiting',
      'HCM/SX/0007 draft waiting',
      'HCM/SX/0008 draft short',
      'HCM/SX/0006 cancelled null',
    ])
    const [short] = ((await call('manufacturing.productionQueue', {}, adapter)).value as Row[])
      .filter((row) => row.id === 'mo-8')
      .map((row) => row.shortages as Row[])
    assert.deepEqual(short, [{ productId: 'fruit', need: '12', available: '0', incoming: '8' }])

    // A product without a BOM in use makes no order.
    const refused = (
      await call(
        'manufacturing.saveProduction',
        {
          id: 'mo-none',
          name: 'HCM/SX/0009',
          productId: 'fruit',
          productQty: '1',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart: '2026-10-31T01:00:00.000Z',
        },
        adapter,
      )
    ).value as Row
    assert.equal((refused.errors as Row[])[0]?.code, 'manufacturing.error.noBom')
    const cancelled = (await call('manufacturing.getProduction', { id: 'mo-6' }, adapter)).value as Row
    assert.equal(cancelled.cancelReason, 'Khách huỷ đơn')
  } finally {
    await adapter.close()
  }
})

test('manufacturing: recorded use only goes up, takes the oldest-expiring lot, and refuses strict or short', async () => {
  const adapter = await boot('lot')
  try {
    const ok = async (name: string, args: Record<string, unknown>) => {
      const result = (await call(name, args, adapter)).value as Row
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    // A second lot of 20 kg that expires first. Its date stays in the future: an expired lot is not taken.
    await ok('stock.createLot', {
      id: 'fruit-early',
      productId: 'fruit',
      name: 'FRUIT/000',
      expirationDate: '2099-11-01T00:00:00.000Z',
    })
    await ok('stock.adjustInventory', {
      id: 'seed-early',
      productId: 'fruit',
      locationId: 'stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '20',
      lotId: 'fruit-early',
      productUomId: 'kg',
    })
    await ok('manufacturing.saveBom', {
      id: 'basket-bom',
      code: 'BASKET-01',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      consumption: 'flexible',
      lines: [{ id: 'fruit-line', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
    })
    await ok('manufacturing.saveProduction', {
      id: 'mo-2',
      name: 'HCM/SX/0002',
      bomId: 'basket-bom',
      productQty: '20',
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: '2026-10-29T01:00:00.000Z',
    })
    await ok('manufacturing.confirmProduction', { id: 'mo-2', version: 1 })
    const consume = (consumed: string) =>
      call(
        'manufacturing.consumeProduction',
        { id: 'mo-2', components: [{ productId: 'fruit', consumed }] },
        adapter,
      ).then((result) => result.value as Row)
    const codes = (result: Row) => ((result.errors as Row[]) ?? []).map((error) => error.code)
    const usage = async () =>
      (
        ((await call('manufacturing.getConsumption', { id: 'mo-2' }, adapter)).value as Row)
          .components as Row[]
      )[0]

    // 120 kg in stock (100 + 20), need 24.
    const first = await consume('10.5')
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.deepEqual([(await usage())?.need, (await usage())?.consumed], ['24', '10.5'])
    const lines = (await adapter.all(
      'SELECT l."lotId" AS lot, l.quantity FROM stock_move_line l JOIN stock_move m ON m.id = l."moveId" WHERE m."pickingId" = ?',
      [first.pickingId],
    )) as Row[]
    assert.deepEqual(
      lines.map((line) => `${String(line.lot)} ${String(line.quantity)}`),
      ['fruit-early 10.5'],
      'the lot expiring first goes first',
    )
    const picking = (
      (await adapter.all(
        'SELECT p.state, m.origin FROM stock_picking p JOIN stock_move m ON m."pickingId" = p.id WHERE p.id = ?',
        [first.pickingId],
      )) as Row[]
    )[0]
    assert.deepEqual([picking?.state, picking?.origin], ['done', 'HCM/SX/0002'])
    assert.equal(
      ((await call('manufacturing.getProduction', { id: 'mo-2' }, adapter)).value as Row).state,
      'in_progress',
    )

    // Use only goes up.
    assert.deepEqual(codes(await consume('10')), ['manufacturing.error.consumeDecrease'])
    // Flexible: using more than needed records and says so.
    const over = await consume('30')
    assert.equal(over.ok, true, JSON.stringify(over))
    assert.deepEqual(over.overused, [{ productId: 'fruit', need: '24', consumed: '30' }])
    // Python: 20 early + 100 later − 30 used = 90 left; asking 30 + 91 more is short by 1.
    const short = await consume('121')
    assert.deepEqual(codes(short), ['manufacturing.error.consumeShort'])
    assert.equal(((short.errors as Row[])[0]!.params as Row).available, '90')
    assert.equal((await usage())?.consumed, '30', 'a refused record moves nothing')

    // Strict refuses going over.
    await adapter.run('UPDATE manufacturing_bom SET consumption = ? WHERE id = ?', ['strict', 'basket-bom'])
    assert.deepEqual(codes(await consume('31')), ['manufacturing.error.consumeStrict'])

    // Completion takes nothing more for a component used up past its need.
    const done = (await call('manufacturing.completeProduction', { id: 'mo-2', version: 3 }, adapter))
      .value as Row
    assert.equal(done.ok, true, JSON.stringify(done))
    assert.equal((await usage())?.consumed, '30')
  } finally {
    await adapter.close()
  }
})

test('manufacturing: output is recorded in batches with day lots, and closing backflushes then orders or closes the rest', async () => {
  const adapter = await boot()
  try {
    const ok = async (name: string, args: Record<string, unknown>) => {
      const result = (await call(name, args, adapter)).value as Row
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    const codes = (result: Row) => ((result.errors as Row[]) ?? []).map((error) => error.code)
    const order = async (id: string) =>
      (await call('manufacturing.getProduction', { id }, adapter)).value as Row
    await ok('stock.configureProduct', { templateId: 'basket-template', isStorable: true, tracking: 'lot' })
    await ok('manufacturing.saveBom', {
      id: 'basket-bom',
      code: 'BASKET-01',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      consumption: 'flexible',
      lines: [{ id: 'fruit-line', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
    })
    const start = async (id: string, name: string, productQty: string) => {
      await ok('manufacturing.saveProduction', {
        id,
        name,
        bomId: 'basket-bom',
        productQty,
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-10-29T01:00:00.000Z',
      })
      await ok('manufacturing.confirmProduction', { id, version: 1 })
    }
    await start('mo-2', 'HCM/SX/0002', '20')

    // Nothing made yet: the order cannot close.
    const early = (
      await call('manufacturing.completeProduction', { id: 'mo-2', version: 2, rest: 'close' }, adapter)
    ).value as Row
    assert.deepEqual(codes(early), ['manufacturing.error.nothingMade'])

    const day = new Date().toISOString().slice(2, 10).replaceAll('-', '')
    const first = await ok('manufacturing.recordOutput', { id: 'mo-2', quantity: '5' })
    const second = await ok('manufacturing.recordOutput', { id: 'mo-2', quantity: '3.5' })
    assert.deepEqual([first.lotName, second.lotName], [day, `${day}-2`], 'a second batch the same day is -2')
    assert.notEqual(first.pickingId, second.pickingId)
    const once = (await call('manufacturing.completeProduction', { id: 'mo-2', version: 4 }, adapter))
      .value as Row
    assert.deepEqual(
      once.errors,
      [{ field: 'rest', code: 'manufacturing.error.invalid' }],
      'booking the whole plan would book output twice',
    )
    const named = await ok('manufacturing.recordOutput', { id: 'mo-2', quantity: '0' }).catch(() => null)
    assert.equal(named, null, 'zero is refused')
    assert.deepEqual(
      [(await order('mo-2')).state, (await order('mo-2')).quantityProduced],
      ['in_progress', '8.5'],
    )
    const lots = (await adapter.all(
      'SELECT l.name, l.ref, q.quantity FROM stock_quant q JOIN stock_lot l ON l.id = q."lotId" WHERE q."locationId" = ? ORDER BY l.name',
      ['finished'],
    )) as Row[]
    assert.deepEqual(
      lots.map((lot) => `${String(lot.name)} ${String(lot.ref)} ${String(lot.quantity)}`),
      [`${day} HCM/SX/0002 5`, `${day}-2 HCM/SX/0002 3.5`],
    )

    await ok('manufacturing.consumeProduction', {
      id: 'mo-2',
      components: [{ productId: 'fruit', consumed: '10' }],
    })
    const version = Number((await order('mo-2')).version)
    const closed = await ok('manufacturing.completeProduction', { id: 'mo-2', version, rest: 'backorder' })
    // Python: 24 × 8.5 / 20 = 10.2 used in all, so 0.2 more is taken; 20 − 8.5 = 11.5 still to make.
    const usage = ((await call('manufacturing.getConsumption', { id: 'mo-2' }, adapter)).value as Row)
      .components as Row[]
    assert.equal(usage[0]?.consumed, '10.2')
    const rest = await order(String(closed.backorderId))
    assert.deepEqual(
      [rest.name, rest.productQty, rest.state, rest.backorderOfId],
      ['HCM/SX/0002-01', '11.5', 'confirmed', 'mo-2'],
    )
    const done = await order('mo-2')
    assert.deepEqual([done.state, done.closedShort], ['done', false])
    const pickings = (await adapter.all('SELECT state FROM stock_picking WHERE id IN (?, ?) ORDER BY id', [
      'mo-2:outputs',
      'mo-2:components',
    ])) as Row[]
    assert.deepEqual(
      pickings.map((picking) => picking.state),
      ['cancel', 'cancel'],
      'the unmade plan is released',
    )
    const fruit = (await adapter.all(
      'SELECT SUM(quantity) AS left FROM stock_quant WHERE "productId" = ? AND "locationId" = ?',
      ['fruit', 'stock'],
    )) as Row[]
    // Python: 100 − 10.2 = 89.8, with the rest order holding nothing yet.
    assert.equal(Number(fruit[0]?.left), 89.8)

    // Closing short: no rest order, the shortfall is recorded.
    await start('mo-3', 'HCM/SX/0003', '10')
    await ok('manufacturing.recordOutput', { id: 'mo-3', quantity: '4', lotName: 'L-04' })
    const short = await ok('manufacturing.completeProduction', {
      id: 'mo-3',
      version: Number((await order('mo-3')).version),
      rest: 'close',
    })
    assert.equal(short.backorderId, null)
    assert.deepEqual([(await order('mo-3')).state, (await order('mo-3')).closedShort], ['done', true])
    const used3 = ((await call('manufacturing.getConsumption', { id: 'mo-3' }, adapter)).value as Row)
      .components as Row[]
    // Python: 12 × 4 / 10 = 4.8.
    assert.equal(used3[0]?.consumed, '4.8')
    assert.equal(
      ((await adapter.all('SELECT name FROM stock_lot WHERE ref = ?', ['HCM/SX/0003'])) as Row[])[0]?.name,
      'L-04',
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: an order with operations still open cannot close, and says which', async () => {
  const adapter = await boot()
  try {
    const ok = async (name: string, args: Record<string, unknown>) => {
      const result = (await call(name, args, adapter)).value as Row
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    await ok('manufacturing.saveWorkCenter', { id: 'packing', code: 'PACK', name: 'Packing', capacity: '2' })
    await ok('manufacturing.saveBom', {
      id: 'basket-bom',
      code: 'BASKET-01',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      operations: [
        { id: 'pack-operation', name: 'Pack basket', workCenterId: 'packing', durationExpected: 15 },
      ],
      lines: [{ id: 'fruit-line', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
    })
    await ok('manufacturing.saveProduction', {
      id: 'mo-4',
      name: 'HCM/SX/0004',
      bomId: 'basket-bom',
      productQty: '10',
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: '2026-10-29T01:00:00.000Z',
    })
    await ok('manufacturing.confirmProduction', { id: 'mo-4', version: 1 })
    await ok('manufacturing.recordOutput', { id: 'mo-4', quantity: '10' })
    const version = Number(
      ((await call('manufacturing.getProduction', { id: 'mo-4' }, adapter)).value as Row).version,
    )
    const refused = (
      await call('manufacturing.completeProduction', { id: 'mo-4', version, rest: 'close' }, adapter)
    ).value as Row
    assert.deepEqual(refused.errors, [
      { field: 'workOrders', code: 'manufacturing.error.workLeft', params: { operations: 'Pack basket' } },
    ])
  } finally {
    await adapter.close()
  }
})

test('manufacturing: confirming gives each operation to the closest skilled person, and work runs start to finish', async () => {
  const adapter = await boot()
  try {
    const as = (actor: string | null) => (name: string, args: Record<string, unknown>) =>
      callFn(name, args, { adapter, manifest, scope, actor }).then((result) => result.value as Row)
    const ok = async (name: string, args: Record<string, unknown>, actor: string | null = null) => {
      const result = await as(actor)(name, args)
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    for (const [id, code, skill] of [
      ['cut', 'CUT', 'cut'],
      ['pack', 'PACK', 'pack'],
    ])
      await ok('manufacturing.saveWorkCenter', { id, code, name: code, capacity: '1', skill })
    for (const [userId, name, skill, level, lead] of [
      ['hung', 'Ngô Văn Hùng', 'cut', 2, false],
      // The lead's id sorts first, so only the rule puts the worker ahead.
      ['a-lan', 'Phạm Thị Lan', 'cut', 2, true],
      ['a-lan', 'Phạm Thị Lan', 'pack', 3, true],
      // More skilled than packing needs: Mai, exactly at the level, goes first.
      ['an', 'Vũ Văn An', 'pack', 4, false],
      ['mai', 'Lê Thị Mai', 'pack', 2, false],
      ['tu', 'Đỗ Văn Tú', 'pack', 1, false],
    ] as const)
      await ok('manufacturing.saveOperatorSkill', { userId, name, skill, level, lead })
    await ok('manufacturing.saveBom', {
      id: 'basket-bom',
      code: 'BASKET-01',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      operations: [
        { id: 'cut-op', name: 'Cắt bánh', workCenterId: 'cut', durationExpected: 60, sequence: 1 },
        {
          id: 'pack-op',
          name: 'Đóng hộp và dán nhãn',
          workCenterId: 'pack',
          durationExpected: 30,
          sequence: 2,
        },
      ],
      lines: [{ id: 'fruit-line', productId: 'fruit', productQty: '2', productUomId: 'kg' }],
    })
    for (const id of ['mo-2', 'mo-3']) {
      await ok('manufacturing.saveProduction', {
        id,
        name: `HCM/SX/000${id.slice(-1)}`,
        bomId: 'basket-bom',
        productQty: '10',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-10-29T01:00:00.000Z',
      })
      await ok('manufacturing.confirmProduction', { id, version: 1 })
    }
    const work = async (id: string) => (await as(null)('manufacturing.getWorkOrder', { id })) as Row
    const cut = 'mo-2:work:cut-op'
    const pack = 'mo-2:work:pack-op'
    // Level 2 is exact for both cutters; the worker goes before the lead. Packing: Mai is exact.
    assert.deepEqual(
      [
        (await work(cut)).operatorName,
        (await work(cut)).state,
        (await work(pack)).operatorName,
        (await work(pack)).state,
      ],
      ['Ngô Văn Hùng', 'ready', 'Lê Thị Mai', 'pending'],
    )
    // The second order: Hùng already has open work, so the lead takes the cutting.
    assert.equal((await work('mo-3:work:cut-op')).operatorId, 'a-lan')
    assert.deepEqual(
      ((await work(pack)).operators as Row[]).map((row) => row.name),
      ['Lê Thị Mai', 'Phạm Thị Lan', 'Vũ Văn An'],
      'only people at level 2 or more may be given packing',
    )

    // Hùng runs his operation.
    await ok('manufacturing.startWorkOrder', { id: cut, version: 1 }, 'hung')
    assert.equal(
      ((await as(null)('manufacturing.getProduction', { id: 'mo-2' })) as Row).state,
      'in_progress',
    )
    await ok('manufacturing.pauseWorkOrder', { id: cut, version: 2 }, 'hung')
    assert.equal((await work(cut)).state, 'paused')
    await ok('manufacturing.startWorkOrder', { id: cut, version: 3 }, 'hung')
    const codes = (result: Row) => ((result.errors as Row[]) ?? []).map((error) => error.code)
    for (const minutes of ['0', 'abc', '1.5', '100001'])
      assert.deepEqual(
        codes(
          await as('hung')('manufacturing.finishWorkOrder', { id: cut, version: 4, actualMinutes: minutes }),
        ),
        ['manufacturing.error.minutesInvalid'],
        String(minutes),
      )
    await ok(
      'manufacturing.finishWorkOrder',
      { id: cut, version: 4, actualMinutes: '75', note: 'Dao cùn' },
      'hung',
    )
    const finished = await work(cut)
    assert.deepEqual([finished.state, finished.durationActual, finished.note], ['done', 75, 'Dao cùn'])
    assert.equal((await work(pack)).state, 'ready')

    // The lead reassigns packing: Tú (level 1) is refused, Lan is taken.
    const packVersion = Number((await work(pack)).version)
    assert.deepEqual(
      codes(
        await as('a-lan')('manufacturing.assignWorkOrder', {
          id: pack,
          version: packVersion,
          operatorId: 'tu',
        }),
      ),
      ['manufacturing.error.operatorSkill'],
    )
    await ok(
      'manufacturing.assignWorkOrder',
      { id: pack, version: packVersion, operatorId: 'a-lan' },
      'a-lan',
    )
    assert.equal((await work(pack)).operatorId, 'a-lan')

    // Unassigned work goes to whoever starts it.
    await ok(
      'manufacturing.assignWorkOrder',
      { id: pack, version: packVersion + 1, operatorId: null },
      'a-lan',
    )
    await ok('manufacturing.startWorkOrder', { id: pack, version: packVersion + 2 }, 'mai')
    assert.equal((await work(pack)).operatorId, 'mai')

    const queue = (await as(null)('manufacturing.listWorkOrders', {})) as unknown as Row[]
    assert.deepEqual(
      queue.map((row) => `${String(row.productionName)} ${String(row.name)} ${String(row.state)}`),
      [
        'HCM/SX/0002 Đóng hộp và dán nhãn in_progress',
        'HCM/SX/0003 Cắt bánh ready',
        'HCM/SX/0003 Đóng hộp và dán nhãn pending',
        'HCM/SX/0002 Cắt bánh done',
      ],
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: batches enter stock at the provisional cost and a done order reads its actual cost', async () => {
  const adapter = await boot()
  try {
    const ok = async (name: string, args: Record<string, unknown>) => {
      const result = (await call(name, args, adapter)).value as Row
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    for (const [id, name, cost, stock] of [
      ['flour', 'Bột mì', '98000', '100'],
      ['box', 'Hộp', '1800', '300'],
      ['label', 'Nhãn', '500', null],
    ] as const) {
      await ok('product.saveTemplate', {
        id: `${id}-template`,
        name,
        type: 'goods',
        uomId: 'kg',
        listPrice: '0',
      })
      await ok('product.saveVariant', {
        id,
        templateId: `${id}-template`,
        combinationKey: '',
        defaultCode: id.toUpperCase(),
      })
      await ok('stock.configureProduct', { templateId: `${id}-template`, isStorable: true, tracking: 'none' })
      await ok('product.setCost', { productId: id, standardPrice: cost })
      if (stock)
        await ok('stock.adjustInventory', {
          id: `seed-${id}`,
          productId: id,
          locationId: 'stock',
          inventoryLocationId: 'inventory',
          countedQuantity: stock,
          productUomId: 'kg',
        })
    }
    const order = async (id: string, bomId: string, productQty: string) => {
      await ok('manufacturing.saveProduction', {
        id,
        name: `HCM/SX/${id}`,
        bomId,
        productQty,
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-10-29T01:00:00.000Z',
      })
      await ok('manufacturing.confirmProduction', { id, version: 1 })
    }
    const cost = async (id: string) =>
      (await call('manufacturing.getProductionCost', { id }, adapter)).value as Row
    await ok('manufacturing.saveBom', {
      id: 'cake-bom',
      code: 'CAKE-01',
      productId: 'basket',
      productQty: '200',
      productUomId: 'kg',
      consumption: 'flexible',
      lines: [
        { id: 'flour-line', productId: 'flour', productQty: '10.5', productUomId: 'kg' },
        { id: 'box-line', productId: 'box', productQty: '200', productUomId: 'kg' },
      ],
    })
    await order('0002', 'cake-bom', '200')
    // Python: (10.5 × 98,000 + 200 × 1,800) / 200 = 6,945.
    assert.deepEqual([(await cost('0002')).provisional, (await cost('0002')).actual], ['6945', null])
    const batch = await ok('manufacturing.recordOutput', { id: '0002', quantity: '180' })
    const line = (
      (await adapter.all(
        'SELECT l.value, l."unitCost" FROM stock_move_line l JOIN stock_move m ON m.id = l."moveId" WHERE m."pickingId" = ?',
        [batch.pickingId],
      )) as Row[]
    )[0]
    // Python: 180 × 6,945 = 1,250,100.
    assert.deepEqual([Number(line?.value), Number(line?.unitCost)], [1_250_100, 6945])
    await ok('manufacturing.consumeProduction', {
      id: '0002',
      components: [
        { productId: 'flour', consumed: '10.5' },
        { productId: 'box', consumed: '200' },
      ],
    })
    assert.equal((await cost('0002')).actual, null, 'no actual cost while the order runs')
    await ok('manufacturing.completeProduction', {
      id: '0002',
      version: Number(
        ((await call('manufacturing.getProduction', { id: '0002' }, adapter)).value as Row).version,
      ),
      rest: 'close',
    })
    // Python: 1,389,000 issued over 180 made = 7,716.67, rounded to 7,717.
    const done = await cost('0002')
    assert.deepEqual([done.issued, done.produced, done.actual], ['1389000', '180', '7717'])

    // A product with no stock held is priced at its catalogue cost, and odd batches round to the đồng.
    await ok('manufacturing.saveBom', {
      id: 'tag-bom',
      code: 'TAG-01',
      productId: 'basket',
      productQty: '3',
      productUomId: 'kg',
      lines: [
        { id: 'flour-line-2', productId: 'flour', productQty: '1', productUomId: 'kg' },
        { id: 'label-line', productId: 'label', productQty: '1', productUomId: 'kg' },
      ],
    })
    await order('0003', 'tag-bom', '3')
    // Python: (1 × 98,000 + 1 × 500) / 3 = 32,833.33 → 32,833.
    assert.equal((await cost('0003')).provisional, '32833')
  } finally {
    await adapter.close()
  }
})

test('manufacturing: overuse needs confirming, components go back at their price, scrap needs a reason, output is weighed and by-products come in free', async () => {
  const adapter = await boot()
  try {
    const as = (actor: string | null) => (name: string, args: Record<string, unknown>) =>
      callFn(name, args, { adapter, manifest, scope, actor }).then((result) => result.value as Row)
    const ok = async (name: string, args: Record<string, unknown>, actor: string | null = null) => {
      const result = await as(actor)(name, args)
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    const codes = (result: Row) => ((result.errors as Row[]) ?? []).map((error) => error.code)
    for (const [id, name, cost, stock] of [
      ['nl1', 'NL-001', '62000', '50'],
      ['nl2', 'NL-002', '98000', '20'],
      ['xp', 'XP-01A', '0', null],
      ['btp', 'BTP-03', '0', null],
    ] as const) {
      await ok('product.saveTemplate', {
        id: `${id}-template`,
        name,
        type: 'goods',
        uomId: 'kg',
        listPrice: '0',
      })
      await ok('product.saveVariant', {
        id,
        templateId: `${id}-template`,
        combinationKey: '',
        defaultCode: name,
      })
      await ok('stock.configureProduct', { templateId: `${id}-template`, isStorable: true, tracking: 'none' })
      await ok('product.setCost', { productId: id, standardPrice: cost })
      if (stock)
        await ok('stock.adjustInventory', {
          id: `seed-${id}`,
          productId: id,
          locationId: 'stock',
          inventoryLocationId: 'inventory',
          countedQuantity: stock,
          productUomId: 'kg',
        })
    }
    await ok('manufacturing.saveBom', {
      id: 'xp-bom',
      code: 'XP-01',
      productId: 'xp',
      productQty: '100',
      productUomId: 'kg',
      consumption: 'warning',
      unitWeight: '0.05',
      weightTolerance: '5',
      lines: [
        { id: 'nl1-line', productId: 'nl1', productQty: '3', productUomId: 'kg' },
        { id: 'nl2-line', productId: 'nl2', productQty: '2', productUomId: 'kg' },
      ],
      byproducts: [{ id: 'btp-line', productId: 'btp', productQty: '0.25', productUomId: 'kg' }],
    })
    await ok('manufacturing.saveProduction', {
      id: 'mo-4',
      name: 'HCM/SX/0004',
      bomId: 'xp-bom',
      productQty: '100',
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: '2026-10-29T01:00:00.000Z',
    })
    await ok('manufacturing.confirmProduction', { id: 'mo-4', version: 1 })
    const usage = async () =>
      (((await as(null)('manufacturing.getConsumption', { id: 'mo-4' })) as Row).components as Row[]).find(
        (entry) => entry.productId === 'nl1',
      )!
    const lineOf = async (pickingId: unknown) =>
      (
        (await adapter.all(
          'SELECT l.value, l.quantity FROM stock_move_line l JOIN stock_move m ON m.id = l."moveId" WHERE m."pickingId" = ?',
          [pickingId],
        )) as Row[]
      )[0]

    // A warning BOM refuses 4 kg against 3 until the overuse is confirmed, and keeps who confirmed.
    const four = { id: 'mo-4', components: [{ productId: 'nl1', consumed: '4' }] }
    assert.deepEqual(codes(await as('lan')('manufacturing.consumeProduction', four)), [
      'manufacturing.error.consumeWarning',
    ])
    assert.equal((await usage()).consumed, '0')
    await ok('manufacturing.consumeProduction', { ...four, confirmOveruse: true }, 'lan')
    const confirmedBy = (await adapter.all(
      'SELECT "confirmedBy" FROM manufacturing_production_move WHERE "productionId" = ? AND kind = ?',
      ['mo-4', 'consumed'],
    )) as Row[]
    assert.deepEqual(
      confirmedBy.map((row) => row.confirmedBy),
      ['lan'],
    )

    // Give 1 kg back at what it was taken for: Python 248,000 / 4 = 62,000.
    assert.deepEqual(
      codes(
        await as(null)('manufacturing.returnComponents', {
          id: 'mo-4',
          components: [{ productId: 'nl1', quantity: '5' }],
        }),
      ),
      ['manufacturing.error.returnTooMuch'],
    )
    const back = await ok('manufacturing.returnComponents', {
      id: 'mo-4',
      components: [{ productId: 'nl1', quantity: '1' }],
    })
    assert.equal(Number((await lineOf(back.pickingId))?.value), 62_000)
    assert.deepEqual([(await usage()).consumed, (await usage()).returned], ['3', '1'])
    // Python: 248,000 issued − 62,000 back = 186,000 kept by the order.
    assert.equal(
      ((await as(null)('manufacturing.getProductionCost', { id: 'mo-4' })) as Row).issued,
      '186000',
    )
    // Python: 50 − 4 + 1 = 47 kg back on the shelf.
    const shelf = (await adapter.all(
      'SELECT SUM(quantity) AS q FROM stock_quant WHERE "productId" = ? AND "locationId" = ?',
      ['nl1', 'stock'],
    )) as Row[]
    assert.equal(Number(shelf[0]?.q), 47)

    // Scrap needs a reason; 0.5 kg of NL-002 at 98,000 is worth 49,000.
    assert.deepEqual(
      codes(
        await as(null)('manufacturing.scrapProduction', { id: 'mo-4', productId: 'nl2', quantity: '0.5' }),
      ),
      ['manufacturing.error.reasonRequired'],
    )
    assert.deepEqual(
      codes(
        await as(null)('manufacturing.scrapProduction', {
          id: 'mo-4',
          productId: 'btp',
          quantity: '1',
          reason: 'x',
        }),
      ),
      ['manufacturing.error.scrapProduct'],
    )
    const scrap = await ok('manufacturing.scrapProduction', {
      id: 'mo-4',
      productId: 'nl2',
      quantity: '0.5',
      reason: 'Đổ vỡ khi nấu',
    })
    assert.equal(Number((await lineOf(scrap.pickingId))?.value), 49_000)
    const scrapped = (await adapter.all(
      'SELECT l.reason, p."locationDestId" AS dest FROM manufacturing_production_move l JOIN stock_move m ON m.id = l."moveId" JOIN stock_picking p ON p.id = m."pickingId" WHERE l.kind = ?',
      ['scrapped'],
    )) as Row[]
    assert.deepEqual(
      scrapped.map((row) => `${String(row.reason)} ${String(row.dest)}`),
      ['Đổ vỡ khi nấu acme:manufacturing:scrap'],
    )

    // 100 units at 0.05 kg ± 5%: Python 4.75 – 5.25 kg.
    const heavy = await as(null)('manufacturing.recordOutput', { id: 'mo-4', quantity: '100', weight: '6' })
    assert.deepEqual(heavy.errors, [
      { field: 'weight', code: 'manufacturing.error.weightOutOfRange', params: { min: '4.75', max: '5.25' } },
    ])
    await ok('manufacturing.recordOutput', { id: 'mo-4', quantity: '100', weight: '5.2' })

    // Closing brings the by-product in at no cost: 0.25 kg for the 100 made.
    const version = Number(((await as(null)('manufacturing.getProduction', { id: 'mo-4' })) as Row).version)
    await ok('manufacturing.completeProduction', { id: 'mo-4', version, rest: 'close' })
    const byproduct = (await adapter.all(
      'SELECT l.quantity, l.value FROM stock_move_line l JOIN stock_move m ON m.id = l."moveId" JOIN manufacturing_production_move pm ON pm."moveId" = m.id WHERE pm.kind = ? AND m.state = ?',
      ['byproduct_output', 'done'],
    )) as Row[]
    assert.deepEqual(
      byproduct.map((row) => [Number(row.quantity), Number(row.value)]),
      [[0.25, 0]],
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: each run of an operation is logged, hands over between people and adds up to its time', async () => {
  const adapter = await boot()
  try {
    const as = (actor: string | null) => (name: string, args: Record<string, unknown>) =>
      callFn(name, args, { adapter, manifest, scope, actor }).then((result) => result.value as Row)
    const ok = async (name: string, args: Record<string, unknown>, actor: string | null = null) => {
      const result = await as(actor)(name, args)
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    const codes = (result: Row) => ((result.errors as Row[]) ?? []).map((error) => error.code)
    await ok('manufacturing.saveWorkCenter', {
      id: 'cut',
      code: 'CUT',
      name: 'Bàn cắt',
      capacity: '1',
      skill: 'cut',
    })
    for (const [userId, name, lead] of [
      ['hung', 'Ngô Văn Hùng', false],
      ['loc', 'Trần Văn Lộc', true],
    ] as const)
      await ok('manufacturing.saveOperatorSkill', { userId, name, skill: 'cut', level: 2, lead })
    await ok('manufacturing.saveBom', {
      id: 'cake-bom',
      code: 'CAKE-01',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      operations: [
        { id: 'cut-op', name: 'Cắt bánh', workCenterId: 'cut', durationExpected: 60, sequence: 1 },
      ],
      lines: [{ id: 'fruit-line', productId: 'fruit', productQty: '2', productUomId: 'kg' }],
    })
    await ok('manufacturing.saveProduction', {
      id: 'mo-2',
      name: 'HCM/SX/0002',
      bomId: 'cake-bom',
      productQty: '10',
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: '2026-10-29T01:00:00.000Z',
    })
    await ok('manufacturing.confirmProduction', { id: 'mo-2', version: 1 })
    const cut = 'mo-2:work:cut-op'
    const work = async () => (await as(null)('manufacturing.getWorkOrder', { id: cut })) as Row
    assert.equal((await work()).operatorId, 'hung')
    assert.equal((await work()).last, true)

    await ok('manufacturing.startWorkOrder', { id: cut, version: 1 }, 'hung')
    assert.deepEqual(
      ((await work()).runs as Row[]).map((run) => [run.operatorId, run.stoppedAt ?? null]),
      [['hung', null]],
      'starting opens a run for whoever does it',
    )
    assert.deepEqual(
      codes(await as('hung')('manufacturing.pauseWorkOrder', { id: cut, version: 2, minutes: 'abc' })),
      ['manufacturing.error.minutesInvalid'],
    )
    await ok('manufacturing.pauseWorkOrder', { id: cut, version: 2, minutes: '30' }, 'hung')
    await ok('manufacturing.startWorkOrder', { id: cut, version: 3 }, 'hung')
    // The lead takes it over: Hùng's run closes at 20 minutes and Lộc's opens.
    await ok('manufacturing.takeWorkOrder', { id: cut, version: 4, minutes: '20' }, 'loc')
    assert.equal((await work()).operatorId, 'loc')
    await ok(
      'manufacturing.finishWorkOrder',
      { id: cut, version: 5, actualMinutes: '15', loss: '0.2' },
      'loc',
    )
    const done = await work()
    assert.deepEqual(
      (done.runs as Row[]).map((run) => `${String(run.operatorName)} ${String(run.minutes)}`),
      ['Ngô Văn Hùng 30', 'Ngô Văn Hùng 20', 'Trần Văn Lộc 15'],
    )
    // Python: 30 + 20 + 15 = 65.
    assert.deepEqual([done.state, done.durationActual, done.loss], ['done', 65, '0.2'])
    assert.deepEqual(codes(await as('hung')('manufacturing.takeWorkOrder', { id: cut, version: 6 })), [
      'manufacturing.error.state',
    ])
  } finally {
    await adapter.close()
  }
})

test('manufacturing: the skills grid decides who the next order gives work to (#1931)', async () => {
  const adapter = await boot()
  try {
    const ok = async (name: string, args: Record<string, unknown>) => {
      const result = (await call(name, args, adapter)).value as Row
      assert.notEqual(result?.ok, false, `${name}: ${JSON.stringify(result)}`)
      return result
    }
    for (const [id, name] of [
      ['hung', 'Ngô Văn Hùng'],
      ['lan', 'Phạm Thị Lan'],
    ]) {
      await ok('user.createUser', {
        id,
        login: id,
        password: 'synthetic-password',
        name,
        defaultCompanyId: 'acme',
      })
      await ok('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
    }
    await ok('manufacturing.saveWorkCenter', {
      id: 'cut',
      code: 'CUT',
      name: 'Cắt',
      capacity: '1',
      skill: 'cut',
    })
    await ok('manufacturing.saveBom', {
      id: 'cut-bom',
      code: 'CUT-01',
      productId: 'basket',
      productQty: '1',
      productUomId: 'kg',
      operations: [{ id: 'cut-op', name: 'Cắt bánh', workCenterId: 'cut', durationExpected: 30 }],
      lines: [{ id: 'cut-fruit', productId: 'fruit', productQty: '1', productUomId: 'kg' }],
    })
    const confirmOrder = async (id: string) => {
      await ok('manufacturing.saveProduction', {
        id,
        name: id.toUpperCase(),
        bomId: 'cut-bom',
        productQty: '1',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-10-29T01:00:00.000Z',
      })
      await ok('manufacturing.confirmProduction', { id, version: 1 })
      return ((await call('manufacturing.getWorkOrder', { id: `${id}:work:cut-op` }, adapter)).value as Row)
        .operatorName
    }
    // Hùng is exactly at the level the work needs; Lan does more than that.
    await ok('manufacturing.saveOperatorSkills', {
      rows: [
        { userId: 'hung', skill: 'cut', level: 2 },
        { userId: 'lan', skill: 'cut', level: 4 },
      ],
    })
    assert.equal(await confirmOrder('mo-a'), 'Ngô Văn Hùng')
    // Lowered below the level, Hùng no longer gets cutting.
    await ok('manufacturing.saveOperatorSkills', {
      rows: [
        { userId: 'hung', skill: 'cut', level: 1 },
        { userId: 'lan', skill: 'cut', level: 4 },
      ],
    })
    assert.equal(await confirmOrder('mo-b'), 'Phạm Thị Lan')
  } finally {
    await adapter.close()
  }
})
