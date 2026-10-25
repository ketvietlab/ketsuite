import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
/**
 * A stay, billed.
 *
 * The folio was where hospitality stopped and accounting had not started: a
 * guest could check out owing money and nothing in the ledger knew. These tests
 * cover the seam itself — that a closed folio becomes one posted sales entry,
 * that it becomes exactly one however many times anyone asks, that money taken
 * against it settles the receivable, and that a charge nobody has classified is
 * refused rather than quietly filed as not subject to VAT.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
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
import { addCalendarDays, dateKeyIn } from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
import {
  billingBookHref,
  billingBookQueryFromUrl,
} from '../packages/ketsuite/src/modules/hospitality_billing/billing-book-query.ts'
import { BILLING_BOOK_LIMIT } from '../packages/ketsuite/src/modules/hospitality_billing/functions/billing-book.ts'
import { CHARGE_TYPES } from '../packages/ketsuite/src/modules/hospitality_core/types.ts'
const arrivalDay = dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh')
const departureDay = addCalendarDays(arrivalDay, 2)

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
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  roomFixtureCall(name, args, { adapter, manifest, scope })

const value = async (name: string, args: Record<string, unknown>, adapter: Adapter): Promise<Row> =>
  (await call(name, args, adapter)).value as Row

const fixtureWrite = async (name: string, args: Record<string, unknown>, adapter: Adapter) => {
  const result = await value(name, args, adapter)
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.errors)}`)
  return result
}

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)

  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Ket Hotel JSC' }, adapter)
  await call(
    'company.saveCompany',
    { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' },
    adapter,
  )
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    {
      id: 'water-template',
      name: 'Water',
      type: 'goods',
      uomId: 'unit',
      listPrice: '50',
      saleOk: true,
    },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'water', templateId: 'water-template', defaultCode: 'WATER', combinationKey: '' },
    adapter,
  )

  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['revenue', '5113', 'Doanh thu dịch vụ', 'income'],
    ['tax', '3331', 'Thuế GTGT phải nộp', 'liability_current'],
    ['cash', '1111', 'Tiền mặt', 'asset_cash'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call(
    'account.saveDefaults',
    { incomeAccountId: 'revenue', receivableAccountId: 'receivable' },
    adapter,
  )
  await call('account.saveJournal', { id: 'sales', name: 'Bán hàng', code: 'SAL', type: 'sale' }, adapter)
  await call(
    'account.saveJournal',
    { id: 'cash-journal', name: 'Tiền mặt', code: 'CSH', type: 'cash', defaultAccountId: 'cash' },
    adapter,
  )
  // Accommodation and food are not taxed at the same rate, which is the whole
  // reason a charge type has to say which it is.
  await call(
    'account.saveTax',
    {
      id: 'vat8',
      name: 'GTGT 8%',
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount: '8',
      accountId: 'tax',
    },
    adapter,
  )
  await call(
    'account.saveTax',
    {
      id: 'vat10',
      name: 'GTGT 10%',
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount: '10',
      accountId: 'tax',
    },
    adapter,
  )

  await call(
    'hospitality_core.saveProperty',
    { id: 'hotel', code: 'HCM', name: 'Ket Hotel', accommodationType: 'hotel' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', baseRate: '500', published: true },
    adapter,
  )
  await call(
    'hospitality_core.saveRoom',
    { id: '101', propertyId: 'hotel', roomTypeId: 'deluxe', code: '101', name: '101' },
    adapter,
  )
  const clean = await value(
    'hospitality_core.completeRoomCleaning',
    { roomId: '101', expectedVersion: 1, requestKey: 'billing-fixture-clean-room' },
    adapter,
  )
  assert.equal(clean.ok, true, JSON.stringify(clean.errors))
  await call(
    'hospitality_core.saveRatePlan',
    {
      id: 'billing-rate',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      code: 'BAR',
      name: 'Best rate',
      rateType: 'nightly',
      amount: '500',
    },
    adapter,
  )
  const property = await value('hospitality_core.getPropertyProfile', { id: 'hotel' }, adapter)
  const opened = await value(
    'hospitality_core.setPropertyLifecycle',
    {
      propertyId: 'hotel',
      lifecycle: 'active',
      expectedVersion: (property.property as Row).version,
      requestKey: 'billing-fixture-open-property',
    },
    adapter,
  )
  assert.equal(opened.ok, true, JSON.stringify(opened.errors))
  return adapter
}

/** A guest who arrived, spent, and left — the folio this module bills. */
const stayed = async (adapter: Adapter): Promise<string> => {
  await fixtureWrite(
    'hospitality_core.createReservation',
    {
      id: 'r1',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: `${arrivalDay}T14:00:00.000Z`,
      checkOut: `${departureDay}T12:00:00.000Z`,
      rate: '500',
    },
    adapter,
  )
  await fixtureWrite(
    'hospitality_billing.setReservationGuarantee',
    {
      reservationId: 'r1',
      kind: 'card',
      amount: '500',
      reference: 'authorization:fixture',
      expectedVersion: 1,
      requestKey: 'billing-fixture-card-guarantee',
    },
    adapter,
  )
  await fixtureWrite(
    'hospitality_core.checkIn',
    {
      stayId: 'r1:stay',
      roomId: '101',
      assignmentId: 'a1',
      guests: [
        {
          fullName: 'Synthetic billing guest',
          type: 'passport',
          number: 'TEST1234',
          birth: '1990-01-01',
          gender: 'female',
          nationality: 'VN',
        },
      ],
      at: `${arrivalDay}T14:05:00.000Z`,
    },
    adapter,
  )
  await fixtureWrite(
    'hospitality_core.checkOut',
    { handover: ['keys', 'charges'], stayId: 'r1:stay', at: `${departureDay}T12:00:00.000Z` },
    adapter,
  )
  const folio = (await adapter.all('SELECT id FROM hospitality_core_folio'))[0]!
  return String(folio.id)
}

const rule = (chargeType: string, taxId: string | null, adapter: Adapter) =>
  call(
    'hospitality_billing.saveChargeRule',
    {
      chargeType,
      taxId: taxId ?? undefined,
      taxExempt: !taxId,
      taxExemptReason: !taxId ? 'Synthetic tax-exempt fixture' : null,
      taxAccountId: 'tax',
    },
    adapter,
  )

test('Hospitality folio advances are posted once, cannot overpay or overwrite a stale draft, and settle the actual invoice', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    const version = async () => (await value('hospitality_core.getFolio', { id: folioId }, adapter)).version
    const firstInput = {
      id: 'advance-one',
      folioId,
      amount: '100',
      journalId: 'cash-journal',
      expectedVersion: await version(),
      requestKey: 'advance-one-request',
    }
    const first = await value('hospitality_billing.recordFolioPayment', firstInput, adapter)
    assert.equal(first.ok, true, JSON.stringify(first.errors))
    assert.deepEqual(await value('hospitality_billing.recordFolioPayment', firstInput, adapter), first)
    const stale = await value(
      'hospitality_billing.recordFolioPayment',
      { ...firstInput, id: 'advance-two', requestKey: 'advance-two-request' },
      adapter,
    )
    assert.equal(stale.ok, false)
    assert.equal((stale.errors as Row[])[0]?.code, 'transition_conflict')
    const second = await value(
      'hospitality_billing.recordFolioPayment',
      {
        ...firstInput,
        id: 'advance-two',
        expectedVersion: await version(),
        requestKey: 'advance-two-request',
      },
      adapter,
    )
    assert.equal(second.ok, true, JSON.stringify(second.errors))
    const before = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(before.paid, '200')
    assert.equal(before.balance, '800')
    assert.equal((before.payments as Row[]).length, 2)
    const currentVersion = await version()
    const excess = await value(
      'hospitality_billing.recordFolioPayment',
      {
        ...firstInput,
        id: 'too-much',
        amount: '801',
        expectedVersion: currentVersion,
        requestKey: 'advance-overpay-request',
      },
      adapter,
    )
    assert.equal(excess.ok, false)
    assert.equal(await version(), currentVersion, 'a rejected payment must roll back its version claim')
    await rule('room', 'vat8', adapter)
    const invoiceInput = {
      folioId,
      expectedVersion: currentVersion,
      requestKey: 'advance-invoice-request',
      buyerType: 'company',
      buyerName: 'Synthetic buyer',
      buyerTaxCode: '0123456789',
      buyerAddress: 'Synthetic address',
      buyerEmail: 'buyer@example.invalid',
    }
    const invoice = await value('hospitality_billing.invoiceFolio', invoiceInput, adapter)
    assert.equal(invoice.ok, true, JSON.stringify(invoice.errors))
    assert.deepEqual(await value('hospitality_billing.invoiceFolio', invoiceInput, adapter), invoice)
    const after = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(after.amountDue, '880', '200 in advances settle an actual 1080 invoice, including its tax')
    assert.equal(after.paymentState, 'partial')
    assert.equal((after.buyer as Row).name, 'Synthetic buyer')
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 2)
    assert.equal(
      (
        await callFn(
          'hospitality_billing.getFolioBilling',
          { folioId },
          { adapter, manifest, scope: { company: 'acme', branches: ['unselected-branch'] } },
        )
      ).value,
      null,
    )
    const retargeted = await value(
      'hospitality_billing.recordFolioPayment',
      { ...firstInput, amount: '101' },
      adapter,
    )
    assert.equal((retargeted.errors as Row[])[0]?.code, 'request_reused')
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: a closed folio becomes one posted invoice, however often it is asked', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)

    const invoiced = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(invoiced.ok, true, JSON.stringify(invoiced.errors))

    const move = (
      await adapter.all(
        'SELECT id, state, "amountUntaxed", "amountTax", "amountTotal", name FROM account_move',
      )
    )[0]!
    assert.equal(move.state, 'posted')
    // Two nights at 500, at 8% — the room charges the stay itself posted.
    assert.equal(Number(move.amountUntaxed), 1000)
    assert.equal(Number(move.amountTax), 80)
    assert.equal(Number(move.amountTotal), 1080)
    assert.equal(String(move.name), 'SAL/2026/00001')

    const lines = await adapter.all('SELECT id, debit, credit FROM account_move_line ORDER BY sequence, id')
    assert.equal(
      lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0),
      0,
    )

    // The desk presses it again, the sweep runs, a request is retried. One
    // guest, one invoice.
    const again = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(again.ok, true)
    assert.equal(again.moveId, invoiced.moveId)
    assert.equal((await adapter.all('SELECT id FROM account_move')).length, 1)
    assert.equal((await adapter.all('SELECT id FROM hospitality_billing_folio_bill')).length, 1)
  } finally {
    await adapter.close()
  }
})

