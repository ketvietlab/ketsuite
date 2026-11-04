import assert from 'node:assert/strict'
import { setMaxListeners } from 'node:events'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { effect, renderToString } from '@ketvietlab/ketjs-view'
import productBackend from '../packages/ketsuite/src/modules/product_backend/index.ts'
import { variantMessages } from '../packages/ketsuite/src/modules/product_backend/variants/messages.ts'
import type { VariantAnswer } from '../packages/ketsuite/src/modules/product_backend/variants/shape.ts'
import {
  variantHref,
  variantInput,
  variantList,
  type VariantListLabels,
} from '../packages/ketsuite/src/modules/product_backend/variants/island.tsx'

// The Variants list island (Sản phẩm › Biến thể): one paged read per query, the URL as its
// state, money and stock columns only when the read says the viewer may see them, and a row
// that opens its product's page with the way back to that row.

class ElementFixture extends EventTarget {
  querySelector() {
    return null
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
  getAttribute() {
    return this.href
  }
}

const labels = {
  ...Object.fromEntries(
    [
      'search',
      'searchPlaceholder',
      'searchSubmit',
      'status',
      'active',
      'archived',
      'all',
      'type',
      'typeAll',
      'goods',
      'service',
      'category',
      'categoryAll',
      'code',
      'name',
      'barcode',
      'price',
      'cost',
      'onHand',
      'available',
      'noMatch',
      'noMatchHint',
      'empty',
      'emptyHint',
      'goTemplates',
      'pager',
      'selectAll',
      'selectRow',
      'sortedAscending',
      'sortedDescending',
      'previousPage',
      'nextPage',
      'loading',
      'loadError',
      'retry',
      'clearFilters',
      'offline',
      'retryHint',
      'deniedTitle',
      'deniedMessage',
      'missingRow',
      'announceNone',
    ].map((key) => [key, `<${key}>`]),
  ),
  sortAsc: '{column} ↑',
  sortDesc: '{column} ↓',
  announce: '{from}–{to}/{total}',
} as VariantListLabels

const answer = (
  rows: Array<Partial<VariantAnswer['rows'][number]> & { id: string }>,
  extra: Partial<VariantAnswer> = {},
): VariantAnswer => ({
  query: {
    q: '',
    type: 'all',
    categoryId: null,
    status: 'active',
    sort: 'name',
    dir: 'asc',
    page: 1,
    pageSize: 30,
  },
  total: rows.length,
  page: 1,
  pages: 1,
  rows: rows.map((row) => ({
    templateId: `t-${row.id}`,
    code: null,
    name: row.id,
    values: '',
    barcode: null,
    type: 'goods',
    price: '100000',
    cost: null,
    onHand: null,
    available: null,
    active: true,
    ...row,
  })),
  counts: { active: rows.length, archived: 0, goods: rows.length, service: 0 },
  categories: [],
  isEmpty: false,
  money: false,
  stock: false,
  ...extra,
})

const shirts = () =>
  answer(
    [
      { id: 'small', templateId: 'shirt', name: 'Áo thun', values: 'Nhỏ', code: 'AT-S', price: '200000' },
      {
        id: 'large',
        templateId: 'shirt',
        name: 'Áo thun',
        values: 'Lớn',
        code: 'AT-L',
        price: '230000',
        cost: '120000',
        onHand: 5,
        available: 4,
      },
    ],
    { money: true, stock: true, categories: [{ id: 'clothes', name: 'Quần áo' }] },
  )

/** What a read answers: an answer, a refusal as the server sends it, or `null` for a dropped connection. */
type Reply = (input: Row) => VariantAnswer | Response | null | Promise<VariantAnswer | Response | null>

const READ = 'stock_backend.searchProductVariants'

const harness = (t: TestContext, start = '/admin/product/variants', first?: Reply) => {
  const origin = 'http://ket.local'
  let current = new URL(start, origin)
  const writes: string[] = []
  const reads: Row[] = []
  let reply: Reply = first ?? shirts
  const doc = new EventTarget()
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
      get hash() {
        return current.hash
      },
    },
    history: {
      state: null,
      pushState(_state: unknown, _title: string, url: string) {
        current = new URL(url, origin)
        writes.push(`${current.pathname}${current.search}`)
      },
      replaceState(_state: unknown, _title: string, url: string) {
        current = new URL(url, origin)
        writes.push(`replace ${current.pathname}${current.search}`)
      },
    },
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, `/_ket/fn/${READ}`)
      const input = JSON.parse(String(init.body)) as Row
      reads.push(input)
      const value = await reply(input)
      if (value === null) throw new TypeError('Failed to fetch')
      return value instanceof Response ? value : Response.json({ ok: true, value })
    },
  }
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const lifetime = new AbortController()
  setMaxListeners(20, lifetime.signal)
  const root = new ElementFixture()
  const island = variantList({ href: start, lang: 'vi', pageSize: 30, read: READ, labels })
  let markup = ''
  const stop = effect(() => {
    markup = renderToString(island.view())
  })
  const initial = markup
  t.after(() => {
    lifetime.abort()
    stop()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  island.mount!({ root: root as never, lifetime: lifetime.signal } as never)
  const click = (href: string) => {
    const event = Object.assign(new Event('click', { cancelable: true, bubbles: true }), { button: 0 })
    Object.defineProperty(event, 'target', { value: new AnchorFixture(new URL(href, origin).href) })
    root.dispatchEvent(event)
    return { prevented: event.defaultPrevented, bubbled: !event.cancelBubble }
  }
  const type = (value: string) => {
    const event = new Event('input', { bubbles: true })
    Object.defineProperty(event, 'target', {
      value: { name: 'q', value, form: { action: `${origin}/admin/product/variants` } },
    })
    root.dispatchEvent(event)
  }
  /** Back or Forward to `path`, as the shell announces it. */
  const back = (path: string) => {
    current = new URL(path, origin)
    const event = new CustomEvent('ket:popstate', { cancelable: true })
    doc.dispatchEvent(event)
    return event.defaultPrevented
  }
  const retry = () => {
    const event = new Event('click', { cancelable: true, bubbles: true })
    const button = Object.assign(new ElementFixture(), {
      closest: (selector: string) => (selector === '[name="variants-retry"]' ? button : null),
    })
    Object.defineProperty(event, 'target', { value: button })
    root.dispatchEvent(event)
  }
  return {
    first: initial,
    html: () => markup,
    reads,
    writes,
    click,
    type,
    back,
    retry,
    online,
    win,
    reply: (next: Reply) => {
      reply = next
    },
  }
}

/** One row's markup, up to the next row. */
const rowMarkup = (markup: string, id: string) =>
  markup.slice(markup.indexOf(`data-row="${id}"`)).split('data-ui="kt-row"')[0]!

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))
const shownRows = (markup: string) =>
  [...markup.matchAll(/data-ui="kt-row" data-row="([^"]+)"/g)].map((match) => match[1])

