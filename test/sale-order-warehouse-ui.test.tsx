import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import {
  saleOrderModalDefinition as definition,
  type SaleOrderModalData,
} from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const context = (warehouseId: string | undefined, draft: Record<string, string> = {}) =>
  ({
    id: 'new',
    kind: 'sale.order',
    creating: true,
    tab: 'info',
    presentation: 'page',
    data: {
      record: {
        id: '',
        state: 'draft',
        lines: [],
        pickings: [],
        invoices: [],
        ...(warehouseId ? { warehouseId } : {}),
      },
      permissions: {},
      choices: {
        warehouses: [
          { id: 'wh', name: 'Hồ Chí Minh' },
          { id: 'hn', name: 'Hà Nội' },
        ],
      },
      lang: 'vi',
      draftId: 'new',
    },
    t: (key: string) => key,
    outcome: () => null,
    fieldError: () => null,
    draft: (name: string, fallback = '') => draft[name] ?? fallback,
    draftChecked: (_name: string, _value: unknown, fallback = false) => fallback,
    busy: false,
    dialog: null,
    href: () => '',
    state: (_key: string, fallback = '') => fallback,
  }) as unknown as RecordModalContext<SaleOrderModalData>
/** The warehouse picker's chosen value, as the island receives it. */
const chosen = (c: RecordModalContext<SaleOrderModalData>) => {
  const html = renderToString(definition.body!(c) as TemplateResult).replaceAll('&quot;', '"')
  const props = /"name":"warehouseId"[\s\S]*?"value":(null|"[^"]*")/.exec(html)
  assert.ok(props, 'warehouse picker')
  return JSON.parse(props[1]!) as string | null
}

test('K15 the new order form keeps the warehouse it was given, and what the seller picked', () => {
  assert.equal(chosen(context('wh')), 'wh')
  assert.equal(chosen(context(undefined)), null)
  assert.equal(chosen(context('wh', { warehouseId: 'hn' })), 'hn')
})

test('A new quotation opens as wide as a saved one, so its terms sit in two columns', () => {
  const size = definition.size
  assert.equal(typeof size === 'function' ? size(context(undefined)) : size, 'large')
})
