import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import {
  saleOrderModalDefinition as definition,
  deliveryFields,
  type SaleOrderModalData,
} from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { deliveryLeadFormSchema } from '../packages/ketsuite/src/modules/product/functions/templates.ts'
import { validateForm } from '@ketvietlab/ketjs-view'
const context = (): RecordModalContext<SaleOrderModalData> => ({
  id: 'order',
  kind: 'sale.order',
  creating: false,
  tab: 'info',
  presentation: 'page',
  data: {
    record: {
      state: 'draft',
      revision: 2,
      lines: [],
      pickings: [],
      invoices: [],
      shippingPolicy: 'one',
      expectedDate: '2026-10-06',
      display: { expectedDate: '6 October 2026' },
    },
    permissions: { saveDeliveryPromise: true },
    choices: {},
    lang: 'en',
    draftId: 'new',
  },
  t: (key) => key,
  outcome: () => null,
  fieldError: (name) => (name === 'commitmentDate' ? 'Date precedes order' : null),
  draft: (name, fallback = '') => (name === 'commitmentDate' ? '2026-09-30' : fallback),
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: null,
  href: () => '',
  state: (_key, fallback = '') => fallback,
})
const render = (value: unknown) => renderToString(value as TemplateResult)
test('P51 native delivery form keeps refused input, field errors and expected date hint', () => {
  const c = context(),
    html = render(definition.body!(c))
  assert.match(html, /value="2026-09-30"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /Date precedes order/)
  assert.match(html, /6 October 2026/)
  assert.match(html, /saveDeliveryPromise/)
  assert.doesNotMatch(html, /Chọn ngày/)
  assert.ok(deliveryFields(c).every((field) => field.layout === 'inline'))
  assert.equal(deliveryFields(c).find((field) => field.name === 'commitmentDate')!.locale, 'en')
  assert.equal(deliveryFields(c).find((field) => field.name === 'shippingPolicy')!.value, 'one')
  const aside = render(definition.pageAside!(c))
  assert.match(aside, /6 October 2026/)
})
test('P51 readers, locked orders and external orders expose dates without edit controls', () => {
  for (const mode of ['reader', 'locked', 'external']) {
    const c = context()
    if (mode === 'reader') c.data.permissions.saveDeliveryPromise = false
    if (mode === 'locked') c.data.record.locked = true
    if (mode === 'external') c.data.record.orderAuthority = 'external'
    assert.doesNotMatch(render(definition.body!(c)), /name="commitmentDate"/)
    assert.match(render(definition.pageAside!(c)), /6 October 2026/)
  }
})
test('P51 delivery command clears blank commitment and submits the displayed revision', () => {
  const form = new FormData()
  form.set('shippingPolicy', 'direct')
  form.set('commitmentDate', '')
  assert.deepEqual(definition.commands!.saveDeliveryPromise!.input!(form, context(), {}), {
    id: 'order',
    expectedRevision: 2,
    shippingPolicy: 'direct',
    commitmentDate: null,
  })
})
test('P51 catalogue schema accepts null and boundary days but rejects fractional and out-of-range days', () => {
  for (const saleDelay of [null, 0, 365, '5'])
    assert.equal(validateForm(deliveryLeadFormSchema, { saleDelay }).valid, true)
  for (const saleDelay of [-1, 366, 1.5, 'abc'])
    assert.equal(validateForm(deliveryLeadFormSchema, { saleDelay }).valid, false)
})
