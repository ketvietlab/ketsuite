import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import { folioBalanceEvidence } from '../packages/ketsuite/src/modules/hospitality_billing/functions/folio-balances.ts'
import { earlyArrivalAmount } from '../packages/ketsuite/src/modules/hospitality_core/functions/arrival-fee.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import {
  account,
  address,
  company,
  hospitalityBilling,
  hospitalityCore,
  partner,
  product,
  storage,
  uom,
} from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { hospitalityRecordBack } from '../packages/ketsuite/src/modules/hospitality_core/screens/scoped-href.ts'
import {
  addCalendarDays,
  dateKeyIn,
  zonedDateTime,
} from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
const modules = [
  address,
  partner,
  company,
  storage,
  backend,
  uom,
  product,
  account,
  hospitalityCore,
  hospitalityBilling,
]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'hotel', branches: null }
const arrivalGuest = {
  fullName: 'Synthetic guest',
  type: 'passport',
  number: 'TEST1234',
  birth: '1990-01-01',
  gender: 'female',
  nationality: 'VN',
}
async function boot(arrivalOffset = 1) {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await roomFixtureCall(name, args, { adapter, manifest, scope })).value as Record<string, unknown>
  const must = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args)
    assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result.errors)}`)
    return result
  }
  await must('partner.savePartner', { id: 'company-party', name: 'Hotel Company', kind: 'company' })
  await must('company.saveCompany', {
    id: 'hotel',
    code: 'HOTEL',
    partnerId: 'company-party',
    currency: 'VND',
    accountingTimezone: 'Asia/Ho_Chi_Minh',
  })
  for (const id of ['guest', 'other-guest'])
    await must('partner.savePartner', { id, name: id, kind: 'person' })
  await must('account.saveAccount', {
    id: 'receivable',
    code: '131',
    name: 'Receivable',
    accountType: 'asset_receivable',
  })
  await must('account.saveDefaults', { receivableAccountId: 'receivable' })
  await must('account.saveAccount', { id: 'cash', code: '1111', name: 'Cash', accountType: 'asset_cash' })
  await must('account.saveJournal', {
    id: 'cash-journal',
    name: 'Cash',
    code: 'CSH',
    type: 'cash',
    defaultAccountId: 'cash',
  })
  await must('hospitality_core.saveProperty', {
    id: 'property',
    code: 'HOTEL',
    name: 'Test Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
    allowWeekly: true,
    longStayBillOnCheckIn: true,
  })
  await must('hospitality_core.saveRoomType', {
    id: 'type',
    propertyId: 'property',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '500',
    allowWeekly: true,
  })
  for (const id of ['101', '102'])
    await must('hospitality_core.saveRoom', {
      id,
      propertyId: 'property',
      roomTypeId: 'type',
      code: id,
      name: id,
    })
  await must('hospitality_core.saveRatePlan', {
    id: 'rate',
    propertyId: 'property',
    roomTypeId: 'type',
    code: 'BAR',
    name: 'Rate',
    rateType: 'nightly',
    amount: '500',
  })
  const property = await call('hospitality_core.getProperty', { id: 'property' })
  await must('hospitality_core.setPropertyLifecycle', {
    propertyId: 'property',
    lifecycle: 'active',
    expectedVersion: property.version,
    requestKey: 'open-property-guarantee-test',
  })
  const today = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
  for (const id of ['booking-1', 'booking-2'])
    await must('hospitality_core.createReservation', {
      id,
      code: id,
      propertyId: 'property',
      roomTypeId: 'type',
      partnerId: 'guest',
      provider: id === 'booking-1' ? 'website' : 'direct',
      checkIn: zonedDateTime(addCalendarDays(today, arrivalOffset), 14, 0, 'Asia/Ho_Chi_Minh').toISOString(),
      checkOut: zonedDateTime(
        addCalendarDays(today, arrivalOffset + 1),
        12,
        0,
        'Asia/Ho_Chi_Minh',
      ).toISOString(),
      adults: 1,
    })
  const payment = (id: string, partnerId = 'guest') =>
    must('account.registerPayment', {
      id,
      name: id,
      paymentType: 'inbound',
      partnerType: 'customer',
      partnerId,
      journalId: 'cash-journal',
      destinationAccountId: 'receivable',
      amount: '700',
    })
  return { adapter, call, must, payment }
}
const codes = (value: Record<string, unknown>) =>
  ((value.errors as Array<{ code: string }>) ?? []).map((row) => row.code)
test('Hospitality guarantees require posted guest money and allocate each payment amount at most once', async () => {
  const { adapter, call, payment } = await boot()
  try {
    const input = {
      reservationId: 'booking-1',
      kind: 'prepaid',
      paymentId: 'receipt',
      amount: '500',
      expectedVersion: 1,
      requestKey: 'guarantee-booking-1',
    }
    assert.ok(
      codes(await call('hospitality_billing.setReservationGuarantee', input)).includes('guarantee_payment'),
    )
    await payment('receipt')
    const result = await call('hospitality_billing.setReservationGuarantee', input)
    assert.equal(result.ok, true)
    assert.deepEqual(await call('hospitality_billing.setReservationGuarantee', input), result)
    assert.ok(
      codes(
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          reservationId: 'booking-2',
          kind: 'deposit',
          amount: '201',
          requestKey: 'guarantee-overallocated',
        }),
      ).includes('guarantee_allocated'),
    )
    assert.equal((await call('hospitality_core.getReservation', { id: 'booking-2' })).version, 1)
    assert.equal(
      (
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          reservationId: 'booking-2',
          kind: 'deposit',
          amount: '200',
          requestKey: 'guarantee-booking-2',
        })
      ).ok,
      true,
    )
    assert.equal(
      (await call('hospitality_core.getReservation', { id: 'booking-1' })).guaranteeKind,
      'prepaid',
    )
  } finally {
    await adapter.close()
  }
})
test('Hospitality guarantees reject another guest receipt, insufficient prepayment and stale booking drafts', async () => {
  const { adapter, call, payment } = await boot()
  try {
    await payment('wrong-receipt', 'other-guest')
    await payment('receipt')
    const input = {
      reservationId: 'booking-1',
      kind: 'prepaid',
      paymentId: 'wrong-receipt',
      amount: '500',
      expectedVersion: 1,
      requestKey: 'wrong-guest-guarantee',
    }
    assert.ok(
      codes(await call('hospitality_billing.setReservationGuarantee', input)).includes('guarantee_payment'),
    )
    assert.ok(
      codes(
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          paymentId: 'receipt',
          amount: '499',
          requestKey: 'short-prepaid-guarantee',
        }),
      ).includes('guarantee_prepaid'),
    )
    assert.equal(
      (
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          paymentId: 'receipt',
          requestKey: 'valid-prepaid-guarantee',
        })
      ).ok,
      true,
    )
    assert.ok(
      codes(
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          kind: 'none',
          requestKey: 'stale-guarantee-removal',
        }),
      ).includes('transition_conflict'),
    )
    assert.equal(
      (await call('hospitality_core.getReservation', { id: 'booking-1' })).guaranteeKind,
      'prepaid',
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality card references reject card numbers; direct website bookings cannot claim agent guarantees', async () => {
  const { adapter, call } = await boot()
  try {
    const input = {
      reservationId: 'booking-1',
      kind: 'card',
      amount: '500',
      reference: '4111-1111-1111-1111',
      expectedVersion: 1,
      requestKey: 'card-number-refusal',
    }
    assert.ok(
      codes(await call('hospitality_billing.setReservationGuarantee', input)).includes('guarantee_reference'),
    )
    assert.ok(
      codes(
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          kind: 'agent',
          reference: 'agent:proof',
          requestKey: 'direct-agent-refusal',
        }),
      ).includes('guarantee_agent'),
    )
    assert.ok(
      codes(
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          amount: '500.1',
          reference: 'vault:token_1234',
          requestKey: 'fractional-card-reference',
        }),
      ).includes('guarantee_amount'),
    )
    assert.equal(
      (
        await call('hospitality_billing.setReservationGuarantee', {
          ...input,
          reference: 'vault:token_1234',
          requestKey: 'opaque-card-reference',
        })
      ).ok,
      true,
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality arrival guarantees are revalidated from the ledger before check-in and night audit decisions', async () => {
  const { adapter, call, must, payment } = await boot()
  try {
    const receipt = await payment('arrival-receipt')
    await must('hospitality_billing.setReservationGuarantee', {
      reservationId: 'booking-1',
      kind: 'prepaid',
      paymentId: 'arrival-receipt',
      amount: '500',
      expectedVersion: 1,
      requestKey: 'arrival-prepaid-guarantee',
    })
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const day = dateKeyIn(new Date(String(booking.checkIn)), 'Asia/Ho_Chi_Minh')
    const deskBefore = await call('hospitality_core.getFrontDesk', { propertyId: 'property', day })
    assert.equal(
      (deskBefore.arrivals as { rows: Array<Record<string, unknown>> }).rows.find(
        (row) => row.reservationId === 'booking-1',
      )?.guaranteeValid,
      true,
    )
    const before = await call('hospitality_core.getNightAuditWorkbench', {
      propertyId: 'property',
      auditDate: day,
    })
    assert.equal(
      (before.arrivals as Array<Record<string, unknown>>).find((row) => row.id === 'booking-1')
        ?.guaranteeValid,
      true,
    )
    await must('account.reverseMove', {
      id: receipt.moveId,
      reversalId: 'arrival-receipt-reversal',
      reason: 'Synthetic correction',
    })
    const deskAfter = await call('hospitality_core.getFrontDesk', { propertyId: 'property', day })
    assert.equal(
      (deskAfter.arrivals as { rows: Array<Record<string, unknown>> }).rows.find(
        (row) => row.reservationId === 'booking-1',
      )?.guaranteeValid,
      false,
    )
    const after = await call('hospitality_core.getNightAuditWorkbench', {
      propertyId: 'property',
      auditDate: day,
    })
    assert.equal(
      (after.arrivals as Array<Record<string, unknown>>).find((row) => row.id === 'booking-1')
        ?.guaranteeValid,
      false,
    )
    assert.equal(after.canClose, false)
    const checked = await call('hospitality_core.checkIn', {
      stayId: booking.stayId,
      roomId: '101',
      assignmentId: 'arrival-invalid-assignment',
      at: String(booking.checkIn),
      requestKey: 'arrival-invalid-check-in',
    })
    assert.ok(codes(checked).includes('guarantee_required'))
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_room_assignment WHERE id = ?', [
          'arrival-invalid-assignment',
        ])
      ).length,
      0,
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality takes a reservation deposit and establishes its guarantee atomically without double-counting the folio commitment', async () => {
  const { adapter, call } = await boot()
  try {
    const input = {
      reservationId: 'booking-1',
      amount: '200',
      journalId: 'cash-journal',
      reference: 'Synthetic transfer',
      expectedVersion: 1,
      requestKey: 'take-atomic-deposit',
    }
    const failed = await call('hospitality_billing.takeReservationGuarantee', {
      ...input,
      journalId: 'missing-journal',
    })
    assert.equal(failed.ok, false)
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 0)
    const result = await call('hospitality_billing.takeReservationGuarantee', input)
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    assert.deepEqual(await call('hospitality_billing.takeReservationGuarantee', input), result)
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    assert.equal(booking.guaranteeKind, 'deposit')
    const context = await call('hospitality_billing.getReservationGuaranteeContext', {
      reservationId: 'booking-1',
    })
    assert.equal(context.valid, true, 'the deposit receipt and its guarantee are one commitment')
    const money = await call('hospitality_billing.getFolioBilling', { folioId: booking.folioId })
    assert.equal(money.paid, '200')
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 1)
    const stale = await call('hospitality_billing.takeReservationGuarantee', {
      ...input,
      amount: '100',
      requestKey: 'take-stale-deposit',
    })
    assert.ok(codes(stale).includes('transition_conflict'))
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 1)
  } finally {
    await adapter.close()
  }
})

test('Hospitality front desk pages tied arrivals independently and keeps totals outside the page', async () => {
  const { adapter, call, must } = await boot()
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const day = dateKeyIn(new Date(String(booking.checkIn)), 'Asia/Ho_Chi_Minh')
    for (let index = 0; index < 11; index++) {
      await must('hospitality_core.saveRoom', {
        id: `page-room-${index}`,
        propertyId: 'property',
        roomTypeId: 'type',
        code: `P${index}`,
        name: `Page ${index}`,
      })
      await must('hospitality_core.createReservation', {
        id: `page-booking-${index}`,
        code: `Page ${index}`,
        propertyId: 'property',
        roomTypeId: 'type',
        partnerId: 'guest',
        provider: 'direct',
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        adults: 1,
      })
    }
    type Queue = {
      rows: Array<Record<string, unknown>>
      page: number
      pages: number
      total: number
      guests: number
    }
    const first = await call('hospitality_core.getFrontDesk', { propertyId: 'property', day })
    const last = await call('hospitality_core.getFrontDesk', {
      propertyId: 'property',
      day,
      arrivalsPage: 999,
    })
    const a = first.arrivals as Queue,
      b = last.arrivals as Queue
    assert.equal(first.currency, 'VND')
    assert.equal(a.rows.length, 10)
    assert.equal(a.total, 13)
    assert.equal(a.guests, 13)
    assert.equal(b.rows.length, 3)
    assert.equal(b.page, 2)
    assert.equal(b.pages, 2)
    assert.equal(b.total, 13)
    assert.equal(new Set([...a.rows, ...b.rows].map((row) => row.id)).size, 13)
    assert.equal(JSON.stringify(a.rows).includes('guaranteeReference'), false)
    assert.deepEqual(first.summary, {
      departureTotal: 0,
      departed: 0,
      ready: 0,
      blocked: 13,
      unassigned: 13,
      totalRooms: 13,
      cleanVacant: 0,
      tonightRooms: 13,
      occupancyPercent: 100,
    })
    assert.deepEqual(last.summary, first.summary, 'KPIs count all arrivals, independent of page')
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: room.id,
      expectedVersion: room.version,
      requestKey: 'desk-summary-clean',
    })
    const cleaned = await call('hospitality_core.getFrontDesk', { propertyId: 'property', day })
    assert.equal((cleaned.summary as Record<string, unknown>).cleanVacant, 1)
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    await must('hospitality_core.holdRoom', {
      stayId: stay.id,
      roomId: room.id,
      expectedVersion: Number(stay.version ?? 0),
      requestKey: 'desk-summary-hold',
    })
    await must('hospitality_billing.setReservationGuarantee', {
      reservationId: booking.id,
      kind: 'card',
      amount: '200',
      reference: 'authorization:desk-summary',
      expectedVersion: booking.version,
      requestKey: 'desk-summary-guarantee',
    })
    const held = await call('hospitality_core.getFrontDesk', { propertyId: 'property', day, arrivalsPage: 2 })
    assert.deepEqual(held.summary, {
      departureTotal: 0,
      departed: 0,
      ready: 1,
      blocked: 12,
      unassigned: 12,
      totalRooms: 13,
      cleanVacant: 0,
      tonightRooms: 13,
      occupancyPercent: 100,
    })

    assert.deepEqual(
      (held.activity as { rows: unknown[] }).rows,
      [],
      'Tomorrow excludes operations performed today',
    )
    const current = await call('hospitality_core.getFrontDesk', {
      propertyId: 'property',
      day: dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh'),
    })
    const activity = current.activity as { total: number; rows: Array<Record<string, unknown>> }
    assert.ok(activity.total >= 14)
    assert.ok(activity.rows.some((row) => row.action === 'room-cleaned' && row.code === '101'))
    assert.ok(activity.rows.some((row) => row.action === 'holdRoom'))
    for (const row of activity.rows)
      assert.deepEqual(Object.keys(row).sort(), ['action', 'actorName', 'code', 'id', 'occurredAt'])
    assert.equal(JSON.stringify(activity).includes('authorization:desk-summary'), false)
    await assert.rejects(() =>
      callFn(
        'hospitality_core.getFrontDesk',
        { propertyId: 'property' },
        { adapter, manifest, scope: { company: 'hotel', branches: [] } },
      ),
    )

    const hidden = (
      await callFn(
        'hospitality_core.getFrontDesk',
        { day },
        { adapter, manifest, scope: { company: 'hotel', branches: [] } },
      )
    ).value as Record<string, unknown>
    assert.equal(hidden.configured, false)
    await assert.rejects(() =>
      call('hospitality_core.getFrontDesk', { propertyId: 'property', day: '2026-02-30' }),
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality record return links preserve workspace filters but cannot switch tenant or origin', () => {
  const fallback = '/admin/hospitality/reservations?property=hotel'
  const href = (target: string) =>
    '/admin/hospitality/reservations/booking?company=owned&branch=front&lang=vi&returnTo=' +
    encodeURIComponent(target)
  const back = new URL(
    hospitalityRecordBack(
      href('/admin/hospitality/front-desk?company=foreign&branch=other&date=2026-10-14&arrivalsPage=2'),
      fallback,
    ),
    'http://hospitality.local',
  )
  assert.equal(back.pathname, '/admin/hospitality/front-desk')
  assert.equal(back.searchParams.get('company'), 'owned')
  assert.equal(back.searchParams.get('branch'), 'front')
  assert.equal(back.searchParams.get('arrivalsPage'), '2')
  assert.equal(back.searchParams.get('date'), '2026-10-14')
  for (const target of [
    'https://example.invalid/admin/hospitality/front-desk',
    '//example.invalid/admin/hospitality/front-desk',
    '/admin/user/security',
    'javascript:alert(1)',
  ]) {
    assert.equal(
      new URL(hospitalityRecordBack(href(target), fallback), 'http://hospitality.local').pathname,
      '/admin/hospitality/reservations',
    )
  }
})

test('Hospitality reservation finance lookups skip reversed credits in batches and reject inactive deposit journals', async () => {
  const { adapter, call, must, payment } = await boot()
  try {
    await payment('valid-credit')
    const invalid = await payment('invalid-credit')
    await must('account.reverseMove', {
      id: invalid.moveId,
      reversalId: 'invalid-credit-reversal',
      reason: 'Synthetic lookup fixture',
    })
    const template = (await adapter.all('SELECT * FROM account_payment WHERE id = ?', ['invalid-credit']))[0]!
    const columns = Object.keys(template)
    for (let index = 0; index < 51; index++) {
      const copy: Record<string, unknown> = { ...template, id: `recent-invalid-${index}`, date: '2099-01-01' }
      await adapter.run(
        `INSERT INTO account_payment (${columns.map((name) => `"${name}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        columns.map((name) => copy[name]),
      )
    }
    const lookup = async (fn: string, args: Record<string, unknown> = {}) =>
      (await call(`hospitality_billing.${fn}`, { reservationId: 'booking-1', ...args })) as unknown as Array<
        Record<string, unknown>
      >
    const credits = await lookup('lookupReservationGuaranteePayments', { limit: 1 })
    assert.deepEqual(
      credits.map((row) => row.id),
      ['valid-credit'],
      'usable credit after 51 newer reversed credits is found',
    )
    assert.equal(credits[0]!.available, '700')
    assert.deepEqual(await lookup('lookupReservationGuaranteePayments', { id: 'invalid-credit' }), [])
    assert.deepEqual(await lookup('lookupReservationGuaranteePayments', { search: '%' }), [])
    for (const selected of [
      { company: 'other', branches: null },
      { company: 'hotel', branches: [] },
      { company: null, branches: null },
    ]) {
      const result = await callFn(
        'hospitality_billing.lookupReservationGuaranteePayments',
        { reservationId: 'booking-1' },
        { adapter, manifest, scope: selected },
      )
      assert.deepEqual(result.value, [])
    }
    await must('account.saveAccount', {
      id: 'supplier-payable',
      code: '331',
      name: 'Payable',
      accountType: 'liability_payable',
    })
    await must('account.registerPayment', {
      id: 'supplier-credit',
      name: 'Supplier refund',
      paymentType: 'inbound',
      partnerType: 'supplier',
      partnerId: 'guest',
      journalId: 'cash-journal',
      destinationAccountId: 'supplier-payable',
      amount: '300',
    })
    assert.deepEqual(await lookup('lookupReservationGuaranteePayments', { id: 'supplier-credit' }), [])
    const supplierRejected = await call('hospitality_billing.setReservationGuarantee', {
      reservationId: 'booking-1',
      kind: 'deposit',
      paymentId: 'supplier-credit',
      amount: '100',
      expectedVersion: 1,
      requestKey: 'supplier-is-not-guest-credit',
    })
    assert.ok(codes(supplierRejected).includes('guarantee_payment'))
    const lean = await call('hospitality_billing.getReservationGuaranteeContext', {
      reservationId: 'booking-1',
      includeChoices: false,
    })
    assert.deepEqual(lean.payments, [])
    assert.deepEqual(lean.journals, [])
    assert.deepEqual(
      (await lookup('lookupReservationGuaranteeJournals')).map((row) => row.id),
      ['cash-journal'],
    )
    await adapter.run('UPDATE account_journal SET active = ? WHERE id = ?', [false, 'cash-journal'])
    assert.deepEqual(await lookup('lookupReservationGuaranteeJournals', { id: 'cash-journal' }), [])
    const before = (
      await adapter.all('SELECT version FROM hospitality_core_property WHERE id = ?', ['property'])
    )[0]!.version
    const denied = await call('hospitality_billing.takeReservationGuarantee', {
      reservationId: 'booking-1',
      amount: '200',
      journalId: 'cash-journal',
      expectedVersion: 1,
      requestKey: 'inactive-cash-deposit',
    })
    assert.equal(denied.ok, false)
    assert.ok(codes(denied).includes('journal_missing'))
    assert.equal(
      (await adapter.all('SELECT version FROM hospitality_core_property WHERE id = ?', ['property']))[0]!
        .version,
      before,
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality atomic arrival rolls back deposit, guarantee and versions when the room cannot be assigned, and replays one successful arrival', async () => {
  const { adapter, call, must } = await boot(0)
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    const property = await call('hospitality_core.getProperty', { id: 'property' })
    const input = {
      reservationId: booking.id,
      roomId: '101',
      keys: 2,
      kind: 'collect',
      amount: '200',
      journalId: 'cash-journal',
      guests: [arrivalGuest],
      earlyFee: 'waived',
      earlyReason: 'Synthetic early arrival',
      expectedVersion: booking.version,
      expectedStayVersion: Number(stay.version ?? 0),
      requestKey: 'atomic-arrival-deposit-room',
    }
    assert.ok(
      codes(await call('hospitality_billing.arriveReservation', { ...input, keys: 5 })).includes(
        'arrival_keys',
      ),
    )
    const refused = await call('hospitality_billing.arriveReservation', input)
    assert.ok(codes(refused).includes('room_not_available'), JSON.stringify(refused))
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 0)
    assert.equal((await adapter.all('SELECT id FROM hospitality_billing_folio_payment')).length, 0)
    assert.equal((await adapter.all('SELECT id FROM hospitality_billing_guarantee_allocation')).length, 0)
    assert.equal((await call('hospitality_core.getReservation', { id: booking.id })).version, booking.version)
    assert.equal((await call('hospitality_core.getProperty', { id: 'property' })).version, property.version)
    assert.equal((await call('hospitality_core.getStay', { id: stay.id })).state, 'draft')
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: '101',
      expectedVersion: room.version,
      requestKey: 'atomic-arrival-clean-room',
    })
    const success = await must('hospitality_billing.arriveReservation', input)
    assert.equal(success.state, 'checked_in')
    assert.deepEqual(await must('hospitality_billing.arriveReservation', input), success)
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 1)
    assert.equal((await adapter.all('SELECT id FROM hospitality_billing_folio_payment')).length, 1)
    assert.equal(
      (await adapter.all("SELECT id FROM hospitality_core_room_assignment WHERE state = 'active'")).length,
      1,
    )
    assert.equal((await call('hospitality_core.getRoom', { id: '101' })).status, 'occupied')
    assert.equal((await call('hospitality_core.getStay', { id: stay.id })).issuedKeys, 2)
    assert.equal((await call('hospitality_core.getReservation', { id: booking.id })).state, 'checked_in')
    assert.ok(
      codes(await call('hospitality_billing.arriveReservation', { ...input, amount: '201' })).includes(
        'request_reused',
      ),
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality atomic arrival validates both record versions and rolls back a card guarantee after a room conflict', async () => {
  const { adapter, call } = await boot(0)
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    const input = {
      reservationId: booking.id,
      roomId: 'missing-room',
      keys: 1,
      kind: 'card',
      amount: '200',
      reference: 'authorization:synthetic',
      guests: [arrivalGuest],
      earlyFee: 'waived',
      earlyReason: 'Synthetic early arrival',
      expectedVersion: booking.version,
      expectedStayVersion: Number(stay.version ?? 0),
      requestKey: 'atomic-arrival-card-fail',
    }
    assert.ok(
      codes(
        await call('hospitality_billing.arriveReservation', {
          ...input,
          expectedStayVersion: Number(stay.version ?? 0) + 1,
        }),
      ).includes('transition_conflict'),
    )
    assert.ok(
      codes(
        await call('hospitality_billing.arriveReservation', {
          ...input,
          expectedVersion: Number(booking.version) + 1,
        }),
      ).includes('transition_conflict'),
    )
    assert.ok(codes(await call('hospitality_billing.arriveReservation', input)).includes('no_available_room'))
    const after = await call('hospitality_core.getReservation', { id: booking.id })
    assert.equal(after.guaranteeKind, booking.guaranteeKind)
    assert.equal(after.version, booking.version)
    assert.equal(
      (
        await adapter.all(
          "SELECT id FROM hospitality_core_command_receipt WHERE action = 'arriveReservation'",
        )
      ).length,
      0,
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality atomic arrival posts the first recurring rent within the same receipt transaction', async () => {
  const { adapter, call, must } = await boot(10)
  try {
    const today = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
    const start = today
    await must('hospitality_core.createReservation', {
      id: 'weekly-arrival',
      propertyId: 'property',
      roomTypeId: 'type',
      partnerId: 'guest',
      bookingType: 'weekly',
      billingMode: 'recurring',
      checkIn: zonedDateTime(start, 14, 0, 'Asia/Ho_Chi_Minh').toISOString(),
      checkOut: zonedDateTime(addCalendarDays(start, 7), 12, 0, 'Asia/Ho_Chi_Minh').toISOString(),
      rate: '700',
    })
    const booking = await call('hospitality_core.getReservation', { id: 'weekly-arrival' })
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: '101',
      expectedVersion: room.version,
      requestKey: 'weekly-arrival-clean-room',
    })
    const input = {
      reservationId: booking.id,
      roomId: '101',
      keys: 2,
      kind: 'card',
      amount: '200',
      reference: 'authorization:weekly',
      guests: [arrivalGuest],
      earlyFee: 'waived',
      earlyReason: 'Synthetic recurring arrival',
      expectedVersion: booking.version,
      expectedStayVersion: 0,
      requestKey: 'weekly-arrival-atomic',
    }
    const result = await must('hospitality_billing.arriveReservation', input)
    assert.deepEqual(await must('hospitality_billing.arriveReservation', input), result)
    const charges = await adapter.all('SELECT amount FROM hospitality_core_charge WHERE "stayId" = ?', [
      'weekly-arrival:stay',
    ])
    assert.equal(charges.length, 1)
    assert.equal(charges[0]!.amount, '700')
    assert.equal(
      (await call('hospitality_core.getStay', { id: booking.stayId })).nextBillDate,
      addCalendarDays(start, 7),
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality arrival guest declarations validate every adult, preserve document ownership and roll back with a failed arrival', async () => {
  const { adapter, call, must } = await boot(0)
  try {
    let booking = await call('hospitality_core.getReservation', { id: 'booking-2' })
    await must('hospitality_core.amendReservation', {
      id: booking.id,
      roomTypeId: booking.roomTypeId,
      partnerId: booking.partnerId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      adults: 2,
      children: 0,
      rate: booking.rate,
      expectedVersion: booking.version,
      requestKey: 'arrival-guests-two-adults',
    })
    const workspace = (await call('hospitality_core.getReservationWorkspace', { id: booking.id }))
      .record as Record<string, unknown>
    booking = workspace
    const stay = workspace.stay as Record<string, unknown>
    const people = [
      {
        fullName: 'Synthetic lead',
        type: 'cccd',
        number: '001090123456',
        birth: '1990-01-01',
        gender: 'male',
        nationality: 'VN',
      },
      {
        fullName: 'Synthetic companion',
        type: 'passport',
        number: 'AB123456',
        birth: '1992-02-28',
        gender: 'female',
        nationality: 'GB',
      },
    ]
    const initialPartners = (await adapter.all('SELECT id FROM partner_partner')).length
    const input = {
      reservationId: booking.id,
      roomId: '101',
      keys: 2,
      guests: people,
      kind: 'card',
      amount: '200',
      reference: 'authorization:declared',
      earlyReason: 'Synthetic declaration arrival',
      earlyFee: 'waived',
      expectedVersion: booking.version,
      expectedStayVersion: stay.version,
      requestKey: 'arrival-guests-atomic',
    }
    assert.ok(
      codes(
        await call('hospitality_billing.arriveReservation', { ...input, guests: people.slice(0, 1) }),
      ).includes('arrival_guest_count'),
    )
    assert.ok(
      codes(
        await call('hospitality_billing.arriveReservation', {
          ...input,
          guests: [people[0], { ...people[1], birth: '1992-02-30' }],
        }),
      ).includes('arrival_guest_birth'),
    )
    assert.ok(
      codes(
        await call('hospitality_billing.arriveReservation', {
          ...input,
          guests: [people[0], { ...people[1], type: 'cccd', number: '001090123456', nationality: 'GB' }],
        }),
      ).includes('arrival_guest_citizen'),
    )
    assert.ok(
      codes(
        await call('hospitality_billing.arriveReservation', { ...input, guests: [people[0], people[0]] }),
      ).includes('arrival_guest_duplicate'),
    )
    assert.ok(
      codes(await call('hospitality_billing.arriveReservation', input)).includes('room_not_available'),
    )
    assert.equal((await adapter.all('SELECT id FROM partner_partner')).length, initialPartners)
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_guest_document')).length, 0)
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: '101',
      expectedVersion: room.version,
      requestKey: 'arrival-guests-clean-room',
    })
    const done = await must('hospitality_billing.arriveReservation', input)
    assert.deepEqual(await must('hospitality_billing.arriveReservation', input), done)
    assert.equal((await adapter.all('SELECT id FROM partner_partner')).length, initialPartners + 1)
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_guest_document')).length, 2)
    const guests = await adapter.all(
      'SELECT "partnerId", "displayName" FROM hospitality_core_stay_guest WHERE "stayId" = ?',
      [stay.id],
    )
    assert.equal(guests.length, 2)
    assert.ok(guests.every((row) => row.partnerId))
    const after = (await call('hospitality_core.getReservationWorkspace', { id: booking.id })).record
    assert.doesNotMatch(JSON.stringify(after), /001090123456|AB123456|1992-02-28/)
    const audit = await adapter.all(
      'SELECT details FROM hospitality_core_operational_change WHERE action = ?',
      ['declareArrivalGuests'],
    )
    assert.equal(audit.length, 1)
    assert.doesNotMatch(JSON.stringify(audit), /001090123456|AB123456|1992-02-28/)
  } finally {
    await adapter.close()
  }
})

test('Hospitality early arrival fee uses exact rounding and commits or rolls back with the arrival', async () => {
  assert.equal(earlyArrivalAmount('851000', 'VND'), '426000')
  assert.equal(earlyArrivalAmount('849000', 'VND'), '425000')
  assert.equal(earlyArrivalAmount('19.99', 'USD'), '10.00')
  const { adapter, call, must } = await boot()
  try {
    let booking = await call('hospitality_core.getReservation', { id: 'booking-2' })
    await must('hospitality_core.amendReservation', {
      id: booking.id,
      roomTypeId: booking.roomTypeId,
      partnerId: booking.partnerId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      adults: 1,
      children: 0,
      rate: '851000',
      expectedVersion: booking.version,
      requestKey: 'early-fee-rate',
    })
    booking = await call('hospitality_core.getReservation', { id: booking.id })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: room.id,
      expectedVersion: room.version,
      requestKey: 'early-fee-clean',
    })
    await must('hospitality_billing.setReservationGuarantee', {
      reservationId: booking.id,
      kind: 'card',
      amount: '200',
      reference: 'authorization:early-fee',
      expectedVersion: booking.version,
      requestKey: 'early-fee-guarantee',
    })
    const input = {
      stayId: stay.id,
      roomId: room.id,
      keys: 1,
      at: new Date(Date.parse(String(booking.checkIn)) - 3600000).toISOString(),
      earlyFee: 'invalid',
      guests: [arrivalGuest],
      earlyReason: 'Guest arrived early',
      expectedVersion: Number(stay.version ?? 0),
      requestKey: 'early-fee-arrival',
    }
    assert.ok(codes(await call('hospitality_core.checkIn', input)).includes('arrival_fee_choice'))
    assert.ok(
      codes(
        await call('hospitality_core.checkIn', { ...input, earlyFee: 'waived', earlyReason: '' }),
      ).includes('arrival_fee_reason'),
    )
    assert.equal((await call('hospitality_core.getStay', { id: stay.id })).state, 'draft')
    assert.equal((await call('hospitality_core.getRoom', { id: room.id })).status, 'available')
    assert.equal(
      (await adapter.all("SELECT id FROM hospitality_core_charge WHERE description = 'Early check-in fee'"))
        .length,
      0,
    )
    const applied = { ...input, earlyFee: 'charged', earlyReason: 'Guest requested early arrival' }
    const done = await must('hospitality_core.checkIn', applied)
    assert.deepEqual(await must('hospitality_core.checkIn', applied), done)
    const charges = await adapter.all(
      "SELECT amount FROM hospitality_core_charge WHERE description = 'Early check-in fee'",
    )
    assert.equal(charges.length, 1)
    assert.equal(String(charges[0]?.amount), '426000')
    assert.equal((await call('hospitality_core.getStay', { id: stay.id })).state, 'checked_in')
    const audit = await adapter.all(
      "SELECT id FROM hospitality_core_operational_change WHERE action = 'chargeEarlyArrival'",
    )
    assert.equal(audit.length, 1)
  } finally {
    await adapter.close()
  }
})

test('Hospitality arrival refuses a future local arrival day and rolls back its guarantee', async () => {
  const { adapter, call } = await boot()
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    const input = {
      reservationId: booking.id,
      roomId: '101',
      keys: 1,
      kind: 'card',
      amount: '200',
      reference: 'authorization:future-arrival',
      guests: [arrivalGuest],
      earlyFee: 'waived',
      earlyReason: 'Cannot bypass the arrival date',
      expectedVersion: booking.version,
      expectedStayVersion: Number(stay.version ?? 0),
      requestKey: 'arrival-future-date-refused',
    }
    assert.ok(codes(await call('hospitality_billing.arriveReservation', input)).includes('arrival_day_only'))
    const after = await call('hospitality_core.getReservation', { id: booking.id })
    assert.equal(after.version, booking.version)
    assert.equal(after.guaranteeKind, booking.guaranteeKind)
    assert.equal((await call('hospitality_core.getStay', { id: stay.id })).state, 'draft')
  } finally {
    await adapter.close()
  }
})

test('Hospitality legacy arrival cannot bypass declarations or the early-fee decision', async () => {
  const { adapter, call, must } = await boot()
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    await must('hospitality_billing.setReservationGuarantee', {
      reservationId: booking.id,
      kind: 'card',
      amount: '200',
      reference: 'authorization:declared-legacy',
      expectedVersion: booking.version,
      requestKey: 'legacy-arrival-guarantee',
    })
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: room.id,
      expectedVersion: room.version,
      requestKey: 'legacy-arrival-clean',
    })
    const input = {
      stayId: stay.id,
      roomId: room.id,
      keys: 1,
      at: new Date(Date.parse(String(booking.checkIn)) - 3600000).toISOString(),
      earlyReason: 'Approved early arrival',
      expectedVersion: Number(stay.version ?? 0),
      requestKey: 'legacy-arrival-command',
    }
    assert.ok(codes(await call('hospitality_core.checkIn', input)).includes('arrival_declaration_required'))
    await must('hospitality_core.declareArrivalGuests', {
      stayId: stay.id,
      guests: [arrivalGuest],
      expectedVersion: input.expectedVersion,
      requestKey: 'legacy-arrival-declare',
    })
    const declared = await call('hospitality_core.getStay', { id: stay.id })
    const current = { ...input, expectedVersion: declared.version }
    assert.ok(codes(await call('hospitality_core.checkIn', current)).includes('arrival_fee_choice'))
    assert.equal((await call('hospitality_core.getStay', { id: stay.id })).state, 'draft')
    const done = await must('hospitality_core.checkIn', { ...current, earlyFee: 'waived' })
    assert.equal(done.state, 'checked_in')
    const audit = await adapter.all(
      "SELECT details FROM hospitality_core_operational_change WHERE action = 'waiveEarlyArrival'",
    )
    assert.equal(audit.length, 1)
    assert.doesNotMatch(JSON.stringify(audit), /TEST1234|1990-01-01/)
  } finally {
    await adapter.close()
  }
})

test('Hospitality front desk departure balances count real receipts and their reversal', async () => {
  const { adapter, call, must } = await boot()
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    await must('hospitality_billing.setReservationGuarantee', {
      reservationId: booking.id,
      kind: 'card',
      amount: '200',
      reference: 'authorization:departure-summary',
      expectedVersion: booking.version,
      requestKey: 'departure-summary-guarantee',
    })
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: room.id,
      expectedVersion: room.version,
      requestKey: 'departure-summary-clean',
    })
    await must('hospitality_core.checkIn', {
      stayId: stay.id,
      roomId: room.id,
      guests: [arrivalGuest],
      at: booking.checkIn,
      expectedVersion: Number(stay.version ?? 0),
      requestKey: 'departure-summary-arrival',
    })
    const day = dateKeyIn(new Date(String(booking.checkOut)), 'Asia/Ho_Chi_Minh')
    const input = { propertyId: 'property', day }
    assert.deepEqual(await call('hospitality_billing.getFrontDeskBillingSummary', input), {
      owing: 1,
      unknown: 0,
    })
    const folio = await call('hospitality_core.getFolio', { id: stay.folioId })
    await must('hospitality_billing.recordFolioPayment', {
      id: 'departure-paid',
      folioId: folio.id,
      amount: '500',
      journalId: 'cash-journal',
      expectedVersion: Number(folio.version ?? 0),
      requestKey: 'departure-summary-paid',
    })
    assert.deepEqual(await call('hospitality_billing.getFrontDeskBillingSummary', input), {
      owing: 0,
      unknown: 0,
    })
    const [payment] = await adapter.all('SELECT "moveId" FROM account_payment WHERE id = ?', [
      'departure-paid',
    ])
    await must('account.reverseMove', {
      id: payment!.moveId,
      reversalId: 'departure-payment-reversal',
      reason: 'Synthetic correction',
    })
    assert.deepEqual(await call('hospitality_billing.getFrontDeskBillingSummary', input), {
      owing: 1,
      unknown: 0,
    })
    await assert.rejects(() =>
      callFn('hospitality_billing.getFrontDeskBillingSummary', input, {
        adapter,
        manifest,
        scope: { company: 'hotel', branches: [] },
      }),
    )
    await assert.rejects(() =>
      call('hospitality_billing.getFrontDeskBillingSummary', { ...input, day: '2026-02-30' }),
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality in-house dues follow the folio evidence, the rooms sharing it and the reader scope', async () => {
  const { adapter, call, must } = await boot()
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    await must('hospitality_billing.setReservationGuarantee', {
      reservationId: booking.id,
      kind: 'card',
      amount: '200',
      reference: 'authorization:in-house-dues',
      expectedVersion: booking.version,
      requestKey: 'in-house-dues-guarantee',
    })
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: room.id,
      expectedVersion: room.version,
      requestKey: 'in-house-dues-clean',
    })
    await must('hospitality_core.checkIn', {
      stayId: stay.id,
      roomId: room.id,
      guests: [arrivalGuest],
      at: booking.checkIn,
      expectedVersion: Number(stay.version ?? 0),
      requestKey: 'in-house-dues-arrival',
    })
    const dues = async (ids: unknown, reader: { company: string; branches: string[] | null } = scope) =>
      (
        (await callFn('hospitality_billing.getStayDues', { ids }, { adapter, manifest, scope: reader }))
          .value as {
          rows: Array<Record<string, unknown>>
        }
      ).rows
    const folio = await call('hospitality_core.getFolio', { id: stay.folioId })
    // The same evidence as the desk's folio peek; a stay that is not there is unknown, never zero.
    const owed = await call('hospitality_billing.getFolioDue', { id: folio.id })
    assert.notEqual(owed.due, '0')
    assert.deepEqual(await dues([stay.id, 'missing']), [
      { id: stay.id, due: owed.due, currency: 'VND', known: true, shared: 1 },
      { id: 'missing', due: null, currency: null, known: false, shared: 1 },
    ])
    await must('hospitality_billing.recordFolioPayment', {
      id: 'in-house-paid',
      folioId: folio.id,
      amount: '500',
      journalId: 'cash-journal',
      expectedVersion: Number(folio.version ?? 0),
      requestKey: 'in-house-dues-paid',
    })
    assert.equal((await dues([stay.id]))[0]!.due, '0')
    const [payment] = await adapter.all('SELECT "moveId" FROM account_payment WHERE id = ?', [
      'in-house-paid',
    ])
    await must('account.reverseMove', {
      id: payment!.moveId,
      reversalId: 'in-house-payment-reversal',
      reason: 'Synthetic correction',
    })
    assert.equal((await dues([stay.id]))[0]!.due, owed.due)
    // Another room of the same purchase shares the folio's due; a cancelled one does not.
    const [row] = await adapter.all('SELECT * FROM hospitality_core_stay WHERE id = ?', [stay.id])
    for (const [id, state] of [
      ['in-house-second-room', 'draft'],
      ['in-house-cancelled-room', 'cancelled'],
    ]) {
      const copy: Record<string, unknown> = {
        ...row,
        id,
        code: id,
        state,
        reservationId: null,
        currentRoomId: null,
      }
      const names = Object.keys(copy)
      await adapter.run(
        `INSERT INTO hospitality_core_stay (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        names.map((name) => copy[name]),
      )
    }
    assert.deepEqual(
      (await dues([stay.id, 'in-house-second-room'])).map((item) => [item.id, item.shared]),
      [
        [stay.id, 2],
        ['in-house-second-room', 2],
      ],
    )
    // A reader outside the property's branches gets unknown rows, not an error or a zero.
    assert.deepEqual(
      (await dues([stay.id], { company: 'hotel', branches: [] })).map((item) => [item.known, item.due]),
      [[false, null]],
    )
    // A bill whose invoice cannot be found leaves the due unknown rather than reading the folio as paid.
    await adapter.run(
      'INSERT INTO hospitality_billing_folio_bill (id, "companyId", "folioId", "moveId", state, "chargeCount", "amountTotal", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'in-house-bill',
        'hotel',
        folio.id,
        'in-house-missing-move',
        'invoiced',
        1,
        '500',
        booking.checkIn,
        booking.checkIn,
      ],
    )
    assert.deepEqual(
      (await dues([stay.id])).map((item) => [item.known, item.due]),
      [[false, null]],
    )
    for (const ids of [null, 'x', [1], Array.from({ length: 101 }, (_, index) => `s${index}`)])
      await assert.rejects(() =>
        callFn('hospitality_billing.getStayDues', { ids }, { adapter, manifest, scope }),
      )
  } finally {
    await adapter.close()
  }
})

