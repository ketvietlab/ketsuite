import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { categoryModalDefinition as definition } from '../packages/ketsuite/src/modules/product_backend/modal/category-modal-view.tsx'
import {
  categoryControls,
  categoryResults,
  categoryFooter,
} from '../packages/ketsuite/src/modules/product_backend/categories/island.tsx'
import {
  categoryQuery,
  type CategoryModalData,
  type CategoryProps,
} from '../packages/ketsuite/src/modules/product_backend/categories/shared.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const data: CategoryModalData = {
  lang: 'en',
  record: {
    id: 'child',
    name: 'Child',
    parentId: 'root',
    incomeAccountId: '',
    expenseAccountId: '',
    active: true,
    revision: 'revision-1',
    path: 'Root / Child',
  },
  permissions: { general: true, accounts: true, lifecycle: true },
  parents: [{ value: 'root', label: 'Root' }],
  incomeAccounts: [{ value: 'income', label: '511 · Sales' }],
  expenseAccounts: [],
  inherited: { income: '511 · Sales', expense: '' },
  usage: { products: 1, children: [], pricelists: ['Retail'] },
  canArchive: false,
  canRestore: true,
}
const context = (permissions = data.permissions): RecordModalContext<CategoryModalData> => ({
  id: 'child',
  kind: 'product.category',
  creating: false,
  tab: '',
  data: { ...data, permissions },
  t: (key) => key,
  outcome: () => null,
  fieldError: (name) =>
    name === 'name' ? 'Invalid category name' : name === 'expectedRevision' ? 'Reload before saving' : null,
  draft: (name, fallback = '') => (name === 'name' ? '  Draft / raw  ' : fallback),
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: null,
  href: () => '',
  state: (_key, fallback = '') => fallback,
})
const render = (value: unknown) => renderToString(value as TemplateResult)
test('category modal preserves raw refused drafts, field associations and stale feedback', () => {
  const html = render(definition.body!(context()))
  assert.ok(html.includes('value="  Draft / raw  "'))
  assert.match(html, /aria-invalid="true"/)
  assert.equal((html.match(/data-layout="inline"/g) ?? []).length, 4)
  assert.match(html, /Invalid category name/)
  assert.match(html, /Reload before saving/)
  assert.match(html, /511 · Sales/)
  assert.match(html, /Retail/)
  assert.equal(definition.commands!.archive!.after, 'reload')
  assert.equal(definition.commands!.restore!.after, 'reload')
})
test('accountant UI locks general fields and submits only permitted account fields with the revision', () => {
  const c = context({ general: false, accounts: true, lifecycle: false })
  const html = render(definition.body!(c))
  assert.match(html, /<[^>]+name="name"[^>]+disabled/)
  // Parent and accounts are DS relation pickers (a relation field never is a plain select); their props
  // carry the lock.
  const picker = (name: string) => {
    const found = [...html.matchAll(/data-island="backend\.relation-select" data-props="([^"]+)"/g)]
      .map((match) => JSON.parse(match[1]!.replaceAll('&quot;', '"')) as { config: Record<string, unknown> })
      .find((props) => props.config.name === name)
    assert.ok(found, `${name} is a relation picker`)
    return found.config
  }
  assert.equal(picker('parentId').disabled, true)
  assert.equal(picker('incomeAccountId').disabled, false)
  assert.doesNotMatch(html, /<select[^>]+name="(parentId|incomeAccountId|expenseAccountId)"/)
  const form = new FormData()
  form.set('name', 'Forged')
  form.set('incomeAccountId', 'income')
  assert.deepEqual(definition.commands!.save!.input!(form, c, {}), {
    id: 'child',
    expectedRevision: 'revision-1',
    incomeAccountId: 'income',
    expenseAccountId: null,
  })
  assert.doesNotMatch(render(definition.actions!(c)), /category\.archive|category\.restore/)
  const read = context({ general: false, accounts: false, lifecycle: false })
  assert.doesNotMatch(render(definition.body!(read)), /<input|<select/)
  assert.doesNotMatch(render(definition.actions!(read)), /type="submit"/)
})
test('category collection SSR is bounded loading markup and strips modal state from collection URLs', () => {
  const query = categoryQuery(
    new URL(
      'http://local/admin/product/categories?lang=en&company=acme&status=archived&record=product.category%3Achild&dialog=archive&page=2&pageSize=900',
    ),
  )
  assert.equal(query.pageSize, 100)
  assert.equal(query.page, 2)
  assert.doesNotMatch(query.href, /record=|dialog=/)
  const props = {
    key: 'test-category',
    query,
    source: '/_ket/fn/product_backend.searchCategories',
    labels: {
      title: 'Categories',
      search: 'Search categories',
      searchSubmit: 'Search',
      loading: 'Loading categories',
      status: 'Status',
      active: 'Active',
      archived: 'Archived',
      all: 'All',
      selectAll: 'Select all',
      selectRow: 'Select row',
      sortedAscending: 'Ascending',
      sortedDescending: 'Descending',
      previousPage: 'Previous',
      nextPage: 'Next',
      loadError: 'Failed',
      retry: 'Retry',
      empty: 'Empty',
      emptyHint: 'Create a category',
    },
  } as CategoryProps
  const controls = render(categoryControls(props).view!())
  assert.match(controls, /name="company" value="acme"/)
  assert.match(controls, /name="status" value="archived"/)
  const result = render(categoryResults(props).view!())
  assert.match(result, /aria-busy="true"/)
  assert.match(result, /data-loading="true"/)
  assert.ok((result.match(/data-row="loading-/g) ?? []).length <= 10)
  assert.doesNotMatch(result, /Root|Child/)
  assert.doesNotMatch(render(categoryFooter(props).view!()), /<nav/)
})
