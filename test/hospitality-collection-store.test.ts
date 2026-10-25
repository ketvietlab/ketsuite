import { hospitalityRecordBack } from '../packages/ketsuite/src/modules/hospitality_core/screens/scoped-href.ts'
import {
  collectionCell,
  collectionCellHref,
  collectionPager,
  collectionRecordHref,
  isHospitalityCollectionNavigation,
} from '../packages/ketsuite/src/modules/hospitality_core/collections/view.tsx'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { HospitalityCollectionProps } from '../packages/ketsuite/src/modules/hospitality_core/collections/view.tsx'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPagedCollectionStore } from '../packages/ketsuite/src/ui/client/paged-collection-store.ts'
import type {
  CollectionBrowser,
  CollectionPage,
  CollectionQuery,
} from '../packages/ketsuite/src/ui/client/paged-collection-store.ts'

const query: CollectionQuery = {
  q: '',
  state: 'all',
  sort: 'name',
  direction: 'asc',
  propertyId: null,
  roomTypeId: null,
  floorId: null,
  from: null,
  to: null,
  page: 1,
  pageSize: 25,
}
const answer = (q: CollectionQuery, id: string): CollectionPage => ({
  query: q,
  total: 1,
  page: 1,
  pages: 1,
  rows: [{ id }],
  counts: { state: { all: 1 } },
  isEmpty: false,
})
const response = (value: CollectionPage) =>
  new Response(JSON.stringify({ ok: true, value }), { headers: { 'content-type': 'application/json' } })
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('Hospitality collection store is render-pure until mounted', async () => {
  const store = createPagedCollectionStore({
    source: '/_ket/fn/hospitality_core.searchRooms',
    query,
    href: () => '/rooms',
    announce: () => 'one result',
  })
  await store.load()
  assert.equal(store.value(), null)
  assert.equal(store.phase(), 'loading')
  store.dispose()
})

test('Hospitality collection store ignores a late answer even when a server ignores abort', async () => {
  const pending: Array<{
    query: CollectionQuery
    signal: AbortSignal
    resolve: (response: Response) => void
  }> = []
  const history: string[] = []
  const browser: CollectionBrowser = {
    href: () => 'http://localhost/rooms',
    online: () => true,
    fetch: (_input, init) =>
      new Promise((resolve) =>
        pending.push({ query: JSON.parse(String(init?.body)), signal: init?.signal as AbortSignal, resolve }),
      ),
    push: (href) => history.push(href),
    replace: (href) => history.push(`replace:${href}`),
  }
  const store = createPagedCollectionStore({
    source: '/_ket/fn/hospitality_core.searchRooms',
    query,
    href: (q) => `/rooms?q=${q.q}`,
    announce: (page) => String(page.total),
    browser,
  })
  try {
    const first = store.load()
    store.navigate({ ...query, q: 'new' })
    assert.equal(pending[0]!.signal.aborted, true)
    pending[1]!.resolve(response(answer(pending[1]!.query, 'new')))
    await tick()
    pending[0]!.resolve(response(answer(pending[0]!.query, 'old')))
    await first
    assert.equal(store.value()?.rows[0]?.id, 'new')
    assert.equal(store.query().q, 'new')
    assert.deepEqual(history, ['/rooms?q=new'])
  } finally {
    store.dispose()
  }
})

test('Hospitality collection store clears retained data and cache on permission denial, including non-JSON errors', async () => {
  let requests = 0
  const browser: CollectionBrowser = {
    href: () => 'http://localhost/rooms',
    online: () => true,
    fetch: async () =>
      ++requests === 1 ? response(answer(query, 'private')) : new Response('Forbidden', { status: 403 }),
    push: () => {},
    replace: () => {},
  }
  const store = createPagedCollectionStore({
    source: '/_ket/fn/hospitality_core.searchRooms',
    query,
    href: () => '/rooms',
    announce: () => '',
    browser,
  })
  try {
    await store.load()
    assert.equal(store.value()?.rows[0]?.id, 'private')
    await store.load(true)
    assert.equal(store.phase(), 'denied')
    assert.equal(store.value(), null)
    await store.load()
    assert.equal(requests, 3, 'the previously authorized result cannot be recovered from cache')
  } finally {
    store.dispose()
  }
})

