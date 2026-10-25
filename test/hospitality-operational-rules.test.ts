import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { addCalendarDays, dateKeyIn } from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })
const today = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = async (name: string, args: Record<string, unknown>, companyId = 'hotel') =>
    (
      await roomFixtureCall(`hospitality_core.${name}`, args, {
        adapter,
        manifest,
        scope: { company: companyId, branches: null },
      })
    ).value as Record<string, unknown>
  const scope = { company: 'hotel', branches: null }
  await callFn(
    'partner.savePartner',
    { id: 'hotel-company-partner', kind: 'company', name: 'Hotel Company' },
    { adapter, manifest, scope },
  )
  await callFn(
    'company.saveCompany',
    { id: 'hotel', partnerId: 'hotel-company-partner', currency: 'VND' },
    { adapter, manifest, scope },
  )
  const property = {
    id: 'hotel',
    code: 'HOTEL',
    name: 'Test Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
  }
  assert.equal((await call('saveProperty', property)).ok, true)
  assert.equal(
    (
      await call('saveRoomType', {
        id: 'type',
        propertyId: 'hotel',
        code: 'DLX',
        name: 'Deluxe',
        maxAdults: 2,
        maxChildren: 0,
      })
    ).ok,
    true,
  )
  const room = {
    id: 'room',
    propertyId: 'hotel',
    roomTypeId: 'type',
    code: '101',
    name: 'Room 101',
    capacity: 2,
  }
  assert.equal((await call('saveRoom', room)).ok, true)
  return { adapter, call, property, room }
}
const codes = (result: Record<string, unknown>) =>
  ((result.errors as Array<{ code: string }>) ?? []).map((e) => e.code)

async function catalogueBooking(env: Awaited<ReturnType<typeof boot>>) {
  const { adapter, call } = env
  await callFn(
    'partner.savePartner',
    { id: 'catalogue-guest', name: 'Synthetic guest', kind: 'person' },
    { adapter, manifest, scope: { company: 'hotel', branches: null } },
  )
  assert.equal(
    (
      await call('saveRatePlan', {
        id: 'catalogue-rate',
        propertyId: 'hotel',
        roomTypeId: 'type',
        code: 'BAR',
        name: 'Best rate',
        rateType: 'nightly',
        amount: '500',
      })
    ).ok,
    true,
  )
  const property = await call('getProperty', { id: 'hotel' })
  assert.equal(
    (
      await call('setPropertyLifecycle', {
        propertyId: 'hotel',
        lifecycle: 'active',
        expectedVersion: property.version,
        requestKey: 'catalogue-open-property',
      })
    ).ok,
    true,
  )
  const reservation = await call('createReservation', {
    id: 'catalogue-booking',
    propertyId: 'hotel',
    roomTypeId: 'type',
    partnerId: 'catalogue-guest',
    adults: 2,
    children: 0,
    checkIn: `${addCalendarDays(today, 1)}T14:00:00+07:00`,
    checkOut: `${addCalendarDays(today, 3)}T12:00:00+07:00`,
    rate: '500',
  })
  assert.equal(reservation.ok, true, JSON.stringify(reservation))
}

test('Room type changes cannot remove sold capacity and failed changes roll back both ledgers and receipts', async () => {
  const env = await boot()
  const { adapter, call, room } = env
  try {
    assert.equal(
      (
        await call('saveRoomType', {
          id: 'other-type',
          propertyId: 'hotel',
          code: 'STD',
          name: 'Standard',
          maxAdults: 2,
        })
      ).ok,
      true,
    )
    await catalogueBooking(env)
    const before = await call('getRoom', { id: room.id })
    const property = await call('getProperty', { id: 'hotel' })
    const ledger = await adapter.all('SELECT * FROM hospitality_core_availability_ledger ORDER BY id')
    const receipts = await adapter.all('SELECT id FROM hospitality_core_command_receipt ORDER BY id')
    const edit = {
      ...room,
      roomTypeId: 'other-type',
      expectedVersion: before.version,
      expectedPropertyVersion: property.version,
      requestKey: 'catalogue-type-oversell',
    }
    const refusal = await call('saveRoom', edit)
    assert.ok(codes(refusal).includes('room_type_change_would_oversell'), JSON.stringify(refusal))
    assert.deepEqual(await call('getRoom', { id: room.id }), before)
    assert.equal((await call('getProperty', { id: 'hotel' })).version, property.version)
    assert.deepEqual(
      await adapter.all('SELECT * FROM hospitality_core_availability_ledger ORDER BY id'),
      ledger,
    )
    assert.deepEqual(
      await adapter.all('SELECT id FROM hospitality_core_command_receipt ORDER BY id'),
      receipts,
    )
    assert.equal(
      (await call('saveRoom', { ...room, id: 'spare-room', code: '102', name: 'Spare room' })).ok,
      true,
    )
    const allowed = {
      ...edit,
      expectedPropertyVersion: (await call('getProperty', { id: 'hotel' })).version,
      requestKey: 'catalogue-type-available',
    }
    const changed = await call('saveRoom', allowed)
    assert.equal(changed.ok, true, JSON.stringify(changed))
    assert.deepEqual(await call('saveRoom', allowed), changed)
    assert.equal((await call('getRoom', { id: room.id })).roomTypeId, 'other-type')
    const nights = (await call('listInventory', {
      propertyId: 'hotel',
      roomTypeId: 'type',
      from: addCalendarDays(today, 1),
      to: addCalendarDays(today, 2),
    })) as unknown as Array<{ total: number; sold: number; available: number }>
    assert.ok(nights.every((night) => night.total === 1 && night.sold === 1 && night.available === 0))
  } finally {
    await adapter.close()
  }
})

