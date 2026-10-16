import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Row, tableNameFor } from '@ketvietlab/ketjs'
import { salesHelp } from '../packages/ketsuite/src/modules/crm_backend/sales/help.mjs'
import { boot, type Card, login, type Model, read } from './helpers/crm-sales.ts'

const cards = (model: Row) => ((model.pipeline as Row).lanes as Row[]).flatMap((lane) => lane.cards as Card[])

test('crm sales read: a manager reads the board over every record, in local time', async (t) => {
  const { app } = await boot(t)
  await login(app, 'admin')
  const { status, body } = await read(app, 'screen=pipeline')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  const model = body.value
  assert.equal(model.screen, 'pipeline')
  assert.deepEqual(model.actor, { id: 'admin', role: 'manager', name: 'User admin' })
  assert.deepEqual(model.can, { write: true, admin: true })
  // The clock is wall time with its offset, like every date the screens compare.
  assert.match(model.clock, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/)
  // The standard channels first, then the company's own.
  assert.deepEqual(model.sources, ['Website', 'Facebook', 'Zalo OA', 'Giới thiệu', 'Hội chợ'])
  assert.deepEqual(model.intakeSources, ['Website'])
  assert.ok(model.people.some((person) => person.id === 'agent' && person.name === 'User agent'))
  const board = cards(model)
  assert.deepEqual(board.map((card) => card.id).sort(), ['deal-mine', 'deal-other', 'lead-queue'])
  const mine = board.find((card) => card.id === 'deal-mine') as Card
  assert.equal(mine.revenue, 12_000_000)
  assert.equal(mine.writable, true)
  // Its next step is due today without a time: planned, not overdue.
  assert.equal(mine.next?.id, 'meet-today')
  assert.ok(!mine.flags.includes('overdue-activity'))
  assert.ok(!mine.flags.includes('no-next'))
  // The lane of the proposition stage carries the open value.
  const lane = ((model.pipeline as Row).lanes as Row[]).find(
    (l) => l.stageId === 'crm-stage-proposition',
  ) as Row
  assert.equal(lane.gross, 12_000_000)
})

test("crm sales read: another module's pipeline stays off the sales screens", async (t) => {
  const { app } = await boot(t)
  // Care tickets keep their stages in the same table, in English until renamed, like the care seed.
  const q = app.adapter!.quoteIdent.bind(app.adapter)
  const columns = [
    'companyId',
    'sequence',
    'terminalState',
    'teamId',
    'fold',
    'active',
    'version',
    'probability',
    'staleDays',
  ]
  await app.adapter!.run(
    `INSERT INTO ${q(tableNameFor('crm.Stage'))} (${['id', 'code', 'name', 'allowedKinds', ...columns].map(q).join(', ')})
     SELECT 'care-ticket-progress', 'care-ticket-progress', 'In progress', '["ticket"]', ${columns.map(q).join(', ')}
     FROM ${q(tableNameFor('crm.Stage'))} WHERE ${q('id')} = 'crm-stage-qualified'`,
  )
  await login(app, 'admin')
  const { status, body } = await read(app, 'screen=pipeline')
  assert.equal(status, 200)
  const model = body.value
  assert.ok(model.stages.some((stage) => stage.id === 'crm-stage-qualified'))
  assert.ok(
    !model.stages.some((stage) => stage.id === 'care-ticket-progress'),
    'a ticket stage is not a sales stage',
  )
  const lanes = (model.pipeline as Row).lanes as Row[]
  assert.ok(!lanes.some((lane) => lane.stageId === 'care-ticket-progress'), 'the board has no ticket lane')
  // What is left reads in the reader's language: the seeded stages are named in Vietnamese.
  assert.ok(model.stages.every((stage) => stage.name !== 'In progress'))
})

