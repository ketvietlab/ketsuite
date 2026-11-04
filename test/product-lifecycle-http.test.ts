import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

test('Commerce product lifecycle: unsaved copy, reasons, atomic variants and bulk rollback over HTTP', async (t) => {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = (fn: string, input: Row) =>
    app.fixture.call(fn, input, { scope: { company: 'test-company', branches: null } })
  await fixture('partner.savePartner', { id: 'company-party', kind: 'company', name: 'Example Company' })
  await fixture('company.saveCompany', { id: 'test-company', partnerId: 'company-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'test-password',
    name: 'Owner',
    defaultCompanyId: 'test-company',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-company', userId: 'owner', companyId: 'test-company' })
  await app.client.login({ login: 'owner', password: 'test-password' })
  const call = async <T = Row>(fn: string, input: Row = {}) => (await app.client.call<T>(fn, input)).value
  const save = async (fn: string, input: Row) => {
    const result = await call(fn, input)
    assert.notEqual(result.ok, false, JSON.stringify(result))
    return result
  }
  const record = (id: string) => call('product.getTemplate', { id })
  const context = (id: string) =>
    call<{ data: { record: Row; lifecycle: Row[] } }>('product.templateModalContext', { id })
  const archive = async (id: string, extra: Row = {}) =>
    call('product.archiveTemplate', {
      id,
      active: false,
      reason: 'Discontinued',
      expectedRevisionId: (await record(id)).revisionId,
      confirmed: true,
      ...extra,
    })
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  for (const id of ['sample', 'other'])
    await save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      uomId: 'each',
      listPrice: '125',
      defaultCode: id.toUpperCase(),
      isStorable: true,
      tracking: 'none',
      costPrice: '50',
      shelfLifeMonths: 12,
      alertDays: 30,
    })
  const before = await call('product.countTemplates')
  const copyResponse = await app.client.get('/admin/product/templates/new/context?duplicate=sample&lang=en')
  assert.equal(copyResponse.status, 200)
  const copy = (await copyResponse.json()) as { data: { record: Row; lifecycle: Row[] } }
  assert.equal(copy.data.record.name, 'sample (copy)')
  assert.equal(Number(copy.data.record.listPrice), 125)
  assert.equal(copy.data.record.defaultCode, null)
  assert.equal(copy.data.record.barcode, null)
  assert.equal(copy.data.record.costPrice, null)
  assert.equal(copy.data.record.isStorable, true)
  // A copy keeps how its lots age, as the mock's copy does (P22).
  assert.equal(copy.data.record.shelfLifeMonths, 12)
  assert.equal(copy.data.record.alertDays, 30)
  assert.deepEqual(copy.data.lifecycle, [])
  assert.deepEqual(await call('product.countTemplates'), before, 'opening a copy writes nothing')
  const copyPage = await app.client.get('/admin/product/templates/new?duplicate=sample&lang=en')
  assert.equal(copyPage.status, 200)
  assert.match(await copyPage.text(), /sourceId(?:&quot;|")\s*:\s*(?:&quot;|")sample/)
  await save('product.saveRecord', {
    id: 'copy',
    name: 'Edited copy',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'COPY',
    listPrice: '200',
    isStorable: true,
    tracking: 'lot',
  })
  assert.equal((await context('copy')).data.record.tracking, 'lot')
  assert.equal((await context('sample')).data.record.tracking, 'none')

  for (const reason of ['', '   ', 'x'.repeat(501)]) {
    const refused = await archive('sample', { reason })
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]?.field, 'reason')
  }
  assert.equal((await record('sample')).active, true)
  assert.equal((await context('sample')).data.lifecycle.length, 0)
  await save('product.saveAttribute', { id: 'size', name: 'Size', createVariant: 'always' })
  await save('product.saveAttributeValue', { id: 'small', attributeId: 'size', name: 'Small' })
  await save('product.saveAttributeValue', { id: 'large', attributeId: 'size', name: 'Large' })
  await save('product.saveAttributeLine', {
    id: 'sizes',
    templateId: 'sample',
    attributeId: 'size',
    valueIds: ['small', 'large'],
  })
  await save('product.generateVariants', { templateId: 'sample' })
  const variants = await call<Row[]>('product.listVariants', { templateId: 'sample' })
  assert.equal(variants.length, 2)
  const stale = (await record('sample')).revisionId
  assert.equal((await archive('sample', { reason: '  End of season  ' })).changed, 1)
  const archived = await record('sample')
  assert.equal(archived.active, false)
  assert.ok((archived.variants as Row[]).every((variant) => variant.active === false))
  const history = (await context('sample')).data.lifecycle
  assert.equal(history.length, 1)
  assert.equal(history[0]?.reason, 'End of season')
  assert.equal(history[0]?.actor, 'owner')
  assert.equal(history[0]?.actorName, 'Owner', 'the history names the person')
  await assert.rejects(() => archive('sample', { active: true, expectedRevisionId: stale }))
  assert.equal((await context('sample')).data.lifecycle.length, 1)
  await archive('sample', { active: true })
  const restored = await record('sample')
  assert.equal((restored.variants as Row[]).filter((variant) => variant.active).length, 2)
  // The original SKU took the first combination, so no resting default SKU is left behind.
  assert.equal(
    (restored.variants as Row[]).some((variant) => variant.combinationKey === ''),
    false,
  )
  assert.equal((await context('sample')).data.lifecycle.length, 2)
  await archive('sample', { active: true })
  assert.equal(
    (await context('sample')).data.lifecycle.length,
    2,
    'same-state command creates no spurious event',
  )

  // A storage failure after the state updates must roll those updates back too.
  const pg = Boolean(process.env.KET_COMMERCE_PG)
  if (pg) {
    await app.adapter!.exec(
      `CREATE FUNCTION reject_product_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected event failure'; END $$`,
    )
    await app.adapter!.exec(
      `CREATE TRIGGER reject_product_event BEFORE INSERT ON product_template_state_event FOR EACH ROW EXECUTE FUNCTION reject_product_event()`,
    )
  } else {
    await app.adapter!.exec(
      `CREATE TRIGGER reject_product_event BEFORE INSERT ON product_template_state_event BEGIN SELECT RAISE(ABORT, 'injected event failure'); END`,
    )
  }
  await assert.rejects(() => archive('sample'))
  assert.equal((await record('sample')).active, true, 'failed history insert rolls the template back')
  assert.equal(
    (await call<Row[]>('product.listVariants', { templateId: 'sample' })).length,
    2,
    'variants roll back too',
  )
  assert.equal((await context('sample')).data.lifecycle.length, 2)
  await app.adapter!.exec(
    pg
      ? 'DROP TRIGGER reject_product_event ON product_template_state_event'
      : 'DROP TRIGGER reject_product_event',
  )
  if (pg) await app.adapter!.exec('DROP FUNCTION reject_product_event()')

  const workspace = await app.client.get('/admin/product/templates/sample/context')
  const {
    data: { variantSetup },
  } = (await workspace.json()) as { data: { variantSetup: { lines: Row[]; variants: Row[] } } }
  await save('product.saveVariantSetup', {
    templateId: 'sample',
    lines: variantSetup.lines,
    variants: variantSetup.variants.map((variant, index) => ({ ...variant, active: index !== 0 })),
  })
  await archive('sample')
  await archive('sample', { active: true })
  assert.equal(
    (await call<Row[]>('product.listVariants', { templateId: 'sample' })).length,
    1,
    'restore must preserve a variant archived on its own',
  )

  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.createPicking', { id: 'pending', name: 'Pending shipment', pickingTypeId: 'wh:outgoing' })
  await save('stock.addMove', {
    id: 'pending-line',
    name: 'Other',
    pickingId: 'pending',
    productId: 'other:default',
    productUomId: 'each',
    productUomQty: '1',
  })
  await assert.rejects(async () =>
    call('product.archiveTemplate', {
      ids: ['sample', 'other'],
      active: false,
      reason: 'Discontinued',
      confirmed: true,
      expectedRevisions: { sample: restored.revisionId, other: undefined },
    }),
  )
  const currentOther = await record('other')
  await assert.rejects(async () =>
    call('product.archiveTemplate', {
      ids: ['sample', 'other'],
      active: false,
      reason: 'Discontinued',
      confirmed: true,
      expectedRevisions: { sample: (await record('sample')).revisionId, other: currentOther.revisionId },
    }),
  )
  assert.equal((await record('sample')).active, true, 'bulk refuses every record when one is in use')
  assert.equal((await context('sample')).data.lifecycle.length, 4)
  assert.equal((await record('other')).active, true)
  assert.equal((await call('stock.getPicking', { id: 'pending' })).state, 'draft')

  // A real read-only session cannot mutate via RPC or acquire an editable copy.
  await fixture('user.saveRole', { id: 'reader-role', name: 'Reader' })
  for (const fnKey of ['product.getTemplate', 'product.templateModalContext'])
    await fixture('user.grantFunction', { id: `reader:${fnKey}`, roleId: 'reader-role', fnKey })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'test-company',
  })
  await fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'test-company' })
  await fixture('user.assignRole', { id: 'reader-role-grant', userId: 'reader', roleId: 'reader-role' })
  const reader = app.client.anonymous()
  await reader.login({ login: 'reader', password: 'test-password' })
  await assert.rejects(() =>
    reader.call('product.archiveTemplate', { id: 'sample', active: false, reason: 'Forged' }),
  )
  assert.equal((await reader.get('/admin/product/templates/new/context?duplicate=sample')).status, 403)
  assert.equal((await record('sample')).active, true)
})
