import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import {
  settlementGridConfig,
  settlementInput,
} from '../packages/ketsuite/src/modules/stock_backend/modal/count-settlement-view.tsx'
import { postedCountLines } from '../packages/ketsuite/src/modules/stock_backend/modal/count-grid-draft.ts'
import {
  countGridConfig,
  countSessionModalDefinition as count,
} from '../packages/ketsuite/src/modules/stock_backend/modal/count-view.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
const lines: Row[] = [
  { id: 'l1', productId: 'goods', lotId: null, expected: '10', counted: '8', reason: 'Vỡ' },
  { id: 'l2', productId: 'serum', lotId: 'old', expected: '4', counted: null, found: true },
]
const context = (record: Row, permissions: Record<string, boolean>, extra: Row = {}) =>
  ({
    kind: 'stock.countSession',
    id: 'c1',
    creating: false,
    data: {
      record: { id: 'c1', name: 'WH/KK/0001', state: 'counting', blind: false, lines, ...record },
      lang: 'vi',
      permissions,
      draftId: 'draft-id',
      links: { shortage: null, excess: null },
      value: null,
      choices: {
        warehouses: [{ id: 'wh', name: 'Main' }],
        products: [
          { id: 'goods', name: 'Goods · G1' },
          { id: 'serum', name: 'Serum · S1' },
        ],
        lots: [{ id: 'old', name: 'OLD-1' }],
      },
    },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
    recordChanged: false,
    ...extra,
  }) as never
const counter = { saveCountLines: true, removeCountLine: true, addCountLine: true, submitCountSession: true }

test('K33 the count grid edits figures and reasons in place, works out the difference, and hides the book when blind', () => {
  const grid = countGridConfig(context({}, counter))
  assert.deepEqual(
    grid.columns.map((column) => [column.key, column.editable === true]),
    [
      ['product', false],
      ['expected', false],
      ['counted', true],
      ['qualityGood', true],
      ['qualityPoor', true],
      ['qualityLost', true],
      ['difference', false],
      ['reasonCode', true],
      ['reason', true],
    ],
  )
  assert.deepEqual(grid.columns.find((column) => column.key === 'difference')?.compute, {
    difference: ['counted', 'expected'],
  })
  assert.equal(grid.columns.find((column) => column.key === 'counted')?.min, 0)
  // Figures are numbers in the grid; an uncounted line stays empty rather than zero.
  assert.deepEqual(grid.rows, [
    {
      id: 'l1',
      product: 'Goods · G1',
      expected: 10,
      counted: 8,
      qualityGood: null,
      qualityPoor: null,
      qualityLost: null,
      reasonCode: '',
      reason: 'Vỡ',
    },
    {
      id: 'l2',
      product: 'Serum · S1 · OLD-1 · stock_backend.count.found',
      expected: 4,
      counted: null,
      qualityGood: null,
      qualityPoor: null,
      qualityLost: null,
      reasonCode: '',
      reason: '',
    },
  ])
  assert.deepEqual(
    [grid.name, grid.form, grid.removable, grid.newRow, grid.newRows],
    ['lines', 'stock-count-lines-form', true, undefined, undefined],
  )
  assert.equal(grid.carry, JSON.stringify({ added: [], updated: [], removed: [], order: null }))
  // Unsaved figures survive the modal reading the record again.
  const held = '{"added":[],"updated":[{"id":"l1","values":{"counted":7}}],"removed":[],"order":null}'
  const kept = countGridConfig(
    context({}, counter, { draft: (key: string, fallback: string) => (key === 'lines' ? held : fallback) }),
  )
  assert.equal(kept.carry, held)

  const blind = countGridConfig(context({ blind: true }, counter))
  assert.deepEqual(
    blind.columns.map((column) => column.key),
    ['product', 'counted', 'qualityGood', 'qualityPoor', 'qualityLost', 'reasonCode', 'reason'],
  )
  assert.equal(
    blind.rows.some((row) => 'expected' in row),
    false,
  )
  // Without removeCountLine nobody drops a line.
  assert.equal(countGridConfig(context({}, { saveCountLines: true })).removable, false)
})

test('K33 the grid sits in its own form with Save counts, and Send for approval waits for saved figures', () => {
  const body = html(count.body!(context({}, counter)))
  assert.match(body, /<form[^>]*id="stock-count-lines-form"/)
  assert.match(body, /data-island="backend\.ket-grid"/)
  assert.match(body, /stock_backend\.count\.saveLines/)
  // No line opens its own dialog any more.
  assert.doesNotMatch(body, /data-ui="kt-row-select"|line:l1/)
  const submit = (changed: boolean) =>
    html(count.actions!(context({}, counter, { recordChanged: changed }))).match(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*stock_backend\.count\.submit/,
    )![0]
  // The grid's posted value is observed, so its edits are the record's unsaved changes.
  assert.ok(count.observeDrafts?.includes('lines'))
  assert.doesNotMatch(submit(false), /disabled/)
  assert.match(submit(true), /disabled/)
  // A refused save names what went wrong above the grid.
  const refused = html(
    count.body!(
      context({}, counter, {
        fieldError: (field: string) => (field === 'lines' ? 'Số đếm không hợp lệ' : undefined),
      }),
    ),
  )
  assert.match(refused, /Số đếm không hợp lệ[\s\S]*backend\.ket-grid/)
  // Every refusal of the save lands on the grid's own field, so the modal does not repeat it on top.
  for (const field of ['counted', 'reason', 'lineId'])
    assert.equal(count.commands!.lines!.issueField!(field, new FormData(), context({}, counter)), 'lines')
})