test('Hospitality folio register dues follow the posted invoice, its reversal and the reader scope', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)
    const dues = async (ids: unknown, reader: { company: string; branches: string[] | null } = scope) =>
      (
        (await callFn('hospitality_billing.getFolioDues', { ids }, { adapter, manifest, scope: reader }))
          .value as {
          rows: Row[]
        }
      ).rows
    // Before its invoice the folio owes its charges; one that is not there is unknown, never zero.
    assert.deepEqual(await dues([folioId, 'missing']), [
      { id: folioId, due: '1000', currency: 'VND', known: true, invoice: null },
      { id: 'missing', due: null, currency: null, known: false, invoice: null },
    ])
    const invoiced = await fixtureWrite('hospitality_billing.invoiceFolio', { folioId }, adapter)
    const posted = { name: 'SAL/2026/00001', status: 'posted' }
    assert.deepEqual(await dues([folioId]), [
      { id: folioId, due: '1080', currency: 'VND', known: true, invoice: posted },
    ])
    // A reader outside the property's branches learns nothing, not even the invoice.
    assert.deepEqual(await dues([folioId], { company: 'acme', branches: [] }), [
      { id: folioId, due: null, currency: null, known: false, invoice: null },
    ])
    // A reversed invoice keeps its number, cancelled, and the due is unknown rather than paid.
    await fixtureWrite(
      'account.reverseMove',
      { id: invoiced.moveId, reversalId: 'register-reversal', reason: 'Synthetic correction' },
      adapter,
    )
    assert.deepEqual(await dues([folioId]), [
      { id: folioId, due: null, currency: null, known: false, invoice: { ...posted, status: 'void' } },
    ])
    // A draft entry reads as not posted.
    await adapter.run('UPDATE account_move SET state = ?, "reversedById" = NULL WHERE id = ?', [
      'draft',
      invoiced.moveId,
    ])
    assert.deepEqual((await dues([folioId]))[0]!.invoice, { ...posted, status: 'draft' })
    for (const ids of [null, 'x', [1], Array.from({ length: 101 }, (_, index) => `f${index}`)])
      await assert.rejects(() =>
        callFn('hospitality_billing.getFolioDues', { ids }, { adapter, manifest, scope }),
      )
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: folio charges remain exact beyond JavaScript safe integers', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)
    await rule('minibar', null, adapter)

    await adapter.run(`UPDATE hospitality_core_folio SET state = 'open' WHERE id = ?`, [folioId])
    const charged = await value(
      'hospitality_core.addCharge',
      {
        id: 'large-minibar',
        folioId,
        description: 'Large exact charge',
        type: 'minibar',
        productId: 'water',
        uomId: 'unit',
        fulfillmentKind: 'external_stock',
        quantity: '1',
        unitPrice: '9007199254740993',
      },
      adapter,
    )
    assert.equal(charged.ok, true, JSON.stringify(charged.errors))
    assert.equal(charged.amount, '9007199254740993')
    const folio = (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio'))[0]!
    assert.equal(String(folio.amountTotal), '9007199254741993')
    await adapter.run(`UPDATE hospitality_core_folio SET state = 'closed' WHERE id = ?`, [folioId])

    const invoiced = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(invoiced.ok, true, JSON.stringify(invoiced.errors))
    const move = (
      await adapter.all('SELECT "amountUntaxed", "amountTax", "amountTotal" FROM account_move')
    )[0]!
    assert.equal(String(move.amountUntaxed), '9007199254741993')
    assert.equal(String(move.amountTax), '80')
    assert.equal(String(move.amountTotal), '9007199254742073')

    const lines = await adapter.all('SELECT debit, credit FROM account_move_line')
    const balance = lines.reduce(
      (sum, line) => sum + BigInt(String(line.debit)) - BigInt(String(line.credit)),
      0n,
    )
    assert.equal(balance, 0n)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: a charge nobody has classified is refused, not filed as untaxed', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)
    // Reopening is not on offer, so the minibar arrives on the folio the way a
    // late charge does: through the same call the bar uses, before billing.
    await adapter.run(`UPDATE hospitality_core_folio SET state = 'open' WHERE id = ?`, [folioId])
    await call(
      'hospitality_core.addCharge',
      {
        id: 'minibar-1',
        folioId,
        description: 'Minibar',
        type: 'minibar',
        productId: 'water',
        uomId: 'unit',
        fulfillmentKind: 'external_stock',
        quantity: '2',
        unitPrice: '50',
      },
      adapter,
    )
    await adapter.run(`UPDATE hospitality_core_folio SET state = 'closed' WHERE id = ?`, [folioId])

    // Sending this with no tax on it would tell the tax authority the minibar is
    // not subject to VAT. That is a claim about the sale, and nobody made it.
    const refused = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(refused.ok, false)
    const first = (refused.errors as Row[])[0]!
    assert.equal(first.code, 'charge_rule_missing')
    assert.deepEqual(first.params, { type: 'minibar' })
    assert.equal((await adapter.all('SELECT id FROM account_move')).length, 0)

    // And the screen can say which decision is missing before anyone presses it.
    const billing = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.deepEqual(billing.missingRules, ['minibar'])

    await rule('minibar', 'vat10', adapter)
    const invoiced = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(invoiced.ok, true, JSON.stringify(invoiced.errors))
    const move = (await adapter.all('SELECT "amountUntaxed", "amountTax" FROM account_move'))[0]!
    // 1000 of room at 8% and 100 of minibar at 10%, each at its own rate.
    assert.equal(Number(move.amountUntaxed), 1100)
    assert.equal(Number(move.amountTax), 90)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: money taken against a folio settles its invoice', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)
    await value('hospitality_billing.invoiceFolio', { folioId }, adapter)

    const owed = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(Number(owed.amountDue), 1080)
    assert.equal(owed.paymentState, 'not_paid')

    // Half at the desk, half prepaid through a channel weeks earlier: the same
    // event seen at two different times, settling the same receivable.
    const part = await value(
      'hospitality_billing.recordFolioPayment',
      { id: 'pay-1', folioId, amount: '80', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(part.ok, true, JSON.stringify(part.errors))
    const partly = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(Number(partly.amountDue), 1000)
    assert.equal(partly.paymentState, 'partial')

    const rest = await value(
      'hospitality_billing.recordFolioPayment',
      { id: 'pay-2', folioId, amount: '1000', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(rest.ok, true, JSON.stringify(rest.errors))
    const settled = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(Number(settled.amountDue), 0)
    assert.equal(settled.paymentState, 'paid')

    // The channel retries its prepayment notice. The receivable is already
    // settled and must not be settled twice.
    const retried = await value(
      'hospitality_billing.recordFolioPayment',
      { id: 'pay-2', folioId, amount: '1000', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(retried.ok, true)
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 2)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: an open folio is not invoiced, because it can still take charges', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.createReservation',
      {
        id: 'r1',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        bookingType: 'nightly',
        checkIn: `${arrivalDay}T14:00:00.000Z`,
        checkOut: `${departureDay}T12:00:00.000Z`,
        rate: '500',
      },
      adapter,
    )
    const folioId = String((await adapter.all('SELECT id FROM hospitality_core_folio'))[0]!.id)
    await rule('room', 'vat8', adapter)

    const refused = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]!.code, 'folio_not_closed')
    const readiness = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.deepEqual(
      (readiness.blockers as Row[]).map((blocker) => blocker.code),
      ['folio_open'],
    )
    assert.equal((await adapter.all('SELECT id FROM account_move')).length, 0)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: readiness reports every repairable invoice blocker without provider data', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await adapter.run('DELETE FROM hospitality_core_charge WHERE "folioId" = ?', [folioId])
    await adapter.run('UPDATE hospitality_core_folio SET "amountTotal" = 0 WHERE id = ?', [folioId])
    await adapter.run("DELETE FROM account_journal WHERE type = 'sale'")

    const readiness = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.deepEqual(
      (readiness.blockers as Row[]).map((blocker) => blocker.code),
      ['folio_without_charges', 'journal_missing'],
    )
    assert.equal(JSON.stringify(readiness).includes('Nguyễn An'), false)
  } finally {
    await adapter.close()
  }
})

test('Hospitality charge rules require an explicit exemption reason and preserve versioned, replay-safe history', async () => {
  const adapter = await boot()
  const run = async (args: Record<string, unknown>) =>
    (await call('hospitality_billing.saveChargeRule', args, adapter)).value as Row
  const codes = (r: Row) => ((r.errors as Row[]) ?? []).map((e) => e.code)
  try {
    const input = {
      chargeType: 'service',
      incomeAccountId: 'revenue',
      taxExempt: true,
      expectedVersion: 0,
      requestKey: 'rule-create-exempt',
    }
    assert.ok(codes(await run(input)).includes('tax_exempt_reason'))
    const saved = await run({ ...input, taxExemptReason: 'Approved exempt service policy' })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(await run({ ...input, taxExemptReason: 'Approved exempt service policy' }), saved)
    assert.ok(
      codes(await run({ ...input, taxExemptReason: 'A different policy' })).includes('request_reused'),
    )
    const first = (await value('hospitality_billing.getChargeRuleRecord', { id: 'service' }, adapter))
      .record as Row
    assert.equal(first.version, 1)
    assert.equal((first.history as Row[]).length, 1)
    assert.equal(
      (
        await run({
          ...input,
          expectedVersion: 1,
          taxExemptReason: 'Updated approved policy',
          requestKey: 'rule-update-exempt',
        })
      ).ok,
      true,
    )
    assert.ok(
      codes(
        await run({
          ...input,
          expectedVersion: 1,
          taxExemptReason: 'Stale overwritten policy',
          requestKey: 'rule-stale-update',
        }),
      ).includes('transition_conflict'),
    )
    const latest = (await value('hospitality_billing.getChargeRuleRecord', { id: 'service' }, adapter))
      .record as Row
    assert.equal(latest.taxExemptReason, 'Updated approved policy')
    assert.equal(latest.version, 2)
    assert.equal((latest.history as Row[]).length, 2)
    const other = await callFn(
      'hospitality_billing.getChargeRuleRecord',
      { id: latest.id },
      { adapter, manifest, scope: { company: 'other', branches: null } },
    )
    assert.equal((other.value as Row).record, null)
  } finally {
    await adapter.close()
  }
})

