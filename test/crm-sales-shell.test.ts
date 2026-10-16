import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { adminSalesRoutes } from '../packages/ketsuite/src/modules/crm_backend/sales/routes.mjs'

const at = (path: string) => new URL(path, 'http://ket.local')

test('crm sales routes: every screen address round-trips through its admin path', () => {
  const cases: [string, string][] = [
    ['screen=pipeline&q=d%C6%B0%E1%BB%A1ng', '/admin/crm/pipeline?q=d%C6%B0%E1%BB%A1ng'],
    ['screen=cases&view=won&lang=en', '/admin/crm/cases?view=won&lang=en'],
    ['screen=lead-new&dialog=intake', '/admin/crm/cases/new?dialog=intake'],
    ['screen=lead-detail&id=OP%2F12&tab=quotes', '/admin/crm/cases/OP%2F12?tab=quotes'],
    [
      'screen=activity-planner&dialog=activity-complete&id=OP-1&activity=a1',
      '/admin/crm/activities?dialog=activity-complete&id=OP-1&activity=a1',
    ],
    ['screen=crm-settings&tab=process', '/admin/crm/configuration?tab=process'],
    [
      'screen=crm-team&team=sales-online&dialog=member',
      '/admin/crm/configuration/teams/sales-online?dialog=member',
    ],
  ]
  for (const [query, path] of cases) {
    assert.equal(adminSalesRoutes.href(query), path)
    assert.equal(adminSalesRoutes.parse(at(path))?.toString(), query)
  }
  // A record id named by the path wins over one in the query of another screen's link.
  assert.equal(adminSalesRoutes.parse(at('/admin/crm/cases/OP-1/'))?.toString(), 'screen=lead-detail&id=OP-1')
})

test('crm sales routes: paths that are not sales screens are not followed in place', () => {
  for (const path of [
    '/admin/crm/cases/export',
    '/admin/crm/cases/OP-1/attachments',
    '/admin/crm/configuration/teams/new',
    '/admin/crm/leaderboard',
    '/admin/crm',
    '/admin/crm/care-overview',
  ])
    assert.equal(adminSalesRoutes.parse(at(path)), null, path)
  assert.equal(adminSalesRoutes.command, '/admin/crm/sales/command')
  assert.equal(adminSalesRoutes.exportHref('screen=cases&view=won'), '/admin/crm/cases/export?view=won')
})

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'admin-person', kind: 'person', name: 'Administrator' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'admin-person',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

test('crm sales shell: each screen serves its island, its help and its menu entry', async (t) => {
  const app = await boot(t)
  // The record page is served for a record the reader can open.
  await app.client.call('crm.case.save', {
    id: 'OP-0192',
    kind: 'opportunity',
    name: 'Gói chăm sóc da',
    partnerId: 'acme-party',
    idempotencyKey: 'shell-record',
  })
  const screens: [string, string, string][] = [
    ['/admin/crm/pipeline', 'pipeline', 'screen=pipeline'],
    ['/admin/crm/cases?view=won', 'cases', 'screen=cases&amp;view=won'],
    ['/admin/crm/cases/new', 'lead-new', 'screen=lead-new'],
    [
      '/admin/crm/cases/OP-0192?tab=quotes',
      'lead-detail',
      'screen=lead-detail&amp;id=OP-0192&amp;tab=quotes',
    ],
    ['/admin/crm/activities', 'activity-planner', 'screen=activity-planner'],
    ['/admin/crm/configuration', 'crm-settings', 'screen=crm-settings'],
    ['/admin/crm/configuration/teams/sales-online', 'crm-team', 'screen=crm-team&amp;team=sales-online'],
  ]
  for (const [path, screen, query] of screens) {
    const response = await app.client.get(path)
    const page = await response.text()
    assert.equal(response.status, 200, path)
    // The island is the content pane's own child, so an operational page runs to the pane's edges.
    assert.match(
      page,
      /data-ui="content"[^>]*>(?:\s|<!--[^>]*-->)*<div data-ket-island=""[^>]*data-island="crm\.sales-screen"/,
      `${path}: ${/data-ui="content"[^>]*>.{0,200}/s.exec(page)?.[0]}`,
    )
    assert.ok(page.includes(`&quot;screen&quot;:&quot;${screen}&quot;`), `${path} names ${screen}`)
    assert.ok(page.includes(`&quot;query&quot;:&quot;${query}&quot;`), `${path} carries ${query}`)
    assert.match(page, /data-ui="help-drawer" id="crm-sales-help"/, path)
    // The application switcher offers help because this screen has some.
    assert.match(page, /Hướng dẫn màn hình/, path)
  }
  const css = readFileSync('packages/ketsuite/src/modules/backend/design/lists.css', 'utf8')
  assert.match(
    css,
    /> \[data-ket-island\]\s*> :is\([^)]*\[data-ui="board-page"\]\[data-variant="operational"\]/,
  )
  // The record page lights up the list it belongs to.
  const record = await (await app.client.get('/admin/crm/cases/OP-0192')).text()
  assert.match(record, /data-ui="navigation-item"[^>]*data-active="true"[^>]*href="\/admin\/crm\/cases"/)
  // The demo's fixture help is not part of the product's guide.
  assert.doesNotMatch(record, /Atlas|fixture|Phạm vi mô phỏng/)
})

test('crm sales shell: the shell is read-only and keeps its permission', async (t) => {
  const app = await boot(t)
  const posted = await app.client.post('/admin/crm/pipeline', new URLSearchParams(), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(posted.status, 405)
  // A colleague with no CRM access gets no sales screen.
  const scope = { company: 'acme', branches: null }
  await app.fixture.call(
    'partner.savePartner',
    { id: 'clerk-person', kind: 'person', name: 'Clerk' },
    { scope },
  )
  await app.fixture.call(
    'user.createUser',
    {
      id: 'clerk',
      login: 'clerk',
      password: 'correct horse',
      name: 'Clerk',
      partnerId: 'clerk-person',
      defaultCompanyId: 'acme',
    },
    { scope },
  )
  await app.fixture.call(
    'user.grantCompany',
    { id: 'clerk:acme', userId: 'clerk', companyId: 'acme' },
    { scope },
  )
  await app.client.login({ login: 'clerk', password: 'correct horse' })
  const refused = await app.client.get('/admin/crm/pipeline', { redirect: 'manual' })
  assert.equal(refused.status, 403)
})