test('Hospitality batched balance evidence never treats a missing or reversed invoice as paid', () => {
  const folio = { amountTotal: '500' },
    bill = { moveId: 'invoice' },
    line = { amountResidual: '100' }
  assert.deepEqual(folioBalanceEvidence(folio, null, null, null, '200'), { balanceKnown: true, due: '300' })
  assert.deepEqual(folioBalanceEvidence(folio, bill, { state: 'posted' }, line, '500'), {
    balanceKnown: true,
    due: '100',
  })
  assert.equal(folioBalanceEvidence(folio, bill, { state: 'posted' }, null, '500').balanceKnown, false)
  assert.equal(
    folioBalanceEvidence(folio, bill, { state: 'posted', reversedById: 'reversal' }, line, '500')
      .balanceKnown,
    false,
  )
})

test('Hospitality early arrival charges follow the property clock instead of reservation ETA', async () => {
  const { adapter, call, must } = await boot(3)
  try {
    const today = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
    for (const [id, eta, actual, roomId, feeRequired] of [
      ['early-eta', 9, 10, '101', true],
      ['late-eta', 18, 15, '102', false],
    ] as const) {
      await must('hospitality_core.createReservation', {
        id,
        propertyId: 'property',
        roomTypeId: 'type',
        partnerId: 'guest',
        provider: 'direct',
        adults: 1,
        rate: '850000',
        checkIn: zonedDateTime(today, eta, 0, 'Asia/Ho_Chi_Minh').toISOString(),
        checkOut: zonedDateTime(addCalendarDays(today, 1), 12, 0, 'Asia/Ho_Chi_Minh').toISOString(),
      })
      const booking = await call('hospitality_core.getReservation', { id })
      const stay = await call('hospitality_core.getStay', { id: booking.stayId })
      const room = await call('hospitality_core.getRoom', { id: roomId })
      await must('hospitality_core.completeRoomCleaning', {
        roomId,
        expectedVersion: room.version,
        requestKey: id + '-clean',
      })
      await must('hospitality_billing.setReservationGuarantee', {
        reservationId: id,
        kind: 'card',
        amount: '200',
        reference: id,
        expectedVersion: booking.version,
        requestKey: id + '-guarantee',
      })
      const input = {
        stayId: stay.id,
        roomId,
        at: zonedDateTime(today, actual, 0, 'Asia/Ho_Chi_Minh').toISOString(),
        keys: 1,
        guests: [arrivalGuest],
        expectedVersion: stay.version,
        requestKey: id + '-arrive',
        earlyReason: 'Synthetic arrival',
      }
      if (feeRequired) {
        const refused = await call('hospitality_core.checkIn', input)
        assert.equal(refused.ok, false, 'An early ETA cannot bypass the property early-arrival fee')
        await must('hospitality_core.checkIn', { ...input, earlyFee: 'charged' })
      } else await must('hospitality_core.checkIn', input)
    }
    const fees = await adapter.all(
      "SELECT amount FROM hospitality_core_charge WHERE description = 'Early check-in fee'",
    )
    assert.equal(fees.length, 1, 'A later ETA must not create an extra fee after the standard check-in time')
    assert.equal(String(fees[0]?.amount), '425000')
  } finally {
    await adapter.close()
  }
})

