// The people list (user_backend/screens/users-list.tsx): the title, the create action, the bulk
// form and the page's guide from the server; the rows, the company and role choices and the
// check marks from the collection islands over the people read.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { SearchFilterConfig } from '@ketvietlab/design-system'
import {
  userGridRow,
  userListProps,
  usersScreen,
} from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'
import type { UserListRow } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'
import { rowListIslands } from '../packages/ketsuite/src/modules/backend/row-list-islands.ts'
import type { RowListAnswer } from '../packages/ketsuite/src/modules/backend/row-list-read.ts'
import { searchFilterLabels } from '../packages/ketsuite/src/modules/backend/search-filter.ts'
import type { TableSelection } from '../packages/ketsuite/src/ui/index.ts'
import { rowListHarness, settled, shownRows } from './helpers/row-list-harness.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const USERS = '/admin/users'
const bar: SearchFilterConfig = {
  name: 'user-people-filter',
  applyOnInput: true,
  query: '',
  facets: [],
  filters: [],
  groupBy: [],
  favorites: [],
  customFilterFields: [],
  customFilters: [],
  labels: searchFilterLabels(translate),
  manager: {
    applyFunction: 'user_backend.applySearchFilter',
    bodyId: 'user-people-list',
    applyInput: { listKey: 'user.users', returnTo: USERS },
  },
}

const bulk: TableSelection = {
  formId: 'user-people-bulk',
  action: '/admin/users/bulk?lang=en',
  hidden: { returnTo: `${USERS}?lang=en` },
  presentation: 'bar',
  actions: [
    { id: 'activate', label: 'user_backend.action.activateSelected' },
    { id: 'deactivate', label: 'user_backend.action.deactivateSelected', tone: 'danger' },
  ],
}

const props = (selection: TableSelection | null) => (href: string) =>
  userListProps(translate, { href, read: '/admin/users/read?lang=en', bar, lang: 'en', selection })

const person = (id: string, extra: Partial<UserListRow> = {}): UserListRow => ({
  id,
  login: id,
  name: 'Ada Lovelace',
  accessKind: 'internal',
  securityVersion: 1,
  passwordReady: true,
  active: true,
  superuser: false,
  ...extra,
})

const answer = (href: string): RowListAnswer => {
  const url = new URL(href, 'http://ket.local')
  const company = url.searchParams.get('company')
  const page = Number(url.searchParams.get('page') ?? 1)
  return {
    query: { q: '', page },
    href,
    total: 2,
    page,
    pages: 2,
    pageSize: 1,
    rows: [
      userGridRow(translate)(
        page === 1
          ? person('user/a', { passwordReady: false, active: false })
          : person('grace', { name: 'Grace', superuser: true }),
      ),
    ],
    groups: null,
    counts: {},
    isEmpty: false,
    sort: { name: `${USERS}?lang=en&sort=name%3Adesc`, login: `${USERS}?lang=en&sort=login%3Aasc` },
    sorted: { key: 'name', dir: 'asc' },
    previous: page > 1 ? `${USERS}?lang=en` : null,
    next: page < 2 ? `${USERS}?lang=en&page=2` : null,
    clear: `${USERS}?lang=en`,
    search: bar,
    menus: [
      {
        id: 'company',
        label: 'user_backend.field.company',
        items: [
          {
            id: 'kv',
            label: 'Két Việt',
            href: company === 'kv' ? `${USERS}?lang=en` : `${USERS}?lang=en&company=kv`,
            active: company === 'kv',
          },
        ],
      },
    ],
  }
}

const frame = {}