test('Hospitality payments refuse unknown invoice balances and sub-currency amounts without leaving money or version writes', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    const current = (await value('hospitality_core.getFolio', { id: folioId }, adapter)).version
    const fractional = await value(
      'hospitality_billing.recordFolioPayment',
      {
        id: 'fractional-money',
        folioId,
        journalId: 'cash-journal',
        amount: '10.1',
        expectedVersion: current,
        requestKey: 'fractional-vnd-payment',
      },
      adapter,
    )
    assert.equal(fractional.ok, false)
    assert.equal((fractional.errors as Row[])[0]?.code, 'payment_amount')
    assert.equal((await value('hospitality_core.getFolio', { id: folioId }, adapter)).version, current)
    await rule('room', 'vat8', adapter)
    const invoiced = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(invoiced.ok, true)
    await adapter.run('DELETE FROM account_move_line WHERE id = ?', [`${invoiced.moveId}:counterpart`])
    const unknown = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(unknown.balanceKnown, false)
    const version = (await value('hospitality_core.getFolio', { id: folioId }, adapter)).version
    const refused = await value(
      'hospitality_billing.recordFolioPayment',
      {
        id: 'unknown-due-payment',
        folioId,
        journalId: 'cash-journal',
        amount: '100',
        expectedVersion: version,
        requestKey: 'unknown-invoice-balance-payment',
      },
      adapter,
    )
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]?.code, 'invoice_balance_unavailable')
    assert.equal((await value('hospitality_core.getFolio', { id: folioId }, adapter)).version, version)
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 0)
  } finally {
    await adapter.close()
  }
})

test('Hospitality financial posting defaults to the open business day and rejects a closed accounting day', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    const openDay = addCalendarDays(arrivalDay, 1)
    await adapter.run('UPDATE hospitality_core_property SET "businessDate" = ? WHERE id = ?', [
      openDay,
      'hotel',
    ])
    await rule('room', 'vat8', adapter)
    const oldDay = await value(
      'hospitality_billing.invoiceFolio',
      { folioId, accountingDate: arrivalDay, requestKey: 'closed-accounting-day' },
      adapter,
    )
    assert.equal(oldDay.ok, false)
    assert.equal((oldDay.errors as Row[])[0]?.code, 'business_date_locked')
    const invoice = await value(
      'hospitality_billing.invoiceFolio',
      { folioId, requestKey: 'open-business-day-invoice' },
      adapter,
    )
    assert.equal(invoice.ok, true, JSON.stringify(invoice.errors))
    assert.equal(
      (await adapter.all('SELECT "accountingDate" FROM account_move WHERE id = ?', [invoice.moveId]))[0]
        ?.accountingDate,
      openDay,
    )
    const payment = await value(
      'hospitality_billing.recordFolioPayment',
      {
        id: 'open-day-payment',
        folioId,
        journalId: 'cash-journal',
        amount: '100',
        requestKey: 'open-business-day-payment',
      },
      adapter,
    )
    assert.equal(payment.ok, true, JSON.stringify(payment.errors))
    const posted = await adapter.all('SELECT "accountingDate" FROM account_move WHERE id != ?', [
      invoice.moveId,
    ])
    assert.equal(posted.length, 1)
    assert.equal(posted[0]?.accountingDate, openDay)
  } finally {
    await adapter.close()
  }
})

test('Hospitality folio workspace pages payment evidence and preserves full ledger totals and property scope', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    for (let index = 0; index < 101; index++) {
      const folio = await value('hospitality_core.getFolioWorkspace', { id: folioId }, adapter)
      const result = await value(
        'hospitality_billing.recordFolioPayment',
        {
          id: `page-payment-${index}`,
          folioId,
          amount: '1',
          journalId: 'cash-journal',
          expectedVersion: (folio.record as Row).version,
          requestKey: `page-payment-request-${index}`,
        },
        adapter,
      )
      assert.equal(result.ok, true, JSON.stringify(result.errors))
    }
    const read = async (page: number) =>
      (await value('hospitality_billing.getFolioFinanceWorkspace', { folioId, page }, adapter)).record as Row
    const first = await read(1),
      last = await read(999)
    assert.equal(first.paid, '101')
    assert.equal(first.balance, '899')
    assert.equal((first.payments as Row).total, 101)
    assert.equal(((first.payments as Row).rows as Row[]).length, 20)
    assert.equal((last.payments as Row).page, 6)
    assert.equal(((last.payments as Row).rows as Row[]).length, 1)
    assert.equal(last.balance, first.balance)
    assert.ok((first.blockers as Row[]).some((blocker) => blocker.code === 'charge_rule_missing'))
    const selected = (
      await call('hospitality_billing.lookupFolioJournals', { folioId, search: 'CSH', limit: 1 }, adapter)
    ).value as Row[]
    assert.equal(selected.length, 1)
    assert.equal(selected[0]?.id, 'cash-journal')
    for (const selectedScope of [
      { company: 'other', branches: null },
      { company: 'acme', branches: ['unselected-branch'] },
    ]) {
      assert.deepEqual(
        (
          await callFn(
            'hospitality_billing.getFolioFinanceWorkspace',
            { folioId },
            { adapter, manifest, scope: selectedScope },
          )
        ).value,
        { record: null },
      )
      assert.deepEqual(
        (
          await callFn(
            'hospitality_core.getFolioWorkspace',
            { id: folioId },
            { adapter, manifest, scope: selectedScope },
          )
        ).value,
        { record: null },
      )
    }
    const payment = (
      await adapter.all('SELECT "moveId" FROM account_payment WHERE id = ?', ['page-payment-0'])
    )[0]!
    await adapter.run('UPDATE account_move SET "reversedById" = ? WHERE id = ?', [
      'synthetic-reversal-evidence',
      payment.moveId,
    ])
    const reversed = await read(1)
    assert.equal(reversed.paid, '100')
    assert.equal(reversed.balance, '900')
  } finally {
    await adapter.close()
  }
})

test('Hospitality manual fee types post without accounting rules and block invoicing until configured', async () => {
  const adapter = await boot()
  try {
    await fixtureWrite(
      'hospitality_core.createReservation',
      {
        id: 'manual-rules',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        bookingType: 'nightly',
        checkIn: `${arrivalDay}T14:00:00.000Z`,
        checkOut: `${departureDay}T12:00:00.000Z`,
        rate: '500',
      },
      adapter,
    )
    const folioId = 'manual-rules:folio'
    for (const type of ['laundry', 'transfer', 'late_checkout']) {
      const folio = (await value('hospitality_core.getFolioWorkspace', { id: folioId }, adapter))
        .record as Row
      const posted = await value(
        'hospitality_core.postFolioServiceCharge',
        {
          folioId,
          type,
          description: `Synthetic ${type} service`,
          quantity: '1',
          unitPrice: '100',
          expectedVersion: folio.version,
          requestKey: `unconfigured-fee-${type}`,
        },
        adapter,
      )
      assert.equal(posted.ok, true, JSON.stringify(posted))
    }
    await adapter.run('UPDATE hospitality_core_folio SET state = ? WHERE id = ?', ['closed', folioId])
    const finance = (await value('hospitality_billing.getFolioFinanceWorkspace', { folioId }, adapter))
      .record as Row
    const missing = (finance.blockers as Row[]).find((item) => item.code === 'charge_rule_missing')!
    assert.deepEqual(((missing.params as Row).types as string[]).sort(), [
      'late_checkout',
      'laundry',
      'room',
      'transfer',
    ])
    const blocked = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(blocked.ok, false)
    for (const type of ['room', 'laundry', 'transfer', 'late_checkout'])
      assert.equal(((await rule(type, null, adapter)).value as Row).ok, true)
    const ready = (await value('hospitality_billing.getFolioFinanceWorkspace', { folioId }, adapter))
      .record as Row
    assert.equal((ready.blockers as Row[]).length, 0)
    assert.equal((await value('hospitality_billing.invoiceFolio', { folioId }, adapter)).ok, true)
  } finally {
    await adapter.close()
  }
})

