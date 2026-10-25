import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import {
  addCalendarDays,
  dateKeyIn,
  zonedMidnight,
} from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })

test('Hospitality room board pages active rooms, keeps independent scoped preview and full facet counts', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = async (
    name: string,
    args: Record<string, unknown>,
    companyId = 'hotel',
    branches: string[] | null = null,
  ) =>
    (
      await roomFixtureCall(`hospitality_core.${name}`, args, {
        adapter,
        manifest,
        scope: { company: companyId, branches },
      })
    ).value as any
  const must = async (name: string, args: Record<string, unknown>) => {
    const value = await call(name, args)
    assert.notEqual(value.ok, false, JSON.stringify(value))
    return value
  }
  try {
    await callFn(
      'partner.savePartner',
      { id: 'party', name: 'Hotel', kind: 'company' },
      { adapter, manifest, scope: { company: 'hotel' } },
    )
    await callFn(
      'company.saveCompany',
      { id: 'hotel', code: 'HOTEL', partnerId: 'party', currency: 'VND' },
      { adapter, manifest, scope: { company: 'hotel' } },
    )
    for (const id of ['property', 'elsewhere']) {
      await must('saveProperty', {
        id,
        code: id,
        name: id,
        accommodationType: 'hotel',
        timezone: 'Asia/Ho_Chi_Minh',
      })
      await must('saveRoomType', {
        id: `${id}-type`,
        propertyId: id,
        code: 'DLX',
        name: 'Deluxe',
        maxAdults: 2,
        maxChildren: 0,
      })
    }
    for (let n = 0; n < 151; n++)
      await must('saveRoom', {
        id: `room-${n}`,
        propertyId: 'property',
        roomTypeId: 'property-type',
        code: String(100 + n),
        name: `Room ${100 + n}`,
        capacity: 2,
      })
    await must('saveRoom', {
      id: 'archived-room',
      propertyId: 'property',
      roomTypeId: 'property-type',
      code: 'OLD',
      name: 'Archived',
      capacity: 2,
    })
    await must('archiveRoom', {
      id: 'archived-room',
      active: false,
      expectedVersion: (await call('getRoom', { id: 'archived-room' })).version ?? 0,
      requestKey: 'board-archive-room-one',
    })
    await must('saveRoom', {
      id: 'foreign-room',
      propertyId: 'elsewhere',
      roomTypeId: 'elsewhere-type',
      code: '999',
      name: 'Elsewhere',
      capacity: 2,
    })
    await must('completeRoomCleaning', {
      roomId: 'room-0',
      expectedVersion: (await call('getRoom', { id: 'room-0' })).version ?? 0,
      requestKey: 'board-clean-room-zero',
    })
    const first = await call('getRoomBoard', { propertyId: 'property', peek: 'room-150' })
    assert.equal(first.rows.length, 48)
    assert.equal(first.total, 151)
    assert.equal(first.pages, 4)
    assert.equal(first.selected.id, 'room-150')
    assert.equal(first.counts.state.available, 1)
    assert.equal(first.counts.state.dirty, 150)
    const last = await call('getRoomBoard', { propertyId: 'property', page: 99 })
    assert.equal(last.page, 4)
    assert.equal(last.rows.length, 7)
    assert.equal(new Set([...first.rows, ...last.rows].map((row) => row.id)).size, 55)
    const filter = await call('getRoomBoard', { propertyId: 'property', state: 'available', q: '100' })
    assert.equal(filter.total, 1)
    assert.equal(filter.rows[0].id, 'room-0')
    assert.equal(
      (await call('getRoomBoard', { propertyId: 'property', peek: 'foreign-room' })).selected,
      null,
    )
    assert.equal((await call('getRoomBoard', { propertyId: 'property' }, 'other')).property, null)
    assert.equal(
      (await call('getRoomBoard', { propertyId: 'property' }, 'hotel', ['unrelated'])).property,
      null,
    )
    assert.equal('note' in first.selected, false)
    assert.equal(
      (await call('getRoomBoard', { propertyId: 'property', peek: 'archived-room' })).selected,
      null,
    )
    const today = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
    const block = await must('blockRoom', {
      roomId: 'room-150',
      kind: 'ooo',
      dateFrom: today,
      dateTo: addCalendarDays(today, 1),
      reason: 'Synthetic maintenance',
      expectedVersion: (await call('getRoom', { id: 'room-150' })).version ?? 0,
      requestKey: 'board-block-last-room',
    })
    const blocked = await call('getRoomBoard', {
      propertyId: 'property',
      state: 'out_of_order',
      peek: 'room-150',
    })
    assert.equal(blocked.total, 1)
    assert.equal(blocked.rows[0].id, 'room-150')
    assert.equal(blocked.rows[0].status, 'out_of_order')
    assert.equal(blocked.selected.status, 'out_of_order')
    assert.equal(blocked.counts.state.dirty, 149)
    assert.equal((await call('getRoomBoard', { propertyId: 'property', state: 'dirty' })).total, 149)
    await must('reopenRoom', {
      id: block.id,
      roomId: 'room-150',
      expectedVersion: block.version,
      requestKey: 'board-reopen-last-room',
    })
    const reopened = await call('getRoomBoard', { propertyId: 'property', peek: 'room-150' })
    assert.equal(reopened.selected.status, 'dirty')
    assert.equal(reopened.counts.state.out_of_order, 0)
    await must('blockRoom', {
      roomId: 'room-150',
      kind: 'oos',
      dateFrom: today,
      dateTo: addCalendarDays(today, 1),
      backAt: new Date(
        zonedMidnight(addCalendarDays(today, 1), 'Asia/Ho_Chi_Minh').getTime() - 1,
      ).toISOString(),
      reason: 'Synthetic short suspension',
      expectedVersion: (await call('getRoom', { id: 'room-150' })).version,
      requestKey: 'board-short-suspension',
    })
    const suspended = await call('getRoomBoard', {
      propertyId: 'property',
      state: 'maintenance',
      peek: 'room-150',
    })
    assert.equal(suspended.total, 1)
    assert.equal(suspended.rows[0].status, 'maintenance')
    assert.equal(suspended.selected.status, 'maintenance')
  } finally {
    await adapter.close()
  }
})
