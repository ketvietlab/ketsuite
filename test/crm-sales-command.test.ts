import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { type Row, tableNameFor } from '@ketvietlab/ketjs'
import { type App, boot, login, read } from './helpers/crm-sales.ts'

type Reply = {
  location: string
  response?: { input: Record<string, string>; message: string; fields: Record<string, string>; code: string }
  notice?: { message: string; bulk?: Row[] }
}

const post = (app: App, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  app.client.post('/admin/crm/sales/command', new URLSearchParams(fields).toString(), {
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    redirect: 'manual',
  })

/** Posts a sales screen's form as its island does, asking for the reply instead of a redirect. */
const send = async (app: App, fields: Record<string, string>): Promise<Reply> => {
  const response = await post(app, { requestId: randomUUID(), ...fields }, { 'x-crm-sales-resolve': '1' })
  assert.equal(response.status, 200)
  return (await response.json()) as Reply
}

/** The command landed: no refusal came back. */
const accepted = (reply: Reply) => assert.equal(reply.response, undefined, JSON.stringify(reply.response))

test('an edit keeps what its form does not carry and returns to the record', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'agent')
  const before = await call('crm.case.get', { id: 'deal-mine' })
  const reply = await send(app, {
    command: 'save',
    context: 'screen=lead-detail&id=deal-mine&tab=detail&viewer=admin&role=manager',
    id: 'deal-mine',
    version: String(before.version),
    name: 'Liệu trình da dầu · gói hai',
    contactName: 'Chị Hoa',
    phone: '0909 111 222',
    priority: '2',
    consent: 'on',
  })
  accepted(reply)
  // The demo's persona never rides along.
  assert.equal(reply.location, '/admin/crm/cases/deal-mine?tab=detail&notice=saved')
  assert.equal(reply.notice?.message, 'Đã cập nhật')
  const after = await call('crm.case.get', { id: 'deal-mine' })
  assert.equal(after.name, 'Liệu trình da dầu · gói hai')
  assert.equal(after.priority, '2')
  assert.equal(after.contactConsent, true)
  // What the edit form does not show stays as it was.
  assert.equal(after.stageId, 'crm-stage-proposition')
  assert.equal(after.partnerId, 'spa-party')
  assert.equal(after.teamId, 'team-a')
  assert.equal(after.utmSource, 'website')
  assert.equal(Number(after.expectedRevenue), 12_000_000)
})

test('a stale or unreadable record keeps the draft and the dialog it came from', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'agent')
  const before = await call('crm.case.get', { id: 'deal-mine' })
  const requestId = randomUUID()
  const stale = await send(app, {
    requestId,
    command: 'forecast-save',
    context: 'screen=lead-detail&id=deal-mine&dialog=forecast&notice=saved',
    id: 'deal-mine',
    version: String(Number(before.version) - 1),
    expectedRevenue: '15000000',
    probability: '60',
  })
  assert.equal(stale.response?.code, 'E_CONFLICT')
  assert.equal(stale.response?.input.expectedRevenue, '15000000')
  assert.equal(stale.response?.input.context, undefined)
  assert.equal(stale.location, `/admin/crm/cases/deal-mine?dialog=forecast&error=${requestId}`)
  assert.equal(Number((await call('crm.case.get', { id: 'deal-mine' })).expectedRevenue), 12_000_000)

  const typo = await send(app, {
    command: 'forecast-save',
    context: 'screen=lead-detail&id=deal-mine&dialog=forecast',
    id: 'deal-mine',
    version: String(before.version),
    expectedRevenue: 'mười lăm triệu',
  })
  assert.equal(typo.response?.code, 'E_VALIDATION')
  assert.equal(typo.response?.fields.expectedRevenue, 'Nhập một số.')

  // Another team's record is not this agent's to read, so not theirs to change.
  const other = await call('crm.case.get', { id: 'deal-other' })
  const hidden = await send(app, {
    command: 'save',
    context: 'screen=lead-detail&id=deal-other',
    id: 'deal-other',
    version: String(other.version),
    name: 'Đổi tên',
  })
  assert.equal(hidden.response?.code, 'E_NOT_FOUND')
  assert.equal((await call('crm.case.get', { id: 'deal-other' })).name, 'Gói spa cuối tuần')
})

test('a loss names a reason and its note; a reopen returns to the first open stage with why', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'agent')
  const close = async (fields: Record<string, string>) =>
    send(app, {
      command: 'close',
      context: 'screen=lead-detail&id=deal-mine&dialog=close',
      id: 'deal-mine',
      version: String((await call('crm.case.get', { id: 'deal-mine' })).version),
      terminalState: 'lost',
      lostReasonId: 'crm-lost-competitor',
      ...fields,
    })
  const refused = await close({})
  assert.equal(refused.response?.code, 'E_FORBIDDEN')

  for (const fnKey of ['crm.case.markLost', 'crm.case.move', 'crm.case.addMessage'])
    await call('user.grantFunction', { id: `sales-agent:${fnKey}`, roleId: 'sales-agent', fnKey })
  const unexplained = await close({})
  assert.equal(unexplained.response?.code, 'E_VALIDATION')
  assert.ok(unexplained.response?.fields.note, 'a competitor needs a note')
  assert.match(unexplained.location, /dialog=close/)

  const lost = await close({ note: 'Bên kia rẻ hơn 10%' })
  accepted(lost)
  assert.equal(lost.notice?.message, 'Đã đánh dấu thất bại')
  const closed = await call('crm.case.get', { id: 'deal-mine' })
  assert.equal(closed.terminalState, 'lost')
  const sales = closed.salesDetail as Row
  assert.equal(sales.lostReasonId, 'crm-lost-competitor')
  assert.equal(sales.lostReasonCode, 'competitor')
  assert.equal(sales.lostReason, 'Chọn đối thủ')

  // A closed record takes no edit until it is reopened.
  const edit = await send(app, {
    command: 'save',
    context: 'screen=lead-detail&id=deal-mine',
    id: 'deal-mine',
    version: String(closed.version),
    name: 'Sửa khi đã đóng',
  })
  assert.equal(edit.response?.code, 'E_STATE')

  const reopened = await send(app, {
    command: 'reopen',
    context: 'screen=lead-detail&id=deal-mine&dialog=reopen',
    id: 'deal-mine',
    version: String(closed.version),
    reason: 'Khách quay lại hỏi giá',
  })
  accepted(reopened)
  const open = await call('crm.case.get', { id: 'deal-mine' })
  assert.equal(open.terminalState, 'open')
  assert.equal(open.stageId, 'crm-stage-new')
  assert.ok(
    (open.messages as Row[]).some(
      (message) => message.body === 'Mở lại: Khách quay lại hỏi giá' && message.visibility === 'internal',
    ),
  )
})

test('a lead that goes nowhere can be lost', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const lead = await call('crm.case.get', { id: 'lead-queue' })
  const reply = await send(app, {
    command: 'close',
    context: 'screen=lead-detail&id=lead-queue&dialog=close',
    id: 'lead-queue',
    version: String(lead.version),
    terminalState: 'lost',
    lostReasonId: 'crm-lost-budget',
  })
  accepted(reply)
  assert.equal((await call('crm.case.get', { id: 'lead-queue' })).terminalState, 'lost')
  const won = await send(app, {
    command: 'close',
    context: 'screen=lead-detail&id=deal-other',
    id: 'deal-other',
    version: String((await call('crm.case.get', { id: 'deal-other' })).version),
    terminalState: 'won',
  })
  accepted(won)
  assert.equal((await call('crm.case.get', { id: 'deal-other' })).terminalState, 'won')
})

