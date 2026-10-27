// The roles list (user_backend/screens/roles-list.tsx): the frame and the page's guide from
// the server, the rows from the collection islands over the roles read.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { SearchFilterConfig } from '@ketvietlab/design-system'
import {
  roleGridRow,
  roleListProps,
  rolesScreen,
} from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'
import { rowListIslands } from '../packages/ketsuite/src/modules/backend/row-list-islands.ts'
import type { RowListAnswer } from '../packages/ketsuite/src/modules/backend/row-list-read.ts'
import { searchFilterLabels } from '../packages/ketsuite/src/modules/backend/search-filter.ts'
import { rowListHarness, settled, shownRows } from './helpers/row-list-harness.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const ROLES = '/admin/roles'
const bar: SearchFilterConfig = {
  name: 'user-roles-filter',
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
    bodyId: 'user-roles-list',
    applyInput: { listKey: 'user.roles', returnTo: ROLES },
  },
}
const props = (href: string) => roleListProps(translate, { href, read: '/admin/roles/read?lang=en', bar })

const role = {
  id: 'manager/a',
  name: 'Manager',
  description: 'Operational manager',
  mode: 'managed',
  templateVersion: 2,
  assignmentCount: 4,
  bundleCount: 3,
  healthIssues: ['stale-managed-role'],
}

const answer = (href: string): RowListAnswer => ({
  query: { q: '', page: 1 },
  href,
  total: 1,
  page: 1,
  pages: 1,
  pageSize: 30,
  rows: [roleGridRow(role as never)],
  groups: null,
  counts: {},
  isEmpty: false,
  sort: { name: '/admin/roles?sort=name%3Adesc', assignmentCount: '/admin/roles?sort=assignmentCount%3Aasc' },
  sorted: { key: 'name', dir: 'asc' },
  previous: null,
  next: null,
  clear: ROLES,
  search: bar,
})

test('roles list: the server renders the title, the guide and the islands in their loading state', () => {
  const html = renderToString(
    rolesScreen(
      translate,
      {},
      { islands: rowListIslands(props(`${ROLES}?lang=en`)), createHref: null, lang: 'en' },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  // Roles are run by Két Việt: the header offers no create action.
  assert.doesNotMatch(html, /user_backend\.action\.createRole/)
  const controls = html.slice(
    html.indexOf('data-ui="list-page-controls"'),
    html.indexOf('data-ui="list-page-body"'),
  )
  assert.match(controls, /data-island="backend\.row-list-controls"[\s\S]*?data-ui="search-filter"/)
  const body = html.slice(html.indexOf('data-ui="list-page-body"'))
  assert.match(body, /data-island="backend\.row-list"[\s\S]*?data-ui="kt-placeholder"/)
  assert.doesNotMatch(html, /Operational manager/, 'no role is rendered on the server')
  assert.match(html, /data-island="backend\.row-list-footer"/)
  // The page's guide, Markdown and diagram rendered on the server.
  assert.match(html, /id="user-roles-help"[\s\S]*?>Roles<[\s\S]*?Search and filter/)
  assert.match(html, /```mermaid|data-ui="mermaid"|language-mermaid/)
  // The legacy preset path is gone: a role is built from a template, not a preset.
  assert.doesNotMatch(html, /permission-presets/)
})

test('roles list: a role opens in its record modal, with its counts and its health', async (t) => {
  const list = rowListHarness(t, props, answer, `${ROLES}?lang=en`)
  await settled()
  assert.deepEqual(list.reads, [`${ROLES}?lang=en`])
  assert.deepEqual(shownRows(list.html()), ['manager/a'])
  assert.match(
    list.html(),
    /data-ui="kt-row-link"[^>]*href="\/admin\/roles\?lang=en&amp;record=user\.role%3Amanager%2Fa"/,
  )
  assert.doesNotMatch(list.html(), />v2</)
  assert.match(list.html(), /data-col="assignments"[\s\S]*?4/)
  assert.match(list.html(), /data-col="areas"[\s\S]*?3/)
  // Roles are run by Két Việt: nothing to check a row for.
  assert.doesNotMatch(list.html(), /data-ui="kt-row-select"/)
  assert.match(list.html(), /user_backend\.roles\.stale/)
  assert.match(list.html(), /user_backend\.roles\.announce/, 'the live region speaks of roles')
})
