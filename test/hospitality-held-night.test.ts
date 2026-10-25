import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import {
  arrivalHoldJobs,
  expireArrivalHold,
} from '../packages/ketsuite/src/modules/hospitality_core/functions/arrival-hold-expiry.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compose,
  defineFn,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
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
import {
  addCalendarDays,
  dateKeyIn,
  zonedDateTime,
} from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
import { executeNightAudit } from '../packages/ketsuite/src/modules/hospitality_core/night-audit.ts'

const probe = defineModule({
  name: 'audit_probe',
  version: '1',
  depends: ['hospitality_core', 'hospitality_billing'],
  functions: {
    expire: defineFn({
      input: { reservationId: 'id', until: 'datetime', now: 'datetime' },
      effects: arrivalHoldJobs.expireArrivalHold!.effects,
      handler: (ctx, args) =>
        expireArrivalHold(ctx, args.reservationId, args.until, new Date(String(args.now))),
    }),
    execute: defineFn({
      input: { runId: 'id', propertyId: 'id', auditDate: 'date' },
      effects: hospitalityBilling.jobs!.nightAudit!.effects,
      handler: (ctx, args) =>
        executeNightAudit(ctx, {
          runId: String(args.runId),
          propertyId: String(args.propertyId),
          auditDate: String(args.auditDate),
        }),
    }),
  },
})
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
  probe,
]
const manifest = compose(modules, { headless: true, companies: true }),
  scope = { company: 'hotel', branches: null }

test('Hospitality close counts a guaranteed held night once without reposting upfront fees and expires at local noon while retaining earned fees and immutable closed-day charges', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = async (name: string, input: Record<string, unknown>) =>
    (await roomFixtureCall(name, input, { adapter, manifest, scope })).value as Row
  const must = async (name: string, input: Record<string, unknown>) => {
    const result = await call(name, input)
    assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result.errors)}`)
    return result
  }
  const today = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh'),
    day = addCalendarDays(today, -1)
  try {
    await must('partner.savePartner', { id: 'company-party', name: 'Hotel Company', kind: 'company' })
    await must('company.saveCompany', { id: 'hotel', partnerId: 'company-party', currency: 'VND' })
    await must('partner.savePartner', { id: 'guest', name: 'Synthetic guest', kind: 'person' })
    await must('hospitality_core.saveProperty', {
      id: 'hotel',
      code: 'HOTEL',
      name: 'Hotel',
      accommodationType: 'hotel',
      timezone: 'Asia/Ho_Chi_Minh',
    })
    await must('hospitality_core.saveRoomType', {
      id: 'type',
      propertyId: 'hotel',
      code: 'DLX',
      name: 'Deluxe',
      baseRate: '500',
    })
    await must('hospitality_core.saveRoom', {
      id: 'room',
      propertyId: 'hotel',
      roomTypeId: 'type',
      code: '101',
      name: '101',
    })
    await must('hospitality_core.saveRatePlan', {
      id: 'rate',
      propertyId: 'hotel',
      roomTypeId: 'type',
      code: 'BAR',
      name: 'Best rate',
      rateType: 'nightly',
      amount: '500',
    })
    const property = await call('hospitality_core.getProperty', { id: 'hotel' })
    await must('hospitality_core.setPropertyLifecycle', {
      propertyId: 'hotel',
      lifecycle: 'active',
      expectedVersion: property.version,
      requestKey: 'held-night-open-property',
    })
    await adapter.run('UPDATE hospitality_core_property SET "businessDate" = ? WHERE id = ?', [day, 'hotel'])
    await must('hospitality_core.createReservation', {
      id: 'held-booking',
      propertyId: 'hotel',
      roomTypeId: 'type',
      partnerId: 'guest',
      checkIn: zonedDateTime(day, 14, 0, 'Asia/Ho_Chi_Minh').toISOString(),
      checkOut: zonedDateTime(addCalendarDays(day, 2), 12, 0, 'Asia/Ho_Chi_Minh').toISOString(),
      rate: '500',
    })
    await must('hospitality_billing.setReservationGuarantee', {
      reservationId: 'held-booking',
      kind: 'card',
      amount: '500',
      reference: 'authorization:held-night',
      expectedVersion: 1,
      requestKey: 'held-night-guarantee',
    })
    const booking = await call('hospitality_core.getReservation', { id: 'held-booking' })
    await must('hospitality_core.decideAuditArrival', {
      reservationId: booking.id,
      auditDate: day,
      choice: 'hold',
      expectedVersion: booking.version,
      requestKey: 'held-night-decision',
    })
    const work = await call('hospitality_core.getNightAuditWorkbench', {
      propertyId: 'hotel',
      auditDate: day,
    })
    const queued = await must('hospitality_billing.requestNightAudit', {
      propertyId: 'hotel',
      auditDate: day,
      expectedVersion: work.propertyVersion,
      requestKey: 'held-night-close',
    })
    const input = { runId: queued.id, propertyId: 'hotel', auditDate: day },
      closed = await call('audit_probe.execute', input)
    assert.equal(closed.roomNightCount, 1)
    assert.equal(closed.heldCount, 1)
    assert.equal(closed.roomNightAmount, '500')
    assert.equal(closed.totalAmount, '500')
    assert.equal(
      (await adapter.all('SELECT id FROM hospitality_core_charge')).length,
      1,
      'the upfront room fee must not be posted again',
    )
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_room_night_snapshot')).length, 1)
    const held = await call('hospitality_core.getReservation', { id: booking.id })
    assert.equal(held.auditHoldUntil, zonedDateTime(today, 12, 0, 'Asia/Ho_Chi_Minh').toISOString())
    assert.equal((await call('hospitality_core.getProperty', { id: 'hotel' })).businessDate, today)
    assert.deepEqual(await call('audit_probe.execute', input), closed)
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_room_night_snapshot')).length, 1)
    const original = (
      await adapter.all('SELECT * FROM hospitality_core_charge WHERE id = ?', ['held-booking:room'])
    )[0]
    const expiry = {
      reservationId: booking.id,
      until: held.auditHoldUntil,
      now: zonedDateTime(today, 12, 1, 'Asia/Ho_Chi_Minh').toISOString(),
    }
    assert.equal(
      (
        await call('audit_probe.expire', {
          ...expiry,
          now: zonedDateTime(today, 11, 59, 'Asia/Ho_Chi_Minh').toISOString(),
        })
      ).expired,
      false,
    )
    assert.equal((await call('audit_probe.expire', expiry)).expired, true)
    assert.equal((await call('audit_probe.expire', expiry)).expired, false)
    assert.equal((await call('hospitality_core.getReservation', { id: booking.id })).state, 'no_show')
    assert.deepEqual(
      (await adapter.all('SELECT * FROM hospitality_core_charge WHERE id = ?', ['held-booking:room']))[0],
      original,
      'the closed-day charge remains immutable',
    )
    assert.equal(
      String((await call('hospitality_core.getFolio', { id: 'held-booking:folio' })).amountTotal),
      '500',
    )
  } finally {
    await adapter.close()
  }
})