test('a new record finds its customer by phone, or makes one, and a retry creates nothing twice', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const requestId = randomUUID()
  const fields = {
    requestId,
    command: 'create',
    context: 'screen=lead-new',
    kind: 'lead',
    name: 'Hỏi liệu trình trị mụn',
    contactName: 'Chị Lan',
    phone: '0903 555 111',
    source: 'Zalo OA',
    teamId: 'team-a',
    consent: 'on',
    'tagIds[]': '',
  }
  const first = await send(app, fields)
  accepted(first)
  assert.equal(first.location, `/admin/crm/cases/${requestId}?notice=saved`)
  assert.equal(first.notice?.message, 'Đã tạo hồ sơ')
  const created = await call('crm.case.get', { id: requestId })
  assert.equal(created.kind, 'lead')
  assert.equal(created.utmSource, 'Zalo OA')
  assert.equal(created.contactConsent, true)
  const partner = await call('partner.getPartner', { id: String(created.partnerId) })
  assert.equal(partner.name, 'Chị Lan')
  assert.equal(partner.contactConsent, true)

  // The same request again is the same record.
  const again = await send(app, fields)
  assert.equal(again.location, first.location)
  const listed = await call<Row>('crm.case.list', { search: 'Hỏi liệu trình trị mụn' })
  assert.equal(
    ((listed.rows ?? listed) as Row[]).filter((row) => row.name === 'Hỏi liệu trình trị mụn').length,
    1,
  )

  // Another enquiry from the same phone, written differently, belongs to the same customer.
  const second = randomUUID()
  await send(app, { ...fields, requestId: second, name: 'Hỏi gói chăm sóc', phone: '0903555111' })
  assert.equal((await call('crm.case.get', { id: second })).partnerId, created.partnerId)
  // "A new customer" is a new customer even with a known phone.
  const third = randomUUID()
  await send(app, { ...fields, requestId: third, name: 'Hỏi cho người nhà', partnerId: 'new' })
  assert.notEqual((await call('crm.case.get', { id: third })).partnerId, created.partnerId)
})

test('an integrated source takes an event in once', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const event = {
    command: 'intake',
    context: 'screen=lead-new&mode=intake',
    kind: 'lead',
    name: 'Form website: hỏi giá',
    email: 'khach.moi@example.com',
    source: 'Website',
    externalId: 'form-77',
  }
  const first = await send(app, event)
  accepted(first)
  const id = new URL(first.location, 'http://x').pathname.split('/').pop()
  assert.ok(id)
  const again = await send(app, event)
  assert.equal(again.notice?.message, 'Sự kiện đã xử lý; không tạo trùng')
  assert.equal(new URL(again.location, 'http://x').pathname, `/admin/crm/cases/${id}`)
  assert.equal((await call('crm.case.get', { id })).name, 'Form website: hỏi giá')

  const unknown = await send(app, { ...event, source: 'Facebook', externalId: 'fb-1' })
  assert.equal(unknown.response?.code, 'E_VALIDATION')
  assert.ok(unknown.response?.fields.source)
})

test('a quick move stays on the board; foreign, demo-only and scriptless posts behave', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const held = await call('crm.case.get', { id: 'deal-mine' })
  const moved = await send(app, {
    command: 'move',
    context: 'screen=pipeline&view=board&id=deal-mine&stage=crm-stage-qualified&lang=en',
    lang: 'en',
    stay: '1',
    id: 'deal-mine',
    version: String(held.version),
    stageId: 'crm-stage-qualified',
  })
  accepted(moved)
  assert.equal(moved.location, '/admin/crm/pipeline?view=board&lang=en&notice=saved')
  assert.equal(moved.notice?.message, 'Stage changed')
  assert.equal((await call('crm.case.get', { id: 'deal-mine' })).stageId, 'crm-stage-qualified')

  const note = await send(app, {
    command: 'note',
    context: 'screen=lead-detail&id=deal-mine',
    id: 'deal-mine',
    message: 'Khách hẹn gọi lại sau Tết',
  })
  accepted(note)
  assert.ok(
    ((await call('crm.case.get', { id: 'deal-mine' })).messages as Row[]).some(
      (message) => message.body === 'Khách hẹn gọi lại sau Tết',
    ),
  )

  const reset = await send(app, { command: 'reset', context: 'screen=pipeline' })
  assert.equal(reset.response?.code, 'E_FORBIDDEN')
  const unknown = await send(app, { command: 'drop-table', context: 'screen=pipeline' })
  assert.equal(unknown.response?.code, 'E_BAD_INPUT')

  const foreign = await post(
    app,
    { command: 'note', requestId: randomUUID(), id: 'deal-mine', message: 'x' },
    { origin: 'https://elsewhere.example', 'x-crm-sales-resolve': '1' },
  )
  assert.equal(foreign.status, 403)

  const plain = await post(app, {
    command: 'note',
    requestId: randomUUID(),
    context: 'screen=lead-detail&id=deal-mine',
    id: 'deal-mine',
    message: 'Ghi chú không cần script',
  })
  assert.equal(plain.status, 303)
  assert.equal(plain.headers.get('location'), '/admin/crm/cases/deal-mine?notice=saved')
})

