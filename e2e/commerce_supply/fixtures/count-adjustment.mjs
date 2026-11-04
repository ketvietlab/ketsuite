// Isolated commerce fixture for #2014. Loopback only; never mounted in an application deployment.
import { createServer } from 'node:http'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { createCommerceDeployment } from '../../../.build/packages/ketsuite/src/deployment.js'

export async function countFixture(port = 4315) {
  const app = await createTestDeployment(createCommerceDeployment(), { worker: false })
  try {
    const fixture = async (name, input) => {
      const result = await app.fixture.call(name, input, { scope: { company: 'test', branches: null } })
      if (result.value?.ok === false) throw new Error(`${name} refused the fixture`)
      return result.value
    }
    await fixture('partner.savePartner', { id: 'company', name: 'Inventory test company', kind: 'company' })
    await fixture('company.saveCompany', { id: 'test', partnerId: 'company', currency: 'VND' })
    await app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
    const clients = new Map()
    for (const [id, role] of [
      ['keeper', 'commerce.warehouse-operator'],
      ['manager', 'commerce.warehouse-manager'],
      ['accountant', 'commerce.accountant'],
    ]) {
      await fixture('user.createUser', {
        id,
        login: id,
        password: 'isolated-test-only',
        name: id,
        defaultCompanyId: 'test',
      })
      await fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'test' })
      await fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId: role })
      const client = app.client.anonymous()
      await client.login({ login: id, password: 'isolated-test-only' })
      clients.set(id, client)
    }
    await fixture('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
    await fixture('product.saveRecord', {
      id: 'goods',
      name: 'Goods',
      defaultCode: 'GOODS',
      type: 'goods',
      uomId: 'each',
      listPrice: '2000',
      saleOk: true,
    })
    const productId = (await fixture('product.listVariants', { templateId: 'goods' }))[0].id
    await fixture('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
    await fixture('product.setCost', { productId, standardPrice: '1000' })
    await fixture('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
    for (const [code, accountType] of [
      ['156', 'asset_current'],
      ['151', 'asset_current'],
      ['1541', 'asset_current'],
      ['632', 'expense_direct_cost'],
      ['13811', 'asset_receivable'],
      ['33811', 'liability_current'],
    ])
      await fixture('account.saveAccount', { id: code, code, name: code, accountType })
    await fixture('account.saveJournal', { id: 'kho', name: 'Stock', code: 'KHO', type: 'general' })
    await fixture('stock.saveAccountingSetting', {
      journalId: 'kho',
      valuationAccountId: '156',
      supplierAccountId: '151',
      productionAccountId: '1541',
      cogsAccountId: '632',
      lossAccountId: '13811',
      gainAccountId: '33811',
    })
    await fixture('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
    // Privileged opening balance belongs to fixture setup; user actions cross HTTP below.
    await fixture('stock.adjustInventory', {
      id: 'opening',
      productId,
      locationId: 'wh:stock',
      inventoryLocationId: 'adjustment',
      productUomId: 'each',
      countedQuantity: '10',
    })
    const server = createServer(async (req, res) => {
      try {
        if (req.url.startsWith('/_fixture/role/')) {
          const client = clients.get(req.url.split('/').at(-1))
          if (!client) {
            res.writeHead(404)
            res.end()
            return
          }
          res.writeHead(303, {
            'Set-Cookie': Object.entries(client.jar.toJSON()).map(
              ([key, value]) => `${key}=${value}; Path=/; HttpOnly; SameSite=Lax`,
            ),
            Location: '/admin/stock/inventory?lang=vi',
          })
          res.end()
          return
        }
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers))
          if (value && !['host', 'connection', 'content-length', 'accept-encoding'].includes(key))
            headers.set(key, Array.isArray(value) ? value.join(',') : value)
        if (headers.has('origin')) headers.set('origin', app.baseUrl)
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const upstream = await fetch(app.baseUrl + req.url, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
          redirect: 'manual',
        })
        const outgoing = {}
        for (const [key, value] of upstream.headers)
          if (!['content-length', 'content-encoding', 'transfer-encoding', 'set-cookie'].includes(key))
            outgoing[key] =
              key === 'location' ? value.replace(app.baseUrl, `http://127.0.0.1:${port}`) : value
        if (upstream.headers.getSetCookie().length) outgoing['set-cookie'] = upstream.headers.getSetCookie()
        res.writeHead(upstream.status, outgoing)
        res.end(Buffer.from(await upstream.arrayBuffer()))
      } catch {
        res.writeHead(500)
        res.end('Fixture request failed')
      }
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    return {
      app,
      clients,
      productId,
      url: `http://127.0.0.1:${port}`,
      close: async () => {
        await new Promise((resolve) => server.close(resolve))
        await app.close()
      },
    }
  } catch (error) {
    await app.close()
    throw error
  }
}
