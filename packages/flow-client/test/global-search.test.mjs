import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { createGlobalSearch } from '../dist/global-search.mjs'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
const results = (fixture, query, companyId = 'demo') =>
  fixture.call('flow.search', { companyId, query }).value

test('sidebar search opens one Spotlight, focuses after render, retries and discards closed responses', async () => {
  let loaded = false,
    inputAvailable = false,
    focusCount = 0
  const pending = []
  const search = createGlobalSearch({
    data: () => (loaded ? {} : null),
    companyId: () => 'demo',
    call: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    recent: () => [],
    remember() {},
    navigate() {},
    root: () => ({ querySelector: () => (inputAvailable ? { focus: () => focusCount++ } : null) }),
  })
  assert.match(renderToStaticString(search.trigger()), /disabled/)
  search.focus()
  assert.equal(pending.length, 0)
  assert.equal(search.view(), null)
  loaded = true
  search.focus()
  search.focus()
  assert.equal(pending.length, 1)
  const output = renderToStaticString(search.view())
  assert.equal((output.match(/<input/g) ?? []).length, 1)
  assert.match(output, /id="flow-command-modal"/)
  inputAvailable = true
  search.afterRender()
  search.afterRender()
  assert.equal(focusCount, 1)
  pending.shift().reject(new Error('Reconnect'))
  await Promise.resolve()
  assert.match(renderToStaticString(search.view()), /role="alert"/)
  const retried = search.read()
  search.close()
  pending.shift().resolve({
    groups: [{ id: 'tasks', label: 'Tasks', items: [{ id: 'one', title: 'Stale', icon: 'list' }] }],
  })
  await retried
  assert.equal(search.view(), null)
  assert.match(renderToStaticString(search.trigger()), /aria-expanded="false"/)
  search.dispose()
})

test('global search matches body, comment, file and organization content through the authorized projection', () => {
  const fixture = createOrganizationSession()
  const d = fixture.sessions.get('demo').data
  d.pages[0].blocks = [{ type: 'p', text: 'Nội dung sâu độc nhất' }]
  assert.ok(
    results(fixture, 'noi dung sau doc nhat')
      .groups.flatMap((g) => g.items)
      .some((x) => x.id === `page:${d.pages[0].id}`),
  )
  assert.ok(
    results(fixture, 'truy vấn đối chiếu')
      .groups.flatMap((g) => g.items)
      .some((x) => x.id === 'task:KV-142'),
  )
  assert.ok(
    results(fixture, 'doi-chieu-ton-phong.csv')
      .groups.flatMap((g) => g.items)
      .some((x) => x.id === 'file:file1'),
  )
  assert.ok(results(fixture, d.workspaces[0].title).groups.some((g) => g.id === 'workspaces'))
  assert.equal(results(fixture, 'x'.repeat(201)).ok, false)
  assert.ok(results(fixture, '').groups.flatMap((g) => g.items).length <= 60)
  assert.ok(
    results(fixture, 'Việc của tôi')
      .groups.flatMap((g) => g.items)
      .some((x) => x.route === 'my-work'),
  )
  assert.ok(
    results(fixture, 'Việc của tôi')
      .groups.flatMap((g) => g.items)
      .every((x) => !Object.hasOwn(x, 'keywords')),
  )
})

test('a temporary global-search failure retains an actionable retry contract', () => {
  const fixture = createOrganizationSession('search-error')
  assert.equal(results(fixture, 'KV-142').errors[0].code, 'unavailable')
  assert.ok(
    results(fixture, 'KV-142')
      .groups.flatMap((g) => g.items)
      .some((x) => x.id === 'task:KV-142'),
  )
})
test('search excludes private documents, other tenants and newly revoked access on every request', () => {
  const fixture = createOrganizationSession()
  const d = fixture.sessions.get('demo').data
  d.pages.push({
    ...d.pages[0],
    id: 'private-secret',
    title: 'Secret Needle',
    visibility: 'private',
    ownerId: 'other',
    readerIds: [],
  })
  assert.ok(
    !results(fixture, 'Secret Needle')
      .groups.flatMap((g) => g.items)
      .some((x) => x.id === 'page:private-secret'),
  )
  assert.equal(results(fixture, 'Secret Needle', 'unknown-tenant').ok, false)
  d.members.find((m) => m.id === d.user.id).status = 'removed'
  assert.equal(results(fixture, '').ok, false)
  const guest = createOrganizationSession('guest')
  assert.ok(!results(guest, '').groups.some((g) => ['people', 'teams', 'forms'].includes(g.id)))
})
test('a late search response cannot replace a newer query or survive a tenant change', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = []
  let tenant = 'one'
  const search = createGlobalSearch({
    data: () => ({}),
    companyId: () => tenant,
    call: () => new Promise((resolve) => pending.push(resolve)),
    recent: () => [],
    remember() {},
    navigate() {},
    root: () => null,
  })
  search.show()
  search.change('new')
  t.mock.timers.tick(200)
  pending.shift()({
    groups: [{ id: 'old', label: 'Old', items: [{ id: 'old', title: 'Old', icon: 'list' }] }],
  })
  await Promise.resolve()
  const { renderToStaticString } = await import('@ketvietlab/ketjs-view')
  assert.doesNotMatch(renderToStaticString(search.view()), />Old</)
  tenant = 'two'
  search.contextChanged()
  pending.shift()({
    groups: [{ id: 'new', label: 'New', items: [{ id: 'new', title: 'New', icon: 'list' }] }],
  })
  await Promise.resolve()
  assert.equal(search.view(), null)
  search.dispose()
})

test('catalog search opens organization edit destinations only for managers', () => {
  const manager = createOrganizationSession()
  assert.ok(
    results(manager, 'Production / Staging')
      .groups.flatMap((g) => g.items)
      .some((x) => x.route === 'field-edit'),
  )
  const member = createOrganizationSession('member')
  assert.ok(
    !results(member, 'Production / Staging')
      .groups.flatMap((g) => g.items)
      .some((x) => x.route === 'field-edit'),
  )
})
