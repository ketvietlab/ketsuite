import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOperations } from '@ketvietlab/flow-client/operations.mjs'
import { createTaskComposer } from '@ketvietlab/flow-client/task-composer.mjs'
import { createDocuments } from '@ketvietlab/flow-client/documents.mjs'
import { resolveFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
setFlowLocale('en')

// People pickers search the server, through the same Atlas session the browser uses; the
// bootstrap carries only the actor's grants, so no picker filters a loaded people window.
const reads = (session) => {
  const calls = []
  const call = async (name, args) => {
    calls.push([name, args])
    const value = session.call(name, { companyId: 'demo', ...args }).value
    if (value?.ok === false) throw Object.assign(new Error(value.errors[0].message), value.errors[0])
    return value
  }
  return { calls, call }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
// The handler for an event on the innermost template that owns it and renders this text.
const own = (node, text, event) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.map((x) => own(x, text, event)).find(Boolean) ?? null
  if (node.items && node.render)
    return own(
      node.items.map((x, i) => node.render(x, i)),
      text,
      event,
    )
  if (!node.strings) return null
  const inner = node.values.map((x) => own(x, text, event)).find(Boolean)
  if (inner) return inner
  const index = node.strings.findIndex((part) => part.endsWith(`on:${event}=`))
  return index >= 0 && renderToStaticString(node).includes(text) ? node.values[index] : null
}
const offered = (html) =>
  [...html.matchAll(/data-flow="choice-option"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1])
// An option's click needs only the popover it closes.
const choose = (node, label) => {
  const saved = globalThis.HTMLElement
  globalThis.HTMLElement = class {}
  try {
    own(
      node,
      `aria-label="${label}"`,
      'click',
    )({
      currentTarget: { closest: () => ({ hidePopover() {}, parentElement: { querySelector: () => null } }) },
    })
  } finally {
    globalThis.HTMLElement = saved
  }
}

test('an intake form’s recipient is searched among internal people on the server and posted by id', async () => {
  const session = createOrganizationSession(),
    data = session.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      projectId: 'core',
      route: 'forms',
    }).value,
    { calls, call } = reads(session)
  const operations = createOperations({
    data: () => data,
    projectId: () => 'core',
    workspaceId: () => 'product',
    canWrite: () => true,
    busy: () => false,
    formError: () => ({}),
    requestLeave: (action) => action(),
    mutate: (name, args) => mutations.push([name, args]),
    call,
  })
  const mutations = []
  own(operations.view('forms'), 'Create form', 'click')()
  let html = renderToStaticString(operations.view('forms'))
  assert.match(html, /<input type="hidden" name="assigneeId" value="mai"/, 'the actor receives by default')
  assert.equal(calls.length, 0, 'nothing is read until the picker opens')
  own(operations.view('forms'), 'id="form-recipient-menu"', 'beforetoggle')({ newState: 'open' })
  await tick()
  assert.deepEqual(calls[0], [
    'flow.member.options',
    { query: '', cursor: undefined, limit: 25, companyId: 'demo', projectId: 'core', internal: true },
  ])
  html = renderToStaticString(operations.view('forms'))
  const names = session.call('flow.member.options', { companyId: 'demo', projectId: 'core', internal: true })
    .value.items
  assert.deepEqual(
    offered(html),
    names.map((m) => m.name),
  )
  const other = names.find((m) => m.id !== 'mai')
  choose(operations.view('forms'), other.name)
  assert.match(
    renderToStaticString(operations.view('forms')),
    new RegExp(`<input type="hidden" name="assigneeId" value="${other.id}"`),
  )
  // Saving sends the command's own arguments: field rows travel as `fields`, never as inputs.
  const form = renderToStaticString(operations.view('forms')).match(
    /<form[^>]*>(?:(?!<\/form>)[\s\S])*name="assigneeId"[\s\S]*?<\/form>/,
  )[0]
  const named = [...form.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"/g)].map((m) => m[1])
  assert.ok(
    named.some((name) => name.startsWith('field-')),
    'the field rows are inputs of the form',
  )
  const values = { assigneeId: other.id, title: 'Requests', publish: 'yes' },
    saved = globalThis.FormData
  globalThis.FormData = class {
    *[Symbol.iterator]() {
      for (const name of named) yield [name, values[name] ?? '']
    }
  }
  try {
    own(operations.view('forms'), 'name="assigneeId"', 'submit')({ preventDefault() {}, currentTarget: {} })
  } finally {
    globalThis.FormData = saved
  }
  const command = resolveFlowCommand(...mutations.at(-1))
  assert.equal(command.name, 'flow.form.save')
  // The native schema of flow.form.save refuses any other argument.
  const accepted = [
    'companyId',
    'workspaceId',
    'projectId',
    'id',
    'idempotencyKey',
    'expectedVersion',
    'expectedRevision',
    'title',
    'description',
    'fields',
    'access',
    'assigneeId',
    'priority',
    'publish',
  ]
  assert.deepEqual(
    Object.keys(command.input).filter((key) => !accepted.includes(key)),
    [],
  )
  assert.equal(command.input.assigneeId, other.id)
  assert.equal(command.input.fields.length, 1)
})

