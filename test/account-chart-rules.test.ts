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

const refusal = (answer: Row) => (answer.errors as Row[] | undefined)?.[0]

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  for (const [id, code, name, accountType] of [
    ['cash', '1111', 'Cash', 'asset_cash'],
    ['bank', '1121', 'Bank', 'asset_cash'],
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['input-vat', '1331', 'Input VAT', 'asset_current'],
    ['output-vat', '33311', 'Output VAT', 'liability_current'],
    ['import-duty', '33331', 'Import duty', 'liability_current'],
    ['wages', '334', 'Wages payable', 'liability_current'],
  ])
    assert.equal((await call('account.saveAccount', { id, code, name, accountType }, adapter)).ok, true)
  return adapter
}

const journal = (adapter: Adapter, type: string, defaultAccountId?: string) =>
  call(
    'account.saveJournal',
    {
      id: `${type}-journal`,
      name: type,
      code: type.toUpperCase(),
      type,
      ...(defaultAccountId ? { defaultAccountId } : {}),
    },
    adapter,
  )

const tax = (adapter: Adapter, typeTaxUse: string, accountId: string) =>
  call(
    'account.saveTax',
    {
      id: `tax-${typeTaxUse}-${accountId}`,
      name: 'Tax',
      typeTaxUse,
      amountType: 'percent',
      amount: '10',
      accountId,
    },
    adapter,
  )

test('account journals: a cash or bank journal names the cash account its money posts to', async () => {
  const adapter = await boot()
  for (const type of ['cash', 'bank']) {
    const missing = refusal(await journal(adapter, type))
    assert.equal(missing?.code, 'account.error.journalLiquidityAccount')
    assert.equal(missing?.field, 'defaultAccountId')
    const wrongType = refusal(await journal(adapter, type, 'receivable'))
    assert.equal(wrongType?.code, 'account.error.journalLiquidityAccount')
    assert.equal((await journal(adapter, type, type)).ok, true)
  }
  // Every other journal may still be saved without one.
  assert.equal((await journal(adapter, 'sale')).ok, true)
  assert.equal((await journal(adapter, 'general')).ok, true)
})

test('account taxes: a company that sets tax branches keeps each tax on its own branch', async () => {
  const adapter = await boot()
  // Before the company sets branches, any account will do.
  assert.equal((await tax(adapter, 'sale', 'wages')).ok, true)

  const saved = await call(
    'account.saveDefaults',
    { saleTaxAccountRoots: ['3331', '3333'], purchaseTaxAccountRoots: ['1331', '3333'] },
    adapter,
  )
  assert.equal(saved.ok, true)

  assert.equal((await tax(adapter, 'sale', 'output-vat')).ok, true)
  assert.equal((await tax(adapter, 'purchase', 'input-vat')).ok, true)
  // Import duty is a purchase tax owed to the state, on its own branch.
  assert.equal((await tax(adapter, 'purchase', 'import-duty')).ok, true)

  const outside = refusal(await tax(adapter, 'sale', 'wages'))
  assert.equal(outside?.code, 'account.error.taxAccountRoot')
  assert.equal(outside?.field, 'accountId')
  assert.deepEqual(outside?.params, { roots: '3331, 3333' })
  // Output VAT is not deductible VAT, whichever way round it is chosen.
  assert.equal(refusal(await tax(adapter, 'purchase', 'output-vat'))?.code, 'account.error.taxAccountRoot')
  assert.equal(refusal(await tax(adapter, 'sale', 'input-vat'))?.code, 'account.error.taxAccountRoot')
  // A tax with no use of its own is not pinned.
  assert.equal((await tax(adapter, 'none', 'wages')).ok, true)

  // Saving the screen's defaults, which never name the branches, keeps them.
  assert.equal((await call('account.saveDefaults', { receivableAccountId: 'receivable' }, adapter)).ok, true)
  const defaults = await call('account.getDefaults', {}, adapter)
  assert.deepEqual(defaults.saleTaxAccountRoots, ['3331', '3333'])
  assert.deepEqual(defaults.purchaseTaxAccountRoots, ['1331', '3333'])

  assert.equal(
    refusal(await call('account.saveDefaults', { saleTaxAccountRoots: ['33 1'] }, adapter))?.code,
    'account.error.taxAccountRootFormat',
  )
})
