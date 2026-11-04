import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
async function seeded(t: Parameters<typeof setup>[0]) {
  const r = await setup(t)
  await r.save('sale.addLine', {
    id: 'section',
    orderId: 'order',
    displayType: 'section',
    name: 'Equipment',
    productUomQty: '0',
    sequence: 100,
  })
  await r.add({ priceUnit: '999', sequence: 200 })
  await r.save('sale.addLine', {
    id: 'note',
    orderId: 'order',
    displayType: 'note',
    name: 'Handle with care',
    productUomQty: '0',
    sequence: 300,
  })
  await r.save('sale.addLine', {
    id: 'next',
    orderId: 'order',
    displayType: 'section',
    name: 'Next section',
    productUomQty: '0',
    sequence: 400,
  })
  const order = () => r.call('sale.getOrder', { id: 'order' })
  const copy = async (overrides: Row = {}) =>
    r.call('sale_template.saveSection', {
      id: 'order',
      sectionId: 'section',
      expectedRevision: (await order()).revision,
      expectedTemplateRevision: 0,
      ...overrides,
    })
  const get = (id: unknown) => r.call('sale_template.getTemplate', { id, manage: true })
  return { ...r, order, copy, get }
}
test('D29 section snapshot owns only product/note quantities and appends with current prices', async (t) => {
  const r = await seeded(t),
    before = await r.order(),
    saved = await r.copy()
  assert.equal(saved.ok, true)
  const template = await r.get(saved.id)
  assert.equal(template.kind, 'section')
  assert.equal(template.ownerId, 'owner')
  assert.equal((template.lines as Row[]).length, 2)
  for (const line of template.lines as Row[])
    for (const key of ['priceUnit', 'discount', 'taxIds', 'cost'])
      assert.equal(Object.hasOwn(line, key), false)
  assert.equal(template.notes, null)
  const added = await r.call('sale_template.addSection', {
    id: 'order',
    templateId: saved.id,
    expectedRevision: before.revision,
    expectedTemplateRevision: template.revision,
  })
  assert.equal(added.ok, true)
  const after = await r.order(),
    lines = after.lines as Row[]
  assert.deepEqual(lines.slice(0, 4), before.lines)
  assert.equal(lines.length, 7)
  assert.equal(lines[4]!.displayType, 'section')
  assert.equal(lines[4]!.name, 'Equipment')
  assert.equal(lines[5]!.productUomId, 'box')
  assert.equal(lines[5]!.productUomQty, '2')
  assert.equal(lines[5]!.priceUnit, '1200')
  assert.equal(lines[6]!.name, 'Handle with care')
})
test('D29 own section names overwrite only after confirmation and restore the same archived template', async (t) => {
  const r = await seeded(t),
    saved = await r.copy(),
    template = await r.get(saved.id)
  assert.equal((await r.copy()).ok, false)
  assert.equal((await r.copy({ expectedTemplateRevision: template.revision })).ok, false)
  const archived = await r.call('sale_template.saveTemplate', {
    id: saved.id,
    expectedRevision: template.revision,
    kind: 'section',
    name: template.name,
    lines: template.lines,
    teamIds: [],
    active: false,
  })
  assert.equal(archived.ok, true)
  const reused = await r.copy({ overwrite: true, expectedTemplateRevision: archived.revision })
  assert.equal(reused.ok, true)
  assert.equal(reused.id, saved.id)
  assert.equal((await r.get(saved.id)).active, true)
  assert.equal((await r.copy({ overwrite: true, expectedTemplateRevision: archived.revision })).ok, false)
})
test('D29 refuses free lines and bad source revisions without creating a template', async (t) => {
  const r = await seeded(t)
  assert.equal((await r.copy({ expectedRevision: -1 })).ok, false)
  await r.save('sale.addLine', {
    id: 'free',
    orderId: 'order',
    name: 'Installation',
    productUomQty: '1',
    priceUnit: '50',
    sequence: 350,
  })
  assert.equal((await r.copy()).ok, false)
  assert.equal((await r.call('sale_template.listTemplates', { manage: true })).total, 0)
})
test('D29 quotation templates require replace confirmation and retain optional products separately', async (t) => {
  const r = await seeded(t)
  const line = { productId: r.productId, productUomId: 'each', productUomQty: '3' }
  const saved = await r.call('sale_template.saveTemplate', {
    id: 'quote',
    name: 'Standard quote',
    expectedRevision: 0,
    lines: [line, { ...line, optional: true, productUomQty: '1' }],
    teamIds: [],
    validityDays: 14,
    notes: 'Terms',
    requireSignature: true,
    requirePayment: true,
    prepaymentPercent: '30',
  })
  assert.equal(saved.ok, true)
  const before = await r.order(),
    args = {
      id: 'order',
      templateId: 'quote',
      expectedRevision: before.revision,
      expectedTemplateRevision: saved.revision,
    }
  assert.equal((await r.call('sale_template.applyQuotation', args)).ok, false)
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.call('sale_template.applyQuotation', { ...args, replace: true })).ok, true)
  const after = await r.order()
  assert.equal((after.lines as Row[]).length, 1)
  assert.equal(after.notes, 'Terms')
  assert.equal((after.lines as Row[])[0]!.priceUnit, '100')
  const optional = await r.app.adapter!.all('SELECT * FROM sale_template_order_option')
  assert.equal(optional.length, 1)
  assert.equal(optional[0]!.productUomQty, '1')
})