test('activities are scheduled, moved, finished and cancelled from the record and the planner', async (t) => {
  const { app, call } = await boot(t)
  await call('activity.saveType', {
    id: 'type-meeting',
    name: 'Gặp khách',
    category: 'meeting',
    defaultDelayDays: 0,
    chainingPolicy: 'none',
    sequence: 5,
    active: true,
  })
  await call('activity.savePlan', {
    id: 'plan-onboard',
    name: 'Chào khách mới',
    active: true,
    steps: [
      { typeId: 'type-meeting', offsetDays: 0, summary: 'Gặp giới thiệu' },
      { typeId: 'type-meeting', offsetDays: 7, summary: 'Hỏi lại cảm nhận' },
    ],
  })
  await login(app, 'agent')
  const version = async () => String((await call('crm.case.get', { id: 'deal-mine' })).version)
  const activities = async () =>
    ((await call('crm.case.get', { id: 'deal-mine' })).activities as Row[]).filter(
      (row) => row.active !== false,
    )

  // Moving an activity's day is the right that completes or cancels it.
  const early = await send(app, {
    command: 'reschedule',
    context: 'screen=activity-planner&view=week&id=deal-mine&activity=meet-today&dialog=reschedule',
    stay: '1',
    id: 'deal-mine',
    version: await version(),
    activityId: 'meet-today',
    due: '2026-11-05T10:00',
  })
  assert.equal(early.response?.code, 'E_FORBIDDEN')
  for (const fnKey of [
    'crm.activity.schedule',
    'crm.activity.complete',
    'crm.activity.cancel',
    'crm.case.logInteraction',
    'crm.plan.apply',
  ])
    await call('user.grantFunction', { id: `sales-agent:${fnKey}`, roleId: 'sales-agent', fnKey })

  const moved = await send(app, {
    command: 'reschedule',
    context: 'screen=activity-planner&view=week&id=deal-mine&activity=meet-today&dialog=reschedule',
    stay: '1',
    id: 'deal-mine',
    version: await version(),
    activityId: 'meet-today',
    due: '2026-11-05T10:00',
  })
  accepted(moved)
  assert.equal(moved.location, '/admin/crm/activities?view=week&notice=saved')
  assert.equal((await activities()).find((row) => row.id === 'meet-today')?.dueDate, '2026-11-05')

  const scheduled = await send(app, {
    command: 'activity',
    context: 'screen=lead-detail&id=deal-mine&dialog=activity',
    id: 'deal-mine',
    version: await version(),
    summary: 'Gặp chị Hoa tại spa',
    activityType: 'meeting',
    due: '2026-11-03T09:30',
  })
  accepted(scheduled)
  const meeting = (await activities()).find((row) => row.summary === 'Gặp chị Hoa tại spa')
  assert.equal(meeting?.typeId, 'type-meeting')
  assert.equal(meeting?.dueDate, '2026-11-03')
  assert.equal(meeting?.assigneeUserId, 'agent')

  const cancelled = await send(app, {
    command: 'activity-cancel',
    context: 'screen=lead-detail&id=deal-mine&activity=x&dialog=activity-cancel',
    id: 'deal-mine',
    version: await version(),
    activityId: String(meeting?.id),
    reason: 'Khách đổi lịch sang tháng sau',
  })
  accepted(cancelled)
  const done = await send(app, {
    command: 'activity-complete',
    context: 'screen=lead-detail&id=deal-mine',
    id: 'deal-mine',
    version: await version(),
    activityId: 'meet-today',
    feedback: 'Khách đồng ý thử liệu trình',
  })
  accepted(done)
  const again = await send(app, {
    command: 'activity-complete',
    context: 'screen=lead-detail&id=deal-mine',
    id: 'deal-mine',
    version: await version(),
    activityId: 'meet-today',
    feedback: 'Bấm hai lần',
  })
  assert.equal(again.response?.code, 'E_STATE')
  assert.equal(again.response?.message, 'Công việc không còn mở.')

  const talked = await send(app, {
    command: 'interaction',
    context: 'screen=lead-detail&id=deal-mine&dialog=interaction',
    id: 'deal-mine',
    version: await version(),
    channel: 'phone',
    summary: 'Khách hỏi thêm về gói 10 buổi',
    nextAt: '2026-11-10T08:00',
  })
  accepted(talked)
  const followUp = (await activities()).find((row) => row.summary === 'Liên hệ lại')
  assert.equal(followUp?.dueDate, '2026-11-10')

  const planned = await send(app, {
    command: 'plan',
    context: 'screen=lead-detail&id=deal-mine&dialog=plan',
    id: 'deal-mine',
    version: await version(),
    planId: 'plan-onboard',
    start: '2026-11-12',
    // Not the person applying it, whom each step would pick by itself.
    assigneeUserId: 'admin',
  })
  accepted(planned)
  const steps = (await activities()).filter(
    (row) => row.summary === 'Gặp giới thiệu' || row.summary === 'Hỏi lại cảm nhận',
  )
  assert.deepEqual(steps.map((row) => row.dueDate).sort(), ['2026-11-12', '2026-11-19'])
  assert.deepEqual([...new Set(steps.map((row) => row.assigneeUserId))], ['admin'])

  // The record's history says what happened, in the words of the screen.
  const { body } = await read(app, 'screen=lead-detail&id=deal-mine')
  const titles = ((body.value.detail as Row).feed as Row[]).map((entry) => entry.title)
  assert.ok(titles.includes('reschedule'), titles.join(','))
  assert.ok(titles.includes('plan'), titles.join(','))
})

test('reopening a closed record reads as a reopen in its history', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const held = await call('crm.case.get', { id: 'deal-other' })
  accepted(
    await send(app, {
      command: 'close',
      context: 'screen=lead-detail&id=deal-other',
      id: 'deal-other',
      version: String(held.version),
      terminalState: 'lost',
      lostReasonId: 'crm-lost-budget',
    }),
  )
  accepted(
    await send(app, {
      command: 'reopen',
      context: 'screen=lead-detail&id=deal-other',
      id: 'deal-other',
      version: String((await call('crm.case.get', { id: 'deal-other' })).version),
      reason: 'Khách xin báo giá lại',
    }),
  )
  const { body } = await read(app, 'screen=lead-detail&id=deal-other')
  const events = ((body.value.detail as Row).feed as Row[]).filter((entry) => entry.kind === 'event')
  assert.ok(
    events.some((entry) => entry.title === 'reopen' && entry.meta === null),
    JSON.stringify(events),
  )
})