test('Held rooms protect type, capacity and archive operations, and holding rejects an undersized physical room', async () => {
  const env = await boot()
  const { adapter, call, room } = env
  try {
    assert.equal(
      (await call('saveRoom', { ...room, id: 'small-room', code: '102', name: 'Small room', capacity: 1 }))
        .ok,
      true,
    )
    assert.equal(
      (
        await call('saveRoomType', {
          id: 'other-type',
          propertyId: 'hotel',
          code: 'STD',
          name: 'Standard',
          maxAdults: 2,
        })
      ).ok,
      true,
    )
    await catalogueBooking(env)
    const stayId = 'catalogue-booking:stay'
    const type = await call('getRoomType', { id: 'type' })
    const narrowed = await call('saveRoomType', {
      id: type.id,
      propertyId: 'hotel',
      code: type.code,
      name: type.name,
      defaultCapacity: 1,
      maxAdults: 1,
      maxChildren: 0,
      expectedVersion: type.version,
      requestKey: 'type-capacity-narrowed',
    })
    assert.ok(codes(narrowed).includes('type_capacity'), JSON.stringify(narrowed))
    assert.equal((await call('getRoomType', { id: 'type' })).version, type.version)
    const stay = await call('getStay', { id: stayId })
    const property = await call('getProperty', { id: 'hotel' })
    const rejected = await call('holdRoom', {
      stayId,
      roomId: 'small-room',
      expectedVersion: stay.version,
      requestKey: 'hold-undersized-room',
    })
    assert.ok(codes(rejected).includes('room_guest_capacity'), JSON.stringify(rejected))
    assert.equal((await call('getStay', { id: stayId })).version, stay.version)
    assert.equal((await call('getProperty', { id: 'hotel' })).version, property.version)
    const input = { stayId, roomId: room.id, expectedVersion: stay.version, requestKey: 'hold-physical-room' }
    const held = await call('holdRoom', input)
    assert.equal(held.ok, true, JSON.stringify(held))
    assert.deepEqual(await call('holdRoom', input), held)
    assert.equal(Number((await call('getProperty', { id: 'hotel' })).version), Number(property.version) + 1)
    const baseline = await call('getRoom', { id: room.id })
    for (const [name, patch, key] of [
      ['saveRoom', { ...room, roomTypeId: 'other-type' }, 'held-type-change'],
      ['saveRoom', { ...room, capacity: 1 }, 'held-capacity-change'],
      ['archiveRoom', { id: room.id, active: false }, 'held-room-archive'],
    ] as const) {
      const result = await call(name, { ...patch, expectedVersion: baseline.version, requestKey: key })
      assert.ok(codes(result).includes('room_held'), JSON.stringify(result))
      assert.deepEqual(await call('getRoom', { id: room.id }), baseline)
    }
  } finally {
    await adapter.close()
  }
})

test('Room type catalogue saves bedding, policy and scoped amenities atomically and preserves legacy multi-bed layouts', async () => {
  const { adapter, call, room } = await boot()
  try {
    for (const [id, scope] of [
      ['wifi', 'room'],
      ['tea', 'room'],
      ['parking', 'property'],
    ] as const)
      assert.equal((await call('saveAmenity', { id, code: id.toUpperCase(), name: id, scope })).ok, true)
    assert.equal(
      (
        await call(
          'saveAmenity',
          { id: 'foreign-amenity', code: 'FOREIGN', name: 'Foreign', scope: 'room' },
          'other-company',
        )
      ).ok,
      true,
    )
    assert.equal(
      (
        await call('saveCancellationPolicy', {
          id: 'catalogue-policy',
          code: 'FLEX',
          name: 'Flexible',
          type: 'flexible',
          feeRule: 'template',
        })
      ).ok,
      true,
    )
    for (const [id, type] of [
      ['bed-a', 'queen'],
      ['bed-b', 'single'],
    ] as const)
      assert.equal((await call('saveBed', { id, roomTypeId: 'type', type, quantity: 1 })).ok, true)
    const typeInput = {
      id: 'type',
      propertyId: 'hotel',
      code: 'DLX',
      name: 'Deluxe',
      maxAdults: 2,
      maxChildren: 0,
    }
    let type = await call('getRoomType', { id: 'type' })
    assert.equal(
      (
        await call('saveRoomType', {
          ...typeInput,
          expectedVersion: type.version,
          requestKey: 'legacy-preserve-beds',
        })
      ).ok,
      true,
    )
    let context = (await call('getRoomTypeRecord', { id: 'type' })).record as Record<string, unknown>
    assert.equal(context.bedType, 'keep')
    assert.equal(
      (await adapter.all('SELECT id FROM hospitality_core_bed WHERE "roomTypeId" = ?', ['type'])).length,
      2,
    )
    type = await call('getRoomType', { id: 'type' })
    const input = {
      ...typeInput,
      bedType: 'queen',
      bedQuantity: 2,
      cancellationPolicyId: 'catalogue-policy',
      amenityIds: ['wifi', 'tea'],
      expectedVersion: type.version,
      requestKey: 'catalogue-bedding-save',
    }
    const saved = await call('saveRoomType', input)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(await call('saveRoomType', input), saved)
    context = (await call('getRoomTypeRecord', { id: 'type' })).record as Record<string, unknown>
    assert.equal(context.bedType, 'queen')
    assert.equal(context.bedQuantity, 2)
    assert.equal(context.cancellationPolicyId, 'catalogue-policy')
    assert.deepEqual((context.amenityIds as string[]).slice().sort(), ['tea', 'wifi'])
    assert.equal(
      (await adapter.all('SELECT id FROM hospitality_core_bed WHERE "roomTypeId" = ?', ['type'])).length,
      1,
    )
    assert.equal((await call('getRoomTypeRecord', { id: 'type' }, 'other-company')).record, null)
    const property = await call('getProperty', { id: 'hotel' })
    for (const [patch, code, key] of [
      [{ bedQuantity: 0 }, 'room_type_beds', 'invalid-bed-count'],
      [{ amenityIds: ['parking'] }, 'room_type_amenities', 'invalid-amenity-scope'],
      [{ amenityIds: ['foreign-amenity'] }, 'room_type_amenities', 'foreign-amenity-scope'],
      [{ amenityIds: ['wifi', 'wifi'] }, 'room_type_amenities', 'duplicate-amenity'],
      [
        { amenityIds: Array.from({ length: 101 }, (_, i) => `amenity-${i}`) },
        'room_type_amenities',
        'too-many-amenities',
      ],
    ] as const) {
      const refused = await call('saveRoomType', {
        ...input,
        ...patch,
        expectedVersion: context.version,
        requestKey: key,
      })
      assert.ok(codes(refused).includes(code), JSON.stringify(refused))
      assert.deepEqual((await call('getRoomTypeRecord', { id: 'type' })).record, context)
      assert.equal((await call('getProperty', { id: 'hotel' })).version, property.version)
    }
    assert.ok(
      codes(await call('saveRoomType', { ...input, requestKey: 'stale-bedding-save' })).includes(
        'transition_conflict',
      ),
    )
    assert.equal(
      (
        await call('saveRoomType', {
          ...typeInput,
          bedType: 'keep',
          amenityIds: [],
          expectedVersion: context.version,
          requestKey: 'clear-room-amenities',
        })
      ).ok,
      true,
    )
    context = (await call('getRoomTypeRecord', { id: 'type' })).record as Record<string, unknown>
    assert.equal(context.bedType, 'queen')
    assert.equal(context.bedQuantity, 2)
    assert.deepEqual(context.amenityIds, [])
    const before = await call('getRoom', { id: room.id })
    const overlong = await call('saveRoom', {
      ...room,
      name: 'x'.repeat(121),
      expectedVersion: before.version,
      requestKey: 'overlong-room-name',
    })
    assert.ok(codes(overlong).includes('room_name_length'), JSON.stringify(overlong))
    assert.deepEqual(await call('getRoom', { id: room.id }), before)
  } finally {
    await adapter.close()
  }
})

