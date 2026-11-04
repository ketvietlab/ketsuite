import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { account, address, company, partner, product, uom } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, uom, product, account]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }

const call = async (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  (await callFn(name, args, { adapter, manifest, scope })).value as Row

const refusal = (answer: Row) => (answer.errors as Row[] | undefined)?.[0]?.code

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['revenue', '5111', 'Sales', 'income'],
    ['tax', '33311', 'Output VAT', 'liability_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' }, adapter)
  // The reduced rate of NQ 204/2025: it ends, it does not start, as it ran under earlier resolutions.
  const saved = await call(
    'account.saveTax',
    {
      id: 'vat8',
      name: 'GTGT 8%',
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount: '8',
      accountId: 'tax',
      validTo: '2026-12-31',
    },
    adapter,
  )
  assert.equal(saved.ok, true)
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
  return adapter
}

const invoice = (adapter: Adapter, id: string, moveType: string, date: string, taxId: string) =>
  call(
    'account.createInvoice',
    {
      id,
      journalId: 'sales',
      moveType,
      partnerId: 'customer',
      invoiceDate: `${date}T03:00:00.000Z`,
      description: 'Giỏ trái cây',
      quantity: '1',
      priceUnit: '1000000',
      lineAccountId: 'revenue',
      counterpartAccountId: 'receivable',
      taxIds: [taxId],
    },
    adapter,
  )

test('account taxes: a rate applies to documents up to its last day and no later', async () => {
  const adapter = await boot()
  try {
    assert.equal((await invoice(adapter, 'dec', 'out_invoice', '2026-12-31', 'vat8')).ok, true)
    assert.equal((await call('account.postMove', { id: 'dec' }, adapter)).ok, true)

    const jan = await invoice(adapter, 'jan', 'out_invoice', '2027-01-01', 'vat8')
    assert.equal(jan.ok, false)
    assert.equal(refusal(jan), 'account.error.taxOutOfEffect')
    assert.equal((await invoice(adapter, 'jan', 'out_invoice', '2027-01-01', 'vat10')).ok, true)

    const on = async (date: string) =>
      ((await call('account.listTaxes', { typeTaxUse: 'sale', on: date }, adapter)) as unknown as Row[]).map(
        (tax) => tax.id,
      )
    assert.deepEqual((await on('2026-12-31')).sort(), ['vat10', 'vat8'])
    assert.deepEqual(await on('2027-01-01'), ['vat10'])
  } finally {
    await adapter.close()
  }
})

test('account taxes: refunds and reversals of the earlier period keep the ended rate', async () => {
  const adapter = await boot()
  try {
    assert.equal((await invoice(adapter, 'dec', 'out_invoice', '2026-12-20', 'vat8')).ok, true)
    assert.equal((await call('account.postMove', { id: 'dec' }, adapter)).ok, true)

    // A return of December's goods, credited in January at December's rate.
    assert.equal((await invoice(adapter, 'credit', 'out_refund', '2027-01-10', 'vat8')).ok, true)
    assert.equal((await call('account.postMove', { id: 'credit' }, adapter)).ok, true)

    const reversed = await call(
      'account.reverseMove',
      { id: 'dec', reversalId: 'dec:reversal', accountingDate: '2027-01-15', journalId: 'sales' },
      adapter,
    )
    assert.equal(reversed.ok, true, JSON.stringify(reversed))
  } finally {
    await adapter.close()
  }
})

test('account taxes: posting refuses a draft whose rate ended before its date', async () => {
  const adapter = await boot()
  try {
    // Drafted while the rate still covered its date; the rate's end then moves earlier.
    assert.equal((await invoice(adapter, 'late', 'out_invoice', '2026-12-30', 'vat8')).ok, true)
    assert.equal(
      (
        await call(
          'account.saveTax',
          {
            id: 'vat8',
            name: 'GTGT 8%',
            typeTaxUse: 'sale',
            amountType: 'percent',
            amount: '8',
            accountId: 'tax',
            validTo: '2026-12-15',
          },
          adapter,
        )
      ).ok,
      true,
    )
    const posted = await call('account.postMove', { id: 'late' }, adapter)
    assert.equal(posted.ok, false)
    assert.equal(refusal(posted), 'account.error.taxOutOfEffect')
    assert.equal(((await call('account.getMove', { id: 'late' }, adapter)) as Row).state, 'draft')
  } finally {
    await adapter.close()
  }
})

test('account taxes: dates are kept across edits and must run forwards', async () => {
  const adapter = await boot()
  try {
    const base = { name: 'GTGT 8%', typeTaxUse: 'sale', amountType: 'percent', amount: '8', accountId: 'tax' }
    // An edit that leaves the dates out keeps them.
    assert.equal((await call('account.saveTax', { id: 'vat8', ...base, amount: '8.0' }, adapter)).ok, true)
    const kept = ((await call('account.listTaxes', {}, adapter)) as unknown as Row[]).find(
      (tax) => tax.id === 'vat8',
    )!
    assert.equal(String(kept.validTo).slice(0, 10), '2026-12-31')

    const backwards = await call('account.saveTax', { id: 'vat8', ...base, validFrom: '2027-01-01' }, adapter)
    assert.equal(backwards.ok, false)
    assert.equal(refusal(backwards), 'account.error.taxEffectRange')

    // Cleared, the rate is open-ended again.
    assert.equal((await call('account.saveTax', { id: 'vat8', ...base, validTo: null }, adapter)).ok, true)
    assert.equal((await invoice(adapter, 'later', 'out_invoice', '2027-03-01', 'vat8')).ok, true)
  } finally {
    await adapter.close()
  }
})