test('the settings save stages, loss reasons, rules, teams and members against the version they read', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const settings = async () =>
    ((await read(app, 'screen=crm-settings')).body.value.settings as { groups: Record<string, Row[]> }).groups
  const config = (fields: Record<string, string>) =>
    send(app, {
      command: 'config-save',
      context: 'screen=crm-settings&dialog=config',
      active: 'on',
      ...fields,
    })
  const qualified = (await settings()).stages?.find((stage) => stage.id === 'crm-stage-qualified') as Row
  const stage = {
    group: 'stages',
    configId: 'crm-stage-qualified',
    name: String(qualified.name),
    code: String(qualified.code),
    sequence: '20',
    terminalState: 'open',
    allowedKinds: 'both',
  }
  const saved = await config({
    ...stage,
    configVersion: String(qualified.version),
    probability: '35',
    staleDays: '7',
  })
  accepted(saved)
  assert.equal(saved.location, '/admin/crm/configuration?notice=saved')
  assert.equal(saved.notice?.message, 'Đã lưu cấu hình')
  const after = (await settings()).stages?.find((row) => row.id === 'crm-stage-qualified') as Row
  assert.equal(after.probability, 35)
  assert.equal(after.staleDays, 7)
  assert.equal(after.version, Number(qualified.version) + 1)
  // The form read the stage before that save: this one is a conflict, not an overwrite.
  const stale = await config({ ...stage, configVersion: String(qualified.version), probability: '50' })
  assert.equal(stale.response?.code, 'E_CONFLICT')
  assert.equal(stale.response?.message, 'Cấu hình đã đổi; đọc lại trước khi lưu.')
  const range = await config({ ...stage, configVersion: String(after.version), probability: '150' })
  assert.equal(range.response?.fields.probability, 'Giá trị nằm ngoài khoảng cho phép.')
  // A stage that holds an opportunity cannot stop taking them.
  const proposition = (await settings()).stages?.find((row) => row.id === 'crm-stage-proposition') as Row
  const held = await config({
    group: 'stages',
    configId: 'crm-stage-proposition',
    configVersion: String(proposition.version),
    name: String(proposition.name),
    code: String(proposition.code),
    terminalState: 'open',
    allowedKinds: 'lead',
  })
  assert.equal(held.response?.code, 'E_STATE')
  assert.match(String(held.response?.fields.active), /Giai đoạn đang có hồ sơ/)

  // The first saved loss reason keeps the standard five beside it, and an edit renames one of them.
  const added = await config({ group: 'lostReasons', configId: '', name: 'Hết hàng', sequence: '60' })
  accepted(added)
  const budget = (await settings()).lostReasons?.find((row) => row.id === 'crm-lost-budget') as Row
  const renamed = await config({
    group: 'lostReasons',
    configId: 'crm-lost-budget',
    configVersion: String(budget.version),
    name: 'Vượt ngân sách',
    sequence: '10',
  })
  accepted(renamed)
  const again = await config({
    group: 'lostReasons',
    configId: 'crm-lost-budget',
    configVersion: String(budget.version),
    name: 'Ngân sách',
  })
  assert.equal(again.response?.code, 'E_CONFLICT')
  const twice = await config({ group: 'lostReasons', configId: '', name: 'Hết hàng' })
  assert.equal(twice.response?.fields.name, 'Tên này đã được dùng.')
  const reasons = (await settings()).lostReasons as Row[]
  assert.deepEqual(
    reasons.map((row) => row.name),
    ['Vượt ngân sách', 'Chưa phù hợp nhu cầu', 'Chọn đối thủ', 'Không còn nhu cầu', 'Lý do khác', 'Hết hàng'],
  )
  assert.equal(reasons.find((row) => row.name === 'Vượt ngân sách')?.code, 'budget')
  // A record still closes on a standard reason once the company keeps its own list.
  const deal = await call('crm.case.get', { id: 'deal-mine' })
  accepted(
    await send(app, {
      command: 'close',
      id: 'deal-mine',
      version: String(deal.version),
      terminalState: 'lost',
      lostReasonId: 'crm-lost-budget',
    }),
  )

  // A rule saved without its kinds keeps them; an emptied recipient is cleared.
  const rule = await config({
    group: 'assignmentRules',
    configId: '',
    name: 'Website cho đội A',
    priority: '5',
    teamId: 'team-a',
    utmSource: 'website',
    assigneeUserId: 'agent',
  })
  accepted(rule)
  const created = (await settings()).assignmentRules?.find((row) => row.name === 'Website cho đội A') as Row
  assert.equal(created.assigneeUserId, 'agent')
  assert.deepEqual(created.allowedKinds, ['lead', 'opportunity'])
  accepted(
    await config({
      group: 'assignmentRules',
      configId: String(created.id),
      configVersion: String(created.version),
      name: 'Website cho đội A',
      priority: '5',
      teamId: 'team-a',
      utmSource: 'website',
      assigneeUserId: '',
    }),
  )
  const cleared = (await settings()).assignmentRules?.find((row) => row.id === created.id) as Row
  assert.equal(cleared.assigneeUserId, '')
  assert.deepEqual(cleared.allowedKinds, ['lead', 'opportunity'])

  const team = (await settings()).teams?.find((row) => row.id === 'team-a') as Row
  const teamFields = {
    group: 'teams',
    configId: 'team-a',
    name: 'Team A',
    code: 'a',
    assignmentMode: 'round_robin',
  }
  accepted(await config({ ...teamFields, configVersion: String(team.version), leaderUserId: 'admin' }))
  accepted(await config({ ...teamFields, configVersion: String(Number(team.version) + 1), leaderUserId: '' }))
  const led = (await settings()).teams?.find((row) => row.id === 'team-a') as Row
  assert.equal(led.leaderUserId, '')
  assert.equal(led.assignmentMode, 'round_robin')

  accepted(await config({ group: 'tags', configId: '', name: 'VIP' }))
  assert.ok((await settings()).tags?.some((row) => row.name === 'VIP'))
  assert.equal((await config({ group: 'plans', name: 'X' })).response?.code, 'E_BAD_INPUT')

  // A member joins a team once, with a weight of at least one.
  const member = (fields: Record<string, string>) =>
    send(app, {
      command: 'member-save',
      context: 'screen=crm-team&team=team-a&dialog=member',
      teamId: 'team-a',
      memberId: '',
      active: 'on',
      ...fields,
    })
  accepted(await member({ userId: 'clerk', capacity: '3', sequence: '20' }))
  const members = await call<Row[]>('crm.team.member.list', { teamId: 'team-a' })
  assert.equal(members.find((row) => row.userId === 'clerk')?.capacity, 3)
  assert.equal(
    (await member({ userId: 'other', capacity: '0' })).response?.fields.capacity,
    'Giá trị nằm ngoài khoảng cho phép.',
  )
  assert.equal((await member({ userId: 'agent', capacity: '1' })).response?.code, 'E_VALIDATION')

  // The configuration right stands behind the loss reasons too.
  await login(app, 'agent')
  const refused = await config({ group: 'lostReasons', configId: '', name: 'Khác nữa' })
  assert.equal(refused.response?.code, 'E_FORBIDDEN')
})

test('bulk assignment gives the open records to one person, skips the rest and refuses a changed list', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const { revision } = (await read(app, 'screen=cases')).body.value
  const fields = {
    requestId: randomUUID(),
    command: 'bulk-assign',
    context: 'screen=cases&dialog=bulk-assign&ids=deal-mine,lead-queue,deal-other,nope',
    ids: 'deal-mine,lead-queue,deal-other,nope',
    assigneeUserId: 'agent',
    revision: String(revision),
  }
  const reply = await send(app, fields)
  accepted(reply)
  assert.equal(reply.location, '/admin/crm/cases?notice=saved')
  assert.equal(reply.notice?.message, 'Đã phân công 2/4 hồ sơ; 2 bỏ qua')
  assert.deepEqual(
    reply.notice?.bulk?.map((row) => [row.id, row.state]),
    [
      ['deal-mine', 'assigned'],
      ['lead-queue', 'assigned'],
      ['deal-other', 'skipped'],
      ['nope', 'skipped'],
    ],
  )
  assert.equal((await call('crm.case.get', { id: 'lead-queue' })).assigneeUserId, 'agent')
  assert.equal((await call('crm.case.get', { id: 'deal-other' })).assigneeUserId, 'other')
  // The same request again finds its work done rather than a changed list.
  const retried = await send(app, fields)
  accepted(retried)
  assert.equal(retried.notice?.message, 'Đã phân công 2/4 hồ sơ; 2 bỏ qua')

  // A row changed since the list was read: nothing is assigned.
  const other = await call('crm.case.get', { id: 'deal-other' })
  await call('crm.case.save', {
    id: 'deal-other',
    kind: 'opportunity',
    name: 'Gói spa cuối tuần · đổi',
    partnerId: other.partnerId,
    teamId: 'team-b',
    stageId: other.stageId,
    expectedVersion: other.version,
    idempotencyKey: 'rename-other',
  })
  const changed = await send(app, {
    ...fields,
    requestId: randomUUID(),
    ids: 'deal-other',
    assigneeUserId: 'admin',
  })
  assert.equal(changed.response?.code, 'E_CONFLICT')
  assert.equal(changed.response?.message, 'Danh sách đã đổi. Xem lại các dòng trước khi phân công.')
  assert.equal((await call('crm.case.get', { id: 'deal-other' })).assigneeUserId, 'other')
  assert.equal(
    (await send(app, { ...fields, requestId: randomUUID(), ids: '' })).response?.code,
    'E_VALIDATION',
  )
})

/** A sellable product, a warehouse and an 8% sales tax: what a quotation is written from. */
const quotable = async (call: Awaited<ReturnType<typeof boot>>['call']) => {
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'serum',
    name: 'Serum',
    type: 'goods',
    uomId: 'unit',
    listPrice: '250000',
    saleOk: true,
    purchaseOk: true,
  })
  await call('product.saveVariant', { id: 'serum-1', templateId: 'serum', combinationKey: '' })
  await call('stock.saveWarehouse', { id: 'main', code: 'MAIN', name: 'Main warehouse' })
  await call('account.saveTax', {
    id: 'vat-8',
    name: 'VAT 8%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '8',
  })
}