test('Hospitality collection store uses replace for an applied page clamp and never writes history for popstate', async () => {
  const history: string[] = []
  const browser: CollectionBrowser = {
    href: () => 'http://localhost/rooms?page=99',
    online: () => true,
    fetch: async (_input, init) => response(answer({ ...JSON.parse(String(init?.body)), page: 1 }, 'room')),
    push: (href) => history.push(`push:${href}`),
    replace: (href) => history.push(`replace:${href}`),
  }
  const store = createPagedCollectionStore({
    source: '/_ket/fn/hospitality_core.searchRooms',
    query: { ...query, page: 99 },
    href: (q) => `/rooms?page=${q.page}`,
    announce: () => '',
    browser,
  })
  try {
    await store.load()
    assert.deepEqual(history, ['replace:/rooms?page=1'])
    history.length = 0
    store.navigate(query, 'none')
    await tick()
    assert.deepEqual(history, [])
  } finally {
    store.dispose()
  }
})

test('Hospitality hydration accepts canonical object key order without dropping an open record URL', async () => {
  const writes: string[] = []
  const canonicalQuery = Object.fromEntries(
    Object.entries(query).sort(([a], [b]) => a.localeCompare(b)),
  ) as CollectionQuery
  const browser: CollectionBrowser = {
    href: () => 'https://hotel.test/rooms?record=hospitality.room:new',
    online: () => true,
    push: (href) => writes.push(href),
    replace: (href) => writes.push(href),
    fetch: async () => response(answer(query, 'one')),
  }
  const store = createPagedCollectionStore({
    source: '/read',
    query: canonicalQuery,
    href: () => '/rooms',
    announce: () => 'one',
    browser,
  })
  await store.load()
  assert.equal(store.phase(), 'ready')
  assert.deepEqual(writes, [], 'serialization order is not an applied query correction')
  store.dispose()
})

test('Hospitality collection rows prioritize the native record owner while retaining filters, scope and legacy identifiers', () => {
  const props: HospitalityCollectionProps = {
    key: 'billing-rules',
    id: 'billing-rules',
    source: '/_ket/fn/hospitality_billing.searchChargeRules',
    path: '/admin/hospitality/billing/rules?company=one&branches=west&lang=vi',
    recordPath: '/admin/hospitality/billing/rules',
    recordParam: 'rule',
    recordIdField: 'chargeType',
    recordQuery: { create: '1' },
    recordKind: 'hospitality.billingRule',
    createHref: null,
    query,
    defaultSort: 'name',
    lang: 'vi',
    allowed: true,
    columns: [],
    states: [],
    properties: [],
    words: {},
  }
  const filtered = { ...query, q: 'invoice', page: 3 }
  const link = new URL(
    collectionRecordHref(props, filtered, { id: 'rule-company-one-room', chargeType: 'room' }),
    'http://collection.local',
  )
  assert.equal(link.searchParams.get('record'), 'hospitality.billingRule:room')
  assert.equal(link.searchParams.get('rule'), null)
  assert.equal(link.searchParams.get('create'), null)
  assert.equal(link.searchParams.get('company'), 'one')
  assert.equal(link.searchParams.get('branches'), 'west')
  assert.equal(link.searchParams.get('q'), 'invoice')
  assert.equal(link.searchParams.get('page'), '3')
  const legacy = new URL(
    collectionRecordHref({ ...props, recordKind: undefined }, filtered, {
      id: 'ignored',
      chargeType: 'room',
    }),
    'http://collection.local',
  )
  assert.equal(legacy.searchParams.get('rule'), 'room')
  assert.equal(legacy.searchParams.get('create'), '1')
  const legacyBack = new URL(legacy.searchParams.get('returnTo')!, legacy)
  assert.equal(legacyBack.searchParams.get('page'), '3')
  assert.equal(legacyBack.hash, '#row=ignored')
})

