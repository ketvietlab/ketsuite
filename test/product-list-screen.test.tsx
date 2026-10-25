// The product list's frame and its three islands (product_backend/screens/list.tsx,
// product_backend/list/island.tsx): the server renders the frame and the loading
// state, the first client render is the same markup, and the islands follow the
// list's links in place with one read each — push per decision, replace for a
// correction, and Back reads the URL without writing it.

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { setMaxListeners } from 'node:events'
import { effect, html, renderIsland, renderToString, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { ListState, Translator } from '@ketvietlab/ketjs'
import type { SearchFilterConfig } from '@ketvietlab/design-system'
import { productsScreen } from '../packages/ketsuite/src/modules/product_backend/screens/list.tsx'
import {
  PRODUCT_LIST_KEY,
  productList,
  productListControls,
  productListFooter,
  productSearchConfig,
  type ProductListProps,
} from '../packages/ketsuite/src/modules/product_backend/list/island.tsx'
import {
  LIST_LABEL_KEYS,
  listMessages,
} from '../packages/ketsuite/src/modules/product_backend/list/messages.ts'
import type {
  ProductListAnswer,
  ProductListRow,
} from '../packages/ketsuite/src/modules/product_backend/list/read.ts'
import { searchFilterLabels } from '../packages/ketsuite/src/modules/backend/search-filter.ts'

const messages: Record<string, string> = {
  'product_backend.screen.title': 'Sản phẩm',
}
const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const labels = {
  ...(Object.fromEntries(LIST_LABEL_KEYS.map((key) => [key, listMessages.vi[`list.${key}`]!])) as Record<
    (typeof LIST_LABEL_KEYS)[number],
    string
  >),
  region: 'Kết quả',
  selectAll: 'Chọn tất cả dòng',
  selectRow: 'Chọn dòng',
  sortedAscending: 'Tăng dần',
  sortedDescending: 'Giảm dần',
  previousPage: 'Trang trước',
  nextPage: 'Trang sau',
  loading: 'Đang tải dữ liệu…',
  loadError: 'Không tải được',
  retry: 'Thử lại',
  empty: 'Chưa có sản phẩm nào.',
  emptyHint: 'Tạo mẫu sản phẩm đầu tiên.',
  typeGoods: 'Hàng hoá',
  typeService: 'Dịch vụ',
  create: 'Tạo sản phẩm',
}

const search: SearchFilterConfig = {
  name: 'product-template-filter',
  presentation: 'expanded',
  applyOnInput: true,
  size: 'default',
  query: '',
  facets: [],
  filters: [
    { id: 'preset:goods', label: 'Hàng hoá', active: false, group: 'type', groupLabel: 'Loại' },
    { id: 'preset:service', label: 'Dịch vụ', active: false, group: 'type', groupLabel: 'Loại' },
    { id: 'archived', label: 'Bao gồm đã lưu trữ', active: false, group: 'state', groupLabel: 'Trạng thái' },
  ],
  groupBy: [
    { id: 'categoryId', label: 'Danh mục', active: false },
    {
      id: 'createdAt',
      label: 'Ngày tạo',
      active: false,
      options: [{ id: 'createdAt:month', label: 'Ngày tạo / Tháng', active: false }],
    },
  ],
  favorites: [],
  customFilterFields: [{ value: 'listPrice', label: 'Giá bán', type: 'number' }],
  customFilters: [],
  labels: searchFilterLabels(translate),
  manager: {
    applyFunction: 'product_backend.applySearchFilter',
    bodyId: 'product-template-list',
    applyInput: { listKey: 'product.templates', returnTo: '/admin/product/templates' },
  },
}

const props = (href = '/admin/product/templates'): ProductListProps => ({
  read: 'stock_backend.searchProductTemplates',
  href,
  timezone: 'Asia/Ho_Chi_Minh',
  lang: 'vi',
  pageSize: 2,
  labels,
  search,
  createHref: '/admin/product/templates/new',
  bulk: { action: '/admin/product/templates/bulk', archive: true, delete: true },
})

const PARTS = {
  controls: ['product.template-list-controls', productListControls],
  body: ['product.template-list', productList],
  footer: ['product.template-list-footer', productListFooter],
} as const
const serverRender = (href?: string, part: keyof typeof PARTS = 'body') =>
  renderIsland(PARTS[part][0], PARTS[part][1], props(href), { tag: 'div', key: PRODUCT_LIST_KEY })

test('product list: the frame keeps one title, the create action and contributed actions; the islands fill controls, body and footer', () => {
  const page = renderToString(
    productsScreen(
      translate,
      { chrome: { create: { label: 'Tạo sản phẩm', path: '/admin/product/templates/new?lang=vi' } } },
      {
        controls: html`${trustedMarkup(serverRender(undefined, 'controls'))}`,
        body: html`${trustedMarkup(serverRender())}`,
        footer: html`${trustedMarkup(serverRender(undefined, 'footer'))}`,
      },
      html`<a data-ui="action" href="/admin/channels/products">Kênh bán</a>`,
    ),
  )
  assert.equal(page.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.equal(page.match(/data-ui="topbar"/g), null)
  assert.match(page, /data-ket-slot="backend\.content">(?:<!--[^>]*-->)*<section data-ui="list-page"/)
  const headerStart = page.indexOf('data-ui="list-page-header"')
  const header = page.slice(headerStart, page.indexOf('</header>', headerStart))
  assert.match(header, /href="\/admin\/product\/templates\/new\?lang=vi"/)
  assert.match(header, /data-ui="list-page-tools"[\s\S]*?Kênh bán/)
  // Everything that changes with the query is an island's: the bar in the page's controls
  // slot (as the design system's list places it), the rows in its body, the pager in its footer.
  const controls = page.slice(
    page.indexOf('data-ui="list-page-controls"'),
    page.indexOf('data-ui="list-page-body"'),
  )
  assert.match(controls, /data-island="product\.template-list-controls"/)
  assert.match(controls, /data-ui="search-filter"/)
  assert.match(
    controls,
    /<form id="product-template-bulk" method="post" action="\/admin\/product\/templates\/bulk">/,
  )
  const body = page.slice(
    page.indexOf('data-ui="list-page-body"'),
    page.indexOf('data-ui="list-page-footer"'),
  )
  assert.match(body, /data-product-list="true" aria-busy="true"/)
  assert.doesNotMatch(body, /data-ui="search-filter"/)
  assert.match(body, /data-ui="kt-placeholder"/)
  assert.match(page.slice(page.indexOf('data-ui="list-page-footer"')), /data-product-list-footer="true"/)
  assert.doesNotMatch(
    body,
    /data-ui="kt-row" data-row="(?!loading-)/,
    'the server renders placeholders, no rows',
  )
  assert.doesNotMatch(page, /data-key="\{/, 'the islands are keyed by their read and URL, not by every prop')
  // The screen's guide, in the content slot, Markdown and diagram rendered on the server.
  assert.match(page, /id="product-list-help"[\s\S]*?>Sản phẩm<[\s\S]*?Tìm và lọc/)
  assert.match(page, /```mermaid|data-ui="mermaid"|language-mermaid/)
})

test('product list: the server render and the first client render are the same markup, for several URLs', () => {
  for (const href of [
    '/admin/product/templates',
    '/admin/product/templates?view=kanban&lang=en',
    '/admin/product/templates?q=serum&group=categoryId&sort=listPrice:desc',
  ]) {
    for (const part of Object.keys(PARTS) as Array<keyof typeof PARTS>) {
      const client = renderToString(PARTS[part][1](props(href)).view())
      assert.ok(serverRender(href, part).includes(client), `${part} ${href}`)
    }
  }
  const kanban = renderToString(productListControls(props('/admin/product/templates?view=kanban')).view())
  assert.match(
    kanban,
    /href="\/admin\/product\/templates\?view=kanban"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/product\/templates\?view=kanban"/,
  )
})

test('product list: the bar follows the applied query: chips, choices, saved searches and the way back', () => {
  const state: ListState = {
    q: 'serum',
    presets: ['goods'],
    filters: [{ kind: 'rule', field: 'listPrice', operator: 'gt', value: 100 }],
    groupBy: [{ key: 'createdAt', interval: 'month' }],
    sort: [{ key: 'name', dir: 'asc' }],
    openGroups: [],
    groupPages: {},
    page: 1,
    includeArchived: true,
    favoriteId: 'fav-1',
  }
  const config = productSearchConfig(
    { ...search, favoriteHref: '/admin/product/templates?modal=favorite' },
    state,
    [{ id: 'fav-1', name: 'Hàng đắt', isDefault: true }],
    '/admin/product/templates?q=serum',
  )
  assert.equal(config.query, 'serum', 'typed text stays in the field')
  assert.deepEqual(
    config.facets.map((facet) => [facet.type, facet.id, facet.label]),
    [
      ['filter', 'preset:goods', 'Hàng hoá'],
      ['filter', 'archived', 'Bao gồm đã lưu trữ'],
      ['filter', 'rule:0', config.customFilters![0]!.label],
      ['groupBy', 'createdAt:month', 'Ngày tạo / Tháng'],
      ['favorite', 'fav-1', 'Hàng đắt'],
    ],
  )
  assert.match(config.customFilters![0]!.label, /Giá bán/)
  assert.deepEqual(
    config.filters.map((option) => [option.id, option.active]),
    [
      ['preset:goods', true],
      ['preset:service', false],
      ['archived', true],
    ],
  )
  assert.equal(config.groupBy[1]!.options![0]!.active, true)
  assert.deepEqual(config.favorites, [{ id: 'fav-1', label: 'Hàng đắt', isDefault: true, active: true }])
  assert.equal(config.manager?.applyInput?.returnTo, '/admin/product/templates?q=serum')
  // Saving keeps what is applied now: the link is rebuilt from the list's current address.
  assert.equal(config.favoriteHref, '/admin/product/templates?q=serum&modal=favorite')
  assert.equal(
    productSearchConfig(search, state, [], '/admin/product/templates?q=serum').favoriteHref,
    undefined,
    'who may not save is offered no link',
  )
})

// ── The islands in a browser-shaped harness ──────────────────────────────────

const row = (id: string, name: string): ProductListRow => ({
  id,
  name,
  type: 'goods',
  code: `${id.toUpperCase()}-1`,
  categoryId: null,
  category: null,
  uomId: null,
  unit: null,
  listPrice: '100',
  saleOk: true,
  purchaseOk: true,
  active: true,
  variants: 0,
  image: null,
  margin: null,
  available: 3,
})
const catalogue = [row('a', 'Alpha'), row('b', 'Beta'), row('c', 'Gamma')]

/** A stand-in for the read: two rows a page, a page past the end clamped to the last. */
const answerFor = (href: string): ProductListAnswer => {
  const url = new URL(href, 'http://ket.local')
  const pages = 2
  const page = Math.min(Math.max(1, Number(url.searchParams.get('page') ?? 1)), pages)
  const at = (target: number) => {
    const next = new URL(url)
    if (target > 1) next.searchParams.set('page', String(target))
    else next.searchParams.delete('page')
    return `${next.pathname}${next.search}`
  }
  return {
    query: {
      presets: [],
      filters: [],
      groupBy: [],
      sort: [{ key: 'name', dir: 'asc' }],
      openGroups: [],
      groupPages: {},
      page,
      includeArchived: false,
    },
    href: at(page),
    total: catalogue.length,
    page,
    pages,
    pageSize: 2,
    rows: catalogue.slice((page - 1) * 2, page * 2),
    groups: null,
    counts: { goods: 3, service: 0 },
    isEmpty: false,
    sort: { name: '/admin/product/templates?sort=name:desc' },
    previous: page > 1 ? at(page - 1) : null,
    next: page < pages ? at(page + 1) : null,
    favorites: [],
    money: false,
    stock: true,
  }
}

class ElementFixture extends EventTarget {
  querySelector() {
    return null
  }
  querySelectorAll() {
    return []
  }
  contains() {
    return false
  }
  closest(_selector: string): unknown {
    return null
  }
}
class AnchorFixture extends ElementFixture {
  readonly href: string
  constructor(href: string) {
    super()
    this.href = href
  }
  override closest(selector: string) {
    return selector === 'a[href]' ? this : null
  }
}

type Reply = (href: string) => Promise<Response>
const harness = (t: TestContext, start = '/admin/product/templates') => {
  const origin = 'http://ket.local'
  let current = new URL(start, origin)
  const entries = [current.href]
  let position = 0
  const writes: Array<['push' | 'replace', string]> = []
  const reads: string[] = []
  let reply: Reply = async (href) => Response.json({ ok: true, value: answerFor(href) })
  const doc = Object.assign(new EventTarget(), { querySelector: () => null, querySelectorAll: () => [] })
  const win = new EventTarget()
  const online = { onLine: true }
  const globals: Record<string, unknown> = {
    document: doc,
    window: win,
    navigator: online,
    location: {
      get href() {
        return current.href
      },
      get origin() {
        return origin
      },
      get pathname() {
        return current.pathname
      },
      get search() {
        return current.search
      },
      get hash() {
        return current.hash
      },
    },
    history: {
      state: null,
      pushState(_state: unknown, _title: string, url: string) {
        current = new URL(url, origin)
        entries.splice(++position, entries.length, current.href)
        writes.push(['push', `${current.pathname}${current.search}`])
      },
      replaceState(_state: unknown, _title: string, url: string) {
        current = new URL(url, origin)
        entries[position] = current.href
        writes.push(['replace', `${current.pathname}${current.search}`])
      },
    },
    requestAnimationFrame: (callback: () => void) => setImmediate(callback),
    fetch: async (_url: unknown, init: RequestInit) => {
      const href = String(JSON.parse(String(init.body)).href)
      reads.push(href)
      return reply(href)
    },
  }
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const lifetime = new AbortController()
  setMaxListeners(40, lifetime.signal)
  const root = new ElementFixture()
  // The three islands of one list share a store, so a link followed in any of them is the
  // list's; clicks here reach the results island's root.
  const parts = [productListControls, productList, productListFooter].map((part) => part(props(start)))
  let markup = ''
  const stop = effect(() => {
    markup = parts.map((part) => renderToString(part.view())).join('')
  })
  t.after(() => {
    lifetime.abort()
    for (const part of parts) part.dispose?.()
    stop()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const [controls, results, footer] = parts
  controls!.mount!({ root: new ElementFixture() as never, lifetime: lifetime.signal } as never)
  results!.mount!({ root: root as never, lifetime: lifetime.signal } as never)
  footer!.mount!({ root: new ElementFixture() as never, lifetime: lifetime.signal } as never)
  let bubbled = true
  const click = (href: string) => {
    const event = Object.assign(new Event('click', { cancelable: true, bubbles: true }), { button: 0 })
    Object.defineProperty(event, 'target', { value: new AnchorFixture(new URL(href, origin).href) })
    root.dispatchEvent(event)
    bubbled = !event.cancelBubble
    return event.defaultPrevented
  }
  const back = (steps = 1) => {
    position -= steps
    current = new URL(entries[position]!)
    const event = new CustomEvent('ket:popstate', { cancelable: true })
    doc.dispatchEvent(event)
    return event.defaultPrevented
  }
  return {
    html: () => markup,
    reads,
    writes,
    entries: () => entries.slice(),
    location: () => `${current.pathname}${current.search}`,
    click,
    bubbled: () => bubbled,
    back,
    online,
    reply: (next: Reply) => {
      reply = next
    },
  }
}

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))
const shownRows = (markup: string) =>
  [...markup.matchAll(/data-ui="kt-row" data-row="([^"]+)"/g)].map((match) => match[1])

test('product list island: links push, a clamped page replaces, Back reads the URL and writes nothing', async (t) => {
  const list = harness(t)
  await settled()
  assert.deepEqual(list.reads, ['/admin/product/templates'])
  assert.deepEqual(shownRows(list.html()), ['a', 'b'])
  assert.match(
    list.html(),
    /data-ui="kt-row-select"[^>]*aria-label="Chọn dòng: Alpha"/,
    'a checkbox names its product',
  )
  assert.match(list.html(), /aria-busy="false"/)
  assert.match(list.html(), /1–2 trên 3 sản phẩm/, 'the live region announces the range')

  // The pager link is followed in place: one entry, one read.
  assert.equal(list.click('/admin/product/templates?page=2'), true)
  await settled()
  assert.deepEqual(list.writes, [['push', '/admin/product/templates?page=2']])
  assert.deepEqual(shownRows(list.html()), ['c'])

  // A page past the end comes back clamped: the URL is corrected without a new entry.
  assert.equal(list.click('/admin/product/templates?page=9'), true)
  await settled()
  assert.deepEqual(list.writes.slice(1), [
    ['push', '/admin/product/templates?page=9'],
    ['replace', '/admin/product/templates?page=2'],
  ])
  assert.equal(list.entries().length, 3)

  // Back: the island takes the entry from the shell, reads it, and writes no history.
  const written = list.writes.length
  let release: (() => void) | undefined
  list.reply(
    (href) =>
      new Promise((resolve) => {
        release = () => resolve(Response.json({ ok: true, value: answerFor(href) }))
      }),
  )
  assert.equal(list.back(2), true)
  // A page read before is on screen at once, while it is read again behind it.
  assert.deepEqual(shownRows(list.html()), ['a', 'b'])
  release!()
  await settled()
  assert.equal(list.writes.length, written, 'popstate never writes')
  assert.equal(list.reads.at(-1), '/admin/product/templates')

  // A record link and a route modal are the shell's to follow.
  assert.equal(list.click('/admin/product/templates/a?returnTo=x'), false)
  assert.equal(list.click('/admin/product/templates?modal=favorite'), false)
  assert.equal(list.click('/admin/users'), false)
})

test('product list islands: the bar, the rows and the pager are one list over one read', async (t) => {
  const list = harness(t)
  await settled()
  assert.deepEqual(list.reads, ['/admin/product/templates'], 'one read serves all three islands')
  // The footer's pager comes from the answer the rows came from.
  assert.match(
    list.html(),
    /data-product-list-footer="true">[\s\S]*?href="\/admin\/product\/templates\?page=2"/,
  )
  // A link followed in the rows moves the bar too: the bulk form returns to the new page.
  assert.equal(list.click('/admin/product/templates?page=2'), true)
  await settled()
  assert.match(
    list.html(),
    /data-product-list-controls="true">[\s\S]*?name="returnTo" value="\/admin\/product\/templates\?page=2"/,
  )
  assert.doesNotMatch(
    list.html(),
    /data-product-list-footer="true">[\s\S]*?href="\/admin\/product\/templates\?page=2"/,
    'the last page offers no next page',
  )
})

test('product list island: a view link it follows in place still reaches the document, so an open popover closes', async (t) => {
  const list = harness(t)
  await settled()
  assert.equal(list.click('/admin/product/templates?view=kanban'), true, 'the shell does not follow the link')
  assert.equal(list.bubbled(), true, 'the outside click of the filter popover and menus still hears it')
  await settled()
  assert.deepEqual(list.writes, [['push', '/admin/product/templates?view=kanban']])
})

test('product list island: a slow read dims the rows on screen instead of swapping them', async (t) => {
  const list = harness(t)
  await settled()
  let release: (() => void) | undefined
  list.reply(
    (href) =>
      new Promise((resolve) => {
        release = () => resolve(Response.json({ ok: true, value: answerFor(href) }))
      }),
  )
  list.click('/admin/product/templates?page=2')
  // Well inside the ~150ms a read has before it dims.
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(shownRows(list.html()), ['a', 'b'], 'the previous rows stay')
  assert.doesNotMatch(list.html(), /data-busy="true"/, 'a quick read does not flash')
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.match(list.html(), /data-ui="ket-table"[^>]*data-busy="true"/)
  assert.doesNotMatch(list.html(), /data-ui="kt-placeholder"/, 'the skeleton is for the first load only')
  release!()
  await settled()
  assert.deepEqual(shownRows(list.html()), ['c'])
  assert.doesNotMatch(list.html(), /data-busy="true"/)
})

test('product list island: a failed, offline or refused read says so and keeps what it can', async (t) => {
  const list = harness(t)
  await settled()
  list.reply(async () => new Response('{}', { status: 500 }))
  list.click('/admin/product/templates?page=2')
  await settled()
  await settled()
  assert.match(
    list.html(),
    /data-ui="notice"[^>]*data-tone="danger"[\s\S]*?Không tải được danh sách sản phẩm/,
  )
  assert.match(list.html(), /id="product-list-retry"/)
  assert.deepEqual(shownRows(list.html()), ['a', 'b'], 'the last answer stays on screen')

  list.online.onLine = false
  list.reply(async () => {
    throw new TypeError('network')
  })
  list.click('/admin/product/templates?page=2')
  await settled()
  await settled()
  assert.match(list.html(), /data-tone="warning"[\s\S]*?Mất kết nối mạng/)

  list.online.onLine = true
  list.reply(async () => new Response('{}', { status: 403 }))
  list.click('/admin/product/templates')
  await settled()
  await settled()
  assert.match(
    list.html(),
    /data-ui="empty" data-visual="locked"[\s\S]*?Bạn không có quyền xem danh sách sản phẩm/,
  )
  assert.deepEqual(shownRows(list.html()), [], 'a refused reader is shown no rows')
})

test('product list island: a card keeps its picture beside the name, with the price and status on one row', async (t) => {
  const list = harness(t, '/admin/product/templates?view=kanban')
  await settled()
  const markup = list.html().replace(/<!--[\s\S]*?-->/g, '')
  assert.match(markup, /data-ui="card-grid" data-minimum="wide"/, 'the column count follows the width')
  const cards = [...markup.matchAll(/<article data-ui="content-card"([^>]*)>([\s\S]*?)<\/article>/g)]
  assert.equal(cards.length, 2)
  const [attributes, alpha] = [cards[0]![1]!, cards[0]![2]!]
  assert.match(attributes, /data-media="start"/)
  assert.match(alpha, /^<div data-ui="card-media"><span data-ui="thumbnail"/, 'the picture leads the card')
  assert.match(
    alpha,
    /<div data-ui="card-content"><header data-ui="card-head">[\s\S]*?Alpha[\s\S]*?<p data-ui="card-summary">A-1<\/p>/,
  )
  assert.ok(alpha.includes(labels['card.available'].replace('{count}', '3')))
  assert.match(
    alpha,
    /<div data-ui="card-meta"><div data-ui="inline"[^>]*data-align="between"[^>]*>[\s\S]*?data-variant="headingLg"[^>]*>100\s₫<\/span>[\s\S]*?data-ui="badge"[\s\S]*?Đang bán/,
    'the price leads the last row and the status closes it',
  )
})

test('product list island: the status says whether a product sells, as its page does', async (t) => {
  const list = harness(t)
  await settled()
  list.reply(async (href) =>
    Response.json({
      ok: true,
      value: {
        ...answerFor(href),
        rows: [
          row('a', 'Alpha'),
          { ...row('b', 'Beta'), saleOk: false },
          { ...row('c', 'Gamma'), active: false },
        ],
      },
    }),
  )
  list.click('/admin/product/templates?page=2')
  await settled()
  const markup = list.html().replace(/<!--[\s\S]*?-->/g, '')
  const badge = (name: string) => {
    const found = markup.match(
      new RegExp(`data-row="${name}"[\\s\\S]*?<span data-ui="badge"([^>]*)>([\\s\\S]*?)</span>`),
    )
    return { tone: found?.[1]?.match(/data-tone="([^"]+)"/)?.[1], text: found?.[2]?.replace(/<[^>]+>/g, '') }
  }
  assert.deepEqual(badge('a'), { tone: 'positive', text: 'Đang bán' })
  assert.deepEqual(badge('b'), { tone: 'neutral', text: 'Không bán' })
  assert.deepEqual(badge('c'), { tone: 'neutral', text: 'Lưu trữ' })
})

test('product list island: a saved record is read again here, not by the shell', async (t) => {
  const list = harness(t)
  await settled()
  const before = list.reads.length
  const saved = new CustomEvent('ket:records-changed', {
    cancelable: true,
    detail: { kind: 'product.template', ids: ['a'] },
  })
  ;(globalThis.document as EventTarget).dispatchEvent(saved)
  assert.equal(saved.defaultPrevented, true, 'the shell leaves the content slot alone')
  await settled()
  assert.equal(list.reads.length, before + 1)
})

test('product list: the stock figure is not named like the flag that lets a product sell', () => {
  // "Có thể bán" once named both, so the column read as a yes/no about selling.
  assert.equal(listMessages.vi['list.col.available'], 'Tồn kho')
  assert.equal(listMessages.vi['list.field.available'], 'Tồn kho')
  assert.equal(listMessages.vi['list.card.available'], 'Tồn kho: {count}')
  assert.deepEqual(
    Object.entries(listMessages.vi).filter(([, label]) => /có thể bán/iu.test(label)),
    [],
  )
})
