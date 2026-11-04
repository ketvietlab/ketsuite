import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { countSessionModalDefinition as count } from '../packages/ketsuite/src/modules/stock_backend/modal/count-view.tsx'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'

type Row = Record<string, unknown>
const choices = {
  warehouses: [{ id: 'wh', name: 'Main' }],
  products: [
    { id: 'goods', name: 'Goods · G1', tracking: 'none' },
    { id: 'serum', name: 'Serum · S1', tracking: 'lot' },
  ],
  lots: [{ id: 'old', name: 'OLD-1', productId: 'serum' }],
}
const lines: Row[] = [
  { id: 'l1', productId: 'goods', lotId: null, expected: '10', counted: '8', difference: '-2', reason: 'Vỡ' },
  { id: 'l2', productId: 'serum', lotId: 'old', expected: '4', counted: null, difference: null, found: true },
]
const context = (
  record: Row,
  permissions: Record<string, boolean>,
  extra: Row = {},
  dialog?: { name: string; params: Row },
) =>
  ({
    kind: 'stock.countSession',
    id: String(record.id ?? 'new'),
    creating: !record.id,
    dialog,
    data: {
      record: { state: 'counting', blind: false, lines, lineCount: 2, countedLines: 1, ...record },
      lang: 'en',
      permissions,
      draftId: 'draft-id',
      links: { shortage: '/out', excess: null },
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
const counters = { saveCountLines: true, addCountLine: true, removeCountLine: true, submitCountSession: true }
const approvers = {
  ...counters,
  approveCountSession: true,
  returnCountSession: true,
  cancelCountSession: true,
}

test('K33 K34 a counting session offers counting, found goods and Send for approval, and hides the book when blind', () => {
  const open = context({ id: 'c1', name: 'WH/KK/0001' }, counters)
  const body = html(count.body!(open))
  // Counting is entered in place, in one grid saved at once.
  assert.match(body, /data-island="backend\.ket-grid"/)
  assert.match(body, /stock_backend\.count\.saveLines/)
  assert.match(body, /stock_backend\.count\.add/)
  assert.match(body, /Serum · S1 · OLD-1 · stock_backend\.count\.found/)
  assert.doesNotMatch(body, /stock_backend\.count\.blindTitle/)
  const actions = html(count.actions!(open))
  assert.match(actions, /stock_backend\.count\.submit/)
  // A storekeeper neither approves, returns nor cancels.
  assert.doesNotMatch(actions, /stock_backend\.count\.(approve|return|cancel)</)

  const blind = html(
    count.body!(
      context(
        {
          id: 'c1',
          blind: true,
          differingLines: null,
          lines: lines.map((line) => ({ ...line, expected: null, difference: null })),
        },
        counters,
      ),
    ),
  )
  assert.match(blind, /stock_backend\.count\.blindTitle/)
  assert.doesNotMatch(blind, />10</)
  assert.doesNotMatch(blind, /stock_backend\.count\.(expected|difference)|&quot;expected&quot;/)
  // A reader without the counting functions sees the lines and nothing to press.
  const reader = html(count.body!(context({ id: 'c1' }, {})))
  assert.doesNotMatch(reader, /backend\.ket-grid|stock_backend\.count\.(saveLines|add)/)
  assert.match(reader, /Serum · S1 · OLD-1/)
})

test('K35 a session waiting for approval offers Approve only to an approver who did not count it', () => {
  const review = (selfCounted: boolean) =>
    context({ id: 'c1', state: 'review', selfCounted, differingLines: 1 }, approvers)
  const approver = html(count.actions!(review(false)))
  assert.match(approver, /stock_backend\.count\.approve/)
  assert.match(approver, /stock_backend\.count\.return/)
  assert.match(approver, /stock_backend\.count\.cancel/)
  assert.doesNotMatch(approver, /stock_backend\.count\.submit/)
  const counted = review(true)
  assert.doesNotMatch(html(count.actions!(counted)), /stock_backend\.count\.approve</)
  assert.match(html(count.body!(counted)), /stock_backend\.count\.selfTitle/)
  assert.doesNotMatch(
    html(count.body!(review(false))),
    /backend\.ket-grid|stock_backend\.count\.(saveLines|add)/,
  )

  // Approved: the transfers and, for valuation readers, the value of each side.
  const done = html(
    count.body!(
      context(
        {
          id: 'c1',
          name: 'WH/KK/0001',
          state: 'done',
          shortagePickingId: 'c1:shortage',
          lines: [{ ...lines[0], value: '₫2,000' }],
        },
        approvers,
        { value: { shortage: '₫2,000', excess: null, entries: ['KHO/2030/00004'] } },
      ),
    ),
  )
  assert.match(done, /href="\/out"/)
  assert.match(done, /WH\/KK\/0001\/XK/)
  assert.match(done, /KHO\/2030\/00004/)
  assert.match(done, /stock_backend\.count\.value/)
  assert.equal(
    html(count.actions!(context({ id: 'c1', state: 'done' }, approvers))).includes('count.cancel'),
    false,
  )
})

test('K33 the grid saves its figures and dropped lines, and the found goods dialog sends what it holds', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData()
    for (const [key, value] of Object.entries(entries)) data.set(key, value)
    return data
  }
  const onLine = context({ id: 'c1' }, counters)
  const posted = JSON.stringify({
    added: [],
    updated: [{ id: 'l2', values: { counted: 3, reason: 'Kệ B' } }],
    removed: ['l1'],
    order: null,
  })
  assert.deepEqual(count.commands!.lines!.input(form({ lines: posted }), onLine, {} as never), {
    id: 'c1',
    lines: [{ lineId: 'l2', counted: '3', reason: 'Kệ B' }],
    removed: ['l1'],
  })
  assert.deepEqual(
    count.commands!.add!.input(form({ productId: 'serum', lotId: 'old', counted: '1' }), onLine, {} as never),
    {
      id: 'c1',
      lineId: 'draft-id',
      productId: 'serum',
      lotId: 'old',
      counted: '1',
      reason: '',
      reasonCode: '',
    },
  )
  const starting = context({}, { startCountSession: true })
  assert.deepEqual(
    count.commands!.start!.input(form({ warehouseId: 'wh', blind: 'on' }), starting, {} as never),
    { id: 'draft-id', warehouseId: 'wh', blind: true, productIds: [] },
  )
  assert.equal(count.commands!.start!.input(form({ warehouseId: 'wh' }), starting, {} as never).blind, false)
  const start = html(count.body!(starting))
  assert.match(start, /backend\.relation-select[\s\S]*count-record-warehouseId/)
  assert.match(start, /name="blind"[^>]*checked/)
})

test('K37 a lot history row names the count that adjusted it', () => {
  const lot = stockConfigurationDefinition('lot')
  const body = html(
    lot.body!({
      kind: 'stock.lot',
      id: 'old',
      creating: false,
      data: {
        record: { id: 'old', name: 'OLD-1', productId: 'serum' },
        save: false,
        rule: false,
        run: false,
        rules: [],
        quants: [],
        history: [
          {
            id: 'h1',
            at: '2030-01-31T05:00:00.000Z',
            actorId: 'manager',
            reason: 'countAdjustment',
            before: { quantity: '2' },
            after: { count: 'WH/KK/0001', quantity: '3', reason: 'Trên kệ' },
          },
        ],
        scrapLot: false,
        draftId: 'draft-id',
        choices: { warehouses: choices.warehouses, locations: [] },
      },
      draft: (_key: string, fallback: string) => fallback,
      draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
      fieldError: () => undefined,
      t: (key: string) => key,
      busy: false,
    } as never),
  )
  assert.match(body, /stock_backend\.lot\.history\.countAdjustment/)
  assert.match(body, /WH\/KK\/0001 · 2 → 3 · Trên kệ/)
})

test('#2022 the settlement date picker names its calendar in the page language', () => {
  const done = (lang: string) =>
    html(
      count.body!({
        ...(context(
          { id: 'c1', state: 'done', settlementState: null },
          { settleCountDifference: true },
        ) as Row),
        data: {
          ...((
            context(
              { id: 'c1', state: 'done', settlementState: null },
              { settleCountDifference: true },
            ) as Row
          ).data as Row),
          lang,
        },
      } as never),
    )
  const english = done('en')
  assert.match(english, /Choose date: stock_backend\.count\.settlementDate/)
  assert.doesNotMatch(english, /Chọn ngày: stock_backend\.count\.settlementDate/)
  assert.match(done('vi'), /Chọn ngày: stock_backend\.count\.settlementDate/)
})