test('Hospitality closed-day fees are corrected by an audited current-day line, with the original immutable and replay/conflict fencing', async () => {
  const { adapter, call } = await boot()
  try {
    const scope = { company: 'hotel', branches: null }
    await callFn(
      'partner.savePartner',
      { id: 'adjustment-guest', name: 'Synthetic guest', kind: 'person' },
      { adapter, manifest, scope },
    )
    await call('saveRatePlan', {
      id: 'adjustment-rate',
      propertyId: 'hotel',
      roomTypeId: 'type',
      code: 'BAR',
      name: 'Best rate',
      rateType: 'nightly',
      amount: '500',
    })
    const property = await call('getProperty', { id: 'hotel' })
    assert.equal(
      (
        await call('setPropertyLifecycle', {
          propertyId: 'hotel',
          lifecycle: 'active',
          expectedVersion: property.version,
          requestKey: 'adjustment-open-property',
        })
      ).ok,
      true,
    )
    const booking = await call('createReservation', {
      id: 'adjustment-booking',
      propertyId: 'hotel',
      roomTypeId: 'type',
      partnerId: 'adjustment-guest',
      checkIn: `${today}T14:00:00+07:00`,
      checkOut: `${addCalendarDays(today, 2)}T12:00:00+07:00`,
      rate: '500',
    })
    assert.equal(booking.ok, true, JSON.stringify(booking.errors))
    const folioId = 'adjustment-booking:folio',
      chargeId = 'adjustment-booking:room',
      yesterday = addCalendarDays(today, -1)
    await adapter.run('UPDATE hospitality_core_charge SET "serviceDate" = ? WHERE id = ?', [
      yesterday,
      chargeId,
    ])
    const before = (await adapter.all('SELECT * FROM hospitality_core_charge WHERE id = ?', [chargeId]))[0]
    const folio = await call('getFolio', { id: folioId })
    const input = {
      folioId,
      chargeId,
      amount: '-200',
      reason: 'Synthetic approved correction',
      expectedVersion: folio.version,
      requestKey: 'closed-charge-adjustment',
    }
    const result = await call('adjustCharge', input)
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    assert.deepEqual(await call('adjustCharge', input), result)
    assert.deepEqual(
      (await adapter.all('SELECT * FROM hospitality_core_charge WHERE id = ?', [chargeId]))[0],
      before,
    )
    const line = (await adapter.all('SELECT * FROM hospitality_core_charge WHERE id = ?', [result.id]))[0]!
    assert.equal(line.serviceDate, today)
    assert.equal(line.adjustsChargeId, chargeId)
    assert.equal(String(line.amount), '-200')
    assert.equal(String((await call('getFolio', { id: folioId })).amountTotal), '800')
    assert.ok(
      codes(
        await call('adjustCharge', {
          ...input,
          amount: '-801',
          expectedVersion: 1,
          requestKey: 'over-reverse-adjustment',
        }),
      ).includes('adjustment_amount'),
    )
    assert.ok(
      codes(await call('adjustCharge', { ...input, requestKey: 'stale-charge-adjustment' })).includes(
        'transition_conflict',
      ),
    )
    assert.equal(
      (await call('adjustCharge', { ...input, requestKey: 'wrong-company-adjustment' }, 'other')).ok,
      false,
    )
    assert.ok(
      codes(
        await call('voidCharge', {
          id: chargeId,
          folioId,
          reason: 'Cannot void a closed day',
          expectedVersion: 1,
          requestKey: 'closed-charge-void',
        }),
      ).includes('business_date_locked'),
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality OOO reserves only its nights once, stale or reused commands roll back, OOS leaves sale inventory intact', async () => {
  const { adapter, call, room } = await boot()
  try {
    const input = {
      roomId: 'room',
      kind: 'ooo',
      dateFrom: addCalendarDays(today, 1),
      dateTo: addCalendarDays(today, 3),
      reason: 'Repair',
      expectedVersion: 1,
      requestKey: 'room-block-request-1',
    }
    const first = await call('blockRoom', input)
    assert.equal(first.ok, true)
    assert.deepEqual(await call('blockRoom', input), first)
    const inventory = (await call('listInventory', {
      propertyId: 'hotel',
      roomTypeId: 'type',
      from: today,
      to: addCalendarDays(today, 4),
    })) as unknown as Array<{ date: string; blocked: number }>
    assert.deepEqual(
      inventory.map((r) => r.blocked),
      [0, 1, 1, 0, 0],
    )
    assert.ok(
      codes(await call('blockRoom', { ...input, reason: 'Other payload' })).includes('request_reused'),
    )
    assert.ok(
      codes(
        await call('blockRoom', {
          ...input,
          kind: 'oos',
          backLocal: '23:59',
          dateFrom: addCalendarDays(today, 4),
          dateTo: addCalendarDays(today, 5),
          requestKey: 'room-stale-request',
        }),
      ).includes('transition_conflict'),
    )
    assert.equal((await call('getRoom', { id: 'room' })).version, 2)
    assert.equal(
      (await call('blockRoom', { ...input, requestKey: 'room-company-request' }, 'other-company')).ok,
      false,
    )
    assert.equal(
      (await call('reopenRoom', { id: first.id, expectedVersion: 2, requestKey: 'room-reopen-request' })).ok,
      true,
    )
    assert.equal(
      (
        await call('blockRoom', {
          ...input,
          kind: 'oos',
          dateFrom: today,
          dateTo: addCalendarDays(today, 1),
          backLocal: '23:59',
          expectedVersion: 3,
          requestKey: 'room-short-request',
        })
      ).ok,
      true,
    )
    const after = (await call('listInventory', {
      propertyId: 'hotel',
      roomTypeId: 'type',
      from: today,
      to: addCalendarDays(today, 4),
    })) as unknown as Array<{ blocked: number }>
    assert.equal(
      after.every((r) => r.blocked === 0),
      true,
    )
    assert.equal((await call('getRoom', { id: room.id })).status, 'dirty')
  } finally {
    await adapter.close()
  }
})

test('Hospitality catalogue edits retain identity and reject stale drafts without partial writes', async () => {
  const { adapter, call, room } = await boot()
  try {
    assert.equal((await call('getRoom', { id: room.id })).status, 'dirty')
    const edit = { ...room, name: 'Updated room', expectedVersion: 1, requestKey: 'room-edit-request' }
    const saved = await call('saveRoom', edit)
    assert.equal(saved.ok, true)
    assert.deepEqual(await call('saveRoom', edit), saved)
    assert.ok(
      codes(await call('saveRoom', { ...edit, name: 'Stale draft', requestKey: 'room-stale-edit' })).includes(
        'transition_conflict',
      ),
    )
    assert.ok(
      codes(
        await call('saveRoom', { ...edit, code: '102', expectedVersion: 2, requestKey: 'room-code-edit' }),
      ).includes('immutable_code'),
    )
    assert.equal((await call('getRoom', { id: room.id })).name, 'Updated room')
    assert.equal((await call('getRoom', { id: room.id })).version, 2)
  } finally {
    await adapter.close()
  }
})

test('Hospitality cleaning waits for configured inspection; failed inspection returns the room to dirty', async () => {
  const { adapter, call } = await boot()
  try {
    assert.equal(
      (
        await call('setInspectionRequirement', {
          propertyId: 'hotel',
          required: true,
          expectedVersion: (await call('getProperty', { id: 'hotel' })).version,
          requestKey: 'inspection-setting-request',
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await call('createCleaningTask', {
          id: 'clean',
          code: 'C-1',
          roomId: 'room',
          taskType: 'checkout_clean',
        })
      ).ok,
      true,
    )
    assert.equal((await call('startCleaningTask', { id: 'clean' })).ok, true)
    assert.equal(
      (
        await call('completeCleaningTask', {
          checklist: ['linen', 'bathroom', 'supplies', 'final'],
          id: 'clean',
        })
      ).ok,
      true,
    )
    const pending = await call('getRoom', { id: 'room' })
    assert.equal(pending.status, 'inspection')
    assert.equal(
      (
        await call('inspectRoom', {
          roomId: 'room',
          passed: false,
          reason: 'Bathroom needs work',
          expectedVersion: pending.version,
          requestKey: 'inspection-fail-request',
        })
      ).ok,
      true,
    )
    assert.equal((await call('getRoom', { id: 'room' })).status, 'dirty')
  } finally {
    await adapter.close()
  }
})

test('Hospitality setup properties require a sellable catalogue before opening', async () => {
  const { adapter, call } = await boot()
  try {
    assert.equal((await call('getProperty', { id: 'hotel' })).lifecycle, 'setup')
    assert.ok(
      codes(
        await call('setPropertyLifecycle', {
          propertyId: 'hotel',
          lifecycle: 'active',
          expectedVersion: 1,
          requestKey: 'property-open-missing-rate',
        }),
      ).includes('property_open_blocked'),
    )
    assert.equal(
      (
        await call('saveRatePlan', {
          id: 'rate',
          propertyId: 'hotel',
          roomTypeId: 'type',
          code: 'BAR',
          name: 'Best rate',
          rateType: 'nightly',
          amount: '1000000',
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await call('setPropertyLifecycle', {
          propertyId: 'hotel',
          lifecycle: 'active',
          expectedVersion: (await call('getProperty', { id: 'hotel' })).version,
          requestKey: 'property-open-ready',
        })
      ).ok,
      true,
    )
    assert.equal((await call('getProperty', { id: 'hotel' })).lifecycle, 'active')
  } finally {
    await adapter.close()
  }
})

test('Hospitality property content canonicalizes languages, keeps Vietnamese, and rejects stale parent or locale versions atomically', async () => {
  const { adapter, call } = await boot()
  try {
    const version = async () => Number((await call('getProperty', { id: 'hotel' })).version)
    const input = {
      propertyId: 'hotel',
      locale: 'vi',
      title: 'Khách sạn',
      description: 'Mô tả cơ sở',
      expectedVersion: 0,
      expectedPropertyVersion: await version(),
      requestKey: 'vietnamese-content-create',
    }
    assert.equal((await call('saveContentLocale', input)).ok, true)
    const translated = {
      ...input,
      locale: 'ZH-hant',
      title: 'Hotel',
      description: 'Traditional Chinese content',
      expectedPropertyVersion: await version(),
      requestKey: 'traditional-chinese-content',
    }
    const saved = await call('saveContentLocale', translated)
    assert.equal(saved.ok, true)
    assert.equal(saved.id, 'property:hotel:zh-Hant')
    assert.deepEqual(await call('saveContentLocale', translated), saved)
    const before = await version()
    assert.ok(
      codes(
        await call('saveContentLocale', {
          ...translated,
          locale: 'zh-Hant',
          expectedPropertyVersion: before,
          requestKey: 'duplicate-canonical-language',
        }),
      ).includes('content_locale_duplicate'),
    )
    assert.equal(await version(), before)
    assert.ok(
      codes(
        await call('saveContentLocale', {
          ...translated,
          id: saved.id,
          expectedVersion: 99,
          expectedPropertyVersion: before,
          requestKey: 'stale-locale-editor',
        }),
      ).includes('transition_conflict'),
    )
    assert.ok(
      codes(
        await call('removeContentLocale', {
          propertyId: 'hotel',
          locale: 'vi',
          expectedVersion: 1,
          expectedPropertyVersion: before,
          requestKey: 'remove-default-vietnamese',
        }),
      ).includes('content_default_locale'),
    )
    assert.ok(
      codes(
        await call('saveContentLocale', {
          ...input,
          locale: 'not_a_language',
          expectedPropertyVersion: before,
          requestKey: 'invalid-language-code',
        }),
      ).includes('content_locale'),
    )
    const data = await call('getPropertyWorkbench', { propertyId: 'hotel' })
    assert.equal((data.locales as Array<unknown>).length, 2)
    assert.equal(await version(), before)
  } finally {
    await adapter.close()
  }
})

test('Hospitality published fees preserve exact amounts and basis without creating folio charges', async () => {
  const { adapter, call } = await boot()
  try {
    const input = {
      id: 'parking-fee',
      propertyId: 'hotel',
      chargeType: 'parking',
      basis: 'per_night',
      included: true,
      name: 'Parking',
      amount: '9007199254740993.01',
      expectedVersion: 0,
      expectedPropertyVersion: (await call('getProperty', { id: 'hotel' })).version,
      requestKey: 'parking-fee-create',
    }
    assert.equal((await call('savePropertyCharge', input)).ok, true)
    assert.deepEqual(await call('savePropertyCharge', input), await call('savePropertyCharge', input))
    const prior = (await call('getProperty', { id: 'hotel' })).version
    const data = await call('getPropertyWorkbench', { propertyId: 'hotel' })
    const fee = (data.charges as Array<Record<string, unknown>>)[0]!
    assert.equal(fee.amount, input.amount)
    assert.equal(fee.basis, 'per_night')
    assert.equal(fee.included, true)
    assert.ok(
      codes(
        await call('savePropertyCharge', {
          ...input,
          basis: 'per_bed',
          expectedVersion: fee.version,
          expectedPropertyVersion: prior,
          requestKey: 'invalid-published-fee-basis',
        }),
      ).includes('property_charge_basis'),
    )
    assert.equal((await call('getProperty', { id: 'hotel' })).version, prior)
    assert.equal((await call('searchFolios', {})).total, 0)
  } finally {
    await adapter.close()
  }
})

test('Hospitality property drafts conflict after child configuration changes and reactivation requires reopening', async () => {
  const { adapter, call, property } = await boot()
  try {
    const prior = (await call('getProperty', { id: 'hotel' })).version
    assert.equal(
      (
        await call('saveRatePlan', {
          id: 'rate',
          propertyId: 'hotel',
          roomTypeId: 'type',
          code: 'BAR',
          name: 'Rate',
          rateType: 'nightly',
          amount: '1000',
          requestKey: 'rate-before-property-conflict',
        })
      ).ok,
      true,
    )
    assert.ok(
      codes(
        await call('saveProperty', {
          ...property,
          name: 'Stale editor',
          expectedVersion: prior,
          requestKey: 'stale-property-editor',
        }),
      ).includes('transition_conflict'),
    )
    const version = async () => (await call('getProperty', { id: 'hotel' })).version
    assert.equal(
      (
        await call('setPropertyLifecycle', {
          propertyId: 'hotel',
          lifecycle: 'active',
          expectedVersion: await version(),
          requestKey: 'open-property-before-stop',
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await call('setPropertyLifecycle', {
          propertyId: 'hotel',
          lifecycle: 'stopped',
          expectedVersion: await version(),
          requestKey: 'stop-property-empty',
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await call('setPropertyLifecycle', {
          propertyId: 'hotel',
          lifecycle: 'setup',
          expectedVersion: await version(),
          requestKey: 'reactivate-property-setup',
        })
      ).ok,
      true,
    )
    assert.equal((await call('getProperty', { id: 'hotel' })).lifecycle, 'setup')
    assert.equal((await call('getProperty', { id: 'hotel' })).active, true)
  } finally {
    await adapter.close()
  }
})

test('Hospitality command receipts cannot be replayed by another actor or branch selection', async () => {
  const { adapter, call, room } = await boot()
  try {
    const input = {
      ...room,
      name: 'Recorded edit',
      expectedVersion: 1,
      requestKey: 'scope-bound-edit-request',
    }
    const scope = { company: 'hotel', branches: null }
    // Through the room fixture, which keeps the room's building and floor on the edit.
    const run = async (actor: string, selected: { company: string; branches: string[] | null } = scope) =>
      (
        await roomFixtureCall('hospitality_core.saveRoom', input, {
          adapter,
          manifest,
          actor,
          scope: selected,
        })
      ).value as Record<string, unknown>
    const saved = await run('operator-a')
    assert.equal(saved.ok, true)
    assert.deepEqual(await run('operator-a'), saved)
    assert.ok(codes(await run('operator-b')).includes('request_reused'))
    assert.ok(
      codes(await run('operator-a', { ...scope, branches: ['root:hotel'] })).includes('request_reused'),
    )
    assert.equal((await call('getRoom', { id: room.id })).name, 'Recorded edit')
  } finally {
    await adapter.close()
  }
})

test('Hospitality gallery commands fence property versions, replay once, isolate targets and preserve primary and ordering atomically', async () => {
  const { adapter, call } = await boot()
  try {
    const scope = { company: 'hotel', branches: null }
    const version = async () => Number((await call('getProperty', { id: 'hotel' })).version)
    const attach = async (id: string, roomTypeId?: string) => {
      await callFn(
        'storage.createAttachment',
        {
          id,
          name: `${id}.png`,
          resModel: roomTypeId ? 'hospitality_core.RoomType' : 'hospitality_core.Property',
          resId: roomTypeId ?? 'hotel',
          resField: 'contentImages',
          kind: 'stored',
          storeKey: `blobs/hotel/aa/${'a'.repeat(64)}`,
          mimetype: 'image/png',
          size: 1000,
          checksum: 'a'.repeat(64),
          public: true,
          createdAt: new Date().toISOString(),
        },
        { adapter, manifest, scope },
      )
      await call('recordContentImageEvidence', {
        attachmentId: id,
        checksum: 'a'.repeat(64),
        mimetype: 'image/png',
        width: 1024,
        height: 1200,
      })
      return {
        id,
        attachmentId: id,
        ...(roomTypeId ? { roomTypeId } : { propertyId: 'hotel' }),
        category: roomTypeId ? 'room' : 'exterior',
        expectedPropertyVersion: await version(),
        requestKey: `attach-gallery-${id}`,
      }
    }
    const first = await attach('gallery-a'),
      created = await call('attachContentImage', first)
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.primary, true)
    assert.deepEqual(await call('attachContentImage', first), created)
    const next = await attach('gallery-b')
    assert.equal((await call('attachContentImage', next)).ok, true)
    const stale = await call('updateContentImage', {
      id: 'gallery-a',
      category: 'lobby',
      expectedPropertyVersion: first.expectedPropertyVersion,
      requestKey: 'stale-gallery-metadata',
    })
    assert.ok(codes(stale).includes('transition_conflict'))
    const before = await version()
    const edit = {
      id: 'gallery-b',
      category: 'lobby',
      caption: 'Lobby',
      expectedPropertyVersion: before,
      requestKey: 'edit-gallery-metadata',
    }
    assert.ok(
      codes(await call('updateContentImage', { ...edit, caption: 'x'.repeat(121) })).includes(
        'content_caption',
      ),
    )
    assert.ok(
      codes(
        await call('removeContentImage', {
          id: 'gallery-a',
          expectedPropertyVersion: before,
          requestKey: 'remove-gallery-primary',
        }),
      ).includes('content_primary'),
    )
    assert.ok(
      codes(
        await call('reorderContentImages', {
          propertyId: 'hotel',
          ids: ['gallery-b', 'gallery-b'],
          expectedPropertyVersion: before,
          requestKey: 'bad-gallery-order',
        }),
      ).includes('content_order'),
    )
    assert.equal(await version(), before, 'invalid writes roll back property claims and receipts')
    assert.equal((await call('updateContentImage', edit)).ok, true)
    assert.ok(
      codes(await call('updateContentImage', { ...edit, caption: 'Different' })).includes('request_reused'),
    )
    const denied = (
      await callFn(
        'hospitality_core.setPrimaryContentImage',
        { id: 'gallery-b', expectedPropertyVersion: await version(), requestKey: 'gallery-other-branch' },
        { adapter, manifest, scope: { company: 'hotel', branches: ['elsewhere'] } },
      )
    ).value as Record<string, unknown>
    assert.ok(codes(denied).includes('property_scope'))
    assert.ok(
      codes(
        await call(
          'updateContentImage',
          { ...edit, expectedPropertyVersion: await version(), requestKey: 'gallery-other-company' },
          'other-company',
        ),
      ).includes('record_missing'),
    )
    const room = await attach('gallery-room', 'type')
    assert.equal((await call('attachContentImage', room)).ok, true)
    assert.ok(
      codes(
        await call('reorderContentImages', {
          propertyId: 'hotel',
          ids: ['gallery-a', 'gallery-room'],
          expectedPropertyVersion: await version(),
          requestKey: 'gallery-mixed-target-order',
        }),
      ).includes('content_order'),
    )
    assert.equal(
      (
        await call('setPrimaryContentImage', {
          id: 'gallery-b',
          expectedPropertyVersion: await version(),
          requestKey: 'gallery-primary-switch',
        })
      ).ok,
      true,
    )
    const removed = {
      id: 'gallery-a',
      expectedPropertyVersion: await version(),
      requestKey: 'gallery-remove-form',
    }
    assert.equal((await call('removeContentImage', removed)).ok, true)
    assert.deepEqual(await call('removeContentImage', removed), { ok: true, id: 'gallery-a' })
    const images = (await call('listContentImages', { propertyId: 'hotel' })) as unknown as Array<
      Record<string, unknown>
    >
    assert.deepEqual(
      images.map((row) => [row.id, row.primary, row.caption]),
      [['gallery-b', true, 'Lobby']],
    )
    assert.equal('storeKey' in (images[0]!.attachment as Record<string, unknown>), false)
    assert.equal(
      (await adapter.all('SELECT id FROM storage_attachment WHERE id = ?', ['gallery-a'])).length,
      0,
    )
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_operational_change WHERE action = ?', [
          'content-image-removeContentImage',
        ])
      ).length,
      1,
    )
    await assert.rejects(
      call('updateContentImage', { id: 'gallery-b', category: 'room' }),
      /expectedPropertyVersion|requestKey/,
    )
    for (let i = 0; i < 29; i++)
      assert.equal((await call('attachContentImage', await attach(`gallery-limit-${i}`))).ok, true)
    const overLimit = await attach('gallery-over-limit'),
      fullVersion = await version()
    assert.ok(codes(await call('attachContentImage', overLimit)).includes('content_image_limit'))
    assert.equal(await version(), fullVersion)
    const full = (await call('listContentImages', { propertyId: 'hotel' })) as unknown as Array<
      Record<string, unknown>
    >
    assert.equal(full.length, 30)
    assert.equal(full.filter((row) => row.primary).length, 1)
    assert.equal(
      ((await call('listContentImages', { roomTypeId: 'type' })) as unknown as unknown[]).length,
      1,
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality structure lifecycle counts dependencies, preserves archived rooms, fences drafts and restores in parent order', async () => {
  const { adapter, call } = await boot()
  try {
    assert.equal(
      (await call('saveBuilding', { id: 'tower', propertyId: 'hotel', code: 'A', name: 'Tower A' })).ok,
      true,
    )
    assert.equal(
      (
        await call('saveFloor', {
          id: 'floor',
          propertyId: 'hotel',
          buildingId: 'tower',
          code: '1',
          name: 'Floor 1',
          level: 1,
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await call('saveRoom', {
          id: 'located-room',
          propertyId: 'hotel',
          roomTypeId: 'type',
          buildingId: 'tower',
          floorId: 'floor',
          code: '201',
          name: 'Located room',
          capacity: 2,
        })
      ).ok,
      true,
    )
    // The boot's room sits on the fixture's own building and floor; this test reads the ones it made.
    const located = (rows: unknown, id: string) =>
      (rows as Array<Record<string, unknown>>).find((row) => row.id === id)
    let serial = 0
    const input = async (kind: string, id: string, active: boolean) => ({
      id,
      active,
      propertyId: 'hotel',
      expectedVersion: (await call(`get${kind}`, { id })).version,
      expectedPropertyVersion: (await call('getProperty', { id: 'hotel' })).version,
      requestKey: `structure-command-${++serial}`,
    })
    const snapshot = async () => ({
      property: (await call('getProperty', { id: 'hotel' })).version,
      buildings: await adapter.all('SELECT id, active, version FROM hospitality_core_building ORDER BY id'),
      floors: await adapter.all('SELECT id, active, version FROM hospitality_core_floor ORDER BY id'),
      receipts: await adapter.all('SELECT id FROM hospitality_core_command_receipt ORDER BY id'),
    })
    const original = await snapshot()
    assert.ok(
      codes(await call('archiveBuilding', await input('Building', 'tower', false))).includes(
        'location_has_active_floors',
      ),
    )
    assert.ok(
      codes(await call('archiveFloor', await input('Floor', 'floor', false))).includes(
        'location_has_active_rooms',
      ),
    )
    assert.deepEqual(
      await snapshot(),
      original,
      'refusals leave versions, active flags and receipts unchanged',
    )
    let workbench = await call('getPropertyWorkbench', { propertyId: 'hotel' })
    assert.equal(located(workbench.buildings, 'tower')?.activeFloorCount, 1)
    assert.equal(located(workbench.floors, 'floor')?.roomCount, 1)
    assert.equal(located(workbench.floors, 'floor')?.activeRoomCount, 1)
    const stale = await input('Floor', 'floor', false)
    assert.equal((await call('archiveRoom', { id: 'located-room', active: false })).ok, true)
    assert.ok(codes(await call('archiveFloor', stale)).includes('transition_conflict'))
    workbench = await call('getPropertyWorkbench', { propertyId: 'hotel' })
    assert.equal(located(workbench.floors, 'floor')?.roomCount, 1)
    assert.equal(located(workbench.floors, 'floor')?.activeRoomCount, 0)
    const archive = await input('Floor', 'floor', false)
    const archived = await call('archiveFloor', archive)
    assert.equal(archived.ok, true, JSON.stringify(archived))
    const committed = await snapshot()
    assert.deepEqual(await call('archiveFloor', archive), archived)
    assert.deepEqual(await snapshot(), committed, 'an identical receipt does not bump versions twice')
    assert.ok(codes(await call('archiveFloor', { ...archive, active: true })).includes('request_reused'))
    assert.equal((await call('archiveBuilding', await input('Building', 'tower', false))).ok, true)
    const parentArchived = await snapshot()
    assert.ok(
      codes(await call('archiveFloor', await input('Floor', 'floor', true))).includes('location_archived'),
    )
    assert.deepEqual(await snapshot(), parentArchived)
    assert.equal((await call('archiveBuilding', await input('Building', 'tower', true))).ok, true)
    assert.equal((await call('archiveFloor', await input('Floor', 'floor', true))).ok, true)
    const scoped = await input('Building', 'tower', false)
    assert.ok(
      codes(await call('archiveBuilding', { ...scoped, propertyId: 'another-property' })).includes(
        'property_mismatch',
      ),
    )
    assert.ok(codes(await call('archiveBuilding', scoped, 'other-company')).includes('building_missing'))
    const branchResult = (
      await callFn('hospitality_core.archiveBuilding', scoped, {
        adapter,
        manifest,
        scope: { company: 'hotel', branches: ['not-the-property-branch'] },
      })
    ).value as Record<string, unknown>
    assert.ok(codes(branchResult).includes('property_scope'))
    assert.ok(codes(await call('archiveBuilding', { ...scoped, requestKey: '' })).includes('request_key'))
    assert.ok(
      codes(
        await call('archiveBuilding', { ...scoped, expectedVersion: Number(scoped.expectedVersion) - 1 }),
      ).includes('transition_conflict'),
    )
    assert.equal(
      (await call('getRoom', { id: 'located-room' })).active,
      false,
      'restoring a location never restores its rooms implicitly',
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality structure edits enforce bounds and move all floor rooms atomically with fresh room versions', async () => {
  const { adapter, call } = await boot()
  try {
    for (const id of ['tower-a', 'tower-b'])
      assert.equal(
        (await call('saveBuilding', { id, propertyId: 'hotel', code: id.toUpperCase(), name: id })).ok,
        true,
      )
    for (const sequence of [0, 1000])
      assert.ok(
        codes(
          await call('saveBuilding', {
            id: 'invalid-building',
            propertyId: 'hotel',
            code: 'INVALID',
            name: 'Invalid',
            sequence,
          }),
        ).includes('structure_sequence'),
      )
    const floor = {
      id: 'moving-floor',
      propertyId: 'hotel',
      buildingId: 'tower-a',
      code: 'G',
      name: 'Ground floor',
      sequence: 1,
      level: -5,
    }
    assert.equal((await call('saveFloor', floor)).ok, true)
    for (const level of [-6, 201])
      assert.ok(codes(await call('saveFloor', { ...floor, level })).includes('floor_level'))
    assert.ok(codes(await call('saveFloor', { ...floor, sequence: 1000 })).includes('structure_sequence'))
    // Synthetic scale fixture: migration must visit both batches, including archived rooms.
    for (let i = 0; i < 101; i++)
      await adapter.run(
        'INSERT INTO hospitality_core_room (id, "companyId", "propertyId", "roomTypeId", "buildingId", "floorId", code, name, capacity, status, active, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          `floor-room-${String(i).padStart(3, '0')}`,
          'hotel',
          'hotel',
          'type',
          'tower-a',
          floor.id,
          `F-${i}`,
          `Floor room ${i}`,
          2,
          'available',
          i % 2,
          1,
        ],
      )
    const args = {
      ...floor,
      buildingId: 'tower-b',
      code: 'GROUND',
      level: 200,
      sequence: 999,
      expectedVersion: (await call('getFloor', { id: floor.id })).version,
      expectedPropertyVersion: (await call('getProperty', { id: 'hotel' })).version,
      requestKey: 'move-floor-with-all-rooms',
    }
    assert.equal((await call('saveFloor', args)).ok, true)
    const rooms = await adapter.all(
      'SELECT "buildingId", version FROM hospitality_core_room WHERE "floorId" = ?',
      [floor.id],
    )
    assert.equal(rooms.length, 101)
    assert.ok(rooms.every((row) => row.buildingId === 'tower-b' && row.version === 2))
    const moved = await call('getFloor', { id: floor.id })
    assert.equal(moved.code, 'GROUND')
    assert.equal(moved.level, 200)
    assert.equal((await call('saveFloor', args)).ok, true, 'replay succeeds without moving twice')
    assert.ok(
      (await adapter.all('SELECT version FROM hospitality_core_room WHERE "floorId" = ?', [floor.id])).every(
        (row) => row.version === 2,
      ),
    )
    const workbench = await call('getPropertyWorkbench', { propertyId: 'hotel' })
    const buildings = workbench.buildings as Array<Record<string, unknown>>
    assert.equal(buildings.find((row) => row.id === 'tower-a')?.roomCount, 0)
    assert.equal(buildings.find((row) => row.id === 'tower-b')?.roomCount, 101)
    assert.equal(buildings.find((row) => row.id === 'tower-b')?.activeRoomCount, 50)
  } finally {
    await adapter.close()
  }
})

test('Hospitality property completeness and configuration keep the mock limits and central branch', async () => {
  const { adapter, call } = await boot()
  try {
    const basic = { name: 'New property', accommodationType: 'hotel', timezone: 'Asia/Ho_Chi_Minh' }
    for (const code of ['X', 'A'.repeat(17), '-HOTEL', 'HOTEL CODE'])
      assert.ok(
        codes(await call('saveProperty', { ...basic, id: 'invalid-property', code })).includes(
          'property_code_format',
        ),
      )
    for (const [id, code] of [
      ['short-property', 'AB'],
      ['long-property', 'A'.repeat(16)],
    ]) {
      assert.equal((await call('saveProperty', { ...basic, id, code })).ok, true)
      const property = await call('getProperty', { id })
      assert.ok(property.branchId, 'omitted branch resolves to the company central branch')
      const branch = (
        await adapter.all('SELECT "rootKey" FROM company_branch WHERE id = ?', [property.branchId])
      )[0]
      assert.equal(branch?.rootKey, 'hotel')
      const workbench = await call('getPropertyWorkbench', { propertyId: id })
      assert.ok(
        (workbench.missingContent as Array<{ code: string }>).some((row) => row.code === 'room_types'),
      )
    }
    assert.equal(
      (
        await call('saveCancellationPolicy', {
          id: 'default-policy',
          code: 'DEFAULT',
          name: 'Default policy',
          type: 'flexible',
        })
      ).ok,
      true,
    )
    const property = await call('getProperty', { id: 'hotel' })
    assert.equal(
      (
        await call('saveProperty', {
          ...basic,
          id: 'hotel',
          code: property.code,
          name: property.name,
          branchId: property.branchId,
          defaultCancellationPolicyId: 'default-policy',
          expectedVersion: property.version,
          requestKey: 'property-default-policy',
        })
      ).ok,
      true,
    )
    let workbench = await call('getPropertyWorkbench', { propertyId: 'hotel' })
    assert.equal(
      (workbench.missingContent as Array<{ code: string }>).some((row) => row.code === 'cancellation_policy'),
      false,
    )
    await adapter.run('UPDATE hospitality_core_cancellation_policy SET active = 0 WHERE id = ?', [
      'default-policy',
    ])
    workbench = await call('getPropertyWorkbench', { propertyId: 'hotel' })
    assert.ok(
      (workbench.missingContent as Array<{ code: string }>).some((row) => row.code === 'cancellation_policy'),
    )
  } finally {
    await adapter.close()
  }
})

test('Inventory workbench applies sparse weekday rules with replay and version fencing', async () => {
  const { adapter, call } = await boot()
  try {
    const property = await call('getProperty', { id: 'hotel' })
    const base = {
      propertyId: 'hotel',
      roomTypeId: 'type',
      from: today,
      to: addCalendarDays(today, 6),
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    }
    const first = await call('changeInventoryRules', {
      ...base,
      expectedVersion: property.version,
      requestKey: 'rules-seed',
      minLos: 2,
      maxLos: 6,
      stopSell: true,
    })
    assert.equal(first.ok, true, JSON.stringify(first))
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7
    const input = {
      ...base,
      weekdays: [weekday],
      expectedVersion: first.version,
      requestKey: 'rules-sparse',
      total: 1,
      closedToArrival: true,
    }
    const changed = await call('changeInventoryRules', input)
    assert.equal(changed.ok, true, JSON.stringify(changed))
    assert.equal(changed.count, 1)
    assert.deepEqual(await call('changeInventoryRules', input), changed)
    assert.equal((await call('changeInventoryRules', { ...input, total: 0 })).ok, false)
    assert.ok(
      codes(await call('changeInventoryRules', { ...input, requestKey: 'stale-version' })).includes(
        'transition_conflict',
      ),
    )
    const nights = ((await call('getInventoryWorkbench', { propertyId: 'hotel' })).record as any).roomTypes[0]
      .nights
    assert.equal(nights.length, 7)
    for (const night of nights) {
      assert.equal(night.minLos, 2)
      assert.equal(night.maxLos, 6)
      assert.equal(night.stopSell, true)
      assert.equal(night.closedToArrival, night.date === today)
      assert.equal(night.totalManual, night.date === today)
    }
    const reset = await call('changeInventoryRules', {
      ...base,
      expectedVersion: changed.version,
      requestKey: 'reset-physical',
      minLos: 1,
      maxLos: 30,
      stopSell: false,
      followRooms: true,
    })
    assert.equal(reset.ok, true, JSON.stringify(reset))
    const resetNights = ((await call('getInventoryWorkbench', { propertyId: 'hotel' })).record as any)
      .roomTypes[0].nights
    assert.ok(
      resetNights.every((n: any) => n.minLos === 0 && n.maxLos === 0 && !n.stopSell && !n.totalManual),
    )
    assert.equal(resetNights[0].closedToArrival, true)
  } finally {
    await adapter.close()
  }
})

test('Inventory workbench rejects one overcommitted day atomically and preserves sparse LOS', async () => {
  const { adapter, call } = await boot()
  try {
    const property = await call('getProperty', { id: 'hotel' })
    const base = {
      propertyId: 'hotel',
      roomTypeId: 'type',
      from: today,
      to: addCalendarDays(today, 2),
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    }
    const seeded = await call('changeInventoryRules', {
      ...base,
      expectedVersion: property.version,
      requestKey: 'capacity-seed',
      total: 1,
      maxLos: 3,
    })
    assert.equal(seeded.ok, true, JSON.stringify(seeded))
    await adapter.run(
      'UPDATE hospitality_core_availability_ledger SET sold = 1, available = 0 WHERE id = ?',
      [`type:${addCalendarDays(today, 1)}`],
    )
    const snapshot = async () =>
      Promise.all(
        [
          'availability_ledger',
          'restriction',
          'command_receipt',
          'inventory_change',
          'operational_change',
          'property',
        ].map((model) => adapter.all(`SELECT * FROM hospitality_core_${model} ORDER BY id`)),
      )
    const before = await snapshot()
    const rejected = await call('changeInventoryRules', {
      ...base,
      expectedVersion: seeded.version,
      requestKey: 'capacity-refusal',
      total: 0,
      stopSell: true,
    })
    assert.ok(codes(rejected).includes('inventory_capacity'), JSON.stringify(rejected))
    assert.equal((rejected.errors as any[])[0].params.date, addCalendarDays(today, 1))
    assert.deepEqual(await snapshot(), before)
    const los = await call('changeInventoryRules', {
      ...base,
      expectedVersion: seeded.version,
      requestKey: 'los-refusal',
      minLos: 5,
      total: 1,
    })
    assert.ok(codes(los).includes('inventory_los_conflict'), JSON.stringify(los))
    assert.deepEqual(await snapshot(), before)
  } finally {
    await adapter.close()
  }
})

test('Inventory workbench enforces horizon, locks, physical capacity, inputs and company scope', async () => {
  const { adapter, call } = await boot()
  try {
    const property = await call('getProperty', { id: 'hotel' })
    const base = {
      propertyId: 'hotel',
      roomTypeId: 'type',
      expectedVersion: property.version,
      from: today,
      to: today,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      stopSell: true,
    }
    for (const [patch, code] of [
      [{ from: addCalendarDays(today, -1) }, 'inventory_date_past'],
      [{ to: addCalendarDays(today, 365) }, 'inventory_date_horizon'],
      [{ weekdays: [] }, 'inventory_weekdays'],
      [{ weekdays: [0] }, 'inventory_weekdays'],
      [
        { weekdays: [((new Date(`${today}T00:00:00Z`).getUTCDay() || 7) % 7) + 1] },
        'inventory_weekdays_empty',
      ],
      [{ total: 2 }, 'inventory_total_physical'],
      [{ total: -1 }, 'inventory_total_physical'],
      [{ minLos: 0 }, 'inventory_los_limit'],
      [{ maxLos: 31 }, 'inventory_los_limit'],
      [{ total: 1, followRooms: true }, 'inventory_total_conflict'],
      [{ roomTypeId: 'foreign-type' }, 'property_mismatch'],
    ] as const)
      assert.ok(
        codes(await call('changeInventoryRules', { ...base, requestKey: `bad-${code}`, ...patch })).includes(
          code,
        ),
        code,
      )
    await assert.rejects(
      () =>
        call('changeInventoryRules', {
          ...base,
          from: `${today.slice(0, 4)}-02-30`,
          requestKey: 'invalid-date',
        }),
      /calendar date/,
    )
    assert.ok(codes(await call('changeInventoryRules', { ...base, requestKey: '' })).includes('request_key'))
    assert.equal(
      (await call('changeInventoryRules', { ...base, requestKey: 'foreign-property' }, 'foreign')).ok,
      false,
    )
    assert.equal((await call('getInventoryWorkbench', { propertyId: 'hotel' }, 'foreign')).record, null)
    await adapter.run('UPDATE hospitality_core_property SET "closingDate" = ? WHERE id = ?', [today, 'hotel'])
    assert.ok(
      codes(await call('changeInventoryRules', { ...base, requestKey: 'locked-day' })).includes(
        'business_date_locked',
      ),
    )
    await adapter.run('UPDATE hospitality_core_property SET "closingDate" = NULL WHERE id = ?', ['hotel'])
    const boundary = await call('changeInventoryRules', {
      ...base,
      from: addCalendarDays(today, 364),
      to: addCalendarDays(today, 364),
      requestKey: 'boundary',
    })
    assert.equal(boundary.ok, true, JSON.stringify(boundary))
  } finally {
    await adapter.close()
  }
})

test('Inventory workbench pages room types and clamps seven-day windows with branch isolation', async () => {
  const { adapter, call } = await boot()
  try {
    for (let i = 0; i < 26; i++)
      assert.equal(
        (
          await call('saveRoomType', {
            id: `page-type-${String(i).padStart(2, '0')}`,
            propertyId: 'hotel',
            code: `P${i}`,
            name: `Room type ${String(i).padStart(2, '0')}`,
            maxAdults: 2,
          })
        ).ok,
        true,
      )
    const first = (await call('getInventoryWorkbench', { propertyId: 'hotel', page: 1, from: '2000-01-01' }))
      .record as any
    const last = (await call('getInventoryWorkbench', { propertyId: 'hotel', page: 999, from: '9999-12-31' }))
      .record as any
    assert.equal(first.roomTypes.length, 25)
    assert.equal(last.roomTypes.length, 2)
    assert.equal(last.page, 2)
    assert.equal(first.total, 27)
    assert.equal(first.from, today)
    assert.equal(last.to, addCalendarDays(today, 364))
    assert.equal(new Set([...first.roomTypes, ...last.roomTypes].map((r: any) => r.id)).size, 27)
    assert.ok(first.roomTypes.every((r: any) => r.nights.length === 7 && !('companyId' in r)))
    const restricted = await callFn(
      'hospitality_core.getInventoryWorkbench',
      { propertyId: 'hotel' },
      { adapter, manifest, scope: { company: 'hotel', branches: ['outside'] } },
    )
    assert.equal((restricted.value as any).record, null)
  } finally {
    await adapter.close()
  }
})