test('a quote is written, revised, sent and accepted on its opportunity', async (t) => {
  const { app, call } = await boot(t)
  await quotable(call)
  await login(app, 'admin')
  const detail = async (id = 'deal-mine') =>
    (await read(app, `screen=lead-detail&id=${id}`)).body.value.detail as {
      quotes: Row[]
      feed: Row[]
      orders: Row[]
    }
  const line = (quantity: string, tax = '8') => ({
    'product-0': 'serum-1',
    'quantity-0': quantity,
    'price-0': '100000',
    'discount-0': '10',
    'tax-0': tax,
  })
  const created = await send(app, {
    command: 'quote-create',
    context: 'screen=lead-detail&id=deal-mine&tab=sales&dialog=quote-create',
    id: 'deal-mine',
    expires: '2099-12-31',
    ...line('2'),
  })
  accepted(created)
  assert.equal(created.location, '/admin/crm/cases/deal-mine?tab=sales&notice=saved')
  assert.equal(created.notice?.message, 'Đã tạo báo giá nháp')
  let [quote] = (await detail()).quotes as Row[]
  assert.equal(quote?.state, 'draft')
  assert.equal(quote?.version, 1)
  // Two at 100 000, less 10%, plus 8%.
  assert.equal(quote?.total, 194_400)
  assert.equal(((quote?.lines ?? []) as Row[])[0]?.tax, 8)

  const quoteFields = (row: Row | undefined) => ({
    id: 'deal-mine',
    context: 'screen=lead-detail&id=deal-mine&tab=sales',
    quoteId: String(row?.id),
    quoteVersion: String(row?.revision),
  })
  const stale = await send(app, {
    ...quoteFields(quote),
    command: 'quote-edit',
    quoteVersion: String(Number(quote?.revision) - 1),
    expires: '2099-11-30',
    ...line('3'),
  })
  assert.equal(stale.response?.code, 'E_CONFLICT')
  assert.equal(stale.response?.message, 'Báo giá đã đổi. Đọc lại trước khi lưu.')
  assert.equal(
    (
      await send(app, {
        ...quoteFields(quote),
        command: 'quote-edit',
        expires: '2099-11-30',
        ...line('3', '7'),
      })
    ).response?.fields['tax-0'],
    'Chưa có thuế bán với mức này.',
  )
  accepted(
    await send(app, { ...quoteFields(quote), command: 'quote-edit', expires: '2099-11-30', ...line('3') }),
  )
  ;[quote] = (await detail()).quotes as Row[]
  assert.equal(quote?.version, 2)
  assert.equal(quote?.total, 291_600)
  assert.equal(quote?.expires, '2099-11-30')

  assert.equal(
    (await send(app, { ...quoteFields(quote), command: 'quote-accept' })).response?.code,
    'E_STATE',
  )
  accepted(await send(app, { ...quoteFields(quote), command: 'quote-send' }))
  ;[quote] = (await detail()).quotes as Row[]
  assert.equal(quote?.state, 'sent')
  assert.ok(quote?.sentAt)
  // A sent quote written again is a draft to send again.
  accepted(
    await send(app, { ...quoteFields(quote), command: 'quote-edit', expires: '2099-11-30', ...line('1') }),
  )
  ;[quote] = (await detail()).quotes as Row[]
  assert.equal(quote?.state, 'draft')
  assert.equal(quote?.version, 3)
  accepted(await send(app, { ...quoteFields(quote), command: 'quote-send' }))
  ;[quote] = (await detail()).quotes as Row[]
  const accept = await send(app, { ...quoteFields(quote), command: 'quote-accept' })
  accepted(accept)
  assert.equal(accept.notice?.message, 'Khách đã chấp nhận báo giá; đã tạo đơn')
  const done = await detail()
  assert.equal(done.quotes[0]?.state, 'accepted')
  assert.equal(done.orders.length, 1)
  assert.deepEqual(
    done.feed
      .filter((entry) => String(entry.title).startsWith('quote-'))
      .map((entry) => entry.title)
      .sort(),
    ['quote-accept', 'quote-create', 'quote-edit', 'quote-edit', 'quote-send', 'quote-send'],
  )
  const ordered = await send(app, {
    ...quoteFields(done.quotes[0]),
    command: 'quote-edit',
    expires: '2099-11-30',
    ...line('2'),
  })
  assert.equal(ordered.response?.code, 'E_STATE')

  // An expired quote is not sent; a lead is not quoted.
  accepted(
    await send(app, { command: 'quote-create', id: 'deal-mine', expires: '2000-01-01', ...line('1', '0') }),
  )
  const old = (await detail()).quotes.find((row) => row.expires === '2000-01-01')
  const expired = await send(app, { ...quoteFields(old), command: 'quote-send' })
  assert.equal(expired.response?.message, 'Báo giá đã hết hạn. Sửa hạn và gửi lại.')
  const lead = await send(app, {
    command: 'quote-create',
    id: 'lead-queue',
    expires: '2099-12-31',
    ...line('1'),
  })
  assert.equal(lead.response?.message, 'Chỉ tạo báo giá cho cơ hội.')

  // Someone who reads the quotes but may not write them cannot write one again either.
  await call('user.grantFunction', {
    id: 'sales-agent:crm_sale.sale.listQuotations',
    roleId: 'sales-agent',
    fnKey: 'crm_sale.sale.listQuotations',
  })
  await login(app, 'agent')
  const draft = (await detail()).quotes.find((row) => row.state === 'draft')
  const agent = await send(app, {
    ...quoteFields(draft),
    command: 'quote-edit',
    expires: '2099-12-31',
    ...line('9'),
  })
  assert.equal(agent.response?.code, 'E_FORBIDDEN')
  assert.equal((await detail()).quotes.find((row) => row.id === draft?.id)?.total, draft?.total)
})

/** A draft quote on the record, at two serums. */
const draftQuote = async (app: App) => {
  accepted(
    await send(app, {
      command: 'quote-create',
      id: 'deal-mine',
      expires: '2099-12-31',
      'product-0': 'serum-1',
      'quantity-0': '2',
      'price-0': '100000',
      'discount-0': '0',
      'tax-0': '8',
    }),
  )
}