test('crm sales read: every screen reads, and a step due on a past day is overdue', async (t) => {
  const { app } = await boot(t)
  await login(app, 'admin')
  const screens = [
    'screen=pipeline',
    'screen=cases',
    'screen=lead-new',
    'screen=lead-detail&id=lead-queue',
    'screen=activity-planner',
    'screen=crm-settings',
    'screen=crm-team&team=team-a',
  ]
  const models = new Map<string, Model & Row>()
  for (const query of screens) {
    const { status, body } = await read(app, query)
    assert.equal(status, 200, query)
    assert.equal(body.ok, true, query)
    models.set(query.split('&')[0], body.value)
  }
  const model = (screen: string) => models.get(screen) as Model & Row
  // The CRM overview is the deployment's own dashboard: the admin neither serves the presenter's overview
  // nor computes its figures, so one set of KPI figures stands.
  assert.equal((await app.client.get('/admin/crm/sales-overview')).status, 404)
  const overview = await read(app, 'screen=overview&period=quarter')
  assert.equal(overview.status, 404)
  assert.equal(overview.body.ok, false)
  assert.equal('insights' in model('screen=pipeline'), false)
  const planner = model('screen=activity-planner').planner as Row
  const late = (planner.open as Row[]).find((activity) => activity.id === 'call-late') as Row
  assert.equal(late.type, 'call')
  assert.equal((late.record as Row).id, 'lead-queue')
  // Due on a past day without a time: the record shows it as an overdue step.
  const detail = model('screen=lead-detail').detail as Row
  assert.ok(((detail.record as Row).flags as string[]).includes('overdue-activity'))
  assert.equal(((detail.record as Row).next as Row).id, 'call-late')
  assert.deepEqual(
    (((model('screen=crm-settings').settings as Row).groups as Row).teams as Row[])
      .map((team) => team.id)
      .sort(),
    ['crm-team-sales', 'team-a', 'team-b'],
  )
  const team = model('screen=crm-team').team as Row
  assert.equal(team.id, 'team-a')
  assert.deepEqual(
    (team.members as Row[]).map((member) => member.userId),
    ['agent'],
  )
  const form = model('screen=lead-new').form as Row
  assert.ok((form.contacts as Row[]).some((contact) => contact.id === 'spa-party'))
})

test('crm sales read: an agent sees their records and their team queue, not a colleague’s', async (t) => {
  const { app } = await boot(t)
  await login(app, 'agent')
  const board = await read(app, 'screen=pipeline')
  assert.equal(board.status, 200)
  assert.equal(board.body.value.actor.role, 'agent')
  assert.deepEqual(board.body.value.can, { write: true, admin: false })
  assert.deepEqual(
    cards(board.body.value)
      .map((card) => card.id)
      .sort(),
    ['deal-mine', 'lead-queue'],
  )
  // An unassigned queue record is the agent's to read, not to edit, until it is assigned to them.
  assert.equal(cards(board.body.value).find((card) => card.id === 'lead-queue')?.writable, false)

  const own = await read(app, 'screen=lead-detail&id=deal-mine')
  assert.equal((own.body.value.detail as Row).writable, true)
  assert.equal(((own.body.value.detail as Row).record as Row).partner, 'Spa Hoa Mai')
  // A record outside their reach reads as missing, not as forbidden, and carries none of its history.
  const other = await read(app, 'screen=lead-detail&id=deal-other')
  assert.equal(other.status, 200)
  assert.equal(other.body.value.detail, null)
})

