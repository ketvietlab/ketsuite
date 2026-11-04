import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { bulkModalDefinition as definition } from '../packages/ketsuite/src/modules/product_backend/modal/bulk-modal-view.tsx'
import type { BulkModalData } from '../packages/ketsuite/src/modules/product_backend/bulk/shared.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { boot } from './fixtures/sale/commerce.ts'

test('P55 native bulk modal starts without a chosen field and retains raw rejected values', () => {
  const data: BulkModalData = {
    id: 'draft',
    lang: 'en',
    products: [{ id: 'tea', revision: 'r1', name: 'Tea' }],
    fields: [{ value: 'listPrice', label: 'Sales price' }],
    choices: {},
  }
  const c: RecordModalContext<BulkModalData> = {
    id: 'new',
    kind: 'product.bulkEdit',
    creating: true,
    tab: '',
    data,
    t: (key) => key,
    outcome: () => null,
    fieldError: () => null,
    draft: (_key, fallback = '') => fallback,
    draftChecked: (_name, _value, fallback = false) => fallback,
    busy: false,
    dialog: null,
    href: () => '',
    state: (_key, fallback = '') => fallback,
  }
  const empty = renderToString(definition.body!(c) as TemplateResult)
  assert.match(empty, /chooseField/)
  assert.doesNotMatch(empty, /name="value"/)
  assert.match(renderToString(definition.actions!(c) as TemplateResult), /disabled/)
  const refused = {
    ...c,
    state: (key: string) => (key === 'field' ? 'listPrice' : ''),
    draft: () => '  bad amount  ',
    fieldError: (key: string) => (key === 'value' ? 'Product TEA: invalid sales price' : null),
  }
  const html = renderToString(definition.body!(refused) as TemplateResult)
  assert.match(html, / {2}bad amount {2}/)
  assert.match(html, /Product TEA: invalid sales price/)
  const form = new FormData()
  form.set('field', 'listPrice')
  form.set('value', '  bad amount  ')
  assert.deepEqual(definition.commands!.save!.input!(form, c, {}), {
    id: 'draft',
    products: [{ id: 'tea', revision: 'r1' }],
    field: 'listPrice',
    value: '  bad amount  ',
    locale: 'en',
  })
  assert.deepEqual(definition.resetRelationsOnChange, { field: ['value'] })
})
test('P55 native context exposes only selected live company products and projects human history', async (t) => {
  const r = await boot(t)
  await r.save('product.saveRecord', {
    id: 'tea',
    name: 'Tea',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'TEA',
  })
  const listPage = await r.app.client.get(
    '/admin/product/templates?lang=en&company=acme&bulkProduct=tea&record=product.bulkEdit:new',
  )
  assert.equal(listPage.status, 200)
  const markup = await listPage.text()
  const listProps = [...markup.matchAll(/data-props="([^"]*)"/g)]
    .map((match) => {
      try {
        return JSON.parse(
          match[1]!
            .replaceAll('&quot;', '"')
            .replaceAll('&#39;', "'")
            .replaceAll('&amp;', '&')
            .replaceAll('&lt;', '<')
            .replaceAll('&gt;', '>'),
        )
      } catch {
        return null
      }
    })
    .filter((value) => value?.href?.startsWith('/admin/product/templates'))
  assert.ok(listProps.length >= 1)
  assert.ok(
    listProps.every((props) => !props.href.includes('bulkProduct') && !props.href.includes('record=')),
  )
  const answer = await r.call('product_backend.bulkContext', { products: ['tea'], locale: 'en' })
  assert.equal((answer.messages as Record<string, string>)['product_backend.bulk.title'], 'Bulk edit')
  assert.ok((answer.messages as Record<string, string>)['product.error.bulk.value']?.includes('Product'))
  const data = answer.data as BulkModalData
  assert.equal(data.products[0]!.name, 'Tea')
  assert.ok(data.fields.some((field) => field.value === 'isStorable'))
  const receipt = await r.save('product.bulkEditProducts', {
    id: 'bulk',
    products: data.products.map(({ id, revision }) => ({ id, revision })),
    field: 'saleOk',
    value: 'false',
  })
  assert.equal(receipt.changedCount, 1)
  const page = await r.call('product.templateModalContext', { id: 'tea', locale: 'en' })
  const history = (
    page.data as { bulkEdits: Array<{ name: string; actor: string; field: string; valueLabel: string }> }
  ).bulkEdits
  assert.equal(history[0]!.name, 'SUA/0001')
  assert.equal(history[0]!.actor, 'Owner')
  assert.equal(history[0]!.field, 'Can be sold')
  assert.equal(history[0]!.valueLabel, 'No')
  assert.equal(await r.call('product_backend.bulkContext', { products: ['missing'], locale: 'en' }), null)
})
