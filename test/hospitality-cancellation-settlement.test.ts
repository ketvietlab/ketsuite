import { deploymentRoomFixture } from './helpers/hospitality-room-fixture.ts'
import {
  addCalendarDays,
  dateKeyIn,
  zonedDateTime,
} from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
const settlementToday = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
/**
 * A booking that will not happen, settled.
 *
 * The desk and a sales channel both cancel bookings, and they used to leave the
 * folio in two different states. The desk wrote a `cancellation` charge and
 * closed the folio; the channel wrote a `service` charge and left the folio
 * `open`. `invoiceClosedFolios` only ever looks at closed folios — so every
 * cancellation fee an OTA charged sat in a folio nobody could invoice, and no
 * error was ever raised about it.
 *
 * These tests state the settlement once, for whoever cancels: the penalty is a
 * `cancellation` charge, everything else on the folio is void, a folio owing
 * money closes, a folio owing nothing is cancelled — and accounting can bill
 * the result either way.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, defineFn, defineModule } from '@ketvietlab/ketjs'
import type { Ctx, Row, Scope } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import * as suite from '@ketvietlab/ketsuite'
import { settleCancelledFolio } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }

/**
 * How a channel adapter reaches the settlement: inside the caller's own
 * transaction, so the folio and the provider's own rows commit together.
 */
const bridge = defineModule({
  name: 'hospitality_cancellation_test',
  depends: ['hospitality_core'],
  functions: {
    settle: defineFn({
      input: { folioId: 'id', fee: 'decimal', chargeId: 'id' },
      output: { ok: 'bool' },
      effects: [
        'read:hospitality_core.Property',
        'read:hospitality_core.Folio',
        'read:hospitality_core.Charge',
        'write:hospitality_core.Folio',
        'write:hospitality_core.Charge',
      ],
      agent: true,
      handler: async (ctx: Ctx, args) => {
        await ctx.tx((tx) =>
          settleCancelledFolio(tx, {
            folioId: args.folioId,
            fee: String(args.fee),
            chargeId: String(args.chargeId),
            sourceKey: `ota:${String(args.folioId)}:cancellation`,
            reason: 'provider',
            at: `${addCalendarDays(settlementToday, 0)}T09:00:00.000Z`,
          }),
        )
        return { ok: true }
      },
    }),
  },
})

const app = defineDeployment({
  name: 'hospitality_cancellation_test',
  companies: true,
  modules: [
    suite.website,
    suite.address,
    suite.partner,
    suite.company,
    suite.storage,
    suite.uom,
    suite.product,
    suite.user,
    suite.account,
    backend,
    suite.hospitalityCore,
    suite.hospitalityBilling,
    bridge,
  ],
  theme: suite.paperTheme,
  serve: { defaults: { defaultCompany: 'default', defaultLocale: 'vi', fallbackLocale: 'vi' } },
  // The night audit runs on the maintenance queue, and it is one of the two
  // callers of the settlement under test here.
  worker: { queues: { maintenance: 1, default: 1 } },
})

type Fixture = Awaited<ReturnType<typeof createTestDeployment>>

const boot = async (e2e: Fixture) => {
  const call = <T>(name: string, input: Record<string, unknown> = {}) =>
    deploymentRoomFixture<T>(e2e.fixture, name, input, { scope })

  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['revenue', '5113', 'Doanh thu dịch vụ', 'income'],
    ['tax', '3331', 'Thuế GTGT phải nộp', 'liability_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveDefaults', { incomeAccountId: 'revenue', receivableAccountId: 'receivable' })
  await call('account.saveJournal', { id: 'sales', name: 'Bán hàng', code: 'SAL', type: 'sale' })
  await call('account.saveTax', {
    id: 'vat10',
    name: 'GTGT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
    accountId: 'tax',
  })

  await call('partner.savePartner', { id: 'company-partner', kind: 'company', name: 'Ket Hotel JSC' })
  // A penalty is a percentage of money, so the company has to say in what.
  await call('company.saveCompany', { id: 'default', partnerId: 'company-partner', currency: 'VND' })
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' })
  const savedProperty = await call<Row>('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HTL',
    name: 'Ket Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
  })
  assert.equal(savedProperty.value.ok, true, JSON.stringify(savedProperty.value.errors))
  await call('hospitality_core.saveCancellationPolicy', {
    id: 'non-refundable',
    code: 'NONREF',
    name: 'Không hoàn hủy',
    type: 'non_refundable',
    freeCancellationHours: 0,
    penaltyPercent: '100',
  })
  await call('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '500',
    cancellationPolicyId: 'non-refundable',
  })
  await call('hospitality_core.saveRoom', {
    id: '101',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '101',
    name: '101',
  })
  await call('hospitality_core.saveRatePlan', {
    id: 'settlement-rate',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: 'BAR',
    name: 'Best rate',
    rateType: 'nightly',
    amount: '500',
  })
  const configured = await call<Row>('hospitality_core.getProperty', { id: 'hotel' })
  const opened = await call<Row>('hospitality_core.setPropertyLifecycle', {
    propertyId: 'hotel',
    lifecycle: 'active',
    expectedVersion: configured.value.version,
    requestKey: 'settlement-open-property',
  })
  assert.equal(opened.value.ok, true, JSON.stringify(opened.value.errors))
  return call
}

