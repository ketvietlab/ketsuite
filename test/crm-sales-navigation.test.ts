import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setMaxListeners } from 'node:events'
import * as view from '@ketvietlab/ketjs-view'
import * as ds from '../packages/design-system/src/index.ts'
import { createSalesRead } from '../packages/ketsuite/src/modules/crm_backend/sales/read.mjs'
import { createSalesScreens } from '../packages/ketsuite/src/modules/crm_backend/sales/screens.mjs'
import { adminSalesRoutes } from '../packages/ketsuite/src/modules/crm_backend/sales/routes.mjs'
import { salesDataQuery } from '../packages/ketsuite/src/modules/crm_backend/sales/kit.mjs'
import { createSalesIsland } from '../packages/ketsuite/src/modules/crm_backend/sales/island.mjs'

// Cosmetic's public CRM presenter, with synthetic configuration and no database or production calls.
const reader = createSalesRead({
  clock: '2026-10-14T09:00:00+07:00',
  people: [],
  access: { canRead: () => true, canWrite: () => false },
})
const state = {
  revision: 1,
  records: [],
  activities: [],
  plans: [],
  config: { teams: [], assignmentRules: [], stages: [], lostReasons: [], tags: [], scoreRules: [] },
}
const screens = createSalesScreens({ view, ds, routes: adminSalesRoutes })
const query = (tab: string, lang: string) => new URLSearchParams({ screen: 'crm-settings', tab, lang })
const modelFor = (tab: string, lang: string, role: string) =>
  reader.readSalesScreen(state, query(tab, lang), { id: 'reader', role })
const render = (model: unknown, tab: string, lang: string) =>
  view.renderToString(
    screens.page(model, {
      screen: 'crm-settings',
      query: query(tab, lang).toString(),
      lang,
    }).view,
  )
const activeTab = (html: string) =>
  [...html.matchAll(/<a\b[^>]*>/g)]
    .filter(([tag]) => tag.includes('aria-current="page"'))
    .map(([tag]) => /id="crm-settings-tabs-([^"]+)-tab"/.exec(tag)?.[1])
    .filter(Boolean)

for (const lang of ['vi', 'en'])
  for (const role of ['manager', 'agent']) {
    test(`CRM configuration follows the current address with one cached read (${lang}, ${role})`, () => {
      for (const initial of ['people', 'process', 'scoring']) {
        const model = modelFor(initial, lang, role)
        const before = JSON.stringify(model)
        // Clicks and history entries reuse the read. Starting on a deep link must not pin its tab either.
        for (const tab of ['process', 'scoring', 'people', 'scoring', 'process']) {
          const html = render(model, tab, lang)
          assert.deepEqual(activeTab(html), [tab], `initial=${initial}, address=${tab}`)
          const markers =
            lang === 'vi'
              ? { people: 'Đội bán hàng', process: 'Giai đoạn bán hàng', scoring: 'Quy tắc chấm điểm' }
              : { people: 'Sales teams', process: 'Sales stages', scoring: 'Scoring rules' }
          for (const [name, title] of Object.entries(markers)) {
            assert.equal(html.includes(title), name === tab, `${name} content at ${tab}`)
          }
          assert.equal(html.includes('dialog=config'), role === 'manager')
        }
        assert.equal(JSON.stringify(model), before, 'view navigation must not mutate the read')
      }
    })
  }

test('CRM configuration deep links and invalid/missing tabs use the same default', () => {
  const model = modelFor('process', 'en', 'manager')
  for (const tab of ['', 'unknown', 'PROCESS'])
    assert.deepEqual(activeTab(render(model, tab, 'en')), ['people'])
  for (const tab of ['people', 'process', 'scoring']) {
    const url = new URL(`/admin/crm/configuration?tab=${tab}&lang=en`, 'http://ket.local')
    const address = adminSalesRoutes.parse(url)!
    assert.equal(adminSalesRoutes.href(address.toString()), url.pathname + url.search)
    assert.deepEqual(activeTab(render(modelFor(tab, 'en', 'manager'), tab, 'en')), [tab])
  }
})