test('a quote goes out on a channel the customer agreed to, and either screen sending it shows on the record', async (t) => {
  const { app, call } = await boot(t)
  await quotable(call)
  await login(app, 'admin')
  const detail = async () =>
    (await read(app, 'screen=lead-detail&id=deal-mine')).body.value.detail as {
      quotes: Row[]
      feed: Row[]
      orders: Row[]
    }
  await draftQuote(app)
  let [quote] = (await detail()).quotes
  const quoteSend = (fields: Record<string, string> = {}) =>
    send(app, {
      command: 'quote-send',
      id: 'deal-mine',
      context: `screen=lead-detail&id=deal-mine&tab=quotes&dialog=quote-send&quote=${quote?.id}`,
      quoteId: String(quote?.id),
      quoteVersion: String(quote?.revision),
      channel: 'email',
      recipient: 'hoa@example.com',
      subject: `Báo giá ${quote?.id}`,
      message: 'Chào chị, em gửi báo giá.',
      ...fields,
    })
  // The record's contact has not agreed to be contacted.
  const unagreed = await quoteSend()
  assert.equal(unagreed.response?.code, 'E_CONSENT')
  assert.equal(unagreed.response?.fields.consent, 'Ghi nhận đồng ý trước.')
  const before = await call('crm.case.get', { id: 'deal-mine' })
  accepted(
    await send(app, {
      command: 'save',
      id: 'deal-mine',
      version: String(before.version),
      name: String(before.name),
      contactName: 'Chị Hoa',
      email: 'hoa@example.com',
      consent: 'on',
    }),
  )
  await call('partner.savePartner', {
    id: 'acme-party',
    kind: 'company',
    name: 'ACME',
    email: 'sales@acme.example',
    contactConsent: true,
  })
  // Nor has the customer the quotation is written for: the sale's own rule says so.
  const customer = await quoteSend()
  assert.equal(customer.response?.code, 'E_CONSENT')
  assert.equal(customer.response?.message, 'Khách chưa đồng ý nhận liên hệ; không gửi báo giá qua kênh này.')
  await call('partner.savePartner', {
    id: 'spa-party',
    kind: 'company',
    name: 'Spa Hoa Mai',
    email: 'hoa@example.com',
    phone: '0901234567',
    contactConsent: true,
  })
  assert.equal(
    (await quoteSend({ recipient: 'hoa' })).response?.fields.recipient,
    'Người nhận không đúng: cần email, hoặc số điện thoại 8–15 chữ số cho Zalo.',
  )

  const requestId = randomUUID()
  const sent = await quoteSend({ requestId })
  accepted(sent)
  assert.equal(sent.notice?.message, 'Đã gửi báo giá qua email')
  accepted(await quoteSend({ requestId }))
  let shown = await detail()
  ;[quote] = shown.quotes
  assert.equal(quote?.state, 'sent')
  assert.deepEqual(
    { channel: (quote?.lastSend as Row)?.channel, recipient: (quote?.lastSend as Row)?.recipient },
    { channel: 'email', recipient: 'hoa@example.com' },
  )
  // One sending, shown once, with the email that carried it.
  const sendings = shown.feed.filter((entry) => entry.title === 'quote-send')
  assert.equal(sendings.length, 1, 'the same request sends once and shows once')
  assert.deepEqual(sendings[0]?.meta, { channel: 'email', recipient: 'hoa@example.com' })
  const mails = shown.feed.filter((entry) => entry.kind === 'email')
  assert.equal(mails.length, 1)
  const outbox = await call<{ deliveries: Row[] }>('mail_transport.listOutbox', {})
  const delivery = outbox.deliveries.find((row) => row.id === `crm-email:${mails[0]?.id}`)
  assert.deepEqual(delivery?.to, [{ address: 'hoa@example.com', name: 'Chị Hoa' }])
  assert.equal(delivery?.subject, `Báo giá ${quote?.id}`)

  // The Sales desk sends it again on Zalo: the record shows that too.
  const order = (await call('crm_sale.sale.listQuotations', { caseId: 'deal-mine' }))[0] as Row
  const desk = await call('sale.sendQuotation', {
    id: order.id,
    channel: 'zalo',
    recipient: '0901 234 567',
    idempotencyKey: 'desk-zalo',
  })
  assert.equal(desk.ok, true)
  shown = await detail()
  assert.deepEqual(
    shown.feed
      .filter((entry) => entry.title === 'quote-send')
      .map((entry) => (entry.meta as Row).channel)
      .sort(),
    ['email', 'zalo'],
  )
  assert.equal((shown.quotes[0]?.lastSend as Row)?.channel, 'zalo')
  // The form still holds the revision before the desk sent it: a conflict, not a second sending.
  const stale = await quoteSend({ channel: 'hand', requestId: randomUUID() })
  assert.equal(stale.response?.code, 'E_CONFLICT')
  assert.equal(stale.response?.message, 'Báo giá đã đổi. Đọc lại trước khi lưu.')
  // The customer reads the quotation, not the opportunity's id.
  const q = app.adapter!.quoteIdent.bind(app.adapter)
  const [printed] = await app.adapter!.all(
    `SELECT ${q('clientOrderRef')}, ${q('notes')} FROM ${q(tableNameFor('sale.Order'))} WHERE ${q('id')} = ?`,
    [order.id],
  )
  assert.equal(printed?.clientOrderRef ?? null, null)
  assert.equal(printed?.notes ?? null, null)

  // Someone who may not send quotations sends nothing.
  for (const fnKey of ['crm_sale.sale.listQuotations', 'crm.case.addMessage'])
    await call('user.grantFunction', { id: `sales-agent:${fnKey}`, roleId: 'sales-agent', fnKey })
  await login(app, 'agent')
  ;[quote] = (await detail()).quotes
  assert.equal((await quoteSend({ channel: 'hand' })).response?.code, 'E_FORBIDDEN')
  await login(app, 'admin')

  // Handed over: nobody is contacted, and it reads so.
  ;[quote] = (await detail()).quotes
  const handed = await quoteSend({ channel: 'hand', recipient: '', message: '' })
  accepted(handed)
  assert.equal(handed.notice?.message, 'Đã ghi nhận trao báo giá tận tay')
  assert.equal(((await detail()).quotes[0]?.lastSend as Row)?.channel, 'hand')

  // Accepted here, the order's confirmation is the acceptance; confirmed at the desk, it shows as the order's.
  ;[quote] = (await detail()).quotes
  accepted(
    await send(app, {
      command: 'quote-accept',
      id: 'deal-mine',
      quoteId: String(quote?.id),
      quoteVersion: String(quote?.revision),
    }),
  )
  await draftQuote(app)
  const second = ((await detail()).quotes as Row[]).find((row) => row.state === 'draft')
  const secondOrder = ((await call('crm_sale.sale.listQuotations', { caseId: 'deal-mine' })) as Row[]).find(
    (row) => row.name === second?.id,
  )
  const confirmed = await call('sale.confirmOrder', { id: secondOrder?.id })
  assert.equal(confirmed.ok, true)
  shown = await detail()
  assert.equal(shown.feed.filter((entry) => entry.title === 'quote-accept').length, 1)
  assert.deepEqual(
    shown.feed.filter((entry) => entry.title === 'order-confirmed').map((entry) => entry.body),
    [second?.id],
  )
  assert.deepEqual(
    shown.orders.map((row) => row.state),
    ['confirmed', 'confirmed'],
  )
})

test('a quote written in Sales joins an opportunity of its customer only when the company allows it', async (t) => {
  const { app, call } = await boot(t)
  await quotable(call)
  await login(app, 'admin')
  await call('partner.savePartner', { id: 'other-party', kind: 'person', name: 'Khách khác' })
  for (const [id, partnerId] of [
    ['desk-1', 'spa-party'],
    ['desk-2', 'other-party'],
  ]) {
    await call('sale.createOrder', { id, partnerId, warehouseId: 'main' })
    await call('sale.addLine', {
      id: `${id}:line`,
      orderId: id,
      productId: 'serum-1',
      productUomQty: '1',
      productUomId: 'unit',
    })
  }
  const detail = async () =>
    (await read(app, 'screen=lead-detail&id=deal-mine&tab=quotes')).body.value.detail as {
      quotes: Row[]
      feed: Row[]
      attachable: Row[]
      quotePolicy: string
    }
  const attach = (orderId: string) =>
    send(app, {
      command: 'quote-attach',
      id: 'deal-mine',
      orderId,
      context: 'screen=lead-detail&id=deal-mine',
    })
  let shown = await detail()
  assert.equal(shown.quotePolicy, 'off')
  assert.deepEqual(shown.attachable, [])
  const off = await attach('desk-1')
  assert.equal(off.response?.code, 'E_STATE')
  assert.equal(off.response?.message, 'Công ty chưa cho gắn báo giá lập ở Bán hàng vào cơ hội.')

  const policy = (configVersion: string) =>
    send(app, {
      command: 'quote-policy',
      saleQuotations: 'attach',
      configVersion,
      context: 'screen=crm-settings&tab=process&dialog=quote-policy',
    })
  await login(app, 'agent')
  assert.equal((await policy('0')).response?.code, 'E_FORBIDDEN')
  await login(app, 'admin')
  accepted(await policy('0'))
  assert.equal((await policy('0')).response?.code, 'E_CONFLICT')
  const settings = (await read(app, 'screen=crm-settings&tab=process')).body.value.settings as Row
  assert.deepEqual(settings.quotationPolicy, { saleQuotations: 'attach', version: 1 })

  shown = await detail()
  // Only the record's customer's quotes, and only those no opportunity holds.
  assert.deepEqual(
    shown.attachable.map((row) => row.orderRef),
    ['desk-1'],
  )
  const deskName = shown.attachable[0]?.id
  assert.equal((await attach('desk-2')).response?.message, 'Chỉ gắn báo giá của cùng khách với cơ hội.')
  const joined = await attach('desk-1')
  accepted(joined)
  assert.equal(joined.notice?.message, 'Đã gắn báo giá vào cơ hội')
  accepted(await attach('desk-1'))
  shown = await detail()
  assert.deepEqual(
    shown.quotes.map((row) => row.id),
    [deskName],
  )
  assert.deepEqual(shown.attachable, [])
  assert.equal(shown.feed.filter((entry) => entry.title === 'quote-attach').length, 1)
})

