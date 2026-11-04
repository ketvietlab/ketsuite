import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { scrapModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/scrap-view.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'

type Row = Record<string, unknown>
const choices = {
  warehouses: [
    { id: 'wh', name: 'Main' },
    { id: 'east', name: 'East' },
  ],
  products: [
    { id: 'goods', name: 'Goods · G1', tracking: 'none' },
    { id: 'serum', name: 'Serum · S1', tracking: 'lot' },
  ],
  lots: [{ id: 'old', name: 'OLD-1', productId: 'serum' }],
}
const scrapContext = (record: Row, permissions: Record<string, boolean>, extra: Row = {}) =>
  ({
    kind: 'stock.scrap',
    id: String(record.id ?? 'new'),
    creating: !record.id,
    data: {
      record: { state: 'draft', ...record },
      lang: 'en',
      permissions,
      draftId: 'draft-id',
      source: null,
      links: { source: null, operation: '/op', undo: null, replenishment: null },
      value: null,
      choices,
      ...extra,
    },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
  }) as never
const html = (value: unknown) => renderToString(value as TemplateResult)

test('K59 a draft scrap order offers its form to drafters and Validate and Cancel to whoever may', () => {
  const managers = { saveScrap: true, validateScrap: true, cancelScrap: true, undoScrap: true }
  const draft = scrapContext(
    { id: 's1', name: 'WH/HH/0001', warehouseId: 'wh', productId: 'goods', held: '7' },
    managers,
  )
  const actions = html(scrapModalDefinition.actions!(draft))
  assert.match(actions, /stock_backend\.scrap\.validate/)
  assert.match(actions, /stock_backend\.scrap\.cancel/)
  assert.doesNotMatch(actions, /stock_backend\.scrap\.undo"/)
  const body = html(scrapModalDefinition.body!(draft))
  // Warehouse and product are design-system relation pickers; a product without lots asks for none.
  assert.match(body, /backend\.relation-select[\s\S]*scrap-warehouseId/)
  assert.match(body, /scrap-productId/)
  // The pickers carry the required mark like any other required field.
  for (const name of ['warehouseId', 'productId'])
    assert.match(body, new RegExp(`for="scrap-${name}"[\\s\\S]{0,200}?data-ui="field-required"`))
  assert.doesNotMatch(body, /scrap-lotId/)
  assert.match(body, /stock_backend\.scrap\.reason\.failedTest/)
  assert.match(body, /name="replenish"/)
  assert.match(body, /stock_backend\.scrap\.held/)
  // A storekeeper drafts but does not validate.
  const keeper = html(scrapModalDefinition.actions!(scrapContext({ id: 's1' }, { saveScrap: true })))
  assert.doesNotMatch(keeper, /stock_backend\.scrap\.(validate|cancel)/)
  // A lot-tracked product asks for its lot, offering its own lots only.
  const tracked = html(
    scrapModalDefinition.body!(scrapContext({ id: 's2', warehouseId: 'wh', productId: 'serum' }, managers)),
  )
  assert.match(tracked, /scrap-lotId/)
  assert.match(tracked, /OLD-1 · Serum · S1/)
})

test('K59 a validated order reads as a summary with its transfer and offers Undo to managers only', () => {
  const done = {
    id: 's1',
    name: 'WH/HH/0001',
    state: 'done',
    warehouseId: 'wh',
    productId: 'goods',
    quantity: '3',
    reason: 'damaged',
    operationId: 's1:scrap',
  }
  const manager = scrapContext(done, { saveScrap: true, undoScrap: true }, { value: '₫3,000' })
  const body = html(scrapModalDefinition.body!(manager))
  assert.doesNotMatch(body, /scrap-warehouseId/)
  assert.match(body, /href="\/op"/)
  assert.match(body, /₫3,000/)
  assert.match(body, /stock_backend\.scrap\.reason\.damaged/)
  assert.match(html(scrapModalDefinition.actions!(manager)), /stock_backend\.scrap\.undo/)
  assert.doesNotMatch(
    html(scrapModalDefinition.actions!(scrapContext(done, { saveScrap: true }))),
    /scrap\.undo/,
  )
  // Asked to replenish but nothing was ordered: the order says so.
  const unreplenished = html(scrapModalDefinition.body!(scrapContext({ ...done, replenish: true }, {})))
  assert.match(unreplenished, /stock_backend\.scrap\.replenishMissing/)
})

test('K59 saving sends what the form holds; an order opened from a transfer keeps that transfer', () => {
  const form = new FormData()
  for (const [key, value] of Object.entries({
    warehouseId: 'wh',
    productId: 'goods',
    quantity: '2',
    reason: 'lost',
    note: 'Gone',
    replenish: '1',
  }))
    form.set(key, value)
  const creating = scrapContext({ pickingId: 'order:delivery' }, { saveScrap: true })
  assert.deepEqual(scrapModalDefinition.commands!.save!.input(form, creating, {} as never), {
    id: 'draft-id',
    warehouseId: 'wh',
    pickingId: 'order:delivery',
    productId: 'goods',
    lotId: null,
    quantity: '2',
    reason: 'lost',
    replenish: true,
    note: 'Gone',
  })
  form.delete('replenish')
  const saved = scrapModalDefinition.commands!.save!.input(
    form,
    scrapContext({ id: 's1' }, { saveScrap: true }),
    {} as never,
  )
  assert.equal(saved.id, 's1')
  assert.equal(saved.replenish, false)
  assert.equal('warehouseId' in saved, false)
  const undo = new FormData()
  undo.set('reason', 'Counted wrong')
  assert.deepEqual(
    scrapModalDefinition.commands!.undo!.input(undo, scrapContext({ id: 's1' }, {}), {} as never),
    {
      id: 's1',
      reason: 'Counted wrong',
    },
  )
})

test('K59 a transfer that holds goods offers Scrap; K37 a lot offers it where a warehouse holds the lot', () => {
  const transfer = (scrapHref: string | null, state = 'done') =>
    html(
      transferModalDefinition.pageActions!({
        kind: 'stock.transfer',
        id: 'd1',
        creating: false,
        data: { record: { id: 'd1', state, moves: [] }, choices: {}, permissions: {}, scrapHref },
        t: (key: string) => key,
        busy: false,
      } as never),
    )
  assert.match(
    transfer('/admin/stock/scraps?picking=d1&record=stock.scrap%3Anew'),
    /stock_backend\.action\.scrap/,
  )
  assert.match(transfer('/admin/stock/scraps?picking=d1', 'assigned'), /picking=d1/)
  assert.doesNotMatch(transfer(null), /action\.scrap/)

  const lot = stockConfigurationDefinition('lot')
  const lotContext = (record: Row, scrapLot: boolean, quants: Row[]) =>
    ({
      kind: 'stock.lot',
      id: 'old',
      creating: false,
      data: {
        record: { id: 'old', productId: 'serum', ...record },
        save: false,
        rule: false,
        run: false,
        rules: [],
        quants,
        history: [
          {
            id: 'h1',
            at: '2030-01-31T05:00:00.000Z',
            reason: 'scrap',
            before: {},
            after: { scrap: 'WH/HH/0001', quantity: '4', reason: 'expired', note: 'Mould' },
          },
        ],
        scrapLot,
        draftId: 'draft-id',
        choices: { warehouses: choices.warehouses, locations: [] },
      },
      draft: (_key: string, fallback: string) => fallback,
      draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
      fieldError: () => undefined,
      t: (key: string) => key,
      busy: false,
      dialog: { name: 'scrap', params: {} },
    }) as never
  const holding = [{ id: 'q1', locationId: 'wh:stock', quantity: '4', reservedQuantity: '1' }]
  assert.match(html(lot.actions!(lotContext({}, true, holding))), /stock_backend\.lot\.scrap/)
  assert.doesNotMatch(html(lot.actions!(lotContext({}, false, holding))), /lot\.scrap/)
  assert.doesNotMatch(html(lot.actions!(lotContext({}, true, []))), /lot\.scrap/)
  const expired = lotContext({ expirationDate: '2000-01-01T00:00:00.000Z' }, true, holding)
  const dialog = html(lot.dialogs!.scrap!.view(expired))
  assert.match(dialog, /Main · 3/)
  assert.doesNotMatch(dialog, /East/)
  assert.match(dialog, /<option value="expired" selected/)
  assert.match(
    html(lot.dialogs!.scrap!.view(lotContext({ quarantined: true }, true, holding))),
    /<option value="failedTest" selected/,
  )
  assert.match(html(lot.body!(expired)), /WH\/HH\/0001 · 4 · stock_backend\.scrap\.reason\.expired · Mould/)
  const form = new FormData()
  for (const [key, value] of Object.entries({
    warehouseId: 'wh',
    quantity: '',
    reason: 'expired',
    note: 'Mould',
  }))
    form.set(key, value)
  assert.deepEqual(lot.commands!.scrap!.input(form, expired, {} as never), {
    id: 'draft-id',
    lotId: 'old',
    warehouseId: 'wh',
    quantity: '',
    reason: 'expired',
    note: 'Mould',
  })
})
