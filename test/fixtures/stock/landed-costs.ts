import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from '../sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
export const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

/** K64: a company with a stock journal, a goods vendor and a carrier, on 31 January 2030. */
export async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  await r.save('partner.savePartner', { id: 'carrier', kind: 'company', name: 'Carrier' })
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  for (const [id, accountType, reconcile] of [
    ['156', 'asset_current', false],
    ['331', 'liability_payable', true],
    ['1541', 'asset_current', false],
    ['632', 'expense_direct_cost', false],
    ['711', 'income_other', false],
    ['811', 'expense', false],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile })
  await r.save('account.saveJournal', { id: 'kho', name: 'Kho', code: 'KHO', type: 'general' })
  await r.save('stock.saveAccountingSetting', {
    journalId: 'kho',
    valuationAccountId: '156',
    supplierAccountId: '331',
    productionAccountId: '1541',
    cogsAccountId: '632',
    gainAccountId: '711',
    lossAccountId: '811',
  })
  const transfer = async (id: string, type: string, quantity: string, extra: Row = {}) => {
    await r.save('stock.createPicking', { id, name: id, pickingTypeId: `wh:${type}`, ...extra })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
      ...extra,
    })
    await r.save('stock.confirmPicking', { id })
  }
  const complete = async (id: string) =>
    assert.equal((await r.call('stock.completePicking', { id, createBackorder: false })).ok, true, id)
  /** A completed receipt from the vendor of `quantity` at `unitCost`. */
  const receive = async (id: string, quantity: string, unitCost: string) => {
    await transfer(id, 'incoming', quantity)
    await r.app.adapter!.run(sql(`UPDATE stock_picking SET "partnerId" = ? WHERE id = ?`), ['vendor', id])
    await r.save('stock.saveMoveLine', { id: `${id}-line`, moveId: `${id}-move`, quantity })
    await r.save('stock.setReceiptUnitCost', { id: `${id}-line`, unitCost })
    await complete(id)
  }
  const deliver = async (id: string, quantity: string) => {
    await transfer(id, 'outgoing', quantity)
    await r.save('stock.reserveMove', { id: `${id}-move` })
    await complete(id)
  }
  const held = async () => {
    const [row] = await r.app.adapter!.all(sql(`SELECT quantity, value FROM stock_product_valuation`))
    return [Number(row!.quantity), Number(row!.value)]
  }
  const cost = async () =>
    Number((await r.app.adapter!.all(sql(`SELECT "standardPrice" FROM product_cost`)))[0]!.standardPrice)
  const entry = async (id: string) =>
    (
      await r.app.adapter!.all(
        sql(
          `SELECT "accountId", debit, credit, "partnerId" FROM account_move_line WHERE "moveId" = ? ORDER BY sequence`,
        ),
        [id],
      )
    ).map((row) => [row.accountId, Number(row.debit), Number(row.credit), row.partnerId ?? null])
  const draft = (args: Row = {}) =>
    r.call('stock.saveLandedCost', {
      id: 'lc',
      vendorId: 'carrier',
      date: '2030-01-30',
      pickingIds: ['r1'],
      lines: [{ name: 'Freight', splitMethod: 'quantity', amount: '360000' }],
      ...args,
    })
  const refusal = (answer: Row) => [
    (answer.errors as Row[] | undefined)?.[0]?.field,
    (answer.errors as Row[] | undefined)?.[0]?.messageKey,
  ]
  /** A user holding one Commerce role template, signed in. */
  const signIn = async (roleId: string) => {
    const id = roleId.replace('commerce.', '')
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    const client = r.app.client.anonymous()
    await client.login({ login: id, password: 'test-password' })
    return client
  }
  return { ...r, transfer, complete, receive, deliver, held, cost, entry, draft, refusal, signIn }
}