/** A booking taken and paid for up front, so its folio carries a room charge. */
const booked = async (
  call: <T>(name: string, input?: Record<string, unknown>) => Promise<{ value: T }>,
  id: string,
  stay: { checkIn: string; checkOut: string } = {
    checkIn: `${addCalendarDays(settlementToday, 20)}T14:00:00.000Z`,
    checkOut: `${addCalendarDays(settlementToday, 22)}T12:00:00.000Z`,
  },
): Promise<string> => {
  const created = await call<Row>('hospitality_core.createReservation', {
    id,
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    partnerId: 'guest',
    bookingType: 'nightly',
    billingMode: 'upfront',
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    rate: '500',
  })
  assert.equal(created.value.ok, true, JSON.stringify(created.value.errors))
  return String(created.value.folioId)
}

/** A no-show owes the policy only on a booking a guarantee secured. */
const guaranteedByCard = async (
  call: <T>(name: string, input?: Record<string, unknown>) => Promise<{ value: T }>,
  id: string,
): Promise<void> => {
  const guaranteed = await call<Row>('hospitality_billing.setReservationGuarantee', {
    reservationId: id,
    kind: 'card',
    amount: '1000',
    reference: `authorization:${id}`,
    expectedVersion: 1,
    requestKey: `guarantee-${id}`,
  })
  assert.equal(guaranteed.value.ok, true, JSON.stringify(guaranteed.value.errors))
}

const folioState = (e2e: Fixture, folioId: string) =>
  e2e.fixture.withTenant('', async ({ adapter }) => {
    const folio = (
      await adapter.all('SELECT state, "amountTotal" FROM hospitality_core_folio WHERE id = ?', [folioId])
    )[0]!
    const charges = await adapter.all(
      'SELECT type, state, description, amount FROM hospitality_core_charge WHERE "folioId" = ? ORDER BY id',
      [folioId],
    )
    return {
      state: String(folio.state),
      amountTotal: String(folio.amountTotal),
      charges: charges.map((row: Row) => `${row.type}/${row.state}/${row.description}/${Number(row.amount)}`),
    }
  })

test('a cancelled booking settles the same way whoever cancelled it', async (t) => {
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close())
  const call = await boot(e2e)

  // The desk cancels. Two nights at 500, non-refundable: the guest owes it all.
  const deskFolio = await booked(call, 'desk')
  const cancelled = await call<Row>('hospitality_core.cancelReservation', {
    id: 'desk',
    reason: 'guest changed plans',
    at: `${addCalendarDays(settlementToday, 0)}T09:00:00.000Z`,
  })
  assert.equal(cancelled.value.ok, true, JSON.stringify(cancelled.value.errors))
  assert.equal(cancelled.value.cancellationFee, '1000')
  assert.deepEqual(await folioState(e2e, deskFolio), {
    state: 'closed',
    amountTotal: '1000',
    charges: ['cancellation/active/cancellation:non_refundable/1000', 'room/void/room:deluxe/1000'],
  })

  // A channel cancels, at an amount the channel decided. Same settlement.
  const channelFolio = await booked(call, 'channel')
  const settled = await call<{ ok: boolean }>('hospitality_cancellation_test.settle', {
    folioId: channelFolio,
    fee: '300',
    chargeId: 'channel:cancellation',
  })
  assert.equal(settled.value.ok, true)
  assert.deepEqual(await folioState(e2e, channelFolio), {
    state: 'closed',
    amountTotal: '300',
    charges: ['cancellation/active/cancellation:provider/300', 'room/void/room:deluxe/1000'],
  })

  // And both are billable, which is the point: before this, a fee from a
  // channel left the folio `open` and no sweep would ever see it again.
  await call('hospitality_billing.saveChargeRule', {
    chargeType: 'cancellation',
    taxId: 'vat10',
    taxAccountId: 'tax',
  })
  for (const [folioId, untaxed] of [
    [deskFolio, 1000],
    [channelFolio, 300],
  ] as const) {
    const invoiced = await call<Row>('hospitality_billing.invoiceFolio', { folioId })
    assert.equal(invoiced.value.ok, true, JSON.stringify(invoiced.value.errors))
    const move = await e2e.fixture.withTenant(
      '',
      async ({ adapter }) =>
        (
          await adapter.all('SELECT state, "amountUntaxed", "amountTotal" FROM account_move WHERE id = ?', [
            String(invoiced.value.moveId ?? invoiced.value.id),
          ])
        )[0]!,
    )
    assert.equal(String(move.state), 'posted')
    assert.equal(Number(move.amountUntaxed), untaxed)
  }
})

