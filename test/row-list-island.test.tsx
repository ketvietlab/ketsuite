// The collection islands (ui/client/row-list-island.tsx): the server renders the frame's
// loading state and the first client render is the same markup; the islands follow the
// list's links in place with one read each, push per decision and replace for a correction,
// Back reads the URL without writing it, and every state the read can end in is shown.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderIsland, renderToString } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import type { SearchFilterConfig } from '@ketvietlab/design-system'
import {
  ROW_LIST_KEY,
  rowList,
  rowListControls,
  rowListFooter,
  rowListHref,
  type RowListProps,
} from '../packages/ketsuite/src/ui/client/row-list-island.tsx'
import { rowListLabels } from '../packages/ketsuite/src/modules/backend/row-list-islands.ts'
import type { RowListAnswer } from '../packages/ketsuite/src/modules/backend/row-list-read.ts'
import { messages } from '../packages/ketsuite/src/modules/backend/messages.ts'
import { searchFilterLabels } from '../packages/ketsuite/src/modules/backend/search-filter.ts'
import { rowListHarness, settled, shownRows } from './helpers/row-list-harness.ts'

const translate = ((key: string) => {
  const message = messages.vi![key.replace(/^backend\./, '')]
  return typeof message === 'string' ? message : key
}) as Translator
translate.locale = 'vi'
translate.has = () => true
translate.resolves = () => true

const PEOPLE = '/admin/people'
const people = [
  { id: 'a', name: 'An', active: true },
  { id: 'b', name: 'Bình', active: true },
  { id: 'c', name: 'Chi', active: true },
  { id: 'd', name: 'Dũng', active: false },
]

const peopleProps = (href: string, extra: Partial<RowListProps> = {}): RowListProps => ({
  read: '/admin/people/read',
  href,
  marker: 'people-list',
  lang: 'vi',
  columns: [
    {
      key: 'name',
      label: 'Tên',
      priority: 'primary',
      format: { kind: 'text', field: 'name' },
      sortKey: 'name',
    },
    {
      key: 'state',
      label: 'Trạng thái',
      format: {
        kind: 'status',
        field: 'state',
        tones: {
          on: { label: 'Đang làm', tone: 'positive' },
          off: { label: 'Đã nghỉ', tone: 'neutral' },
        },
      },
    },
  ],
  labels: rowListLabels(translate, {
    empty: 'Chưa có ai',
    emptyHint: 'Thêm người đầu tiên.',
    announce: '{from}–{to} trên {total} người',
    announceNone: 'Không có ai',
    create: 'Thêm người',
  }),
  controls: {
    kind: 'search',
    label: 'Tìm người',
    placeholder: 'Tìm theo tên',
    submitLabel: 'Tìm',
    facets: {
      param: 'archived',
      label: 'Trạng thái',
      options: [
        { id: 'active', value: null, label: 'Đang làm' },
        { id: 'all', value: '1', label: 'Gồm đã nghỉ' },
      ],
    },
  },
  open: { kind: 'page', path: '/admin/people/{id}', returnPath: PEOPLE },
  createHref: '/admin/people/new',
  chooseColumns: true,
  ...extra,
})

/** A stand-in for the read: two people a page, a page past the end clamped to the last. */
const peopleAnswer = (href: string, everyone = people): RowListAnswer => {
  const url = new URL(href, 'http://ket.local')
  const q = url.searchParams.get('q') ?? ''
  const found = everyone.filter((person) => person.name.toLowerCase().includes(q.toLowerCase()))
  const rows = found.filter((person) => url.searchParams.get('archived') === '1' || person.active)
  const pages = Math.max(1, Math.ceil(rows.length / 2))
  const page = Math.min(Math.max(1, Number(url.searchParams.get('page') ?? 1)), pages)
  const at = (target: number) => rowListHref(href, { page: target > 1 ? String(target) : null })
  return {
    query: { q, page },
    href: at(page),
    total: rows.length,
    page,
    pages,
    pageSize: 2,
    rows: rows
      .slice((page - 1) * 2, page * 2)
      .map((person) => ({ id: person.id, name: person.name, state: person.active ? 'on' : 'off' })),
    groups: null,
    counts: { active: found.filter((person) => person.active).length, all: found.length },
    isEmpty: everyone.length === 0,
    sort: { name: rowListHref(href, { sort: 'name:desc' }) },
    sorted: { key: 'name', dir: 'asc' },
    previous: page > 1 ? at(page - 1) : null,
    next: page < pages ? at(page + 1) : null,
    clear: PEOPLE,
  }
}