async function seller(r: Awaited<ReturnType<typeof seeded>>, id: string, team: string) {
  await r.fixture('user.createUser', {
    id,
    login: id,
    password: 'test-password',
    name: id,
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: id + '-company', userId: id, companyId: 'acme' })
  await r.fixture('user.saveRole', { id: id + '-role', name: id })
  await r.fixture('user.assignRole', { id: id + '-assignment', userId: id, roleId: id + '-role' })
  for (const fnKey of [
    'sale_template.listTemplates',
    'sale_template.getTemplate',
    'sale_template.getSetup',
    'sale_template.saveSection',
    'sale_template.addSection',
    'sale_template.previewSection',
  ])
    await r.fixture('user.grantFunction', { id: id + '-' + fnKey, roleId: id + '-role', fnKey })
  await r.save('crm.team.save', {
    values: { id: team, name: team, code: team },
    idempotencyKey: team + '-create',
  })
  await r.save('crm.team.member.save', {
    id: id + '-member',
    teamId: team,
    userId: id,
    idempotencyKey: id + '-member-create',
  })
  const client = r.app.client.anonymous()
  await client.login({ login: id, password: 'test-password' })
  const call = async (fn: string, input: Row) => (await client.call<Row>(fn, input)).value
  return { client, call }
}
test('D29 same section names belong to their actors; team filtering and forged apply are enforced', async (t) => {
  const r = await seeded(t),
    alice = await seller(r, 'alice', 'A'),
    bob = await seller(r, 'bob', 'B')
  const input = {
    id: 'order',
    sectionId: 'section',
    expectedRevision: (await r.order()).revision,
    expectedTemplateRevision: 0,
  }
  const a = await alice.call('sale_template.saveSection', input),
    b = await bob.call('sale_template.saveSection', input)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.notEqual(a.id, b.id)
  assert.deepEqual((await r.get(a.id)).teamIds, ['A'])
  assert.deepEqual((await r.get(b.id)).teamIds, ['B'])
  const list = await alice.call('sale_template.listTemplates', { manage: true })
  assert.equal(list.total, 1)
  assert.equal((list.rows as Row[])[0]!.ownerName, 'alice')
  assert.equal(await alice.call('sale_template.getTemplate', { id: b.id, manage: true }), null)
  const before = await r.order()
  assert.equal(
    (
      await alice.call('sale_template.addSection', {
        id: 'order',
        templateId: b.id,
        expectedRevision: before.revision,
        expectedTemplateRevision: b.revision,
      })
    ).ok,
    false,
  )
  assert.deepEqual(await r.order(), before)
  await r.fixture('user.grantFunction', {
    id: 'alice-manage',
    roleId: 'alice-role',
    fnKey: 'sale_template.saveTemplate',
  })
  assert.equal((await alice.call('sale_template.listTemplates', {})).total, 2)
  const foreign = await r.app.fixture.call(
    'sale_template.getTemplate',
    { id: a.id, manage: true },
    { scope: { company: 'other', companies: ['acme', 'other'], branches: null } },
  )
  assert.equal(foreign.value, null)
})
test('D29 simultaneous section saves create only one owned template and stale additions preserve the order', async (t) => {
  const r = await seeded(t)
  const results = await Promise.allSettled([r.copy(), r.copy()])
  const succeeded = results.filter((result) => result.status === 'fulfilled' && result.value.ok === true)
  assert.equal(succeeded.length, 1)
  const list = await r.call('sale_template.listTemplates', { manage: true })
  assert.equal(list.total, 1)
  const template = (list.rows as Row[])[0]!,
    before = await r.order()
  for (const change of [{ expectedRevision: -1 }, { expectedTemplateRevision: -1 }]) {
    const result = await r.call('sale_template.addSection', {
      id: 'order',
      templateId: template.id,
      expectedRevision: before.revision,
      expectedTemplateRevision: template.revision,
      ...change,
    })
    assert.equal(result.ok, false)
    assert.deepEqual(await r.order(), before)
  }
})
test('D29 appends to a confirmed unlocked order without rewriting historical lines or demand', async (t) => {
  const r = await seeded(t),
    template = await r.copy()
  await r.save('sale.confirmOrder', { id: 'order' })
  const before = await r.order()
  const moves = await r.app.adapter!.all('SELECT * FROM stock_move')
  assert.equal(
    (
      await r.call('sale_template.addSection', {
        id: 'order',
        templateId: template.id,
        expectedRevision: before.revision,
        expectedTemplateRevision: template.revision,
      })
    ).ok,
    true,
  )
  const after = await r.order()
  assert.deepEqual((after.lines as Row[]).slice(0, 4), before.lines)
  const nextMoves = await r.app.adapter!.all('SELECT * FROM stock_move')
  for (const move of moves)
    assert.deepEqual(
      nextMoves.find((next) => next.id === move.id),
      move,
    )
  const line = (after.lines as Row[])[5]!
  const addedMove = nextMoves.find((move) => move.saleLineId === line.id)
  assert.ok(
    addedMove,
    JSON.stringify(
      nextMoves.map((move) => ({
        id: move.id,
        line: move.saleLineId,
        qty: move.productUomQty,
        unit: move.productUomId,
      })),
    ),
  )
  assert.equal(addedMove.productUomQty, '24')
  assert.equal(addedMove.productUomId, 'each')
})
test('D29 counts headers and notes against the 100-line limit and refuses the complete insertion', async (t) => {
  const r = await seeded(t),
    template = await r.copy()
  for (let i = 0; i < 94; i++)
    await r.save('sale.addLine', {
      id: 'extra-' + i,
      orderId: 'order',
      displayType: 'note',
      name: 'Extra ' + i,
      productUomQty: '0',
      sequence: 1000 + i,
    })
  const before = await r.order()
  assert.equal((before.lines as Row[]).length, 98)
  const result = await r.call('sale_template.addSection', {
    id: 'order',
    templateId: template.id,
    expectedRevision: before.revision,
    expectedTemplateRevision: template.revision,
  })
  assert.equal(result.ok, false)
  assert.deepEqual(await r.order(), before)
})

