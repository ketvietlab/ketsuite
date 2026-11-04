import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineFn,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { referenceMatches } from '../packages/ketsuite/src/modules/account/cash-receivables.ts'
import { account, address, company, partner, product, uom } from '@ketvietlab/ketsuite'

const wave2Probe = defineModule({
  name: 'account_wave2_probe',
  depends: ['account'],
  functions: {
    rows: defineFn({
      input: { model: 'text', id: 'id?' },
      effects: [
        'read:account.BankTransaction',
        'read:account.BankTransactionVersion',
        'read:account.PartialReconcile',
        'read:account.Move',
        'read:account.FollowUpMessage',
      ],
      handler: (ctx, args) => ctx.db.select(String(args.model), args.id ? { id: args.id } : {}),
    }),
  },
})
const modules = [address, partner, company, uom, product, account, wave2Probe]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope }).then((result) => result.value as Row)

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'USD' }, adapter)
  for (const [id, code, name, accountType] of [
    ['receivable', 'AR', 'Receivable', 'asset_receivable'],
    ['payable', 'AP', 'Payable', 'liability_payable'],
    ['bank', 'BANK', 'Bank', 'asset_cash'],
    ['clearing', 'CLEAR', 'Clearing', 'asset_current'],
    ['suspense', 'SUSP', 'Suspense', 'asset_current'],
    ['revenue', 'REV', 'Revenue', 'income'],
    ['difference', 'DIFF', 'Difference', 'expense_other'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' }, adapter)
  await call(
    'account.saveJournal',
    { id: 'bank-journal', name: 'Bank', code: 'BNK', type: 'bank', defaultAccountId: 'bank' },
    adapter,
  )
  await call(
    'account.saveBankAccount',
    {
      id: 'primary-bank',
      name: 'Primary bank',
      journalId: 'bank-journal',
      liquidityAccountId: 'bank',
      clearingAccountId: 'clearing',
      suspenseAccountId: 'suspense',
      currency: 'USD',
    },
    adapter,
  )
  await call(
    'account.saveBankImportProfile',
    {
      id: 'generic-csv',
      name: 'Generic CSV',
      format: 'csv',
      balancePolicy: 'block',
      mapping: {
        bookingDate: 'date',
        amount: 'amount',
        reference: 'reference',
        externalId: 'externalId',
        providerState: 'state',
      },
    },
    adapter,
  )
  await call('account.saveMatchRule', { id: 'exact', name: 'Exact', minimumScore: 60 }, adapter)
  return adapter
}

test('account cash: statement import is controlled, idempotent, and preserves provider updates', async () => {
  const adapter = await boot()
  try {
    const rows = [
      { date: '2026-08-20', amount: '100.00', reference: 'INV-1', externalId: 'bank-1', state: 'pending' },
    ]
    const [first, retry] = await Promise.all(
      ['statement-1', 'statement-1-retry'].map((id) =>
        call(
          'account.importBankStatement',
          {
            id,
            bankAccountId: 'primary-bank',
            profileId: 'generic-csv',
            rows,
            openingBalance: '0.00',
            closingBalance: '100.00',
            sourceChecksum: 'source-1',
          },
          adapter,
        ),
      ),
    )
    assert.equal(Number(first.imported ?? 0) + Number(retry.imported ?? 0), 1)
    assert.equal([first, retry].filter((result) => result.duplicate === true).length, 1)

    const updated = await call(
      'account.importBankStatement',
      {
        id: 'statement-2',
        bankAccountId: 'primary-bank',
        profileId: 'generic-csv',
        rows: [{ ...rows[0], state: 'posted' }],
        openingBalance: '0.00',
        closingBalance: '100.00',
        sourceChecksum: 'source-2',
      },
      adapter,
    )
    assert.equal(updated.updated, 1)
    const versions = (await call(
      'account_wave2_probe.rows',
      { model: 'account.BankTransactionVersion' },
      adapter,
    )) as unknown as Row[]
    assert.equal(versions.length, 2)
    assert.deepEqual(versions.map((row) => row.providerState).sort(), ['pending', 'posted'])
  } finally {
    await adapter.close()
  }
})

test('account cash: explainable match, partial reconciliation, aging, and undo keep the ledger aligned', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createInvoice',
      {
        id: 'INV-1',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        invoiceDate: '2026-08-15T00:00:00.000Z',
        description: 'Subscription',
        quantity: '1',
        priceUnit: '100.00',
        lineAccountId: 'revenue',
        counterpartAccountId: 'receivable',
      },
      adapter,
    )
    await call('account.postMove', { id: 'INV-1' }, adapter)
    await call(
      'account.importBankStatement',
      {
        id: 'statement-1',
        bankAccountId: 'primary-bank',
        profileId: 'generic-csv',
        rows: [
          {
            date: '2026-08-18',
            amount: '100.00',
            reference: 'INV-1',
            externalId: 'bank-1',
            state: 'posted',
            partnerId: 'customer',
          },
        ],
        openingBalance: '0.00',
        closingBalance: '100.00',
        sourceChecksum: 'source-1',
      },
      adapter,
    )
    const [transaction] = (await call(
      'account_wave2_probe.rows',
      { model: 'account.BankTransaction' },
      adapter,
    )) as unknown as Row[]
    const suggested = await call(
      'account.suggestBankMatches',
      { transactionId: transaction?.id, ruleId: 'exact' },
      adapter,
    )
    assert.equal(suggested.ok, true)
    assert.ok(Number((suggested.candidates as Row[])[0]?.score) >= 80)
    assert.equal(suggested.ambiguous, false)

    const duplicateAllocation = await call(
      'account.postBankReconciliation',
      {
        id: 'reconcile-duplicate',
        transactionId: transaction?.id,
        allocations: [
          { moveLineId: 'INV-1:counterpart', amount: '60.00' },
          { moveLineId: 'INV-1:counterpart', amount: '40.00' },
        ],
      },
      adapter,
    )
    assert.equal(duplicateAllocation.ok, false)
    assert.equal((duplicateAllocation.errors as Row[])[0]?.code, 'account.error.reconcileAllocationDuplicate')
    assert.deepEqual(
      await call(
        'account_wave2_probe.rows',
        { model: 'account.Move', id: 'reconcile-duplicate:move' },
        adapter,
      ),
      [],
    )

    const reconciled = await call(
      'account.postBankReconciliation',
      {
        id: 'reconcile-1',
        transactionId: transaction?.id,
        allocations: [{ moveLineId: 'INV-1:counterpart', amount: '100.00' }],
        actorId: 'accountant',
        reason: 'Bank reference confirmed',
        ruleId: 'exact',
        ruleVersion: 1,
      },
      adapter,
    )
    assert.equal(reconciled.ok, true, JSON.stringify(reconciled.errors))
    const aging = await call(
      'account.receivableAging',
      { cutoff: '2026-08-31', partnerId: 'customer' },
      adapter,
    )
    assert.equal((aging.rows as Row[]).length, 0)

    const undone = await call(
      'account.undoBankReconciliation',
      {
        id: 'reconcile-1',
        reversalId: 'reconcile-1:reversal',
        accountingDate: '2026-09-01',
        actorId: 'controller',
        reason: 'Wrong customer',
      },
      adapter,
    )
    assert.equal(undone.ok, true, JSON.stringify(undone.errors))
    const restored = await call(
      'account.receivableAging',
      { cutoff: '2026-09-01', partnerId: 'customer' },
      adapter,
    )
    assert.equal((restored.rows as Row[]).length, 1)
    assert.equal((restored.rows as Row[])[0]?.amount, '100.00')
    assert.equal((restored.rows as Row[])[0]?.moveName !== undefined, true)
    // Aging reads the books as they stood on the cutoff: the bank payment of 18/08 had not
    // arrived on 17/08, and the undo booked on 01/09 had not happened on 31/08.
    const before = await call(
      'account.receivableAging',
      { cutoff: '2026-08-17', partnerId: 'customer' },
      adapter,
    )
    assert.deepEqual(
      (before.rows as Row[]).map((row) => [row.moveId, row.amount]),
      [['INV-1', '100.00']],
    )
    const settled = await call(
      'account.receivableAging',
      { cutoff: '2026-08-31', partnerId: 'customer' },
      adapter,
    )
    assert.equal((settled.rows as Row[]).length, 0)
    const partial = (
      (await call(
        'account_wave2_probe.rows',
        { model: 'account.PartialReconcile', id: 'reconcile-1:partial:1' },
        adapter,
      )) as unknown as Row[]
    )[0]
    assert.equal(partial?.state, 'reversed')
    assert.equal(partial?.reversalReason, 'Wrong customer')
  } finally {
    await adapter.close()
  }
})