test('changing a new task’s project asks the server which chosen people may stay', async () => {
  const session = createOrganizationSession(),
    data = session.call('flow.workspace.bootstrap', { companyId: 'demo' }).value,
    { calls, call } = reads(session)
  const eligible = (projectId) =>
    session
      .call('flow.member.options', { companyId: 'demo', projectId, limit: 100 })
      .value.items.map((m) => m.id)
  // Someone who can open core but not docs.
  const leaving = eligible('core').find((id) => id !== 'mai' && !eligible('docs').includes(id))
  assert.ok(leaving)
  const name = data.members.find((m) => m.id === leaving).name
  const composer = createTaskComposer({
    data: () => data,
    project: () => 'core',
    companyId: () => 'demo',
    route: () => 'issue-new',
    record: () => '',
    canWrite: () => true,
    errors: () => ({}),
    create: () => {},
    call,
    userPickerProps: () => ({ options: data.members.map((m) => ({ id: m.id, name: m.name })) }),
  })
  await composer.prepare()
  own(composer.view(), `aria-label="${name}"`, 'change')({ currentTarget: { checked: true } })
  const chosen = () =>
    renderToStaticString(composer.view()).match(/data-flow="user-picker-trigger"[^>]*aria-label="([^"]+)"/)[1]
  assert.match(chosen(), new RegExp(name))
  own(composer.view(), 'id="projectId-menu"', 'beforetoggle')({ newState: 'open' })
  await tick()
  const docs = data.projects.find((p) => p.id === 'docs').title
  assert.ok(offered(renderToStaticString(composer.view())).includes(docs))
  choose(composer.view(), docs)
  await tick()
  await tick()
  const recheck = calls.find(([fn, args]) => fn === 'flow.member.options' && args.ids)
  assert.deepEqual(recheck, [
    'flow.member.options',
    { companyId: 'demo', projectId: 'docs', ids: ['mai', leaving], limit: 100 },
  ])
  assert.doesNotMatch(chosen(), new RegExp(name), 'a person the new project does not admit is dropped')
  assert.match(chosen(), /Mai Anh/)
})

test('document readers are searched on the server and chosen readers keep their names', async () => {
  const session = createOrganizationSession(),
    raw = session.sessions.get('demo').data,
    page = raw.pages.find((p) => p.projectId === 'core')
  page.visibility = 'private'
  page.readerIds = ['bao']
  // Hà and Vy read the project too; the chosen reader’s name sorts between theirs.
  raw.members.push({
    id: 'vy',
    name: 'Vũ Hải Vy',
    email: 'vy@example.test',
    role: 'member',
    status: 'active',
  })
  for (const id of ['ha', 'vy'])
    raw.grants.push({
      id: `g-${id}-core`,
      scope: 'project',
      targetId: 'core',
      subjectType: 'user',
      subjectId: id,
      role: 'viewer',
    })
  const data = session.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    route: 'page',
    recordId: page.id,
    projectId: 'core',
  }).value
  assert.deepEqual(
    data.pages.find((p) => p.id === page.id).readers,
    [{ id: 'bao', name: raw.members.find((m) => m.id === 'bao').name }],
    'the owner of the open page reads its readers by name',
  )
  // A reader outside the loaded people is still named.
  data.members = data.members.filter((m) => m.id !== 'bao')
  const { calls, call } = reads(session)
  const documents = (record, project) =>
    createDocuments({
      data: () => data,
      screen: () => 'page',
      record: () => record,
      project: () => project,
      workspaceId: () => 'product',
      canWrite: () => true,
      busy: () => false,
      documentReturn: () => '/flow/all-pages',
      libraryVisibility: () => 'all',
      libraryURL: () => '/flow/all-pages',
      // The shell around the page is not under test.
      projectActions: () => null,
      projectViews: () => null,
      managementViews: () => null,
      sidebar: () => null,
      notices: () => null,
      root: () => null,
      mutate: () => {},
      navigate: () => {},
      call,
    })
  const docs = documents(page.id, 'core')
  own(docs.view('page'), 'Information', 'click')()
  let html = renderToStaticString(docs.view('page'))
  assert.match(html, /id="document-readers"/)
  assert.match(html, new RegExp(raw.members.find((m) => m.id === 'bao').name))
  own(docs.view('page'), 'id="document-readers-menu"', 'beforetoggle')({ newState: 'open' })
  await tick()
  assert.deepEqual(
    [calls.at(-1)[0], calls.at(-1)[1].projectId],
    ['flow.member.options', 'core'],
    'a project page’s readers are people who can open the project',
  )
  html = renderToStaticString(docs.view('page'))
  assert.doesNotMatch(
    html.match(/id="document-readers-menu"[\s\S]*$/)[0],
    /aria-label="Mai Anh"/,
    'the owner is not offered',
  )
  // A chosen reader keeps their place in the read and their email: choosing moves no row.
  const menu = html.match(/id="document-readers-menu"[\s\S]*$/)[0],
    served = session
      .call('flow.member.options', { companyId: 'demo', ...calls.at(-1)[1] })
      .value.items.filter((m) => m.id !== page.ownerId)
  assert.deepEqual(
    served.map((m) => m.id),
    ['ha', 'bao', 'vy'],
    'the chosen reader is neither first nor last in the read',
  )
  const rows = menu.split('data-flow="user-option"').slice(1)
  assert.deepEqual(
    rows.map((row) => served.find((m) => row.includes(`aria-label="${m.name}"`))?.id),
    served.map((m) => m.id),
    'people are offered once each, in the order of the read',
  )
  assert.match(
    rows[served.findIndex((m) => m.id === 'bao')],
    /bao@example\.test/,
    'the chosen reader keeps their email',
  )
  const shared = data.pages.find((p) => !p.projectId)
  const workspacePage = documents(shared.id, null)
  own(workspacePage.view('page'), 'Information', 'click')()
  own(workspacePage.view('page'), 'id="document-readers-menu"', 'beforetoggle')({ newState: 'open' })
  await tick()
  assert.deepEqual(
    [calls.at(-1)[0], calls.at(-1)[1].scope, calls.at(-1)[1].targetId],
    ['flow.access.list', 'workspace', shared.workspaceId],
    'a Workspace page’s readers are people who can open the Workspace',
  )
})
