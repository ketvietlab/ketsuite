import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, signal } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganization } from '@ketvietlab/flow-client/organization.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
setFlowLocale('en')
const setup = ({
  canWrite = true,
  record = 'bao',
  params = { accessScope: 'workspace', target: 'product' },
  errors = {},
  route = 'workspace-members',
} = {}) => {
  const session = createOrganizationSession('baseline', undefined, { profile: 'realistic' }),
    data = session.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      route: 'workspace-members',
      workspaceId: 'product',
    }).value,
    nav = [],
    mutations = [],
    confirms = [],
    calls = []
  const org = createOrganization({
    data: signal(data),
    workspaceId: () => 'product',
    projectId: () => null,
    route: () => route,
    record: () => record,
    params: () => params,
    canWrite: () => canWrite,
    formError: () => errors,
    busy: () => false,
    mutate: (_fn, args) => mutations.push(args),
    // Reads go to the same Atlas session the bootstrap came from, as the browser's would.
    call: async (name, args) => {
      calls.push([name, args])
      const value = session.call(name, { companyId: 'demo', ...args }).value
      if (value?.ok === false) throw Object.assign(new Error(value.errors[0].message), value.errors[0])
      return value
    },
    navigate: (key, params) => nav.push([key, params]),
    close: () => {},
    isModal: () => true,
    switchWorkspace: () => {},
    confirmAction: (request) => confirms.push(request),
  })
  return { data, nav, mutations, confirms, calls, org }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
// The member modal reads that person's access when its route is prepared.
const memberModal = async (options = {}) => {
  const state = setup({ route: 'member-access', ...options })
  state.org.prepare()
  await tick()
  return state
}
test('organization forms associate server field errors with the native editable control', () => {
  const { org } = setup({
    errors: { title: 'Enter a name with content.', description: 'Keep the description shorter.' },
  })
  const output = renderToStaticString(org.modal('workspace-new'))
  assert.match(output, /id="title"[^>]*aria-invalid="true"[^>]*aria-describedby="title-error"/)
  assert.match(output, /id="title-error"[^>]*>Enter a name with content\./)
  assert.match(output, /id="description"[^>]*aria-invalid="true"[^>]*aria-describedby="description-error"/)
  assert.match(output, /id="description-error"[^>]*>Keep the description shorter\./)
  // A new Workspace defaults to the restricted value the native server accepts.
  assert.match(output, /<option value="restricted"[^>]*selected/)
  assert.doesNotMatch(output, /value="private"/)
})

const handlers = (node, marker, event, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const x of node) handlers(x, marker, event, out)
    return out
  }
  if (node.items && node.render)
    return handlers(
      node.items.map((x, i) => node.render(x, i)),
      marker,
      event,
      out,
    )
  if (!node.strings) return out
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
      out.push(node.values[i])
    else handlers(node.values[i], marker, event, out)
  }
  return out
}

test('members render as one table row per person with access, with no section header repeating the workspace', () => {
  const { data, org } = setup(),
    html = renderToStaticString(org.view('workspace-members'))
  const rows = html.match(/<tr data-open="true"/g) ?? []
  assert.equal(rows.length, 15)
  assert.match(html, /15 with access · 9 in the organization without access/)
  assert.equal(data.members.filter((m) => m.status === 'active').length, 24)
  assert.match(
    html,
    /<th scope="col" data-size="wide">Member<\/th><th scope="col">Access here<\/th><th scope="col">Access via<\/th><th scope="col">Teams<\/th><th scope="col">Organization role<\/th>/,
  )
  assert.match(
    html,
    /<span data-flow="evidence-person"><button[^>]*title="Trần Quốc Bảo"[\s\S]*?<small>bao@example\.test<\/small>/,
  )
  assert.doesNotMatch(
    html,
    /<header>|<h2>|Sản phẩm|type="search"/,
    'the workspace is already in the topbar; no section header repeats it',
  )
  assert.doesNotMatch(html, /data-flow="disclosure"|data-flow="notice"/)
})

test('clicking a row, its name or its button opens that person in the access modal', () => {
  const { nav, org } = setup()
  const view = org.view('workspace-members')
  const rowOpen = handlers(view, '<tr', 'click'),
    nameOpen = handlers(view, '<button type="button" title=', 'click')
  const names = [...renderToStaticString(view).matchAll(/<button type="button" title="([^"]+)"/g)].map(
    (m) => m[1],
  )
  const bao = names.indexOf('Trần Quốc Bảo'),
    mai = names.indexOf('Mai Anh')
  assert.ok(bao >= 0 && mai >= 0)
  rowOpen[bao]({ target: { closest: () => null } })
  assert.deepEqual(nav.pop(), ['member-access', { id: 'bao', accessScope: 'workspace', target: 'product' }])
  rowOpen[bao]({ target: { closest: () => ({}) } })
  assert.equal(nav.length, 0, 'a click on a control inside the row is left to that control')
  nameOpen[mai]()
  assert.deepEqual(nav.pop(), ['member-access', { id: 'mai', accessScope: 'workspace', target: 'product' }])
})