test('crm sales read: the route keeps its permission and refuses other doors', async (t) => {
  const { app } = await boot(t)
  await login(app, 'clerk')
  assert.equal((await read(app, 'screen=pipeline')).status, 403)
  await login(app, 'agent')
  // The configuration screen needs the configuration read the agent was not given.
  assert.equal((await read(app, 'screen=crm-settings')).status, 403)
  assert.equal((await read(app, 'screen=nowhere')).status, 404)
  const get = await app.client.get('/admin/crm/sales/read')
  assert.equal(get.status, 405)
  const crossSite = await app.client.post(
    '/admin/crm/sales/read',
    JSON.stringify({ query: 'screen=pipeline' }),
    {
      headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' },
    },
  )
  assert.equal(crossSite.status, 403)
  // The read is internal: the generic function path does not serve it.
  const generic = await app.client.post(
    '/_ket/fn/crm_backend.sales.read',
    JSON.stringify({ query: 'screen=pipeline' }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.notEqual(generic.status, 200)
})

const search = async (app: Awaited<ReturnType<typeof boot>>['app'], input: Record<string, unknown>) => {
  const response = await app.client.post('/admin/crm/sales/search', JSON.stringify(input), {
    headers: { 'content-type': 'application/json' },
  })
  return { status: response.status, body: (await response.json()) as { ok: boolean; value: Row } }
}
const rowIds = (value: Row) => ((value.rows as Row[]) ?? []).map((row) => String(row.id)).sort()

test('crm sales list: one page in the reader’s reach, with the count of every view', async (t) => {
  const { app } = await boot(t)
  await login(app, 'agent')
  const open = await search(app, { view: 'open', page: 1, pageSize: 25 })
  assert.equal(open.status, 200)
  assert.deepEqual(rowIds(open.body.value), ['deal-mine', 'lead-queue'])
  const views = (open.body.value.counts as Row).view as Record<string, number>
  assert.equal(views.all, 2)
  assert.equal(views.mine, 1)
  // Rows carry their labels, ready for the table.
  const mine = (open.body.value.rows as Row[]).find((row) => row.id === 'deal-mine') as Row
  assert.deepEqual(mine.title, ['Liệu trình da dầu', 'deal-mine · Spa Hoa Mai'])
  assert.deepEqual(mine.owner, ['User agent', 'Team A'])
  // Searching folds Vietnamese marks and reaches the customer name.
  assert.deepEqual(rowIds((await search(app, { q: 'hoa mai' })).body.value), ['deal-mine'])

  await login(app, 'clerk')
  assert.equal((await search(app, { view: 'open' })).status, 403)
})

test('crm sales list: the export carries every record the list shows, and its permission', async (t) => {
  const { app } = await boot(t)
  await login(app, 'admin')
  const response = await app.client.get('/admin/crm/cases/export?view=open&q=g%C3%B3i')
  assert.equal(response.status, 200)
  assert.match(
    String(response.headers.get('content-disposition')),
    /^attachment; filename="crm-records-\d{4}-\d{2}-\d{2}\.json"$/,
  )
  const body = (await response.json()) as Row
  assert.equal(body.total, 1)
  assert.deepEqual(rowIds(body), ['deal-other'])
  assert.equal((body.scope as Row).view, 'open')
  assert.equal('demo' in body, false)

  await login(app, 'clerk')
  assert.equal(
    (await app.client.get('/admin/crm/cases/export?view=open', { redirect: 'manual' })).status,
    403,
  )
})

test('crm sales record: the page reads its history, notes, interactions and quotes', async (t) => {
  const { app, call } = await boot(t)
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'serum',
    name: 'Serum B5',
    type: 'goods',
    uomId: 'unit',
    listPrice: '390000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('product.saveVariant', { id: 'serum-1', templateId: 'serum', combinationKey: '' })
  await call('stock.saveWarehouse', { id: 'main', code: 'MAIN', name: 'Main warehouse' })
  await call('crm.case.move', {
    id: 'deal-mine',
    stageId: 'crm-stage-qualified',
    expectedVersion: 1,
    idempotencyKey: 'move-deal-mine',
  })
  await call('crm.case.addMessage', {
    id: 'note-1',
    caseId: 'deal-mine',
    body: 'Khách cần báo giá trước thứ Sáu',
    visibility: 'internal',
    idempotencyKey: 'note-deal-mine',
  })
  await call('crm.case.logInteraction', {
    id: 'deal-mine',
    expectedVersion: 2,
    channel: 'phone',
    outcome: 'reached',
    note: 'Đã gọi, hẹn gửi báo giá',
    idempotencyKey: 'call-deal-mine',
  })
  const quoted = await call<Row>('crm_sale.sale.createQuotation', {
    id: 'quote-1',
    caseId: 'deal-mine',
    warehouseId: 'main',
    products: [{ productId: 'serum-1', productUomId: 'unit', quantity: '2' }],
    idempotencyKey: 'quote-deal-mine',
  })
  assert.equal(quoted.ok, true, JSON.stringify(quoted))

  await login(app, 'admin')
  const { body } = await read(app, 'screen=lead-detail&id=deal-mine&tab=quotes')
  const detail = body.value.detail as Row
  const feed = detail.feed as Row[]
  const events = feed.filter((entry) => entry.kind === 'event').map((entry) => entry.title)
  // Events read as the screens name them; their message keys never reach the page.
  assert.ok(events.includes('create'), JSON.stringify(events))
  assert.ok(events.includes('quote-create'), JSON.stringify(events))
  const move = feed.find((entry) => entry.title === 'move') as Row
  assert.deepEqual(move.meta, { from: 'crm-stage-proposition', to: 'crm-stage-qualified' })
  assert.ok(!feed.some((entry) => /^crm\.timeline\./.test(String(entry.body ?? ''))))
  const note = feed.find((entry) => entry.kind === 'note') as Row
  assert.equal(note.body, 'Khách cần báo giá trước thứ Sáu')
  const interaction = feed.find((entry) => entry.kind === 'interaction') as Row
  assert.equal(interaction.channel, 'phone')
  assert.equal(interaction.body, 'Đã gọi, hẹn gửi báo giá')
  // Each happening appears once: the note and the interaction are not repeated as events.
  assert.equal(feed.filter((entry) => entry.kind === 'event' && entry.title === 'interaction').length, 0)

  const quotes = detail.quotes as Row[]
  assert.equal(quotes.length, 1)
  const quote = quotes[0] as Row
  assert.equal(quote.state, 'draft')
  const line = (quote.lines as Row[])[0] as Row
  assert.equal(line.name, 'Serum B5')
  assert.equal(line.quantity, 2)
  assert.equal(line.net, 780_000)
  assert.deepEqual(detail.orders, [])
  // The quote dialog offers what may be sold.
  assert.ok(
    (body.value.products as Row[]).some((product) => product.id === 'serum-1' && product.price === 390_000),
  )
})

test('crm sales lead form: a customer link starts the form, read under the reader’s partner permission', async (t) => {
  const { app, call } = await boot(t)
  // A person with no record yet, who agreed to be contacted.
  await call('partner.savePartner', {
    id: 'lan-party',
    kind: 'person',
    name: 'Nguyễn Thị Lan',
    phone: '0912 000 111',
    email: 'lan@example.com',
    contactConsent: true,
  })
  // The customer's phone as the partner module keeps it.
  const saved = (await call('partner.getPartner', { id: 'lan-party' })) as Row
  await login(app, 'admin')
  const linked = await read(app, 'screen=lead-new&kind=opportunity&partnerId=lan-party')
  assert.equal(linked.status, 200)
  const form = linked.body.value.form as Row
  assert.deepEqual(form.prefill, {
    kind: 'opportunity',
    partnerId: 'lan-party',
    contactName: 'Nguyễn Thị Lan',
    phone: saved.phone,
    email: 'lan@example.com',
  })
  assert.ok((form.contacts as Row[]).some((contact) => contact.id === 'lan-party'))
  // An unknown customer or kind starts an empty lead.
  const unknown = (await read(app, 'screen=lead-new&kind=deal&partnerId=nobody')).body.value.form as Row
  assert.deepEqual(unknown.prefill, { kind: 'lead' })

  // The agent may create records but not read customers: the link names nobody they may see.
  await login(app, 'agent')
  const agent = (await read(app, 'screen=lead-new&partnerId=lan-party')).body.value.form as Row
  assert.deepEqual(agent.prefill, { kind: 'lead' })
  assert.ok(!(agent.contacts as Row[]).some((contact) => contact.id === 'lan-party'))
})

test('crm sales record: the customer’s consent and contact come from the customer and the latest record', async (t) => {
  const { app, call } = await boot(t)
  await call('partner.savePartner', {
    id: 'spa-party',
    kind: 'company',
    name: 'Spa Hoa Mai',
    contactConsent: true,
  })
  await call('crm.case.save', {
    id: 'deal-mine-2',
    kind: 'lead',
    name: 'Hỏi thêm gói',
    partnerId: 'spa-party',
    teamId: 'team-a',
    contactName: 'Chị Mai',
    idempotencyKey: 'case-deal-mine-2',
  })
  await login(app, 'admin')
  const detail = (await read(app, 'screen=lead-detail&id=deal-mine')).body.value.detail as Row
  const partner = detail.partner as Row
  assert.equal(partner.consent, true)
  assert.equal(partner.contactName, 'Chị Mai')
})

test('crm sales help: the planner speaks of the company’s clock; only the demo of its fixed one', () => {
  for (const lang of ['vi', 'en']) {
    const live = salesHelp('activity-planner', lang)
    assert.match(live, lang === 'en' ? /company’s time zone/ : /múi giờ của công ty/)
    assert.doesNotMatch(live, /demo|mô phỏng|simulated|Google/i)
    assert.match(
      salesHelp('activity-planner', lang, { demo: true }),
      lang === 'en' ? /fixed demo clock/ : /đồng hồ demo cố định/,
    )
  }
})

test('crm sales help: the board and the record draw their workflow as one flowchart each', () => {
  for (const lang of ['vi', 'en'])
    for (const screen of ['pipeline', 'lead-detail']) {
      const fences = salesHelp(screen, lang).match(/```mermaid\nflowchart TD\n[\s\S]*?\n```/g) ?? []
      assert.equal(fences.length, 1, `${screen} ${lang}`)
      // Outcomes take the DS theme classes, never a palette of their own.
      assert.match(fences[0], /\n {2}class \w+ kv-(accent|positive|danger)/)
      assert.doesNotMatch(fences[0], /%%|classDef|style /)
    }
})

test('crm sales configuration: standard loss reasons and seeded stage names read in the reader’s language', async (t) => {
  const { app, call } = await boot(t)
  // A record lost into the budget bucket, before the company has saved a reason of its own.
  const lost = (await call('crm.case.get', { id: 'deal-other' })) as Row
  const closed = (await call('crm.case.markLost', {
    id: 'deal-other',
    expectedVersion: Number(lost.version),
    lostReason: 'Khách chê đắt',
    lostReasonCode: 'budget',
    idempotencyKey: 'lose-deal-other',
  })) as Row
  assert.equal(closed.ok, true, JSON.stringify(closed))
  // A renamed seed stage keeps the company's name.
  const renamed = (await call('crm.stage.save', {
    values: {
      id: 'crm-stage-qualified',
      code: 'qualified',
      name: 'Đã chốt nhu cầu',
      allowedKinds: ['lead', 'opportunity'],
    },
    idempotencyKey: 'rename-qualified',
  })) as Row
  assert.equal(renamed.ok, true, JSON.stringify(renamed))
  await login(app, 'admin')

  const settings = (await read(app, 'screen=crm-settings&tab=process')).body.value
  const reasons = (settings.settings as Row).groups as Row
  assert.deepEqual(
    (reasons.lostReasons as Row[]).map((reason) => [reason.id, reason.name, reason.code, reason.used]),
    [
      ['crm-lost-budget', 'Giá / ngân sách', 'budget', 1],
      ['crm-lost-fit', 'Chưa phù hợp nhu cầu', 'fit', 0],
      ['crm-lost-competitor', 'Chọn đối thủ', 'competitor', 0],
      ['crm-lost-no_need', 'Không còn nhu cầu', 'no_need', 0],
      ['crm-lost-other', 'Lý do khác', 'other', 0],
    ],
  )
  const names = (model: Row) =>
    Object.fromEntries((model.stages as Row[]).map((stage) => [stage.code, stage.name]))
  assert.deepEqual(names(settings), {
    new: 'Mới',
    qualified: 'Đã chốt nhu cầu',
    proposition: 'Đề xuất',
    won: 'Thành công',
    lost: 'Thất bại',
  })
  const english = (await read(app, 'screen=crm-settings&tab=process&lang=en')).body.value
  assert.equal(names(english).new, 'New')
  assert.equal(names(english).qualified, 'Đã chốt nhu cầu')
  const englishReasons = ((english.settings as Row).groups as Row).lostReasons as Row[]
  assert.equal(englishReasons[0]?.name, 'Price or budget')
})

test('crm sales board: its totals weigh open deals by their probability and follow the filters', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  await call('crm.tag.save', { id: 'tag-gift', name: 'Gift' })
  const save = (id: string, revenue: number, probability: number, tagIds: string[] = []) =>
    call('crm.case.save', {
      id,
      kind: 'opportunity',
      name: `Board ${id}`,
      partnerId: 'acme-party',
      teamId: 'team-a',
      stageId: 'crm-stage-qualified',
      expectedRevenue: revenue,
      probability,
      tagIds,
      idempotencyKey: `board-${id}`,
    })
  await save('one', 100, 25, ['tag-gift'])
  await save('two', 200, 50)
  await save('won', 400, 100)
  await call('crm.activity.schedule', {
    id: 'board-call',
    caseId: 'one',
    summary: 'Call the buyer back',
    dueDate: '2020-01-01',
    idempotencyKey: 'board-call',
  })
  const board = async () => (await read(app, 'screen=pipeline&q=Board')).body.value
  const before = await board()
  // 100×25% + 200×50% + 400×100%: a probability is a percentage, not a factor.
  assert.deepEqual((before.pipeline as Row).totals, { count: 3, gross: 700, weighted: 525 })
  const one = cards(before).find((card) => card.id === 'one') as Card & { tags: string[] }
  assert.deepEqual(one.tags, ['tag-gift'])
  assert.ok((before.tags as Row[]).some((tag) => tag.id === 'tag-gift' && tag.name === 'Gift'))
  assert.equal(one.next?.title, 'Call the buyer back')
  assert.ok(one.flags.includes('overdue-activity'))

  // A won deal leaves the open totals for the month's outcomes.
  const held = await call('crm.case.get', { id: 'won' })
  await call('crm.case.markWon', { id: 'won', expectedVersion: held.version, idempotencyKey: 'board-won' })
  const after = (await board()).pipeline as Row
  assert.deepEqual(after.totals, { count: 2, gross: 300, weighted: 125 })
  assert.deepEqual((after.closed as Row).won, { count: 1, value: 400 })
  assert.deepEqual(((await read(app, 'screen=pipeline&q=Board one')).body.value.pipeline as Row).totals, {
    count: 1,
    gross: 100,
    weighted: 25,
  })
})

test('crm sales configuration: a team switched off stays listed, marked off, to switch back on', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  await call('crm.team.save', {
    values: { id: 'team-retired', name: 'Retired team', code: 'retired', active: false },
    idempotencyKey: 'team-retired',
  })
  const teams = (((await read(app, 'screen=crm-settings')).body.value.settings as Row).groups as Row)
    .teams as Row[]
  assert.equal(teams.find((team) => team.id === 'team-retired')?.active, false)
  assert.equal(teams.find((team) => team.id === 'team-a')?.active, true)
})