test('D29 create quotation is atomic with template pricing and idempotent without replacing later work', async (t) => {
  const r = await seeded(t)
  const source = await r.order()
  const input = {
    id: 'new-template-order',
    partnerId: source.partnerId,
    warehouseId: source.warehouseId,
    templateId: 'missing',
  }
  const failed = await r.call('sale_template.createQuotation', input)
  assert.equal(failed.ok, false)
  assert.equal(await r.call('sale.getOrder', { id: input.id }), null)
  const template = await r.call('sale_template.saveTemplate', {
    id: 'quote-create',
    name: 'Create quote',
    expectedRevision: 0,
    lines: [{ productId: r.productId, productUomId: 'each', productUomQty: '3' }],
    teamIds: [],
  })
  assert.equal(template.ok, true)
  const args = {
    ...input,
    partnerId: source.partnerId,
    warehouseId: source.warehouseId,
    templateId: template.id,
  }
  const created = await r.call('sale_template.createQuotation', args)
  assert.equal(created.ok, true)
  const order = await r.call('sale.getOrder', { id: input.id })
  assert.equal((order.lines as Row[]).length, 1)
  assert.equal((order.lines as Row[])[0]!.priceUnit, '100')
  assert.equal((await r.call('sale_template.createQuotation', { ...args, templateId: 'missing' })).ok, true)
  assert.deepEqual(await r.call('sale.getOrder', { id: input.id }), order)
})
test('D29 template operation grant cannot create an order without sale.createOrder', async (t) => {
  const r = await seeded(t),
    alice = await seller(r, 'creator', 'C')
  await r.fixture('user.grantFunction', {
    id: 'creator-template-create',
    roleId: 'creator-role',
    fnKey: 'sale_template.createQuotation',
  })
  const source = await r.order()
  assert.equal(
    (
      await alice.call('sale_template.createQuotation', {
        id: 'forbidden-create',
        partnerId: source.partnerId,
        warehouseId: source.warehouseId,
      })
    ).ok,
    false,
  )
  assert.equal(await r.call('sale.getOrder', { id: 'forbidden-create' }), null)
})

