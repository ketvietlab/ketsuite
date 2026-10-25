import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, signal } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganization } from '@ketvietlab/flow-client/organization.mjs'
import { accessFor } from '@ketvietlab/flow-client/access-model.mjs'
import { mutationFeedback } from '@ketvietlab/flow-client/mutation-feedback.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
setFlowLocale('en')

// Organization forms read what they state about everyone from the server, through the same
// Atlas session the browser uses; the bootstrap carries only the actor's own grants.
const setup = ({ route, record = null, params = {}, before = () => {}, fail = () => null } = {}) => {
  const session = createOrganizationSession('baseline', undefined, { profile: 'realistic' }),
    raw = session.sessions.get('demo').data
  before(raw)
  const data = signal(
      session.call('flow.workspace.bootstrap', {
        companyId: 'demo',
        route,
        workspaceId: 'product',
        ...(record ? { recordId: record } : {}),
      }).value,
    ),
    calls = [],
    mutations = []
  const org = createOrganization({
    data,
    workspaceId: () => 'product',
    projectId: () => null,
    route: () => route,
    record: () => record,
    recordProvided: () => Boolean(record),
    params: () => params,
    canWrite: () => true,
    formError: () => ({}),
    busy: () => false,
    mutate: (_fn, args, success) => mutations.push([args, success]),
    call: async (name, args) => {
      calls.push([name, args])
      const refused = fail(name, args)
      if (refused) throw Object.assign(new Error(refused), { code: 'unavailable' })
      const value = session.call(name, { companyId: 'demo', ...args }).value
      if (value?.ok === false) throw Object.assign(new Error(value.errors[0].message), value.errors[0])
      return value
    },
    navigate: () => {},
    close: () => {},
    isModal: () => true,
    switchWorkspace: () => {},
    confirmAction: () => {},
  })
  return { session, raw, data, org, calls, mutations }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
// The handler for an event on an element whose open tag carries this marker.
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
    handlers(node.values[i], marker, event, out)
  }
  return out
}
// The change handler of the innermost element rendering this field name.
const change = (node, name) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.map((x) => change(x, name)).find(Boolean) ?? null
  if (node.items && node.render)
    return change(
      node.items.map((x, i) => node.render(x, i)),
      name,
    )
  if (!node.strings) return null
  const inner = node.values.map((x) => change(x, name)).find(Boolean)
  if (inner) return inner
  const index = node.strings.findIndex((part) => part.endsWith('on:change='))
  return index >= 0 && renderToStaticString(node).includes(`name="${name}"`) ? node.values[index] : null
}
// The click handler of the button whose label is exactly this text.
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
    return handlers(node, '<button', 'click')[0]
  return node.values.map((x) => button(x, label)).find(Boolean) ?? null
}
const internalPerson = (n) => ({
  id: `crew-${n}`,
  name: `Crew ${String(n).padStart(3, '0')}`,
  email: `crew-${n}@example.test`,
  role: 'member',
  status: 'active',
  version: 1,
})
// Named form fields, as the leave guard compares them.
const fields = (html) =>
  [...html.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"[^>]*>/g)].map((m) => m[0]).sort()

test('the bootstrap ships only the actor’s grants; a target’s or a person’s are read page by page', () => {
  const { session, raw, data } = setup({
    route: 'workspace-members',
    before: (d) => {
      for (let n = 0; n < 7; n++)
        d.grants.push({
          id: `extra-${n}`,
          scope: 'project',
          targetId: 'core',
          subjectType: 'user',
          subjectId: `person-${n}`,
          role: 'viewer',
        })
    },
  })
  const own = data().user.teamIds
  assert.ok(data().grants.length > 0)
  assert.ok(
    data().grants.every((g) =>
      g.subjectType === 'user' ? g.subjectId === data().user.id : own.includes(g.subjectId),
    ),
    'no other person’s grant ships',
  )
  assert.ok(raw.grants.length > data().grants.length)
  // A target's grants, a page at a time, add up to what the server stores.
  const ids = []
  let cursor
  do {
    const page = session.call('flow.grant.list', {
      companyId: 'demo',
      scope: 'project',
      targetId: 'core',
      limit: 3,
      ...(cursor ? { cursor } : {}),
    }).value
    ids.push(...page.items.map((g) => g.id))
    cursor = page.cursor
  } while (cursor)
  assert.deepEqual(
    ids,
    raw.grants
      .filter((g) => g.scope === 'project' && g.targetId === 'core')
      .map((g) => g.id)
      .sort(),
  )
  const first = session.call('flow.grant.list', {
    companyId: 'demo',
    scope: 'project',
    targetId: 'core',
    limit: 2,
  }).value
  assert.equal(
    first.items[0].subjectTitle,
    raw.members.find((m) => m.id === first.items[0].subjectId)?.name ?? first.items[0].subjectTitle,
  )
  // A grant changing in between makes the held cursor stale.
  raw.organizationRevision++
  assert.equal(
    session.call('flow.grant.list', {
      companyId: 'demo',
      scope: 'project',
      targetId: 'core',
      limit: 2,
      cursor: first.cursor,
    }).value.errors[0].code,
    'conflict',
  )
  // Reading by subject is for organization managers, and people about themselves.
  const member = createOrganizationSession('member')
  const read = (subjectId) =>
    member.call('flow.grant.list', { companyId: 'demo', subjectType: 'user', subjectId }).value
  const self = member.sessions.get('demo').data.user.id
  assert.notEqual(read(self).ok, false)
  assert.equal(read(self === 'bao' ? 'ha' : 'bao').errors[0].code, 'forbidden')
})

test('the Workspace form counts internal people and inheriting projects on the server', async () => {
  const extra = 130
  const { raw, data, org, calls } = setup({
    route: 'workspace-edit',
    before: (d) => {
      for (let n = 0; n < extra; n++) d.members.push(internalPerson(n))
    },
  })
  // A screen loads a window of projects, never the organization's.
  data.set({ ...data(), projects: data().projects.slice(0, 1) })
  assert.match(renderToStaticString(org.modal('workspace-edit')), /Counting the projects and people/)
  org.prepare()
  await tick()
  assert.deepEqual(
    calls.map(([name, args]) => [name, args.internal ?? args.access]),
    [
      ['flow.member.list', true],
      ['flow.project.options', 'workspace'],
    ],
  )
  const people = raw.members.filter((m) => m.role !== 'guest' && m.status === 'active').length,
    projects = raw.projects.filter(
      (p) => p.workspaceId === 'product' && !p.archived && p.access === 'workspace',
    ).length
  assert.ok(people > 100, 'more people than one loaded page')
  assert.match(
    renderToStaticString(org.modal('workspace-edit')),
    new RegExp(
      `${projects} inherited projects will use workspace permissions\\. Internal access allows ${people} organization members`,
    ),
  )
})

test('a Workspace count that cannot be read says so and can be retried', async () => {
  let down = true
  const { org, calls } = setup({
    route: 'workspace-new',
    fail: (name) => (down && name === 'flow.member.list' ? 'down' : null),
  })
  org.prepare()
  await tick()
  assert.match(renderToStaticString(org.modal('workspace-new')), /could not be counted/)
  assert.doesNotMatch(renderToStaticString(org.modal('workspace-new')), /Internal access allows/)
  org.prepare()
  await tick()
  assert.equal(
    calls.filter(([name]) => name === 'flow.member.list').length,
    1,
    'a failed read is not repeated on its own',
  )
  down = false
  button(org.modal('workspace-new'), 'Try again')()
  await tick()
  assert.match(
    renderToStaticString(org.modal('workspace-new')),
    /0 inherited projects will use workspace permissions/,
  )
})

test('revoking a person shows the server’s count of projects and unfinished tasks, the first 20 named', async () => {
  const { session, raw, org, calls } = setup({ route: 'member-edit', record: 'bao' })
  org.prepare()
  await tick()
  assert.ok(calls.some(([name, args]) => name === 'flow.member.impact' && args.memberId === 'bao'))
  const impact = session.call('flow.member.impact', { companyId: 'demo', memberId: 'bao' }).value
  // The mock server counts with the whole directory, as the native server does.
  assert.equal(
    impact.projects,
    raw.projects.filter((p) => !p.archived && accessFor(raw, p, 'bao').role).length,
  )
  assert.ok(impact.tasks.total > 20, 'more unfinished tasks than are named')
  const html = renderToStaticString(org.modal('member-edit'))
  assert.match(html, new RegExp(`Access to ${impact.projects} projects will be removed`))
  assert.match(html, new RegExp(`${impact.tasks.total} unfinished tasks`))
  for (const t of impact.tasks.items) assert.ok(html.includes(t.title), t.id)
  assert.match(html, new RegExp(`${impact.tasks.total - 20} more unfinished tasks are not listed here`))
})

test('a guest’s projects are read by subject, and a project to add is searched on the server', async () => {
  const { raw, org, calls, mutations } = setup({ route: 'member-edit', record: 'guest' })
  org.prepare()
  await tick()
  const read = calls.find(([name]) => name === 'flow.grant.list')
  assert.deepEqual(read[1], {
    companyId: 'demo',
    subjectType: 'user',
    subjectId: 'guest',
    scope: 'project',
    limit: 50,
  })
  const granted = raw.grants.filter((g) => g.subjectId === 'guest' && g.scope === 'project')
  let html = renderToStaticString(org.modal('member-edit'))
  for (const g of granted) assert.ok(html.includes(raw.projects.find((p) => p.id === g.targetId).title))
  const pristine = fields(html)
  handlers(org.modal('member-edit'), 'data-flow="choice-menu"', 'beforetoggle')[0]({ newState: 'open' })
  await tick()
  assert.ok(calls.some(([name]) => name === 'flow.project.options'))
  html = renderToStaticString(org.modal('member-edit'))
  const offered = [...html.matchAll(/data-flow="choice-option"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1])
  assert.ok(offered.length > 0)
  for (const g of granted)
    assert.ok(
      !offered.includes(raw.projects.find((p) => p.id === g.targetId).title),
      'a granted project is not offered',
    )
  const saved = { HTMLElement: globalThis.HTMLElement, FormData: globalThis.FormData }
  globalThis.HTMLElement = class {}
  globalThis.FormData = class {
    *[Symbol.iterator]() {}
  }
  try {
    handlers(org.modal('member-edit'), 'data-flow="choice-option"', 'click')[0]({
      currentTarget: { closest: () => ({ hidePopover() {}, parentElement: { querySelector: () => null } }) },
    })
    // The browser reports the popover closed once the option hid it.
    handlers(org.modal('member-edit'), 'data-flow="choice-menu"', 'toggle')[0]({ newState: 'closed' })
    assert.deepEqual(
      fields(renderToStaticString(org.modal('member-edit'))),
      pristine,
      'the pick is not a form field',
    )
    const submits = handlers(org.modal('member-edit'), '<form', 'submit')
    submits.at(-1)({ preventDefault() {}, currentTarget: {} })
  } finally {
    Object.assign(globalThis, saved)
  }
  const [args] = mutations.pop()
  assert.equal(args.action, 'access.grant')
  assert.equal(args.subjectIds[0], 'guest')
  assert.equal(raw.projects.find((p) => p.id === args.targetId).title, offered[0])
})

test('granting access searches people, Teams and projects on the server', async () => {
  const { org, calls } = setup({ route: 'access-grant' })
  const open = (marker) =>
    handlers(org.modal('access-grant'), marker, 'beforetoggle')[0]({ newState: 'open' })
  open('data-flow="tag-menu"')
  await tick()
  assert.deepEqual(calls.at(-1)[0], 'flow.member.list')
  assert.equal(calls.at(-1)[1].internal, true, 'a Workspace is for internal people')
  let html = renderToStaticString(org.modal('access-grant'))
  assert.ok([...html.matchAll(/data-flow="tag-option"/g)].length > 0)
  // A project may be granted to guests too, so it searches every active person.
  change(org.modal('access-grant'), 'scope')({ target: { value: 'project' } })
  open('data-flow="tag-menu"')
  await tick()
  assert.equal(calls.at(-1)[0], 'flow.member.list')
  assert.equal(calls.at(-1)[1].active, true)
  assert.equal(calls.at(-1)[1].internal, undefined)
  html = renderToStaticString(org.modal('access-grant'))
  assert.match(html, /<input type="hidden" name="targetId" value=""/)
  assert.match(html, /type="submit"[^>]*disabled/, 'nothing to grant on yet')
  open('data-flow="choice-menu"')
  await tick()
  assert.deepEqual(
    [calls.at(-1)[0], calls.at(-1)[1].manage],
    ['flow.project.options', true],
    'only projects whose access the actor may change',
  )
  change(org.modal('access-grant'), 'subjectType')({ target: { value: 'team' } })
  open('data-flow="tag-menu"')
  await tick()
  assert.equal(calls.at(-1)[0], 'flow.team.list')
})

test('a person preselected for a grant is named even outside the loaded people', async () => {
  const extra = 120
  const { org, calls } = setup({
    route: 'access-grant',
    params: { accessScope: 'workspace', target: 'product', user: `crew-${extra - 1}` },
    before: (d) => {
      for (let n = 0; n < extra; n++) d.members.push(internalPerson(n))
    },
  })
  assert.match(renderToStaticString(org.modal('access-grant')), /Loading…/)
  org.prepare()
  await tick()
  assert.deepEqual(calls[0], [
    'flow.member.list',
    { companyId: 'demo', ids: [`crew-${extra - 1}`], limit: 1 },
  ])
  assert.match(
    renderToStaticString(org.modal('access-grant')).match(
      /data-flow="tag-selection">([\s\S]*?)<\/div>/,
    )?.[1] ?? '',
    new RegExp(`Crew ${String(extra - 1).padStart(3, '0')}`),
  )
})

test('the access page of a person outside the loaded people still opens them', () => {
  const session = createOrganizationSession('baseline', undefined, { profile: 'realistic' }),
    raw = session.sessions.get('demo').data
  for (let n = 0; n < 120; n++) raw.members.push(internalPerson(n))
  const read = (route) =>
    session.call('flow.workspace.bootstrap', { companyId: 'demo', route, recordId: 'crew-119' }).value
  assert.ok(read('member-access').members.some((m) => m.id === 'crew-119'))
  assert.ok(
    !read('organization-members').members.some((m) => m.id === 'crew-119'),
    'the window alone stops short',
  )
})

test('granting access reports the grant, never its internal id as a name', () => {
  const input = {
    scope: 'workspace',
    targetId: 'product',
    subjectType: 'user',
    subjectIds: ['bao', 'ha'],
    role: 'editor',
  }
  for (const [name, args, value] of [
    // Native answers with the grant ids; Atlas routes the same command through the organization command.
    ['flow.access.grant', input, { ok: true, id: 'grant-uuid', ids: ['grant-uuid', 'grant-two'] }],
    ['flow.organization.command', { action: 'access.grant', ...input }, { ok: true }],
  ])
    assert.equal(mutationFeedback(name, args, value, { tasks: [] }).message, 'Access granted')
})