const rulesProps: HospitalityCollectionProps = {
  key: 'billing-rules',
  id: 'billing-rules',
  source: '/read',
  path: '/admin/hospitality/billing/rules',
  recordPath: '/admin/hospitality/billing/rules',
  createHref: null,
  query,
  defaultSort: 'attention',
  lang: 'vi',
  allowed: true,
  columns: [],
  states: [],
  properties: [],
  words: {
    'empty.income': 'Theo mặc định',
    'empty.tax.true': 'Không tính thuế',
    'empty.tax.false': 'Chưa xác nhận',
    'state.incomplete': 'Cần thiết lập',
  },
}

test('Hospitality collection cells name what an empty value means and tone a state by its value', () => {
  // HOS-DEC-034: an account left to its default, a tax not answered and no tax at all read differently.
  const props = rulesProps
  const cell = (column: Parameters<typeof collectionCell>[2], row: Record<string, unknown>) =>
    renderToString(collectionCell(props, query, column, row) as never)
  const income = { key: 'income', field: 'incomeAccount', label: 'Account' }
  const tax = { key: 'tax', field: 'tax', label: 'Tax', emptyField: 'taxExempt' }
  assert.match(cell(income, { incomeAccount: null }), />Theo mặc định</)
  assert.match(cell(income, { incomeAccount: '5113 · Doanh thu' }), />5113 · Doanh thu</)
  assert.match(cell(tax, { tax: null, taxExempt: true }), />Không tính thuế</)
  assert.match(cell(tax, { tax: null, taxExempt: false }), />Chưa xác nhận</)
  assert.match(cell(tax, { tax: 'GTGT 8%', taxExempt: false }), />GTGT 8%</)
  assert.match(cell({ key: 'other', field: 'other', label: 'Other' }, {}), />—</)
  const state = {
    key: 'state',
    field: 'state',
    label: 'State',
    kind: 'state' as const,
    tones: { incomplete: 'warning' as const, ready: 'positive' as const },
  }
  assert.match(cell(state, { state: 'incomplete' }), /data-tone="warning"[^>]*>[\s\S]*Cần thiết lập/)
  assert.doesNotMatch(cell({ ...state, tones: undefined }, { state: 'incomplete' }), /data-tone="warning"/)
})

test('Hospitality collection pager appears only when there is another page to reach', () => {
  const store = (pages: number, phase = 'ready') => ({
    value: () => ({ query, total: pages * 25, page: 1, pages, rows: [], counts: {}, isEmpty: false }),
    phase: () => phase,
    query: () => query,
  })
  assert.equal(collectionPager(rulesProps, store(1) as never), undefined)
  assert.ok(collectionPager(rulesProps, store(2) as never)?.nextHref)
  assert.equal(collectionPager(rulesProps, store(2, 'failed') as never), undefined)
})

