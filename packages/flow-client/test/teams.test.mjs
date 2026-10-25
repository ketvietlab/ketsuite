import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, signal } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganization } from '@ketvietlab/flow-client/organization.mjs'
import { accessFor } from '@ketvietlab/flow-client/access-model.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
setFlowLocale('en')

// A Team larger than one page of people, read through the same Atlas session as the browser.
const setup = ({ extra = 60, canWrite = true } = {}) => {
  const session = createOrganizationSession('baseline', undefined, { profile: 'realistic' }),
    d = session.sessions.get('demo').data,
    template = d.members.find((m) => m.role === 'member' && m.status === 'active'),
    team = d.teams.find((t) => t.id === 'engineering')
  for (let n = 0; n < extra; n++) {
    d.members.push({
      ...structuredClone(template),
      id: `crew-${n}`,
      name: `Crew ${String(n).padStart(2, '0')}`,
      email: `crew-${n}@example.test`,
    })
    team.memberIds.push(`crew-${n}`)
  }
  const data = signal(
      session.call('flow.workspace.bootstrap', { companyId: 'demo', route: 'team', recordId: 'engineering' })
        .value,
    ),
    calls = [],
    mutations = []
  const org = createOrganization({
    data,
    workspaceId: () => 'product',
    projectId: () => null,
    route: () => 'team',
    record: () => 'engineering',
    params: () => ({}),
    canWrite: () => canWrite,
    formError: () => ({}),
    busy: () => false,
    mutate: (_fn, args) => mutations.push(args),
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
  return { session, d, data, team, org, calls, mutations }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
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

test('the bootstrap ships Team sizes and each person’s Teams, never a Team’s membership', () => {
  const { data, team } = setup()
  const shipped = data().teams.find((t) => t.id === 'engineering')
  assert.equal(shipped.memberCount, team.memberIds.length)
  assert.ok(!('memberIds' in shipped))
  assert.ok(data().teams.every((t) => !('memberIds' in t)))
  assert.deepEqual(data().user.teamIds, ['engineering', 'success'])
  assert.ok(data().members.every((m) => Array.isArray(m.teamIds)))
  assert.deepEqual(data().teamPage, { total: 2, cursor: null, loadedIds: ['success', 'engineering'] })
})

test('access through a Team is still known on the client from each person’s Team ids', () => {
  const { session, data } = setup({ extra: 0 })
  let checked = 0
  for (const project of data().projects)
    for (const person of data().members) {
      const server = session.call('flow.access.list', {
        companyId: 'demo',
        scope: 'project',
        targetId: project.id,
        memberId: person.id,
      }).value.items[0]
      if (!server?.access.role || server.access.sources.some((x) => !x.teamId)) continue
      // Only a Team opens this project to this person, and the client agrees on the role.
      assert.equal(
        accessFor(data(), project, person.id).role,
        server.access.role,
        `${person.id} ${project.id}`,
      )
      checked++
    }
  assert.ok(checked > 0, 'the fixture has people reaching a project only through a Team')
})

test('a Team reads its size, scopes and people from the server, page by page', async () => {
  const { org, calls, team } = setup()
  assert.match(renderToStaticString(org.view('team')), /Opening Flow/)
  org.prepare()
  await tick()
  assert.deepEqual(
    calls.map(([name, args]) => [name, args.id ?? args.teamId]),
    [
      ['flow.team.read', 'engineering'],
      ['flow.member.list', 'engineering'],
    ],
  )
  let html = renderToStaticString(org.view('team'))
  const total = team.memberIds.length
  assert.match(html, new RegExp(`Showing 50 of ${total} members`))
  assert.match(html, /Crew 00/)
  assert.doesNotMatch(html, /Crew 59/, 'the first page is not the whole Team')
  // Scopes come from team.read with their titles, not from the loaded projects.
  assert.match(html, /An toàn và quyền truy cập/)
  button(org.view('team'), 'More members')()
  await tick()
  html = renderToStaticString(org.view('team'))
  assert.doesNotMatch(html, /More members/)
  assert.match(html, /Crew 59/)
  assert.equal(new Set(html.match(/Crew \d\d/g)).size, 60, 'every added person is listed once')
  assert.equal(calls.at(-1)[1].cursor !== undefined, true, 'the next page continues from the cursor')
})

test('people who could join a Team are searched on the server and the chosen one is added', async () => {
  const { org, calls, mutations, team } = setup()
  org.prepare()
  await tick()
  // The leave guard compares a form's named fields; picking someone must not change them, or a
  // picker reset after the save would read as an unsaved draft.
  const fields = () =>
    [
      ...(renderToStaticString(org.view('team'))
        .match(/<form[\s\S]*?<\/form>/)?.[0]
        .matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"[^>]*>/g) ?? []),
    ].map((m) => m[0])
  const pristine = fields()
  handlers(org.view('team'), 'data-flow="choice-menu"', 'beforetoggle')[0]({ newState: 'open' })
  await tick()
  const read = calls.find(([name, args]) => name === 'flow.member.list' && args.candidateForTeamId)
  assert.equal(read[1].candidateForTeamId, 'engineering')
  const html = renderToStaticString(org.view('team'))
  const offered = [...html.matchAll(/data-flow="choice-option"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1])
  assert.ok(offered.length > 0)
  assert.ok(!offered.some((name) => name.startsWith('Crew')), 'members of the Team are not offered')
  const popover = { hidePopover() {}, parentElement: { querySelector: () => null } },
    saved = { FormData: globalThis.FormData, HTMLElement: globalThis.HTMLElement }
  globalThis.HTMLElement = class {}
  globalThis.FormData = class {
    *[Symbol.iterator]() {}
  }
  try {
    handlers(org.view('team'), 'data-flow="choice-option"', 'click')[0]({
      currentTarget: { closest: () => popover },
    })
    // The browser reports the popover closed once the option hid it.
    handlers(org.view('team'), 'data-flow="choice-menu"', 'toggle')[0]({ newState: 'closed' })
    assert.deepEqual(fields(), pristine, 'the pick is not a form field')
    handlers(org.view('team'), '<form', 'submit')[0]({ preventDefault() {}, currentTarget: {} })
  } finally {
    Object.assign(globalThis, saved)
  }
  const added = mutations.pop()
  assert.equal(added.action, 'team.member')
  assert.equal(added.id, 'engineering')
  assert.ok(added.memberId && !team.memberIds.includes(added.memberId))
})

test('a Team that is gone explains itself instead of loading forever', async () => {
  const { org, d } = setup({ extra: 0 })
  d.teams.find((t) => t.id === 'engineering').archived = true
  org.prepare()
  await tick()
  assert.match(renderToStaticString(org.view('team')), /Team not found/)
})
