import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { sqliteStore } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

test('Commerce inventory lifecycle shares reasons, history, revisions and atomicity with the web', async (t) => {
  const app = await boot(t)
  const fixture = async (fn: string, input: Row = {}, company = 'acme') =>
    (await app.fixture.call<Row>(fn, input, { scope: { company, branches: null } })).value
  for (const fnKey of ['product.templateModalContext', 'product.getTemplate'])
    await fixture('user.grantFunction', { id: `lifecycle:${fnKey}`, roleId: 'inventory-reader', fnKey })
  await app.client.login({ login: 'inventory-user', password: 'correct horse battery' })
  const bootstrap = await app.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const detail = async (id = 'bag') =>
    (await app.client.json<Envelope<Row>>(`/api/staff/v1/inventory/products/${id}`)).data
  let sequence = 0
  const command = (action: 'archive' | 'restore', version: unknown, reason?: string, id = 'bag') =>
    app.client.request(`/api/staff/v1/inventory/products/${id}/${action}`, {
      method: 'POST',
      headers: mutationHeaders(bootstrap.data.csrfToken, `lifecycle-${++sequence}`, String(version)),
      body: JSON.stringify({ expectedVersion: version, ...(reason === undefined ? {} : { reason }) }),
    })
  const record = () => fixture('product.getTemplate', { id: 'bag-template' })
  const history = async () => {
    const context = (await app.client.call<Row>('product.templateModalContext', { id: 'bag-template' })).value
    return (context.data as Row).lifecycle as Row[]
  }
  const initial = await detail()
  for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
    const response = await command('archive', initial.version, reason)
    assert.equal(response.status, 422, await response.text())
  }
  assert.equal((await detail()).version, initial.version)
  assert.deepEqual(await history(), [])

  // This inactive SKU is not part of the template's archive cascade.
  assert.equal(
    (
      await fixture('product.saveVariant', {
        id: 'bag-retired',
        templateId: 'bag-template',
        combinationKey: 'manual:retired',
      })
    ).ok,
    true,
  )
  await app.adapter!.exec(
    "UPDATE product_product SET active = false WHERE id = 'bag-retired' AND \"companyId\" = 'acme'",
  )
  const before = await record()
  const afterVariant = await detail()
  assert.notEqual(afterVariant.version, initial.version, 'a catalogue SKU change invalidates native detail')
  assert.equal((await command('archive', initial.version, 'Stale before SKU change')).status, 409)
  const archived = await command('archive', afterVariant.version, '  End of season  ')
  assert.equal(archived.status, 200, await archived.clone().text())
  const archiveData = ((await archived.json()) as Envelope<Row>).data
  const events = await history()
  assert.equal(events.length, 1)
  assert.equal(events[0]?.reason, 'End of season')
  assert.equal(events[0]?.actor, 'inventory-user')
  assert.equal(events[0]?.active, false)
  assert.notEqual((await record()).revisionId, before.revisionId)
  const staleWeb = await fixture('product.saveTemplate', {
    id: 'bag-template',
    name: 'Stale web edit',
    type: 'goods',
    expectedRevisionId: before.revisionId,
  })
  assert.equal(staleWeb.ok, false, 'a native lifecycle change invalidates a web draft')
  assert.equal((await command('restore', initial.version)).status, 409)
  const restored = await command('restore', archiveData.version)
  assert.equal(restored.status, 200, await restored.text())
  const variants = (await record()).variants as Row[]
  assert.equal(variants.find((row) => row.id === 'bag')?.active, true)
  assert.equal(variants.find((row) => row.id === 'bag-retired')?.active, false)
  assert.equal((await history()).length, 2)
  assert.deepEqual(
    (await detail('bag-retired')).availableActions,
    ['update'],
    'template restore cannot revive a separately retired SKU',
  )

  // Even a web-only change outside the inventory projection must invalidate its version.
  const beforeWeb = await detail()
  const current = await record()
  assert.equal(
    (
      await fixture('product.saveTemplate', {
        id: 'bag-template',
        name: current.name,
        type: 'goods',
        description: 'Changed on the web',
        expectedRevisionId: current.revisionId,
      })
    ).ok,
    true,
  )
  assert.notEqual((await detail()).version, beforeWeb.version)
  assert.equal((await command('archive', beforeWeb.version, 'Stale native edit')).status, 409)

  // Storage failure after the state write rolls back both revisions and every SKU.
  const beforeFailure = await detail()
  const pg = Boolean(process.env.KET_COMMERCE_PG)
  if (pg) {
    await app.adapter!.exec(
      "CREATE FUNCTION reject_inventory_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected event failure'; END $$",
    )
    await app.adapter!.exec(
      'CREATE TRIGGER reject_inventory_event BEFORE INSERT ON product_template_state_event FOR EACH ROW EXECUTE FUNCTION reject_inventory_event()',
    )
  } else {
    await app.adapter!.exec(
      "CREATE TRIGGER reject_inventory_event BEFORE INSERT ON product_template_state_event BEGIN SELECT RAISE(ABORT, 'injected event failure'); END",
    )
  }
  const failed = await command('archive', beforeFailure.version, 'Will roll back')
  assert.equal(failed.status, 500)
  assert.equal((await detail()).version, beforeFailure.version)
  assert.equal((await record()).active, true)
  assert.equal((await history()).length, 2)
  await app.adapter!.exec(
    pg
      ? 'DROP TRIGGER reject_inventory_event ON product_template_state_event'
      : 'DROP TRIGGER reject_inventory_event',
  )
  if (pg) await app.adapter!.exec('DROP FUNCTION reject_inventory_event()')

  await fixture('stock.createPicking', {
    id: 'pending-bag',
    name: 'Open transfer',
    pickingTypeId: 'wh:outgoing',
  })
  await fixture('stock.addMove', {
    id: 'pending-bag-line',
    name: 'Bag',
    pickingId: 'pending-bag',
    productId: 'bag',
    productUomId: 'unit',
    productUomQty: '1',
  })
  const inUse = await command('archive', (await detail()).version, 'Still in a document')
  assert.equal(inUse.status, 409, await inUse.text())
  assert.equal((await record()).active, true)
  assert.equal((await history()).length, 2)

  await fixture('partner.savePartner', { id: 'other-party', name: 'Other Company', kind: 'company' })
  await fixture('company.saveCompany', { id: 'other', partnerId: 'other-party', currency: 'VND' })
  await fixture('uom.saveUnit', { id: 'other-unit', name: 'Each', relativeFactor: '1' }, 'other')
  await fixture(
    'product.saveTemplate',
    { id: 'foreign', name: 'Foreign', type: 'goods', uomId: 'other-unit' },
    'other',
  )
  assert.equal(
    (await command('archive', beforeFailure.version, 'Wrong company', 'foreign:default')).status,
    404,
  )
  const denied = await app.client.call<Row>('stock.setInventoryProductActive', {
    id: 'foreign:default',
    active: false,
    reason: 'Wrong company',
    expectedRevision: 0,
  })
  assert.equal(denied.value.ok, false)
  assert.equal((await fixture('product.getTemplate', { id: 'foreign' }, 'other')).active, true)
})

