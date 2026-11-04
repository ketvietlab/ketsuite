import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import {
  replenishmentRecordDefinition as definition,
  replenishmentFields,
  type ReplenishmentData,
} from '../packages/ketsuite/src/modules/stock_backend/screens/replenishment-record.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { replenishmentQuery } from '../packages/ketsuite/src/modules/stock_backend/replenishment/shared.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const context = (save = true): RecordModalContext<ReplenishmentData> => ({
  id: 'point',
  kind: 'stock.replenishment',
  creating: false,
  tab: '',
  presentation: 'page',
  data: {
    record: {
      productId: 'p',
      warehouseId: 'w',
      locationId: 'l',
      source: 'supplier',
      vendorId: 'supplier',
      leadDays: 5,
      trigger: 'auto',
      minQuantity: '10',
      maxQuantity: '20',
    },
    save,
    run: save,
    rule: false,
    rules: [],
    draftId: 'move',
    lang: 'en',
    choices: {
      products: [{ id: 'p', name: 'Product' }],
      warehouses: [{ id: 'w', name: 'Warehouse' }],
      locations: [{ id: 'l', name: 'Location', warehouseId: 'w', usage: 'internal' }],
    },
    supply: {
      enabled: true,
      options: [{ partnerId: 'supplier', name: 'Vendor' }],
      selected: { name: 'Vendor' },
      leadDays: 5,
      onOrder: 10,
      quantity: 10,
    },
  },
  t: (key) => key,
  outcome: () => null,
  fieldError: (name) => (name === 'leadDays' ? 'Use whole days' : null),
  draft: (name, fallback = '') => (name === 'leadDays' ? '3.5' : fallback),
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: null,
  href: () => '',
  state: (_key, fallback = '') => fallback,
})
const render = (value: unknown) => renderToString(value as TemplateResult)
test('P50 native record preserves refused days and dependent supplier input with accessible Help', () => {
  const c = context(),
    html = render(definition.body!(c))
  assert.match(html, /value="3.5"/)
  assert.match(html, /Use whole days/)
  assert.match(html, /aria-invalid="true"/)
  assert.ok(html.includes('data-ui="form-grid"'))
  assert.match(html, /stock\.listOrderpointSuppliers/)
  assert.match(html, /stock-replenishment-help/)
  assert.match(render(definition.actions!(c)), /screen-help/)
  const fields = replenishmentFields(c)
  assert.ok(fields.some((field) => field.name === 'vendorId'))
  assert.ok(!fields.some((field) => field.name === 'routeId'))
  assert.deepEqual(definition.resetRelationsOnChange?.productId, ['vendorId', 'replenishmentUomId'])
  const form = new FormData()
  for (const [key, value] of Object.entries({
    productId: 'p',
    warehouseId: 'w',
    locationId: 'l',
    source: 'supplier',
    vendorId: '',
    leadDays: '',
    minQuantity: '10',
    maxQuantity: '20',
    trigger: 'manual',
  }))
    form.set(key, value)
  const input = definition.commands!.save!.input(form, c, {})
  assert.equal(input.leadDays, null)
  assert.equal(input.vendorId, null)
  assert.deepEqual(definition.commands!.run!.input(new FormData(), c, {}), { id: 'point', moveId: 'move' })
  // The receipt it creates opens on its own page.
  const receipt = new URL(definition.commands!.run!.navigate!({ pickingId: 'receipt' }, c), 'http://local')
  assert.equal(receipt.pathname, '/admin/stock/transfers/receipt')
  assert.equal(receipt.searchParams.get('lang'), 'en')
  assert.equal(
    definition.commands!.run!.navigate!({ quantity: '0' }, c),
    '/admin/stock/replenishment/point?lang=en',
  )
})
test('P50 read-only record has no form controls and shows supplier plan', () => {
  const c = context(false)
  assert.doesNotMatch(render(definition.body!(c)), /<input|<select|type="submit"/)
  assert.doesNotMatch(render(definition.actions!(c)), /type="submit"/)
  const plan = render(definition.pageAside!(c))
  assert.match(plan, /Vendor/)
  assert.match(plan, /onOrder/)
})
test('P50 collection query retains every compound filter/group and bounds page size', () => {
  const query = replenishmentQuery(
    new URL(
      'http://local/admin/stock/replenishment?lang=en&company=acme&filter=a&filter=b&group=warehouse&group=location&open=x&open=y&groupPage=z&page=2&pageSize=900&record=stock.replenishment:p&dialog=run',
    ),
  )
  assert.equal(query.pageSize, 100)
  const url = new URL(query.href, 'http://local')
  assert.deepEqual(url.searchParams.getAll('filter'), ['a', 'b'])
  assert.deepEqual(url.searchParams.getAll('group'), ['warehouse', 'location'])
  assert.deepEqual(url.searchParams.getAll('open'), ['x', 'y'])
  assert.equal(url.searchParams.get('groupPage'), 'z')
  assert.equal(url.searchParams.has('record'), false)
  assert.equal(url.searchParams.has('dialog'), false)
})

