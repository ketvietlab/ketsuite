// The collection islands' read over a collection held in memory (backend/row-list-read.ts):
// the query as applied, the page clamped, counts that ignore their own group, every link
// the list shows, and nothing recorded yet told apart from nothing matching.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServeContext, Translator } from '@ketvietlab/ketjs'
import { rowListAnswer, rowListTarget } from '../packages/ketsuite/src/modules/backend/row-list-read.ts'
import { roleListSearch } from '../packages/ketsuite/src/modules/user_backend/search.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'vi'
translate.has = () => false
translate.resolves = () => false

const ctx = {
  translate: () => translate,
  localeOf: () => 'vi',
  callUnchecked: async () => [],
} as unknown as ServeContext
const url = new URL('http://ket.local/admin/roles/read')
const req = { headers: {} } as never

const roles = Array.from({ length: 5 }, (_, index) => ({
  id: `r${index}`,
  name: `Role ${String.fromCharCode(69 - index)}`,
  description: index === 0 ? 'Kế toán trưởng' : 'Bán hàng',
  mode: index < 4 ? 'managed' : 'custom',
  assignmentCount: index,
  healthIssues: index === 1 ? ['stale'] : [],
}))

const read = (href: string, rows = roles, pageSize = 2) =>
  rowListAnswer(ctx, url, req, {
    spec: roleListSearch,
    rows,
    target: rowListTarget(url, href, '/admin/roles')!,
    view: (row) => ({ id: row.id, name: row.name }),
    search: {
      name: 'user-roles-filter',
      bodyId: 'user-roles-list',
      functions: { apply: 'user_backend.applySearchFilter' },
    },
    pageSize,
  })

test('row list read: the default order, one page, and every link the list shows', async () => {
  const answer = await read('/admin/roles?lang=en')
  assert.equal(answer.total, 5)
  assert.equal(answer.pages, 3)
  assert.equal(answer.page, 1)
  assert.deepEqual(
    answer.rows.map((row) => row.name),
    ['Role A', 'Role B'],
    'sorted by the spec’s default, then paged',
  )
  assert.deepEqual(answer.sorted, { key: 'name', dir: 'asc' })
  assert.equal(answer.previous, null)
  assert.equal(answer.next, '/admin/roles?lang=en&page=2')
  // The header of the order in force turns it around; another starts ascending, on page 1.
  assert.equal(answer.sort.name, '/admin/roles?lang=en&sort=name%3Adesc')
  assert.equal(answer.sort.assignmentCount, '/admin/roles?lang=en&sort=assignmentCount%3Aasc')
  assert.equal(answer.clear, '/admin/roles?lang=en')
  // Clearing drops the query, and only the query: what else the URL carries stays.
  const asked = await read(
    '/admin/roles?lang=en&q=b%C3%A1n&preset=custom&columns=name&page=2&sort=name%3Adesc&from=menu',
  )
  assert.equal(asked.clear, '/admin/roles?lang=en&columns=name&from=menu')
  assert.equal(answer.isEmpty, false)
  assert.equal(answer.groups, null)
  // The bar holds the query as applied, and its apply returns to this very list.
  assert.equal(answer.search?.query, '')
  assert.equal(answer.search?.applyOnInput, true)
  assert.equal(answer.search?.manager?.applyInput?.returnTo, '/admin/roles?lang=en')
})

test('row list read: a page past the end is clamped, and the answer names the corrected URL', async () => {
  const answer = await read('/admin/roles?page=9')
  assert.equal(answer.page, 3)
  assert.equal(answer.href, '/admin/roles?page=3')
  assert.deepEqual(answer.query, { q: '', page: 3 })
  assert.deepEqual(
    answer.rows.map((row) => row.name),
    ['Role E'],
  )
  assert.equal(answer.previous, '/admin/roles?page=2')
  assert.equal(answer.next, null)
})

test('row list read: a preset’s count ignores its own group and keeps the rest of the query', async () => {
  const answer = await read('/admin/roles?q=b%C3%A1n&preset=custom')
  assert.deepEqual(
    answer.rows.map((row) => row.name),
    ['Role A'],
  )
  // Searching "bán" leaves four roles: three standard, one custom. Choosing "custom"
  // does not hide what "managed" would show instead.
  assert.equal(answer.counts.managed, 3)
  assert.equal(answer.counts.custom, 1)
  // Another group accumulates: of the custom roles matching "bán", none is unhealthy.
  assert.equal(answer.counts.unhealthy, 0)
  assert.equal(answer.search?.query, 'bán')
})

test('row list read: a grouped list answers its groups, each opening by a link, and no flat page', async () => {
  const answer = await read('/admin/roles?group=mode')
  assert.deepEqual(answer.rows, [])
  assert.equal(answer.previous, null)
  assert.equal(answer.next, null)
  assert.deepEqual(
    answer.groups?.map((group) => [group.label, group.count, group.open]),
    [
      ['custom', 1, false],
      ['managed', 4, false],
    ],
  )
  const opened = await read(
    new URL(answer.groups![1]!.href!, 'http://ket.local').href.slice('http://ket.local'.length),
  )
  const managed = opened.groups?.find((group) => group.count === 4)
  assert.equal(managed?.open, true)
  assert.deepEqual(
    managed?.rows?.map((row) => row.name),
    ['Role B', 'Role C', 'Role D', 'Role E'],
    'an open group carries its own rows, in the list’s order',
  )
  assert.equal(managed?.pager, undefined, 'a group pages only past ROW_LIST_PAGE_SIZE')
})

test('row list read: nothing recorded yet is not the same as nothing matching', async () => {
  const none = await read('/admin/roles', [])
  assert.equal(none.isEmpty, true)
  assert.equal(none.total, 0)
  const unmatched = await read('/admin/roles?q=zzz')
  assert.equal(unmatched.isEmpty, false)
  assert.equal(unmatched.total, 0)
  assert.equal(unmatched.page, 1, 'an empty result is page 1 of 1')
  // Rows the caller narrowed by its own parameter (a company, say) that leave none match nothing.
  const narrowed = await rowListAnswer(ctx, url, req, {
    spec: roleListSearch,
    rows: [] as typeof roles,
    target: rowListTarget(url, '/admin/roles?company=north', '/admin/roles')!,
    view: (row) => ({ id: row.id }),
    filters: ['company'],
  })
  assert.equal(narrowed.isEmpty, false)
  assert.equal(narrowed.clear, '/admin/roles', 'clearing drops the narrowing parameter too')
})

test('row list read: only the list’s own URL is read, less what opens over it', () => {
  assert.equal(rowListTarget(url, '/admin/users', '/admin/roles'), null)
  assert.equal(rowListTarget(url, 'https://elsewhere.test/admin/roles', '/admin/roles'), null)
  assert.equal(rowListTarget(url, '//elsewhere.test/admin/roles', '/admin/roles'), null)
  assert.equal(rowListTarget(url, 42, '/admin/roles'), null)
  const target = rowListTarget(
    url,
    '/admin/roles?q=a&record=user.role:x&tab=info&dialog=d#row=x',
    '/admin/roles',
  )
  assert.equal(`${target?.pathname}${target?.search}${target?.hash}`, '/admin/roles?q=a')
})