test('a duplicate merges into the record it repeats, with its quotes and, if chosen, its contact', async (t) => {
  const { app, call } = await boot(t)
  await quotable(call)
  await call('crm.case.save', {
    id: 'deal-twin',
    kind: 'opportunity',
    name: 'Liệu trình da dầu (gọi lại)',
    partnerId: 'spa-party',
    teamId: 'team-a',
    contactName: 'Chị Hoa',
    phone: '0909 777 888',
    idempotencyKey: 'save-twin',
  })
  await call('crm.case.save', {
    id: 'lead-twin',
    kind: 'lead',
    name: 'Hỏi liệu trình',
    partnerId: 'spa-party',
    teamId: 'team-a',
    idempotencyKey: 'save-lead-twin',
  })
  await login(app, 'admin')
  accepted(
    await send(app, {
      command: 'quote-create',
      id: 'deal-twin',
      expires: '2099-12-31',
      'product-0': 'serum-1',
      'quantity-0': '1',
      'price-0': '250000',
    }),
  )
  const target = await call('crm.case.get', { id: 'deal-mine' })
  const merge = {
    command: 'merge',
    context: 'screen=lead-detail&id=deal-twin&dialog=merge',
    id: 'deal-twin',
    targetId: 'deal-mine',
    targetVersion: String(target.version),
    keepContact: 'source',
  }
  const unchecked = await send(app, merge)
  assert.equal(unchecked.response?.code, 'E_VALIDATION')
  assert.equal(unchecked.response?.fields.sameNeed, 'Không gộp chỉ vì chung điện thoại.')
  // The same customer's lead is a different stage of the need, not a duplicate of the opportunity.
  const kinds = await send(app, { ...merge, id: 'lead-twin', sameNeed: 'on' })
  assert.equal(kinds.response?.code, 'E_STATE')

  const reply = await send(app, { ...merge, sameNeed: 'on' })
  accepted(reply)
  assert.equal(reply.location, '/admin/crm/cases/deal-mine?notice=saved')
  assert.equal(reply.notice?.message, 'Đã gộp hồ sơ')
  const kept = await call('crm.case.get', { id: 'deal-mine' })
  assert.equal(kept.phone, '0909 777 888')
  assert.equal(kept.name, 'Liệu trình da dầu')
  const twin = await call('crm.case.get', { id: 'deal-twin' })
  assert.equal(twin.mergedIntoId, 'deal-mine')
  assert.equal(twin.active, false)
  assert.equal((await call<Row[]>('crm_sale.sale.listQuotations', { caseId: 'deal-mine' })).length, 1)
  assert.equal((await call<Row[]>('crm_sale.sale.listQuotations', { caseId: 'deal-twin' })).length, 0)
})

test('an email goes to a customer who agreed, from the company address, and a failed one is sent again', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const detail = async () =>
    (await read(app, 'screen=lead-detail&id=deal-mine')).body.value.detail as { feed: Row[] }
  const email = (fields: Record<string, string> = {}) =>
    send(app, {
      command: 'email',
      context: 'screen=lead-detail&id=deal-mine&dialog=email',
      id: 'deal-mine',
      subject: 'Đề xuất theo nhu cầu',
      message: 'Chào chị, em gửi đề xuất.',
      ...fields,
    })
  const unconsented = await email()
  assert.equal(unconsented.response?.code, 'E_CONSENT')
  assert.equal(unconsented.response?.fields.consent, 'Ghi nhận đồng ý trước.')
  const before = await call('crm.case.get', { id: 'deal-mine' })
  accepted(
    await send(app, {
      command: 'save',
      id: 'deal-mine',
      version: String(before.version),
      name: String(before.name),
      contactName: 'Chị Hoa',
      email: 'hoa@example.com',
      consent: 'on',
    }),
  )
  // The company has no address to send from yet.
  const unsent = await email()
  assert.equal(unsent.response?.code, 'E_STATE')
  assert.match(String(unsent.response?.message), /Công ty chưa có email gửi đi/)
  await call('partner.savePartner', {
    id: 'acme-party',
    kind: 'company',
    name: 'ACME',
    email: 'sales@acme.example',
    contactConsent: true,
  })

  const requestId = randomUUID()
  const sent = await email({ requestId })
  accepted(sent)
  assert.equal(sent.notice?.message, 'Đã xếp email vào hàng gửi')
  accepted(await email({ requestId }))
  const mails = (await detail()).feed.filter((entry) => entry.kind === 'email')
  assert.equal(mails.length, 1, 'the same request sends once')
  assert.equal(mails[0]?.subject, 'Đề xuất theo nhu cầu')
  assert.equal(mails[0]?.state, 'queued')
  const outbox = await call<{ deliveries: Row[] }>('mail_transport.listOutbox', {})
  const delivery = outbox.deliveries.find((row) => row.id === `crm-email:${mails[0]?.id}`)
  assert.equal(delivery?.subject, 'Đề xuất theo nhu cầu')
  assert.deepEqual(delivery?.to, [{ address: 'hoa@example.com', name: 'Chị Hoa' }])
  assert.equal(delivery?.fromAddress, 'sales@acme.example')

  const retry = (messageId: string) =>
    send(app, {
      command: 'email-retry',
      id: 'deal-mine',
      messageId,
      context: 'screen=lead-detail&id=deal-mine',
    })
  assert.equal((await retry(String(mails[0]?.id))).response?.code, 'E_STATE')
  // The provider refused it.
  const q = app.adapter!.quoteIdent.bind(app.adapter)
  await app.adapter!.run(
    `UPDATE ${q(tableNameFor('mail_transport.Delivery'))} SET ${q('state')} = 'failed' WHERE ${q('id')} = 'crm-email:${mails[0]?.id}'`,
  )
  assert.equal((await detail()).feed.find((entry) => entry.id === mails[0]?.id)?.state, 'failed')
  const again = await retry(String(mails[0]?.id))
  accepted(again)
  assert.equal(again.notice?.message, 'Đã gửi lại email')
  assert.equal((await detail()).feed.find((entry) => entry.id === mails[0]?.id)?.state, 'queued')

  // Someone who may not add a message to the record sends nothing, nor again.
  await app.adapter!.run(
    `UPDATE ${q(tableNameFor('mail_transport.Delivery'))} SET ${q('state')} = 'failed' WHERE ${q('id')} = 'crm-email:${mails[0]?.id}'`,
  )
  await login(app, 'agent')
  assert.equal((await email()).response?.code, 'E_FORBIDDEN')
  assert.equal((await retry(String(mails[0]?.id))).response?.code, 'E_FORBIDDEN')
  await login(app, 'admin')
  assert.equal((await detail()).feed.find((entry) => entry.id === mails[0]?.id)?.state, 'failed')
})