test('Hospitality arrival plans are versioned and drive scoped early-housekeeping attention', async () => {
  const { adapter, call, must } = await boot(0)
  try {
    const booking = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const stay = await call('hospitality_core.getStay', { id: booking.stayId })
    const day = dateKeyIn(new Date(String(booking.checkIn)), 'Asia/Ho_Chi_Minh')
    await must('hospitality_core.holdRoom', {
      stayId: stay.id,
      roomId: '101',
      expectedVersion: stay.version,
      requestKey: 'arrival-plan-hold',
    })
    const input = {
      id: booking.id,
      expectedArrivalTime: '09:30',
      earlyArrivalRequested: true,
      arrivalNote: 'Synthetic guest requests a quiet room',
      expectedVersion: booking.version,
      requestKey: 'arrival-plan-save',
    }
    const invalid = await call('hospitality_core.setReservationArrivalPlan', {
      ...input,
      expectedArrivalTime: '25:00',
    })
    assert.equal(invalid.ok, false)
    const tooLate = await call('hospitality_core.setReservationArrivalPlan', {
      ...input,
      expectedArrivalTime: '15:00',
    })
    assert.equal(tooLate.ok, false)
    const done = await must('hospitality_core.setReservationArrivalPlan', input)
    assert.deepEqual(await must('hospitality_core.setReservationArrivalPlan', input), done)
    assert.equal(
      (
        await call('hospitality_core.setReservationArrivalPlan', {
          ...input,
          requestKey: 'arrival-plan-stale',
          arrivalNote: 'stale',
        })
      ).ok,
      false,
    )
    const workspace = await call('hospitality_core.getReservationWorkspace', { id: booking.id })
    const record = workspace.record as Record<string, unknown>
    assert.equal(record.expectedArrivalTime, '09:30')
    assert.equal(record.arrivalNote, input.arrivalNote)
    assert.equal(
      record.checkIn,
      booking.checkIn,
      'ETA must not change inventory dates or the agreed booking schedule',
    )
    const desk = await call('hospitality_core.getFrontDesk', { propertyId: 'property', day })
    assert.deepEqual(desk.attention, {
      reservationId: booking.id,
      time: '09:30',
      roomCode: '101',
      roomStatus: 'dirty',
      task: null,
    })
    assert.equal(JSON.stringify(desk.activity).includes(input.arrivalNote), false)
    const roomBoard = await call('hospitality_core.getRoomBoard', {
      propertyId: 'property',
      state: 'priority',
      peek: '101',
    })
    assert.equal(roomBoard.total, 1)
    assert.equal((roomBoard.rows as Array<Record<string, unknown>>)[0]!.arrivingAt, '09:30')
    assert.equal((roomBoard.selected as Record<string, unknown>).arrivingAt, '09:30')
    assert.equal(JSON.stringify(roomBoard).includes(input.arrivalNote), false)

    await must('hospitality_core.createCleaningTask', {
      id: 'arrival-plan-task',
      code: 'ARRIVAL-PLAN-TASK',
      roomId: '101',
      taskType: 'daily_clean',
      priority: 'urgent',
      requestKey: 'arrival-plan-task-create',
    })
    const taskDesk = await call('hospitality_core.getFrontDesk', { propertyId: 'property', day })
    assert.equal(
      ((taskDesk.attention as Record<string, unknown>).task as Record<string, unknown>).id,
      'arrival-plan-task',
    )
    const denied = (
      await callFn(
        'hospitality_core.setReservationArrivalPlan',
        { ...input, expectedVersion: record.version, requestKey: 'arrival-plan-denied' },
        { adapter, manifest, scope: { company: 'hotel', branches: [] } },
      )
    ).value as Record<string, unknown>
    assert.equal(denied.ok, false)
    const room = await call('hospitality_core.getRoom', { id: '101' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: room.id,
      expectedVersion: room.version,
      requestKey: 'arrival-plan-clean',
    })
    assert.equal(
      (await call('hospitality_core.getFrontDesk', { propertyId: 'property', day })).attention,
      null,
      'Ready rooms no longer trigger an alert',
    )
    await must('hospitality_core.setReservationArrivalPlan', {
      ...input,
      expectedVersion: record.version,
      expectedArrivalTime: '',
      earlyArrivalRequested: false,
      arrivalNote: '',
      requestKey: 'arrival-plan-clear',
    })
    const cleared = (await call('hospitality_core.getReservationWorkspace', { id: booking.id }))
      .record as Record<string, unknown>
    assert.equal(cleared.expectedArrivalTime, null)
    assert.equal(cleared.earlyArrivalRequested, false)
  } finally {
    await adapter.close()
  }
})

