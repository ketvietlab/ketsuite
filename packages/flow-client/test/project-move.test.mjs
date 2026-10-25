import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganization } from '@ketvietlab/flow-client/organization.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

setFlowLocale('en')

// Exercise the real presenter's public controls without a simulated browser.
function control(node, event, text) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = control(child, event, text)
      if (found) return found
    }
    return
  }
  if (node.items && node.render)
    return control(
      node.items.map((item, i) => node.render(item, i)),
      event,
      text,
    )
  if (!node.strings) return
  const index = node.strings.findIndex((part) => part.endsWith(`on:${event}=`))
  if (index >= 0 && renderToStaticString(node).includes(text)) return node.values[index]
  return control(node.values, event, text)
}

function setup() {
  const data = createOrganizationSession().call('flow.workspace.bootstrap', { companyId: 'demo' }).value
  const reads = []
  const org = createOrganization({
    data: () => data,
    workspaceId: () => 'product',
    projectId: () => 'core',
    record: () => null,
    params: () => ({}),
    canWrite: () => true,
    busy: () => false,
    isModal: () => true,
    close: () => {},
    call: (name, args) => new Promise((resolve, reject) => reads.push({ name, args, resolve, reject })),
  })
  const view = () => org.modal('project-move')
  const change = (name, value) => control(view(), 'change', `name="${name}"`)({ target: value })
  const preview = () => control(view(), 'click', 'Preview impact')()
  return { org, reads, view, change, preview, output: () => renderToStaticString(view()) }
}

test('destination and access choice participate in the native draft; old preview cannot authorize a new choice', async () => {
  const { change, preview, reads, output } = setup()
  assert.match(output(), /<form/)
  assert.match(output(), /name="targetWorkspaceId"/)
  assert.match(output(), /name="preserveAccess"/)
  change('targetWorkspaceId', { value: 'operations' })
  const first = preview()
  assert.equal(reads[0].args.targetWorkspaceId, 'operations')
  change('targetWorkspaceId', { value: 'lab' })
  reads[0].resolve({ revision: 7, people: [] })
  await first
  assert.match(output(), /Preview before confirming/)
  assert.doesNotMatch(output(), /Preparing preview/)
  const second = preview()
  assert.equal(reads[1].args.targetWorkspaceId, 'lab')
  reads[1].resolve({ revision: 8, people: [] })
  await second
  assert.doesNotMatch(output(), /Preview before confirming/)
  change('preserveAccess', { checked: true })
  assert.match(output(), /Preview before confirming/)
  const third = preview()
  assert.equal(reads[2].args.preserve, true)
  reads[2].resolve({ revision: 9, people: [] })
  await third
  assert.doesNotMatch(output(), /Preview before confirming/)
})

test('closing during a preview resets progress; a late failure cannot leak into the next form', async () => {
  const { org, change, preview, reads, output } = setup()
  change('targetWorkspaceId', { value: 'operations' })
  const pending = preview()
  assert.match(output(), /Preparing preview/)
  org.reset()
  assert.doesNotMatch(output(), /Preparing preview/)
  reads[0].reject(new Error('Late response from the previous form'))
  await pending
  assert.doesNotMatch(output(), /Late response|Preparing preview/)
  assert.match(output(), /Preview before confirming/)
})

test('a long impact pages from the server and names a retained grant', async () => {
  const { change, preview, reads, output, view } = setup()
  change('targetWorkspaceId', { value: 'operations' })
  const retained = {
    role: 'editor',
    scope: 'project',
    grantId: null,
    teamId: null,
    teamTitle: null,
    teamMemberCount: null,
    retained: true,
  }
  const row = (n) => ({
    id: 'p' + n,
    name: 'Person ' + n,
    before: { role: 'editor', sources: [] },
    after: { role: 'editor', sources: [retained] },
    change: 'same',
  })
  const first = preview()
  reads[0].resolve({
    revision: 7,
    people: [row(1)],
    total: 2,
    summary: { loss: 0, gain: 0, same: 2 },
    cursor: 'next',
  })
  await first
  assert.match(output(), /Direct · retained when moved/)
  assert.match(output(), /Showing 1 of 2/)
  const more = control(view(), 'click', 'Show more')()
  assert.equal(reads[1].args.cursor, 'next')
  assert.equal(reads[1].args.targetWorkspaceId, 'operations')
  reads[1].resolve({
    revision: 7,
    people: [row(2)],
    total: 2,
    summary: { loss: 0, gain: 0, same: 2 },
    cursor: null,
  })
  await more
  assert.match(output(), /Person 1[\s\S]*Person 2/)
  assert.doesNotMatch(output(), /Showing 1 of 2|Show more/)
})
