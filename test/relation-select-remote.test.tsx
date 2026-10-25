import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { countingHost, mount, renderToString, type HostNode } from '@ketvietlab/ketjs-view'
import { type RelationManager, createRelationSelectView } from '@ketvietlab/design-system'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'

const byUi = (node: HostNode, ui: string): HostNode[] => [
  ...(node.attrs?.['data-ui'] === ui ? [node] : []),
  ...(node.children ?? []).flatMap((child) => byUi(child, ui)),
]
const textOf = (node: HostNode): string => node.text ?? (node.children ?? []).map(textOf).join('')
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const picker = (t: TestContext, requestQuery?: string, manager: Partial<RelationManager> = {}) => {
  class Input {
    value = ''
  }
  const globals = globalThis as unknown as Record<string, unknown>
  const previousInput = globals.HTMLInputElement
  const previousFetch = globalThis.fetch
  globals.HTMLInputElement = Input
  const requests: {
    url: string
    input: Record<string, unknown>
    signal: AbortSignal
    resolve: (r: Response) => void
  }[] = []
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise<Response>((resolve) => {
      requests.push({
        url: String(_url),
        input: JSON.parse(String(init.body)),
        signal: init.signal as AbortSignal,
        resolve,
      })
    })) as typeof fetch
  const controller = createRelationSelectView({
    id: 'remote-customer',
    config: {
      ...relationSelectDemoConfig,
      value: null,
      options: [{ value: 'primed', label: 'Primed customer' }],
      manager: {
        requestQuery,
        listFunction: 'partner.listPartners',
        descriptionField: 'phone',
        searchInDropdown: true,
        ...manager,
      },
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
    controller,
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

test('relation picker: remote reads retain the application tenant branch and locale context', async (t) => {
  const ui = picker(t, 'company=hotel&branch=front&lang=vi')
  ui.click('relation-trigger')
  await flush()
  assert.ok(ui.requests.length)
  for (const request of ui.requests) assert.match(request.url, /\?company=hotel&branch=front&lang=vi$/)
})

test('relation picker: an unprimed selected id remains a native submitted value while its label resolves', () => {
  const controller = createRelationSelectView({
    id: 'existing-selection',
    config: {
      ...relationSelectDemoConfig,
      value: 'remote-selected',
      options: [],
      manager: {
        listFunction: 'hospitality_core.lookupRoomTypes',
        resolveParam: 'id',
        listInput: { propertyId: 'hotel' },
      },
    },
  })
  const markup = renderToString(controller.view())
  assert.match(markup, /value="remote-selected"[^>]*selected/)
  assert.match(markup, /Loading/)
  controller.dispose?.()
})

test('relation picker: changing a parent cancels reads, clears the child and sends the new form value', async (t) => {
  const p = picker(t, undefined, {
    listInput: { property: 'hotel' },
    listInputFields: { warehouseId: 'warehouse' },
  })
  const globals = globalThis as unknown as Record<string, unknown>,
    previousDocument = globals.document,
    previousWindow = globals.window,
    previousElement = globals.HTMLElement,
    previousCancel = globals.cancelAnimationFrame,
    previousSelect = globals.HTMLSelectElement
  globals.document = new EventTarget()
  globals.window = new EventTarget()
  globals.HTMLElement = class {}
  globals.cancelAnimationFrame = () => undefined
  globals.HTMLSelectElement = class {}
  const lifetime = new AbortController(),
    parent = { value: 'one' },
    unrelated = { value: 'Keep this draft' }
  const form = Object.assign(new EventTarget(), {
    elements: { namedItem: (name: string) => (name === 'warehouse' ? parent : unrelated) },
  })
  p.controller.mount?.({
    root: { closest: () => form, querySelectorAll: () => [] } as unknown as Parameters<
      NonNullable<typeof p.controller.mount>
    >[0]['root'],
    lifetime: lifetime.signal,
  })
  t.after(() => {
    lifetime.abort()
    if (previousElement === undefined) delete globals.HTMLElement
    else globals.HTMLElement = previousElement
    if (previousCancel === undefined) delete globals.cancelAnimationFrame
    else globals.cancelAnimationFrame = previousCancel
    if (previousWindow === undefined) delete globals.window
    else globals.window = previousWindow
    if (previousDocument === undefined) delete globals.document
    else globals.document = previousDocument
    if (previousSelect === undefined) delete globals.HTMLSelectElement
    else globals.HTMLSelectElement = previousSelect
  })
  p.click('relation-trigger')
  assert.equal(p.requests[0].input.warehouseId, 'one')
  await p.respond(0, [{ id: 'child-one', name: 'Old location' }])
  p.click('relation-option')
  await flush()
  assert.match(textOf(byUi(p.root, 'relation-native')[0]), /Old location/)
  p.click('relation-trigger')
  parent.value = 'two'
  form.dispatchEvent(new Event('change'))
  await flush()
  assert.equal(p.requests[1].signal.aborted, true)
  assert.doesNotMatch(textOf(byUi(p.root, 'relation-native')[0]), /Old location/)
  assert.equal(unrelated.value, 'Keep this draft')
  p.click('relation-trigger')
  assert.equal(p.requests[2].input.warehouseId, 'two')
  assert.equal(p.requests[2].input.property, 'hotel')
  await p.respond(1, [{ id: 'late', name: 'Stale location' }])
  await p.respond(2, [{ id: 'child-two', name: 'New location' }])
  assert.doesNotMatch(textOf(p.root), /Stale location/)
  assert.match(textOf(p.root), /New location/)
  parent.value = ''
  form.dispatchEvent(new Event('input'))
  await flush()
  assert.equal(String(byUi(p.root, 'relation-trigger')[0].attrs?.disabled), 'true')
})

test('relation picker: field validation targets the visible trigger and its error text', () => {
  const controller = createRelationSelectView({
    id: 'validated-location',
    config: {
      ...relationSelectDemoConfig,
      triggerId: 'location-field',
      invalid: true,
      describedBy: 'location-field-error',
    },
  })
  const markup = renderToString(controller.view())
  assert.match(
    markup,
    /<button[^>]*data-ui="relation-trigger"[^>]*id="location-field"[^>]*aria-invalid="true"[^>]*aria-describedby="location-field-error"/,
  )
  controller.dispose?.()
})
