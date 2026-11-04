import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, html } from '@ketvietlab/ketjs-view'
import {
  templateDialogs,
  templateCommands,
  templateActions,
} from '../packages/ketsuite/src/modules/sale_backend/modal/template-dialogs.tsx'
import {
  templateGrid,
  postedTemplateLines,
  templateDefinition,
  type Data,
} from '../packages/ketsuite/src/modules/sale_template_backend/record/view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
const order = () =>
  ({
    id: 'order',
    kind: 'sale.order',
    busy: false,
    recordChanged: true,
    dialog: { name: 'saveTemplateSection', params: { id: 'section' } },
    data: {
      record: { state: 'draft', revision: 4, lines: [{ id: 'section' }] },
      permissions: { templateSave: true, templateAdd: true, templateApply: true, templateChoices: true },
      templateSections: [
        { id: 'section', name: 'Equipment', existing: { revision: 3, id: 'copy', active: false } },
      ],
    },
    href: () => '/admin/sales/quotations/order?lang=en',
    t: (key: string) => key,
    fieldError: () => null,
    draft: (_name: string, value: string) => value,
  }) as unknown as RecordModalContext<SaleOrderModalData>
test('D29 native section dialogs block parent drafts and overwrite/replace use shared confirmation', () => {
  const c = order()
  for (const name of ['saveTemplateSection', 'addTemplateSection']) {
    const rendered = renderToString(html`${templateDialogs[name]!.view(c)}`)
    assert.match(rendered, /sale_template.saveParent/)
    assert.match(rendered, /disabled/)
    assert.doesNotMatch(rendered, /backend.relation-select/)
  }
  assert.equal(templateCommands.saveTemplateSection!.confirm!(c), 'sale_template.overwriteConfirm')
  assert.equal(templateCommands.applyQuoteTemplate!.confirm!(c), 'sale_template.replaceConfirm')
  const input = templateCommands.saveTemplateSection!.input(new FormData(), c, {})
  assert.equal(input.expectedRevision, 4)
  assert.equal(input.expectedTemplateRevision, 3)
  assert.equal(input.overwrite, true)
  const reader = renderToString(<div>{templateActions({ ...c, data: { ...c.data, permissions: {} } })}</div>)
  assert.doesNotMatch(reader, /data-ui="(button|menu)/)
})
test('D29 saving a section as a template opens its dialog over the tab open now, not an Info tab', () => {
  // A quotation page has no Info tab: a link to one left the page instead of opening the dialog.
  const c = {
    ...order(),
    tab: 'lines',
    href: (tab: string) => `/admin/sales/quotations/order?tab=${tab}&lang=en`,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const rendered = renderToString(<div>{templateActions(c)}</div>).replaceAll('&amp;', '&')
  assert.match(
    rendered,
    /href="\/admin\/sales\/quotations\/order\?tab=lines&lang=en&dialog=saveTemplateSection&dialogId=section"/,
  )
  assert.doesNotMatch(rendered, /tab=info/)
})
test('D29 section grid excludes nested sections, optional products and prices; grid merge preserves omitted rows', () => {
  const c = {
    creating: false,
    busy: false,
    data: {
      record: { kind: 'section', lines: [], teamIds: [], active: true },
      products: [],
      units: [],
      teams: [],
      save: true,
      lang: 'en',
    },
    t: (key: string) => key,
    draft: (_key: string, value: string) => value,
  } as unknown as RecordModalContext<Data>
  const grid = templateGrid(c)
  assert.ok(!grid.newRows!.some((item) => item.row.displayType === 'section'))
  assert.ok(!grid.columns.some((item) => ['optional', 'priceUnit', 'discount'].includes(item.key)))
  assert.equal(templateGrid({ ...c, data: { ...c.data, save: false } }).readOnly, true)
  const saved = [
    { id: 'a', productId: 'sku', productUomQty: '2' },
    { id: 'b', displayType: 'note', name: 'Keep me', productUomQty: '0' },
  ]
  assert.deepEqual(
    postedTemplateLines(
      JSON.stringify({
        added: [],
        updated: [{ id: 'a', values: { productUomQty: 5 } }],
        removed: [],
        order: ['b', 'a'],
      }),
      saved,
    ).map((row) => [row.id, row.productUomQty]),
    [
      ['b', '0'],
      ['a', '5'],
    ],
  )
  assert.equal(templateDefinition.commands!.lifecycle!.fn, 'sale_template.setTemplateActive')
})

test('D29 template kind is a reactive native record control and removes quotation-only fields', () => {
  const c = {
    creating: true,
    busy: false,
    data: {
      record: { kind: 'quotation', lines: [], teamIds: [], active: true },
      products: [],
      units: [],
      teams: [],
      save: true,
      lang: 'en',
    },
    t: (key: string) => key,
    draft: (_key: string, value: string) => value,
    draftChecked: (_key: string, _value: string, fallback: boolean) => fallback,
    fieldError: () => null,
    state: () => 'section',
  } as unknown as RecordModalContext<Data>
  const rendered = renderToString(html`${templateDefinition.body!(c)}`)
  assert.match(rendered, /data-record-state="kind"/)
  assert.doesNotMatch(rendered, /name="(validityDays|requireSignature|requirePayment|notes)"/)
  assert.ok(!templateGrid(c).newRows!.some((row) => row.row.displayType === 'section'))
})

test('D29 archive commands follow their own grant independently of template editing', () => {
  const c = {
    kind: 'sale.template',
    creating: false,
    busy: false,
    recordChanged: false,
    data: { record: { active: true }, save: true, lifecycle: false, lang: 'en' },
    t: (key: string) => key,
  } as unknown as RecordModalContext<Data>
  assert.doesNotMatch(
    renderToString(html`${templateDefinition.pageActions!(c)}`),
    /name="__command" value="lifecycle"/,
  )
  assert.match(
    renderToString(html`${templateDefinition.pageActions!({ ...c, data: { ...c.data, lifecycle: true } })}`),
    /name="__command" value="lifecycle"/,
  )
})

test('D29 template collection preserves scoped history, dims slow reads and ignores late answers', async () => {
  const { createPagedCollectionStore } = await import(
    '../packages/ketsuite/src/ui/client/paged-collection-store.ts'
  )
  const { queryFromUrl } = await import(
    '../packages/ketsuite/src/modules/sale_template_backend/list/shared.ts'
  )
  const initial = queryFromUrl(
    new URL('https://commerce.test/admin/sales/templates?company=acme&lang=en&dialog=old'),
  )
  assert.ok(!initial.href.includes('dialog='))
  const writes: string[] = []
  const pending: Array<{ query: typeof initial; resolve: (response: Response) => void }> = []
  const store = createPagedCollectionStore({
    source: '/admin/sales/templates/read?company=acme',
    query: initial,
    href: (q) => q.href,
    announce: () => '',
    browser: {
      href: () => 'https://commerce.test' + initial.href,
      online: () => true,
      push: (href) => {
        writes.push('push:' + href)
      },
      replace: (href) => {
        writes.push('replace:' + href)
      },
      fetch: (_url, init) =>
        new Promise((resolve) => {
          pending.push({ query: JSON.parse(String(init?.body)), resolve })
        }),
    },
  })
  const settle = (index: number, id: string, applied = pending[index]!.query) =>
    pending[index]!.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          value: { query: applied, rows: [{ id }], page: applied.page, pages: 1, total: 1, counts: {} },
        }),
      ),
    )
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  try {
    const first = store.load()
    settle(0, 'initial')
    await first
    const next = queryFromUrl(
      new URL('https://commerce.test/admin/sales/templates?company=acme&lang=en&q=section&page=99'),
    )
    store.navigate(next)
    await new Promise((resolve) => setTimeout(resolve, 180))
    assert.equal(store.dimmed(), true)
    assert.equal(store.value()?.rows[0]?.id, 'initial')
    const applied = queryFromUrl(new URL(next.href.replace('&page=99', ''), 'https://commerce.test'))
    settle(1, 'section', applied)
    await tick()
    assert.deepEqual(writes, ['push:' + next.href, 'replace:' + applied.href])
    assert.equal(store.dimmed(), false)
    writes.length = 0
    store.navigate(initial, 'none')
    await tick()
    assert.equal(store.value()?.rows[0]?.id, 'initial')
    assert.deepEqual(writes, [], 'Back must not push or replace history')
    const stale = store.load(true)
    store.navigate(applied, 'none')
    await tick()
    settle(2, 'stale')
    await stale
    assert.equal(store.value()?.rows[0]?.id, 'section')
    assert.deepEqual(writes, [])
  } finally {
    store.dispose()
  }
})
test('D29 a quotation with deliveries or invoices does not offer to apply a quotation template', () => {
  // Applying a template replaces every line; the server refuses it once a line has history.
  const offered = (record: Record<string, unknown>) =>
    /data-record-dialog="applyQuoteTemplate"/.test(
      renderToString(
        <div>{templateActions({ ...order(), data: { ...order().data, record } } as never)}</div>,
      ),
    )
  const base = { state: 'draft', revision: 4, lines: [{ id: 'section' }] }
  assert.equal(offered(base), true)
  assert.equal(offered({ ...base, moves: [{ id: 'move' }] }), false)
  assert.equal(offered({ ...base, state: 'sent', invoices: [{ id: 'invoice' }] }), false)
})