test('P50 collection discards stale reads, restores history without writes and clears denied data', async () => {
  const { createPagedCollectionStore } = await import(
    '../packages/ketsuite/src/ui/client/paged-collection-store.ts'
  )
  const original = replenishmentQuery(new URL('http://local/admin/stock/replenishment?filter=one&filter=two'))
  const pending: Array<{
    query: typeof original
    signal: AbortSignal
    resolve: (response: Response) => void
  }> = []
  const history: string[] = []
  const store = createPagedCollectionStore({
    source: '/admin/stock/replenishment/data',
    query: original,
    href: (q) => q.href,
    announce: (page) => String(page.total),
    browser: {
      href: () => original.href,
      online: () => true,
      fetch: (_url, init) =>
        new Promise((resolve) =>
          pending.push({
            query: JSON.parse(String(init?.body)),
            signal: init?.signal as AbortSignal,
            resolve,
          }),
        ),
      push: (href) => history.push(href),
      replace: (href) => history.push('replace:' + href),
    },
  })
  const reply = (index: number, id: string) =>
    pending[index]!.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          value: { query: pending[index]!.query, rows: [{ id }], total: 1, page: 1, pages: 1, counts: {} },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    )
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  try {
    const first = store.load()
    const next = replenishmentQuery(new URL(original.href + '&q=new', 'http://local'))
    store.navigate(next)
    assert.equal(pending[0]!.signal.aborted, true)
    reply(1, 'new')
    await tick()
    reply(0, 'stale')
    await first
    assert.equal(store.value()?.rows[0]?.id, 'new')
    assert.deepEqual(history, [next.href])
    store.navigate(original, 'none')
    reply(2, 'original')
    await tick()
    assert.deepEqual(history, [next.href])
    assert.equal(store.value()?.rows[0]?.id, 'original')
    store.retry()
    pending[3]!.resolve(new Response('Forbidden', { status: 403 }))
    await tick()
    assert.equal(store.phase(), 'denied')
    assert.equal(store.value(), null)
  } finally {
    store.dispose()
  }
})

test('P50 excludes inactive picker destinations and resolves read-only units without a catalogue grant', () => {
  const c = context(false)
  c.data.record = { ...c.data.record, warehouseId: 'w', replenishmentUomId: 'each' }
  c.data.choices.locations!.push({
    id: 'inactive',
    name: 'Inactive input',
    warehouseId: 'w',
    usage: 'internal',
    active: false,
  })
  c.data.supply = { ...c.data.supply, uomName: 'Each' }
  // The location is a relation picker; its choices travel in the island's props.
  const fields = replenishmentFields(c)
  const control = render(fields.find((field) => field.name === 'locationId')!.control as never)
  const location = [...control.matchAll(/data-island="backend\.relation-select" data-props="([^"]+)"/g)]
    .map((match) => JSON.parse(match[1]!.replaceAll('&quot;', '"')) as { config: Record<string, unknown> })
    .find((props) => props.config.name === 'locationId')
  assert.ok(location, 'the location is a relation picker')
  assert.ok(
    !(location.config.options as Array<{ value: string }>).some((option) => option.value === 'inactive'),
  )
  assert.ok(fields.every((field) => field.type !== 'select' || field.name === 'trigger'))
  assert.match(render(definition.body!(c)), /Each/)
})

test('P50 supplier receipt uses translated empty states without purchase price columns', () => {
  const c = {
    ...context(false),
    kind: 'stock.transfer',
    data: {
      record: { id: 'receipt', state: 'draft', partnerId: 'vendor', partnerName: 'Vendor', moves: [] },
      permissions: {},
      choices: {},
      draftId: 'draft',
    },
  }
  const html = render(transferModalDefinition.body!(c))
  assert.match(html, /stock_backend.modal.noProducts/)
  assert.match(html, /stock_backend.modal.noPicked/)
  assert.match(html, /Vendor/)
  assert.doesNotMatch(html, /No records|There is nothing|purchasePrice/)
})