test('Hospitality desk intake confirms a real quote, rejects changed terms and rolls back guest and deposit on failure', async () => {
  const adapter = await boot()
  try {
    const search = {
      propertyId: 'hotel',
      arrival: addCalendarDays(arrivalDay, 1),
      departure: addCalendarDays(arrivalDay, 3),
      adults: 1,
      children: 0,
    }
    const quoted = await value(
      'hospitality_core.getDeskBookingQuote',
      { ...search, ratePlanId: 'billing-rate' },
      adapter,
    )
    assert.equal(quoted.ok, true, JSON.stringify(quoted))
    const quote = quoted.quote as Row
    const input = {
      ...search,
      ratePlanId: 'billing-rate',
      expectedAmountTotal: quote.amountTotal,
      expectedRateVersion: quote.rateVersion,
      quoteFingerprint: quote.fingerprint,
      guestName: 'Synthetic desk guest',
      phone: '0901234567',
      kind: 'collect',
      amount: '500',
      journalId: 'missing-journal',
      requestKey: 'desk-intake-confirmation',
    }
    const failed = await value('hospitality_billing.confirmDeskBooking', input, adapter)
    assert.equal(failed.ok, false)
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_reservation')).length, 0)
    assert.equal(
      (await adapter.all('SELECT id FROM partner_partner WHERE name = ?', [input.guestName])).length,
      0,
    )
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 0)
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_command_receipt WHERE "requestKey" = ?', [
          input.requestKey,
        ])
      ).length,
      0,
    )
    const changed = await value(
      'hospitality_billing.confirmDeskBooking',
      { ...input, quoteFingerprint: 'changed', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal((changed.errors as Row[])[0]!.code, 'booking_quote_changed')
    const saved = await value(
      'hospitality_billing.confirmDeskBooking',
      { ...input, journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(
      await value('hospitality_billing.confirmDeskBooking', { ...input, journalId: 'cash-journal' }, adapter),
      saved,
    )
    const booking = (
      await adapter.all('SELECT * FROM hospitality_core_reservation WHERE id = ?', [saved.id])
    )[0]!
    assert.equal(booking.ratePlanId, 'billing-rate')
    assert.equal(booking.contactPhone, '+84901234567')
    assert.equal(booking.guaranteeKind, 'deposit')
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 1)
    const finance = (
      await value('hospitality_billing.getFolioFinanceWorkspace', { folioId: saved.folioId }, adapter)
    ).record as Row
    assert.equal(finance.paid, '500')
    assert.equal(finance.balance, '500')
    const newSearch = {
      ...search,
      arrival: addCalendarDays(arrivalDay, 5),
      departure: addCalendarDays(arrivalDay, 7),
    }
    const secondQuote = (
      await value(
        'hospitality_core.getDeskBookingQuote',
        { ...newSearch, ratePlanId: 'billing-rate' },
        adapter,
      )
    ).quote as Row
    const duplicate = await value(
      'hospitality_billing.confirmDeskBooking',
      {
        ...input,
        ...newSearch,
        kind: 'none',
        expectedAmountTotal: secondQuote.amountTotal,
        expectedRateVersion: secondQuote.rateVersion,
        quoteFingerprint: secondQuote.fingerprint,
        requestKey: 'desk-duplicate-phone',
      },
      adapter,
    )
    assert.equal((duplicate.errors as Row[])[0]!.code, 'desk_guest_duplicate')
    const existing = await value(
      'hospitality_billing.confirmDeskBooking',
      {
        ...input,
        ...newSearch,
        kind: 'none',
        partnerId: booking.partnerId,
        expectedAmountTotal: secondQuote.amountTotal,
        expectedRateVersion: secondQuote.rateVersion,
        quoteFingerprint: secondQuote.fingerprint,
        requestKey: 'desk-existing-guest',
      },
      adapter,
    )
    assert.equal(existing.ok, true, JSON.stringify(existing))
    const unguaranteed = (
      await adapter.all('SELECT * FROM hospitality_core_reservation WHERE id = ?', [existing.id])
    )[0]!
    assert.equal(unguaranteed.unsecuredHold, 1)
    assert.ok(String(unguaranteed.auditHoldUntil).endsWith('T11:00:00.000Z'))
    const secured = await value(
      'hospitality_billing.setReservationGuarantee',
      {
        reservationId: existing.id,
        kind: 'card',
        amount: '1000',
        reference: 'authorization:desk',
        expectedVersion: unguaranteed.version,
        requestKey: 'secure-initial-desk-hold',
      },
      adapter,
    )
    assert.equal(secured.ok, true)
    assert.equal(
      (
        await adapter.all('SELECT "auditHoldUntil" FROM hospitality_core_reservation WHERE id = ?', [
          existing.id,
        ])
      )[0]!.auditHoldUntil,
      null,
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality desk offers apply lead time, selected policy, date and capacity limits before writing', async () => {
  const adapter = await boot()
  try {
    const search = {
      propertyId: 'hotel',
      arrival: addCalendarDays(arrivalDay, 2),
      departure: addCalendarDays(arrivalDay, 4),
      adults: 1,
      children: 0,
    }
    for (const [patch, field] of [
      [{ arrival: addCalendarDays(arrivalDay, -1) }, 'arrival'],
      [{ arrival: addCalendarDays(arrivalDay, 366), departure: addCalendarDays(arrivalDay, 367) }, 'arrival'],
      [{ departure: addCalendarDays(arrivalDay, 40) }, 'departure'],
      [{ adults: 9 }, 'adults'],
      [{ children: 7 }, 'children'],
      [{ arrival: '2026-02-30' }, 'arrival'],
    ] as [Row, string][]) {
      const result = await value('hospitality_core.searchDeskOffers', { ...search, ...patch }, adapter)
      assert.equal(result.ok, false)
      assert.equal((result.errors as Row[])[0]!.field, field)
    }
    const property = await value('hospitality_core.getProperty', { id: 'hotel' }, adapter)
    await fixtureWrite(
      'hospitality_core.saveCancellationPolicy',
      {
        id: 'desk-nonref',
        code: 'DSKNR',
        name: 'Desk non refundable',
        type: 'non_refundable',
        freeCancellationHours: 0,
        penaltyPercent: '100',
      },
      adapter,
    )
    await fixtureWrite(
      'hospitality_core.saveRatePlan',
      {
        id: 'advance-rate',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: 'ADV',
        name: 'Advance non refundable',
        rateType: 'nightly',
        amount: '400',
        minAdvanceDays: 21,
        cancellationPolicyId: 'desk-nonref',
        expectedPropertyVersion: property.version,
        expectedVersion: 0,
        requestKey: 'desk-advance-rate',
      },
      adapter,
    )
    const early = await value(
      'hospitality_core.getDeskBookingQuote',
      { ...search, ratePlanId: 'advance-rate' },
      adapter,
    )
    assert.equal(early.ok, false)
    assert.ok((early.errors as Row[]).some((error) => error.code === 'rate_plan_advance'))
    const future = {
      ...search,
      arrival: addCalendarDays(arrivalDay, 22),
      departure: addCalendarDays(arrivalDay, 24),
    }
    const quote = (
      await value('hospitality_core.getDeskBookingQuote', { ...future, ratePlanId: 'advance-rate' }, adapter)
    ).quote as Row
    assert.equal(quote.amountTotal, '800')
    assert.equal(quote.cancellationPolicyType, 'non_refundable')
    const input = {
      ...future,
      ratePlanId: 'advance-rate',
      expectedAmountTotal: quote.amountTotal,
      expectedRateVersion: quote.rateVersion,
      quoteFingerprint: quote.fingerprint,
      guestName: 'Synthetic prepaid guest',
      email: 'prepaid@example.invalid',
      requestKey: 'desk-nonref-intake',
      kind: 'none',
    }
    const unsecured = await value('hospitality_billing.confirmDeskBooking', input, adapter)
    assert.equal((unsecured.errors as Row[])[0]!.code, 'desk_booking_prepay')
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_reservation')).length, 0)
    const paid = await value(
      'hospitality_billing.confirmDeskBooking',
      { ...input, kind: 'collect', amount: '800', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(paid.ok, true, JSON.stringify(paid))
    const booking = (
      await adapter.all('SELECT * FROM hospitality_core_reservation WHERE id = ?', [paid.id])
    )[0]!
    assert.equal(booking.cancellationPolicyId, 'desk-nonref')
    assert.equal(booking.cancellationPolicyType, 'non_refundable')
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_reservation')).length, 1)
  } finally {
    await adapter.close()
  }
})

test('Hospitality desk walk-in rolls back identity and money on room conflict, then receives a guaranteed guest exactly once', async () => {
  const adapter = await boot()
  try {
    const search = {
      propertyId: 'hotel',
      arrival: arrivalDay,
      departure: departureDay,
      adults: 1,
      children: 0,
      walkIn: true,
      ratePlanId: 'billing-rate',
    }
    const quote = (await value('hospitality_core.getDeskBookingQuote', search, adapter)).quote as Row
    assert.ok(quote)
    const input = {
      ...search,
      quoteFingerprint: quote.fingerprint,
      expectedAmountTotal: quote.amountTotal,
      expectedRateVersion: quote.rateVersion,
      requestKey: 'desk-walk-in',
      guestName: 'Synthetic walking guest',
      kind: 'collect',
      amount: '500',
      journalId: 'cash-journal',
      roomId: '101',
      keys: 2,
      earlyFee: 'waived',
      earlyReason: 'Synthetic early waiver',
      guests: [
        {
          fullName: 'Synthetic walking guest',
          nationality: 'VN',
          type: 'passport',
          number: 'WALK1234',
          birth: '1990-01-01',
          gender: 'female',
        },
      ],
    }
    const insufficient = await value(
      'hospitality_billing.confirmDeskBooking',
      { ...input, amount: '499' },
      adapter,
    )
    assert.equal((insufficient.errors as Row[])[0]!.code, 'desk_walk_in_deposit')
    const invalidIdentity = await value(
      'hospitality_billing.confirmDeskBooking',
      { ...input, guests: [] },
      adapter,
    )
    assert.equal((invalidIdentity.errors as Row[])[0]!.code, 'arrival_guest_count')
    await adapter.all('UPDATE hospitality_core_room SET status = ? WHERE id = ?', ['dirty', '101'])
    const failed = await value('hospitality_billing.confirmDeskBooking', input, adapter)
    assert.equal(failed.ok, false)
    for (const table of [
      'hospitality_core_reservation',
      'hospitality_core_guest_document',
      'account_payment',
    ])
      assert.equal((await adapter.all(`SELECT id FROM ${table}`)).length, 0, table)
    assert.equal(
      (await adapter.all('SELECT id FROM partner_partner WHERE name = ?', [input.guestName])).length,
      0,
    )
    assert.deepEqual((await call('hospitality_core.lookupDeskRooms', search, adapter)).value, [])
    await adapter.all('UPDATE hospitality_core_room SET status = ? WHERE id = ?', ['available', '101'])
    const saved = await value('hospitality_billing.confirmDeskBooking', input, adapter)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(await value('hospitality_billing.confirmDeskBooking', input, adapter), saved)
    const booking = (
      await adapter.all('SELECT * FROM hospitality_core_reservation WHERE id = ?', [saved.id])
    )[0]!
    assert.equal(booking.provider, 'walk_in')
    const stay = (await adapter.all('SELECT * FROM hospitality_core_stay WHERE id = ?', [saved.stayId]))[0]!
    assert.equal(stay.state, 'checked_in')
    assert.equal(stay.currentRoomId, '101')
    assert.equal(stay.issuedKeys, 2)
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 1)
    assert.equal((await adapter.all('SELECT id FROM hospitality_core_guest_document')).length, 1)
  } finally {
    await adapter.close()
  }
})

test('Hospitality desk search pages tied offers and rejects another company or excessive room capacity', async () => {
  const adapter = await boot()
  try {
    const search = {
      propertyId: 'hotel',
      arrival: addCalendarDays(arrivalDay, 1),
      departure: departureDay,
      adults: 1,
      children: 0,
    }
    for (let index = 0; index < 13; index++)
      await fixtureWrite(
        'hospitality_core.saveRatePlan',
        {
          id: `desk-rate-${String(index).padStart(2, '0')}`,
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          code: `D${index}`,
          name: 'Same rate label',
          rateType: 'nightly',
          amount: '500',
        },
        adapter,
      )
    const first = await value('hospitality_core.searchDeskOffers', search, adapter),
      second = await value('hospitality_core.searchDeskOffers', { ...search, page: 2 }, adapter)
    assert.equal(first.total, 14)
    assert.equal((first.rows as Row[]).length, 12)
    assert.equal((second.rows as Row[]).length, 2)
    const ids = [...(first.rows as Row[]), ...(second.rows as Row[])].map((item) => item.id)
    assert.equal(new Set(ids).size, 14)
    assert.ok((first.rows as Row[]).every((item) => item.canBook))
    const capacity = await value(
      'hospitality_core.getDeskBookingQuote',
      { ...search, adults: 8, ratePlanId: 'billing-rate' },
      adapter,
    )
    assert.equal((capacity.errors as Row[])[0]!.code, 'desk_booking_capacity')
    const outside = (
      await callFn('hospitality_core.searchDeskOffers', search, {
        adapter,
        manifest,
        scope: { company: 'outside', branches: null },
      })
    ).value as Row
    assert.equal(outside.ok, false)
    assert.equal(outside.rows, undefined)
  } finally {
    await adapter.close()
  }
})

test('Hospitality walk-in availability counts clean rooms beyond the first batch and excludes a held room', async () => {
  const adapter = await boot()
  try {
    for (let index = 0; index < 55; index++)
      await fixtureWrite(
        'hospitality_core.saveRoom',
        {
          id: `ready-${index}`,
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          code: `R${index}`,
          name: `Room ${String(index).padStart(2, '0')}`,
        },
        adapter,
      )
    // Isolated read fixture: housekeeping transitions have dedicated command tests.
    await adapter.run('UPDATE hospitality_core_room SET status = ? WHERE "companyId" = ?', [
      'available',
      'acme',
    ])
    await adapter.run('UPDATE hospitality_core_room SET status = ? WHERE id IN (?, ?)', [
      'dirty',
      'ready-0',
      'ready-1',
    ])
    const search = {
      propertyId: 'hotel',
      arrival: arrivalDay,
      departure: departureDay,
      adults: 1,
      children: 0,
      walkIn: true,
    }
    const before = await value('hospitality_core.searchDeskOffers', search, adapter)
    assert.equal((before.rows as Row[])[0]!.available, 54)
    await fixtureWrite(
      'hospitality_core.createReservation',
      {
        id: 'desk-held',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        checkIn: `${arrivalDay}T07:00:00Z`,
        checkOut: `${departureDay}T05:00:00Z`,
      },
      adapter,
    )
    await fixtureWrite('hospitality_core.holdRoom', { stayId: 'desk-held:stay', roomId: '101' }, adapter)
    const after = await value('hospitality_core.searchDeskOffers', search, adapter)
    assert.equal((after.rows as Row[])[0]!.available, 53)
    const selected = (
      await call(
        'hospitality_core.lookupDeskRooms',
        { ...search, ratePlanId: 'billing-rate', id: '101' },
        adapter,
      )
    ).value
    assert.deepEqual(selected, [])
    await adapter.run('UPDATE hospitality_core_room SET status = ? WHERE "companyId" = ?', ['dirty', 'acme'])
    const none = await value('hospitality_core.searchDeskOffers', search, adapter)
    assert.equal((none.rows as Row[])[0]!.available, 0)
    assert.equal((none.rows as Row[])[0]!.canBook, false)
  } finally {
    await adapter.close()
  }
})

test('Hospitality cancellation review agrees with the posted fee, rejects stale amounts and replays without a second charge', async () => {
  const adapter = await boot()
  try {
    await fixtureWrite(
      'hospitality_core.saveCancellationPolicy',
      {
        id: 'review-policy',
        code: 'REVIEW',
        name: 'Reviewed cancellation',
        type: 'strict',
        freeCancellationHours: 100000,
        penaltyPercent: '50',
      },
      adapter,
    )
    await adapter.run('UPDATE hospitality_core_room_type SET "cancellationPolicyId" = ? WHERE id = ?', [
      'review-policy',
      'deluxe',
    ])
    await fixtureWrite(
      'hospitality_core.createReservation',
      {
        id: 'cancel-reviewed',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        bookingType: 'nightly',
        checkIn: `${arrivalDay}T00:01:00.000Z`,
        checkOut: `${departureDay}T00:01:00.000Z`,
        rate: '500',
      },
      adapter,
    )
    const workspace = (
      await value('hospitality_core.getReservationWorkspace', { id: 'cancel-reviewed' }, adapter)
    ).record as Row
    assert.equal((workspace.cancellationReview as Row).fee, '500')
    assert.equal(
      (workspace.cancellationReview as Row).noShowFee,
      '0',
      'unguaranteed no-show does not charge an unearned penalty',
    )
    const command = {
      id: 'cancel-reviewed',
      expectedVersion: workspace.version,
      reason: 'Synthetic guest changed plans',
      expectedCancellationFee: '499',
      requestKey: 'cancel-reviewed-request',
    }
    const rejected = await value('hospitality_core.cancelReservation', command, adapter)
    assert.equal(rejected.ok, false)
    assert.equal((rejected.errors as Row[])[0]?.code, 'cancellation_review_changed')
    const unchanged = (
      await adapter.all('SELECT state, version FROM hospitality_core_reservation WHERE id = ?', [command.id])
    )[0]!
    assert.equal(unchanged.state, 'confirmed')
    assert.equal(unchanged.version, workspace.version)
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_command_receipt WHERE "requestKey" = ?', [
          command.requestKey,
        ])
      ).length,
      0,
    )
    const accepted = { ...command, expectedCancellationFee: '500' }
    const saved = await value('hospitality_core.cancelReservation', accepted, adapter)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(saved.cancellationFee, '500')
    assert.deepEqual(await value('hospitality_core.cancelReservation', accepted, adapter), saved)
    const fees = await adapter.all(
      'SELECT amount FROM hospitality_core_charge WHERE "folioId" = ? AND "type" = ?',
      ['cancel-reviewed:folio', 'cancellation'],
    )
    assert.equal(fees.length, 1)
    assert.equal(fees[0]?.amount, '500')
  } finally {
    await adapter.close()
  }
})