test('the member modal explains every source and scopes each change to that person', async () => {
  const { org, nav, mutations, confirms, calls } = await memberModal(),
    html = renderToStaticString(org.modal('member-access'))
  assert.match(html, /Trần Quốc Bảo · bao@example\.test/)
  assert.match(html, /Workspace · Team Engineering/)
  assert.match(html, /Team grant · applies to all 15 people in Engineering/)
  assert.match(html, /Remove for the whole team/)
  assert.deepEqual(calls.at(-1), [
    'flow.access.list',
    { companyId: 'demo', scope: 'workspace', targetId: 'product', memberId: 'bao', limit: 1 },
  ])
  handlers(org.modal('member-access'), 'data-flow="button"', 'click').find(
    (_, i, all) => i === all.length - 1,
  )()
  assert.deepEqual(nav.pop(), ['access-grant', { accessScope: 'workspace', target: 'product', user: 'bao' }])
  const remove = handlers(org.modal('member-access'), 'data-flow="button"', 'click')[0]
  remove()
  assert.equal(mutations.length, 0, 'revoking access asks for confirmation first')
  const confirm = confirms.pop()
  assert.equal(confirm.tone, 'danger')
  confirm.action()
  assert.equal(mutations.pop().action, 'access.revoke')
})

test('read-only viewers can open a member but get no changes, and an unknown person is explained', async () => {
  assert.match(
    renderToStaticString(setup({ canWrite: false }).org.view('workspace-members')),
    />\s*View\s*<\/button>/,
  )
  const { org } = await memberModal({ canWrite: false })
  const html = renderToStaticString(org.modal('member-access'))
  assert.doesNotMatch(html, /Remove for the whole team|Grant more access|Organization role &amp; work hours/)
  assert.match(
    renderToStaticString((await memberModal({ record: 'ghost' })).org.modal('member-access')),
    /Member not found/,
  )
})

test('granting more access from a member starts with that member selected', () => {
  const pick = (params) =>
    renderToStaticString(setup({ params }).org.modal('access-grant')).match(
      /data-flow="tag-selection">([\s\S]*?)<\/div>/,
    )?.[1] ?? ''
  const vy = setup().data.members.find((m) => m.name === 'Nguyễn Thảo Vy').id
  assert.match(pick({ accessScope: 'workspace', target: 'product', user: vy }), /Nguyễn Thảo Vy/)
  assert.doesNotMatch(pick({ accessScope: 'workspace', target: 'product' }), /Nguyễn Thảo Vy/)
})

test('the prefilled member is the one actually granted when the form is submitted', () => {
  const { org, data, mutations } = setup({
    params: { accessScope: 'workspace', target: 'product', user: 'bao' },
  })
  const submit = handlers(org.modal('access-grant'), '<form', 'submit')[0]
  const saved = globalThis.FormData
  globalThis.FormData = class {
    *[Symbol.iterator]() {
      yield ['scope', 'workspace']
      yield ['targetId', 'product']
      yield ['subjectType', 'user']
      yield ['role', 'viewer']
    }
  }
  try {
    submit({ preventDefault() {}, currentTarget: {} })
  } finally {
    globalThis.FormData = saved
  }
  assert.deepEqual(mutations.pop()?.subjectIds, ['bao'])
  assert.ok(data.members.some((m) => m.id === 'bao'))
})

test('the grant action sits in the shell topbar and people are found through the sidebar Spotlight', () => {
  const { org, nav } = setup()
  assert.doesNotMatch(
    renderToStaticString(org.view('workspace-members')),
    /data-variant="primary"|type="search"/,
  )
  assert.match(
    renderToStaticString(org.topAction('workspace-members')),
    /data-variant="primary"[\s\S]*Grant permissions/,
  )
  handlers(org.topAction('workspace-members'), 'data-flow="button"', 'click')[0]()
  assert.deepEqual(nav.pop(), ['access-grant', { accessScope: 'workspace', target: 'product' }])
  assert.equal(setup({ canWrite: false }).org.topAction('workspace-members'), null)
  assert.equal(org.topAction('organization-members'), null)
})

test('changing project access previews, from the server, who gains or loses it', async () => {
  const session = createOrganizationSession('baseline', undefined, { profile: 'realistic' }),
    raw = session.sessions.get('demo').data,
    rawCore = raw.projects.find((p) => p.id === 'core')
  // An inheriting project in an internal Workspace: restricting it is a real loss for some.
  raw.workspaces.find((w) => w.id === rawCore.workspaceId).access = 'internal'
  rawCore.access = 'workspace'
  const data = session.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      route: 'project-members',
      projectId: 'core',
    }).value,
    core = data.projects.find((p) => p.id === 'core'),
    next = 'private',
    calls = []
  const org = createOrganization({
    data: signal(data),
    workspaceId: () => core.workspaceId,
    projectId: () => 'core',
    route: () => 'project-members',
    record: () => null,
    params: () => ({}),
    canWrite: () => true,
    formError: () => ({}),
    busy: () => false,
    mutate: () => {},
    call: async (name, args) => {
      calls.push([name, args])
      const value = session.call(name, { companyId: 'demo', ...args }).value
      if (value?.ok === false) throw Object.assign(new Error(value.errors[0].message), value.errors[0])
      return value
    },
    navigate: () => {},
    close: () => {},
    isModal: () => false,
    switchWorkspace: () => {},
    confirmAction: () => {},
  })
  const expected = session.call('flow.access.preview', {
    companyId: 'demo',
    change: 'project-access',
    projectId: 'core',
    access: next,
  }).value
  assert.ok(expected.items.length > 0)
  handlers(org.view('project-members'), '<select', 'change')[0]({ target: { value: next } })
  assert.match(renderToStaticString(org.view('project-members')), /Preparing preview/)
  await tick()
  const html = renderToStaticString(org.view('project-members'))
  assert.deepEqual(calls.at(-1), [
    'flow.access.preview',
    { companyId: 'demo', change: 'project-access', projectId: 'core', access: next },
  ])
  for (const row of expected.items) assert.ok(html.includes(row.name), row.name)
  assert.doesNotMatch(html, /Preparing preview/)
})