test('a cancellation costing nothing leaves nothing behind to bill', async (t) => {
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close())
  const call = await boot(e2e)
  await call('hospitality_core.saveCancellationPolicy', {
    id: 'flexible',
    code: 'FLEX',
    name: 'Linh hoạt',
    type: 'flexible',
    freeCancellationHours: 48,
    penaltyPercent: '0',
  })
  await call('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '500',
    cancellationPolicyId: 'flexible',
  })

  const folioId = await booked(call, 'free')
  const cancelled = await call<Row>('hospitality_core.cancelReservation', {
    id: 'free',
    reason: 'guest changed plans',
    at: `${addCalendarDays(settlementToday, 0)}T09:00:00.000Z`,
  })
  assert.equal(cancelled.value.ok, true, JSON.stringify(cancelled.value.errors))
  assert.equal(cancelled.value.cancellationFee, '0')
  // `cancelled`, not `closed`: there is nothing here for accounting to take up.
  assert.deepEqual(await folioState(e2e, folioId), {
    state: 'cancelled',
    amountTotal: '0',
    charges: ['room/void/room:deluxe/1000'],
  })
})

test('a partial penalty is charged as a partial penalty, not rounded to all or nothing', async (t) => {
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close())
  const call = await boot(e2e)
  await call('hospitality_core.saveCancellationPolicy', {
    id: 'strict',
    code: 'STRICT',
    name: 'Nghiêm ngặt',
    type: 'strict',
    freeCancellationHours: 48,
    penaltyPercent: '50',
  })
  await call('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '500',
    cancellationPolicyId: 'strict',
  })

  const folioId = await booked(call, 'late')
  // Inside the 48-hour window before a check-in on 1 November, so the penalty
  // applies: half of two nights at 500.
  const cancelled = await call<Row>('hospitality_core.cancelReservation', {
    id: 'late',
    reason: 'guest changed plans',
    at: `${addCalendarDays(settlementToday, 19)}T09:00:00.000Z`,
  })
  assert.equal(cancelled.value.ok, true, JSON.stringify(cancelled.value.errors))
  assert.equal(cancelled.value.cancellationFee, '500')
  assert.deepEqual(await folioState(e2e, folioId), {
    state: 'closed',
    amountTotal: '500',
    charges: ['cancellation/active/cancellation:strict/500', 'room/void/room:deluxe/1000'],
  })

  // And cancelling again says the same thing rather than charging twice.
  const again = await call<Row>('hospitality_core.cancelReservation', { id: 'late' })
  assert.equal(again.value.ok, true)
  assert.equal(again.value.state, 'cancelled')
  assert.deepEqual((await folioState(e2e, folioId)).amountTotal, '500')
})

test('a guest who never arrived owes the policy, not the whole stay', async (t) => {
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close())
  const call = await boot(e2e)
  await call('hospitality_core.saveCancellationPolicy', {
    id: 'strict',
    code: 'STRICT',
    name: 'Nghiêm ngặt',
    type: 'strict',
    freeCancellationHours: 48,
    penaltyPercent: '50',
  })
  await call('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '500',
    cancellationPolicyId: 'strict',
  })

  const folioId = await booked(call, 'absent')
  await guaranteedByCard(call, 'absent')
  const marked = await call<Row>('hospitality_core.markNoShow', {
    id: 'absent',
    reason: 'no arrival by midnight',
    at: `${addCalendarDays(settlementToday, 21)}T00:30:00.000Z`,
  })
  assert.equal(marked.value.ok, true, JSON.stringify(marked.value.errors))
  // Half of two nights at 500, because that is what the policy says. The folio
  // used to close with both room nights still active on it — the full 1000.
  assert.equal(marked.value.noShowFee, '500')
  assert.deepEqual(await folioState(e2e, folioId), {
    state: 'closed',
    amountTotal: '500',
    // And it says it was a no-show, not a cancellation the guest never made.
    charges: ['cancellation/active/no_show:strict/500', 'room/void/room:deluxe/1000'],
  })
})