test('Hospitality no-show review includes every retained night across pages and rejects a changed total', async () => {
  const adapter = await boot()
  try {
    const checkIn = new Date(Date.now() - 60000).toISOString()
    await fixtureWrite(
      'hospitality_core.createReservation',
      {
        id: 'held-review',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        bookingType: 'nightly',
        checkIn,
        checkOut: `${departureDay}T23:59:00.000Z`,
        rate: '500',
      },
      adapter,
    )
    await adapter.run(
      'INSERT INTO hospitality_core_night_audit_run (id, "companyId", "propertyId", "auditDate", state, "inHouseCount", "servicePosted", "rentPosted", "existingCount", "noShowPosted", "totalAmount", attempt, "requestedAt") VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, 1, ?)',
      ['review-audit', scope.company, 'hotel', arrivalDay, 'done', '1010', checkIn],
    )
    for (let index = 0; index < 101; index++) {
      await adapter.run(
        'INSERT INTO hospitality_core_room_night_snapshot (id, "companyId", "propertyId", "reservationId", "auditDate", "nightAuditRunId", amount, currency, kind, "capturedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          `retained-${String(index).padStart(3, '0')}`,
          scope.company,
          'hotel',
          'held-review',
          addCalendarDays(arrivalDay, index),
          'review-audit',
          '10',
          'VND',
          'held',
          checkIn,
        ],
      )
    }
    const read = (await value('hospitality_core.getReservationWorkspace', { id: 'held-review' }, adapter))
      .record as Row
    assert.equal((read.cancellationReview as Row).noShowFee, '1010')
    const input = {
      id: 'held-review',
      reason: 'Synthetic no-show',
      expectedVersion: read.version,
      expectedCancellationFee: '1000',
      requestKey: 'held-review-close',
    }
    const rejected = await value('hospitality_core.markNoShow', input, adapter)
    assert.equal((rejected.errors as Row[])[0]?.code, 'cancellation_review_changed')
    assert.equal(
      (await adapter.all('SELECT state FROM hospitality_core_reservation WHERE id = ?', [input.id]))[0]
        ?.state,
      'confirmed',
    )
    const accepted = { ...input, expectedCancellationFee: '1010' }
    const saved = await value('hospitality_core.markNoShow', accepted, adapter)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(saved.noShowFee, '1010')
    assert.deepEqual(await value('hospitality_core.markNoShow', accepted, adapter), saved)
    assert.equal(
      (
        await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio WHERE id = ?', [
          'held-review:folio',
        ])
      )[0]?.amountTotal,
      '1010',
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality cancellation templates honor property-local free days, exact night pricing and immutable booked terms', async () => {
  const adapter = await boot()
  try {
    await fixtureWrite(
      'hospitality_core.createReservation',
      {
        id: 'agreed-no-policy',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        bookingType: 'nightly',
        checkIn: `${addCalendarDays(arrivalDay, 50)}T07:00:00.000Z`,
        checkOut: `${addCalendarDays(arrivalDay, 52)}T05:00:00.000Z`,
        rate: '500',
      },
      adapter,
    )
    const cases: [string, number, string][] = [
      ['flexible', 1, '851234'],
      ['flexible', 2, '0'],
      ['moderate', 6, '850000'],
      ['moderate', 7, '0'],
      ['strict', 13, '1281234'],
      ['strict', 14, '0'],
      ['peak', 29, '1702468'],
      ['peak', 30, '0'],
      ['non_refundable', 40, '1702468'],
    ]
    for (const [index, [type, offset, expected]] of cases.entries()) {
      const policyId = `template-policy-${index}`,
        id = `template-booking-${index}`
      await fixtureWrite(
        'hospitality_core.saveCancellationPolicy',
        {
          id: policyId,
          code: policyId,
          name: type,
          type,
          feeRule: 'template',
          freeCancellationHours: 99999,
          penaltyPercent: '1',
        },
        adapter,
      )
      await adapter.run('UPDATE hospitality_core_room_type SET "cancellationPolicyId" = ? WHERE id = ?', [
        policyId,
        'deluxe',
      ])
      await fixtureWrite(
        'hospitality_core.createReservation',
        {
          id,
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          partnerId: 'guest',
          bookingType: 'nightly',
          checkIn: `${addCalendarDays(arrivalDay, offset)}T07:00:00.000Z`,
          checkOut: `${addCalendarDays(arrivalDay, offset + 2)}T05:00:00.000Z`,
          rate: '851234',
        },
        adapter,
      )
      await adapter.run(
        'UPDATE hospitality_core_cancellation_policy SET "feeRule" = ?, "penaltyPercent" = ? WHERE id = ?',
        ['percentage', '2', policyId],
      )
      const read = (await value('hospitality_core.getReservationWorkspace', { id }, adapter)).record as Row
      assert.equal((read.cancellationReview as Row).fee, expected, `${type} ${offset} local days`)
      const booking = (
        await adapter.all('SELECT "cancellationFeeRule" FROM hospitality_core_reservation WHERE id = ?', [id])
      )[0]!
      assert.equal(booking.cancellationFeeRule, 'template')
      const cancelled = await value(
        'hospitality_core.cancelReservation',
        {
          id,
          expectedVersion: read.version,
          expectedCancellationFee: expected,
          reason: 'Synthetic template cancellation',
          requestKey: `template-close-${index}`,
        },
        adapter,
      )
      assert.equal(cancelled.ok, true, JSON.stringify(cancelled))
      assert.equal(cancelled.cancellationFee, expected)
    }
    const withoutPolicy = (
      await value('hospitality_core.getReservationWorkspace', { id: 'agreed-no-policy' }, adapter)
    ).record as Row
    assert.equal(
      (withoutPolicy.cancellationReview as Row).fee,
      '0',
      'a policy introduced later cannot charge an originally unpenalized booking',
    )
  } finally {
    await adapter.close()
  }
})

