import test from 'node:test'
import assert from 'node:assert/strict'
import { html, renderToStaticString } from '@ketvietlab/ketjs-view'
import { registerFlowExtension } from '@ketvietlab/flow-client/extensions.mjs'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
import { tr } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

let fallbackCalls = 0
registerFlowExtension({
  name: 'modal-record-probe',
  forms: {
    'probe-record': { title: 'Record', back: 'board' },
    'probe-legacy': { title: 'Legacy', back: 'board' },
  },
  create: () => ({
    modal: () => {
      fallbackCalls++
      return html`<p>Legacy body</p>`
    },
    modalRecord: (key) =>
      key === 'probe-record'
        ? {
            body: html`<form id="probe-primary"><input name="title"></form><form id="probe-secondary"><button type="submit">Secondary</button></form>`,
            footer: html`<button type="submit" form="probe-primary">Save primary</button>`,
          }
        : null,
  }),
})
globalThis.window = new EventTarget()
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
async function render(screen) {
  const fixture = createOrganizationSession()
  const island = createFlowWorkspace(
    { screen },
    {
      call: createFnClient({
        fetch: async (url, request) =>
          new Response(
            JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      }),
    },
  )
  const lifetime = new AbortController()
  const root = Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    querySelector: () => null,
    querySelectorAll: () => [],
  })
  island.mount({ root, lifetime: lifetime.signal })
  await new Promise((resolve) => setTimeout(resolve, 0))
  try {
    return renderToStaticString(island.view())
  } finally {
    lifetime.abort()
    island.dispose()
  }
}
test('extension modal records compose one body and footer without invoking the legacy renderer', async () => {
  const before = fallbackCalls
  const output = await render('probe-record')
  assert.equal(fallbackCalls, before)
  assert.equal((output.match(/id="probe-primary"/g) ?? []).length, 1)
  assert.match(output, /<footer>[\s\S]*form="probe-primary"/)
  assert.ok(output.indexOf('id="probe-secondary"') < output.indexOf('<footer>'))
  assert.doesNotMatch(output.slice(output.indexOf('<footer>')), /Secondary/)
})
test('extensions returning no modal record preserve the existing modal body contract', async () => {
  const before = fallbackCalls
  const output = await render('probe-legacy')
  assert.ok(fallbackCalls > before)
  assert.match(output, /Legacy body/)
  assert.doesNotMatch(output, /probe-primary|<footer>/)
})
let recordDetailFor = null
registerFlowExtension({
  name: 'record-detail-probe',
  forms: { 'probe-task': { title: 'Task form', back: 'board' } },
  create: (ctx) => ({
    modalRecord: (key) =>
      key === 'probe-task'
        ? {
            body: html`<p>Probe body ${ctx.data()?.probe ?? 'none'}</p>`,
            footer: html`<button type="submit" form="probe-task-form">Save probe</button>`,
          }
        : null,
    taskSection: () => html`<p>Probe section ${ctx.data()?.probe ?? 'none'}</p>`,
    recordDetail: (data, detail) => {
      recordDetailFor = detail.task.id
      return { ...data, probe: detail.probe }
    },
  }),
})
// Opens `screen` on KV-131 over a screen read that carries it as a summary; its detail waits for `release`.
async function overSummary(screen) {
  const fixture = createOrganizationSession(),
    held = Promise.withResolvers(),
    tick = async () => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    }
  const respond = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const island = createFlowWorkspace(
    { screen, record: 'KV-131' },
    {
      call: createFnClient({
        fetch: async (url, request) => {
          const name = decodeURIComponent(url.split('/').pop()),
            args = JSON.parse(request.body)
          if (name !== 'flow.issue.detail')
            return respond(fixture.call(name, { ...args, recordId: undefined }))
          const response = fixture.call(name, args)
          await held.promise
          return respond({ ...response, value: { ...response.value, probe: 'probe-value' } })
        },
      }),
    },
  )
  const lifetime = new AbortController()
  const root = Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    querySelector: () => null,
    querySelectorAll: () => [],
  })
  recordDetailFor = null
  island.mount({ root, lifetime: lifetime.signal })
  await tick()
  return {
    output: () => renderToStaticString(island.view()),
    release: async () => {
      held.resolve()
      await tick()
    },
    close: () => {
      lifetime.abort()
      island.dispose()
    },
  }
}
test('an extension form over a task summary waits for the record and folds it in through recordDetail', async () => {
  const open = await overSummary('probe-task')
  try {
    assert.ok(open.output().includes(tr('flow.record.loading')))
    assert.doesNotMatch(open.output(), /Probe body|Save probe/)
    await open.release()
    assert.equal(recordDetailFor, 'KV-131')
    assert.match(open.output(), /Probe body probe-value/)
    assert.match(open.output(), /<footer>[\s\S]*Save probe/)
  } finally {
    open.close()
  }
})
test('extension task sections wait for the record in the task detail', async () => {
  const open = await overSummary('issue')
  try {
    assert.ok(open.output().includes(tr('flow.record.loading')))
    assert.doesNotMatch(open.output(), /Probe section/)
    await open.release()
    assert.match(open.output(), /Probe section probe-value/)
  } finally {
    open.close()
  }
})