const PARTS = {
  controls: ['backend.row-list-controls', rowListControls],
  body: ['backend.row-list', rowList],
  footer: ['backend.row-list-footer', rowListFooter],
} as const

test('collection islands: the server renders the loading state only, and the first client render is the same markup', () => {
  for (const href of [PEOPLE, `${PEOPLE}?q=An&archived=1`, `${PEOPLE}?page=2&columns=name&lang=en`]) {
    for (const part of Object.keys(PARTS) as Array<keyof typeof PARTS>) {
      const [name, controller] = PARTS[part]
      const server = renderIsland(name, controller, peopleProps(href), { tag: 'div', key: ROW_LIST_KEY })
      const client = renderToString(controller(peopleProps(href)).view())
      assert.ok(server.includes(client), `${part} ${href}`)
      assert.doesNotMatch(server, /data-key="\{/, 'keyed by the read and the URL, not by every prop')
    }
  }
  const body = renderIsland('backend.row-list', rowList, peopleProps(PEOPLE), {
    tag: 'div',
    key: ROW_LIST_KEY,
  })
  assert.match(body, /data-people-list="true" aria-busy="true"/)
  assert.match(body, /data-ui="kt-placeholder"/)
  assert.doesNotMatch(body, /data-ui="kt-row" data-row="(?!loading-)/, 'placeholders, no rows')
  const controls = renderToString(rowListControls(peopleProps(`${PEOPLE}?q=An`)).view())
  assert.match(controls, /data-ui="list-search-input" id="people-list-search"[^>]*value="An"/)
  // The counts are not known before the first read; a choice shows none rather than a guess.
  assert.doesNotMatch(controls, /data-ui="list-facet-count"/)
})

test('collection islands: links push, a clamped page replaces, Back reads the URL and writes nothing', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, PEOPLE)
  await settled()
  assert.deepEqual(list.reads, [PEOPLE], 'one read serves all three islands')
  assert.deepEqual(shownRows(list.html()), ['a', 'b'])
  assert.match(list.html(), /aria-busy="false"/)
  assert.match(list.html(), /1–2 trên 3 người/, 'the live region announces the range')
  assert.match(list.html(), /data-people-list-footer="true">[\s\S]*?href="\/admin\/people\?page=2"/)

  assert.equal(list.click(`${PEOPLE}?page=2`), true)
  await settled()
  assert.deepEqual(list.writes, [['push', `${PEOPLE}?page=2`]])
  assert.deepEqual(shownRows(list.html()), ['c'])

  // A page past the end comes back clamped: the URL is corrected without a new entry.
  assert.equal(list.click(`${PEOPLE}?page=9`), true)
  await settled()
  assert.deepEqual(list.writes.slice(1), [
    ['push', `${PEOPLE}?page=9`],
    ['replace', `${PEOPLE}?page=2`],
  ])
  assert.equal(list.entries().length, 3)

  // Back: the island takes the entry from the shell, shows the page it read before at once,
  // reads it again behind it, and writes no history.
  const written = list.writes.length
  let release: (() => void) | undefined
  list.reply(
    (href) =>
      new Promise((resolve) => {
        release = () => resolve(Response.json({ ok: true, value: peopleAnswer(href) }))
      }),
  )
  assert.equal(list.back(2), true)
  assert.deepEqual(shownRows(list.html()), ['a', 'b'])
  release!()
  await settled()
  assert.equal(list.writes.length, written, 'popstate never writes')
  assert.equal(list.reads.at(-1), PEOPLE)

  // Another page, a record over the list and another origin are the shell's to follow.
  assert.equal(list.click('/admin/other'), false)
  assert.equal(list.click(`${PEOPLE}?record=people.person:a`), false)
  assert.equal(list.click('https://example.test/admin/people?page=2'), false)
  // A followed link still bubbles, so an open menu or popover closes.
  assert.equal(list.click(`${PEOPLE}?archived=1`), true)
  assert.equal(list.bubbled(), true)
})