test('Hospitality contract cancellation requires an explicit bounded agreement and night audit cannot silently waive it', async () => {
  const adapter = await boot()
  try {
    await fixtureWrite(
      'hospitality_core.saveCancellationPolicy',
      {
        id: 'contract-policy',
        code: 'CONTRACT',
        name: 'Contract terms',
        type: 'contract',
        feeRule: 'template',
      },
      adapter,
    )
    await adapter.run('UPDATE hospitality_core_room_type SET "cancellationPolicyId" = ? WHERE id = ?', [
      'contract-policy',
      'deluxe',
    ])
    for (const [index, action] of ['cancelReservation', 'markNoShow'].entries()) {
      const id = `contract-booking-${index}`
      await fixtureWrite(
        'hospitality_core.createReservation',
        {
          id,
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          partnerId: 'guest',
          bookingType: 'nightly',
          checkIn: new Date(Date.now() - 60000).toISOString(),
          checkOut: `${departureDay}T00:00:00.000Z`,
          rate: '500',
        },
        adapter,
      )
      if (action === 'markNoShow') {
        await fixtureWrite(
          'hospitality_billing.setReservationGuarantee',
          {
            reservationId: id,
            kind: 'card',
            amount: '500',
            reference: 'authorization:contract-review',
            expectedVersion: 1,
            requestKey: `${id}:guarantee`,
          },
          adapter,
        )
        const decision = await value(
          'hospitality_core.decideAuditArrival',
          {
            reservationId: id,
            auditDate: arrivalDay,
            choice: 'no_show',
            expectedVersion: 2,
            requestKey: `${id}:audit`,
          },
          adapter,
        )
        assert.equal((decision.errors as Row[])[0]?.code, 'contract_no_show_first')
      }
      const read = (await value('hospitality_core.getReservationWorkspace', { id }, adapter)).record as Row
      assert.equal((read.cancellationReview as Row).requiresAgreement, true)
      assert.equal((read.cancellationReview as Row).noShowAgreement, action === 'markNoShow')
      const input = {
        id,
        reason: 'Synthetic signed cancellation agreement',
        expectedCancellationFee: '0',
        expectedVersion: read.version,
        requestKey: `${id}:close`,
      }
      for (const patch of [
        {},
        { contractCancellationFee: '-1' },
        { contractCancellationFee: '100000' },
        { contractCancellationFee: '1.1' },
      ]) {
        const rejected = await value(`hospitality_core.${action}`, { ...input, ...patch }, adapter)
        assert.equal(rejected.ok, false, JSON.stringify(rejected))
        assert.equal(
          (await adapter.all('SELECT state FROM hospitality_core_reservation WHERE id = ?', [id]))[0]?.state,
          'confirmed',
        )
        assert.equal(
          (
            await adapter.all('SELECT id FROM hospitality_core_command_receipt WHERE "requestKey" = ?', [
              input.requestKey,
            ])
          ).length,
          0,
        )
      }
      const accepted = { ...input, contractCancellationFee: '400' }
      const saved = await value(`hospitality_core.${action}`, accepted, adapter)
      assert.equal(saved.ok, true, JSON.stringify(saved))
      assert.equal(saved[action === 'cancelReservation' ? 'cancellationFee' : 'noShowFee'], '400')
      assert.deepEqual(await value(`hospitality_core.${action}`, accepted, adapter), saved)
    }
  } finally {
    await adapter.close()
  }
})

test('Hospitality approved guest benefits waive early-arrival fees without a second reason and preserve scope and closed-stay guards', async () => {
  const adapter = await boot()
  try {
    const id = 'benefit-booking'
    await fixtureWrite(
      'hospitality_core.createReservation',
      {
        id,
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        bookingType: 'nightly',
        checkIn: `${arrivalDay}T07:00:00.000Z`,
        checkOut: `${departureDay}T05:00:00.000Z`,
        rate: '850000',
      },
      adapter,
    )
    await fixtureWrite(
      'hospitality_billing.setReservationGuarantee',
      {
        reservationId: id,
        kind: 'card',
        amount: '850000',
        reference: 'authorization:benefit-test',
        expectedVersion: 1,
        requestKey: `${id}:guarantee`,
      },
      adapter,
    )
    const read = async () =>
      (await value('hospitality_core.getReservationWorkspace', { id }, adapter)).record as Row
    let context = await read()
    const input = {
      id,
      vip: false,
      tier: 'gold_elite',
      program: 'Synthetic rewards',
      reference: 'Synthetic verified membership evidence',
      expectedVersion: context.version,
      requestKey: `${id}:benefit`,
    }
    for (const patch of [{ tier: 'invented' }, { program: '' }, { reference: '' }, { expectedVersion: 0 }]) {
      const rejected = await value(
        'hospitality_core.setReservationGuestBenefits',
        { ...input, ...patch },
        adapter,
      )
      assert.equal(rejected.ok, false)
    }
    for (const selectedScope of [
      { company: 'other', branches: null },
      { company: 'acme', branches: ['outside-property'] },
    ]) {
      const rejected = (
        await callFn('hospitality_core.setReservationGuestBenefits', input, {
          adapter,
          manifest,
          scope: selectedScope,
        })
      ).value as Row
      assert.equal(rejected.ok, false)
    }
    const arrival = {
      stayId: `${id}:stay`,
      roomId: '101',
      expectedVersion: (context.stay as Row).version,
      at: `${arrivalDay}T01:00:00.000Z`,
      keys: 1,
      earlyFee: 'waived',
      guests: [
        {
          fullName: 'Synthetic benefits guest',
          type: 'passport',
          number: 'BENE1234',
          birth: '1990-01-01',
          gender: 'female',
          nationality: 'VN',
        },
      ],
      requestKey: `${id}:arrival`,
    }
    const notEligible = await value('hospitality_core.checkIn', arrival, adapter)
    assert.equal(notEligible.ok, false, 'ordinary guests still need a waiver reason')
    assert.ok((notEligible.errors as Row[]).some((error) => error.code === 'arrival_fee_reason'))
    const saved = await value('hospitality_core.setReservationGuestBenefits', input, adapter)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(await value('hospitality_core.setReservationGuestBenefits', input, adapter), saved)
    assert.equal(((await read()).arrivalFee as Row).benefit, 'gold_elite')
    for (const [index, [tier, vip, expected]] of (
      [
        ['club', false, null],
        ['silver_elite', false, null],
        ['platinum_elite', false, 'platinum_elite'],
        ['diamond_elite', false, 'diamond_elite'],
        ['none', true, 'vip'],
      ] as const
    ).entries()) {
      context = await read()
      await fixtureWrite(
        'hospitality_core.setReservationGuestBenefits',
        { ...input, tier, vip, expectedVersion: context.version, requestKey: `${id}:tier-${index}` },
        adapter,
      )
      assert.equal(((await read()).arrivalFee as Row).benefit, expected)
    }
    const arrived = await value('hospitality_core.checkIn', arrival, adapter)
    assert.equal(arrived.ok, true, JSON.stringify(arrived))
    assert.deepEqual(await value('hospitality_core.checkIn', arrival, adapter), arrived)
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio WHERE id = ?', [`${id}:folio`]))[0]
        ?.amountTotal,
      '1700000',
    )
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_charge WHERE "folioId" = ? AND description = ?', [
          `${id}:folio`,
          'Early check-in fee',
        ])
      ).length,
      0,
    )
    const events = await adapter.all(
      'SELECT details FROM hospitality_core_operational_change WHERE "entityId" = ? AND action = ?',
      [`${id}:stay`, 'waiveEarlyArrival'],
    )
    assert.equal(events.length, 1)
    assert.match(String(events[0]?.details), /guest_benefit:vip/)
    const late = await value(
      'hospitality_core.setReservationGuestBenefits',
      { ...input, expectedVersion: (await read()).version, requestKey: `${id}:late` },
      adapter,
    )
    assert.equal((late.errors as Row[])[0]?.code, 'guest_benefits_state')
  } finally {
    await adapter.close()
  }
})