const boot = async (t: TestContext, openingCost?: string) => {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const e2e = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'inventory-user',
    login: 'inventory-user',
    password: 'correct horse battery',
    name: 'Inventory User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'inventory-user:acme',
    userId: 'inventory-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'inventory-reader', name: 'Inventory reader' })
  for (const fnKey of [
    'product.listVariants',
    'product.getVariantSummary',
    'stock.listProductConfigs',
    'stock.listProductAvailability',
    'stock.getProductStockView',
    'stock.listLocations',
    'stock.listRoutes',
    'stock.saveInventoryProduct',
    'stock.setInventoryProductActive',
    'stock.deleteInventoryProduct',
    'stock.requestInventoryCount',
    'uom.listUnits',
    'product.listCategories',
    'product.listVariantCosts',
    'product_media.listPrimaryMedia',
    'company.getCompany',
  ])
    await fixture('user.grantFunction', {
      id: `inventory-reader:${fnKey}`,
      roleId: 'inventory-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'inventory-user:inventory-reader',
    userId: 'inventory-user',
    roleId: 'inventory-reader',
  })

  await fixture('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  for (const template of [
    {
      id: 'mango-template',
      name: 'Xoài Cát',
      type: 'goods',
      saleOk: true,
      purchaseOk: true,
    },
    {
      id: 'bag-template',
      name: 'Túi giấy',
      type: 'goods',
      saleOk: true,
      purchaseOk: false,
    },
    {
      id: 'old-template',
      name: 'Hàng cũ',
      type: 'goods',
      saleOk: false,
      purchaseOk: false,
    },
    {
      id: 'service-template',
      name: 'Gói quà',
      type: 'service',
      saleOk: true,
      purchaseOk: false,
    },
  ]) {
    const savedTemplate = await fixture('product.saveTemplate', {
      ...template,
      uomId: 'unit',
      listPrice: '0',
    })
    assert.equal(savedTemplate.value.ok, true, JSON.stringify(savedTemplate.value))
    const savedVariant = await fixture('product.saveVariant', {
      id: template.id.replace('-template', ''),
      templateId: template.id,
      combinationKey: '',
      ...(template.id === 'mango-template' ? { defaultCode: 'XCAT-01', barcode: '893000000008' } : {}),
    })
    assert.equal(savedVariant.value.ok, true, JSON.stringify(savedVariant.value))
  }
  if (openingCost) {
    const savedCost = await fixture('product.setCost', { productId: 'mango', standardPrice: openingCost })
    assert.equal(savedCost.value.ok, true)
  }
  await fixture('stock.configureProduct', {
    templateId: 'mango-template',
    isStorable: true,
    tracking: 'none',
  })
  await fixture('stock.configureProduct', {
    templateId: 'bag-template',
    isStorable: false,
    tracking: 'none',
  })
  // With the website catalogue composed, a product is archived against the revision that
  // was read, and only once the archive is confirmed.
  const oldTemplate = await fixture('product.getTemplate', { id: 'old-template' })
  await fixture('product.archiveTemplate', {
    id: 'old-template',
    active: false,
    reason: 'Discontinued',
    expectedRevisionId: (oldTemplate.value as { revisionId: string }).revisionId,
    confirmed: true,
  })
  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await fixture('stock.saveLocation', { id: 'inventory-loss', name: 'Inventory loss', usage: 'inventory' })
  await fixture('stock.adjustInventory', {
    id: 'adjust-mango',
    productId: 'mango',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory-loss',
    countedQuantity: '7',
    productUomId: 'unit',
  })
  await fixture('storage.createAttachment', {
    id: 'mango-image',
    name: 'Mango image',
    resModel: 'product.Template',
    resId: 'mango-template',
    resField: 'media',
    kind: 'url',
    url: 'https://cdn.example.test/mango.png',
    mimetype: 'image/png',
    size: 0,
    public: false,
    createdAt: '2026-09-01T00:00:00.000Z',
  })
  await fixture('product_media.attachMedia', {
    id: 'media:mango-image',
    attachmentId: 'mango-image',
    templateId: 'mango-template',
  })
  return e2e
}