test('collection islands: typing narrows after a pause; the first pause pushes, later ones replace', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, PEOPLE)
  await settled()
  list.type('people-list-search', 'B')
  list.type('people-list-search', 'Bì')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await settled()
  assert.deepEqual(list.writes, [['push', `${PEOPLE}?q=B%C3%AC`]], 'one read per pause, not per key')
  assert.deepEqual(shownRows(list.html()), ['b'])
  list.type('people-list-search', 'Bình')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await settled()
  assert.deepEqual(list.writes.at(-1), ['replace', `${PEOPLE}?q=B%C3%ACnh`])
  assert.equal(list.entries().length, 2, 'Back returns to the list as it was before the search')
  // Clearing the field is a search too, and it drops `q` from the URL.
  list.type('people-list-search', '')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await settled()
  assert.deepEqual(list.writes.at(-1), ['replace', PEOPLE])
})

test('collection islands: a query that came from a link or from Back is the one the field shows', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, PEOPLE)
  await settled()
  const field = list.field('people-list-search')
  field.value = 'Bình'
  list.type('people-list-search', 'Bình')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await settled()
  assert.equal(field.value, 'Bình', 'what the reader typed is left alone')
  list.click(PEOPLE)
  assert.equal(field.value, '', 'clearing the filters empties the field')
  await settled()
  list.back()
  assert.equal(field.value, 'Bình', 'Back brings the search back into the field')
})

test('collection islands: a status choice shows the counts of the same search, and drops them after a failure', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, `${PEOPLE}?q=n`)
  await settled()
  const facets = () =>
    [...list.html().matchAll(/<a data-ui="list-facet"[\s\S]*?<\/a>/g)].map((match) =>
      match[0].replace(/<!--k\[?-->/g, ''),
    )
  const [active, all] = facets()
  assert.match(active!, /aria-current="page"/)
  assert.match(active!, /Đang làm<\/span><span data-ui="list-facet-count">2</)
  assert.match(all!, /href="\/admin\/people\?q=n&amp;archived=1"/)
  assert.match(all!, /Gồm đã nghỉ<\/span><span data-ui="list-facet-count">3</)
  list.reply(async () => new Response('{}', { status: 500 }))
  list.click(`${PEOPLE}?q=n&archived=1`)
  await settled()
  await settled()
  assert.doesNotMatch(list.html(), /data-ui="list-facet-count"/, 'a stale count would read as current')
})

test('collection islands: a slow read dims the rows on screen; the skeleton is for the first load only', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, PEOPLE)
  await settled()
  let release: (() => void) | undefined
  list.reply(
    (href) =>
      new Promise((resolve) => {
        release = () => resolve(Response.json({ ok: true, value: peopleAnswer(href) }))
      }),
  )
  list.click(`${PEOPLE}?page=2`)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(shownRows(list.html()), ['a', 'b'], 'the previous rows stay')
  assert.doesNotMatch(list.html(), /data-busy="true"/, 'a quick read does not flash')
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.match(list.html(), /data-ui="ket-table"[^>]*data-busy="true"/)
  assert.doesNotMatch(list.html(), /data-ui="kt-placeholder"/)
  release!()
  await settled()
  assert.deepEqual(shownRows(list.html()), ['c'])
  assert.doesNotMatch(list.html(), /data-busy="true"/)
})

test('collection islands: a failed, offline or refused read says so; retry and the connection coming back read again', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, PEOPLE)
  await settled()
  list.reply(async () => new Response('{}', { status: 500 }))
  list.click(`${PEOPLE}?page=2`)
  await settled()
  await settled()
  assert.match(list.html(), /data-ui="notice"[^>]*data-tone="danger"[\s\S]*?Không tải được danh sách/)
  assert.match(list.html(), /id="people-list-retry"/)
  assert.deepEqual(shownRows(list.html()), ['a', 'b'], 'the last answer stays on screen')
  list.reply(async (href) => Response.json({ ok: true, value: peopleAnswer(href) }))
  assert.equal(list.retry('people-list-retry'), true)
  await settled()
  assert.deepEqual(shownRows(list.html()), ['c'])
  assert.doesNotMatch(list.html(), /data-ui="notice"/)

  list.online.onLine = false
  list.reply(async () => {
    throw new TypeError('network')
  })
  list.click(PEOPLE)
  await settled()
  await settled()
  assert.match(list.html(), /data-tone="warning"[\s\S]*?Mất kết nối mạng/)
  list.online.onLine = true
  list.reply(async (href) => Response.json({ ok: true, value: peopleAnswer(href) }))
  const before = list.reads.length
  list.window.dispatchEvent(new Event('online'))
  await settled()
  assert.equal(list.reads.length, before + 1, 'back online, the list reads itself again')
  assert.deepEqual(shownRows(list.html()), ['a', 'b'])

  list.reply(async () => new Response('{}', { status: 403 }))
  list.click(`${PEOPLE}?archived=1`)
  await settled()
  await settled()
  assert.match(
    list.html(),
    /data-ui="empty" data-visual="locked"[\s\S]*?Bạn không có quyền xem danh sách này/,
  )
  assert.deepEqual(shownRows(list.html()), [], 'a refused reader is shown no rows')
})