test('Hospitality row actions retain owner scope and return row, and refuse external destinations', () => {
  const props = {
    path: '/admin/hospitality/billing?company=hotel&branches=north&branches=south&lang=vi',
    lang: 'en',
    defaultSort: 'openedAt',
    columns: [],
  } as unknown as HospitalityCollectionProps
  const filtered = { ...query, q: 'An', page: 3, sort: 'openedAt' }
  const result = collectionCellHref(
    props,
    filtered,
    {
      id: 'folio-1',
      nextHref: '/admin/hospitality/folios/folio-1?dialog=payment&company=foreign&branch=foreign&lang=vi',
    },
    'nextHref',
  )
  const url = new URL(result!, 'http://collection.local')
  assert.equal(url.searchParams.get('dialog'), 'payment')
  assert.equal(url.searchParams.get('company'), 'hotel')
  assert.equal(url.searchParams.get('branch'), null)
  assert.deepEqual(url.searchParams.getAll('branches'), ['north', 'south'])
  assert.equal(url.searchParams.get('lang'), 'en')
  const back = new URL(url.searchParams.get('returnTo')!, 'http://collection.local')
  assert.equal(back.searchParams.get('q'), 'An')
  assert.equal(back.searchParams.get('page'), '3')
  assert.match(back.hash, /folio-1/)
  const returned = new URL(
    hospitalityRecordBack(result!, '/admin/hospitality/folios'),
    'http://collection.local',
  )
  assert.equal(returned.pathname, '/admin/hospitality/billing')
  assert.equal(returned.searchParams.get('page'), '3')
  assert.equal(returned.searchParams.get('lang'), 'en')
  assert.equal(returned.hash, back.hash)
  const rule = new URL(
    collectionCellHref(
      props,
      filtered,
      { id: 'folio-1', nextHref: '/admin/hospitality/billing?record=hospitality.billingRule%3Aroom' },
      'nextHref',
    )!,
    'http://collection.local',
  )
  assert.equal(rule.pathname, '/admin/hospitality/billing')
  assert.equal(rule.searchParams.get('record'), 'hospitality.billingRule:room')
  assert.equal(rule.searchParams.get('page'), '3')
  assert.equal(rule.searchParams.get('q'), 'An')
  for (const nextHref of [
    'https://example.invalid/',
    '//example.invalid/',
    'javascript:alert(1)',
    '/admin/hospitality/../../website',
    '/admin/hospitality/\\example.invalid',
  ])
    assert.equal(collectionCellHref(props, filtered, { id: 'x', nextHref }, 'nextHref'), null)
})

test('Hospitality custom record links escape collection interception while sort/filter links stay in the paged store', () => {
  const current = new URL('https://hotel.test/admin/hospitality/product-fulfillments?company=hotel&lang=en')
  for (const recordParam of ['request', 'booking', 'delivery', 'connection']) {
    const record = new URL(current)
    record.searchParams.set(recordParam, 'record-1')
    assert.equal(isHospitalityCollectionNavigation({ recordParam }, record, current), false)
    for (const key of ['record', 'create', 'dialog']) {
      const next = new URL(current)
      next.searchParams.set(key, '1')
      assert.equal(isHospitalityCollectionNavigation({ recordParam }, next, current), false)
    }
    const filtered = new URL(current)
    filtered.searchParams.set('state', 'waiting')
    filtered.searchParams.set('sort', 'description')
    assert.equal(isHospitalityCollectionNavigation({ recordParam }, filtered, current), true)
    filtered.searchParams.set('company', 'another')
    assert.equal(isHospitalityCollectionNavigation({ recordParam }, filtered, current), false)
  }
})

test('Stock record back links keep the selected queue and row while overriding forged tenant scope', () => {
  const back =
    '/admin/hospitality/product-fulfillments?state=waiting&q=water&page=2&company=other#row=request-1'
  const current = `/admin/hospitality/product-fulfillments?company=hotel&lang=en&request=request-1&returnTo=${encodeURIComponent(back)}`
  const result = new URL(
    hospitalityRecordBack(current, '/admin/hospitality/product-fulfillments'),
    'http://hospitality.local',
  )
  assert.equal(result.searchParams.get('company'), 'hotel')
  assert.equal(result.searchParams.get('lang'), 'en')
  assert.equal(result.searchParams.get('state'), 'waiting')
  assert.equal(result.searchParams.get('page'), '2')
  assert.equal(result.hash, '#row=request-1')
  const unsafe = new URL(current, 'http://hospitality.local')
  unsafe.searchParams.set('returnTo', 'https://outside.invalid/steal')
  assert.equal(
    new URL(hospitalityRecordBack(unsafe.href, '/admin/hospitality/product-fulfillments'), unsafe).origin,
    unsafe.origin,
  )
})
