import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { KET_GRID_NO_CHANGES } from '@ketvietlab/design-system'
import { landedCostDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/landed-cost-view.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { postedCostLines } from '../packages/ketsuite/src/modules/stock_backend/modal/landed-cost-lines.ts'
import { seed } from './fixtures/stock/landed-costs.ts'

const html = (value: unknown) => renderToString(value as TemplateResult)
// Without the view's hydration markers, so text sits next to its tag.
const page = async (response: Response) => (await response.text()).replace(/<!--k\[?-->/g, '')

test('K64 the cost grid posts the whole list of costs in its order, or nothing when nothing changed', () => {
  const held = [
    { id: 'lc:1', name: 'Freight', splitMethod: 'quantity', amount: '360000' },
    { id: 'lc:2', name: 'Duty', splitMethod: 'value', amount: '50000' },
  ]
  assert.equal(postedCostLines(held, ''), undefined)
  assert.equal(postedCostLines(held, KET_GRID_NO_CHANGES), undefined)
  assert.equal(postedCostLines(held, 'not json'), undefined)
  const posted = JSON.stringify({
    added: [{ id: 'row-3', index: 0, values: { name: 'Handling', splitMethod: 'equal', amount: 1500.5 } }],
    updated: [{ id: 'lc:2', values: { amount: 60000 } }],
    removed: ['lc:1'],
    order: null,
  })
  assert.deepEqual(postedCostLines(held, posted), [
    { name: 'Handling', splitMethod: 'equal', amount: '1500.5' },
    { name: 'Duty', splitMethod: 'value', amount: '60000' },
  ])
  // A reordered grid keeps its order; an emptied amount reaches the server as empty, for it to refuse.
  assert.deepEqual(
    postedCostLines(
      held,
      JSON.stringify({
        added: [],
        updated: [{ id: 'lc:1', values: { amount: null } }],
        removed: [],
        order: ['lc:2', 'lc:1'],
      }),
    ),
    [
      { name: 'Duty', splitMethod: 'value', amount: '50000' },
      { name: 'Freight', splitMethod: 'quantity', amount: '' },
    ],
  )
  // Every cost removed saves none.
  assert.deepEqual(
    postedCostLines(held, JSON.stringify({ added: [], updated: [], removed: ['lc:1', 'lc:2'], order: null })),
    [],
  )
})

const costContext = (
  record: Row,
  permissions: Partial<Record<'save' | 'post' | 'cancel', boolean>>,
  extra: Row = {},
) =>
  ({
    kind: 'stock.landedCost',
    id: String(record.id ?? 'new'),
    creating: !record.id,
    presentation: 'page',
    data: {
      record: { state: 'draft', pickingIds: [], lines: [], allocations: [], currency: 'VND', ...record },
      lang: 'en',
      draftId: 'draft-id',
      permissions: { save: false, post: false, cancel: false, ...permissions },
      fromReceipt: null,
      totalText: '360.000 ₫',
      dateText: '30/01/2030',
      postedText: '',
      entryHref: null,
      receiptLinks: [{ id: 'r1', name: 'WH/NK/0001', href: '/admin/stock/transfers/r1' }],
      allocations: [],
      choices: {
        vendors: [{ id: 'carrier', name: 'Carrier' }],
        receipts: [{ id: 'r1', name: 'WH/NK/0001 · Vendor' }],
      },
      ...extra,
    },
    draft: (_key: string, fallback: string) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
    recordChanged: false,
  }) as never

test('K64 a draft offers its form and grid to drafters, Post to whoever may post, Cancel with a reason', () => {
  const lines = [
    { id: 'lc:1', name: 'Freight', splitMethod: 'quantity', amount: '360000', amountText: '360.000 ₫' },
  ]
  const draft = costContext(
    { id: 'lc', name: 'CPMT/2030/0001', vendorId: 'carrier', pickingIds: ['r1'], lines },
    { save: true, post: true, cancel: true },
  )
  const actions = html(landedCostDefinition.pageActions!(draft))
  // Save and Post both submit the draft's form; Post saves it first in the same action.
  assert.match(actions, /name="__command" value="save" form="stock-landed-cost-form"/)
  assert.match(actions, /name="__command" value="post" form="stock-landed-cost-form"/)
  assert.match(actions, /stock_backend\.landedCost\.cancel/)
  assert.deepEqual(
    [
      landedCostDefinition.commands!.post!.fn,
      landedCostDefinition.commands!.post!.also?.map((step) => step.fn),
    ],
    ['stock.saveLandedCost', ['stock.postLandedCost']],
  )
  const body = html(landedCostDefinition.body!(draft))
  assert.match(body, /backend\.relation-select[\s\S]*landed-cost-vendorId/)
  assert.match(body, /landed-cost-pickingIds/)
  assert.match(body, /&quot;multiple&quot;:true|"multiple":true/)
  // Costs are entered in one grid (DS: editable rows are a KetGrid), posted with the form.
  assert.match(body, /backend\.ket-grid/)
  assert.match(body, /stock-landed-cost-form/)
  for (const label of ['quantity', 'value', 'equal'])
    assert.match(body, new RegExp(`landedCost\\.split\\.${label}`))
  // The rail: its facts and the receipts it lands on, each opening its page.
  const rail = html(landedCostDefinition.pageAside!(draft))
  assert.match(rail, /href="\/admin\/stock\/transfers\/r1"/)
  assert.match(rail, /360\.000 ₫/)

  // A stock manager drafts and cancels but does not post.
  const manager = html(
    landedCostDefinition.pageActions!(costContext({ id: 'lc', lines }, { save: true, cancel: true })),
  )
  assert.match(manager, /value="save"/)
  assert.doesNotMatch(manager, /landedCost\.post|value="post"/)
  // An accountant who may post but not edit posts the saved draft as it is.
  const poster = html(landedCostDefinition.pageActions!(costContext({ id: 'lc', lines }, { post: true })))
  assert.match(poster, /value="postSaved"/)
  assert.doesNotMatch(poster, /value="save"/)
  // A reader without either reads the costs, in a table rather than the grid.
  const reader = costContext({ id: 'lc', lines }, {})
  assert.doesNotMatch(html(landedCostDefinition.body!(reader)), /backend\.ket-grid|landed-cost-vendorId/)
  assert.match(html(landedCostDefinition.body!(reader)), /Freight[\s\S]*360\.000 ₫/)
  assert.doesNotMatch(html(landedCostDefinition.pageActions!(reader)), /value="save"|landedCost\.cancel/)
  // A new cost has nothing to post or cancel yet, and no rail.
  const fresh = costContext({}, { save: true, post: true, cancel: true })
  assert.doesNotMatch(html(landedCostDefinition.pageActions!(fresh)), /value="post"|landedCost\.cancel/)
  assert.equal(landedCostDefinition.pageAside!(fresh), undefined)
})

test('K64 the save sends the receipts chosen and the costs, and a refused cell shows above the grid', () => {
  const c = costContext(
    { id: 'lc', lines: [{ id: 'lc:1', name: 'Freight', splitMethod: 'quantity', amount: '360000' }] },
    { save: true },
  )
  const form = new FormData()
  form.set('vendorId', 'carrier')
  form.set('date', '')
  form.set('pickingIds', 'r1,r2')
  form.set('lines', KET_GRID_NO_CHANGES)
  const save = landedCostDefinition.commands!.save!
  assert.deepEqual(save.input(form, c, {} as never), {
    id: 'lc',
    vendorId: 'carrier',
    date: undefined,
    pickingIds: ['r1', 'r2'],
  })
  form.set(
    'lines',
    JSON.stringify({ added: [], updated: [{ id: 'lc:1', values: { amount: 1 } }], removed: [], order: null }),
  )
  assert.deepEqual((save.input(form, c, {} as never) as Row).lines, [
    { name: 'Freight', splitMethod: 'quantity', amount: '1' },
  ])
  // A new cost writes under this reading's draft id, so a retried save writes it once.
  assert.equal((save.input(form, costContext({}, { save: true }), {} as never) as Row).id, 'draft-id')
  assert.equal(save.issueField!('lines.0.amount', form, c), 'lines')
  assert.equal(save.issueField!('vendorId', form, c), 'vendorId')
})

test('K64 a posted cost reads as a summary with its allocation, entry and no command', () => {
  const posted = costContext(
    {
      id: 'lc',
      name: 'CPMT/2030/0001',
      state: 'posted',
      accountMoveId: 'stock-landed-cost:lc',
      vendorName: 'Carrier',
    },
    { save: true, post: true, cancel: true },
    {
      postedText: '31/01/2030',
      entryHref: '/admin/accounting/entries/stock-landed-cost%3Alc',
      allocations: [
        {
          id: 'a1',
          receipt: 'WH/NK/0001',
          receiptHref: '/admin/stock/transfers/r1',
          product: 'Goods',
          line: 'Freight',
          amountText: '360.000 ₫',
          stockText: '240.000 ₫',
          cogsText: '120.000 ₫',
        },
      ],
    },
  )
  const actions = html(landedCostDefinition.pageActions!(posted))
  assert.doesNotMatch(actions, /value="save"|value="post"|landedCost\.cancel/)
  const body = html(landedCostDefinition.body!(posted))
  assert.doesNotMatch(body, /backend\.ket-grid|landed-cost-vendorId/)
  assert.match(body, /stock_backend\.landedCost\.allocations[\s\S]*240\.000 ₫[\s\S]*120\.000 ₫/)
  const rail = html(landedCostDefinition.pageAside!(posted))
  assert.match(rail, /Carrier/)
  assert.match(rail, /31\/01\/2030/)
  assert.match(rail, /href="\/admin\/accounting\/entries\/stock-landed-cost%3Alc"/)
})

test('K64 the list, its data, the page and its context: in both languages, and locked for who may not see value', async (t) => {
  const r = await seed(t)
  await r.receive('r1', '60', '70000')
  await r.deliver('out', '20')
  assert.deepEqual(await r.draft(), { ok: true, id: 'lc' })
  // Posted at 03:00 on 31 January in Ho Chi Minh City, still the 30th in UTC.
  t.mock.timers.setTime(Date.parse('2030-01-30T20:00:00.000Z'))
  assert.equal((await r.call('stock.postLandedCost', { id: 'lc' })).ok, true)
  assert.equal((await r.draft({ id: 'dropped', lines: [{ name: 'Duty', amount: '1000' }] })).ok, true)
  assert.equal((await r.call('stock.cancelLandedCost', { id: 'dropped', reason: 'Wrong vendor' })).ok, true)

  for (const [lang, title, menu, sample] of [
    ['vi', 'Chi phí mua kho', /Phiếu hủy hàng[\s\S]*Chi phí mua kho/, 'Lập phiếu'],
    ['en', 'Landed costs', /Scrap orders[\s\S]*Landed costs/, 'Create a landed cost'],
  ] as const) {
    const response = await r.app.client.request(`/admin/stock/landed-costs?lang=${lang}`)
    assert.equal(response.status, 200)
    const markup = await page(response)
    for (const name of ['controls', 'results', 'footer'])
      assert.match(markup, new RegExp(`stock\\.landed-cost-${name}`))
    assert.match(markup, new RegExp(`<h1[^>]*>${title}<`))
    // The menu names it after the scrap orders.
    assert.match(markup, menu)
    assert.match(markup, /id="stock-landed-cost-help"/)
    assert.ok(markup.includes(sample), `${lang}: ${sample}`)
    assert.match(markup, /href="\/admin\/stock\/landed-costs\/new\?lang=/)
    assert.doesNotMatch(markup, /stock_backend\.landedCost\.\w+/)
  }

  const data = async (href: string) => {
    const response = await r.app.client.request('/admin/stock/landed-costs/data?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href }),
    })
    assert.equal(response.status, 200)
    return (await response.json()).value
  }
  const listed = await data('/admin/stock/landed-costs?lang=en')
  assert.deepEqual(
    listed.rows.map((row: Row) => [row.name, row.vendor, row.receipts, row.stateText, row.href]),
    [
      ['CPMT/2030/0002', 'Carrier', 'r1', 'Cancelled', '/admin/stock/landed-costs/dropped?lang=en'],
      ['CPMT/2030/0001', 'Carrier', 'r1', 'Posted', '/admin/stock/landed-costs/lc?lang=en'],
    ],
  )
  assert.match(listed.rows[1].totalText, /360,000/)
  // The total below the table leaves the cancelled cost out.
  assert.match(listed.sumText, /360,000/)
  assert.equal((await data('/admin/stock/landed-costs?lang=en&q=0002')).rows.length, 1)

  const context = async (
    path: string,
    client: { request: (path: string) => Promise<Response> } = r.app.client,
  ) => {
    const response = await client.request(path)
    return response.status === 200 ? (await response.json()).data : response.status
  }
  const fresh = await context('/admin/stock/landed-cost/new/context?lang=en&picking=r1')
  assert.deepEqual(fresh.record.pickingIds, ['r1'])
  assert.equal(fresh.fromReceipt, 'r1 · Vendor · 1/31/2030')
  assert.deepEqual(fresh.permissions, { save: true, post: true, cancel: true })
  // A receipt that is not one stays off a new cost.
  assert.deepEqual(
    (await context('/admin/stock/landed-cost/new/context?lang=en&picking=out')).record.pickingIds,
    [],
  )
  const posted = await context('/admin/stock/landed-cost/lc/context?lang=en')
  assert.deepEqual(
    posted.allocations.map((row: Row) => [row.receipt, row.line, row.stockText, row.cogsText]),
    [['r1', 'Freight', posted.allocations[0].stockText, posted.allocations[0].cogsText]],
  )
  // The company's day it was posted on, not UTC's.
  assert.equal(posted.postedText, '1/31/2030')
  assert.match(posted.allocations[0].stockText, /240,000/)
  assert.match(posted.allocations[0].cogsText, /120,000/)
  assert.deepEqual(posted.receiptLinks, [{ id: 'r1', name: 'r1', href: '/admin/stock/transfers/r1?lang=en' }])
  assert.match(posted.record.lines[0].amountText, /360,000/)
  // Any active partner may be owed a cost, not only those that supply goods; the picker searches the rest.
  assert.ok(
    ['Carrier', 'Vendor'].every((name) => posted.choices.vendors.some((row: Row) => row.name === name)),
  )
  // The company's own partner owes it nothing.
  assert.ok(!posted.choices.vendors.some((row: Row) => row.name === 'acme'))

  const record = await r.app.client.request('/admin/stock/landed-costs/lc?lang=en')
  assert.equal(record.status, 200)
  const recordMarkup = await page(record)
  assert.match(recordMarkup, /data-island="stock\.landed-cost-page"/)
  assert.match(recordMarkup, /CPMT\/2030\/0001/)
  assert.match(recordMarkup, /id="stock-landed-cost-help"/)
  assert.equal((await r.app.client.request('/admin/stock/landed-costs/missing?lang=en')).status, 404)
  // A new cost opened from a receipt renders its context with the page: the runtime mounts before the browser
  // shows the new address, so it could not read the receipt from it.
  const fromReceipt = await page(
    await r.app.client.request('/admin/stock/landed-costs/new?lang=en&picking=r1'),
  )
  assert.match(fromReceipt, /data-island="stock\.landed-cost-page"[^>]*r1 · Vendor · 1\/31\/2030/)
  assert.doesNotMatch(
    await page(await r.app.client.request('/admin/stock/landed-costs/new?lang=en')),
    /&quot;fromReceipt&quot;|"fromReceipt"/,
  )

  // The receipt opens a new cost on itself and lists those on it, cancelled ones aside, with what they added.
  const receipt = await context('/admin/stock/transfer/r1/context?lang=en')
  assert.equal(receipt.landedCosts.addHref, '/admin/stock/landed-costs/new?lang=en&picking=r1')
  assert.deepEqual(
    receipt.landedCosts.costs.map((cost: Row) => [cost.name, cost.stateText, cost.href]),
    [['CPMT/2030/0001', 'Posted', '/admin/stock/landed-costs/lc?lang=en']],
  )
  assert.match(receipt.landedCosts.costs[0].amountText, /^\+.*360,000/)
  const rail = html(
    transferModalDefinition.pageAside!({
      ...(costContext({ id: 'r1' }, {}) as object),
      data: receipt,
    } as never),
  )
  assert.match(rail, /stock_backend\.landedCost\.onReceipt[\s\S]*CPMT\/2030\/0001/)
  // A delivery takes no cost, and an open receipt not yet.
  assert.equal((await context('/admin/stock/transfer/out/context?lang=en')).landedCosts.addHref, null)
  const search = async (client: { request: (path: string, init?: RequestInit) => Promise<Response> }) => {
    const response = await client.request('/_ket/fn/stock_backend.searchStock?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href: '/admin/stock/search?lang=en&q=cpmt' }),
    })
    return ((await response.json()) as { value: { rows: Row[] } }).value.rows
  }
  // Search in Stock finds a cost by its number, naming its vendor and receipts.
  assert.deepEqual(
    (await search(r.app.client)).map((row) => [row.name, row.kind, row.subject, row.origin, row.state]),
    [
      ['CPMT/2030/0002', 'landedCost', 'Carrier', 'r1', 'landedCost.state.cancel'],
      ['CPMT/2030/0001', 'landedCost', 'Carrier', 'r1', 'landedCost.state.posted'],
    ],
  )

  // A storekeeper meets the locked page, and neither the data nor a cost.
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const keeper = await r.signIn('commerce.warehouse-operator')
  const locked = await keeper.request('/admin/stock/landed-costs?lang=en')
  assert.equal(locked.status, 403)
  assert.match(await page(locked), /This role cannot view landed costs/)
  assert.equal((await keeper.request('/admin/stock/landed-costs/lc?lang=en')).status, 403)
  assert.equal(await context('/admin/stock/landed-cost/lc/context?lang=en', keeper), 403)
  assert.deepEqual((await context('/admin/stock/transfer/r1/context?lang=en', keeper)).landedCosts, {
    addHref: null,
    costs: [],
  })
  assert.deepEqual(await search(keeper), [])
  // An auditor reads a cost but is offered nothing to do with it, nor a way to create one.
  const auditor = await r.signIn('commerce.tenant-auditor')
  const audited = await context('/admin/stock/landed-cost/lc/context?lang=en', auditor)
  assert.deepEqual(audited.permissions, { save: false, post: false, cancel: false })
  assert.doesNotMatch(
    await page(await auditor.request('/admin/stock/landed-costs?lang=en')),
    /landed-costs\/new/,
  )
  assert.equal(await context('/admin/stock/landed-cost/new/context?lang=en', auditor), 403)

  // A cost over two receipts shows on each what it added to that receipt.
  await r.receive('r2', '10', '70000')
  assert.equal(
    (
      await r.draft({
        id: 'both',
        pickingIds: ['r1', 'r2'],
        lines: [{ name: 'Handling', splitMethod: 'equal', amount: '1000' }],
      })
    ).ok,
    true,
  )
  assert.equal((await r.call('stock.postLandedCost', { id: 'both' })).ok, true)
  assert.deepEqual(
    (await context('/admin/stock/transfer/r2/context?lang=en')).landedCosts.costs.map((cost: Row) => [
      cost.name,
      String(cost.amountText).replace(/\D/g, ''),
    ]),
    [['CPMT/2030/0003', '500']],
  )
})