test('people list: the server renders the title, the create action, the bulk form and the guide, and no person', () => {
  const html = renderToString(
    usersScreen(translate, frame, {
      islands: rowListIslands(props(bulk)(`${USERS}?lang=en`)),
      createHref: '/admin/users/new?lang=en',
      selection: bulk,
      lang: 'en',
    }),
  )
  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.equal((html.match(/href="\/admin\/users\/new\?lang=en"/g) ?? []).length, 1)
  assert.match(html, /data-island="backend\.row-list-controls"[\s\S]*?data-ui="search-filter"/)
  assert.match(html, /data-island="backend\.row-list"[\s\S]*?data-ui="kt-placeholder"/)
  assert.match(html, /data-island="backend\.row-list-footer"/)
  assert.doesNotMatch(html, /Ada Lovelace/, 'no person is rendered on the server')
  // The bulk form waits hidden in the toolbar; the rows check into it by its id.
  assert.match(
    html,
    /<form data-ui="bulk-form" id="user-people-bulk" method="post" action="\/admin\/users\/bulk\?lang=en" hidden(?:="true")?>/,
  )
  assert.match(html, /name="returnTo" value="\/admin\/users\?lang=en"/)
  assert.match(
    html,
    /data-tone="danger"[^>]*name="action" value="deactivate"|name="action" value="deactivate"/,
  )
  // The page's guide, rendered on the server with its diagram.
  assert.match(html, /id="user-people-help"[\s\S]*?>Users<[\s\S]*?Changing several people at once/)
  assert.match(html, /```mermaid|data-ui="mermaid"|language-mermaid/)
})

test('people list: a viewer who may neither create nor change people gets neither', () => {
  const html = renderToString(
    usersScreen(translate, frame, {
      islands: rowListIslands(props(null)(`${USERS}?lang=en`)),
      createHref: null,
      selection: null,
      lang: 'en',
    }),
  )
  assert.doesNotMatch(html, /user_backend\.action\.createUser|\/admin\/users\/new/)
  assert.doesNotMatch(html, /data-ui="bulk-form"/)
})

test('people list: rows open the person’s page and check into the bulk form, which returns to the list as it is', async (t) => {
  const list = rowListHarness(t, props(bulk), answer, `${USERS}?lang=en`)
  const returnTo = list.form('user-people-bulk', `${USERS}?lang=en`)
  await settled()
  assert.deepEqual(shownRows(list.html()), ['user/a'])
  // The person's page, whose way back is this list at this row.
  const link = list
    .html()
    .match(/data-ui="kt-row-link"[^>]*href="([^"]+)"/)?.[1]
    ?.replaceAll('&amp;', '&')
  const opened = new URL(link ?? '', 'http://ket.local')
  assert.equal(opened.pathname, '/admin/users/user%2Fa')
  assert.equal(opened.searchParams.get('lang'), 'en')
  assert.equal(opened.searchParams.get('returnTo'), `${USERS}?lang=en#row=user%2Fa`)
  // Each row checks into the bulk form, named by the person.
  assert.match(
    list.html(),
    /data-ui="kt-row-select"[^>]*form="user-people-bulk"|form="user-people-bulk"[^>]*data-ui="kt-row-select"/,
  )
  assert.match(list.html(), /name="selected\.user\/a"/)
  assert.match(list.html(), /user_backend\.state\.archived/)
  assert.match(list.html(), /user_backend\.login\.preparing/)
  // The next page is read in place, and the bulk form now returns there.
  list.click(`${USERS}?lang=en&page=2`)
  await settled()
  assert.deepEqual(shownRows(list.html()), ['grace'])
  assert.equal(returnTo.value, `${USERS}?lang=en&page=2`)
  // Full authority is said on the row that holds it, by the shared cell renderer.
  assert.equal((list.html().match(/user_backend\.field\.superuser/g) ?? []).length, 1)
  // "Clear selection" in the bulk bar is the list's to answer.
  list.press('clear-selection', 'user-people-bulk')
  assert.deepEqual(shownRows(list.html()), ['grace'])
})

test('people list: the company choice comes with the read and is followed in place', async (t) => {
  const list = rowListHarness(t, props(null), answer, `${USERS}?lang=en`)
  await settled()
  const menu = list.html().slice(list.html().indexOf('id="user-people-list-menu-company'))
  assert.match(menu, /user_backend\.field\.company/)
  assert.match(menu, /role="menuitemradio"[^>]*aria-checked="false"[\s\S]*?Két Việt/)
  assert.doesNotMatch(list.html(), /data-ui="kt-row-select"/, 'no bulk form, nothing to check')
  assert.equal(list.click(`${USERS}?lang=en&company=kv`), true, 'followed in place')
  await settled()
  assert.equal(list.location(), `${USERS}?lang=en&company=kv`)
  assert.deepEqual(list.reads, [`${USERS}?lang=en`, `${USERS}?lang=en&company=kv`])
  assert.match(list.html(), /user_backend\.field\.company: Két Việt/)
})