test('Hospitality room board priority is globally ordered by arrival time across pages without guest details', async () => {
  const { adapter, call, must } = await boot(0)
  try {
    const first = await call('hospitality_core.getReservation', { id: 'booking-1' })
    const plans = [
      { booking: 'booking-1', room: '101', time: '12:30' },
      { booking: 'booking-2', room: '102', time: '09:00' },
    ]
    for (let n = 200; n < 249; n++) {
      const id = String(n)
      await must('hospitality_core.saveRoom', {
        id,
        propertyId: 'property',
        roomTypeId: 'type',
        code: id,
        name: id,
      })
      await must('hospitality_core.createReservation', {
        id: `priority-${id}`,
        code: `P-${id}`,
        propertyId: 'property',
        roomTypeId: 'type',
        partnerId: 'guest',
        provider: 'direct',
        checkIn: first.checkIn,
        checkOut: first.checkOut,
        adults: 1,
      })
      plans.push({ booking: `priority-${id}`, room: id, time: '10:00' })
    }
    for (const plan of plans) {
      const booking = await call('hospitality_core.getReservation', { id: plan.booking })
      const stay = await call('hospitality_core.getStay', { id: booking.stayId })
      await must('hospitality_core.holdRoom', {
        stayId: stay.id,
        roomId: plan.room,
        expectedVersion: stay.version,
        requestKey: `priority-hold-${plan.room}`,
      })
      await must('hospitality_core.setReservationArrivalPlan', {
        id: plan.booking,
        expectedArrivalTime: plan.time,
        earlyArrivalRequested: true,
        expectedVersion: booking.version,
        requestKey: `priority-plan-${plan.room}`,
      })
    }
    const page = await call('hospitality_core.getRoomBoard', { propertyId: 'property', state: 'priority' })
    const next = await call('hospitality_core.getRoomBoard', {
      propertyId: 'property',
      state: 'priority',
      page: 2,
    })
    const rows = page.rows as Array<Record<string, unknown>>,
      rest = next.rows as Array<Record<string, unknown>>
    assert.equal(page.total, 51)
    assert.equal(rows.length, 48)
    assert.equal(rows[0]!.code, '102')
    assert.deepEqual(
      rest.map((row) => row.code),
      ['247', '248', '101'],
    )
    assert.equal(new Set([...rows, ...rest].map((row) => row.id)).size, 51)
    assert.deepEqual(page.priority, { count: 51, first: { code: '102', time: '09:00' } })
    assert.equal(
      rows.some((row) => 'partnerId' in row || 'guestName' in row),
      false,
    )
    const room = await call('hospitality_core.getRoom', { id: '102' })
    await must('hospitality_core.completeRoomCleaning', {
      roomId: '102',
      expectedVersion: room.version,
      requestKey: 'priority-ready-first',
    })
    assert.equal(
      (await call('hospitality_core.getRoomBoard', { propertyId: 'property', state: 'priority' })).total,
      50,
    )
    assert.equal(
      (await call('hospitality_core.getRoomBoard', { propertyId: 'property', q: '102', peek: '102' })).total,
      1,
    )
  } finally {
    await adapter.close()
  }
})