test('Hospitality billing list derives next actions from actual charges, payments and invoice evidence', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    const version = async () => (await value('hospitality_core.getFolio', { id: folioId }, adapter)).version
    const read = async () => {
      const page = await value('hospitality_billing.searchBilling', { pageSize: 1, page: 999 }, adapter)
      assert.equal(page.total, 1)
      assert.equal(page.page, 1)
      return (page.rows as Row[])[0]!
    }
    let row = await read()
    assert.equal(row.billing, 'missing-rule')
    assert.equal(row.next, 'rule')
    assert.equal(row.rule, 'room')
    assert.deepEqual(row.due, { amount: '1000', currency: 'VND' })
    assert.equal(row.invoice, null)
    await rule('room', 'vat8', adapter)
    row = await read()
    assert.equal(row.billing, 'uninvoiced')
    assert.equal(row.next, 'invoice')
    assert.equal(row.rule, null)
    await fixtureWrite(
      'hospitality_billing.recordFolioPayment',
      {
        id: 'list-advance',
        folioId,
        amount: '100',
        journalId: 'cash-journal',
        expectedVersion: await version(),
        requestKey: 'list-advance',
      },
      adapter,
    )
    assert.equal(((await read()).due as Row).amount, '900')
    const invoice = await fixtureWrite(
      'hospitality_billing.invoiceFolio',
      {
        folioId,
        expectedVersion: await version(),
        requestKey: 'list-invoice',
        buyerType: 'company',
        buyerName: 'Synthetic buyer',
        buyerTaxCode: '0123456789',
        buyerAddress: 'Synthetic address',
      },
      adapter,
    )
    row = await read()
    assert.equal(row.billing, 'owing')
    assert.equal(row.next, 'payment')
    assert.equal((row.due as Row).amount, '980')
    assert.equal((row.invoice as Row).status, 'posted')
    await fixtureWrite(
      'hospitality_billing.recordFolioPayment',
      {
        id: 'list-settle',
        folioId,
        amount: '980',
        journalId: 'cash-journal',
        expectedVersion: await version(),
        requestKey: 'list-settle',
      },
      adapter,
    )
    row = await read()
    assert.equal(row.billing, 'paid')
    assert.equal(row.next, 'view')
    assert.equal((row.due as Row).amount, '0')
    await adapter.run('DELETE FROM hospitality_billing_charge_rule WHERE "companyId" = ?', ['acme'])
    assert.equal((await read()).billing, 'paid', 'changing current rules does not rewrite a posted invoice')
    await adapter.run('UPDATE account_move SET "reversedById" = ? WHERE id = ?', [
      'reversal-evidence',
      invoice.moveId,
    ])
    row = await read()
    assert.equal(row.billing, 'unverified')
    assert.equal(row.due, null)
    assert.equal(row.next, 'view')
    assert.equal((row.invoice as Row).status, 'void')
    await adapter.run('UPDATE account_move SET "reversedById" = NULL WHERE id = ?', [invoice.moveId])
    await adapter.run('DELETE FROM account_move_line WHERE id = ?', [`${invoice.moveId}:counterpart`])
    assert.equal((await read()).billing, 'unverified', 'missing ledger evidence never becomes a paid balance')
    for (const selected of [
      { company: 'other', branches: null },
      { company: 'acme', branches: ['outside'] },
    ]) {
      const page = (
        await callFn('hospitality_billing.searchBilling', { page: 9 }, { adapter, manifest, scope: selected })
      ).value as Row
      assert.equal(page.total, 0)
      assert.deepEqual(page.rows, [])
      // An empty answer has one page, and its applied query asks for that one.
      assert.deepEqual([page.page, (page.query as Row).page], [1, 1])
    }
  } finally {
    await adapter.close()
  }
})

/**
 * The folio `stayed` left, invoiced, and a way to copy it at other ages and states: the same posted entry under
 * another number, its receivable line and bill, so the billing book reads them as it reads the real one.
 */