test('account cash: cash differences stay draft and follow-up retries stay singular', async () => {
  const adapter = await boot()
  try {
    const counted = await call(
      'account.createCashCount',
      {
        id: 'count-1',
        bankAccountId: 'primary-bank',
        countedAt: '2026-08-20T10:00:00.000Z',
        countedBy: 'cashier',
        actualBalance: '5.00',
      },
      adapter,
    )
    assert.equal(counted.difference, '5.00')
    const approved = await call(
      'account.approveCashCountDifference',
      {
        id: 'count-1',
        moveId: 'count-1:move',
        differenceAccountId: 'difference',
        approvedBy: 'controller',
      },
      adapter,
    )
    assert.equal(approved.posted, false)
    assert.equal(
      (
        (await call(
          'account_wave2_probe.rows',
          { model: 'account.Move', id: 'count-1:move' },
          adapter,
        )) as unknown as Row[]
      )[0]?.state,
      'draft',
    )

    await call(
      'account.saveFollowUpCase',
      {
        id: 'follow-customer',
        partnerId: 'customer',
        snapshot: { cutoff: '2026-08-31', amount: '100.00' },
      },
      adapter,
    )
    const message = {
      id: 'message-1',
      caseId: 'follow-customer',
      channel: 'email',
      templateKey: 'payment-reminder',
      templateVersion: 'v1',
      idempotencyKey: 'customer:2026-08-31:v1',
      consent: true,
      scheduledAt: '2026-09-01T02:00:00.000Z',
    }
    assert.equal((await call('account.queueFollowUpMessage', message, adapter)).duplicate, false)
    assert.equal(
      (await call('account.queueFollowUpMessage', { ...message, id: 'message-2' }, adapter)).duplicate,
      true,
    )
    assert.equal(
      (
        (await call(
          'account_wave2_probe.rows',
          { model: 'account.FollowUpMessage' },
          adapter,
        )) as unknown as Row[]
      ).length,
      1,
    )
  } finally {
    await adapter.close()
  }
})