test('staff inventory channel pages active goods with stock and channel evidence', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products')).status, 401)
  await e2e.client.login({ login: 'inventory-user', password: 'correct horse battery' })

  const all = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/inventory/products?limit=50',
    )
  ).data
  assert.deepEqual(
    all.items.map((item) => item.id),
    ['bag', 'mango'],
  )

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/inventory/products?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [
    {
      id: 'bag',
      name: 'Túi giấy',
      active: true,
      kind: 'consumable',
      sku: null,
      barcode: null,
      uom: { id: 'unit', name: 'Đơn vị' },
      availableQuantity: '0',
      salePrice: { currency: 'VND', amount: '0' },
      cost: { currency: 'VND', amount: '0' },
      channels: { sales: true, purchase: false, pointOfSale: true },
      hasImage: false,
    },
  ])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/inventory/products?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.equal(second.items[0]?.id, 'mango')
  assert.equal(second.items[0]?.availableQuantity, '7')
  assert.equal(second.items[0]?.hasImage, true)
  assert.equal(second.nextCursor, null)

  const archived = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/inventory/products?status=archived')
  ).data
  assert.deepEqual(
    archived.items.map((item) => item.id),
    ['old'],
  )
  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products?query=x')).status, 422)
})

test('staff inventory channel returns managed stock positions and strong versions', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'inventory-user', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/inventory/products/mango')
  assert.equal(response.status, 200)
  const detail = (await response.json()) as Envelope<Row>
  assert.match(String(detail.data.version), /^ipv_[0-9a-f]{64}$/)
  assert.equal(response.headers.get('etag'), `"${String(detail.data.version)}"`)
  assert.equal(detail.data.availableQuantity, '7')
  assert.equal(detail.data.tracking, 'none')
  assert.equal(detail.data.categoryId, null)
  assert.equal(detail.data.hasImage, true)
  assert.equal('variants' in detail.data, false)
  assert.equal(detail.data.readOnly, false)
  assert.deepEqual(detail.data.availableActions, ['update', 'archive', 'adjust_stock'])
  const stock = (detail.data.stockPositions as Row[]).find((position) => position.locationId === 'wh:stock')
  assert.deepEqual(stock, {
    locationId: 'wh:stock',
    locationName: 'Stock',
    lotId: null,
    lotName: null,
    quantity: '7',
    version: stock?.version,
    requiresLotName: false,
  })
  assert.match(String(stock?.version), /^sav_[0-9a-f]{64}$/)

  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products/service')).status, 404)
  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products/missing')).status, 404)
})