test('collection islands: nothing recorded yet invites the first one; nothing matching offers to clear the filters', async (t) => {
  const empty = rowListHarness(t, peopleProps, (href) => peopleAnswer(href, []), PEOPLE)
  await settled()
  assert.match(empty.html(), /data-visual="start"[\s\S]*?Chưa có ai[\s\S]*?href="\/admin\/people\/new"/)
  assert.match(empty.html(), /Không có ai/, 'the live region says there is nothing')
})

test('collection islands: a search that matches nothing names it and clears back to the whole list', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, `${PEOPLE}?q=zzz`)
  await settled()
  assert.match(list.html(), /data-visual="search"[\s\S]*?Không có kết quả phù hợp/)
  assert.match(list.html(), /Không tìm thấy kết quả cho “zzz”/)
  assert.match(list.html(), /href="\/admin\/people"[^>]*>[\s\S]*?Xoá bộ lọc/)
  assert.doesNotMatch(list.html(), /href="\/admin\/people\/new"/, 'creating is not the answer to a search')
})

test('collection islands: a saved record is read again here, not by the shell', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, PEOPLE)
  await settled()
  const before = list.reads.length
  const saved = new CustomEvent('ket:records-changed', {
    cancelable: true,
    detail: { kind: 'x', ids: ['a'] },
  })
  list.document.dispatchEvent(saved)
  assert.equal(saved.defaultPrevented, true, 'the shell leaves the content slot alone')
  await settled()
  assert.equal(list.reads.length, before + 1)
})

test('collection islands: a row opens its page with the way back at that row', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, `${PEOPLE}?q=n`)
  await settled()
  assert.match(
    list.html(),
    /data-ui="kt-row-link"[^>]*href="\/admin\/people\/a\?returnTo=%2Fadmin%2Fpeople%3Fq%3Dn%23row%3Da"/,
  )
  // Following it leaves the list to the shell, and this entry now names the row for Back.
  assert.equal(
    list.click('/admin/people/a?returnTo=%2Fadmin%2Fpeople%3Fq%3Dn%23row%3Da', { row: 'a' }),
    false,
  )
  assert.equal(list.hash(), '#row=a')
})

test('collection islands: coming back to a row marks it current', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, `${PEOPLE}?q=n#row=b`)
  await settled()
  await settled()
  assert.match(
    list.html(),
    /data-ui="kt-row" data-row="b"[^>]*data-current="true"|data-row="b"[^>]*aria-current="true"/,
  )
})

test('collection islands: mounted before the shell moves the address, the list is the one the server rendered', async (t) => {
  // The shell renders the next page, then pushes its address: the old page's address is no query of this list,
  // and the row its fragment names is another list's.
  const list = rowListHarness(
    t,
    peopleProps,
    peopleAnswer,
    '/admin/people/a?returnTo=x#row=b',
    `${PEOPLE}?q=n`,
  )
  await settled()
  assert.deepEqual(list.reads, [`${PEOPLE}?q=n`])
  assert.doesNotMatch(list.html(), /data-current="true"/)
})

test('collection islands: the columns after the first can be hidden, and the choice is a link', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, `${PEOPLE}?columns=name`)
  await settled()
  assert.match(list.html(), /data-col="name"/)
  assert.doesNotMatch(list.html(), /data-col="state"/)
  assert.match(list.html(), /href="\/admin\/people\?columns=name%2Cstate"/)
  assert.equal(list.click(`${PEOPLE}?columns=name%2Cstate`), true)
  await settled()
  assert.match(list.html(), /data-col="state"[\s\S]*?Đang làm/)
})