test('account cash: a period does not close over unmatched bank lines or unbooked cash differences (D12)', async () => {
  const adapter = await boot()
  const steps = async () => {
    const refreshed = await call('account.refreshClosePeriod', { id: 'close:2026-08' }, adapter)
    assert.equal(refreshed.ok, true, JSON.stringify(refreshed))
    const period = refreshed.period as Row
    return Object.fromEntries(
      (period.steps as Row[])
        .filter((row) => ['bank_reconciled', 'cash_counted'].includes(String(row.code)))
        .map((row) => [row.code, [row.required, row.state, (row.evidence as Row).count]]),
    )
  }
  try {
    await call(
      'account.createClosePeriod',
      { id: 'close:2026-08', periodKey: '2026-08', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      adapter,
    )
    await call(
      'account.importBankStatement',
      {
        id: 'statement-close',
        bankAccountId: 'primary-bank',
        profileId: 'generic-csv',
        rows: [
          // Last month's line still open counts; a pending one and one after the period do not.
          { date: '2026-07-30', amount: '40.00', reference: 'OLD', externalId: 'close-1', state: 'posted' },
          { date: '2026-08-18', amount: '30.00', reference: 'NEW', externalId: 'close-2', state: 'posted' },
          { date: '2026-08-31', amount: '20.00', reference: 'PEND', externalId: 'close-3', state: 'pending' },
          { date: '2026-09-01', amount: '10.00', reference: 'NEXT', externalId: 'close-4', state: 'posted' },
        ],
        openingBalance: '0.00',
        closingBalance: '100.00',
        sourceChecksum: 'source-close',
      },
      adapter,
    )
    await call(
      'account.createCashCount',
      {
        id: 'count-close',
        bankAccountId: 'primary-bank',
        countedAt: '2026-08-20T10:00:00.000Z',
        countedBy: 'cashier',
        actualBalance: '5.00',
      },
      adapter,
    )
    assert.deepEqual(await steps(), {
      bank_reconciled: [true, 'blocked', 2],
      cash_counted: [true, 'blocked', 1],
    })

    await call(
      'account.approveCashCountDifference',
      {
        id: 'count-close',
        moveId: 'count-close:move',
        differenceAccountId: 'difference',
        approvedBy: 'controller',
      },
      adapter,
    )
    await adapter.run(
      `UPDATE account_bank_transaction SET "reconcileState" = 'reconciled' WHERE "reference" IN ('OLD', 'NEW')`,
      [],
    )
    assert.deepEqual(await steps(), {
      bank_reconciled: [true, 'complete', 0],
      cash_counted: [true, 'complete', 0],
    })
  } finally {
    await adapter.close()
  }
})

test('account cash: a transfer memo that wraps the document number still counts as its reference', async () => {
  // Either side may hold the other; banks drop the slashes and spaces.
  assert.equal(referenceMatches('INV/2026/0001', ['INV/2026/0001']), true)
  assert.equal(referenceMatches('0001', ['INV/2026/0001']), true)
  assert.equal(referenceMatches('CT DEN:123 TT INV/2026/0001 thanh toan', ['INV/2026/0001']), true)
  assert.equal(referenceMatches('MBVCB.123.INV20260001.CT tu', ['INV/2026/0001', null]), true)
  assert.equal(referenceMatches('TT INV/2026/0002', ['INV/2026/0001']), false)
  // A short number turning up inside a long memo is chance, not a reference.
  assert.equal(referenceMatches('CT DEN 12345 thanh toan', ['123']), false)
  assert.equal(referenceMatches('', ['INV/2026/0001']), false)
  assert.equal(referenceMatches('   ', ['INV/2026/0001']), false)

  const adapter = await boot()
  try {
    await call(
      'account.createInvoice',
      {
        id: 'INV-MEMO',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        invoiceDate: '2026-08-15T00:00:00.000Z',
        description: 'Subscription',
        quantity: '1',
        priceUnit: '100.00',
        lineAccountId: 'revenue',
        counterpartAccountId: 'receivable',
      },
      adapter,
    )
    await call('account.postMove', { id: 'INV-MEMO' }, adapter)
    const name = String(((await call('account.getMove', { id: 'INV-MEMO' }, adapter)) as Row).name)
    await call(
      'account.importBankStatement',
      {
        id: 'statement-memo',
        bankAccountId: 'primary-bank',
        profileId: 'generic-csv',
        rows: [
          {
            date: '2026-08-16',
            amount: '100.00',
            reference: `CT DEN:998 TT ${name} thanh toan`,
            externalId: 'memo-1',
            state: 'posted',
          },
        ],
        openingBalance: '0.00',
        closingBalance: '100.00',
        sourceChecksum: 'source-memo',
      },
      adapter,
    )
    const [transaction] = (await call(
      'account_wave2_probe.rows',
      { model: 'account.BankTransaction' },
      adapter,
    )) as unknown as Row[]
    const suggested = await call(
      'account.suggestBankMatches',
      { transactionId: transaction?.id, ruleId: 'exact' },
      adapter,
    )
    assert.deepEqual((suggested.candidates as Row[])[0]?.reasons, [
      'exact_amount',
      'reference',
      'date_window',
    ])
  } finally {
    await adapter.close()
  }
})
