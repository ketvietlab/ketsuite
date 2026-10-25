import { setFlowLocale, tr } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderToStaticString, renderIsland } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace, routes } from '@ketvietlab/flow-client/workspace.mjs'
import { contentWidths, contentWidthFor } from '@ketvietlab/flow-client/content-layout.mjs'
import { createFnClient, FlowApiError } from '@ketvietlab/flow-client/api.mjs'
import { atlasFlowCommand, resolveFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import { createFixtureSession } from '../atlas/store.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { flowShellData } from '@ketvietlab/flow-client/shell-model.mjs'

// No browser simulation: these stubs only let the controller receive mount's
// lifetime and resolve its API read before inspecting pure view output.
const oldWindow = globalThis.window,
  oldObserver = globalThis.MutationObserver
test.after(() => {
  globalThis.window = oldWindow
  globalThis.MutationObserver = oldObserver
})
const observedAttributes = []
globalThis.window = new EventTarget()
globalThis.MutationObserver = class {
  observe(_, options) {
    observedAttributes.push(...(options?.attributeFilter ?? []))
  }
  disconnect() {}
}
const root = () =>
  Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    closest: () => null,
    setAttribute: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  })
async function renderScreen(screen, scenario = 'baseline', props = {}, prepare) {
  const fixture = createOrganizationSession(scenario, screen)
  prepare?.(fixture)
  const lifetime = new AbortController()
  const call = createFnClient({
    fetch: async (_, request) =>
      new Response(
        JSON.stringify(fixture.call(decodeURIComponent(_.split('/').pop()), JSON.parse(request.body))),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  const island = createFlowWorkspace({ screen, ...props }, { call })
  island.mount({ root: root(), lifetime: lifetime.signal })
  await new Promise((r) => setTimeout(r, 0))
  const output = renderToStaticString(island.view())
  lifetime.abort()
  island.dispose()
  return output
}
test('reloading a person’s access reads the members list behind it instead of loading forever', async () => {
  const fixture = createOrganizationSession('baseline', 'member-access'),
    calls = [],
    lifetime = new AbortController()
  let failNext = false
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        args = JSON.parse(request.body)
      // The person's own sources are read with their id; the list behind the modal without.
      const list = name === 'flow.access.list' && !args.memberId
      calls.push(list ? 'list' : name)
      const fail = list && failNext
      if (fail) failNext = false
      const value = fail
        ? { ok: false, errors: [{ code: 'unavailable', message: 'Try later' }] }
        : fixture.call(name, args)
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  // The bootstrap reads the modal's route; the list's first page is not part of it.
  const island = createFlowWorkspace(
    {
      screen: 'member-access',
      record: 'bao',
      companyId: 'demo',
      workspaceId: 'product',
      background: '/flow/workspace-members?company=demo&workspace=product',
    },
    { call },
  )
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  }
  failNext = true
  island.mount({ root: root(), lifetime: lifetime.signal })
  await settle()
  try {
    // The island renders in its own locale; expected text follows it.
    const unavailable = tr('flow.members.unavailable'),
      showing = new RegExp(tr('flow.access.showing', ['\\d+', '\\d+']))
    let html = renderToStaticString(island.view())
    assert.ok(html.includes(unavailable), 'a failed first page explains itself')
    assert.doesNotMatch(html, showing)
    const retry = calls.length
    // Try again reads the first page once more.
    const button = (node) => {
      if (!node || typeof node !== 'object') return null
      if (Array.isArray(node)) return node.map(button).find(Boolean) ?? null
      if (node.items && node.render) return button(node.items.map((x, i) => node.render(x, i)))
      if (!node.strings) return null
      const inner = node.values.map(button).find(Boolean)
      if (inner) return inner
      const index = node.strings.findIndex((part) => part.endsWith('on:click='))
      return index >= 0 &&
        node.strings[0].trimStart().startsWith('<button') &&
        renderToStaticString(node).includes(tr('flow.ui.try.again'))
        ? node.values[index]
        : null
    }
    button(island.view())()
    await settle()
    assert.deepEqual(calls.slice(retry), ['list'])
    html = renderToStaticString(island.view())
    assert.match(html, showing)
    assert.ok(!html.includes(unavailable))
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('all registered core screens and initial loading retain one sidebar search launcher without a topbar input', async () => {
  for (const screen of Object.keys(routes)) {
    const output = await renderScreen(screen)
    assert.equal((output.match(/data-flow="search-trigger"/g) ?? []).length, 1, screen)
    assert.doesNotMatch(output, /<input[^>]*type="search"|data-flow="shell-search"/, screen)
    assert.doesNotMatch(output, /id="flow-command-modal"/, screen)
  }
  const output = renderToStaticString(createFlowWorkspace().view())
  assert.equal((output.match(/data-flow="search-trigger"/g) ?? []).length, 1)
  assert.doesNotMatch(output, /<input[^>]*type="search"|data-flow="shell-search"/)
})
test('the legacy whole-workspace island keeps its deterministic loading contract without private fixture data', () => {
  const output = renderIsland('flow.workspace', createFlowWorkspace, { screen: 'board' }, { tag: 'div' })
  assert.match(output, /data-ket-island/)
  assert.match(output, /Đang mở/)
  assert.doesNotMatch(output, /KV-142|Mai Anh|task-card/)
})
test('bootstrap recovery advice distinguishes unavailable data from denied access', async () => {
  const unavailable = await renderScreen('pages', 'error')
  assert.match(unavailable, /Không thể mở Flow/)
  assert.match(unavailable, /Không tải được dữ liệu/)
  assert.match(unavailable, /Thử lại/)
  assert.doesNotMatch(unavailable, /Liên hệ chủ tổ chức/)
  assert.match(unavailable, /<h1[^>]*>Không thể mở Flow<\/h1>/)
  const denied = await renderScreen('pages', 'forbidden')
  assert.match(denied, /Không có quyền truy cập/)
  assert.match(denied, /Liên hệ chủ tổ chức/)
})

test('list metric cards use authorized collection totals rather than the loaded task page', async () => {
  const output = await renderScreen('all-issues', 'baseline', {}, (fixture) => {
    const call = fixture.call.bind(fixture)
    fixture.call = (name, input) => {
      const response = call(name, input)
      if (name === 'flow.workspace.bootstrap' && response.value) {
        response.value.tasks = response.value.tasks.slice(0, 2)
        response.value.counts = {
          metrics: { total: 1257, progress: 801, review: 147, done: 222, overdue: 89 },
        }
      }
      return response
    }
  })
  for (const count of [1257, 801, 147, 222, 89]) assert.match(output, new RegExp('>' + count + '<'))
})

test('label library renders scoped usage even when no tasks or projects are in its preview', async () => {
  const output = await renderScreen('tags', 'baseline', {}, (fixture) => {
    const call = fixture.call.bind(fixture)
    fixture.call = (name, input) => {
      const response = call(name, input)
      if (name === 'flow.workspace.bootstrap' && response.value) {
        const label = response.value.tags.find((tag) => !tag.projectId && !tag.archived)
        assert.ok(label)
        response.value.tasks = []
        response.value.projects = []
        response.value.labelUsage = { [label.id]: { tasks: 98765, projects: 432 } }
      }
      return response
    }
  })
  assert.match(output, /98765/)
  assert.match(output, /432/)
})

test('the mounted workspace observes editor identity changes when switching records without replacing its host', async () => {
  observedAttributes.length = 0
  await renderScreen('page', 'baseline', { record: 'handoff', project: 'core' })
  assert.ok(observedAttributes.includes('data-live-key'))
})
test('SSR document navigation keeps the tree and reading frame during revalidation', async () => {
  const fixture = createOrganizationSession('baseline', 'page')
  const initial = fixture.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    workspaceId: 'product',
    projectId: 'core',
    route: 'page',
    recordId: 'handoff',
  }).value
  const chrome = flowShellData(initial)
  const props = {
    serverShell: true,
    screen: 'page',
    companyId: 'demo',
    workspaceId: 'product',
    project: 'core',
    scope: 'project',
    record: 'handoff',
    chrome,
  }
  const host = Object.assign(root(), { closest: () => null, setAttribute() {} })
  const lifetime = new AbortController()
  const island = createFlowWorkspace(props, { call: async () => initial })
  try {
    island.mount({ root: host, lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const nextPage = initial.pages.find((page) => page.projectId === 'core' && page.id !== 'handoff')
    island.update({ ...props, record: nextPage.id })
    const selected = renderToStaticString(island.view())
    assert.match(selected, /data-flow-layout="documents"/)
    assert.match(selected, /aria-label="Cây tài liệu"/)
    assert.match(selected, new RegExp(nextPage.title))
    assert.equal(selected.includes('data-flow="loading"'), false)
    island.update({ ...props, record: 'unknown-document' })
    const waiting = renderToStaticString(island.view())
    assert.match(waiting, /data-flow-layout="documents"/)
    assert.match(waiting, /aria-label="Cây tài liệu"/)
    assert.equal(waiting.includes('data-flow="loading"'), true)
    assert.doesNotMatch(waiting, /Không tìm thấy tài liệu/)
    island.update({ ...props, workspaceId: 'operations', project: 'ops' })
    assert.doesNotMatch(renderToStaticString(island.view()), /data-flow-layout="documents"|Quy ước bàn giao/)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('a closed sprint deep link shows its saved report instead of offering to close it again', async () => {
  const output = await renderScreen('sprint-close', 'baseline', { record: 's12' }, (fixture) => {
    fixture.call('flow.entity.action', {
      companyId: 'demo',
      collection: 'sprints',
      entityId: 's12',
      action: 'close',
      carryTo: 'Backlog',
      idempotencyKey: 'closed-sprint-link',
    })
  })
  const modal = output.slice(output.indexOf('id="flow-form-modal"'))
  assert.match(modal, /Sprint này đã đóng/)
  assert.match(modal, /Xem tổng kết/)
  assert.doesNotMatch(modal, /name="carryTo"|Xác nhận đóng sprint/)
})
test('a retained native island reconstitutes a task modal and its explicit destination background', async () => {
  const saved = { location: globalThis.location, history: globalThis.history, document: globalThis.document }
  const fixture = createOrganizationSession('baseline', 'issue')
  const data = fixture.sessions.get('demo').data
  const source = data.tasks.find((t) => t.projectId === 'core')
  const target = data.tasks.find((t) => t.projectId === 'ops')
  const makeProps = (task) => ({
    serverShell: true,
    lang: 'vi',
    screen: 'issue',
    companyId: 'demo',
    workspaceId: data.projects.find((p) => p.id === task.projectId).workspaceId,
    project: task.projectId,
    record: task.id,
    recordProvided: true,
    background: `/flow/project-issues?company=demo&project=${task.projectId}`,
    chrome: flowShellData(data),
  })
  globalThis.location = new URL(
    `http://flow.local/flow/issue?company=demo&project=core&lang=vi&id=${source.id}&background=${encodeURIComponent(makeProps(source).background)}`,
  )
  globalThis.history = {
    state: {},
    replaceState(state, _, url) {
      this.state = state
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  globalThis.document = Object.assign(new EventTarget(), { documentElement: {} })
  const lifetime = new AbortController()
  const island = createFlowWorkspace(makeProps(source), {
    call: async (name, input) => fixture.call(name, input).value,
    navigatePage: async () => {},
  })
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const next = makeProps(target)
    island.update(next)
    globalThis.location.href = `http://flow.local/flow/issue?company=demo&project=ops&lang=vi&id=${target.id}&background=${encodeURIComponent(next.background)}`
    document.dispatchEvent(
      new CustomEvent('ket:navigation-complete', { detail: { url: location.href, mode: 'push' } }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const output = renderToStaticString(island.view())
    assert.match(output, /id="flow-task-modal"/)
    assert.ok(output.includes(target.title))
    assert.doesNotMatch(output, /Không thể mở Flow|data-flow="loading"/)
    const chrome = renderToStaticString(island.shellView(island.view()))
    assert.ok(chrome.includes(routes['project-issues'].title))
  } finally {
    lifetime.abort()
    island.dispose()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
test('explicit missing or foreign sprint and epic links never display another record', async () => {
  for (const screen of ['sprint-close', 'sprint-report', 'epic']) {
    for (const record of ['missing', 'foreign']) {
      const output = await renderScreen(screen, 'baseline', { project: 'core', record }, (fixture) => {
        const d = fixture.sessions.get('demo').data
        d.sprints.push({ id: 'foreign', projectId: 'ops', title: 'Foreign sprint', state: 'active' })
        d.epics.push({ id: 'foreign', projectId: 'ops', title: 'Foreign epic' })
      })
      const content =
        screen === 'sprint-close' ? output.slice(output.indexOf('id="flow-form-modal"')) : output
      assert.match(content, /Hồ sơ không khả dụng/)
      assert.doesNotMatch(content, /name="carryTo"|Foreign sprint|Foreign epic/)
      if (screen === 'epic') assert.doesNotMatch(output, /Epic · Kết nối kênh bán/)
    }
  }
})
test('planned sprint closure gives recovery without a closure form', async () => {
  const output = await renderScreen('sprint-close', 'baseline', { project: 'core', record: 's13' })
  const modal = output.slice(output.indexOf('id="flow-form-modal"'))
  assert.match(modal, /Chỉ đóng được sprint đang chạy/)
  assert.doesNotMatch(modal, /name="carryTo"|flow-sprint-close-form|Xác nhận đóng sprint/)
})
test('sprint closure has one native submit associated with its form outside the scrolling body', async () => {
  const output = await renderScreen('sprint-close', 'baseline', { project: 'core', record: 's12' })
  const modal = output.slice(output.indexOf('id="flow-form-modal"'))
  assert.equal((modal.match(/type="submit"/g) ?? []).length, 1)
  assert.match(modal, /<form id="flow-sprint-close-form"/)
  assert.match(modal, /<footer[\s\S]*form="flow-sprint-close-form"/)
  assert.ok(modal.indexOf('</form>') < modal.indexOf('<footer'))
  const readonly = await renderScreen('sprint-close', 'readonly', { project: 'core', record: 's12' })
  assert.match(readonly, /<select[^>]*name="carryTo"[^>]*disabled/)
  assert.match(readonly, /<button[^>]*form="flow-sprint-close-form"[^>]*disabled/)
})
test('sprint pickers retain historical context but offer only unfinished unarchived destinations', async () => {
  const prepare = (fixture) => {
    const d = fixture.sessions.get('demo').data
    d.sprints.push(
      { id: 'past', projectId: 'core', title: 'Past sprint', state: 'closed' },
      { id: 'archive', projectId: 'core', title: 'Archived sprint', state: 'planned', archived: true },
      { id: 'foreign', projectId: 'ops', title: 'Foreign sprint', state: 'planned' },
    )
    d.tasks.find((task) => task.id === 'KV-142').sprint = 'Past sprint'
  }
  const task = await renderScreen('issue', 'baseline', { project: 'core', record: 'KV-142' }, prepare)
  const picker = task.match(/<select[^>]*name="task-sprint"[^>]*>[\s\S]*?<\/select>/)?.[0]
  assert.ok(picker)
  assert.match(picker, /Past sprint/)
  assert.doesNotMatch(picker, /Archived sprint|Foreign sprint/)
  const assignment = await renderScreen(
    'issue-sprint',
    'baseline',
    { project: 'core', record: 'KV-142' },
    prepare,
  )
  const modal = assignment.slice(assignment.indexOf('id="flow-task-modal"'))
  assert.match(modal, /Sprint 13/)
  assert.doesNotMatch(modal, /Past sprint|Archived sprint|Foreign sprint/)
  const list = await renderScreen('sprints', 'baseline', { project: 'core' }, prepare)
  assert.doesNotMatch(list, /Archived sprint|Foreign sprint/)
})
test('task epic chip and picker resolve canonical IDs and legacy titles in the current project', async () => {
  for (const value of ['channels', 'Kết nối kênh bán']) {
    const output = await renderScreen(
      'issue',
      'baseline',
      { project: 'core', record: 'KV-142' },
      (fixture) => {
        fixture.sessions.get('demo').data.tasks.find((task) => task.id === 'KV-142').epic = value
      },
    )
    const tags = output.match(/data-flow="tag"[\s\S]*?<\/span>/g) ?? []
    assert.ok(tags.some((tag) => tag.includes('Kết nối kênh bán')))
    const picker = output.match(/<select[^>]*name="task-epic"[^>]*>[\s\S]*?<\/select>/)?.[0]
    assert.match(picker, /<option[^>]*value="channels"[^>]*selected/)
  }
})
test('missing Team edits recover without displaying a creation form', async () => {
  const output = await renderScreen('team-edit', 'baseline', { record: 'missing' })
  const modal = output.slice(output.indexOf('id="flow-form-modal"'))
  assert.doesNotMatch(modal, /<form|type="submit"|name="title"/)
  assert.match(modal, /data-flow="empty"/)
})
test('organization modal forms share one native footer submit outside their body', async () => {
  for (const key of [
    'workspace-new',
    'workspace-edit',
    'team-new',
    'team-edit',
    'member-invite',
    'member-edit',
    'access-grant',
    'project-move',
  ]) {
    const output = await renderScreen(key, 'baseline', {
      workspaceId: 'product',
      project: 'core',
      record: key === 'team-edit' ? 'engineering' : key === 'workspace-edit' ? 'product' : 'bao',
    })
    const modal = output.slice(output.indexOf('id="flow-form-modal"'))
    assert.equal((modal.match(/type="submit"/g) ?? []).length, 1, key)
    assert.match(modal, /<form[^>]*id="flow-organization-modal-form"/, key)
    assert.match(modal, /<footer[\s\S]*form="flow-organization-modal-form"/, key)
    assert.ok(modal.indexOf('</form>') < modal.indexOf('<footer'), key)
    assert.doesNotMatch(modal, /\[object Object\]/, key)
  }
  const settings = await renderScreen('organization-settings')
  assert.match(settings, /<form/)
  assert.doesNotMatch(settings, /flow-organization-modal-form|\[object Object\]/)
})
test('Workspace administrators can edit their workspace while creation stays with organization administrators', async () => {
  const prepare = (fixture) => {
    fixture.sessions.get('demo').data.grants = [
      {
        id: 'manage-product',
        scope: 'workspace',
        targetId: 'product',
        subjectType: 'user',
        subjectId: 'bao',
        role: 'admin',
      },
    ]
  }
  const create = await renderScreen('workspace-new', 'member', { workspaceId: 'product' }, prepare)
  assert.doesNotMatch(create.slice(create.indexOf('id="flow-form-modal"')), /<form|type="submit"/)
  const edit = await renderScreen('workspace-edit', 'member', { workspaceId: 'product' }, prepare)
  assert.match(edit, /id="flow-organization-modal-form"/)
})
test('explicit missing or archived Workspace operations never edit the selected fallback Workspace', async () => {
  for (const key of ['workspace-edit', 'workspace-archive']) {
    for (const record of ['missing', 'lab']) {
      const output = await renderScreen(key, 'baseline', { workspaceId: 'product', record }, (fixture) => {
        fixture.sessions
          .get('demo')
          .data.workspaces.find((workspace) => workspace.id === 'lab').archived = true
      })
      const modal = output.slice(output.indexOf('id="flow-form-modal"'))
      assert.match(modal, /Hồ sơ không khả dụng/)
      assert.doesNotMatch(modal, /<form|type="submit"/)
    }
  }
})
test('archived Teams recover without roster actions and are absent from grant pickers alongside archived targets', async () => {
  const prepare = (fixture) => {
    const data = fixture.sessions.get('demo').data
    data.teams.find((team) => team.id === 'engineering').archived = true
    data.workspaces.find((workspace) => workspace.id === 'product').archived = true
    data.projects.find((project) => project.id === 'core').archived = true
  }
  const roster = await renderScreen('team', 'baseline', { record: 'engineering' }, prepare)
  assert.match(roster, /Team không tìm thấy|Không tìm thấy Team/)
  assert.doesNotMatch(roster, /Gỡ khỏi Team|Sửa Team/)
  const grants = await renderScreen('access-grant', 'baseline', { team: 'engineering' }, prepare)
  const modal = grants.slice(grants.indexOf('id="flow-form-modal"'))
  assert.doesNotMatch(
    modal,
    /<option[^>]*value="product"|<option[^>]*value="engineering"|value="engineering"/,
  )
  const owner = await renderScreen('member-edit', 'baseline', { record: 'mai' })
  assert.match(owner, /<button[^>]*disabled[^>]*>\s*Xác nhận thu hồi\s*<\/button>/)
})

test('revoked member role forms explain separate restoration instead of offering a second revocation', async () => {
  const output = await renderScreen('member-edit', 'baseline', { record: 'bao' }, (fixture) => {
    fixture.sessions.get('demo').data.members.find((member) => member.id === 'bao').status = 'revoked'
  })
  const modal = output.slice(output.indexOf('id="flow-form-modal"'))
  assert.match(modal, /Đổi vai trò không khôi phục truy cập/)
  assert.match(modal, /Khôi phục truy cập Flow/)
  assert.match(modal, /Lưu vai trò/)
  assert.doesNotMatch(modal, /Xác nhận thu hồi/)
})

test('a server-rendered document keeps its language; a different saved one opens a new document', async () => {
  const saved = {
    location: globalThis.location,
    history: globalThis.history,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  }
  const replaced = []
  globalThis.location = {
    href: 'http://flow.local/flow/my-work?company=demo',
    replace: (url) => replaced.push(String(url)),
  }
  globalThis.history = {
    state: {},
    replaceState(next, _, url) {
      this.state = next
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  // Only the rendered language's catalog is loaded in this document.
  globalThis.document = { documentElement: { lang: 'en' } }
  globalThis.localStorage = { getItem: () => 'vi', setItem() {} }
  try {
    const output = await renderScreen('my-work', 'baseline', { serverShell: true })
    assert.equal(replaced.length, 1)
    assert.equal(new URL(replaced[0]).searchParams.get('lang'), 'vi')
    assert.equal(globalThis.document.documentElement.lang, 'en')
    assert.match(output, /lang="en"[^>]*>[\s\S]*Group: Status/)
    replaced.length = 0
    globalThis.location.href = 'http://flow.local/flow/my-work?company=demo&lang=en'
    await renderScreen('my-work', 'baseline', { serverShell: true })
    assert.equal(replaced.length, 0)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
    setFlowLocale('vi')
  }
})

test('SSR mount pins the Workspace record before adopting the authorized fallback context', async () => {
  const saved = { location: globalThis.location, history: globalThis.history }
  globalThis.location = { href: 'http://flow.local/flow/workspace-edit?company=demo&workspace=lab&lang=vi' }
  globalThis.history = {
    state: {},
    replaceState(next, _, url) {
      this.state = next
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  try {
    const props = { serverShell: true, workspaceId: 'product', record: 'lab', recordProvided: true }
    const output = await renderScreen('workspace-edit', 'baseline', props, (fixture) => {
      fixture.sessions.get('demo').data.workspaces.find((workspace) => workspace.id === 'lab').archived = true
      props.chrome = flowShellData(
        fixture.call('flow.workspace.bootstrap', {
          companyId: 'demo',
          workspaceId: 'product',
          route: 'workspace-overview',
          shellOnly: true,
        }).value,
      )
    })
    assert.equal(new URL(globalThis.location.href).searchParams.get('id'), 'lab')
    assert.equal(new URL(globalThis.location.href).searchParams.get('workspace'), 'product')
    const modal = output.slice(output.indexOf('id="flow-form-modal"'))
    assert.match(modal, /Hồ sơ không khả dụng/)
    assert.doesNotMatch(modal, /<form|type="submit"/)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})

test('guest membership keeps distinct role and grant forms while the primary footer remains associated with role save', async () => {
  const output = await renderScreen('member-edit', 'baseline', { record: 'guest' })
  const modal = output.slice(output.indexOf('id="flow-form-modal"'))
  assert.equal((modal.match(/id="flow-organization-modal-form"/g) ?? []).length, 1)
  assert.equal((modal.match(/type="submit"/g) ?? []).length, 2)
  const footer = modal.slice(modal.indexOf('<footer'))
  assert.match(footer, /form="flow-organization-modal-form"/)
  assert.match(footer, /Lưu vai trò/)
  assert.doesNotMatch(footer, /Cấp quyền/)
})
test('owner role is selected and protected while the workspace archive uses a small confirmation with a guarded footer', async () => {
  const owner = await renderScreen('member-edit', 'baseline', { record: 'mai' })
  assert.match(owner, /<select[^>]*name="role"[^>]*disabled/)
  assert.match(owner, /<option[^>]*value="owner"[^>]*selected/)
  assert.match(owner, /Vai trò chủ sở hữu được bảo vệ/)
  const archive = await renderScreen('workspace-archive', 'baseline', {
    workspaceId: 'product',
    record: 'product',
  })
  const modal = archive.slice(archive.indexOf('id="flow-form-modal"'))
  assert.match(modal, /role="alertdialog"/)
  assert.match(archive, /data-size="confirm"/)
  assert.match(modal, /<footer/)
  assert.match(modal, /<button[^>]*disabled[^>]*>[\s\S]*?Lưu trữ Workspace/)
})
test('workspace archive confirmation uses the scoped project count beyond its navigation window', async () => {
  const output = await renderScreen(
    'workspace-archive',
    'baseline',
    { workspaceId: 'product', record: 'product' },
    (fixture) => {
      const call = fixture.call.bind(fixture)
      fixture.call = (name, input) => {
        const response = call(name, input)
        if (name === 'flow.workspace.bootstrap' && response.value) {
          response.value.projects = []
          response.value.context = { ...response.value.context, workspaceId: 'product' }
          response.value.counts = { projects: 500 }
        }
        return response
      }
    },
  )
  const modal = output.slice(output.indexOf('id="flow-form-modal"'))
  assert.match(modal, /Xem 500 dự án đang hoạt động/)
  assert.match(modal, /<button[^>]*disabled[^>]*>[\s\S]*?Lưu trữ Workspace/)
})

test('every route renders its client presenter after the same API bootstrap', async () => {
  // Core alone: the pro package adds its own routes only when it is registered.
  assert.equal(Object.keys(routes).length, 80)
  for (const key of ['goals', 'goal', 'goal-new', 'goal-edit']) assert.equal(routes[key], undefined)
  for (const [key, route] of Object.entries(routes)) {
    const output = await renderScreen(key)
    if (!['record', 'overlay'].includes(route.pattern))
      assert.ok(contentWidths[key], `${key} needs an explicit content width`)
    assert.ok(['standard', 'wide', 'full'].includes(contentWidthFor(key, route)), key)
    assert.match(output, /data-flow="content-container"|data-flow-layout="documents"/, key)
    assert.match(output, /data-flow="shell"/, key)
    if (['pages', 'page', 'page-archived', 'page-new', 'page-child'].includes(key)) {
      assert.match(output, /data-flow-layout="documents"/, key)
      assert.doesNotMatch(output, /data-flow="docs-header"/, key)
    } else
      assert.ok(
        output.includes((key === 'cmdk' ? routes['my-work'].title : route.title).replaceAll('&', '&amp;')),
        key,
      )
    const invalid = /\[object Object\]|undefined|Không thể khởi động/.exec(output)
    assert.equal(invalid, null, key + (invalid ? output.slice(invalid.index - 80, invalid.index + 120) : ''))
    assert.equal((output.match(/<h1(?: |>|\n)/g) || []).length, 1, key)
  }
})

test('denied SSR scope renders immediately and stays recoverable after hydration and fragment updates', async () => {
  const saved = { location: globalThis.location, history: globalThis.history }
  globalThis.location = {
    href: 'http://flow.local/flow/issue?company=demo&project=inaccessible&id=secret-task&lang=vi',
  }
  globalThis.history = {
    state: {},
    replaceState(next, _, url) {
      this.state = next
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  const fixture = createOrganizationSession('baseline', 'my-work')
  const chrome = flowShellData(
    fixture.call('flow.workspace.bootstrap', { route: 'my-work', shellOnly: true }).value,
  )
  chrome.problem = { code: 'forbidden' }
  const props = {
    screen: 'issue',
    project: 'inaccessible',
    record: 'secret-task',
    recordProvided: true,
    serverShell: true,
    chrome,
  }
  const lifetime = new AbortController()
  const island = createFlowWorkspace(props, {
    call: async () => {
      throw new FlowApiError('Server refused this scope', 'forbidden')
    },
  })
  const check = () => {
    const output = renderToStaticString(island.view())
    assert.match(output, /Không có quyền truy cập/)
    assert.match(output, /Việc của tôi/)
    assert.match(output, /Thử lại/)
    assert.doesNotMatch(output, /data-flow="loading"|data-flow="toast"|<dialog|<form|secret-task/)
    const shell = renderToStaticString(island.shellView(island.view()))
    assert.doesNotMatch(shell, /Tạo task|Tạo công việc/)
  }
  try {
    check()
    island.mount({ root: root(), lifetime: lifetime.signal })
    check()
    await new Promise((resolve) => setTimeout(resolve, 0))
    check()
    island.update({ ...props, screen: 'board', recordProvided: false })
    check()
    await new Promise((resolve) => setTimeout(resolve, 0))
    check()
  } finally {
    lifetime.abort()
    island.dispose()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})

test('anonymous SSR chrome is bound before the primary read can change its shape', () => {
  const selectors = [],
    lifetime = new AbortController(),
    host = root()
  host.querySelector = (selector) => {
    selectors.push(selector)
    return null
  }
  const island = createFlowWorkspace(
    { serverShell: true, screen: 'workspace-overview' },
    {
      call: () => new Promise(() => {}),
    },
  )
  try {
    island.mount({ root: host, lifetime: lifetime.signal })
    assert.deepEqual(
      selectors.filter((selector) => selector.startsWith('[data-flow-chrome=')),
      ['[data-flow-chrome="sidebar"]', '[data-flow-chrome="header"]', '[data-flow-chrome="tabs"]'],
    )
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('every first-run stage composes one main landmark with the shell', async () => {
  for (const state of ['blank', 'blank-password', 'blank-onboarding']) {
    const output = await renderScreen('workspace-overview', state)
    assert.match(output, /data-flow="entry-page" data-embedded="true"/, state)
    assert.equal((output.match(/<main\b/g) ?? []).length, 1, state)
  }
})
test('core hides goal entry points in workspace and epic views even with pro-shaped fixture data', async () => {
  const overview = await renderScreen('workspace-overview')
  assert.doesNotMatch(overview, /href="[^"]*\/goals[?"]|data-tab="goals"/)
  assert.doesNotMatch(await renderScreen('epic-new'), /name="goalId"/)
  assert.doesNotMatch(await renderScreen('epic'), /name="epic-goal"/)
})
test('empty, readonly and forbidden are API states, without a second presenter', async () => {
  assert.match(await renderScreen('my-work', 'empty'), /Không có công việc phù hợp/)
  assert.match(await renderScreen('pages', 'empty'), /Chưa có tài liệu/)
  assert.match(await renderScreen('all-epics', 'empty'), /Chưa có dữ liệu/)
  assert.match(await renderScreen('issue', 'readonly'), /Chỉ xem/)
  const forbidden = await renderScreen('issue', 'forbidden')
  assert.match(forbidden, /Không có quyền/)
  assert.doesNotMatch(forbidden, /KV-142|Đồng bộ tồn phòng/)
})

test('related-task pickers exclude existing links and render an explicit empty result', async () => {
  for (const screen of ['dependency-new', 'subtask-link']) {
    const output = await renderScreen(screen, 'baseline', { record: 'KV-151' }, (fixture) => {
      const data = fixture.sessions.get('demo').data
      data.tasks = data.tasks.filter((task) => ['KV-151', 'KV-147'].includes(task.id))
      data.tasks.find((task) => task.id === 'KV-151').blockedBy = ['KV-147']
      data.tasks.find((task) => task.id === 'KV-147').parentId = 'KV-151'
    })
    assert.match(output, /Không có công việc phù hợp/, screen)
    assert.doesNotMatch(output, />Chọn<\/button>/, screen)
  }
})

test('archived tasks do not expose dependency or child-link pickers through a deep link', async () => {
  for (const screen of ['dependency-new', 'subtask-link']) {
    const output = await renderScreen(screen, 'baseline', { record: 'KV-151' }, (fixture) => {
      fixture.sessions.get('demo').data.tasks.find((task) => task.id === 'KV-151').archived = true
    })
    assert.match(output, /Không tìm thấy công việc/, screen)
    assert.doesNotMatch(output, /name="taskLookup"|>Chọn<\/button>/, screen)
  }
})
test('read-only task mutation launchers are disabled while history and child reads remain available', async () => {
  const buttons = (output) =>
    [...output.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
      attributes: match[1],
      text: match[2].replace(/<[^>]*>/g, '').trim(),
    }))
  const readonly = buttons(await renderScreen('issue', 'readonly', { project: 'core', record: 'KV-142' }))
  for (const label of ['Lưu trữ', 'Thêm việc con', 'Gắn việc có sẵn', 'Thêm phụ thuộc']) {
    const button = readonly.find((item) => item.text === label)
    assert.ok(button, label)
    assert.match(button.attributes, /\bdisabled\b/, label)
  }
  for (const label of ['Lịch sử thay đổi', 'Mở']) {
    const button = readonly.find((item) => item.text === label)
    assert.ok(button, label)
    assert.doesNotMatch(button.attributes, /\bdisabled\b/, label)
  }
  for (const [route, id] of [
    ['issue-archive', 'reason'],
    ['comment', 'text'],
  ]) {
    const output = await renderScreen(route, 'readonly', { project: 'core', record: 'KV-142' })
    const field = [...output.matchAll(/<textarea\b([^>]*)>/g)].find((match) =>
      match[1].includes(`id="${id}"`),
    )
    assert.ok(field, `${route}: ${id}`)
    assert.match(field[1], /\bdisabled\b/, route)
  }
  const writable = buttons(await renderScreen('issue', 'baseline', { project: 'core', record: 'KV-142' }))
  for (const label of ['Lưu trữ', 'Thêm việc con', 'Gắn việc có sẵn', 'Thêm phụ thuộc'])
    assert.doesNotMatch(
      writable.find((item) => item.text === label)?.attributes ?? 'missing disabled',
      /\bdisabled\b/,
      label,
    )
})
test('read-only missing document recovery does not offer creation while writable recovery does', async () => {
  const props = { project: 'core', record: 'missing-document' }
  const canCreate = (output) =>
    [...output.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].some(
      (match) => match[1].replace(/<[^>]*>/g, '').trim() === 'Tạo tài liệu',
    )
  const readonly = await renderScreen('page', 'readonly', props)
  assert.match(readonly, /Không tìm thấy tài liệu/)
  assert.equal(canCreate(readonly), false)
  assert.equal(canCreate(await renderScreen('page', 'baseline', props)), true)
})
test('HTTP client handles both domain failures and failed HTTP responses', async () => {
  const client = createFnClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            ok: false,
            errors: [{ code: 'conflict', message: 'Stale' }],
            fields: { title: 'Invalid' },
          },
        }),
      ),
  })
  await assert.rejects(
    client('flow.issue.save', {}),
    (e) => e instanceof FlowApiError && e.code === 'conflict' && e.fields.title === 'Invalid',
  )
  const denied = createFnClient({
    fetch: async () =>
      new Response(JSON.stringify({ ok: false, code: 'forbidden', message: 'Denied' }), {
        status: 403,
      }),
  })
  await assert.rejects(denied('x'), (error) => error.code === 'forbidden')
})
test('fixture commands preserve blocking, CAS, replay and dependency-cycle behaviors', () => {
  const f = createFixtureSession()
  assert.equal(
    f.call('flow.issue.move', {
      id: 'KV-142',
      columnId: 'done',
      expectedVersion: 1,
      idempotencyKey: 'a',
    }).value.errors[0].code,
    'blocked',
  )
  const args = { id: 'KV-144', columnId: 'done', expectedVersion: 1, idempotencyKey: 'b' }
  assert.equal(f.call('flow.issue.move', args).value.ok, true)
  assert.equal(f.call('flow.issue.move', args).value.ok, true)
  assert.equal(f.data.tasks.find((t) => t.id === 'KV-144').version, 2)
  assert.equal(f.call('flow.issue.move', { ...args, idempotencyKey: 'c' }).value.errors[0].code, 'conflict')
  assert.equal(
    f.call('flow.issue.dependency', { id: 'KV-144', target: 'KV-142', idempotencyKey: 'd' }).value.errors[0]
      .code,
    'cycle',
  )
  assert.equal(
    f.call('flow.issue.move', {
      id: 'KV-142',
      columnId: 'done',
      expectedVersion: 1,
      idempotencyKey: 'e',
    }).value.ok,
    true,
  )
})
test('fixture sessions isolate edits and replay a creation only once', () => {
  const a = createFixtureSession(),
    b = createFixtureSession()
  const input = { title: 'New task', idempotencyKey: 'same' }
  a.call('flow.issue.save', input)
  a.call('flow.issue.save', input)
  assert.equal(a.data.tasks.length, 13)
  assert.equal(b.data.tasks.length, 12)
  assert.equal(
    createFixtureSession('readonly').call('flow.issue.save', input).value.errors[0].code,
    'forbidden',
  )
})
test('Atlas owns no duplicate screen markup, CSS, tokens or package installation', async () => {
  const source = await readFile(new URL('../client/workspace.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ["'][^"']*\/atlas\/|isAtlas|\.innerHTML|fetch\(/)
  const packageJSON = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(packageJSON.private, undefined)
  assert.equal(packageJSON.license, 'MIT')
})

test('attachment metadata and history stay associated with their own task', () => {
  const fixture = createFixtureSession()
  fixture.call('flow.entity.save', {
    collection: 'files',
    taskId: 'KV-131',
    title: 'check.csv',
    idempotencyKey: 'file-131',
  })
  assert.equal(fixture.data.files.find((f) => f.title === 'check.csv').taskId, 'KV-131')
  assert.equal(fixture.data.files.find((f) => f.id === 'file1').taskId, 'KV-142')
  assert.equal(fixture.data.history[0].taskId, 'KV-131')
  fixture.call('flow.issue.save', { title: 'A fresh task', idempotencyKey: 'new-task' })
  assert.equal(fixture.data.history[0].taskId, 'KV-160')
  assert.equal(fixture.data.files.filter((f) => f.taskId === 'KV-160').length, 0)
})

test('document editing stores structured blocks without dropping the page hierarchy', () => {
  const fixture = createFixtureSession()
  const page = fixture.data.pages.find((p) => p.id === 'checklist')
  const blocks = [
    { id: 'heading', type: 'heading', text: 'Release plan' },
    { id: 'table', type: 'table', rows: [['Version', '1.1']] },
    { id: 'check', type: 'check', text: 'Approved', checked: true },
  ]
  const result = fixture.call('flow.entity.save', {
    collection: 'pages',
    entityId: page.id,
    title: page.title,
    parentId: page.parentId,
    projectId: page.projectId,
    blocks,
    idempotencyKey: 'document-save',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(page.blocks, blocks)
  assert.equal(page.parentId, 'handoff')
  assert.notEqual(page.blocks, blocks)
})

test('navigation separates workspace settings, project tools and document ownership', async () => {
  const ops = await renderScreen('settings', 'baseline', { project: 'ops' })
  assert.match(ops, /Thiết lập dự án · Vận hành nội bộ/)
  assert.match(ops, /Công cụ dự án/)
  assert.doesNotMatch(ops, /title="KetSuite Core"/)
  assert.match(ops, /Chuyển Workspace/)
  const docs = await renderScreen('pages', 'baseline', { project: 'ops' })
  assert.match(docs, /View dự án/)
  assert.match(docs, /Sổ tay vận hành/)
  assert.doesNotMatch(docs, /data-flow="doc-tree-page"[^>]*>[^<]*Quy ước bàn giao/)
  const library = await renderScreen('all-pages')
  assert.match(library, /Nơi sở hữu tài liệu/)
  assert.match(library, /Hướng dẫn làm việc chung/)
  assert.doesNotMatch(library, /aria-label="View dự án"/)
  const workspace = await renderScreen('page', 'baseline', { record: 'workspace-guide', scope: 'workspace' })
  assert.match(workspace, /Hướng dẫn làm việc chung/)
  assert.doesNotMatch(workspace, /aria-label="View dự án"/)
})

test('document library renders one empty state and recovers an unavailable owner filter', async () => {
  const empty = await renderScreen('all-pages', 'empty')
  assert.equal((empty.match(/data-flow="empty"/g) ?? []).length, 1)
  assert.ok(empty.includes('Chưa có tài liệu'))
  const unavailable = await renderScreen('all-pages', 'baseline', { projectFilter: 'removed-project' })
  assert.equal((unavailable.match(/data-flow="empty"/g) ?? []).length, 1)
  assert.ok(unavailable.includes('Xóa bộ lọc'))
  assert.ok(!unavailable.includes('data-flow="doc-tree-page"'))
})

test('document library keeps private/filter query presentation and exposes return navigation from project documents', async () => {
  const privateLibrary = await renderScreen('all-pages', 'baseline', {
    visibility: 'private',
    projectFilter: 'core',
  })
  assert.ok(privateLibrary.includes('Ghi chú cá nhân'))
  assert.ok(!privateLibrary.includes('Quy ước bàn giao'))
  const filtered = await renderScreen('all-pages', 'baseline', { docq: 'unmatched-word' })
  assert.equal((filtered.match(/data-flow="empty"/g) ?? []).length, 1)
  assert.ok(filtered.includes('Không có tài liệu khớp từ khóa'))
  assert.ok(filtered.includes('Xóa bộ lọc'))
  const page = await renderScreen('page', 'baseline', {
    project: 'core',
    record: 'private-notes',
    returnTo: '/flow/all-pages?visibility=private&projectFilter=core',
  })
  assert.ok(page.includes('Quay lại thư viện'))
  const privateEmpty = await renderScreen('pages', 'empty', { project: 'core', visibility: 'private' })
  const pressed = privateEmpty.match(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?<\/button>/g) ?? []
  assert.ok(pressed.some((button) => button.includes('Riêng tư')))
})

test('document moves retain their dialog while note creation has a directly addressable document workspace', async () => {
  for (const key of ['page-move']) {
    const output = await renderScreen(key, 'baseline', { project: 'core', record: 'handoff' })
    assert.match(output, /data-flow-layout="documents"/)
    assert.match(output, /<dialog[^>]*[\s\S]*id="flow-document-modal"/)
    assert.ok(output.indexOf('data-flow="doc-paper"') < output.indexOf('id="flow-document-modal"'))
    assert.match(output, /Quy ước bàn giao/)
    assert.doesNotMatch(output, /id="flow-task-modal"/)
  }
  for (const key of ['page-new', 'page-child']) {
    const output = await renderScreen(key, 'baseline', { project: 'core', record: 'handoff' })
    assert.match(output, /data-flow-layout="documents"/)
    assert.doesNotMatch(output, /id="flow-document-modal"|<dialog/)
  }
})

test('document moves keep the current parent, a native footer submit and read-only controls', async () => {
  const output = await renderScreen('page-move', 'baseline', { record: 'checklist', project: 'core' })
  assert.match(output, /id="flow-document-move-form"/)
  assert.match(output, /value="handoff"[^>]*selected/)
  assert.match(output, /form="flow-document-move-form"/)
  const readonly = await renderScreen('page-move', 'readonly', { record: 'checklist', project: 'core' })
  assert.match(readonly, /name="new-parent"[^>]*disabled/)
  assert.match(readonly, /form="flow-document-move-form"[^>]*disabled/)
  const missing = await renderScreen('page-move', 'baseline', { record: 'removed-page', project: 'core' })
  assert.doesNotMatch(missing, /id="flow-document-move-form"/)
})

test('all form and action overlays keep a background and use a native dialog', async () => {
  for (const key of [
    'project-new',
    'column-edit',
    'type-edit',
    'field-edit',
    'tag-edit',
    'sprint-new',
    'epic-new',
    'sprint-close',
    'display',
    'timezone',
    'issue',
    'issue-new',
    'issue-move',
  ]) {
    const output = await renderScreen(key)
    assert.match(output, /data-flow="shell"/, key)
    assert.match(output, /<dialog/, key)
    assert.equal((output.match(/<dialog/g) || []).length, 1, key)
    assert.ok(output.indexOf('data-flow="shell"') < output.indexOf('<dialog'), key)
    assert.doesNotMatch(output, /data-flow="sheet"/, key)
  }
})

test('task dialogs are only as wide as their content: the record gets the wide layout, one-step actions a form width', async () => {
  const dialog = (output) =>
    output.match(/<dialog[^>]*id="flow-task-modal"[^>]*>/)?.[0] ??
    output.match(/<dialog[^>]*data-size="[^"]*"[^>]*>/)?.[0]
  for (const key of ['issue', 'issue-new']) {
    const output = await renderScreen(key)
    assert.match(dialog(output), /data-size="task"/, key)
    assert.match(output, /data-flow="record-layout"/, key)
  }
  for (const key of [
    'issue-move',
    'board-move',
    'issue-sprint',
    'dependency-new',
    'subtask-link',
    'comment',
  ]) {
    const output = await renderScreen(key),
      modal = output.slice(output.indexOf('id="flow-task-modal"'))
    assert.ok(output.includes('id="flow-task-modal"'), key)
    assert.match(dialog(output), /data-size="default"/, key)
    assert.doesNotMatch(
      modal,
      /data-flow="record-layout"|data-flow="section"(?![^>]*data-inset="none")|<footer/,
      key,
    )
  }
})

test('task archive is a centered confirmation with native reason validation and a guarded footer', async () => {
  const output = await renderScreen('issue-archive', 'baseline', { record: 'KV-142', project: 'core' })
  const dialog = output.slice(output.indexOf('id="flow-task-modal"'))
  assert.match(output, /data-size="confirm"/)
  assert.match(output, /role="alertdialog"/)
  assert.match(dialog, /Lưu trữ công việc · KV-142/)
  assert.match(dialog, /id="flow-task-archive-form"/)
  assert.match(dialog, /name="reason"[^>]*required/)
  assert.match(dialog, /<footer>[\s\S]*Hủy[\s\S]*data-variant="danger"[\s\S]*Xác nhận lưu trữ/)
  const readonly = await renderScreen('issue-archive', 'readonly', { record: 'KV-142', project: 'core' })
  const footer = readonly.slice(readonly.indexOf('<footer', readonly.indexOf('id="flow-task-modal"')))
  assert.match(footer, /disabled[^>]*>[\s\S]*Xác nhận lưu trữ/)
})

test('an explicit missing task never falls back to a neighboring task or offers mutation controls', async () => {
  for (const route of ['issue', 'issue-move', 'comment', 'issue-archive', 'dependency-new', 'subtask-new']) {
    const output = await renderScreen(route, 'baseline', { record: 'KV-142', project: 'core' }, (fixture) => {
      const data = fixture.sessions.get('demo').data
      data.tasks = data.tasks.filter((task) => task.id !== 'KV-142')
    })
    const dialog = output.slice(output.indexOf('id="flow-task-modal"'))
    assert.match(dialog, /Không tìm thấy công việc/, route)
    assert.doesNotMatch(
      dialog,
      /data-flow="record-layout"|name="reason"|name="text"|Xác nhận lưu trữ|Gửi bình luận|Thay đổi thuộc tính được tự động lưu|Thuộc tính/,
      route,
    )
  }
})

test('inline comment freezes its draft during the write and resets only after accepted recovery', async () => {
  const oldFormData = globalThis.FormData
  const fixture = createOrganizationSession('baseline', 'issue')
  const lifetime = new AbortController()
  let release,
    resets = 0
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop())
      if (name === 'flow.issue.comment')
        await new Promise((resolve) => {
          release = resolve
        })
      return new Response(JSON.stringify(fixture.call(name, JSON.parse(request.body))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const island = createFlowWorkspace({ screen: 'issue', record: 'KV-142', project: 'core' }, { call })
  const form = {
    values: { comment: '   ' },
    reset() {
      resets++
      this.values.comment = ''
    },
  }
  globalThis.FormData = class {
    constructor(target) {
      this.entries = Object.entries(target.values)
    }
    [Symbol.iterator]() {
      return this.entries[Symbol.iterator]()
    }
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const submit = () =>
      findHandler(island.view(), '<form', 'submit')({ preventDefault() {}, currentTarget: form })
    const refused = submit()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.match(renderToStaticString(island.view()), /name="comment"[^>]*disabled/)
    release()
    await refused
    assert.equal(resets, 0)
    assert.equal(form.values.comment, '   ')
    assert.match(renderToStaticString(island.view()), /id="comment"[^>]*aria-invalid="true"/)
    form.values.comment = 'Recovered comment'
    const accepted = submit()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.match(renderToStaticString(island.view()), /name="comment"[^>]*disabled/)
    release()
    await accepted
    assert.equal(resets, 1)
    assert.equal(fixture.sessions.get('demo').data.comments.at(-1).text, 'Recovered comment')
  } finally {
    globalThis.FormData = oldFormData
    lifetime.abort()
    island.dispose()
  }
})

test('reloading a workspace-scoped modal retains the originating project and filters', async () => {
  const previousLocation = globalThis.location,
    previousHistory = globalThis.history
  const state = {
    flowBackground: {
      screen: 'board',
      url: '/flow/board?project=ops&q=handoff&status=todo&group=priority',
      record: 'KV-129',
    },
    flowModalDepth: 1,
  }
  globalThis.location = { href: 'http://flow.local/flow/project-new?lang=vi' }
  globalThis.history = {
    state,
    replaceState(next, _, url) {
      this.state = next
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  try {
    const output = await renderScreen('project-new')
    assert.match(output, /Vận hành nội bộ/)
    assert.doesNotMatch(output, /<input[^>]*type="search"/)
    assert.match(output, /value="todo" selected/)
    assert.match(output, /value="priority" selected/)
    assert.match(output, /id="flow-form-modal"/)
    assert.match(output, /Bảng công việc/)
  } finally {
    if (previousLocation === undefined) delete globalThis.location
    else globalThis.location = previousLocation
    if (previousHistory === undefined) delete globalThis.history
    else globalThis.history = previousHistory
  }
})

test('a direct list URL restores search, grouping and manual sort without silently changing the order mode', async () => {
  const previousLocation = globalThis.location,
    previousHistory = globalThis.history
  globalThis.location = { href: 'http://flow.local/flow/all-issues?lang=vi&q=KV-14&group=none&sort=manual' }
  globalThis.history = {
    state: {},
    replaceState(next, _, url) {
      this.state = next
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  try {
    const output = await renderScreen('all-issues')
    assert.doesNotMatch(output, /<input[^>]*type="search"/)
    assert.match(output, /KV-142/)
    assert.doesNotMatch(output, /KV-129/)
    assert.match(output, /value="none" selected/)
    assert.match(output, /value="manual" selected/)
  } finally {
    if (previousLocation === undefined) delete globalThis.location
    else globalThis.location = previousLocation
    if (previousHistory === undefined) delete globalThis.history
    else globalThis.history = previousHistory
  }
})

test('management routes render scoped tabs and sidebar links instead of disclosure menus', async () => {
  for (const key of ['organization', 'workspaces', 'organization-members', 'teams', 'team', 'permissions']) {
    const out = await renderScreen(key)
    assert.match(out, /data-flow="scope-tabs" aria-label="Quản lý tổ chức/)
    assert.doesNotMatch(out, /<summary>Công cụ Workspace|<summary>Tổ chức ·/)
  }
  for (const key of [
    'workspace-overview',
    'all-issues',
    'all-pages',
    'workspace-members',
    'workspace-settings',
  ])
    assert.match(await renderScreen(key), /data-flow="scope-tabs" aria-label="Quản lý Workspace/)
  assert.doesNotMatch(await renderScreen('board'), /data-flow="scope-tabs"/)
  // Without the pro package its destinations disappear instead of rendering locked or dead links.
  for (const key of ['all-issues', 'organization'])
    assert.doesNotMatch(await renderScreen(key), /quality-inbox|performance-rules|performance\b|workload/)
})

test('sidebar separates workspace switching from user organization controls and project settings', async () => {
  const out = await renderScreen('board')
  const picker = out.slice(
    out.indexOf('<details data-flow="context-picker"'),
    out.indexOf('<details data-flow="mobile-nav"'),
  )
  assert.match(picker, /Quản lý Workspace/)
  assert.doesNotMatch(picker, /<select|Chuyển tổ chức/)
  const navigation = out.slice(
    out.indexOf('data-flow="navigation-content"'),
    out.indexOf('data-flow="navigation-footer"'),
  )
  assert.doesNotMatch(navigation, /Công cụ Workspace|Tổ chức ·|Thư viện tài liệu|>Quản lý<|project-subnav/)
  assert.match(out, /data-flow="navigation-footer"[\s\S]*aria-label="Chuyển tổ chức"/)
  const views = out.slice(
    out.indexOf('data-flow="project-views"'),
    out.indexOf('data-flow="content-container"'),
  )
  assert.doesNotMatch(views, />Cài đặt<|>Thiết lập dự án</)
  assert.match(out, />Thiết lập dự án\s*<\/button>/)
})

test('workspace, documents and modal failures use one recoverable toast without inline error banners', async () => {
  for (const screen of ['board', 'page', 'project-new', 'issue']) {
    const output = await renderScreen(screen, 'conflict')
    assert.equal((output.match(/data-flow="toast"/g) ?? []).length, 1, screen)
    assert.match(output, /Tải phiên bản mới/)
    assert.doesNotMatch(output, /data-flow="notice"\s+data-tone="red"/)
    if (['project-new', 'issue'].includes(screen)) {
      assert.match(output, /data-flow="toast"[^>]*data-placement="inline"/)
      assert.doesNotMatch(output, /data-flow="toast"[^>]*popover=/)
      assert.ok(output.indexOf('data-flow="toast"') > output.indexOf('<dialog'), screen)
      assert.ok(output.indexOf('data-flow="toast"') < output.indexOf('</dialog>'), screen)
    }
  }
})

test('global search uses the sidebar launcher and my-work workspace filtering shares the status toolbar', async () => {
  for (const screen of [
    'my-work',
    'all-issues',
    'issue-filter',
    'project-issues',
    'issues-archived',
    'filter-limit',
    'bulk',
    'board',
    'calendar',
  ]) {
    const out = await renderScreen(screen)
    const start = out.indexOf('<header data-flow="shell-header"')
    const header = out.slice(start, out.indexOf('</header>', start))
    assert.doesNotMatch(header, /data-flow="shell-search"|type="search"/)
    assert.equal((out.match(/data-flow="search-trigger"/g) ?? []).length, 1)
    assert.equal((out.match(/<input[^>]*type="search"/g) ?? []).length, 0)
    if (screen === 'my-work') {
      assert.equal((out.match(/aria-label="Lọc theo Workspace"/g) ?? []).length, 1)
      const workspace = out.indexOf('aria-label="Lọc theo Workspace"'),
        status = out.indexOf('aria-label="Lọc trạng thái"')
      assert.ok(workspace < status)
      assert.doesNotMatch(out.slice(workspace, status), /data-flow="toolbar"/)
    }
  }
})

// Saved views reuse the project task list and the shared sidebar search launcher.
test('saved project views retain the shared sidebar search launcher', async () => {
  const out = await renderScreen('project-issues', 'baseline', {
    company: 'demo',
    workspace: 'product',
    project: 'core',
    view: 'v1',
  })
  const start = out.indexOf('<header data-flow="shell-header"')
  const header = out.slice(start, out.indexOf('</header>', start))
  assert.doesNotMatch(header, /data-flow="shell-search"|type="search"/)
  assert.equal((out.match(/data-flow="search-trigger"/g) ?? []).length, 1)
  assert.equal((out.match(/<input[^>]*type="search"/g) ?? []).length, 0)
})

test('content keeps two bounded widths with boards, scheduling and document work surfaces unbounded', async () => {
  const { managementTabs } = await import('@ketvietlab/flow-client/navigation.mjs')
  assert.deepEqual([...new Set(Object.values(contentWidths).filter((width) => width !== 'full'))].sort(), [
    'standard',
    'wide',
  ])
  for (const [scope, tabs] of Object.entries(managementTabs)) {
    assert.equal(new Set(tabs.map((tab) => contentWidthFor(tab.value))).size, 1, scope)
  }
  for (const key of ['project-issues', 'sprints', 'epics', 'atlas', 'settings', 'project-members'])
    assert.equal(contentWidthFor(key), 'wide', key)
  assert.deepEqual(
    Object.entries(contentWidths)
      .filter(([, width]) => width === 'full')
      .map(([key]) => key)
      .sort(),
    ['board', 'calendar', 'page', 'page-archived', 'pages'],
  )
  for (const key of ['board', 'calendar']) {
    const output = await renderScreen(key)
    assert.match(output, /data-flow="content-container" data-width="full"/)
  }
  const library = await renderScreen('all-pages')
  assert.match(library, /data-flow="content-container" data-width="wide"/)
})
test('without pro, organization and member settings carry no work week or holidays', async () => {
  const settings = await renderScreen('organization-settings')
  assert.match(settings, /data-flow="content-container"/)
  assert.doesNotMatch(settings, /Giờ làm việc|Ngày nghỉ chung|name="day0"/)
  const member = await renderScreen('member-edit', 'baseline', { record: 'bao' })
  assert.match(member, /<form/)
  assert.doesNotMatch(member, /Giờ làm việc riêng|name="day6"/)
  assert.doesNotMatch(await renderScreen('issue'), /Giờ làm|Ghi giờ thực tế/)
})

test('task detail accepts files in place instead of opening a second attachments dialog', async () => {
  const out = await renderScreen('issue')
  const start = out.indexOf('data-flow="file-drop"')
  assert.ok(start > out.indexOf('<dialog'))
  assert.ok(start < out.indexOf('</dialog>'))
  assert.match(out.slice(start), /^[^>]*>[\s\S]*?type="file" multiple/)
  assert.doesNotMatch(out, /\/attachments|>\s*Thêm tệp\s*</)
})

// Finds the event handler bound right after an opening tag carrying `marker` in a rendered template tree.
const findHandler = (node, marker, event) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const x of node) {
      const h = findHandler(x, marker, event)
      if (h) return h
    }
    return null
  }
  if (node.items && node.render)
    return findHandler(
      node.items.map((x, i) => node.render(x, i)),
      marker,
      event,
    )
  if (!node.strings) return null
  let open = ''
  for (let i = 0; i < node.values.length; i++) {
    open = node.strings[i].includes('<')
      ? node.strings[i].slice(node.strings[i].lastIndexOf('<'))
      : open + node.strings[i]
    if (
      open.includes(marker) &&
      node.strings[i].endsWith(`on:${event}=`) &&
      typeof node.values[i] === 'function'
    )
      return node.values[i]
    const h = findHandler(node.values[i], marker, event)
    if (h) return h
  }
  return null
}

test('accepting an invitation establishes fresh SSR chrome in the newly authorized workspace', async () => {
  const previous = {
    location: globalThis.location,
    history: globalThis.history,
    document: globalThis.document,
  }
  const fixture = createOrganizationSession('baseline', 'my-work')
  const full = fixture.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    workspaceId: 'product',
    route: 'my-work',
  }).value
  const blank = {
    ...full,
    context: { companyId: 'demo', workspaceId: '', projectId: null },
    workspaces: [],
    projects: [],
    members: [],
    tasks: [],
    capabilities: { write: false, manageOrganization: false },
    invitationOffer: { available: true },
  }
  let accepted = false
  const replacements = [],
    fragments = []
  const url = new URL('http://flow.local/flow/invitation-accept?company=demo&lang=vi&id=invitation')
  globalThis.location = {
    get href() {
      return url.href
    },
    get pathname() {
      return url.pathname
    },
    get search() {
      return url.search
    },
    replace(target) {
      replacements.push(target)
    },
  }
  globalThis.history = {
    state: {},
    replaceState(state, _, target) {
      this.state = state
      url.href = new URL(target, url).href
    },
  }
  globalThis.document = Object.assign(new EventTarget(), { documentElement: {} })
  const lifetime = new AbortController()
  const island = createFlowWorkspace(
    {
      serverShell: true,
      companyId: 'demo',
      workspaceId: '',
      screen: 'invitation-accept',
      record: 'invitation',
      recordProvided: true,
      chrome: flowShellData(blank),
    },
    {
      call: async (name) => {
        if (name === 'flow.invitation.accept') {
          accepted = true
          return { ok: true }
        }
        return accepted ? full : blank
      },
      navigatePage: async (target) => fragments.push(target),
    },
  )
  const button = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.strings?.[0]?.trimStart().startsWith('<button') && node.values.includes('Nhận lời mời'))
      return findHandler(node, '<button', 'click')
    for (const child of Array.isArray(node)
      ? node
      : node.items && node.render
        ? node.items.map(node.render)
        : (node.values ?? [])) {
      const found = button(child)
      if (found) return found
    }
    return null
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const accept = button(island.view())
    assert.equal(typeof accept, 'function')
    await accept()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(replacements.length, 1)
    assert.equal(new URL(replacements[0], url).pathname, '/flow/my-work')
    assert.equal(new URL(replacements[0], url).searchParams.get('workspace'), 'product')
    assert.deepEqual(fragments, [])
  } finally {
    lifetime.abort()
    island.dispose()
    Object.assign(globalThis, previous)
  }
})

test('an unacknowledged comment keeps its replay key across an intervening successful mutation', async () => {
  const original = globalThis.FormData
  globalThis.FormData = class {
    constructor(form) {
      this.form = form
    }
    *[Symbol.iterator]() {
      yield* Object.entries(this.form.values)
    }
  }
  const fixture = createOrganizationSession('baseline'),
    data = fixture.sessions.get('demo').data
  data.tasks.find((task) => task.id === 'KV-131').followed = false
  const calls = [],
    lifetime = new AbortController()
  let loseResponse = true,
    resets = 0
  const form = {
    values: { comment: 'Replay after another action' },
    reset() {
      resets++
      this.values.comment = ''
    },
  }
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        args = JSON.parse(request.body)
      const response = fixture.call(name, args)
      if (name !== 'flow.workspace.bootstrap') calls.push({ name, ...args })
      if (name === 'flow.issue.comment' && loseResponse) {
        loseResponse = false
        throw new Error('Lost response after commit')
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const island = createFlowWorkspace({ screen: 'issue', record: 'KV-131' }, { call })
  const click = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((child) => click(child, label)).find(Boolean)
    if (node.items && node.render)
      return click(
        node.items.map((item, i) => node.render(item, i)),
        label,
      )
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes(label))
      return findHandler(node, '<button', 'click')
    return click(node.values, label)
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const submit = () =>
      findHandler(island.view(), '<form', 'submit')({ preventDefault() {}, currentTarget: form })
    await submit()
    assert.equal(resets, 0)
    assert.equal(data.comments.filter((comment) => comment.text === form.values.comment).length, 1)
    await click(island.view(), 'Theo dõi')()
    assert.equal(data.tasks.find((task) => task.id === 'KV-131').followed, true)
    await submit()
    const comments = calls.filter((entry) => entry.name === 'flow.issue.comment')
    assert.equal(comments.length, 2)
    assert.equal(comments[1].idempotencyKey, comments[0].idempotencyKey)
    assert.equal(data.comments.filter((comment) => comment.text === 'Replay after another action').length, 1)
    assert.equal(resets, 1)
    form.values.comment = 'Replay after another action'
    await submit()
    const acknowledged = calls.filter((entry) => entry.name === 'flow.issue.comment')
    assert.notEqual(acknowledged[2].idempotencyKey, acknowledged[0].idempotencyKey)
    assert.equal(data.comments.filter((comment) => comment.text === 'Replay after another action').length, 2)
    assert.equal(resets, 2)
  } finally {
    lifetime.abort()
    island.dispose()
    globalThis.FormData = original
  }
})

test('both list clear actions reset the personal Workspace and preserve presentation and frame history', async () => {
  const previous = { location: globalThis.location, history: globalThis.history }
  try {
    for (const label of ['Xóa bộ lọc', 'Bỏ tất cả bộ lọc']) {
      globalThis.location = {
        href: 'http://flow.local/flow/my-work?lang=vi&company=demo&workspace=product&q=no-match&status=progress&workspaceFilter=lab&group=priority&sort=manual',
      }
      const state = { ketFrame: 'preserved' }
      globalThis.history = {
        state,
        replaceState(next, _, url) {
          this.state = next
          globalThis.location.href = new URL(url, globalThis.location.href).href
        },
      }
      const fixture = createOrganizationSession(),
        lifetime = new AbortController()
      const call = createFnClient({
        fetch: async (url, request) =>
          new Response(
            JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
          ),
      })
      const island = createFlowWorkspace(
        {
          screen: 'my-work',
          companyId: 'demo',
          workspaceId: 'product',
          query: 'no-match',
          status: 'progress',
        },
        { call },
      )
      const click = (node) => {
        if (!node || typeof node !== 'object') return null
        if (Array.isArray(node)) return node.map(click).find(Boolean)
        if (node.items && node.render) return click(node.items.map((item, i) => node.render(item, i)))
        if (!node.strings) return null
        if (node.strings[0].trimStart().startsWith('<button') && renderToStaticString(node).includes(label))
          return findHandler(node, '<button', 'click')
        return click(node.values)
      }
      const changeWorkspace = (node) => {
        if (!node || typeof node !== 'object') return null
        if (Array.isArray(node)) return node.map(changeWorkspace).find(Boolean)
        if (node.items && node.render)
          return changeWorkspace(node.items.map((item, i) => node.render(item, i)))
        if (!node.strings) return null
        if (
          node.strings.some((part) => part.includes('<select')) &&
          node.values.includes('Lọc theo Workspace')
        )
          return findHandler(node, '<select', 'change')
        return changeWorkspace(node.values)
      }
      try {
        island.mount({ root: root(), lifetime: lifetime.signal })
        await new Promise((resolve) => setTimeout(resolve, 0))
        changeWorkspace(island.view())({ target: { value: 'lab' } })
        const frameState = { ...globalThis.history.state }
        const clear = click(island.view())
        assert.equal(typeof clear, 'function', label)
        clear()
        const output = renderToStaticString(island.view())
        for (const name of ['Lọc theo Workspace', 'Lọc trạng thái']) {
          const select = output.match(
            new RegExp(`<select[^>]*aria-label="${name}"[^>]*>([\\s\\S]*?)</select>`),
          )
          assert.ok(select, name)
          assert.match(select[1], /<option value="all" selected/, name)
        }
        const url = new URL(globalThis.location.href)
        for (const key of ['q', 'status', 'view', 'workspaceFilter'])
          assert.equal(url.searchParams.has(key), false, key)
        assert.equal(url.searchParams.get('group'), 'priority')
        assert.equal(url.searchParams.get('sort'), 'manual')
        assert.deepEqual(globalThis.history.state, frameState)
      } finally {
        lifetime.abort()
        island.dispose()
      }
    }
  } finally {
    Object.assign(globalThis, previous)
    setFlowLocale('vi')
  }
})

test('accepted organization forms release the busy guard before closing, while a refusal retains the form', async () => {
  const saved = Object.fromEntries(['location', 'history', 'FormData'].map((key) => [key, globalThis[key]]))
  try {
    for (const refused of [true, false]) {
      globalThis.location = {
        href: 'http://flow.local/flow/member-edit?company=demo&workspace=product&id=guest&lang=vi',
      }
      globalThis.history = {
        state: {
          flowBackground: {
            screen: 'organization-members',
            url: '/flow/organization-members?company=demo&workspace=product&lang=vi',
          },
          flowModalDepth: 0,
        },
        replaceState(next, _, url) {
          this.state = next
          globalThis.location.href = new URL(url, globalThis.location.href).href
        },
      }
      globalThis.FormData = class {
        constructor(form) {
          this.entries = Object.entries(form.values)
        }
        [Symbol.iterator]() {
          return this.entries[Symbol.iterator]()
        }
      }
      const fixture = createOrganizationSession('baseline', 'member-edit')
      if (!refused)
        fixture.sessions.get('demo').data.members.find((member) => member.id === 'guest').status = 'revoked'
      const lifetime = new AbortController()
      const call = createFnClient({
        fetch: async (url, request) => {
          const name = decodeURIComponent(url.split('/').pop())
          const result =
            refused && name === 'flow.member.update'
              ? {
                  ok: true,
                  value: {
                    ok: false,
                    errors: [{ code: 'validation', message: 'Role refused' }],
                    fields: { role: 'Role refused' },
                  },
                }
              : fixture.call(name, JSON.parse(request.body))
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      })
      const island = createFlowWorkspace({ screen: 'member-edit', record: 'guest' }, { call })
      try {
        island.mount({ root: root(), lifetime: lifetime.signal })
        await new Promise((resolve) => setTimeout(resolve, 0))
        const submitForm = findHandler(island.view(), '<form id=', 'submit')
        assert.equal(typeof submitForm, 'function')
        submitForm({ preventDefault() {}, currentTarget: { values: { role: 'member' } } })
        await new Promise((resolve) => setTimeout(resolve, 0))
        const output = renderToStaticString(island.view())
        if (refused) {
          assert.match(globalThis.location.href, /member-edit/)
          assert.match(output, /id="flow-form-modal"/)
          assert.match(output, /Role refused/)
          assert.equal(
            fixture.sessions.get('demo').data.members.find((member) => member.id === 'guest').role,
            'guest',
          )
        } else {
          assert.match(globalThis.location.href, /organization-members/)
          assert.doesNotMatch(output, /id="flow-form-modal"/)
          assert.equal(
            fixture.sessions.get('demo').data.members.find((member) => member.id === 'guest').role,
            'member',
          )
          assert.equal(
            fixture.sessions.get('demo').data.members.find((member) => member.id === 'guest').status,
            'revoked',
          )
        }
      } finally {
        lifetime.abort()
        island.dispose()
      }
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})

test('revoking an invitation asks before writing; cancel, refusal and retry preserve it until accepted', async () => {
  const fixture = createOrganizationSession('baseline', 'organization-members'),
    commands = []
  const lifetime = new AbortController()
  let refuseOnce = true
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        input = JSON.parse(request.body)
      if (name === 'flow.invitation.revoke') {
        commands.push({ ...input, function: name })
        if (refuseOnce) {
          refuseOnce = false
          return new Response(
            JSON.stringify({
              ok: true,
              value: { ok: false, errors: [{ code: 'validation', message: 'Invitation refused' }] },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
      }
      return new Response(JSON.stringify(fixture.call(name, input)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const island = createFlowWorkspace({ screen: 'organization-members' }, { call })
  const click = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((child) => click(child, label)).find(Boolean)
    if (node.items && node.render)
      return click(
        node.items.map((item, i) => node.render(item, i)),
        label,
      )
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes(label))
      return findHandler(node, '<button', 'click')
    return click(node.values, label)
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(fixture.sessions.get('demo').data.invitations[0].status, 'pending')
    const open = click(island.view(), 'Thu hồi lời mời')
    assert.equal(typeof open, 'function')
    open()
    assert.match(renderToStaticString(island.view()), /role="alertdialog"/)
    assert.equal(commands.length, 0)
    click(island.view(), 'Hủy')()
    assert.doesNotMatch(renderToStaticString(island.view()), /id="flow-action-confirm"/)
    assert.equal(commands.length, 0)
    open()
    // The confirmation is the last matching revoke button; the opener only sets pendingAction.
    const buttons = []
    const collect = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(collect)
      if (node.items && node.render) return collect(node.items.map((item, i) => node.render(item, i)))
      if (node.strings?.[0].trimStart().startsWith('<button') && node.values.includes('Thu hồi lời mời'))
        buttons.push(findHandler(node, '<button', 'click'))
      if (node.values) node.values.forEach(collect)
    }
    collect(island.view())
    assert.equal(buttons.length, 2)
    buttons.at(-1)()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(commands.length, 1)
    assert.equal(commands[0].function, 'flow.invitation.revoke')
    assert.equal(fixture.sessions.get('demo').data.invitations[0].status, 'pending')
    assert.match(renderToStaticString(island.view()), /id="flow-action-confirm"/)
    assert.match(renderToStaticString(island.view()), /Invitation refused/)
    buttons.length = 0
    collect(island.view())
    buttons.at(-1)()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(commands.length, 2)
    assert.equal(commands[1].idempotencyKey, commands[0].idempotencyKey)
    assert.equal(fixture.sessions.get('demo').data.invitations[0].status, 'revoked')
    assert.doesNotMatch(renderToStaticString(island.view()), /id="flow-action-confirm"/)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})

test('members list pending invitations only and page them past the first window', async () => {
  const fixture = createOrganizationSession('baseline', 'organization-members'),
    lifetime = new AbortController(),
    d = fixture.sessions.get('demo').data,
    stamp = (n) => new Date(Date.UTC(2026, 9, 1, 8, n)).toISOString()
  d.invitations = [
    ...Array.from({ length: 55 }, (_, n) => ({
      id: `invite-${n}`,
      email: `person-${n}@example.test`,
      role: 'member',
      status: 'pending',
      projectId: null,
      sentAt: stamp(n),
    })),
    {
      id: 'invite-accepted',
      email: 'accepted@example.test',
      role: 'member',
      status: 'accepted',
      projectId: null,
      sentAt: stamp(56),
    },
    {
      id: 'invite-revoked',
      email: 'revoked@example.test',
      role: 'member',
      status: 'revoked',
      projectId: null,
      sentAt: stamp(57),
    },
  ]
  const call = createFnClient({
    fetch: async (url, request) =>
      Response.json(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
  })
  const island = createFlowWorkspace({ screen: 'organization-members' }, { call })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const click = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((child) => click(child, label)).find(Boolean)
    if (node.items && node.render)
      return click(
        node.items.map((item, i) => node.render(item, i)),
        label,
      )
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes(label))
      return findHandler(node, '<button', 'click')
    return click(node.values, label)
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await settle()
    let html = renderToStaticString(island.view())
    assert.match(html, /person-54@example\.test/, 'the newest invitation is on the first page')
    assert.doesNotMatch(html, /person-4@example\.test/, 'the oldest wait for the next page')
    assert.doesNotMatch(html, /accepted@example\.test|revoked@example\.test/)
    assert.doesNotMatch(html, /Đã thu hồi/, 'no invitation is labelled revoked')
    assert.match(html, /Đang hiển thị 50 trên 55 lời mời đang chờ/)

    // An invitation sent elsewhere invalidates the cursor; retry starts from the new first page.
    d.invitations.push({
      id: 'invite-late',
      email: 'late@example.test',
      role: 'member',
      status: 'pending',
      projectId: null,
      sentAt: stamp(58),
    })
    click(island.view(), 'Xem thêm lời mời')()
    await settle()
    assert.match(renderToStaticString(island.view()), /Invitations changed/)
    click(island.view(), 'Thử lại')()
    await settle()
    html = renderToStaticString(island.view())
    assert.match(html, /late@example\.test/)
    assert.match(html, /Đang hiển thị 50 trên 56 lời mời đang chờ/)

    click(island.view(), 'Xem thêm lời mời')()
    await settle()
    html = renderToStaticString(island.view())
    assert.match(html, /person-0@example\.test/)
    assert.match(html, /Đang hiển thị 56 trên 56 lời mời đang chờ/)
    assert.equal(click(island.view(), 'Xem thêm lời mời'), undefined, 'no more after the last page')
    assert.equal(new Set(html.match(/(person-\d+|late)@example\.test/g)).size, 56)
    assert.equal((html.match(/(person-\d+|late)@example\.test/g) ?? []).length, 56, 'each invitation once')
  } finally {
    lifetime.abort()
    island.dispose()
  }
})

test('people with access to a project come from the server and page past the first window', async () => {
  const fixture = createOrganizationSession('baseline', 'project-members'),
    lifetime = new AbortController(),
    d = fixture.sessions.get('demo').data,
    core = d.projects.find((p) => p.id === 'core'),
    template = d.members.find((m) => m.role === 'member' && m.status === 'active')
  // An internal Workspace opens an inheriting project to every internal person.
  d.workspaces.find((w) => w.id === core.workspaceId).access = 'internal'
  core.access = 'workspace'
  for (let n = 0; n < 60; n++)
    d.members.push({
      ...structuredClone(template),
      id: `access-${n}`,
      name: `Access ${String(n).padStart(2, '0')}`,
      email: `access-${n}@example.test`,
    })
  const expected = fixture.call('flow.access.list', { companyId: 'demo', scope: 'project', targetId: 'core' })
    .value.total
  assert.ok(expected > 60)
  const call = createFnClient({
    fetch: async (url, request) =>
      Response.json(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
  })
  const island = createFlowWorkspace({ screen: 'project-members', project: 'core' }, { call })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const click = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((child) => click(child, label)).find(Boolean)
    if (node.items && node.render)
      return click(
        node.items.map((item, i) => node.render(item, i)),
        label,
      )
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes(label))
      return findHandler(node, '<button', 'click')
    return click(node.values, label)
  }
  const people = (html) => html.match(/access-\d+@example\.test/g) ?? []
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await settle()
    let html = renderToStaticString(island.view())
    assert.match(html, new RegExp(`Đang hiển thị 50 trên ${expected} người có quyền truy cập`))
    assert.ok(people(html).length < 60, 'the first page is not the whole organization')

    // A person added elsewhere invalidates the cursor; retry starts from the new first page.
    d.members.push({
      ...structuredClone(template),
      id: 'access-late',
      name: 'Access late',
      email: 'late@example.test',
    })
    click(island.view(), 'Xem thêm người')()
    await settle()
    assert.match(renderToStaticString(island.view()), /Access changed/)
    click(island.view(), 'Thử lại')()
    await settle()
    html = renderToStaticString(island.view())
    assert.match(html, new RegExp(`Đang hiển thị 50 trên ${expected + 1} người có quyền truy cập`))

    for (let guard = 0; click(island.view(), 'Xem thêm người') && guard < 5; guard++) {
      click(island.view(), 'Xem thêm người')()
      await settle()
    }
    html = renderToStaticString(island.view())
    assert.match(
      html,
      new RegExp(`Đang hiển thị ${expected + 1} trên ${expected + 1} người có quyền truy cập`),
    )
    assert.equal(new Set(people(html)).size, 60, 'every added person is listed')
    assert.equal(people(html).length, 60, 'each person once')
    assert.match(html, /late@example\.test/)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})

test('Teams page past the first window of the directory', async () => {
  const fixture = createOrganizationSession('baseline', 'teams'),
    lifetime = new AbortController(),
    d = fixture.sessions.get('demo').data
  for (let n = 0; n < 105; n++)
    d.teams.push({
      id: `team-${n}`,
      companyId: d.company.id,
      title: `Team ${String(n).padStart(3, '0')}`,
      description: '',
      memberIds: [],
    })
  const call = createFnClient({
    fetch: async (url, request) =>
      Response.json(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
  })
  const island = createFlowWorkspace({ screen: 'teams' }, { call })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const click = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((child) => click(child, label)).find(Boolean)
    if (node.items && node.render)
      return click(
        node.items.map((item, i) => node.render(item, i)),
        label,
      )
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes(label))
      return findHandler(node, '<button', 'click')
    return click(node.values, label)
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await settle()
    let html = renderToStaticString(island.view())
    assert.match(html, /Đang hiển thị 100 trên 107 team/)
    assert.doesNotMatch(html, /Team 104/)
    click(island.view(), 'Xem thêm team')()
    await settle()
    html = renderToStaticString(island.view())
    assert.match(html, /Đang hiển thị 107 trên 107 team/)
    assert.match(html, /Team 104/)
    assert.equal((html.match(/Team 0\d\d/g) ?? []).length, 100, 'each Team once')
  } finally {
    lifetime.abort()
    island.dispose()
  }
})

test('a project form counts its initial access on the server, past the people window', async () => {
  const fixture = createOrganizationSession('baseline', 'project-new'),
    lifetime = new AbortController(),
    d = fixture.sessions.get('demo').data,
    template = d.members.find((m) => m.role === 'member' && m.status === 'active')
  for (const w of d.workspaces) w.access = 'internal'
  for (let n = 0; n < 150; n++)
    d.members.push({
      ...structuredClone(template),
      id: `reach-${n}`,
      name: `Reach ${String(n).padStart(3, '0')}`,
      email: `reach-${n}@example.test`,
    })
  const reads = []
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        body = JSON.parse(request.body)
      reads.push([name, body])
      return Response.json(fixture.call(name, body))
    },
  })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  for (const [screen, project, read] of [
    ['project-new', undefined, 'flow.access.preview'],
    ['project-profile', 'core', 'flow.access.list'],
  ]) {
    const island = createFlowWorkspace({ screen, project }, { call })
    try {
      island.mount({ root: root(), lifetime: lifetime.signal })
      // The form asks for its reach when it renders, as the mounted island does.
      for (let n = 0; n < 4; n++) {
        renderToStaticString(island.view())
        await settle()
      }
      const request = reads.findLast(([name]) => name === read)
      assert.ok(request, screen + ' reads its reach from the server')
      if (screen === 'project-new') assert.equal(request[1].change, 'project-create')
      const expected = fixture.call(read, request[1]).value.total
      assert.ok(expected > 100, 'more people than the loaded window')
      assert.match(
        renderToStaticString(island.view()),
        new RegExp(`${expected} người có quyền truy cập ban đầu`),
      )
    } finally {
      island.dispose()
    }
  }
  lifetime.abort()
})

test('editing the next operations form clears completed feedback without dismissing a recoverable error', async () => {
  const fixture = createOrganizationSession('baseline', 'personal-settings')
  const lifetime = new AbortController(),
    originalFormData = globalThis.FormData
  const call = createFnClient({
    fetch: async (url, request) =>
      Response.json(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
  })
  const island = createFlowWorkspace({ screen: 'personal-settings' }, { call })
  try {
    globalThis.FormData = class {
      constructor(form) {
        this.entries = Object.entries(form.values)
      }
      [Symbol.iterator]() {
        return this.entries[Symbol.iterator]()
      }
    }
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const submit = (values) =>
      findHandler(island.view(), '<form', 'submit')({ preventDefault() {}, currentTarget: { values } })
    submit({ timezone: 'Asia/Tokyo', notifications: 'none' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.match(renderToStaticString(island.view()), /data-tone="success"/)
    findHandler(island.view(), '<form', 'input')()
    assert.doesNotMatch(renderToStaticString(island.view()), /data-flow="toast"/)
    submit({ timezone: 'Invalid/Zone', notifications: 'none' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.match(renderToStaticString(island.view()), /Múi giờ không hợp lệ|Chọn múi giờ hợp lệ/)
    findHandler(island.view(), '<form', 'input')()
    assert.match(renderToStaticString(island.view()), /data-tone="error"/)
    assert.equal(fixture.sessions.get('demo').data.personalPreferences.timezone, 'Asia/Tokyo')
  } finally {
    globalThis.FormData = originalFormData
    lifetime.abort()
    island.dispose()
  }
})

test('saved view archive confirms before writing, keeps refusal recoverable and closes only after acceptance', async () => {
  const fixture = createOrganizationSession('baseline', 'saved-views'),
    commands = []
  const lifetime = new AbortController()
  let refuseOnce = true
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        input = JSON.parse(request.body)
      if (name === 'flow.view.save') {
        commands.push({ ...input, function: name })
        if (refuseOnce) {
          refuseOnce = false
          return Response.json({
            ok: true,
            value: { ok: false, errors: [{ code: 'conflict', message: 'View changed; retry' }] },
          })
        }
      }
      return Response.json(fixture.call(name, input))
    },
  })
  const island = createFlowWorkspace({ screen: 'saved-views', project: 'core' }, { call })
  const buttons = (node, label, found = []) => {
    if (!node || typeof node !== 'object') return found
    if (Array.isArray(node)) {
      node.forEach((x) => {
        buttons(x, label, found)
      })
      return found
    }
    if (node.items && node.render)
      return buttons(
        node.items.map((x, i) => node.render(x, i)),
        label,
        found,
      )
    if (node.strings?.[0].trimStart().startsWith('<button') && node.values.includes(label))
      found.push(findHandler(node, '<button', 'click'))
    node.values?.forEach((x) => {
      buttons(x, label, found)
    })
    return found
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    buttons(island.view(), 'Quản lý')[0]()
    const held = fixture.sessions.get('demo').data.views.find((v) => v.id === 'v1')
    buttons(island.view(), 'Lưu trữ view')[0]()
    assert.match(renderToStaticString(island.view()), /role="alertdialog"/)
    assert.equal(commands.length, 0)
    buttons(island.view(), 'Hủy').at(-1)()
    assert.doesNotMatch(renderToStaticString(island.view()), /id="flow-action-confirm"/)
    assert.equal(held.archived, undefined)
    buttons(island.view(), 'Lưu trữ view')[0]()
    buttons(island.view(), 'Lưu trữ view').at(-1)()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(commands.length, 1)
    assert.match(renderToStaticString(island.view()), /View changed; retry/)
    assert.equal(held.archived, undefined)
    buttons(island.view(), 'Lưu trữ view').at(-1)()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(commands.length, 2)
    assert.equal(commands[0].idempotencyKey, commands[1].idempotencyKey)
    assert.equal(held.archived, true)
    const done = renderToStaticString(island.view())
    assert.doesNotMatch(done, /id="flow-action-confirm"|id="title"|Lưu trữ view/)
    assert.match(done, /Đã lưu trữ Cần chú ý trong tuần/)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})

test('document revalidation failures keep the reading frame and retry; a denied read clears cached content', async (t) => {
  // Each navigation below comes after the window in which a screen read is shown again.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const previous = Object.fromEntries(
    ['document', 'location', 'history'].map((key) => [key, globalThis[key]]),
  )
  const fixture = createOrganizationSession('baseline', 'page')
  const initial = fixture.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    workspaceId: 'product',
    projectId: 'core',
    route: 'page',
    recordId: 'handoff',
  }).value
  const props = {
    serverShell: true,
    screen: 'page',
    companyId: 'demo',
    workspaceId: 'product',
    project: 'core',
    scope: 'project',
    record: 'handoff',
    chrome: flowShellData(initial),
  }
  let rejection = ''
  globalThis.document = Object.assign(new EventTarget(), { documentElement: {} })
  globalThis.location = new URL(
    'http://flow.local/flow/page?company=demo&workspace=product&project=core&lang=vi&id=handoff',
  )
  globalThis.history = {
    state: {},
    replaceState(state, _, url) {
      this.state = state
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  const host = Object.assign(root(), { closest: () => null, setAttribute() {} })
  const lifetime = new AbortController()
  const island = createFlowWorkspace(props, {
    call: async () => {
      if (rejection) throw new FlowApiError('Lecture indisponible', rejection)
      return initial
    },
    navigatePage: async () => {},
  })
  const navigate = async () => {
    t.mock.timers.tick(30_001)
    island.update(props)
    document.dispatchEvent(
      new CustomEvent('ket:navigation-complete', {
        detail: { url: location.href, mode: 'replace' },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const toastTemplate = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.strings?.some((text) => text.includes('data-flow="toast"'))) return node
    for (const child of Array.isArray(node) ? node : (node.values ?? [])) {
      const found = toastTemplate(child)
      if (found) return found
    }
    return null
  }
  try {
    island.mount({ root: host, lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    rejection = 'unavailable'
    await navigate()
    const failed = renderToStaticString(island.view())
    assert.equal(failed.includes('data-flow-layout="documents"'), true)
    assert.equal(failed.includes('Quy ước bàn giao'), true)
    assert.equal(failed.includes('Thử lại'), true)
    const retry = findHandler(toastTemplate(island.view()), 'data-flow="button"', 'click')
    assert.equal(typeof retry, 'function')
    rejection = ''
    await retry()
    assert.equal(renderToStaticString(island.view()).includes('Lecture indisponible'), false)
    rejection = 'forbidden'
    await navigate()
    const denied = renderToStaticString(island.view())
    assert.equal(denied.includes('data-flow-layout="documents"'), false)
    assert.equal(denied.includes('Quy ước bàn giao'), false)
    assert.equal(denied.includes('Không có quyền truy cập'), true)
  } finally {
    lifetime.abort()
    island.dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})

test('Core record forms keep one native submit action in the persistent dialog footer', async () => {
  for (const screen of [
    'project-new',
    'column-edit',
    'type-edit',
    'field-edit',
    'tag-edit',
    'sprint-new',
    'epic-new',
  ]) {
    const output = await renderScreen(screen)
    const modal = output.slice(output.indexOf('<dialog'))
    const body = modal.slice(modal.indexOf('data-flow="dialog-body"'), modal.indexOf('<footer>'))
    const formId = screen === 'project-new' ? 'flow-project-setup' : 'flow-record-form'
    assert.match(body, new RegExp(`<form id="${formId}"`), screen)
    assert.doesNotMatch(body, /type="submit"|data-flow="setup-actions"/, screen)
    assert.match(modal, new RegExp(`<footer>[\\s\\S]*type="submit" form="${formId}"`), screen)
    assert.equal((modal.match(/type="submit"/g) ?? []).length, 1, screen)
  }
})

test('project profile is a full page with one native form, project tabs and persistent actions', async () => {
  const output = await renderScreen('project-profile')
  assert.doesNotMatch(output, /<dialog|data-flow="sheet"/)
  assert.match(output, /data-content-mode="form"/)
  assert.match(output, /data-flow="project-views"/)
  assert.match(output, /data-flow="setup-form" data-layout="page"/)
  assert.equal((output.match(/type="submit"/g) ?? []).length, 1)
  assert.match(output, /type="submit" form="flow-project-setup"/)
  assert.match(output, /data-flow="setup-actions"/)
  const error = await renderScreen('project-profile', 'validation')
  assert.match(error, /data-flow="setup-feedback"/)
  assert.match(error, /data-flow="toast"[^>]*data-placement="inline"/)
  assert.equal((error.match(/data-flow="toast"/g) ?? []).length, 1)
  assert.doesNotMatch(error, /popover="manual"/)
})

test('catalog deep links hydrate field, status, type and label records instead of blank creation forms', async () => {
  const field = await renderScreen('field-edit', 'baseline', { record: 'env' }, (fixture) => {
    Object.assign(
      fixture.sessions.get('demo').data.fields.find((f) => f.id === 'env'),
      { required: true, appliesTo: 'core' },
    )
  })
  assert.match(field, /id="flow-record-field-edit-title"[^>]*name="title"[^>]*value="Môi trường"/)
  assert.match(field, /for="flow-record-field-edit-title"/)
  assert.match(field, /aria-labelledby="flow-record-field-edit-title-label"/)
  assert.match(field, /Lựa chọn · Production \/ Staging/)
  assert.match(field, /value="select" selected/)
  assert.match(field, /value="true" selected/)
  assert.match(field, /value="core" selected/)
  assert.match(
    field,
    /id="flow-record-field-edit-options"[^>]*name="options"[^>]*>\s*Production\nStaging<\/textarea>/,
  )
  const column = await renderScreen('column-edit', 'baseline', { record: 'progress' })
  assert.match(column, /id="flow-record-column-edit-title"[^>]*value="Đang thực hiện"/)
  assert.match(column, /value="progress" selected/)
  const type = await renderScreen('type-edit', 'baseline', { record: 'bug' }, (fixture) => {
    fixture.sessions.get('demo').data.types.find((t) => t.id === 'bug').icon = 'flag'
  })
  assert.match(type, /id="flow-record-type-edit-title"[^>]*value="Bug"/)
  assert.match(type, /value="flag" selected/)
  const label = await renderScreen('tag-edit', 'baseline', { record: 'risk' })
  assert.doesNotMatch(label, /id="flow-record-tag-edit-title"[^>]*value=""/)
})

test('project profile uses project administration permission and missing projects have no creation form', async () => {
  const member = await renderScreen('project-profile', 'member')
  assert.match(member, /Cần quyền quản trị dự án để sửa hồ sơ/)
  assert.match(member, /id="title"[^>]*disabled/)
  assert.match(member, /type="submit"[^>]*disabled/)
  const creation = await renderScreen('project-new', 'member')
  assert.match(creation, /Cần quyền quản trị Workspace để tạo dự án/)
  assert.match(creation, /type="submit"[^>]*disabled/)
  const missing = await renderScreen('project-profile', 'baseline', { project: 'removed-project' })
  assert.doesNotMatch(missing, /data-flow="setup-form"|type="submit"/)
})

test('project collections use the current workspace for empty state and creation permission', async () => {
  const emptyWorkspace = await renderScreen('projects', 'baseline', { workspaceId: 'lab' })
  assert.match(emptyWorkspace, /data-flow="empty"/)
  assert.doesNotMatch(emptyWorkspace, /data-flow="resource-card"/)
  const archivedWorkspace = await renderScreen(
    'projects',
    'baseline',
    { workspaceId: 'product' },
    (fixture) => {
      fixture.sessions.get('demo').data.projects.forEach((p) => {
        if (p.workspaceId === 'product') p.archived = true
      })
    },
  )
  assert.match(archivedWorkspace, /data-flow="empty"/)
  const populated = await renderScreen('projects', 'baseline', { workspaceId: 'product' }, (fixture) => {
    fixture.sessions.get('demo').data.projects.forEach((p) => {
      p.end = ''
    })
  })
  assert.match(populated, /data-flow="resource-card"/)
  assert.match(populated, /Chưa đặt ngày mục tiêu/)
  const member = await renderScreen('projects', 'member', { workspaceId: 'product' })
  assert.doesNotMatch(member, />Tạo mới<\/span>/)
})

test('missing catalog records recover without silently creating and ordinary members can only inspect', async () => {
  const missing = await renderScreen('field-edit', 'baseline', { record: 'removed-field' })
  assert.match(missing, /Hồ sơ không còn khả dụng/)
  assert.doesNotMatch(missing, /data-flow-record-form|id="flow-record-field-edit-title"/)
  const creation = await renderScreen('field-edit')
  assert.match(creation, /data-flow-record-form/)
  const member = await renderScreen('field-edit', 'member', { record: 'env' })
  assert.match(member, /Quản lý tổ chức mới có thể sửa/)
  assert.match(member, /id="flow-record-field-edit-title"[^>]*disabled/)
  assert.match(member, /name="kind"[^>]*disabled/)
  assert.match(member, /id="flow-record-field-edit-options"[^>]*disabled/)
  assert.match(member, /type="submit"[^>]*disabled/)
})

test('project-owned field forms offer only their owner in the applicability selector', async () => {
  const output = await renderScreen('field-edit', 'baseline', { record: 'env' }, (fixture) => {
    const field = fixture.sessions.get('demo').data.fields.find((field) => field.id === 'env')
    field.projectId = 'core'
    field.appliesTo = 'all'
  })
  const selector = output.match(/<select[^>]*name="appliesTo"[^>]*>[\s\S]*?<\/select>/)?.[0]
  assert.ok(selector)
  assert.equal((selector.match(/<option/g) ?? []).length, 1)
  assert.match(selector, /value="core" selected/)
})

test('label library limits archive/create/restore to managers and exposes empty and archived recovery', async () => {
  const prepare = (fixture) => {
    for (const tag of fixture.sessions.get('demo').data.tags) tag.archived = true
  }
  const manager = await renderScreen('tags', 'baseline', {}, prepare)
  assert.ok(manager.includes('Chưa có nhãn đang dùng'))
  assert.ok(manager.includes('Nhãn đã lưu trữ'))
  assert.ok(manager.includes('Khôi phục'))
  const member = await renderScreen('tags', 'member', {}, prepare)
  assert.ok(member.includes('Quản lý tổ chức mới có thể sửa'))
  assert.ok(member.includes('Nhãn đã lưu trữ'))
  assert.ok(!/Khôi phục|Thêm nhãn|>Lưu trữ</.test(member))
})

test('catalog form submission targets the existing record, retains its configuration and never duplicates missing IDs', async () => {
  const fixture = createOrganizationSession('baseline', 'field-edit')
  const lifetime = new AbortController(),
    saves = []
  const read = createFnClient({
    fetch: async (url, request) =>
      new Response(
        JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  const call = (name, input, options) =>
    name === 'flow.entity.save'
      ? new Promise((_, reject) => {
          saves.push(input)
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          })
        })
      : read(name, input, options)
  const island = createFlowWorkspace({ screen: 'field-edit', record: 'env' }, { call })
  island.mount({ root: root(), lifetime: lifetime.signal })
  await new Promise((r) => setTimeout(r, 0))
  const submitForm = findHandler(island.view(), 'data-flow-record-form', 'submit')
  assert.equal(typeof submitForm, 'function')
  const originalFormData = globalThis.FormData
  const values = {
    title: 'Môi trường triển khai',
    description: 'Các môi trường đang dùng',
    kind: 'select',
    options: 'Production\nStaging',
    required: 'false',
    appliesTo: 'all',
  }
  try {
    globalThis.FormData = class {
      constructor(form) {
        this.entries = Object.entries(form.values)
      }
      [Symbol.iterator]() {
        return this.entries[Symbol.iterator]()
      }
    }
    submitForm({ preventDefault() {}, currentTarget: { values } })
  } finally {
    globalThis.FormData = originalFormData
  }
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(saves.length, 1)
  assert.equal(saves[0].entityId, 'env')
  const count = fixture.sessions.get('demo').data.fields.length
  const typed = resolveFlowCommand('flow.entity.save', saves[0])
  const reverse = atlasFlowCommand(typed.name, typed.input)
  assert.equal(fixture.call(reverse.name, reverse.input).value.id, 'env')
  const held = fixture.sessions.get('demo').data.fields.find((f) => f.id === 'env')
  assert.equal(fixture.sessions.get('demo').data.fields.length, count)
  assert.equal(held.title, values.title)
  assert.deepEqual(held.options, ['Production', 'Staging'])
  assert.equal(held.kind, 'select')
  assert.equal(held.required, false)
  assert.equal(held.appliesTo, 'all')
  const missing = fixture.call('flow.entity.save', {
    ...reverse.input,
    entityId: 'removed-field',
    idempotencyKey: 'missing-catalog',
  })
  assert.equal(missing.value.ok, false)
  assert.equal(fixture.sessions.get('demo').data.fields.length, count)
  lifetime.abort()
  island.dispose()
})

test('renaming a built-in status keeps its workflow kind and displays the new literal label', async () => {
  const output = await renderScreen('column-edit', 'baseline', { record: 'progress' }, (fixture) => {
    const response = fixture.call('flow.entity.save', {
      companyId: 'demo',
      collection: 'columns',
      entityId: 'progress',
      title: 'Đang kiểm chứng',
      kind: 'progress',
      idempotencyKey: 'rename-status',
    })
    assert.equal(response.value.id, 'progress')
    const column = fixture.sessions.get('demo').data.columns.find((c) => c.id === 'progress')
    assert.equal(column.kind, 'progress')
    assert.equal(column.labelKey, undefined)
  })
  assert.match(output, /id="flow-record-column-edit-title"[^>]*value="Đang kiểm chứng"/)
})

test('dropping a file on the task uploads its bytes, saves the reference and opens an in-place preview', async () => {
  const fixture = createOrganizationSession('baseline', 'issue'),
    lifetime = new AbortController(),
    uploads = [],
    saves = []
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        input = JSON.parse(request.body)
      if (name === 'flow.attachment.save') saves.push({ input, uploadsSoFar: uploads.length })
      return new Response(JSON.stringify(fixture.call(name, input)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const upload = async (file) => {
    uploads.push(file.name)
    return { ok: true, uploadId: '0f8fad5b-d9cb-469f-a165-70867728950e' }
  }
  const island = createFlowWorkspace({ screen: 'issue', record: 'KV-142' }, { call, upload })
  island.mount({ root: root(), lifetime: lifetime.signal })
  await new Promise((r) => setTimeout(r, 0))
  const drop = findHandler(island.view(), 'data-flow="file-drop"', 'drop')
  assert.equal(typeof drop, 'function')
  drop({
    preventDefault() {},
    stopPropagation() {},
    currentTarget: { dataset: {} },
    dataTransfer: { files: [new File(['x'], 'Ảnh.png', { type: 'image/png' })] },
  })
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(uploads, ['Ảnh.png'])
  assert.equal(saves.length, 1)
  assert.equal(saves[0].uploadsSoFar, 1)
  assert.equal(saves[0].input.files[0].uploadId, '0f8fad5b-d9cb-469f-a165-70867728950e')
  const out = renderToStaticString(island.view())
  assert.match(out, /<img src="\/_ket\/files\/0f8fad5b-d9cb-469f-a165-70867728950e"/)
  assert.doesNotMatch(out, /flow-file-preview/)
  findHandler(island.view(), 'data-flow="attachment-thumb"', 'click')()
  const preview = renderToStaticString(island.view())
  assert.match(preview, /id="flow-file-preview"[\s\S]*data-flow="media-preview"/)
  lifetime.abort()
  island.dispose()
})

test('workspace members keep search in the sidebar and the grant action in the topbar', async () => {
  const output = await renderScreen('workspace-members', 'baseline', {
    workspaceId: 'product',
    companyId: 'demo',
  })
  const header = output.match(/<header data-flow="shell-header"[\s\S]*?<\/header>/)?.[0] ?? ''
  assert.doesNotMatch(header, /search-trigger|shell-search|type="search"/)
  assert.match(output, /<aside data-flow="shell-sidebar"[^>]*>[\s\S]*data-flow="search-trigger"/)
  assert.match(header, /data-flow="shell-actions">[\s\S]*data-variant="primary"/)
  assert.doesNotMatch(output.slice(output.indexOf(header) + header.length), /type="search"/)
})

test('core has no GitHub routes, task links or integration navigation', async () => {
  for (const key of ['github', 'atlas', 'workspace-integrations', 'organization-integrations'])
    assert.equal(routes[key], undefined)
  for (const key of ['issue', 'settings', 'organization', 'workspace-settings', 'workspace-overview']) {
    const output = await renderScreen(key, 'connected')
    assert.doesNotMatch(
      output,
      /github-url|\/flow\/(?:github|atlas|workspace-integrations|organization-integrations)(?:[?"/])/i,
      key,
    )
  }
})

test('core does not register or advertise the Gantt view', async () => {
  assert.equal(routes.gantt, undefined)
  assert.doesNotMatch(await renderScreen('board'), /data-value="gantt"/)
})

test('core retains intake forms without automation routes or tools', async () => {
  assert.equal(routes.automations, undefined)
  assert.ok(routes.forms)
  assert.match(await renderScreen('forms'), /data-flow="section"/)
  assert.doesNotMatch(await renderScreen('settings'), /\/flow\/automations|Tự động hóa/)
})

test('core overview and sprint report do not require paid components', async () => {
  assert.equal(routes['epic-map'], undefined)
  assert.ok(routes['sprint-report'])
  assert.match(await renderScreen('workspace-overview'), /data-flow="quality-columns"/)
  assert.doesNotMatch(await renderScreen('epic'), /\/flow\/epic-map/)
})
test('list rows build a picker only while its menu is open, one row menu at a time', async () => {
  const fixture = createOrganizationSession('baseline', 'all-issues'),
    lifetime = new AbortController()
  const call = createFnClient({
    fetch: async (url, request) =>
      new Response(
        JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
  })
  const island = createFlowWorkspace({ screen: 'all-issues' }, { call })
  // Finds the `event` handler of the popover whose id is `menuId`.
  const handlerOf = (node, menuId, event) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((x) => handlerOf(x, menuId, event)).find(Boolean) ?? null
    if (node.items && node.render)
      return handlerOf(
        node.items.map((x, i) => node.render(x, i)),
        menuId,
        event,
      )
    if (!node.strings) return null
    const at = node.values.indexOf(menuId)
    if (at >= 0)
      for (let i = at; i < node.values.length; i++)
        if (node.strings[i].endsWith(`on:${event}=`)) return node.values[i]
    return handlerOf(node.values, menuId, event)
  }
  const show = (id) => handlerOf(island.view(), id, 'beforetoggle')({ newState: 'open' })
  // The browser hides a popover (beforetoggle) and returns focus before the toggle event.
  const hide = (id) => {
    handlerOf(island.view(), id, 'beforetoggle')({ newState: 'closed' })
    const hiding = renderToStaticString(island.view())
    handlerOf(island.view(), id, 'toggle')({ newState: 'closed' })
    return hiding
  }
  const options = (out) => (out.match(/data-flow="(choice-option|user-option)"|type="date"/g) ?? []).length
  // Options rendered inside one menu: from its opening tag to the menu's closing </div>.
  const inMenu = (out, id) => {
    const start = out.indexOf(`id="${id}"`)
    return options(out.slice(start, out.indexOf('</div>', start)))
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const closed = renderToStaticString(island.view())
    const ids = [...closed.matchAll(/popovertarget="([^"]+-status-[^"]+-menu)"/g)].map((m) => m[1])
    assert.ok(ids.length > 1)
    assert.equal(options(closed), 0)
    show(ids[0])
    assert.match(renderToStaticString(island.view()), /aria-busy="true"/)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const first = renderToStaticString(island.view())
    assert.ok(inMenu(first, ids[0]) > 1)
    assert.equal(options(first), inMenu(first, ids[0]))
    // Options stay while hiding so the focused option is not removed before focus returns.
    assert.equal(inMenu(hide(ids[0]), ids[0]), inMenu(first, ids[0]))
    assert.equal(options(renderToStaticString(island.view())), 0)
    // Light dismiss: the first menu's toggle event arrives after the second one opened.
    show(ids[0])
    handlerOf(island.view(), ids[0], 'beforetoggle')({ newState: 'closed' })
    show(ids[1])
    await new Promise((resolve) => setTimeout(resolve, 0))
    handlerOf(island.view(), ids[0], 'toggle')({ newState: 'closed' })
    const second = renderToStaticString(island.view())
    assert.equal(inMenu(second, ids[0]), 0)
    assert.ok(inMenu(second, ids[1]) > 1)
    assert.equal(options(second), inMenu(second, ids[1]))
    hide(ids[1])
    assert.equal(options(renderToStaticString(island.view())), 0)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('board columns show a bounded page, keep the total and keep a dropped card in view', async () => {
  const fixture = createOrganizationSession('baseline', 'board'),
    data = fixture.sessions.get('demo').data
  const sample = data.tasks.find((t) => t.projectId === 'core' && t.status === 'todo' && !t.archived)
  for (let i = 0; i < 45; i++)
    data.tasks.push({ ...sample, id: `KV-9${String(i).padStart(2, '0')}`, order: 1e6 + i, blockedBy: [] })
  const calls = [],
    lifetime = new AbortController()
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        args = JSON.parse(request.body)
      if (name !== 'flow.workspace.bootstrap') calls.push({ name, ...args })
      return new Response(JSON.stringify(fixture.call(name, args)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const island = createFlowWorkspace({ screen: 'board', project: 'core' }, { call })
  // Board columns in render order with their header total, drop handler and card ids.
  const columns = () => {
    const found = []
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      if (node.items && node.render) {
        for (const [i, x] of node.items.entries()) walk(node.render(x, i))
        return
      }
      if (!node.strings) return
      if (node.strings[0].includes('data-flow="board-column"')) {
        const at = (suffix) => node.values[node.strings.findIndex((s) => s.endsWith(suffix))]
        const out = renderToStaticString(node)
        found.push({
          total: at('<small>'),
          drop: at('on:flowtaskdrop='),
          cards: [...out.matchAll(/data-flow="task-card-drag" data-task-id="([^"]+)"/g)].map((m) => m[1]),
          out,
        })
        return
      }
      node.values.forEach(walk)
    }
    walk(island.view())
    return found
  }
  const button = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((x) => button(x, label)).find(Boolean) ?? null
    if (node.items && node.render)
      return button(
        node.items.map((x, i) => node.render(x, i)),
        label,
      )
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes(label))
      return findHandler(node, '<button', 'click')
    return button(node.values, label)
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const total = data.tasks.filter(
      (t) => t.projectId === 'core' && t.status === 'todo' && !t.archived,
    ).length
    let todo = columns().find((c) => c.total === total)
    assert.ok(todo, 'the todo column header keeps the full total')
    assert.equal(todo.cards.length, 20)
    assert.match(todo.out, new RegExp(`Xem thêm… \\(20 · còn ${total - 20}\\)`))
    button(island.view(), `Xem thêm… (20 · còn ${total - 20})`)()
    todo = columns().find((c) => c.total === total)
    assert.equal(todo.cards.length, 40)
    button(island.view(), 'Thu gọn')()
    todo = columns().find((c) => c.total === total)
    assert.equal(todo.cards.length, 20)
    // A card dropped at the bottom of a cut column lands after the last shown card and stays shown.
    const moving = data.tasks.find((t) => t.projectId === 'core' && t.status === 'progress' && !t.archived)
    await todo.drop({ detail: { id: moving.id, position: 'after' }, stopPropagation() {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const reorder = calls.find((c) => c.name === 'flow.issue.reorder')
    assert.equal(reorder?.targetId, todo.cards.at(-1))
    assert.equal(reorder.position, 'after')
    todo = columns().find((c) => c.total === total + 1)
    assert.equal(todo.cards.length, 21)
    assert.equal(todo.cards.at(-1), moving.id)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('re-rendering a large list reuses the task model instead of scanning every task', async () => {
  const fixture = createOrganizationSession('baseline', 'all-issues'),
    lifetime = new AbortController()
  let reads = 0
  // Counts every task property read: a scan reads at least one on each of 2,000+ tasks.
  const call = async (name, args) => {
    const { value: result } = JSON.parse(JSON.stringify(fixture.call(name, args)))
    if (name !== 'flow.workspace.bootstrap') return result
    const sample = result.tasks.find((t) => t.projectId === 'core' && !t.archived)
    for (let i = 0; i < 2000; i++)
      result.tasks.push({ ...sample, id: `KV-X${i}`, order: 1e6 + i, blockedBy: [] })
    result.tasks = result.tasks.map(
      (task) =>
        new Proxy(task, {
          get(target, key) {
            reads++
            return target[key]
          },
        }),
    )
    return result
  }
  const island = createFlowWorkspace({ screen: 'all-issues' }, { call })
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const first = renderToStaticString(island.view())
    assert.ok(reads >= 2000, `loading and the first render scan the tasks (${reads})`)
    reads = 0
    assert.equal(renderToStaticString(island.view()), first)
    assert.ok(reads < 1500, `a re-render only reads the shown rows (${reads})`)
    assert.match(first, /Tổng công việc[\s\S]*?>20\d\d</)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('a task outside the loaded page still reads detail before opening its editor', async () => {
  const fixture = createOrganizationSession('baseline', 'all-issues'),
    lifetime = new AbortController()
  const calls = []
  const call = async (name, args) => {
    calls.push(name)
    const listArgs =
      name === 'flow.workspace.bootstrap' ? { ...args, route: 'all-issues', recordId: undefined } : args
    const { value } = JSON.parse(JSON.stringify(fixture.call(name, listArgs)))
    if (name === 'flow.workspace.bootstrap') value.tasks = value.tasks.filter((t) => t.id !== 'KV-142')
    return value
  }
  const island = createFlowWorkspace({ screen: 'issue', record: 'KV-142' }, { call })
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const output = renderToStaticString(island.view())
    assert.equal(calls.filter((name) => name === 'flow.issue.detail').length, 1)
    assert.doesNotMatch(output, /Công việc không tồn tại/)
    assert.ok(output.includes('data-flow="live-doc"'), output.slice(-900))
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('a task opened from a screen read loads its body and discussion before offering the editor', async () => {
  const fixture = createOrganizationSession('baseline', 'all-issues'),
    lifetime = new AbortController(),
    raw = fixture.sessions.get('demo').data,
    id = 'KV-142',
    comment = raw.comments.find((c) => c.taskId === id)
  assert.ok(raw.tasks.find((t) => t.id === id).description && comment)
  const details = []
  // The list read is what the open screen already holds; the record comes from the detail read.
  const call = async (name, args) => {
    if (name === 'flow.issue.detail') {
      const pending = Promise.withResolvers()
      details.push(pending)
      await pending.promise
    }
    const listArgs =
      name === 'flow.workspace.bootstrap' ? { ...args, route: 'all-issues', recordId: undefined } : args
    const { value } = JSON.parse(JSON.stringify(fixture.call(name, listArgs)))
    return value
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const retry = (node) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(retry).find(Boolean) ?? null
    if (node.items && node.render) return retry(node.items.map((x, i) => node.render(x, i)))
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes('Thử lại'))
      return findHandler(node, '<button', 'click')
    return retry(node.values)
  }
  const island = createFlowWorkspace({ screen: 'issue', record: id }, { call })
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await tick()
    assert.equal(details.length, 1, 'the summary asks for its record once')
    let html = renderToStaticString(island.view())
    assert.match(html, /Đang tải mô tả và thảo luận/)
    assert.doesNotMatch(html, /data-flow="live-doc"/, 'no editor over a body not read yet')
    details[0].reject(Object.assign(new Error('offline'), { code: 'unavailable' }))
    await tick()
    html = renderToStaticString(island.view())
    assert.match(html, /Chưa tải được mô tả và thảo luận/)
    assert.doesNotMatch(html, /data-flow="live-doc"/)
    retry(island.view())()
    assert.equal(details.length, 2)
    assert.match(renderToStaticString(island.view()), /Đang tải mô tả và thảo luận/)
    details[1].resolve()
    await tick()
    html = renderToStaticString(island.view())
    assert.doesNotMatch(html, /Đang tải mô tả và thảo luận|Chưa tải được/)
    assert.match(html, /data-flow="live-doc"/)
    assert.ok(html.includes(comment.text), 'the discussion arrives with the record')
    assert.equal(details.length, 2, 'a loaded record is not read again on re-render')
  } finally {
    lifetime.abort()
    island.dispose()
  }
})
test('clearing a search shows the tasks again from the loaded data without a new read', async () => {
  const fixture = createOrganizationSession('baseline', 'all-issues'),
    lifetime = new AbortController()
  let reads = 0
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop())
      if (name === 'flow.workspace.bootstrap') reads++
      return new Response(JSON.stringify(fixture.call(name, JSON.parse(request.body))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const oldLocation = globalThis.location,
    oldHistory = globalThis.history
  // The controller captures history when created; the location is only needed to clear.
  globalThis.history = { state: null, replaceState() {}, pushState() {} }
  const island = createFlowWorkspace({ screen: 'all-issues', query: 'zzz-no-task' }, { call })
  const clear = (node) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(clear).find(Boolean) ?? null
    if (node.items && node.render) return clear(node.items.map((x, i) => node.render(x, i)))
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes('Bỏ tất cả bộ lọc'))
      return findHandler(node, '<button', 'click')
    return clear(node.values)
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.doesNotMatch(renderToStaticString(island.view()), /data-flow="task-row"/)
    globalThis.location = { href: 'http://127.0.0.1/flow/all-issues?q=zzz-no-task' }
    clear(island.view())()
    assert.match(renderToStaticString(island.view()), /data-flow="task-row"/)
    assert.equal(reads, 1)
  } finally {
    globalThis.location = oldLocation
    globalThis.history = oldHistory
    lifetime.abort()
    island.dispose()
  }
})

test('a loaded organization controller accepts shell-only member navigation before its primary read', async () => {
  await import('@ketvietlab/flow-client/organization.mjs')
  const fixture = createOrganizationSession('baseline', 'workspace-overview')
  const chrome = flowShellData(
    fixture.call('flow.workspace.bootstrap', {
      shellOnly: true,
      route: 'workspace-overview',
      companyId: 'demo',
      workspaceId: 'product',
    }).value,
  )
  const props = {
    screen: 'workspace-overview',
    serverShell: true,
    companyId: 'demo',
    workspaceId: 'product',
    chrome,
  }
  const call = createFnClient({
    fetch: async (url, request) =>
      new Response(
        JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
        { headers: { 'content-type': 'application/json' } },
      ),
  })
  const island = createFlowWorkspace(props, { call }),
    lifetime = new AbortController()
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(chrome.members.length, 1, 'shell carries only actor access metadata')
    const next = { ...props, screen: 'workspace-members' }
    const server = createFlowWorkspace(next)
    try {
      assert.doesNotThrow(() => island.update(next))
      assert.equal(
        renderToStaticString(island.shellView(null)),
        renderToStaticString(server.shellView(null)),
        'loaded controller must match the fresh SSR chrome until the primary read',
      )
    } finally {
      server.dispose()
    }
    assert.doesNotThrow(() => renderToStaticString(island.view()))
  } finally {
    lifetime.abort()
    island.dispose()
  }
})

test('opening task creation from a standalone inbox reads catalogs before rendering the form', async () => {
  const previous = {
    location: globalThis.location,
    history: globalThis.history,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  }
  globalThis.location = new URL('http://flow.local/flow/inbox?company=demo&workspace=product&lang=en')
  globalThis.history = {
    state: {},
    replaceState(state, _, url) {
      this.state = state
      if (url) globalThis.location.href = new URL(url, globalThis.location.href).href
    },
    pushState(state, _, url) {
      this.replaceState(state, _, url)
    },
  }
  globalThis.requestAnimationFrame = (fn) => {
    fn()
    return 0
  }
  setFlowLocale('en')
  const fixture = createOrganizationSession(),
    lifetime = new AbortController(),
    requests = []
  let release
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        input = JSON.parse(request.body)
      if (name === 'flow.workspace.bootstrap') {
        requests.push(input.route)
        if (input.route === 'issue-new')
          await new Promise((resolve) => {
            release = resolve
          })
      }
      return Response.json(fixture.call(name, input))
    },
  })
  const island = createFlowWorkspace({ screen: 'inbox', workspaceId: 'product' }, { call })
  const button = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map((child) => button(child, label)).find(Boolean)
    if (node.items && node.render)
      return button(
        node.items.map((item, i) => node.render(item, i)),
        label,
      )
    if (!node.strings) return null
    if (node.strings[0].trimStart().startsWith('<button') && node.values.includes(label))
      return findHandler(node, '<button', 'click')
    return button(node.values, label)
  }
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const create = button(island.view(), 'Create task')
    assert.equal(typeof create, 'function')
    create()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(requests, ['inbox', 'issue-new'])
    assert.doesNotMatch(renderToStaticString(island.view()), /id="flow-task-create"/)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.match(renderToStaticString(island.view()), /id="flow-task-create"/)
  } finally {
    release?.()
    lifetime.abort()
    island.dispose()
    Object.assign(globalThis, previous)
    setFlowLocale('vi')
  }
})

test('status filter retains the referenced state outside the bootstrap catalog window', async () => {
  const fixture = createOrganizationSession('baseline', 'all-issues'),
    lifetime = new AbortController()
  const call = async (name, args) => {
    const { value } = JSON.parse(JSON.stringify(fixture.call(name, args)))
    if (name === 'flow.workspace.bootstrap') {
      value.columns = []
      value.tasks = value.tasks
        .filter((task) => !task.archived)
        .slice(0, 1)
        .map((task) => ({
          ...task,
          status: 'outside-window',
          statusDefinition: {
            id: 'outside-window',
            label: 'Referenced review',
            kind: 'review',
            color: 'yellow',
          },
        }))
    }
    return value
  }
  const island = createFlowWorkspace({ screen: 'all-issues' }, { call })
  try {
    island.mount({ root: root(), lifetime: lifetime.signal })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const output = renderToStaticString(island.view())
    assert.match(output, /<option[^>]*value="outside-window"[^>]*>Referenced review<\/option>/)
  } finally {
    lifetime.abort()
    island.dispose()
  }
})

test('organization library renders paging and hydrates an edit beyond its first catalog window', async () => {
  const prepare = (fixture) => {
    const raw = fixture.sessions.get('demo').data
    for (let i = 0; i < 205; i++)
      raw.types.push({
        id: `library-${i}`,
        title: `Library ${i}`,
        sequence: 2000 + i,
        version: 1,
        icon: 'list',
        color: 'neutral',
      })
  }
  const list = await renderScreen('organization-settings', 'baseline', {}, prepare)
  assert.match(list, /Library 0/)
  assert.doesNotMatch(list, /Library 204/)
  assert.match(list, /50/)
  const edit = await renderScreen('type-edit', 'baseline', { record: 'library-204' }, prepare)
  assert.match(edit, /value="Library 204"/)
})