async function billedClones(adapter: Adapter, folioId: string) {
  await rule('room', 'vat8', adapter)
  const version = async () => (await value('hospitality_core.getFolio', { id: folioId }, adapter)).version
  await fixtureWrite(
    'hospitality_billing.invoiceFolio',
    {
      folioId,
      expectedVersion: await version(),
      requestKey: 'book-invoice',
      buyerType: 'company',
      buyerName: 'Synthetic buyer',
      buyerTaxCode: '0123456789',
      buyerAddress: 'Synthetic address',
    },
    adapter,
  )
  const one = async (table: string, where: string, arg: unknown) =>
    (await adapter.all(`SELECT * FROM ${table} WHERE ${where} = ?`, [arg]))[0]!
  const insert = async (table: string, row: Row) => {
    const names = Object.keys(row)
    await adapter.run(
      `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
      names.map((name) => row[name]),
    )
  }
  const folio = await one('hospitality_core_folio', 'id', folioId)
  const bill = await one('hospitality_billing_folio_bill', '"folioId"', folioId)
  const move = await one('account_move', 'id', bill.moveId)
  const line = await one('account_move_line', 'id', `${bill.moveId}:counterpart`)
  const charge = await one('hospitality_core_charge', '"folioId"', folioId)
  const property = await one('hospitality_core_property', 'id', 'hotel')
  const today = String(property.businessDate ?? dateKeyIn(new Date(), String(property.timezone || 'UTC')))
  const ago = (days: number) => `${addCalendarDays(today, -days)}T12:00:00.000Z`
  const clone = async (
    id: string,
    change: { closed?: string | null; state?: string; partnerId?: string; companyId?: string },
    invoice?: { state?: string; paymentState?: string; residual?: string; reversed?: boolean },
    charged?: { type: string; amount?: string },
  ) => {
    await insert('hospitality_core_folio', {
      ...folio,
      id,
      code: `PC-${id.toUpperCase()}`,
      state: change.state ?? 'closed',
      closedAt: change.closed === undefined ? ago(1) : change.closed,
      partnerId: change.partnerId ?? folio.partnerId,
      companyId: change.companyId ?? folio.companyId,
    })
    if (charged)
      await insert('hospitality_core_charge', {
        ...charge,
        id: `${id}-charge`,
        sourceKey: `${id}-charge`,
        folioId: id,
        type: charged.type,
        amount: charged.amount ?? charge.amount,
      })
    if (!invoice) return
    await insert('account_move', {
      ...move,
      id: `${id}-move`,
      companyId: change.companyId ?? move.companyId,
      name: `HD/${id.toUpperCase()}`,
      state: invoice.state ?? 'posted',
      paymentState: invoice.paymentState ?? 'not_paid',
      reversedById: invoice.reversed ? 'reversal-evidence' : null,
    })
    await insert('account_move_line', {
      ...line,
      id: `${id}-move:counterpart`,
      moveId: `${id}-move`,
      companyId: change.companyId ?? line.companyId,
      amountResidual: invoice.residual ?? line.amountResidual,
    })
    await insert('hospitality_billing_folio_bill', {
      ...bill,
      id: `${id}-bill`,
      folioId: id,
      moveId: `${id}-move`,
      companyId: change.companyId ?? bill.companyId,
    })
  }
  return { clone, folio, line, property, ago }
}

test('Hospitality billing book weighs a period whole: owed invoices of any age, open folios a rule holds, overlapping facets', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    const { clone, folio, line, property, ago } = await billedClones(adapter, folioId)
    await call('partner.savePartner', { id: 'hoa', kind: 'person', name: 'Nguyễn Thị Hoa' }, adapter)
    await clone('old-owed', { closed: ago(40), partnerId: 'hoa' }, {})
    await clone('old-paid', { closed: ago(40) }, { paymentState: 'paid', residual: '0' })
    await clone('recent-paid', { closed: ago(3) }, { paymentState: 'paid', residual: '0' })
    await clone('old-draft', { closed: ago(100) }, { state: 'draft' })
    await clone('reversed', { closed: ago(2) }, { reversed: true })
    await clone('old-unbilled', { closed: ago(40) })
    await clone('foreign', { closed: ago(1), companyId: 'other' }, {})
    // A reversed invoice is no longer owed; the period runs back to the sixth day before today.
    await clone('old-reversed', { closed: ago(40) }, { reversed: true })
    await clone('edge-in', { closed: ago(6) }, { paymentState: 'paid', residual: '0' })
    await clone('edge-out', { closed: ago(7) }, { paymentState: 'paid', residual: '0' })
    // Open folios: one holds a minibar charge no rule covers; one only room nights the rule covers; one a minibar
    // line of nothing.
    await clone('held', { state: 'open', closed: null }, undefined, { type: 'minibar' })
    await clone('ruled', { state: 'open', closed: null }, undefined, { type: 'room' })
    await clone('zero', { state: 'open', closed: null }, undefined, { type: 'minibar', amount: '0' })

    const book = async (input: Record<string, unknown> = {}) =>
      (await value('hospitality_billing.searchBilling', { pageSize: 100, ...input }, adapter)) as Row & {
        rows: Row[]
        counts: { view: Record<string, number> }
      }
    const ids = (page: { rows: Row[] }) => page.rows.map((row) => String(row.id))
    const first = await book()
    assert.equal((first.query as Row).period, 7)
    // The period's closed folios, invoices still owed or not posted whatever their age, and the open folio a rule holds.
    assert.deepEqual(
      new Set(ids(first)),
      new Set([folioId, 'old-owed', 'recent-paid', 'edge-in', 'old-draft', 'reversed', 'held']),
    )
    assert.deepEqual(new Set(ids(await book({ period: 30 }))), new Set([...ids(first), 'edge-out']))
    assert.deepEqual(
      new Set(ids(await book({ period: 90 }))),
      new Set([...ids(first), 'edge-out', 'old-paid', 'old-unbilled', 'old-reversed']),
    )
    assert.equal(((await book({ period: 400 })).query as Row).period, 7)
    // One status a row, by what needs doing first; facets overlap and count the whole book.
    const state = Object.fromEntries(first.rows.map((row) => [row.id, row.billing]))
    assert.deepEqual(state, {
      'old-draft': 'unverified',
      reversed: 'unverified',
      held: 'missing-rule',
      [folioId]: 'owing',
      'old-owed': 'owing',
      'recent-paid': 'paid',
      'edge-in': 'paid',
    })
    assert.deepEqual(first.counts.view, {
      all: 7,
      'missing-rule': 1,
      uninvoiced: 1,
      owing: 3,
      paid: 2,
      unverified: 2,
    })
    // The default order: unverified, missing a rule, owed, paid; the folio closed last first within a status.
    assert.deepEqual(ids(first), [
      'reversed',
      'old-draft',
      'held',
      folioId,
      'old-owed',
      'recent-paid',
      'edge-in',
    ])
    // What is owed orders the book, unknown last either way.
    for (const [sort, direction] of [
      ['-balance', -1],
      ['balance', 1],
    ] as const) {
      const rows = (await book({ sort })).rows
      const amounts = rows.filter((row) => row.due).map((row) => Number((row.due as Row).amount))
      assert.ok(new Set(amounts).size > 2, 'several amounts to order')
      assert.deepEqual(
        amounts,
        [...amounts].sort((a, b) => direction * (a - b)),
        sort,
      )
      assert.deepEqual(
        ids({ rows: rows.slice(-2) }).sort(),
        ['old-draft', 'reversed'],
        `${sort}: unknown last`,
      )
    }
    assert.deepEqual(ids(await book({ view: 'owing' })).sort(), [folioId, 'held', 'old-owed'].sort())
    // Rows say what the list shows and the next step; an invoice not posted, or reversed, says so.
    const byId = Object.fromEntries(first.rows.map((row) => [row.id, row]))
    assert.deepEqual(
      [
        byId.held!.next,
        byId.held!.rule,
        byId.held!.invoice,
        byId['old-owed']!.next,
        byId['recent-paid']!.next,
      ],
      ['rule', 'minibar', null, 'payment', 'view'],
    )
    assert.deepEqual(
      [
        (byId['old-draft']!.invoice as Row).status,
        (byId.reversed!.invoice as Row).status,
        byId.reversed!.due,
      ],
      ['draft', 'void', null],
    )
    assert.deepEqual(byId['old-owed']!.due, { amount: String(line.amountResidual), currency: 'VND' })
    assert.equal(byId['old-owed']!.guest, 'Nguyễn Thị Hoa')
    assert.equal(
      byId[folioId]!.closed,
      dateKeyIn(new Date(String(folio.closedAt)), String(property.timezone || 'UTC')),
    )
    assert.ok(first.rows.every((row) => !('folded' in row) && !('views' in row)))
    // The search folds accents over folio code, invoice number and guest name; counts follow it.
    for (const [q, found] of [
      ['nguyen thi', ['old-owed']],
      ['hd/old-dr', ['old-draft']],
      ['pc-held', ['held']],
    ] as const) {
      const page = await book({ q })
      assert.deepEqual(ids(page), found, q)
      assert.equal(page.counts.view.all, found.length, q)
    }
    for (const q of ['ruled', 'pc-zero'])
      assert.equal(
        (await book({ q, period: 90 })).total,
        0,
        `${q}: an open folio with nothing a rule holds is not billing work`,
      )
  } finally {
    await adapter.close()
  }
})

test('Hospitality billing book past its bound says so, keeping the folios closed last', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    const { clone, folio, ago } = await billedClones(adapter, folioId)
    const names = Object.keys(folio)
    const extra = BILLING_BOOK_LIMIT
    for (let start = 0; start < extra; start += 500) {
      const rows = Array.from({ length: Math.min(500, extra - start) }, (_, index) => ({
        ...folio,
        id: `bulk-${start + index}`,
        code: `PC-BULK-${String(start + index).padStart(5, '0')}`,
        // Older than the billed folio, each a minute apart.
        closedAt: new Date(Date.parse(String(folio.closedAt)) - (start + index + 1) * 60_000).toISOString(),
      }))
      await adapter.run(
        `INSERT INTO hospitality_core_folio (${names.map((name) => `"${name}"`).join(', ')}) VALUES ${rows
          .map(() => `(${names.map(() => '?').join(', ')})`)
          .join(', ')}`,
        rows.flatMap((row) => names.map((name) => (row as Row)[name])),
      )
    }
    const page = await value('hospitality_billing.searchBilling', { sort: 'title', pageSize: 1 }, adapter)
    assert.equal(page.partial, true)
    assert.equal(page.total, BILLING_BOOK_LIMIT)
    // The oldest closed folio fell outside the bound; the one closed last is kept.
    const all = await value('hospitality_billing.searchBilling', { q: 'pc-bulk-01999' }, adapter)
    assert.equal(all.total, 0)
    assert.equal((await value('hospitality_billing.searchBilling', { q: folio.code }, adapter)).total, 1)
    // Billing's work whatever its age is kept ahead of the period's closed folios.
    await clone('old-owed', { closed: ago(40) }, {})
    const owed = await value('hospitality_billing.searchBilling', { pageSize: 1 }, adapter)
    assert.deepEqual([owed.partial, owed.total], [true, BILLING_BOOK_LIMIT])
    assert.equal((await value('hospitality_billing.searchBilling', { q: 'pc-old-owed' }, adapter)).total, 1)
    // The billed folio, the old invoice and 1.998 closed folios fill the bound exactly.
    await adapter.run('DELETE FROM hospitality_core_folio WHERE id IN (?, ?)', ['bulk-1999', 'bulk-1998'])
    assert.equal((await value('hospitality_billing.searchBilling', { pageSize: 1 }, adapter)).partial, false)
  } finally {
    await adapter.close()
  }
})

test('Hospitality billing book URL keeps its defaults off and falls back from what it does not know', () => {
  const properties = [{ id: 'hotel' }]
  const read = (search: string) =>
    billingBookQueryFromUrl(new URL(`http://x.local/admin/hospitality/billing${search}`), properties)
  assert.deepEqual(read(''), {
    propertyId: null,
    period: 7,
    view: 'all',
    q: '',
    sort: 'attention',
    page: 1,
    pageSize: 25,
  })
  assert.deepEqual(
    read('?property=hotel&period=30&view=owing&q=%20an%20&sort=-balance&page=2&pageSize=500'),
    { propertyId: 'hotel', period: 30, view: 'owing', q: 'an', sort: '-balance', page: 2, pageSize: 100 },
  )
  // Links from the old list and unknown values land on the defaults.
  assert.deepEqual(read('?property=gone&period=14&view=open&sort=openedAt&page=0'), {
    propertyId: null,
    period: 7,
    view: 'all',
    q: '',
    sort: 'attention',
    page: 1,
    pageSize: 25,
  })
  assert.equal(
    billingBookHref('/admin/hospitality/billing?lang=en&period=30', read('')),
    '/admin/hospitality/billing?lang=en',
  )
  assert.equal(
    billingBookHref('/admin/hospitality/billing', read('?period=90&view=paid&sort=title&page=3')),
    '/admin/hospitality/billing?period=90&view=paid&sort=title&page=3',
  )
})

test('Hospitality billing rules list every charge type, what needs setting up first, found by type, account or tax', async () => {
  const adapter = await boot()
  const list = (args: Record<string, unknown> = {}) =>
    value('hospitality_billing.searchChargeRules', args, adapter)
  const types = (page: Row) => (page.rows as Row[]).map((row) => row.chargeType)
  const row = (page: Row, type: string) => (page.rows as Row[]).find((item) => item.chargeType === type)!
  try {
    // HOS-DEC-034: a fresh company has set nothing up, and every charge type is still a row.
    const fresh = await list()
    assert.deepEqual(types(fresh), [...CHARGE_TYPES])
    assert.deepEqual(fresh.counts, {
      state: { all: CHARGE_TYPES.length, incomplete: CHARGE_TYPES.length, ready: 0 },
    })
    assert.equal(fresh.isEmpty, false)

    // The tax answer decides the state: a tax, or no tax with its reason. The income account is optional.
    await rule('room', 'vat8', adapter)
    await rule('cancellation', null, adapter)
    const spa = await value(
      'hospitality_billing.saveChargeRule',
      { chargeType: 'spa', incomeAccountId: 'revenue', taxId: 'vat10', taxExempt: false },
      adapter,
    )
    assert.equal(spa.ok, true, JSON.stringify(spa))
    // An exemption saved before reasons were required does not answer the question, nor shows a tax it left behind.
    await rule('minibar', null, adapter)
    await adapter.run(
      'UPDATE hospitality_billing_charge_rule SET "taxExemptReason" = NULL, "taxId" = ? WHERE "chargeType" = ?',
      ['vat8', 'minibar'],
    )
    // Another company's rule is not this one's.
    await adapter.run(
      'INSERT INTO hospitality_billing_charge_rule (id, "companyId", "chargeType", "taxExempt", "taxExemptReason", version, "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['charge-rule:other:laundry', 'other', 'laundry', 1, 'Another company', 1, new Date().toISOString()],
    )

    const page = await list()
    assert.deepEqual(types(page), [
      'laundry',
      'transfer',
      'late_checkout',
      'minibar',
      'restaurant',
      'service',
      'discount',
      'room',
      'spa',
      'cancellation',
    ])
    assert.deepEqual(page.counts, { state: { all: 10, incomplete: 7, ready: 3 } })
    assert.deepEqual(
      ['room', 'spa', 'cancellation', 'minibar', 'laundry'].map((type) => {
        const { incomeAccount, tax, taxExempt, state } = row(page, type)
        return [type, incomeAccount, tax, taxExempt, state]
      }),
      [
        ['room', null, 'GTGT 8%', false, 'ready'],
        ['spa', '5113 · Doanh thu dịch vụ', 'GTGT 10%', false, 'ready'],
        ['cancellation', null, null, true, 'ready'],
        ['minibar', null, null, true, 'incomplete'],
        ['laundry', null, null, false, 'incomplete'],
      ],
    )
    assert.deepEqual(types(await list({ state: 'ready' })), ['room', 'spa', 'cancellation'])
    assert.equal((await list({ state: 'incomplete' })).total, 7)

    // Found by its name in either language, accents optional, by account code or tax name; counts follow it.
    for (const [q, found] of [
      ['giat', ['laundry']],
      ['UNSCHEDULED', ['transfer']],
      ['phi huy', ['cancellation']],
      ['5113', ['spa']],
      ['gtgt 8', ['room']],
    ] as const)
      assert.deepEqual(types(await list({ q })), found, q)
    assert.deepEqual((await list({ q: '5113' })).counts, { state: { all: 1, incomplete: 0, ready: 1 } })

    // Unknown values fall back; a page past the end is the last one.
    const odd = await list({ state: 'taxed', sort: 'chargeType', page: 9, pageSize: 999 })
    const query = odd.query as Row
    assert.deepEqual(
      [query.state, query.sort, odd.page, query.page, query.pageSize, odd.total],
      ['all', 'attention', 1, 1, 100, 10],
    )
    const paged = await list({ pageSize: 4, page: 3 })
    assert.deepEqual([paged.pages, types(paged)], [3, ['spa', 'cancellation']])
  } finally {
    await adapter.close()
  }
})
