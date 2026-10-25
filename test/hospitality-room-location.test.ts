import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter, type Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

test('room locations: required, scoped, matching and active; refusals leave no inventory or receipt', async () => {
  const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
  const manifest = compose(modules, { headless: true, companies: true })
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = async (name: string, input: Record<string, unknown>, tenant = 'acme') =>
    (await callFn(name, input, { adapter, manifest, scope: { company: tenant, branches: null } }))
      .value as Row
  const must = async (name: string, input: Record<string, unknown>, tenant = 'acme') => {
    const result = await call(name, input, tenant)
    assert.notEqual(result?.ok, false, JSON.stringify(result))
    return result
  }
  try {
    for (const tenant of ['acme', 'other']) {
      await must(
        'partner.savePartner',
        { id: `${tenant}-party`, kind: 'company', name: 'Synthetic company' },
        tenant,
      )
      await must('company.saveCompany', { id: tenant, partnerId: `${tenant}-party`, currency: 'VND' }, tenant)
    }
    for (const [id, tenant] of [
      ['hotel', 'acme'],
      ['annex', 'acme'],
      ['foreign', 'other'],
    ]) {
      await must(
        'hospitality_core.saveProperty',
        { id, code: id!.toUpperCase(), name: id, accommodationType: 'hotel' },
        tenant,
      )
      await must(
        'hospitality_core.saveBuilding',
        { id: `${id}-tower`, propertyId: id, code: 'A', name: 'Tower A' },
        tenant,
      )
      await must(
        'hospitality_core.saveFloor',
        { id: `${id}-floor`, propertyId: id, buildingId: `${id}-tower`, code: '01', name: 'Floor 1' },
        tenant,
      )
    }
    await must('hospitality_core.saveBuilding', {
      id: 'second-tower',
      propertyId: 'hotel',
      code: 'B',
      name: 'Tower B',
    })
    await must('hospitality_core.saveRoomType', {
      id: 'type',
      propertyId: 'hotel',
      code: 'DLX',
      name: 'Deluxe',
      maxAdults: 2,
    })
    const base = {
      id: 'room',
      propertyId: 'hotel',
      roomTypeId: 'type',
      code: '101',
      name: 'Room 101',
      expectedVersion: 0,
      requestKey: 'room-create',
    }
    const snapshot = async () =>
      Promise.all([
        adapter.all('SELECT * FROM hospitality_core_room'),
        adapter.all('SELECT id, version FROM hospitality_core_property ORDER BY id'),
        adapter.all('SELECT * FROM hospitality_core_availability_ledger'),
        adapter.all('SELECT * FROM hospitality_core_inventory_change'),
        adapter.all('SELECT * FROM hospitality_core_command_receipt'),
      ])
    const unchanged = await snapshot()
    const refused = async (location: Record<string, unknown>, field: string, code: string) => {
      const result = await call('hospitality_core.saveRoom', { ...base, ...location })
      assert.equal(result.ok, false)
      assert.ok(
        (result.errors as Row[]).some((error) => error.field === field && error.code === code),
        JSON.stringify(result),
      )
      assert.deepEqual(await snapshot(), unchanged)
    }
    await refused({}, 'buildingId', 'required')
    await refused({ buildingId: 'hotel-tower' }, 'floorId', 'required')
    await refused({ buildingId: 'hotel-tower', floorId: 'missing' }, 'floorId', 'floor_missing')
    await refused({ buildingId: 'hotel-tower', floorId: 'foreign-floor' }, 'floorId', 'floor_missing')
    await refused({ buildingId: 'annex-tower', floorId: 'annex-floor' }, 'buildingId', 'property_mismatch')
    await refused({ buildingId: 'second-tower', floorId: 'hotel-floor' }, 'floorId', 'building_mismatch')
    await adapter.run('UPDATE hospitality_core_floor SET active = FALSE WHERE id = ?', ['hotel-floor'])
    await refused({ buildingId: 'hotel-tower', floorId: 'hotel-floor' }, 'floorId', 'location_archived')
    await adapter.run('UPDATE hospitality_core_floor SET active = TRUE WHERE id = ?', ['hotel-floor'])
    await adapter.run('UPDATE hospitality_core_building SET active = FALSE WHERE id = ?', ['hotel-tower'])
    await refused({ buildingId: 'hotel-tower', floorId: 'hotel-floor' }, 'buildingId', 'location_archived')
    await adapter.run('UPDATE hospitality_core_building SET active = TRUE WHERE id = ?', ['hotel-tower'])
    // A valid floor determines its building for API clients. The UI asks for both explicitly.
    const input = { ...base, floorId: 'hotel-floor' }
    const saved = await must('hospitality_core.saveRoom', input)
    assert.equal(saved.ok, true)
    assert.deepEqual(await must('hospitality_core.saveRoom', input), saved)
    const room = await call('hospitality_core.getRoom', { id: 'room' })
    assert.equal(room.buildingId, 'hotel-tower')
    assert.equal(room.floorId, 'hotel-floor')
    const invalidUpdate = await call('hospitality_core.saveRoom', {
      ...base,
      expectedVersion: room.version,
      requestKey: 'room-edit',
      buildingId: 'hotel-tower',
      floorId: null,
    })
    assert.equal(invalidUpdate.ok, false)
    assert.deepEqual(await call('hospitality_core.getRoom', { id: 'room' }), room)
  } finally {
    await adapter.close()
  }
})
