import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { countingHost, mount, type HostNode } from '@ketvietlab/ketjs-view'
import { createRelationSelectView } from '@ketvietlab/design-system'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'

const byUi = (node: HostNode, ui: string): HostNode[] => [
  ...(node.attrs?.['data-ui'] === ui ? [node] : []),
  ...(node.children ?? []).flatMap((child) => byUi(child, ui)),
]
const textOf = (node: HostNode): string => node.text ?? (node.children ?? []).map(textOf).join('')
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const picker = (t: TestContext) => {
  class Input {
    value = ''
  }
  const globals = globalThis as unknown as Record<string, unknown>
  const previousInput = globals.HTMLInputElement
  const previousFetch = globalThis.fetch
  globals.HTMLInputElement = Input
  const requests: { input: Record<string, unknown>; signal: AbortSignal; resolve: (r: Response) => void }[] =
    []
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise<Response>((resolve) => {
      requests.push({ input: JSON.parse(String(init.body)), signal: init.signal as AbortSignal, resolve })
    })) as typeof fetch
  const controller = createRelationSelectView({
    id: 'remote-customer',
    config: {
      ...relationSelectDemoConfig,
      value: null,
      options: [{ value: 'primed', label: 'Primed customer' }],
      manager: { listFunction: 'partner.listPartners', descriptionField: 'phone', searchInDropdown: true },
    },
  })
  const host = countingHost(),
    root = host.root(),
    view = mount(host, root, controller.view)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    view.dispose()
    controller.dispose?.()
    globalThis.fetch = previousFetch
    if (previousInput === undefined) delete globals.HTMLInputElement
    else globals.HTMLInputElement = previousInput
  })
  return {
    root,
    requests,
    click: (ui: string) => host.fire(byUi(root, ui)[0]!, 'click'),
    search: (query: string) => {
      const input = new Input()
      input.value = query
      host.fire(byUi(root, 'relation-search')[0]!, 'input', { currentTarget: input })
      t.mock.timers.tick(180)
    },
    respond: async (index: number, value: unknown[], status = 200) => {
      assert.ok(requests[index], 'the inline picker must request server results')
      requests[index].resolve(
        new Response(
          JSON.stringify(status === 200 ? { ok: true, value } : { ok: false, message: 'Search unavailable' }),
          { status },
        ),
      )
      await flush()
    },
  }
}

test('relation picker: inline server search selects a customer outside primed options by phone', async (t) => {
  const p = picker(t)
  p.click('relation-trigger')
  await p.respond(0, [])
  p.search('0909000123')
  assert.deepEqual(p.requests[1].input, { search: '0909000123', limit: 80 })
  await p.respond(1, [{ id: 'outside-first-forty', name: 'Remote customer', phone: '+84909000123' }])
  const options = byUi(p.root, 'relation-option')
  assert.equal(options.length, 1, 'canonical phone results are not filtered again against the raw query')
  assert.match(textOf(options[0]), /Remote customer.*\+84909000123/)
  p.click('relation-option')
  assert.equal(byUi(p.root, 'relation-menu').length, 0)
  assert.equal(textOf(byUi(p.root, 'relation-value')[0]), 'Remote customer')
  assert.match(textOf(byUi(p.root, 'relation-native')[0]), /Remote customer/)
})

test('relation picker: canceled late responses cannot overwrite the latest query', async (t) => {
  const p = picker(t)
  p.click('relation-trigger')
  await p.respond(0, [])
  p.search('First')
  p.search('Second')
  assert.equal(p.requests[1].signal.aborted, true)
  await p.respond(2, [{ id: 'second', name: 'Second customer' }])
  await p.respond(1, [{ id: 'first', name: 'First customer' }])
  assert.equal(textOf(byUi(p.root, 'relation-option')[0]), 'Second customer')
})

test('relation picker: inline search reports failure and can retry without losing the query', async (t) => {
  const p = picker(t)
  p.click('relation-trigger')
  await p.respond(0, [])
  p.search('Missing')
  await p.respond(1, [], 503)
  assert.match(textOf(byUi(p.root, 'relation-options')[0]), /Search unavailable.*Retry/)
  p.click('action')
  assert.equal(p.requests[2].input.search, 'Missing')
  await p.respond(2, [])
  assert.match(textOf(byUi(p.root, 'relation-empty')[0]), /No partners found/)
})

test('relation picker: a record learned after the props survives the re-mount a record form gives it', async (t) => {
  const p = picker(t)
  p.click('relation-trigger')
  await p.respond(0, [])
  p.search('Learned')
  await p.respond(1, [{ id: 'learned-after-props', name: 'Learned customer' }])
  p.click('relation-option')
  // The form re-renders the island from props written before this record existed.
  const again = createRelationSelectView({
    id: 'remote-customer',
    config: {
      ...relationSelectDemoConfig,
      value: 'learned-after-props',
      options: [{ value: 'primed', label: 'Primed customer' }],
      // Same list, local dropdown: the shape of the product page's category picker.
      manager: { listFunction: 'partner.listPartners', descriptionField: 'phone' },
    },
  })
  const host = countingHost()
  const root = host.root()
  const view = mount(host, root, again.view)
  t.after(() => {
    view.dispose()
    again.dispose?.()
  })
  assert.equal(textOf(byUi(root, 'relation-value')[0]), 'Learned customer', 'the choice keeps its label')
  const native = byUi(root, 'relation-native')[0]!
  assert.ok(
    byUi(native, 'relation-native-option').length === 0
      ? /Learned customer/.test(textOf(native))
      : byUi(native, 'relation-native-option').some((option) => /Learned customer/.test(textOf(option))),
    'the native select can hold the value it posts',
  )
  host.fire(byUi(root, 'relation-trigger')[0]!, 'click')
  assert.ok(
    byUi(root, 'relation-option').some((option) => /Learned customer/.test(textOf(option))),
    'the list offers the learned record again',
  )
})
