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
import { account, address, company, partner, product, uom } from '@ketvietlab/ketsuite'

const probe = defineModule({
  name: 'account_netting_probe',
  depends: ['account'],
  functions: {
    rows: defineFn({
      input: { model: 'text', moveId: 'id?' },
      effects: ['read:account.Move', 'read:account.MoveLine', 'read:account.PartialReconcile'],
      handler: (ctx, args) => ctx.db.select(String(args.model), args.moveId ? { moveId: args.moveId } : {}),
    }),
  },
})
const modules = [address, partner, company, uom, product, account, probe]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope, actor: 'accountant' }).then((result) => result.value as Row)

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  // Buys from the company and sells to it: the only partner a netting can name.
  await call('partner.savePartner', { id: 'both', kind: 'company', name: 'Both ways' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer only' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['payable', '331', 'Payable', 'liability_payable'],
    ['revenue', '511', 'Revenue', 'income'],
    ['expense', '642', 'Expense', 'expense'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' }, adapter)
  await call(
    'account.saveJournal',
    { id: 'purchases', name: 'Purchases', code: 'PUR', type: 'purchase' },
    adapter,
  )
  await call('account.saveJournal', { id: 'misc', name: 'Misc', code: 'KT', type: 'general' }, adapter)
  await call('account.savePaymentTerm', { id: 'net30', name: '30 Days' }, adapter)
  await call(
    'account.savePaymentTermLine',
    {
      id: 'net30:line',
      paymentId: 'net30',
      value: 'percent',
      valueAmount: '100',
      delayType: 'days_after',
      nbDays: 30,
    },
    adapter,
  )
  return adapter
}

async function document(
  adapter: Adapter,
  id: string,
  moveType: 'out_invoice' | 'in_invoice',
  partnerId: string,
  date: string,
  amount: string,
  paymentTermId?: string,
) {
  const sale = moveType === 'out_invoice'
  const created = await call(
    'account.createInvoice',
    {
      id,
      journalId: sale ? 'sales' : 'purchases',
      moveType,
      partnerId,
      invoiceDate: `${date}T00:00:00.000Z`,
      accountingDate: date,
      documentDate: date,
      ...(paymentTermId ? { paymentTermId } : {}),
      description: id,
      quantity: '1',
      priceUnit: amount,
      lineAccountId: sale ? 'revenue' : 'expense',
      counterpartAccountId: sale ? 'receivable' : 'payable',
    },
    adapter,
  )
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal((await call('account.postMove', { id }, adapter)).ok, true)
}

const residualOf = async (adapter: Adapter, moveId: string, accountId: string) => {
  const lines = (await call(
    'account_netting_probe.rows',
    { model: 'account.MoveLine', moveId },
    adapter,
  )) as unknown as Row[]
  return String(lines.find((line) => line.accountId === accountId)?.amountResidual)
}
const stateOf = async (adapter: Adapter, id: string) => {
  const moves = (await call(
    'account_netting_probe.rows',
    { model: 'account.Move' },
    adapter,
  )) as unknown as Row[]
  return String(moves.find((move) => move.id === id)?.paymentState)
}

test('netting spreads over each side due first and settles the documents it names', async () => {
  const adapter = await boot()
  try {
    // Issued first but due last: the due date, not the issue date, decides what is settled first.
    await document(adapter, 'inv-due-first', 'out_invoice', 'both', '2026-01-20', '500')
    await document(adapter, 'inv-due-later', 'out_invoice', 'both', '2026-01-10', '300', 'net30')
    await document(adapter, 'bill', 'in_invoice', 'both', '2026-01-05', '600')
    await document(adapter, 'inv-other', 'out_invoice', 'customer', '2026-01-08', '900')

    const partners = (await call('account.listNettablePartners', {}, adapter)) as unknown as Row[]
    assert.deepEqual(partners, [{ id: 'both', name: 'Both ways' }])

    // Without an amount it nets the smaller side: 600 owed by the company against 800 owed to it.
    const preview = await call('account.previewNetting', { partnerId: 'both' }, adapter)
    assert.equal(preview.ok, true)
    assert.equal(preview.receivable, '800')
    assert.equal(preview.payable, '600')
    assert.equal(preview.available, '600')
    assert.deepEqual(
      (preview.receivables as Row[]).map((row) => [row.moveId, row.applied]),
      [
        ['inv-due-first', '500'],
        ['inv-due-later', '100'],
      ],
    )
    assert.deepEqual(
      (preview.payables as Row[]).map((row) => [row.moveId, row.applied]),
      [['bill', '600']],
    )

    const exceeds = await call('account.previewNetting', { partnerId: 'both', amount: '601' }, adapter)
    assert.equal(exceeds.ok, false)
    assert.equal((exceeds.errors as Row[])[0]?.code, 'account.error.nettingExceeds')
    const refused = await call(
      'account.postNetting',
      { id: 'net-x', partnerId: 'both', amount: '601' },
      adapter,
    )
    assert.equal(refused.ok, false)

    const posted = await call(
      'account.postNetting',
      { id: 'net-1', partnerId: 'both', amount: '450', accountingDate: '2026-01-31' },
      adapter,
    )
    assert.equal(posted.ok, true, JSON.stringify(posted))
    assert.equal(posted.amount, '450')
    // The invoice due first keeps 50, the one due later is untouched, the bill keeps 150.
    assert.equal(await residualOf(adapter, 'inv-due-first', 'receivable'), '50')
    assert.equal(await residualOf(adapter, 'inv-due-later', 'receivable'), '300')
    assert.equal(await residualOf(adapter, 'bill', 'payable'), '150')
    assert.equal(await stateOf(adapter, 'inv-due-first'), 'partial')
    assert.equal(await stateOf(adapter, 'inv-due-later'), 'not_paid')
    const lines = (await call(
      'account_netting_probe.rows',
      { model: 'account.MoveLine', moveId: 'net-1' },
      adapter,
    )) as unknown as Row[]
    assert.deepEqual(
      lines
        .sort((a, b) => Number(a.sequence) - Number(b.sequence))
        .map((line) => [line.accountId, line.debit, line.credit, line.name, line.amountResidual]),
      [
        // Each line names the document it settled.
        ['payable', '450', '0', 'PUR/2026/00001', '0'],
        ['receivable', '0', '450', 'SAL/2026/00001', '0'],
      ],
    )

    // The same id again is the same netting, not a second one.
    assert.equal(
      (await call('account.postNetting', { id: 'net-1', partnerId: 'both', amount: '450' }, adapter)).ok,
      true,
    )
    assert.equal(await residualOf(adapter, 'bill', 'payable'), '150')

    // Reversing it opens the documents again.
    const reversed = await call(
      'account.reverseNetting',
      { id: 'net-1', reversalId: 'net-1-rev', reason: 'Wrong partner' },
      adapter,
    )
    assert.equal(reversed.ok, true, JSON.stringify(reversed))
    assert.equal(await residualOf(adapter, 'inv-due-first', 'receivable'), '500')
    assert.equal(await residualOf(adapter, 'inv-due-later', 'receivable'), '300')
    assert.equal(await residualOf(adapter, 'bill', 'payable'), '600')
    assert.equal(await stateOf(adapter, 'inv-due-first'), 'not_paid')
    assert.equal((await call('account.previewNetting', { partnerId: 'both' }, adapter)).available, '600')

    // A partner owing on one side only has nothing to net.
    const nothing = await call('account.postNetting', { id: 'net-2', partnerId: 'customer' }, adapter)
    assert.equal(nothing.ok, false)
    assert.equal((nothing.errors as Row[])[0]?.code, 'account.error.nothingToNet')
  } finally {
    await adapter.close()
  }
})