test('K33 the posted grid becomes figures and dropped lines; a malformed draft sends nothing', () => {
  const posted = (changes: Row) =>
    JSON.stringify({ added: [], updated: [], removed: [], order: null, ...changes })
  assert.deepEqual(postedCountLines(lines, ''), { lines: [], removed: [] })
  assert.deepEqual(postedCountLines(lines, posted({ updated: [{ id: 'l2', values: { counted: 0 } }] })), {
    lines: [{ lineId: 'l2', counted: '0' }],
    removed: [],
  })
  // A reason alone carries the line's saved figure; a cleared figure is sent empty, never as 0.
  assert.deepEqual(postedCountLines(lines, posted({ updated: [{ id: 'l1', values: { reason: 'Kệ B' } }] })), {
    lines: [{ lineId: 'l1', counted: '8', reason: 'Kệ B' }],
    removed: [],
  })
  assert.deepEqual(postedCountLines(lines, posted({ updated: [{ id: 'l1', values: { counted: null } }] })), {
    lines: [{ lineId: 'l1', counted: '' }],
    removed: [],
  })
  // A dropped line is not counted as well.
  assert.deepEqual(
    postedCountLines(lines, posted({ updated: [{ id: 'l1', values: { counted: 2 } }], removed: ['l1'] })),
    { lines: [], removed: ['l1'] },
  )
  for (const bad of [
    'not json',
    '[]',
    posted({ added: [{ id: 'new', values: {} }] }),
    posted({ removed: ['elsewhere'] }),
    posted({ updated: [{ id: 'elsewhere', values: { counted: 1 } }] }),
    posted({ updated: [{ id: 'l1' }] }),
    posted({ updated: [{ id: 'l1', values: 'counted' }] }),
    posted({ removed: 'l1' }),
  ])
    assert.equal(postedCountLines(lines, bad), null, bad)
  const c = context({}, counter)
  const data = new FormData()
  data.set('lines', 'not json')
  assert.deepEqual(count.commands!.lines!.input(data, c, {} as never), { id: 'c1', lines: null, removed: [] })
  data.set('lines', posted({ updated: [{ id: 'l1', values: { counted: 9 } }], removed: ['l2'] }))
  assert.deepEqual(count.commands!.lines!.input(data, c, {} as never), {
    id: 'c1',
    lines: [{ lineId: 'l1', counted: '9' }],
    removed: ['l2'],
  })
})

test('a deployment counting in pieces gets a Pieces column, locked where the product is not counted in pieces', () => {
  const pieceLines: Row[] = [
    { ...lines[0], pieces: '32', piecesEnabled: true },
    { ...lines[1], pieces: null, piecesEnabled: false },
  ]
  const plain = context({ lines: pieceLines }, counter) as { data: Row }
  assert.equal(
    countGridConfig(plain as never).columns.some((column) => column.key === 'pieces'),
    false,
    'no column without the deployment option',
  )
  const withPieces = countGridConfig({ ...plain, data: { ...plain.data, pieces: true } } as never)
  const keys = withPieces.columns.map((column) => column.key)
  assert.deepEqual(keys.slice(keys.indexOf('pieces'), keys.indexOf('pieces') + 2), ['pieces', 'counted'])
  assert.equal(withPieces.columns.find((column) => column.key === 'pieces')?.lockedBy, 'piecesLocked')
  assert.deepEqual(
    withPieces.rows.map((row) => [row.pieces, row.piecesLocked]),
    [
      [32, false],
      [null, true],
    ],
  )

  const posted = (changes: Row) =>
    JSON.stringify({ added: [], updated: [], removed: [], order: null, ...changes })
  // Pieces travel beside the line's previous figure for the server to convert.
  assert.deepEqual(
    postedCountLines(pieceLines, posted({ updated: [{ id: 'l1', values: { pieces: 100 } }] })),
    {
      lines: [{ lineId: 'l1', counted: '8', pieces: '100' }],
      removed: [],
    },
  )
  // A typed quantity is what the count books; pieces on a line not counted in pieces are dropped.
  assert.deepEqual(
    postedCountLines(pieceLines, posted({ updated: [{ id: 'l1', values: { pieces: 100, counted: 7 } }] })),
    { lines: [{ lineId: 'l1', counted: '7' }], removed: [] },
  )
  assert.deepEqual(postedCountLines(pieceLines, posted({ updated: [{ id: 'l2', values: { pieces: 5 } }] })), {
    lines: [{ lineId: 'l2', counted: '' }],
    removed: [],
  })
})

test('2014 settlement grid excludes processed rows, hides values and posts only selected methods', () => {
  const c = context(
    {
      state: 'done',
      lines: [
        { id: 'short', productId: 'goods', difference: '-2', value: '2000' },
        { id: 'settled', productId: 'goods', difference: '-1', settlementId: 'old' },
        { id: 'same', productId: 'goods', difference: '0' },
      ],
    },
    { settleCountDifference: true },
  )
  const grid = settlementGridConfig(c)
  assert.deepEqual(
    grid.rows.map((row) => row.id),
    ['short'],
  )
  assert.ok(!grid.columns.some((column) => column.key === 'value'))
  assert.deepEqual(grid.columns.find((column) => column.key === 'method')?.optionsBy?.values, {
    shortage: ['632', '1388', '334', '811'],
    excess: ['711'],
  })
  const form = new FormData()
  form.set('accountingDate', '2030-02-01')
  form.set('partnerId', 'person')
  form.set('settlements', JSON.stringify({ updated: [{ id: 'short', values: { method: '334' } }] }))
  assert.deepEqual(settlementInput(form, c), {
    id: 'draft-id',
    sessionId: 'c1',
    accountingDate: '2030-02-01',
    lines: [{ lineId: 'short', method: '334', partnerId: 'person' }],
  })
})