test('collection islands: a sortable header says what following it does', async (t) => {
  const list = rowListHarness(t, peopleProps, peopleAnswer, PEOPLE)
  await settled()
  assert.match(
    list.html(),
    /href="\/admin\/people\?sort=name%3Adesc"[^>]*aria-label="Tên, sắp xếp giảm dần"|aria-label="Tên, sắp xếp giảm dần"[^>]*href="\/admin\/people\?sort=name%3Adesc"/,
  )
})

const ROLES = '/admin/kinds'
const bar: SearchFilterConfig = {
  name: 'kinds-filter',
  applyOnInput: true,
  query: '',
  facets: [],
  filters: [{ id: 'preset:managed', label: 'Có sẵn', active: false, group: 'mode' }],
  groupBy: [],
  favorites: [],
  customFilterFields: [],
  customFilters: [],
  labels: searchFilterLabels(translate),
  manager: {
    applyFunction: 'kinds.applySearchFilter',
    bodyId: 'kinds-list',
    applyInput: { listKey: 'kinds', returnTo: ROLES },
  },
}
const kindsProps = (href: string): RowListProps => ({
  ...peopleProps(href),
  read: '/admin/kinds/read',
  marker: 'kinds-list',
  controls: { kind: 'bar', config: bar },
  open: { kind: 'record', record: 'kinds.kind', tab: 'rule' },
  pin: ['screen'],
})
const kindsAnswer = (href: string): RowListAnswer => {
  const answer = peopleAnswer(href)
  const q = new URL(href, 'http://ket.local').searchParams.get('q') ?? ''
  return { ...answer, search: { ...bar, query: q } }
}

test('collection islands: a row opens its record over the list, which the shell owns', async (t) => {
  const list = rowListHarness(
    t,
    kindsProps,
    kindsAnswer,
    `${ROLES}?screen=kinds&q=n&record=kinds.kind:a&tab=rule`,
  )
  await settled()
  // The record open when the page loaded is not part of the list's query.
  assert.deepEqual(list.reads, [`${ROLES}?screen=kinds&q=n`])
  assert.match(
    list.html(),
    /data-ui="kt-row-link"[^>]*href="\/admin\/kinds\?screen=kinds&amp;q=n&amp;record=kinds\.kind%3Ab&amp;tab=rule"/,
  )
  assert.equal(list.click(`${ROLES}?screen=kinds&q=n&record=kinds.kind:b&tab=rule`, { row: 'b' }), false)
  // A parameter that names the page rather than the query makes a link another page.
  assert.equal(list.click(`${ROLES}?screen=other`), false)
})

test('collection islands: Back that closes a record lands on the query on screen and reads nothing', async (t) => {
  const list = rowListHarness(t, kindsProps, kindsAnswer, `${ROLES}?screen=kinds&q=n`)
  await settled()
  const reads = list.reads.length
  // The shell's record runtime opens a record over the list, and Back closes it.
  ;(globalThis as unknown as { history: History }).history.pushState(
    null,
    '',
    `${ROLES}?screen=kinds&q=n&record=kinds.kind:b`,
  )
  assert.equal(list.back(), true)
  assert.equal(list.reads.length, reads)
  // Forward onto the record is the shell's again.
  ;(globalThis as unknown as { history: History }).history.pushState(
    null,
    '',
    `${ROLES}?screen=kinds&q=n&record=kinds.kind:b`,
  )
  list.back(0)
  assert.equal(list.back(0), false)
})

test('collection islands: the bar follows the query each read applied', async (t) => {
  const list = rowListHarness(t, kindsProps, kindsAnswer, `${ROLES}?screen=kinds&q=Bì`)
  await settled()
  assert.match(
    list.html(),
    /data-kinds-list-controls="true">[\s\S]*?data-ui="search-filter"[\s\S]*?value="Bì"/,
  )
  list.click(`${ROLES}?screen=kinds&preset=managed`)
  await settled()
  assert.deepEqual(list.writes.at(-1), ['push', `${ROLES}?screen=kinds&preset=managed`])
  assert.doesNotMatch(list.html(), /value="Bì"/, 'the bar now holds the query the read applied')
})
