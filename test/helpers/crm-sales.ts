// The CRM sales screens' test company: who works there, their teams and the records they hold.
import type { TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../../apps/ketsuite/deployment.ts'

export type Model = Row & {
  actor: { id: string; role: string }
  can: { write: boolean; admin: boolean }
  clock: string
  people: { id: string; name: string }[]
  stages: Row[]
  sources: string[]
}
export type Card = Row & { id: string; writable: boolean; revenue: number; next: Row | null; flags: string[] }

/** A company with an administrator, a sales agent in team A, another in team B and three records. */
export const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  // Setup runs as the system until the administrator exists, then as them.
  let actor: string | undefined
  const call = <T = Row>(name: string, input: Record<string, unknown>) =>
    app.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)

  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await call('partner.savePartner', { id: 'spa-party', kind: 'company', name: 'Spa Hoa Mai' })
  await call('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  for (const [id, superuser] of [
    ['admin', true],
    ['agent', false],
    ['other', false],
    ['clerk', false],
  ] as const) {
    await call('user.createUser', {
      id,
      login: id,
      password: 'correct horse battery',
      name: `User ${id}`,
      defaultCompanyId: 'acme',
      superuser,
    })
    await call('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }
  actor = 'admin'
  // An agent who reads and works records, without a scope beyond their own and their team's queue.
  await call('user.saveRole', { id: 'sales-agent', name: 'Sales agent' })
  for (const fnKey of ['crm.case.list', 'crm.case.get', 'crm.case.save'])
    await call('user.grantFunction', { id: `sales-agent:${fnKey}`, roleId: 'sales-agent', fnKey })
  await call('user.assignRole', { id: 'agent:sales-agent', userId: 'agent', roleId: 'sales-agent' })

  await call('crm.bootstrap.defaults', { idempotencyKey: 'sales-read-defaults' })
  await call('crm.team.save', {
    values: { id: 'team-a', code: 'a', name: 'Team A', assignmentMode: 'manual' },
    idempotencyKey: 'save-team-a',
  })
  await call('crm.team.save', {
    values: { id: 'team-b', code: 'b', name: 'Team B', assignmentMode: 'manual' },
    idempotencyKey: 'save-team-b',
  })
  for (const [teamId, userId] of [
    ['team-a', 'agent'],
    ['team-b', 'other'],
  ])
    await call('crm.team.member.save', {
      id: `${teamId}:${userId}`,
      teamId,
      userId,
      idempotencyKey: `member-${userId}`,
    })
  for (const values of [
    {
      id: 'deal-mine',
      kind: 'opportunity',
      name: 'Liệu trình da dầu',
      partnerId: 'spa-party',
      teamId: 'team-a',
      assigneeUserId: 'agent',
      stageId: 'crm-stage-proposition',
      expectedRevenue: 12_000_000,
      probability: 40,
      // As the website's forms write it: it reads as the standard channel.
      utmSource: 'website',
    },
    {
      id: 'lead-queue',
      kind: 'lead',
      name: 'Hỏi giá',
      teamId: 'team-a',
      phone: '0903 182 204',
      utmSource: 'Hội chợ',
    },
    {
      id: 'deal-other',
      kind: 'opportunity',
      name: 'Gói spa cuối tuần',
      teamId: 'team-b',
      assigneeUserId: 'other',
      email: 'khach@example.com',
      expectedRevenue: 30_000_000,
      utmSource: 'Facebook',
    },
  ])
    await call('crm.case.save', { ...values, idempotencyKey: `case-${values.id}` })
  // A call that was due yesterday, with a day and no time.
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  await call('crm.activity.schedule', {
    id: 'call-late',
    caseId: 'lead-queue',
    assigneeUserId: 'agent',
    summary: 'Gọi lại báo giá',
    dueDate: yesterday,
    idempotencyKey: 'activity-call-late',
  })
  // A meeting due today, also without a time: not late until the day is over.
  await call('crm.activity.schedule', {
    id: 'meet-today',
    caseId: 'deal-mine',
    assigneeUserId: 'agent',
    summary: 'Hẹn tư vấn',
    dueDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
    idempotencyKey: 'activity-meet-today',
  })
  return { app, call }
}

export type App = Awaited<ReturnType<typeof boot>>['app']

export const read = async (app: App, query: string) => {
  const response = await app.client.post('/admin/crm/sales/read', JSON.stringify({ query }), {
    headers: { 'content-type': 'application/json' },
  })
  return { status: response.status, body: (await response.json()) as { ok: boolean; value: Model & Row } }
}

export const login = (app: App, login: string) =>
  app.client.login({ login, password: 'correct horse battery' })
