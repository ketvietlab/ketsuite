// The hospitality lists.
//
// A list opens as the shared results island over one paged read, so what is worth
// proving is that the page hands the island that read and the read narrows the
// collection. A URL the older search bar wrote (a group, a filter or a favourite)
// still opens the server list with that bar, and the bar's functions still write
// the URL state and keep favourites.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { Scope } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }
const PROPERTIES = '/admin/hospitality/properties'

/** What a results island is given, read from its own props. */
const islandProps = (html: string) => {
  const tag = html.match(/<[^>]*data-island="hospitality\.collection-results"[^>]*>/)?.[0] ?? ''
  return JSON.parse(
    (tag.match(/data-props="([^"]*)"/)?.[1] ?? '{}')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&'),
  ) as {
    source: string
    createHref: string | null
    states: Array<{ id: string; label: string }>
    columns: Array<{ key: string; emptyField?: string; tones?: Record<string, string> }>
    words: Record<string, string>
  }
}

type Booted = Awaited<ReturnType<typeof boot>>
const found = async (app: Booted, fn: string, input: Record<string, unknown> = {}) =>
  ((await app.client.call(fn, input)).value as { rows: Array<{ id: string }> }).rows
    .map((row) => row.id)
    .sort()

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const seed = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await seed('partner.savePartner', { id: 'company-partner', kind: 'company', name: 'Ket Hospitality' })
  await seed('company.saveCompany', { id: 'default', partnerId: 'company-partner', currency: 'VND' })
  await seed('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Hospitality admin',
    defaultCompanyId: 'default',
    superuser: true,
  })
  await seed('user.grantCompany', { id: 'admin:default', userId: 'admin', companyId: 'default' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.call('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HCM',
    name: 'Ket Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
    street1: '123 Nguyễn Huệ',
    locality: 'Thành phố Hồ Chí Minh',
  })
  await app.client.call('hospitality_core.saveProperty', {
    id: 'homestay',
    code: 'DLT',
    name: 'Ket Homestay',
    accommodationType: 'homestay',
    timezone: 'Asia/Ho_Chi_Minh',
    street1: '9 Đà Lạt',
    locality: 'Đà Lạt',
  })
  await app.client.call('hospitality_core.saveAmenity', {
    id: 'pool',
    code: 'POOL',
    name: 'Hồ bơi',
    scope: 'property',
  })
  await app.client.call('hospitality_core.saveAmenity', {
    id: 'balcony',
    code: 'BALC',
    name: 'Ban công',
    scope: 'room',
  })
  return app
}