test('variants list: the screen’s words survive the module’s messages', () => {
  const merged = productBackend.messages as Record<'vi' | 'en', Record<string, string>>
  for (const lang of ['vi', 'en'] as const)
    for (const [key, text] of Object.entries(variantMessages[lang]))
      assert.equal(merged[lang]![key], text, `${lang} ${key} is not replaced by another screen's`)
})

test('variants list: the URL is the query, and a change resets the page', () => {
  assert.deepEqual(
    variantInput('/admin/product/variants?q=%C3%A1o&type=goods&category=c1&page=3&sort=code&dir=desc', 30),
    {
      q: 'áo',
      // No use in the URL (P56 filters by one): the read takes every product.
      use: 'all',
      type: 'goods',
      // No tag in the URL (P42 filters by one): the read gets none.
      tagId: '',
      categoryId: 'c1',
      status: 'active',
      sort: 'code',
      dir: 'desc',
      page: 3,
      pageSize: 30,
    },
  )
  assert.equal(
    variantHref('/admin/product/variants?q=a&page=3', { type: 'service' }),
    '/admin/product/variants?q=a&type=service',
  )
  assert.equal(variantHref('/admin/product/variants?q=a', { q: null }), '/admin/product/variants')
})

test('variants list island: one read per query, money and stock columns, a row opens its product', async (t) => {
  const list = harness(t, '/admin/product/variants?type=goods&q=%C3%A1o')
  assert.equal(list.first, list.html(), 'nothing changes before the read answers')
  assert.match(list.first, /aria-busy="true"|data-loading/, 'the first render is the loading frame')
  await settled()
  assert.deepEqual(list.reads, [
    {
      q: 'áo',
      use: 'all',
      type: 'goods',
      tagId: '',
      categoryId: '',
      status: 'active',
      sort: 'name',
      dir: 'asc',
      page: 1,
      pageSize: 30,
    },
  ])
  const html = list.html()
  assert.deepEqual(shownRows(html), ['small', 'large'])
  assert.match(html, /Áo thun[\s\S]*?Lớn/, 'the values sit under the product name')
  assert.doesNotMatch(
    rowMarkup(html, 'large'),
    /&lt;archived&gt;|&lt;active&gt;/,
    'a selling row carries no badge',
  )
  assert.match(html, /&lt;cost&gt;/, 'a viewer allowed money sees the cost column')
  assert.match(html, /&lt;onHand&gt;[\s\S]*&lt;available&gt;/, 'stock adds its figures')
  assert.match(html, /120\.000/)
  assert.match(html, /&lt;type&gt;: &lt;goods&gt;/, 'the type menu names the type in force')
  assert.match(html, /&lt;category&gt;: &lt;categoryAll&gt;/)
  assert.match(html, /role="status" aria-live="polite">.*1–2\/2/s, 'the live region announces the range')
  assert.match(
    html,
    /href="\/admin\/product\/templates\/shirt\?returnTo=%2Fadmin%2Fproduct%2Fvariants%3Ftype%3Dgoods%26q%3D%25C3%25A1o%23row%3Dlarge"/,
    'a row opens its product with the way back to the row',
  )

  // A menu choice is followed in place, keeps the search and starts on page 1; the click still bubbles.
  assert.deepEqual(list.click('/admin/product/variants?q=%C3%A1o&type=service'), {
    prevented: true,
    bubbled: true,
  })
  await settled()
  assert.deepEqual(list.writes, ['/admin/product/variants?q=%C3%A1o&type=service'])
  assert.equal(list.reads.at(-1)!.type, 'service')

  // A product page is the shell's to load.
  assert.deepEqual(list.click('/admin/product/templates/shirt'), { prevented: false, bubbled: true })
  assert.equal(list.reads.length, 2)
})