test('D29 archived templates retain their lines even after a product retires; revision and visibility remain enforced', async (t) => {
  const r = await seeded(t),
    copy = await r.copy(),
    before = await r.get(copy.id)
  await r.app.adapter!.run(
    'UPDATE product_product SET active = FALSE WHERE id = ' + (process.env.KET_COMMERCE_PG ? '$1' : '?'),
    [r.productId],
  )
  const archived = await r.call('sale_template.setTemplateActive', {
    id: copy.id,
    expectedRevision: copy.revision,
    active: false,
  })
  assert.equal(archived.ok, true)
  assert.deepEqual((await r.get(copy.id)).lines, before.lines)
  assert.equal(await r.call('sale_template.getTemplate', { id: copy.id }), null)
  assert.equal(
    (
      await r.call('sale_template.setTemplateActive', {
        id: copy.id,
        expectedRevision: copy.revision,
        active: true,
      })
    ).ok,
    false,
  )
  assert.equal(
    (
      await r.call('sale_template.setTemplateActive', {
        id: copy.id,
        expectedRevision: archived.revision,
        active: true,
      })
    ).ok,
    true,
  )
  const order = await r.order()
  assert.equal(
    (
      await r.call('sale_template.addSection', {
        id: 'order',
        templateId: copy.id,
        expectedRevision: order.revision,
      })
    ).ok,
    false,
  )
  assert.deepEqual(await r.order(), order)
})
test('D29 paged template screens carry scope, omit line payloads and deny forged scope and writes', async (t) => {
  const r = await seeded(t),
    copy = await r.copy(),
    path = '/admin/sales/templates'
  for (let i = 0; i < 27; i++)
    await r.save('sale_template.saveTemplate', {
      id: 'q-' + i,
      name: 'Quotation ' + String(i).padStart(2, '0'),
      expectedRevision: 0,
      lines: [{ productId: r.productId, productUomId: 'each', productUomQty: '1' }],
      teamIds: [],
    })
  const shell = await r.app.client.get(path + '?lang=en&company=acme')
  assert.equal(shell.status, 200)
  const html = await shell.text()
  assert.match(html, /sale-template.list-results/)
  assert.match(html, /sale-template-help/)
  assert.doesNotMatch(html, /Quotation 00/)
  assert.match(html, /company=acme/)
  const read = async (href: string) =>
    r.app.client.post(path + '/read?lang=en&company=acme', JSON.stringify({ href }), {
      headers: { 'content-type': 'application/json' },
    })
  const first = await read(path + '?lang=en&company=acme')
  assert.equal(first.status, 200)
  const answer = ((await first.json()) as { value: { rows: Row[]; total: number; pages: number } }).value
  assert.equal(answer.total, 28)
  assert.equal(answer.rows.length, 25)
  assert.equal(answer.pages, 2)
  assert.ok(answer.rows.every((row) => !Object.hasOwn(row, 'lines')))
  const last = (
    (await (await read(path + '?lang=en&company=acme&page=99')).json()) as {
      value: { rows: Row[]; page: number }
    }
  ).value
  assert.equal(last.page, 2)
  assert.equal(last.rows.length, 3)
  const section = (
    (await (await read(path + '?lang=en&company=acme&kind=section')).json()) as { value: { rows: Row[] } }
  ).value.rows[0]!
  assert.equal(section.id, copy.id)
  assert.equal(section.validityDays, '')
  assert.equal((await read(path + '?lang=en&company=other')).status, 400)
  const alice = await seller(r, 'readscreen', 'S')
  const readerShell = await alice.client.get(path + '?lang=en')
  assert.equal(readerShell.status, 200)
  assert.doesNotMatch(await readerShell.text(), /href="[^"]*templates\/new/)
  assert.equal((await alice.client.get(path + '/new?lang=en')).status, 403)
  await assert.rejects(
    () =>
      alice.client.call('sale_template.setTemplateActive', {
        id: copy.id,
        expectedRevision: copy.revision,
        active: false,
      }),
    (error: unknown) => (error as { status: number }).status === 403,
  )
})

