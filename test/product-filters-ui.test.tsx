import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { filterModalDefinition as definition } from '../packages/ketsuite/src/modules/product_backend/modal/filter-modal-view.tsx'
import { savedFilterMenu } from '../packages/ketsuite/src/modules/product_backend/filters/menu.tsx'
import type {
  FilterModalData,
  SavedFilter,
} from '../packages/ketsuite/src/modules/product_backend/filters/state.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const data: FilterModalData = {
  id: 'draft',
  listKey: 'product.templates',
  name: 'Mine',
  shared: true,
  isDefault: false,
  state: { presets: ['sale'] },
  existing: true,
  revisionId: 'r1',
  lang: 'vi',
}
const context: RecordModalContext<FilterModalData> = {
  id: 'draft',
  kind: 'product.savedFilter',
  creating: false,
  tab: '',
  data,
  t: (key) => key,
  outcome: () => null,
  fieldError: () => null,
  draft: (_key, fallback = '') => fallback,
  draftChecked: (_key, _value, fallback = false) => fallback,
  busy: false,
  dialog: null,
  href: () => '',
  state: (_key, fallback = '') => fallback,
}
test('P56 saved filter native modal preserves refused text and share choice; delete bypasses edit fields', () => {
  const c = {
    ...context,
    draft: () => '  Duplicate  ',
    draftChecked: () => false,
    fieldError: (key: string) => (key === 'name' ? 'Duplicate filter' : null),
  }
  const html = renderToString(definition.body!(c) as TemplateResult)
  assert.match(html, / {2}Duplicate {2}/)
  assert.match(html, /Duplicate filter/)
  assert.match(html, /maxlength="60"/)
  assert.doesNotMatch(html, /checked/)
  assert.match(html, /product-filter-help/)
  const form = new FormData()
  form.set('name', '  Duplicate  ')
  form.set('shared', 'on')
  const input = definition.commands!.save!.input!(form, c, {})
  assert.deepEqual(input, {
    id: 'draft',
    listKey: 'product.templates',
    name: '  Duplicate  ',
    shared: true,
    default: false,
    state: data.state,
    expectedRevisionId: 'r1',
  })
  assert.deepEqual(definition.commands!.delete!.input!(new FormData(), c, {}), {
    id: 'draft',
    listKey: 'product.templates',
    expectedRevisionId: 'r1',
  })
  assert.ok(definition.dialogs!.delete!.confirmation)
})
test('P56 saved menu labels exact matching state, exposes only own edit and links to native modal', () => {
  const row: SavedFilter = {
    id: 'one',
    name: 'Lot',
    owned: false,
    shared: true,
    revisionId: 'r1',
    href: '/admin/product/variants?use=tracked',
    active: true,
    isDefault: false,
  }
  const shared = renderToString(
    savedFilterMenu('/admin/product/variants?use=tracked&company=acme&branch=branch-1', [row], 'en'),
  )
  assert.match(shared, /company=acme/)
  assert.match(shared, /branch=branch-1/)
  assert.match(shared, /Saved: Lot/)
  assert.match(shared, /Share/)
  assert.doesNotMatch(shared, /Edit filter/)
  assert.match(shared, /product.savedFilter/)
  const own = renderToString(
    savedFilterMenu('/admin/product/variants?use=tracked', [{ ...row, owned: true }], 'en'),
  )
  // Under the filter's own name (P56).
  assert.match(own, /Edit filter &quot;Lot&quot;|Edit filter "Lot"/)
  const changed = renderToString(
    savedFilterMenu('/admin/product/variants', [{ ...row, owned: true, active: false }], 'en'),
  )
  assert.doesNotMatch(changed, /Saved: Lot|Edit filter/)
})

test('P56 SKU save refreshes its collection without replacing the shell or losing the current query', async (t) => {
  const { variantList } = await import('../packages/ketsuite/src/modules/product_backend/variants/island.tsx')
  const doc = new EventTarget(),
    win = new EventTarget(),
    lifetime = new AbortController()
  const reads: unknown[] = []
  const globals: Record<string, unknown> = {
    document: doc,
    window: win,
    location: new URL('http://ket.local/admin/product/variants?use=tracked&sort=code'),
    history: { state: null, replaceState() {} },
    navigator: { onLine: true },
    fetch: async (_url: unknown, init: RequestInit) => {
      reads.push(JSON.parse(String(init.body)))
      return Response.json({
        ok: true,
        value: {
          page: 1,
          pages: 1,
          total: 0,
          query: { page: 1 },
          rows: [],
          categories: [],
          favorites: [],
          counts: { active: 0, archived: 0, goods: 0, service: 0 },
          money: false,
          stock: false,
          isEmpty: false,
        },
      })
    },
  }
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  t.after(() => {
    lifetime.abort()
    for (const [key, value] of previous)
      if (value) Object.defineProperty(globalThis, key, value)
      else Reflect.deleteProperty(globalThis, key)
  })
  const island = variantList({
    href: '/admin/product/variants?use=tracked&sort=code',
    lang: 'en',
    pageSize: 25,
    read: 'product_backend.searchVariants',
    labels: {},
  } as Parameters<typeof variantList>[0])
  island.mount!({ root: new EventTarget(), lifetime: lifetime.signal } as never)
  await new Promise((resolve) => setImmediate(resolve))
  const changed = new CustomEvent('ket:records-changed', {
    cancelable: true,
    detail: { kind: 'product.savedFilter', ids: ['saved'] },
  })
  doc.dispatchEvent(changed)
  assert.equal(changed.defaultPrevented, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reads.length, 2)
  assert.deepEqual(reads[0], reads[1])
  assert.equal((reads[1] as { use: string }).use, 'tracked')
})
