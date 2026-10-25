import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  bootWorker,
  compose,
  createQueue,
  defineDeployment,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import {
  addCalendarDays,
  dateKeyIn,
  zonedDateTime,
} from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
import backend from '@ketvietlab/ketsuite/backend'
import {
  stayNoticeDueAt,
  stayNoticeDurationValid,
} from '../packages/ketsuite/src/modules/hospitality_core/stay-notices.ts'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })
const noticeDay = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
const noticeArrival = zonedDateTime(noticeDay, 0, 0, 'Asia/Ho_Chi_Minh').toISOString()
const noticeDeparture = zonedDateTime(addCalendarDays(noticeDay, 2), 12, 0, 'Asia/Ho_Chi_Minh').toISOString()
const scope = { company: 'acme', branches: null }
const call = (
  name: string,
  args: Record<string, unknown>,
  adapter: Adapter,
  actor: string | null = 'frontdesk',
) => roomFixtureCall(name, args, { adapter, manifest, scope, actor })

const seedStay = async (adapter: Adapter): Promise<void> => {
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'company-party', name: 'Hotel company', kind: 'company' }, adapter)
  await call(
    'company.saveCompany',
    { id: 'acme', code: 'ACME', partnerId: 'company-party', currency: 'VND' },
    adapter,
  )
  await call('partner.savePartner', { id: 'primary', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('partner.savePartner', { id: 'companion', kind: 'person', name: 'Trần Bình' }, adapter)
  await call(
    'hospitality_core.saveProperty',
    {
      id: 'hotel',
      code: 'HCM',
      name: 'Két Hotel',
      accommodationType: 'hotel',
      timezone: 'Asia/Ho_Chi_Minh',
      street1: '123 Nguyễn Huệ',
      locality: 'Thành phố Hồ Chí Minh',
    },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', baseRate: '100' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoom',
    { id: '101', propertyId: 'hotel', roomTypeId: 'deluxe', code: '101', name: '101' },
    adapter,
  )
  await call(
    'hospitality_core.completeRoomCleaning',
    { roomId: '101', expectedVersion: 1, requestKey: 'notice-fixture-clean' },
    adapter,
  )
  await call(
    'hospitality_core.saveRatePlan',
    {
      id: 'bar',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      code: 'BAR',
      name: 'Best rate',
      rateType: 'nightly',
      amount: '100',
    },
    adapter,
  )
  const profile = (await call('hospitality_core.getPropertyProfile', { id: 'hotel' }, adapter)).value as Row
  const opened = (
    await call(
      'hospitality_core.setPropertyLifecycle',
      {
        propertyId: 'hotel',
        lifecycle: 'active',
        expectedVersion: (profile.property as Row | null)?.version ?? 0,
        requestKey: 'notice-fixture-open',
      },
      adapter,
    )
  ).value as Row
  assert.equal(opened.ok, true, JSON.stringify(opened))
  const booked = await call(
    'hospitality_core.createReservation',
    {
      id: 'late-arrival',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'primary',
      bookingType: 'nightly',
      checkIn: noticeArrival,
      checkOut: noticeDeparture,
      rate: '100',
    },
    adapter,
  )
  assert.equal((booked.value as Row).ok, true, JSON.stringify(booked.value))
  const checkedIn = await call(
    'hospitality_core.checkIn',
    {
      stayId: 'late-arrival:stay',
      roomId: '101',
      assignmentId: 'late-arrival:assignment',
      at: noticeArrival,
      // A midnight arrival is before the property's check-in time.
      earlyFee: 'waived',
      earlyReason: 'Synthetic late-night arrival',
      // Every adult is declared on arrival, with the document the notice is made from.
      guests: [
        {
          fullName: 'Nguyễn An',
          type: 'cccd',
          number: '079203001234',
          birth: '1990-05-12',
          gender: 'female',
          nationality: 'VN',
        },
      ],
    },
    adapter,
    // Who may declare guests is a user-module grant, and this composition has no users.
    null,
  )
  assert.equal((checkedIn.value as Row).ok, true, JSON.stringify(checkedIn.value))
}

test('hospitality stay notices: deadline follows the property-local 23:00 rule', () => {
  assert.equal(stayNoticeDueAt('2026-08-20T15:59:00.000Z', 'Asia/Ho_Chi_Minh'), '2026-08-20T16:00:00.000Z')
  assert.equal(stayNoticeDueAt('2026-08-20T16:00:00.000Z', 'Asia/Ho_Chi_Minh'), '2026-08-21T01:00:00.000Z')
  assert.equal(stayNoticeDurationValid('2026-08-01T07:00:00.000Z', '2026-08-31T07:00:00.000Z'), true)
  assert.equal(stayNoticeDurationValid('2026-08-01T07:00:00.000Z', '2026-08-31T07:00:01.000Z'), false)
})

test('hospitality stay notices: physical SQLite worker prepares and records evidence without PII payloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-hospitality-stay-notices-'))
  const file = join(dir, 'hospitality.db')
  const app = defineDeployment({
    name: 'hospitality_stay_notice_test',
    companies: true,
    modules,
    headless: true,
    serve: {},
    worker: { queues: { maintenance: 1 } },
  })
  const producer = sqliteAdapter(file)
  await producer.open()
  let worker: Awaited<ReturnType<typeof bootWorker>> | null = null
  try {
    await seedStay(producer)
    const queue = await createQueue(producer)
    const queued = (await queue.list({ state: 'available' })).find(
      (row) => row.job === 'hospitality_core.prepareStayNotices',
    )
    assert.ok(queued)
    assert.deepEqual(queued.args, { stayId: 'late-arrival:stay' })

    const draft = await call(
      'hospitality_core.createReservation',
      {
        id: 'future-arrival',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'companion',
        bookingType: 'nightly',
        checkIn: zonedDateTime(addCalendarDays(noticeDay, 20), 14, 0, 'Asia/Ho_Chi_Minh').toISOString(),
        checkOut: zonedDateTime(addCalendarDays(noticeDay, 21), 12, 0, 'Asia/Ho_Chi_Minh').toISOString(),
        rate: '100',
      },
      producer,
    )
    assert.equal((draft.value as Row).ok, true)
    const premature = await call(
      'hospitality_core.requestStayNoticeRefresh',
      { stayId: 'future-arrival:stay' },
      producer,
    )
    assert.equal((premature.value as Row).ok, false)
    assert.equal(
      ((premature.value as Row).errors as Row[])[0]?.messageKey,
      'hospitality_core.validation.stay_notice_stay_state',
    )
    await producer.close()

    worker = await bootWorker(app, {
      env: { KET_LOG: 'null', KET_SQLITE: file, KET_COMPANY: 'acme', KET_QUEUE_NOTIFY: '0' },
      log: () => {},
    })
    assert.equal(await worker.drain(), 1)

    const readyAdapter = sqliteAdapter(file)
    await readyAdapter.open()
    registerFunctions(modules)
    const prepared = (
      await readyAdapter.all('SELECT * FROM hospitality_core_stay_notice WHERE id = ?', [
        'late-arrival:stay:notice:late-arrival:guest',
      ])
    )[0]!
    assert.deepEqual(
      {
        state: prepared.state,
        dueAt: prepared.dueAt,
        issueCodes: JSON.parse(String(prepared.issueCodes)),
        documentLast4: prepared.documentLast4,
      },
      {
        state: 'ready',
        dueAt: stayNoticeDueAt(noticeArrival, 'Asia/Ho_Chi_Minh'),
        issueCodes: [],
        documentLast4: '1234',
      },
    )
    const listed = (await call('hospitality_core.listStayNotices', { propertyId: 'hotel' }, readyAdapter))
      .value as Row[]
    assert.deepEqual(
      listed.map((row) => ({
        state: row.state,
        reason: row.reason,
        documentType: row.documentType,
        last4: row.documentLast4,
      })),
      [{ state: 'ready', reason: null, documentType: 'cccd', last4: '1234' }],
    )
    const storedReady = (
      await readyAdapter.all('SELECT * FROM hospitality_core_stay_notice WHERE id = ?', [listed[0]!.id])
    )[0]!
    assert.doesNotMatch(JSON.stringify(storedReady), /079203001234/)
    assert.doesNotMatch(JSON.stringify(storedReady), /1990-05-12/)
    assert.equal('number' in storedReady, false)

    const missingReason = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        { id: listed[0]!.id, reason: '', channel: 'online', evidenceRef: 'DVC-NO-REASON' },
        readyAdapter,
        'frontdesk-user',
      )
    ).value as Row
    assert.equal(missingReason.ok, false)
    assert.equal(
      (missingReason.errors as Row[])[0]?.messageKey,
      'hospitality_core.validation.stay_notice_reason',
    )

    const unsigned = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        {
          id: listed[0]!.id,
          reason: 'tourism',
          channel: 'online',
          evidenceRef: 'DVC-UNSIGNED',
        },
        readyAdapter,
        null,
      )
    ).value as Row
    assert.equal(unsigned.ok, false)
    assert.equal(
      (unsigned.errors as Row[])[0]?.messageKey,
      'hospitality_core.validation.authentication_required',
    )

    const invalidTime = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        {
          id: listed[0]!.id,
          reason: 'business',
          channel: 'online',
          evidenceRef: 'too-early',
          submittedAt: '2000-01-01T00:00:00Z',
          expectedVersion: 0,
          requestKey: 'notice-invalid-sent-time',
        },
        readyAdapter,
        'frontdesk-user',
      )
    ).value as Row
    assert.equal(invalidTime.ok, false)
    assert.equal((invalidTime.errors as Row[])[0]?.code, 'stay_notice_submission_time')
    const submitted = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        {
          id: listed[0]!.id,
          reason: 'business',
          channel: 'online',
          evidenceRef: 'DVC-2026-0001',
          submittedLocal: `${noticeDay}T00:01`,
          submissionNote: 'Submitted through the official portal',
        },
        readyAdapter,
        'frontdesk-user',
      )
    ).value as Row
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    const firstEvidence = (
      await readyAdapter.all(
        'SELECT state, "packageHash", "submittedBy", "receiptRef", "submittedAt", "submissionNote" FROM hospitality_core_stay_notice WHERE id = ?',
        [listed[0]!.id],
      )
    )[0]!
    assert.equal(firstEvidence.state, 'submitted')
    assert.equal(firstEvidence.submittedAt, zonedDateTime(noticeDay, 0, 1, 'Asia/Ho_Chi_Minh').toISOString())
    assert.equal(firstEvidence.submissionNote, 'Submitted through the official portal')
    assert.match(String(firstEvidence.packageHash), /^[a-f0-9]{64}$/)
    assert.equal(firstEvidence.submittedBy, 'frontdesk-user')
    assert.equal(firstEvidence.receiptRef, 'DVC-2026-0001')

    const repeated = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        {
          id: listed[0]!.id,
          reason: 'tourism',
          channel: 'phone',
          evidenceRef: 'must-not-overwrite',
        },
        readyAdapter,
        'another-user',
      )
    ).value as Row
    assert.equal(repeated.ok, true)
    assert.deepEqual(
      {
        ...(
          await readyAdapter.all(
            'SELECT reason, "receiptRef" FROM hospitality_core_stay_notice WHERE id = ?',
            [listed[0]!.id],
          )
        )[0],
      },
      { reason: 'business', receiptRef: 'DVC-2026-0001' },
    )

    const confirmed = (
      await call(
        'hospitality_core.confirmStayNotice',
        { id: listed[0]!.id, receiptRef: 'DVC-2026-0001' },
        readyAdapter,
        'supervisor-user',
      )
    ).value as Row
    assert.equal(confirmed.state, 'confirmed')
    assert.equal(
      (
        await readyAdapter.all('SELECT state, "confirmedBy" FROM hospitality_core_stay_notice WHERE id = ?', [
          listed[0]!.id,
        ])
      )[0]!.confirmedBy,
      'supervisor-user',
    )

    // A guest who joins the stay is declared with a document, as on arrival.
    const stay = (
      await readyAdapter.all('SELECT version FROM hospitality_core_stay WHERE id = ?', ['late-arrival:stay'])
    )[0]!
    const booking = (
      await readyAdapter.all('SELECT version FROM hospitality_core_reservation WHERE id = ?', [
        'late-arrival',
      ])
    )[0]!
    const added = await call(
      'hospitality_core.addInHouseGuest',
      {
        stayId: 'late-arrival:stay',
        guest: {
          partnerId: 'companion',
          fullName: 'Trần Bình',
          type: 'passport',
          number: 'P1234567',
          birth: '1988-04-20',
          gender: 'male',
          nationality: 'VN',
        },
        expectedVersion: Number(stay.version),
        expectedReservationVersion: Number(booking.version),
        requestKey: 'notice-companion',
      },
      readyAdapter,
      null,
    )
    assert.equal((added.value as Row).ok, true, JSON.stringify(added.value))
    await readyAdapter.close()
    assert.equal(await worker.drain(), 1)

    const finalAdapter = sqliteAdapter(file)
    await finalAdapter.open()
    registerFunctions(modules)
    const finalRows = (await call('hospitality_core.listStayNotices', { propertyId: 'hotel' }, finalAdapter))
      .value as Row[]
    assert.deepEqual(
      finalRows
        .map((row) => ({ guest: row.guestName, state: row.state, last4: row.documentLast4 }))
        .sort((left, right) => String(left.guest).localeCompare(String(right.guest), 'vi')),
      [
        { guest: 'Nguyễn An', state: 'confirmed', last4: '1234' },
        { guest: 'Trần Bình', state: 'ready', last4: '4567' },
      ],
    )
    assert.doesNotMatch(JSON.stringify(finalRows), /079203001234|P1234567/)
    await finalAdapter.close()
  } finally {
    await worker?.close()
    await producer.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})