test('staff inventory version tracks the unit label it resolves elsewhere', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'inventory-user', password: 'correct horse battery' })
  const read = async () => {
    const response = await e2e.client.get('/api/staff/v1/inventory/products/mango')
    const body = (await response.json()) as Envelope<Row>
    return {
      version: String(body.data.version),
      etag: response.headers.get('etag'),
      uom: String((body.data.uom as Row).name),
    }
  }
  const before = await read()
  // The unit name is resolved from uom, not from the product row.
  await e2e.fixture.call<Row>(
    'uom.saveUnit',
    { id: 'unit', name: 'Thùng carton', relativeFactor: '1' },
    { scope: { company: 'acme', branches: null } },
  )
  const after = await read()
  assert.equal(after.uom, 'Thùng carton')
  assert.notEqual(after.version, before.version)
  assert.equal(after.etag, `"${after.version}"`)
})

const mutationHeaders = (csrfToken: string, key: string, version?: string) => ({
  'content-type': 'application/json',
  'x-csrf-token': csrfToken,
  'idempotency-key': key,
  ...(version ? { 'if-match': `"${version}"` } : {}),
})

const inventoryDraft = (name: string) => ({
  name,
  kind: 'storable',
  uomId: 'unit',
  categoryId: null,
  salePrice: '120000',
  cost: '80000',
  channels: { sales: true, purchase: true, pointOfSale: true },
  tracking: 'none',
  sku: name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .slice(0, 20),
  barcode: null,
})