test('an import is previewed against the customers and events already in, then confirmed once', async (t) => {
  const { app, call } = await boot(t)
  await login(app, 'admin')
  const lan = randomUUID()
  accepted(
    await send(app, {
      requestId: lan,
      command: 'create',
      context: 'screen=lead-new',
      kind: 'lead',
      name: 'Hỏi liệu trình trị mụn',
      contactName: 'Chị Lan',
      phone: '0903 555 111',
      teamId: 'team-a',
      consent: 'on',
    }),
  )
  const lanPartner = (await call('crm.case.get', { id: lan })).partnerId
  accepted(
    await send(app, {
      command: 'intake',
      context: 'screen=lead-new&mode=intake',
      kind: 'lead',
      name: 'Form website: hỏi giá',
      email: 'khach.moi@example.com',
      source: 'Website',
      externalId: 'form-77',
    }),
  )
  const context = 'screen=cases&dialog=import'
  const mapping = {
    'map-name': 'title',
    'map-phone': 'mobile',
    'map-email': 'email',
    'map-contactName': 'contact',
    'map-source': 'channel',
    'map-externalId': 'eventId',
  }
  const data = [
    'title,mobile,email,contact,channel,eventId',
    'Hỏi liệu trình mới,0903555111,,Chị Lan,Hội chợ,',
    'Form website: hỏi giá,,khach.moi@example.com,,Website,form-77',
    'Đặt lịch tư vấn,0912 000 222,,Anh Minh,,',
    'Hỏi combo,0987 654 321,,Chị Hoa,,',
    'Hỏi lịch hẹn,0977 111 333,,Chị Mai,Zalo OA,zalo-5',
    'Hỏi lịch hẹn,0977 111 333,,Chị Mai,Zalo OA,zalo-5',
  ].join('\n')
  const preview = (reply: Reply) => new URL(reply.location, 'http://x').searchParams.get('preview') ?? ''
  const diagnostics = async (id: string) =>
    ((await read(app, `${context}&preview=${id}`)).body.value.dialog as Row | undefined)?.preview as
      | { valid: boolean; diagnostics: Row[]; input: Row }
      | undefined

  // A file it cannot read names the file, not a row.
  const unreadable = await send(app, { command: 'import-preview', context, data: 'name\n"unclosed' })
  assert.equal(unreadable.response?.code, 'E_VALIDATION')
  assert.equal(unreadable.response?.fields.data, 'Dấu nháy CSV chưa đóng.')

  // A row with faults is shown with them and cannot be imported.
  const faulty = await send(app, { command: 'import-preview', context, data: 'name,phone\n,0900 100 200' })
  accepted(faulty)
  assert.match(faulty.location, /^\/admin\/crm\/cases\?.*dialog=import/)
  const faults = await diagnostics(preview(faulty))
  assert.equal(faults?.valid, false)
  assert.deepEqual(faults?.diagnostics[0]?.issues, ['Thiếu tiêu đề'])
  const refused = await send(app, { command: 'import', context, previewId: preview(faulty) })
  assert.equal(refused.response?.code, 'E_VALIDATION')
  assert.equal(refused.response?.message, 'Xem trước dữ liệu hợp lệ trước khi nhập.')

  const first = await send(app, { command: 'import-preview', context, data, importConsent: 'on', ...mapping })
  accepted(first)
  assert.equal(first.notice?.message, 'Đã xem trước; chưa nhập dữ liệu')
  const shown = await diagnostics(preview(first))
  assert.equal(shown?.valid, true)
  assert.equal(shown?.input['map-name'], 'title')
  assert.deepEqual(
    shown?.diagnostics.map((row) => [row.name, row.action]),
    [
      ['Hỏi liệu trình mới', 'Dùng khách có sẵn · giữ nhu cầu riêng'],
      ['Form website: hỏi giá', 'Bỏ qua: sự kiện đã có'],
      ['Đặt lịch tư vấn', 'Tạo khách và lead'],
      ['Hỏi combo', 'Tạo khách và lead'],
      ['Hỏi lịch hẹn', 'Tạo khách và lead'],
      // The file repeats its own event.
      ['Hỏi lịch hẹn', 'Bỏ qua: sự kiện đã có'],
    ],
  )
  assert.equal(shown?.diagnostics[0]?.partnerId, lanPartner)

  // A customer with a row's phone appears after the preview: the user reviews again.
  await call('partner.savePartner', {
    id: 'minh-party',
    kind: 'person',
    name: 'Anh Minh',
    phone: '0912000222',
    contactConsent: true,
  })
  const stale = await send(app, { command: 'import', context, previewId: preview(first) })
  assert.equal(stale.response?.code, 'E_CONFLICT')
  assert.equal(stale.response?.message, 'Dữ liệu đã đổi. Xem trước lại để đối chiếu khách trùng.')

  const second = await send(app, {
    command: 'import-preview',
    context,
    data,
    importConsent: 'on',
    ...mapping,
  })
  const fields = { requestId: randomUUID(), command: 'import', context, previewId: preview(second) }
  const done = await send(app, fields)
  accepted(done)
  assert.equal(done.notice?.message, 'Đã nhập 6 dòng')
  // It leads to the last row's record: here the event the file took in.
  const last = new URL(done.location, 'http://x').pathname.split('/').pop() ?? ''
  assert.equal(done.location, `/admin/crm/cases/${last}?notice=saved`)
  const named = async (name: string) => {
    const listed = await call<Row>('crm.case.list', { search: name })
    return ((listed.rows ?? listed) as Row[]).filter((row) => row.name === name)
  }
  const booking = await named('Hỏi lịch hẹn')
  assert.deepEqual(
    booking.map((row) => [row.id, row.utmSource]),
    [[last, 'Zalo OA']],
  )
  const [combo] = await named('Hỏi combo')
  assert.equal(combo?.utmSource, 'Import')
  assert.equal(combo?.contactConsent, true)
  const hoa = await call('partner.getPartner', { id: String(combo?.partnerId) })
  assert.equal(hoa.name, 'Chị Hoa')
  // A skipped row makes no customer either.
  for (const search of ['Form website: hỏi giá', '0977111333']) {
    const customers = await call<Row>('partner.listPartners', { search, limit: 20 })
    assert.equal(((customers.rows ?? customers) as Row[]).length, 1, search)
  }
  const [again] = await named('Hỏi liệu trình mới')
  assert.equal(again?.partnerId, lanPartner)
  assert.equal(again?.utmSource, 'Hội chợ')
  assert.equal((await named('Đặt lịch tư vấn'))[0]?.partnerId, 'minh-party')
  assert.equal((await named('Form website: hỏi giá')).length, 1)

  // Confirming again, by retry or by a second click, returns the import it made; the preview is spent.
  for (const repeat of [fields, { ...fields, requestId: randomUUID() }]) {
    const replay = await send(app, repeat)
    assert.equal(replay.location, done.location)
    assert.equal(replay.notice?.message, 'Đã nhập 6 dòng')
  }
  assert.equal((await named('Hỏi combo')).length, 1)
  assert.equal(await diagnostics(preview(second)), undefined)

  // A file whose last row is new leads to the record it made.
  const single = await send(app, {
    command: 'import-preview',
    context,
    data: 'name,phone\nHỏi thêm,0966 222 444',
  })
  const made = await send(app, { command: 'import', context, previewId: preview(single) })
  accepted(made)
  const madeId = new URL(made.location, 'http://x').pathname.split('/').pop() ?? ''
  assert.equal((await call('crm.case.get', { id: madeId })).name, 'Hỏi thêm')

  // Importing shapes the pipeline: a seller may not, nor see another user's preview.
  await login(app, 'agent')
  assert.equal(await diagnostics(preview(faulty)), undefined)
  for (const command of ['import-preview', 'import'])
    assert.equal(
      (await send(app, { command, context, data, previewId: preview(second) })).response?.code,
      'E_FORBIDDEN',
    )
})