test('variants list island: without money or stock the columns are absent, not blank', async (t) => {
  const list = harness(t, '/admin/product/variants', () => answer([{ id: 'plain', price: '50000' }]))
  await settled()
  assert.deepEqual(shownRows(list.html()), ['plain'])
  assert.doesNotMatch(list.html(), /&lt;cost&gt;|&lt;onHand&gt;|&lt;available&gt;/)
  assert.match(list.html(), /&lt;price&gt;/)
})

test('variants list island: a sort header names what it does and pushes the order', async (t) => {
  const list = harness(t)
  await settled()
  assert.match(list.html(), /&lt;name&gt; ↓/, 'the sorted column offers the other direction')
  assert.match(list.html(), /&lt;code&gt; ↑/)
  list.click(variantHref('/admin/product/variants', { sort: 'code' }))
  await settled()
  assert.deepEqual(list.writes, ['/admin/product/variants?sort=code'])
  assert.equal(list.reads.at(-1)!.sort, 'code')
})

test('variants list island: typing filters after a pause, once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const list = harness(t)
  await settled()
  list.type('n')
  list.type('nh')
  list.type('nhỏ')
  t.mock.timers.tick(249)
  assert.equal(list.reads.length, 1)
  t.mock.timers.tick(1)
  await settled()
  assert.deepEqual(list.writes, ['/admin/product/variants?q=nh%E1%BB%8F'])
  assert.deepEqual(
    list.reads.map((read) => read.q),
    ['', 'nhỏ'],
  )
  list.type('nhỏ ')
  t.mock.timers.tick(250)
  await settled()
  assert.equal(list.reads.length, 2, 'the same text again reads nothing')
  list.type('nhỏ x')
  t.mock.timers.tick(250)
  await settled()
  assert.equal(
    list.writes.at(-1),
    'replace /admin/product/variants?q=nh%E1%BB%8F+x',
    'Back skips the keystrokes',
  )
})