test('staff inventory channel completes the eight-operation module with one versioned lifecycle', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'inventory-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const options = await e2e.client.json<Envelope<Row>>('/api/staff/v1/inventory/products/management/options')
  assert.ok((options.data.uoms as Row[]).some((item) => item.id === 'unit'))
  assert.ok((options.data.locations as Row[]).some((item) => item.id === 'wh:stock'))
  assert.equal(options.data.costVisible, true)

  const draft = inventoryDraft('Nước ép xoài')
  assert.equal(
    (
      await e2e.client.request('/api/staff/v1/inventory/products/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'inventory-create-1' },
        body: JSON.stringify(draft),
      })
    ).status,
    403,
  )
  const create = await e2e.client.request('/api/staff/v1/inventory/products/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'inventory-create-1'),
    body: JSON.stringify(draft),
  })
  assert.equal(create.status, 200)
  const created = (await create.json()) as Envelope<Row>
  const id = String(created.data.id)
  assert.match(id, /^staff_inv_p_[0-9a-f]{32}$/)
  assert.match(String(created.data.version), /^ipv_[0-9a-f]{64}$/)
  assert.deepEqual(created.data.salePrice, { currency: 'VND', amount: '120000' })
  assert.deepEqual(created.data.cost, { currency: 'VND', amount: '80000' })
  assert.equal(create.headers.get('etag'), `"${String(created.data.version)}"`)

  const replay = await e2e.client.request('/api/staff/v1/inventory/products/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'inventory-create-1'),
    body: JSON.stringify(draft),
  })
  assert.equal(replay.status, 200)
  assert.equal(((await replay.json()) as Envelope<Row>).data.id, id)

  const updateBody = {
    ...draft,
    name: 'Nước ép xoài 1L',
    salePrice: '125000',
    expectedVersion: created.data.version,
  }
  const competingBody = { ...updateBody, name: 'Nước ép xoài cạnh tranh', salePrice: '126000' }
  const concurrent = await Promise.all([
    e2e.client.request(`/api/staff/v1/inventory/products/${id}/update`, {
      method: 'PUT',
      headers: mutationHeaders(csrf, 'inventory-update-1', String(created.data.version)),
      body: JSON.stringify(updateBody),
    }),
    e2e.client.request(`/api/staff/v1/inventory/products/${id}/update`, {
      method: 'PUT',
      headers: mutationHeaders(csrf, 'inventory-update-2', String(created.data.version)),
      body: JSON.stringify(competingBody),
    }),
  ])
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409])
  const update = concurrent.find((response) => response.status === 200)!
  const updated = (await update.json()) as Envelope<Row>
  assert.ok(['Nước ép xoài 1L', 'Nước ép xoài cạnh tranh'].includes(String(updated.data.name)))
  assert.notEqual(updated.data.version, created.data.version)

  const stale = await e2e.client.request(`/api/staff/v1/inventory/products/${id}/update`, {
    method: 'PUT',
    headers: mutationHeaders(csrf, 'inventory-update-stale', String(created.data.version)),
    body: JSON.stringify(updateBody),
  })
  assert.equal(stale.status, 409)
  assert.equal(
    ((await stale.json()) as Envelope<null>).error?.code,
    'inventory_staff_channel.versionConflict',
  )

  const zero = (updated.data.stockPositions as Row[]).find(
    (position) => position.locationId === 'wh:stock' && position.lotId == null,
  )!
  assert.equal(zero.quantity, '0')
  const adjust = await e2e.client.request(`/api/staff/v1/inventory/products/${id}/stock-adjustments`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'inventory-adjust-1'),
    body: JSON.stringify({
      locationId: 'wh:stock',
      lotId: null,
      countedQuantity: '5',
      expectedVersion: zero.version,
      reason: 'Kiểm kê đầu ca',
    }),
  })
  assert.equal(adjust.status, 200)
  const adjusted = (await adjust.json()) as Envelope<Row>
  assert.equal(adjusted.data.outcome, 'counting')
  assert.ok(adjusted.data.sessionId)
  assert.match(String(adjusted.data.href), /stock.countSession/)

  const canonical = await e2e.client.json<Envelope<Row>>(`/api/staff/v1/inventory/products/${id}`)
  assert.equal(
    (canonical.data.stockPositions as Row[]).find((position) => position.locationId === 'wh:stock')?.quantity,
    '0',
  )
  const archive = await e2e.client.request(`/api/staff/v1/inventory/products/${id}/archive`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'inventory-archive-1', String(canonical.data.version)),
    body: JSON.stringify({ expectedVersion: canonical.data.version, reason: 'End of season' }),
  })
  assert.equal(archive.status, 200)
  const archived = (await archive.json()) as Envelope<Row>
  assert.equal(archived.data.active, false)
  assert.deepEqual(archived.data.availableActions, ['update', 'restore'])

  const restore = await e2e.client.request(`/api/staff/v1/inventory/products/${id}/restore`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'inventory-restore-1', String(archived.data.version)),
    body: JSON.stringify({ expectedVersion: archived.data.version }),
  })
  assert.equal(restore.status, 200)
  assert.equal(((await restore.json()) as Envelope<Row>).data.active, true)

  // Deleting a product is withheld. The guard behind it reads stock history and
  // nothing else, so a product a draft quotation still names passes it and the
  // order line is left pointing at nothing. The route is absent until the
  // reference check exists, and its absence is the thing worth holding.
  const pristineCreate = await e2e.client.request('/api/staff/v1/inventory/products/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'inventory-create-pristine'),
    body: JSON.stringify(inventoryDraft('Hàng mẫu')),
  })
  assert.equal(pristineCreate.status, 200)
  const pristine = (await pristineCreate.json()) as Envelope<Row>
  const pristineId = String(pristine.data.id)
  const deletion = await e2e.client.request(`/api/staff/v1/inventory/products/${pristineId}/delete`, {
    method: 'DELETE',
    headers: mutationHeaders(csrf, 'inventory-delete-pristine', String(pristine.data.version)),
    body: JSON.stringify({ expectedVersion: pristine.data.version }),
  })
  // Nothing under the prefix answers for that path any more, so the request
  // falls through to the site rather than the channel. What matters is the
  // product: it is still there, and the detail still does not offer the action.
  assert.equal(deletion.headers.get('content-type')?.startsWith('application/json'), false)
  const survivor = await e2e.client.json<Envelope<Row>>(`/api/staff/v1/inventory/products/${pristineId}`)
  assert.equal(survivor.data.id, pristineId)
  assert.equal((survivor.data.availableActions as string[]).includes('delete'), false)
})

