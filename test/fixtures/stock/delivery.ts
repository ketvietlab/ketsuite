import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from '../sale/commerce.ts'
import { sql } from './landed-costs.ts'

/**
 * K45–K49: a company that ships its sales order of 300 000 đ with a carrier of its own, on 31 January 2030,
 * with its stock journal, the shipping accounts and a bank journal.
 */
export async function seed(t: TestContext, options: { onDelivery?: boolean; books?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  if (options.books !== false) {
    for (const [id, accountType, reconcile] of [
      ['156', 'asset_current', false],
      ['151', 'asset_current', false],
      ['331', 'liability_payable', true],
      ['1541', 'asset_current', false],
      ['632', 'expense_direct_cost', false],
      ['711', 'income_other', false],
      ['811', 'expense', false],
      ['641', 'expense', false],
      ['1388', 'asset_receivable', true],
      ['131', 'asset_receivable', true],
      ['1121', 'asset_cash', false],
    ] as const)
      await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile })
    await r.save('account.saveJournal', { id: 'kho', name: 'Kho', code: 'KHO', type: 'general' })
    await r.save('account.saveJournal', {
      id: 'bank',
      name: 'Ngân hàng',
      code: 'NH',
      type: 'bank',
      defaultAccountId: '1121',
    })
    await r.save('stock.saveAccountingSetting', {
      journalId: 'kho',
      valuationAccountId: '156',
      supplierAccountId: '151',
      productionAccountId: '1541',
      cogsAccountId: '632',
      gainAccountId: '711',
      lossAccountId: '811',
      deliveryFeeAccountId: '641',
      carrierCodAccountId: '1388',
      receivableAccountId: '131',
      carrierPayableAccountId: '331',
    })
  }
  await r.save('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'each',
  })
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '150000' })
  if (options.onDelivery !== false) {
    await r.save('account.savePaymentTerm', { id: 'now', name: 'Immediate' })
    await r.save('account.savePaymentTermLine', {
      id: 'now:line',
      paymentId: 'now',
      value: 'percent',
      valueAmount: '100',
      delayType: 'days_after',
      nbDays: 0,
    })
    await r.app.adapter!.run(sql(`UPDATE sale_order SET "paymentTermId" = ? WHERE id = ?`), ['now', 'order'])
  }
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  // GHN: 20 000 đ the first kilogram, 5 000 đ each one begun after it, 1.5% of what it collects.
  await r.save('stock.saveCarrier', {
    id: 'ghn',
    code: 'GHN',
    name: 'Giao Hàng Nhanh',
    baseFee: '20000',
    extraKgFee: '5000',
    codFeeRate: '1.5',
  })
  const reserve = async (pickingId = 'order:delivery') => {
    for (const move of ((await r.call('stock.getPicking', { id: pickingId })).moves as Row[]) ?? [])
      await r.save('stock.reserveMove', { id: move.id })
  }
  const shipment = (id = 'parcel') => r.call('stock.getShipment', { id })
  const make = (id = 'parcel', pickingId = 'order:delivery') =>
    r.call('stock.createShipment', { id, pickingId })
  /** A parcel booked and handed to the carrier. */
  const ship = async (id = 'parcel', values: Row = {}) => {
    await r.save('stock.createShipment', { id, pickingId: 'order:delivery' })
    await r.save('stock.bookShipment', { id, weight: '1.2', ...values })
    await reserve()
    await r.save('stock.handOverShipment', { id })
  }
  const entry = async (id: unknown) =>
    (
      await r.app.adapter!.all(
        sql(
          `SELECT "accountId", debit, credit, "partnerId" FROM account_move_line WHERE "moveId" = ? ORDER BY sequence`,
        ),
        [id],
      )
    ).map((row) => [row.accountId, Number(row.debit), Number(row.credit), row.partnerId ?? null])
  const entryHead = async (id: unknown) =>
    (
      await r.app.adapter!.all(
        sql(`SELECT "journalId", "accountingDate", state, ref FROM account_move WHERE id = ?`),
        [id],
      )
    ).map((row) => [row.journalId, String(row.accountingDate).slice(0, 10), row.state, row.ref])[0]
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
  const done = (answer: Row) => assert.equal(answer.ok, true, JSON.stringify(answer))
  return { ...r, reserve, shipment, make, ship, entry, entryHead, refusal, signIn, done }
}
