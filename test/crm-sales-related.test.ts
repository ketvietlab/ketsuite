import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import * as view from '@ketvietlab/ketjs-view'
import * as ds from '../packages/design-system/src/index.ts'
import { watchRelatedIslands } from '../packages/ketsuite/src/modules/crm_backend/sales/runtime.mjs'
import { adminSalesRoutes } from '../packages/ketsuite/src/modules/crm_backend/sales/routes.mjs'
import { createSalesScreens } from '../packages/ketsuite/src/modules/crm_backend/sales/screens.mjs'
import { boot, login, read } from './helpers/crm-sales.ts'

test('crm sales record: what other modules keep about a record sits in its Activity tab', async (t) => {
  const { app } = await boot(t)
  await login(app, 'admin')
  const screens = createSalesScreens({ view, ds, routes: adminSalesRoutes })
  const page = (model: Row, query: string, lang = 'vi') =>
    view.renderToString(
      screens.page(model, {
        screen: 'lead-detail',
        query,
        lang,
        requestId: (key: string) => `request-${key}`,
        quoteLines: (_key: string, initial: Row[]) => initial,
        leadDraft: () => ({}),
      }).view,
    )
  const query = 'screen=lead-detail&id=lead-queue'
  const model = (await read(app, query)).body.value as Row
  assert.deepEqual(model.related, [], 'no module here fills the joint')
  assert.ok(!page(model, query).includes('<ket-island'))

  const filled = { ...model, related: ['calls.record', 'visits.record'] }
  const html = page(filled, query)
  const hosts = [...html.matchAll(/<ket-island\b[^>]*>/gu)].map(([tag]) => tag)
  assert.equal(hosts.length, 2, 'one host per island that fills it')
  assert.match(hosts[0]!, /data-island="calls\.record"/u)
  assert.match(hosts[1]!, /data-island="visits\.record"/u)
  for (const host of hosts) {
    assert.match(host, /\bdata-crm-related\b/u)
    const props = /data-props="([^"]*)"/u.exec(host)?.[1]?.replaceAll('&quot;', '"')
    assert.deepEqual(JSON.parse(String(props)), { caseId: 'lead-queue', lang: 'vi' })
  }
  // After the record's work, before its history.
  const at = html.indexOf('<ket-island')
  assert.ok(html.indexOf('Việc cần làm') < at && at < html.indexOf('Lịch sử hoạt động'))
  // Each host is the record's own: another record names itself, the other language its own.
  const other = 'screen=lead-detail&id=deal-mine'
  const english = page(
    { ...((await read(app, other)).body.value as Row), related: ['calls.record'] },
    other,
    'en',
  )
  assert.match(
    english,
    /data-props="\{&quot;caseId&quot;:&quot;deal-mine&quot;,&quot;lang&quot;:&quot;en&quot;\}"/u,
  )
  // The other tabs keep to their own content.
  for (const tab of ['detail', 'quotes'])
    assert.ok(!page(filled, `${query}&tab=${tab}`).includes('<ket-island'), tab)
})

class FakeElement {
  isConnected = true
  emptied = 0
  readonly related: boolean
  readonly inside: FakeElement[]
  constructor(related: boolean, inside: FakeElement[] = []) {
    this.related = related
    this.inside = inside
  }
  matches(selector: string) {
    assert.equal(selector, 'ket-island[data-crm-related]')
    return this.related
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.inside.flatMap((node) => [
      ...(node.matches(selector) ? [node] : []),
      ...node.querySelectorAll(selector),
    ])
  }
  replaceChildren() {
    this.emptied += 1
  }
}

test('crm sales record: a related island starts with its host, stops with it, and restarts for the next record', () => {
  const globals = globalThis as Record<string, unknown>
  const saved = ['document', 'MutationObserver', 'Element'].map((name) => [name, globals[name]] as const)
  const told: Array<[string, FakeElement]> = []
  let observed: ((records: unknown[]) => void) | null = null
  let watching = true
  globals.Element = FakeElement
  globals.document = {
    dispatchEvent: (event: CustomEvent) => told.push([event.type, event.detail.root]),
  }
  globals.MutationObserver = class {
    constructor(callback: (records: unknown[]) => void) {
      observed = callback
    }
    observe() {}
    disconnect() {
      watching = false
    }
  }
  try {
    const first = new FakeElement(true)
    const root = new FakeElement(false, [first])
    const lifetime = new AbortController()
    watchRelatedIslands(root, lifetime.signal)
    assert.deepEqual(told, [['ket:islands-attach', first]], 'a host already drawn starts')

    told.length = 0
    const tab = new FakeElement(false, [new FakeElement(true)])
    const unrelated = new FakeElement(false)
    first.isConnected = false
    observed!([
      { type: 'childList', removedNodes: [first], addedNodes: [tab] },
      { type: 'childList', removedNodes: [], addedNodes: [unrelated] },
    ])
    assert.deepEqual(told, [
      ['ket:islands-detach', first],
      ['ket:islands-attach', tab],
    ])

    // The next record keeps the host and gives it new props: it starts over, empty, for that record.
    told.length = 0
    const kept = tab.inside[0]!
    observed!([
      { type: 'attributes', target: kept, removedNodes: [], addedNodes: [] },
      { type: 'attributes', target: unrelated, removedNodes: [], addedNodes: [] },
    ])
    assert.deepEqual(told, [
      ['ket:islands-detach', kept],
      ['ket:islands-attach', kept],
    ])
    assert.equal(kept.emptied, 1)

    // A host moved within the drawing keeps running.
    told.length = 0
    observed!([{ type: 'childList', removedNodes: [kept], addedNodes: [kept] }])
    assert.deepEqual(told, [['ket:islands-attach', kept]], 'an island already running is left alone')

    lifetime.abort()
    assert.equal(watching, false, 'the page leaving stops the watch')
  } finally {
    for (const [name, value] of saved) globals[name] = value
  }
})