test('CRM view-only navigation preserves the read identity and does not enter configuration data', () => {
  const base = 'screen=crm-settings&lang=en'
  const before = modelFor('people', 'en', 'manager')
  for (const extra of ['tab=people', 'tab=process', 'tab=scoring', 'peek=record-1', 'bucket=upcoming']) {
    const address = `${base}&${extra}`
    assert.equal(salesDataQuery(address), salesDataQuery(base))
    assert.deepEqual(
      reader.readSalesScreen(state, new URLSearchParams(address), { id: 'reader', role: 'manager' }),
      before,
    )
  }
  assert.ok('settings' in before)
  assert.equal(
    Object.hasOwn(before.settings, 'tab'),
    false,
    'the API must not become a second view-state owner',
  )
  for (const extra of [
    'lang=vi',
    'dialog=config&group=stages',
    'error=refusal',
    'team=another',
    'q=search',
  ]) {
    assert.notEqual(salesDataQuery(`${base}&${extra}`), salesDataQuery(base), extra)
  }
})

test('CRM island clicks and history redraw tabs with one read, and detach with their lifetime', async (t) => {
  // An event/URL harness for the real island and reactive view, not a browser/layout assertion.
  class ElementFixture extends EventTarget {
    isConnected = true
    querySelector() {
      return null
    }
    querySelectorAll() {
      return []
    }
    setAttribute() {}
    removeAttribute() {}
    closest(_selector: string): ElementFixture | null {
      return null
    }
  }
  class AnchorFixture extends ElementFixture {
    target = ''
    href: string
    constructor(href: string) {
      super()
      this.href = href
    }
    hasAttribute() {
      return false
    }
    override closest(selector: string) {
      return selector === 'a[href]' ? this : null
    }
  }
  const root = new ElementFixture()
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), {
    title: 'CRM · Test',
    documentElement: { dataset: {} },
  })
  const current = { href: 'http://ket.local/admin/crm/configuration', origin: 'http://ket.local' }
  const entries = [current.href]
  let position = 0,
    reads = 0,
    html = ''
  const globals: Record<string, unknown> = {
    document: doc,
    location: current,
    Element: ElementFixture,
    HTMLAnchorElement: AnchorFixture,
    addEventListener: win.addEventListener.bind(win),
    history: {
      pushState(_state: unknown, _title: string, url: string) {
        entries.splice(++position, entries.length, url)
        current.href = url
      },
      replaceState(_state: unknown, _title: string, url: string) {
        entries[position] = current.href = url
      },
    },
    fetch: async (_url: unknown, init: RequestInit) => {
      reads++
      const address = new URLSearchParams(JSON.parse(String(init.body)).query)
      return Response.json({
        ok: true,
        value: reader.readSalesScreen(state, address, { id: 'reader', role: 'manager' }),
      })
    },
  }
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const lifetime = new AbortController()
  setMaxListeners(30, lifetime.signal)
  const island = createSalesIsland({ view, ds, routes: adminSalesRoutes })({
    screen: 'crm-settings',
    query: 'screen=crm-settings',
    lang: 'en',
  })
  const stop = view.effect(() => {
    html = view.renderToString(island.view())
  })
  t.after(() => {
    lifetime.abort()
    stop()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  island.mount({ root, lifetime: lifetime.signal })
  const settled = () => new Promise<void>((resolve) => setImmediate(resolve))
  await settled()
  assert.deepEqual(activeTab(html), ['people'])
  const click = (tab: string) => {
    const event = Object.assign(new Event('click', { cancelable: true }), { button: 0 })
    Object.defineProperty(event, 'target', {
      value: new AnchorFixture(`http://ket.local/admin/crm/configuration?tab=${tab}`),
    })
    root.dispatchEvent(event)
    return event
  }
  for (const tab of ['process', 'scoring', 'people']) {
    assert.ok(click(tab).defaultPrevented)
    await settled()
    assert.deepEqual(activeTab(html), [tab])
    assert.equal(new URL(current.href).searchParams.get('tab'), tab)
  }
  for (const [delta, tab] of [
    [-1, 'scoring'],
    [-1, 'process'],
    [1, 'scoring'],
  ] as const) {
    position += delta
    current.href = entries[position]
    win.dispatchEvent(new Event('popstate'))
    await settled()
    assert.deepEqual(activeTab(html), [tab])
  }
  assert.equal(reads, 1, 'tab and history navigation reuse configuration data')
  lifetime.abort()
  assert.equal(click('process').defaultPrevented, false, 'disposed islands do not intercept links')
})
