import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'
import { rulesGrid, postedRules } from '../packages/ketsuite/src/modules/pricing_backend/record/grid.tsx'
import {
  pricelistDefinition,
  type PricelistData,
} from '../packages/ketsuite/src/modules/pricing_backend/record/view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const context = () =>
  ({
    id: 'retail',
    kind: 'pricing.pricelist',
    busy: false,
    data: {
      record: { id: 'retail', name: 'Retail', sequence: 16, currency: 'VND', active: true },
      revision: 'revision',
      items: [
        {
          id: 'r',
          appliedOn: '3_global',
          computePrice: 'percentage',
          base: 'list_price',
          percentPrice: '10',
        },
      ],
      save: true,
      saveItem: true,
      ruleUnits: true,
      can: {},
      lang: 'en',
      choices: { lists: [{ id: 'base', name: 'Base' }] },
    },
    t: (key: string) => key,
    draft: (_key: string, value: string) => value,
    fieldError: () => undefined,
  }) as unknown as RecordModalContext<PricelistData>
test('D30 native rule grid uses dependent bases, one save form and read-only grants', () => {
  const c = context(),
    config = rulesGrid(c),
    options = ketGridOptions(config)
  const base = options.columns.find((column) => column.key === 'base')!
  assert.deepEqual(
    base.optionsFor!({ computePrice: 'percentage' }).map((option) => option.value),
    ['list_price', 'pricelist'],
  )
  assert.equal(base.optionsFor!({ computePrice: 'formula' }).length, 3)
  const compute = options.columns.find((column) => column.key === 'computePrice')!
  const formula = compute.set!(config.rows[0]!, 'formula')
  assert.equal(formula.formulaLocked, false)
  assert.equal(formula.minimumDiscount, -1000)
  const render = renderToString(html`${pricelistDefinition.body!(c)}`)
  assert.equal((render.match(/<form /g) || []).length, 1)
  assert.match(render, /pricing-settings-form/)
  assert.match(render, /backend.ket-grid/)
  assert.equal(
    config.columns.some((column) => column.key === 'priceMinMargin' || column.key === 'priceMaxMargin'),
    false,
  )
  assert.equal(rulesGrid({ ...c, data: { ...c.data, saveItem: false } }).readOnly, true)
})
test('D30 grid posts merge untouched rows and preserve exact saved decimal values', () => {
  const saved = [
    { id: 'a', computePrice: 'fixed', fixedPrice: '9007199254740993.125' },
    { id: 'b', computePrice: 'formula', priceDiscount: '-25', priceSurcharge: '7' },
  ]
  const form = new FormData()
  form.set(
    'items',
    JSON.stringify({ updated: [{ id: 'b', values: { discount: -30 } }], added: [], removed: [] }),
  )
  const rows = postedRules(form, saved)
  assert.equal(rows[0]!.fixedPrice, '9007199254740993.125')
  assert.equal(rows[1]!.priceDiscount, '-30')
})

test('D30 native rule grid shows a refused row error next to retained drafts', () => {
  const c = context()
  c.fieldError = (name: string) =>
    name === 'items' ? 'Row 1: The end date must follow the start date.' : null
  const rendered = renderToString(html`${pricelistDefinition.body!(c)}`)
  assert.match(rendered, /Row 1: The end date must follow the start date/)
  assert.match(rendered, /data-ui="notice"/)
  assert.match(rendered, /backend.ket-grid/)
})