test('variants list island: Back shows the page it left at once and reads it again', async (t) => {
  const list = harness(t)
  await settled()
  list.reply(() => answer([{ id: 'tailoring', type: 'service' }]))
  list.click('/admin/product/variants?type=service')
  await settled()
  assert.deepEqual(shownRows(list.html()), ['tailoring'])
  list.reply(() => new Promise(() => {}))
  assert.equal(list.back('/admin/product/variants'), true)
  assert.deepEqual(shownRows(list.html()), ['small', 'large'])
  assert.equal(list.reads.length, 3)
})

test('variants list island: a page past the end is corrected without a new entry', async (t) => {
  const list = harness(t, '/admin/product/variants?page=9', () =>
    answer([{ id: 'only' }], { page: 1, query: { ...answer([]).query, page: 1 } }),
  )
  await settled()
  assert.deepEqual(list.writes, ['replace /admin/product/variants'])
  assert.deepEqual(shownRows(list.html()), ['only'])
})

test('variants list island: a failed read keeps the rows and offers a retry', async (t) => {
  const list = harness(t)
  await settled()
  list.reply(() => Response.json({ ok: false }, { status: 500 }))
  list.click('/admin/product/variants?status=all')
  await settled()
  assert.match(list.html(), /data-tone="danger"[\s\S]*?&lt;loadError&gt;/)
  list.reply(() => answer([{ id: 'old', active: false }]))
  list.retry()
  await settled()
  assert.deepEqual(shownRows(list.html()), ['old'])
  assert.doesNotMatch(list.html(), /&lt;loadError&gt;/)
  assert.match(
    rowMarkup(list.html(), 'old'),
    /&lt;archived&gt;/,
    'a variant not selling is badged in its row',
  )
})

test('variants list island: offline waits for the connection; a refusal says why', async (t) => {
  const offline = harness(t, '/admin/product/variants', () => null)
  offline.online.onLine = false
  await settled()
  assert.match(offline.html(), /data-tone="warning"[\s\S]*?&lt;offline&gt;/)
  offline.online.onLine = true
  offline.reply(() => answer([{ id: 'back' }]))
  offline.win.dispatchEvent(new Event('online'))
  await settled()
  assert.deepEqual(shownRows(offline.html()), ['back'])

  const denied = harness(t, '/admin/product/variants', () => Response.json({ ok: false }, { status: 403 }))
  await settled()
  assert.match(denied.html(), /&lt;deniedTitle&gt;/)
  assert.deepEqual(shownRows(denied.html()), [])
})

test('variants list island: an empty catalogue points to Products, no match clears the filters', async (t) => {
  const list = harness(t, '/admin/product/variants', () => answer([], { isEmpty: true }))
  await settled()
  assert.match(list.html(), /&lt;empty&gt;/)
  assert.match(list.html(), /href="\/admin\/product\/templates"[^>]*>[\s\S]*?&lt;goTemplates&gt;/)
  list.reply(() => answer([]))
  list.click('/admin/product/variants?q=zzz&type=service')
  await settled()
  assert.match(list.html(), /&lt;noMatch&gt;/)
  assert.match(list.html(), /href="\/admin\/product\/variants"[^>]*>[\s\S]*?&lt;clearFilters&gt;/)
})