test('staff inventory channel hides the cost from a viewer who may not read it, and keeps it on save', async (t) => {
  const e2e = await boot(t, '45000')
  const scope = { company: 'acme', branches: null }
  await e2e.fixture.call(
    'user.revokeFunction',
    { roleId: 'inventory-reader', fnKey: 'product.listVariantCosts' },
    { scope },
  )
  await e2e.client.login({ login: 'inventory-user', password: 'correct horse battery' })
  const csrf = (await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')).data
    .csrfToken

  const options = await e2e.client.json<Envelope<Row>>('/api/staff/v1/inventory/products/management/options')
  assert.equal(options.data.costVisible, false)
  const page = await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/inventory/products?limit=50')
  assert.ok(page.data.items.length > 0)
  assert.ok(page.data.items.every((item) => item.cost === null))

  const detail = (await e2e.client.json<Envelope<Row>>('/api/staff/v1/inventory/products/mango')).data
  assert.equal(detail.cost, null)
  const body = {
    name: 'Xoài Cát Hoà Lộc',
    kind: detail.kind,
    uomId: 'unit',
    categoryId: detail.categoryId,
    salePrice: (detail.salePrice as Row).amount,
    channels: detail.channels,
    tracking: detail.tracking,
    sku: detail.sku,
    barcode: detail.barcode,
    expectedVersion: detail.version,
  }
  const withCost = await e2e.client.request('/api/staff/v1/inventory/products/mango/update', {
    method: 'PUT',
    headers: mutationHeaders(csrf, 'inventory-hidden-cost-1', String(detail.version)),
    body: JSON.stringify({ ...body, cost: '0' }),
  })
  assert.equal(withCost.status, 422)
  assert.ok(((await withCost.json()) as { error: { fieldErrors: Row } }).error.fieldErrors.cost)

  const saved = await e2e.client.request('/api/staff/v1/inventory/products/mango/update', {
    method: 'PUT',
    headers: mutationHeaders(csrf, 'inventory-hidden-cost-2', String(detail.version)),
    body: JSON.stringify(body),
  })
  assert.equal(saved.status, 200)
  const updated = ((await saved.json()) as Envelope<Row>).data
  assert.equal(updated.name, 'Xoài Cát Hoà Lộc')
  assert.equal(updated.cost, null)
  const costs = await e2e.fixture.call<Row[]>(
    'product.listVariantCosts',
    { productIds: ['mango'] },
    { scope },
  )
  assert.equal(Number((costs.value as Row[])[0]!.standardPrice), 45000)
})