test('D29 direct quotation creation uses the same native template-aware record as its modal', async (t) => {
  const r = await seeded(t)
  const response = await r.app.client.get('/admin/sales/quotations/new?lang=en&company=acme')
  assert.equal(response.status, 200)
  assert.match(await response.text(), /sale.order-page/)
  const context = await r.app.client.get('/admin/sales/record/new/context?lang=en&company=acme')
  assert.equal(context.status, 200)
  const data = ((await context.json()) as { data: { permissions: Record<string, boolean> } }).data
  assert.equal(data.permissions.templateCreate, true)
  assert.equal(data.permissions.templateChoices, true)
})

test('D29 concurrent append requests consume an order revision once', async (t) => {
  const r = await seeded(t),
    template = await r.copy(),
    before = await r.order()
  const args = {
    id: 'order',
    templateId: template.id,
    expectedRevision: before.revision,
    expectedTemplateRevision: template.revision,
  }
  const results = await Promise.all([
    r.call('sale_template.addSection', args),
    r.call('sale_template.addSection', args),
  ])
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  assert.equal(results.filter((result) => result.ok === false).length, 1)
  const after = await r.order()
  assert.equal((after.lines as Row[]).length, 7)
  assert.deepEqual((after.lines as Row[]).slice(0, 4), before.lines)
})

test('D29 section append accepts exactly 100 total rows and rejects nested or optional template content', async (t) => {
  const r = await seeded(t),
    line = { productId: r.productId, productUomId: 'each', productUomQty: '1' }
  const base = { id: 'boundary', name: 'Boundary', kind: 'section', expectedRevision: 0, teamIds: [] }
  for (const invalid of [
    [line, { displayType: 'section', name: 'Nested', productUomQty: '0' }],
    [{ ...line, optional: true }],
    [{ ...line, productUomQty: '-1' }],
  ]) {
    const result = await r.call('sale_template.saveTemplate', { ...base, lines: invalid })
    assert.equal(result.ok, false)
    assert.equal(await r.get(base.id), null)
  }
  const lines = [
    line,
    ...Array.from({ length: 94 }, (_, index) => ({
      displayType: 'note',
      name: 'Note ' + index,
      productUomQty: '0',
    })),
  ]
  const template = await r.save('sale_template.saveTemplate', { ...base, lines })
  const order = await r.order()
  assert.equal(
    (
      await r.call('sale_template.addSection', {
        id: 'order',
        templateId: template.id,
        expectedRevision: order.revision,
      })
    ).ok,
    true,
  )
  assert.equal(((await r.order()).lines as Row[]).length, 100)
})

test('D29 lifecycle-only managers archive and restore without receiving template edit rights', async (t) => {
  const r = await seeded(t),
    copy = await r.copy(),
    actor = await seller(r, 'archiver', 'ArchiveTeam')
  await r.fixture('user.grantFunction', {
    id: 'archiver-lifecycle',
    roleId: 'archiver-role',
    fnKey: 'sale_template.setTemplateActive',
  })
  const archived = await actor.call('sale_template.setTemplateActive', {
    id: copy.id,
    expectedRevision: copy.revision,
    active: false,
  })
  assert.equal(archived.ok, true)
  assert.equal((await actor.call('sale_template.getTemplate', { id: copy.id, manage: true })).active, false)
  await assert.rejects(
    () =>
      actor.client.call('sale_template.saveTemplate', {
        id: copy.id,
        expectedRevision: archived.revision,
        name: 'forged',
        lines: [],
      }),
    (error: unknown) => (error as { status: number }).status === 403,
  )
  const restored = await actor.call('sale_template.setTemplateActive', {
    id: copy.id,
    expectedRevision: archived.revision,
    active: true,
  })
  assert.equal(restored.ok, true)
  assert.equal((await r.get(copy.id)).name, 'Equipment')
})