test('a no-show on a booking that could be cancelled for free costs nothing', async (t) => {
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close())
  const call = await boot(e2e)
  await call('hospitality_core.saveCancellationPolicy', {
    id: 'flexible',
    code: 'FLEX',
    name: 'Linh hoạt',
    type: 'flexible',
    freeCancellationHours: 0,
    penaltyPercent: '0',
  })
  await call('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '500',
    cancellationPolicyId: 'flexible',
  })

  const folioId = await booked(call, 'absent-free')
  // Guaranteed, so the policy alone is what makes it free.
  await guaranteedByCard(call, 'absent-free')
  const marked = await call<Row>('hospitality_core.markNoShow', {
    id: 'absent-free',
    reason: 'no arrival by midnight',
    at: `${addCalendarDays(settlementToday, 21)}T00:30:00.000Z`,
  })
  assert.equal(marked.value.ok, true, JSON.stringify(marked.value.errors))
  assert.equal(marked.value.noShowFee, '0')
  assert.deepEqual(await folioState(e2e, folioId), {
    state: 'cancelled',
    amountTotal: '0',
    charges: ['room/void/room:deluxe/1000'],
  })
})

test('the night audit prices a missed arrival the same way the desk would', async (t) => {
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close())
  const call = await boot(e2e)
  await call('hospitality_core.saveCancellationPolicy', {
    id: 'strict',
    code: 'STRICT',
    name: 'Nghiêm ngặt',
    type: 'strict',
    freeCancellationHours: 48,
    penaltyPercent: '50',
  })
  await call('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '500',
    cancellationPolicyId: 'strict',
  })

  // Yesterday is still open: a night audit refuses a date that has not happened
  // yet, and closes only the property's business day.
  const auditDate = addCalendarDays(settlementToday, -1)
  await e2e.fixture.withTenant('', ({ adapter }) =>
    adapter.run('UPDATE hospitality_core_property SET "businessDate" = ? WHERE id = ?', [auditDate, 'hotel']),
  )
  const folioId = await booked(call, 'ghost', {
    checkIn: zonedDateTime(auditDate, 14, 0, 'Asia/Ho_Chi_Minh').toISOString(),
    checkOut: zonedDateTime(addCalendarDays(auditDate, 2), 12, 0, 'Asia/Ho_Chi_Minh').toISOString(),
  })
  await guaranteedByCard(call, 'ghost')
  // A room was being kept for this guest, so the audit has one to let go of.
  const held = await call<Row>('hospitality_core.holdRoom', { stayId: 'ghost:stay', roomId: '101' })
  assert.equal(held.value.ok, true, JSON.stringify(held.value.errors))
  // A guaranteed arrival is a decision the desk makes before the audit runs.
  const booking = await call<Row>('hospitality_core.getReservation', { id: 'ghost' })
  const decided = await call<Row>('hospitality_core.decideAuditArrival', {
    reservationId: 'ghost',
    auditDate,
    choice: 'no_show',
    expectedVersion: booking.value.version,
    requestKey: 'ghost-no-show',
  })
  assert.equal(decided.value.ok, true, JSON.stringify(decided.value.errors))

  const work = await call<Row>('hospitality_core.getNightAuditWorkbench', { propertyId: 'hotel', auditDate })
  const requested = await call<Row>('hospitality_billing.requestNightAudit', {
    propertyId: 'hotel',
    auditDate,
    expectedVersion: work.value.propertyVersion,
    requestKey: 'ghost-night-audit',
  })
  assert.equal(requested.value.ok, true, JSON.stringify(requested.value.errors))
  assert.equal(await e2e.drainJobs(), 1)

  // The audit reaches applyNoShow, which reads the policy, the company's
  // currency and the room being held. Every one of those is an effect the job
  // has to have declared, and an undeclared read throws rather than warning.
  const run = await e2e.fixture.withTenant(
    '',
    async ({ adapter }) =>
      (await adapter.all('SELECT state, "noShowPosted", error FROM hospitality_core_night_audit_run'))[0]!,
  )
  assert.equal(String(run.state), 'completed', String(run.error ?? ''))
  assert.equal(Number(run.noShowPosted), 1)
  assert.deepEqual(await folioState(e2e, folioId), {
    state: 'closed',
    amountTotal: '500',
    charges: ['cancellation/active/no_show:strict/500', 'room/void/room:deluxe/1000'],
  })
  const assignment = await e2e.fixture.withTenant(
    '',
    async ({ adapter }) =>
      (await adapter.all('SELECT state, reason FROM hospitality_core_room_assignment'))[0]!,
  )
  assert.deepEqual(
    { state: String(assignment.state), reason: String(assignment.reason) },
    { state: 'closed', reason: 'room_hold_no_show' },
  )
})
