import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { KetTable } from '@ketvietlab/design-system'
import { ketTableDemoConfig } from '../packages/design-system/src/interactions/ket-table/demo.ts'
import {
  readRowAnchor,
  rememberRowAnchor,
  restoreRowAnchor,
  rowAnchorHref,
  takeRowAnchor,
} from '../packages/design-system/src/runtime/row-anchor.js'

// The anchor lifetime needs a URL, a history entry and a few elements, not a renderer.
// The real scroll and focus are recorded with the consumer screen in the browser.
type Box = { top: number; height: number }
const globals = globalThis as Record<string, unknown>
const saved = ['location', 'history', 'document', 'CSS', 'getComputedStyle', 'innerHeight'].map((name) => [
  name,
  globals[name],
])

let entry: { url: string; state: unknown; restoration: string }
const page = { scrollTop: 0 }
let focused: { name: string; options: unknown } | null = null

class Fake {
  readonly name: string
  dataset: Record<string, string> = {}
  parentElement: Fake | null = null
  box: Box = { top: 0, height: 36 }
  centred = 0
  scrollLeft = 0
  attributes: Record<string, string> = {}
  children: Fake[] = []
  constructor(name: string) {
    this.name = name
  }
  contains(other: Fake | null): boolean {
    for (let node = other; node; node = node.parentElement) if (node === this) return true
    return false
  }
  closest(selector: string): Fake | null {
    for (let node: Fake | null = this; node; node = node.parentElement) {
      if (selector === '[data-ui="kt-row"]' && node.dataset.row) return node
      if (selector === '[data-ui="kt-scroll"]' && node.dataset.ui === 'kt-scroll') return node
    }
    return null
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
  querySelector(selector: string): Fake | null {
    if (selector === '[data-ui="kt-row-link"]')
      return this.children.find((child) => child.name.endsWith('link')) ?? null
    const match = selector.match(/^\[data-ui="kt-row"\]\[data-row="(.+)"\]$/)
    return (match && this.children.find((child) => child.dataset.row === match[1])) || null
  }
  getBoundingClientRect() {
    return {
      top: this.box.top - page.scrollTop,
      bottom: this.box.top - page.scrollTop + this.box.height,
      height: this.box.height,
    }
  }
  scrollIntoView(options: { block: string }) {
    assert.equal(options.block, 'center')
    this.centred += 1
  }
  focus(options: unknown) {
    focused = { name: this.name, options }
  }
}

const dom = <T,>(node: Fake) => node as unknown as T

const table = () => {
  const root = new Fake('tbody')
  const rows = ['R-1041', 'R-1042', 'R/1043 #2'].map((id, index) => {
    const row = new Fake(`row-${id}`)
    row.dataset.row = id
    row.parentElement = root
    row.box = { top: 600 + index * 36, height: 36 }
    const link = new Fake(`row-${id}-link`)
    link.parentElement = row
    row.children.push(link)
    return row
  })
  root.children.push(...rows)
  return { root, rows }
}

beforeEach(() => {
  entry = { url: 'https://suite.test/reservations?status=arriving&page=2', state: null, restoration: 'auto' }
  page.scrollTop = 0
  focused = null
  globals.location = {
    get href() {
      return entry.url
    },
    get hash() {
      return new URL(entry.url).hash
    },
  }
  globals.history = {
    get state() {
      return entry.state
    },
    get scrollRestoration() {
      return entry.restoration
    },
    set scrollRestoration(value: string) {
      entry.restoration = value
    },
    replaceState: (state: unknown, _: string, url: string) => {
      entry = { ...entry, state, url }
    },
  }
  globals.document = { scrollingElement: page, documentElement: page, activeElement: null }
  globals.CSS = { escape: (value: string) => value }
  globals.getComputedStyle = () => ({ overflowY: 'visible' })
  globals.innerHeight = 900
})

afterEach(() => {
  for (const [name, value] of saved) globals[name as string] = value
})

test('the way back names its row in the fragment, replacing any fragment the list had', () => {
  assert.equal(
    rowAnchorHref('/reservations?status=arriving#row=R-1', 'R/1043 #2'),
    '/reservations?status=arriving#row=R%2F1043%20%232',
  )
  assert.deepEqual(readRowAnchor({ hash: '#row=R%2F1043%20%232' }, null), { id: 'R/1043 #2', top: null })
  for (const hash of ['', '#', '#row=', '#section-2', '#row=%E0%A4%A']) {
    assert.equal(readRowAnchor({ hash }, null), null, `"${hash}" names no row`)
  }
  // A position belongs to the row it was taken for.
  assert.deepEqual(readRowAnchor({ hash: '#row=R-1042' }, { kvRowAnchor: { id: 'R-1041', top: 120 } }), {
    id: 'R-1042',
    top: null,
  })
})

test('following a row names it on the current entry with where it stood, keeping the rest of the state', () => {
  const { rows } = table()
  entry.state = { book: 'kept' }
  page.scrollTop = 300
  assert.equal(rememberRowAnchor(dom<Element>(rows[1]!.children[0]!)), 'R-1042')
  assert.equal(entry.url, 'https://suite.test/reservations?status=arriving&page=2#row=R-1042')
  assert.deepEqual(entry.state, { book: 'kept', kvRowAnchor: { id: 'R-1042', top: 336 } })
  assert.equal(rememberRowAnchor(dom<Element>(new Fake('header-link'))), null)
  assert.equal(entry.url, 'https://suite.test/reservations?status=arriving&page=2#row=R-1042')
})

test('Back puts the row where it stood and focuses its link without scrolling again', () => {
  const { root, rows } = table()
  entry.url += '#row=R-1042'
  entry.state = { kvRowAnchor: { id: 'R-1042', top: 336 } }
  const anchor = takeRowAnchor()
  assert.deepEqual(anchor, { id: 'R-1042', top: 336 })
  // Until the rows arrive the browser must not restore an offset over a short page.
  assert.equal(entry.restoration, 'manual')
  assert.equal(restoreRowAnchor(dom<ParentNode>(root), anchor!), true)
  assert.equal(rows[1]!.getBoundingClientRect().top, 336)
  assert.equal(rows[1]!.centred, 0)
  assert.deepEqual(focused, { name: 'row-R-1042-link', options: { preventScroll: true } })
  assert.equal(entry.restoration, 'auto')
})

test('native record return keeps the row position and table scroll in its URL without storage', () => {
  const { root, rows } = table()
  const scroller = new Fake('table-scroll')
  scroller.dataset.ui = 'kt-scroll'
  scroller.scrollLeft = 214
  root.parentElement = scroller
  const link = rows[1]!.children[0]!
  link.attributes.href =
    '/record?id=R-1042&returnTo=' + encodeURIComponent('/reservations?status=arriving&page=2#row=R-1042')
  rows[1]!.dataset.rowHref = link.attributes.href!
  page.scrollTop = 300
  rememberRowAnchor(dom<Element>(link))
  const record = new URL(link.attributes.href!, entry.url)
  const back = new URL(record.searchParams.get('returnTo')!, entry.url)
  assert.equal(back.pathname + back.search, '/reservations?status=arriving&page=2')
  assert.equal(back.hash, '#row=R-1042&top=336&left=214')
  assert.equal(
    rows[1]!.dataset.rowHref,
    link.attributes.href,
    'whole-row navigation keeps the measured return',
  )
  // The native return creates a new history entry: all position must travel on the URL.
  entry = { url: back.href, state: null, restoration: 'auto' }
  page.scrollTop = 0
  scroller.scrollLeft = 0
  const anchor = takeRowAnchor()
  assert.deepEqual(anchor, { id: 'R-1042', top: 336, left: 214 })
  assert.equal(restoreRowAnchor(dom<ParentNode>(root), anchor!), true)
  assert.equal(rows[1]!.getBoundingClientRect().top, 336)
  assert.equal(scroller.scrollLeft, 214)
  assert.deepEqual(focused, { name: 'row-R-1042-link', options: { preventScroll: true } })
})

test('measured fragments validate coordinates and history wins for the matching row', () => {
  assert.deepEqual(readRowAnchor({ hash: '#row=R%26B&top=312.5&left=30' }, null), {
    id: 'R&B',
    top: 312.5,
    left: 30,
  })
  for (const coords of ['top=&left=', 'top=NaN&left=-10', 'top=Infinity&left=Infinity']) {
    assert.deepEqual(readRowAnchor({ hash: '#row=R-1042&' + coords }, null), { id: 'R-1042', top: null })
  }
  assert.deepEqual(
    readRowAnchor(
      { hash: '#row=R-1042&top=312&left=30' },
      { kvRowAnchor: { id: 'R-1042', top: 336, left: 214 } },
    ),
    { id: 'R-1042', top: 336, left: 214 },
  )
  assert.equal(
    rowAnchorHref('/reservations#old', 'R&B', { top: 312.5, left: 30 }),
    '/reservations#row=R%26B&top=312.5&left=30',
  )
})

test('remembering a row leaves an external record link on its original origin', () => {
  const { rows } = table()
  const link = rows[1]!.children[0]!
  const href = 'https://records.test/record?returnTo=' + encodeURIComponent(entry.url)
  link.attributes.href = href
  rememberRowAnchor(dom<Element>(link))
  assert.equal(link.attributes.href, href)
})

test('arriving through the link, or with the old position off screen, centres the row', () => {
  const { root, rows } = table()
  assert.equal(restoreRowAnchor(dom<ParentNode>(root), { id: 'R/1043 #2', top: null }), true)
  assert.equal(rows[2]!.centred, 1)
  assert.equal(page.scrollTop, 0)
  for (const top of [-10, 880]) {
    assert.equal(restoreRowAnchor(dom<ParentNode>(root), { id: 'R-1041', top }), true)
  }
  assert.equal(rows[0]!.centred, 2)
  assert.equal(focused?.name, 'row-R-1041-link')
})

test('a control in the row that already holds focus keeps it; focus elsewhere moves to the row link', () => {
  const { root, rows } = table()
  // A modal opened from the row's own action has handed focus back to that action.
  const action = new Fake('row-R-1042-action')
  action.parentElement = rows[1]!
  rows[1]!.children.push(action)
  const doc = globals.document as { activeElement: Fake | null }
  doc.activeElement = action
  assert.equal(restoreRowAnchor(dom<ParentNode>(root), { id: 'R-1042', top: 336 }), true)
  assert.equal(focused, null)
  assert.equal(rows[1]!.getBoundingClientRect().top, 336)
  // Focus on another row, or on the page, still goes to this row's link.
  doc.activeElement = rows[0]!.children[0]!
  assert.equal(restoreRowAnchor(dom<ParentNode>(root), { id: 'R-1042', top: 336 }), true)
  assert.deepEqual(focused, { name: 'row-R-1042-link', options: { preventScroll: true } })
})

test('a row no longer shown is reported, nothing moves and the browser gets scrolling back', () => {
  const { root } = table()
  entry.restoration = 'manual'
  assert.equal(restoreRowAnchor(dom<ParentNode>(root), { id: 'R-9999', top: 336 }), false)
  assert.equal(page.scrollTop, 0)
  assert.equal(focused, null)
  assert.equal(entry.restoration, 'auto')
  // A page without an anchor leaves the browser's own restoration alone.
  entry.url = 'https://suite.test/reservations'
  entry.restoration = 'auto'
  assert.equal(takeRowAnchor(), null)
  assert.equal(entry.restoration, 'auto')
})

test('KetTable marks the row the reader came back to on the row and its link, and only that row', () => {
  const rows = [
    { id: 'R-1041', name: 'Alex Morgan' },
    { id: 'R-1042', name: 'Sam Lee' },
  ]
  const render = (currentRow?: string | null) =>
    renderToString(
      <KetTable
        columns={[{ key: 'name', label: 'Guest', cell: (row: (typeof rows)[number]) => row.name }]}
        rows={rows}
        id={(row) => row.id}
        rowHref={(row) => `/reservations/${row.id}`}
        currentRow={currentRow}
        labels={ketTableDemoConfig.labels}
      />,
    ).replace(/<!--.*?-->/gs, '')
  const html = render('R-1042')
  assert.equal(html.match(/data-current="true"/g)?.length, 1)
  assert.match(html, /data-row="R-1042"[^>]*data-current="true"/)
  assert.match(html, /<a[^>]*href="\/reservations\/R-1042"[^>]*aria-current="true"/)
  assert.doesNotMatch(html, /<a[^>]*href="\/reservations\/R-1041"[^>]*aria-current/)
  for (const none of [undefined, null, 'R-9999']) {
    assert.doesNotMatch(render(none), /data-current|aria-current/)
  }
  // The mark is a start-edge bar on the first cell (a row pseudo-element would take a column),
  // mirrored for right-to-left, and on the whole row once rows stack on a phone.
  const css = readFileSync('packages/design-system/src/interactions/ket-table/styles.css', 'utf8').replace(
    /\s+/g,
    ' ',
  )
  const bar = 'box-shadow: inset var(--kv-space-0-5) 0 0 var(--kv-accent);'
  const mirrored = 'box-shadow: inset calc(-1 * var(--kv-space-0-5)) 0 0 var(--kv-accent);'
  assert.ok(css.includes(`[data-ui="kt-row"][data-current="true"] > :first-child { ${bar} }`))
  assert.ok(css.includes(`[data-ui="kt-row"][data-current="true"]:dir(rtl) > :first-child { ${mirrored} }`))
  assert.ok(css.includes(`[data-responsive="stack"] [data-ui="kt-row"][data-current="true"] { ${bar} }`))
  assert.ok(
    css.includes(
      `[data-responsive="stack"] [data-ui="kt-row"][data-current="true"]:dir(rtl) { ${mirrored} }`,
    ),
  )
  assert.ok(
    css.includes(
      `[data-responsive="stack"] [data-ui="kt-row"][data-current="true"] > :first-child { box-shadow: none; }`,
    ),
  )
  assert.doesNotMatch(css, /\[data-current="true"\]::?before/)
  assert.doesNotMatch(css, /\[data-current="true"\][^{]*\{[^}]*background/)
})
