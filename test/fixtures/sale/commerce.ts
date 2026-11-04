import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../../../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from '../../commerce-test-deployment.ts'
/** `worker` boots the deployment's worker, for a test that runs its scheduled jobs. */
export async function boot(t: TestContext, options: { worker?: boolean } = {}) {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, {
    worker: options.worker === true,
    ...(options.worker ? { workerNow: () => new Date() } : {}),
  })
  t.after(() => app.close())
  const fixture = async (fn: string, input: Row, company = 'acme') =>
    (await app.fixture.call<Row>(fn, input, { scope: { company, branches: null } })).value
  for (const id of ['acme', 'other']) {
    await fixture('partner.savePartner', { id: `${id}-party`, kind: 'company', name: id })
    await fixture('company.saveCompany', { id, partnerId: `${id}-party`, currency: 'VND' })
  }
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'test-password',
    name: 'Owner',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-acme', userId: 'owner', companyId: 'acme' })
  await app.client.login({ login: 'owner', password: 'test-password' })
  const call = async (fn: string, input: Row) => (await app.client.call<Row>(fn, input)).value
  const save = async (fn: string, input: Row) => {
    const result = await call(fn, input)
    assert.notEqual(result.ok, false, JSON.stringify(result))
    return result
  }
  await save('uom.savePrecision', { digits: 3 })
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  return { app, deployment, fixture, call, save }
}

export async function setup(t: TestContext, options: { worker?: boolean } = {}) {
  const run = await boot(t, options)
  const { save } = run
  await save('uom.saveUnit', { id: 'box', name: 'Box of 12', relativeUomId: 'each', relativeFactor: '12' })
  await save('uom.saveUnit', { id: 'case', name: 'Case of 24', relativeUomId: 'each', relativeFactor: '24' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    listPrice: '100',
    saleOk: true,
  })
  const variants = (await run.call('product.listVariants', { templateId: 'goods' })) as unknown as Row[]
  const productId = String(variants[0]!.id)
  await save('product.addTemplateUom', { templateId: 'goods', uomId: 'box' })
  await save('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await save('partner.grantRole', { id: 'buyer-role', partnerId: 'buyer', role: 'customer' })
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('sale.createOrder', { id: 'order', partnerId: 'buyer', warehouseId: 'wh' })
  const add = (input: Row = {}) =>
    run.call('sale.addLine', {
      id: 'line',
      orderId: 'order',
      productId,
      productUomId: 'box',
      productUomQty: '2',
      ...input,
    })
  return { ...run, productId, add }
}