test('hospitality properties HTTP: the list is the results island, and a URL the old bar wrote still opens it', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${PROPERTIES}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(islandProps(allHtml).source, /^\/_ket\/fn\/hospitality_core\.searchProperties/)
  // The legacy GET box is gone, not merely hidden behind the island.
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.deepEqual(await found(app, 'hospitality_core.searchProperties'), ['homestay', 'hotel'])
  assert.deepEqual(await found(app, 'hospitality_core.searchProperties', { q: 'Homestay' }), ['homestay'])
  // A house is set up before it opens, so neither is open yet.
  assert.deepEqual(await found(app, 'hospitality_core.searchProperties', { state: 'active' }), [])
  assert.deepEqual(await found(app, 'hospitality_core.searchProperties', { state: 'setup' }), [
    'homestay',
    'hotel',
  ])

  const grouped = await (await app.client.get(`${PROPERTIES}?lang=vi&group=accommodationType`)).text()
  assert.match(grouped, /data-island="backend\.search-filter"/)
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('hospitality lists HTTP: the old bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${PROPERTIES}?lang=vi`

  const applied = await app.client.call<{ href: string }>('hospitality_core.applySearchFilter', {
    listKey: 'hospitality.properties',
    returnTo,
    query: 'Ket',
    facets: [{ id: 'preset:homestay', type: 'filter', label: 'Homestay' }],
    groupBy: ['city'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, PROPERTIES)
  assert.equal(href.searchParams.get('q'), 'Ket')
  assert.deepEqual(href.searchParams.getAll('preset'), ['homestay'])
  assert.deepEqual(href.searchParams.getAll('group'), ['city'])

  const favorite = await app.client.call<{ id: string }>('hospitality_core.saveSearchFavorite', {
    name: 'Nhà dân đang mở',
    isDefault: true,
    state: {
      listKey: 'hospitality.properties',
      returnTo,
      facets: [{ id: 'preset:homestay', type: 'filter', label: 'Homestay' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopen = () =>
    app.client.call<{ href: string }>('hospitality_core.applySearchFilter', {
      listKey: 'hospitality.properties',
      returnTo,
      favoriteId: favorite.value.id,
      facets: [],
      groupBy: [],
      customFilters: [],
    })
  assert.deepEqual(new URL((await reopen()).value.href, 'http://ket.local').searchParams.getAll('preset'), [
    'homestay',
  ])

  await app.client.call('hospitality_core.deleteSearchFavorite', {
    listKey: 'hospitality.properties',
    id: favorite.value.id,
  })
  const gone = await reopen()
  assert.deepEqual(
    gone.value?.href ? new URL(gone.value.href, 'http://ket.local').searchParams.getAll('preset') : [],
    [],
  )
})

test('hospitality lists HTTP: every migrated hospitality list is a results island', async (t) => {
  const app = await boot(t)
  for (const [path, read] of [
    ['/admin/hospitality/properties', 'searchProperties'],
    ['/admin/hospitality/amenities', 'searchAmenities'],
    ['/admin/hospitality/policies', 'searchPolicies'],
  ] as const) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.equal(
      new URL(islandProps(html).source, 'http://ket.local').pathname,
      `/_ket/fn/hospitality_core.${read}`,
      path,
    )
    assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/, path)
  }
  // The guests in house (HOS-DEC-031; hospitality-stay-book.test.ts) and the guest bills
  // (hospitality-folio-book.test.ts) have their own island pages.
})

test('hospitality amenities HTTP: the search narrows what the list shows', async (t) => {
  const app = await boot(t)
  assert.deepEqual(await found(app, 'hospitality_core.searchAmenities'), ['balcony', 'pool'])
  assert.deepEqual(await found(app, 'hospitality_core.searchAmenities', { q: 'POOL' }), ['pool'])
})

test('hospitality billing HTTP: the rules page lists every charge type, what needs setting up first', async (t) => {
  const app = await boot(t)
  const path = '/admin/hospitality/billing/rules'

  // HOS-DEC-034: the page is the shared list's islands over `searchChargeRules`; a type is set up by opening its
  // row, so there is no create button.
  const page = await app.client.get(`${path}?lang=vi`)
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /<title>Quy tắc xuất hóa đơn<\/title>/)
  assert.doesNotMatch(html, /id="hospitality-billing-rules-create"/)
  // What the results island is given, read from its own props: the Help drawer on the page says the same words.
  const props = islandProps(html)
  assert.match(props.source, /^\/_ket\/fn\/hospitality_billing\.searchChargeRules/)
  assert.equal(props.createHref, null)
  assert.deepEqual(
    props.states.map((state) => [state.id, state.label]),
    [
      ['all', props.states[0]!.label],
      ['incomplete', 'Cần thiết lập'],
      ['ready', 'Đã thiết lập'],
    ],
  )
  assert.equal(props.words.searchPlaceholder, 'Tìm loại phí, tài khoản hoặc thuế')
  // The filter row is named in the page's language, not the design system's English default.
  assert.equal(props.words.filters, 'Bộ lọc')
  assert.deepEqual(
    [props.words['empty.income'], props.words['empty.tax.true'], props.words['empty.tax.false']],
    ['Theo mặc định', 'Không tính thuế', 'Chưa xác nhận'],
  )
  assert.equal(props.columns.find((column) => column.key === 'tax')?.emptyField, 'taxExempt')
  assert.deepEqual(props.columns.find((column) => column.key === 'state')?.tones, {
    incomplete: 'warning',
    ready: 'positive',
  })

  // Nothing is set up in a fresh company, so every charge type needs setup.
  const fresh = (await app.client.call('hospitality_billing.searchChargeRules', {})).value as {
    rows: Array<{ chargeType: string; state: string }>
    counts: { state: Record<string, number> }
  }
  assert.equal(fresh.rows.length, fresh.counts.state.all)
  assert.ok(fresh.rows.some((row) => row.chargeType === 'room'))
  assert.ok(fresh.rows.every((row) => row.state === 'incomplete'))
  assert.equal(fresh.counts.state.ready, 0)
})
