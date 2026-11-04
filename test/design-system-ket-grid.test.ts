import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fromTsv, toTsv } from '../packages/design-system/src/interactions/ket-grid/clipboard.ts'
import { resolveColumn } from '../packages/design-system/src/interactions/ket-grid/columns.ts'
import type {
  KetGridColumn,
  KetGridRow,
} from '../packages/design-system/src/interactions/ket-grid/columns.ts'
import {
  edgePoint,
  gridCommand,
  movePoint,
  rectOf,
  tabTarget,
} from '../packages/design-system/src/interactions/ket-grid/keys.ts'
import { createGridModel } from '../packages/design-system/src/interactions/ket-grid/model.ts'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'
import {
  compareValues,
  editText,
  formatValue,
  parseDate,
  parseNumber,
  parseValue,
  searchText,
} from '../packages/design-system/src/interactions/ket-grid/values.ts'
import type { ValueSpec } from '../packages/design-system/src/interactions/ket-grid/values.ts'
import {
  pageRows,
  revealRow,
  visibleRows,
} from '../packages/design-system/src/interactions/ket-grid/virtual.ts'

const spec = (type: ValueSpec['type'], locale = 'vi-VN', extra: Partial<ValueSpec> = {}): ValueSpec => ({
  type,
  locale,
  currency: 'VND',
  yes: 'Có',
  no: 'Không',
  ...extra,
})

test('KetGrid reads numbers the way people type them in either convention', () => {
  assert.equal(parseNumber('1.234.567', 'vi-VN'), 1234567)
  assert.equal(parseNumber('1,5', 'vi-VN'), 1.5)
  assert.equal(parseNumber('1.5', 'vi-VN'), 1.5, 'a keypad dot is a decimal point')
  assert.equal(parseNumber('1.234', 'vi-VN'), 1234, 'three digits after the group separator are a group')
  assert.equal(parseNumber('1.234,5', 'vi-VN'), 1234.5)
  assert.equal(parseNumber('1,234.5', 'en-US'), 1234.5)
  assert.equal(parseNumber('1.234', 'en-US'), 1.234)
  assert.equal(parseNumber('-12', 'vi-VN'), -12)
  assert.equal(parseNumber('1 234 567 ₫', 'vi-VN'), 1234567)
  assert.equal(parseNumber('20.000đ', 'vi-VN'), 20000)
  assert.equal(parseNumber('', 'vi-VN'), null)
  assert.equal(parseNumber('abc', 'vi-VN'), undefined)
  assert.equal(parseNumber('12.34.5', 'vi-VN'), undefined)
  assert.equal(parseNumber('20k', 'vi-VN'), undefined, 'shorthand is for money only')
  assert.equal(parseNumber('20k', 'vi-VN', { shorthand: true }), 20000)
  assert.equal(parseNumber('1,5tr', 'vi-VN', { shorthand: true }), 1500000)
})

test('KetGrid formats, edits and reads back each value type', () => {
  assert.equal(formatValue(1234567, spec('money')), '1.234.567')
  assert.equal(formatValue(1234.5, spec('money', 'en-US', { currency: 'USD' })), '1,234.50')
  assert.equal(formatValue(10, spec('percent')), '10%')
  assert.equal(formatValue(1.5, spec('number')), '1,5')
  assert.equal(formatValue('2026-10-07', spec('date')), '07/10/2026')
  assert.equal(formatValue(true, spec('checkbox')), 'Có')
  assert.equal(formatValue(null, spec('text')), '')
  assert.equal(editText(1234567, spec('money')), '1234567', 'editors start without grouping')
  assert.equal(editText(1.5, spec('number')), '1,5')
  assert.deepEqual(parseValue('1.234.567', spec('money')), { ok: true, value: 1234567 })
  assert.deepEqual(parseValue('12,6', spec('money')), { ok: true, value: 13 }, 'VND has no minor unit')
  assert.deepEqual(parseValue('x', spec('number')), { ok: false, reason: 'number' })
  assert.deepEqual(parseValue('7/10/2026', spec('date')), { ok: true, value: '2026-10-07' })
  assert.deepEqual(parseValue('10/7/2026', spec('date', 'en-US')), { ok: true, value: '2026-10-07' })
  assert.deepEqual(parseValue('31/02/2026', spec('date')), { ok: false, reason: 'date' })
  assert.deepEqual(parseValue('có', spec('checkbox')), { ok: true, value: true })
  assert.deepEqual(parseValue('FALSE', spec('checkbox')), { ok: true, value: false })
  const options = [
    { value: 'p1', label: 'Bánh mì đặc biệt' },
    { value: 'p2', label: 'Cà phê sữa' },
  ]
  assert.deepEqual(parseValue('banh mi dac biet', spec('select', 'vi-VN', { options })), {
    ok: true,
    value: 'p1',
  })
  assert.deepEqual(parseValue('p2', spec('select', 'vi-VN', { options })), { ok: true, value: 'p2' })
  assert.deepEqual(parseValue('Trà', spec('select', 'vi-VN', { options })), { ok: false, reason: 'option' })
  assert.equal(formatValue('p2', spec('combobox', 'vi-VN', { options })), 'Cà phê sữa')
  assert.equal(searchText('Hóa Đơn'), 'hoa don')
  assert.equal(parseDate('2026-02-30', 'vi-VN'), undefined)
})

test('KetGrid sorts blanks last and text by the locale', () => {
  const values = ['b', null, 'Á', 'a2', 'a10']
  const sorted = [...values].sort((a, b) => compareValues(a, b, spec('text')))
  assert.deepEqual(sorted, ['Á', 'a2', 'a10', 'b', null])
  assert.ok(compareValues(2, 10, spec('number')) < 0)
})

test('KetGrid clipboard text round-trips tabs, line breaks and quotes', () => {
  const rows = [
    ['Mã', 'Ghi chú'],
    ['A1', 'dòng một\ndòng hai'],
    ['B2', 'có "ngoặc"\tvà tab'],
  ]
  assert.deepEqual(fromTsv(toTsv(rows)), rows)
  assert.deepEqual(fromTsv('1\t2\r\n3\t4\r\n'), [
    ['1', '2'],
    ['3', '4'],
  ])
  assert.deepEqual(fromTsv('only'), [['only']])
})

test('KetGrid keyboard contract maps keys to grid commands', () => {
  assert.deepEqual(gridCommand({ key: 'ArrowDown' }), { type: 'move', rows: 1, cols: 0, extend: false })
  assert.deepEqual(gridCommand({ key: 'ArrowRight', shiftKey: true }), {
    type: 'move',
    rows: 0,
    cols: 1,
    extend: true,
  })
  assert.deepEqual(gridCommand({ key: 'ArrowUp', ctrlKey: true }), {
    type: 'edge',
    rows: -1,
    cols: 0,
    extend: false,
  })
  assert.deepEqual(gridCommand({ key: 'ArrowUp', altKey: true }), { type: 'moveRows', direction: -1 })
  assert.deepEqual(gridCommand({ key: 'Home', metaKey: true }), {
    type: 'edge',
    rows: -1,
    cols: -1,
    extend: false,
  })
  assert.deepEqual(gridCommand({ key: 'Enter' }), { type: 'edit' })
  assert.deepEqual(gridCommand({ key: 'Enter', ctrlKey: true }), { type: 'insertRow' })
  assert.deepEqual(gridCommand({ key: 'F2' }), { type: 'edit' })
  assert.deepEqual(gridCommand({ key: 'Tab', shiftKey: true }), { type: 'tab', backwards: true })
  assert.deepEqual(gridCommand({ key: 'Delete' }), { type: 'clear' })
  assert.deepEqual(gridCommand({ key: 'Backspace', metaKey: true }), { type: 'removeRows' })
  assert.deepEqual(gridCommand({ key: 'd', ctrlKey: true }), { type: 'fillDown' })
  assert.deepEqual(gridCommand({ key: 'z', metaKey: true }), { type: 'undo' })
  assert.deepEqual(gridCommand({ key: 'Z', metaKey: true, shiftKey: true }), { type: 'redo' })
  assert.deepEqual(gridCommand({ key: 'y', ctrlKey: true }), { type: 'redo' })
  assert.deepEqual(gridCommand({ key: 'a', ctrlKey: true }), { type: 'selectAll' })
  assert.deepEqual(gridCommand({ key: 'đ' }), { type: 'type' })
  assert.deepEqual(gridCommand({ key: ' ' }), { type: 'toggle' })
  assert.equal(gridCommand({ key: 'c', ctrlKey: true }), null, 'copy is the clipboard event, not a key')
  assert.equal(gridCommand({ key: 'a', isComposing: true }), null)
  assert.equal(gridCommand({ key: 'Shift' }), null)
})

test('KetGrid moves within its bounds and Tab skips read-only cells', () => {
  const bounds = { rows: 3, cols: 4, header: true }
  assert.deepEqual(movePoint({ row: 0, col: 0 }, -1, 0, bounds), { row: -1, col: 0 })
  assert.deepEqual(movePoint({ row: -1, col: 0 }, -1, -1, bounds), { row: -1, col: 0 })
  assert.deepEqual(movePoint({ row: 2, col: 3 }, 1, 1, bounds), { row: 2, col: 3 })
  assert.deepEqual(edgePoint({ row: 1, col: 1 }, 1, 1, bounds), { row: 2, col: 3 })
  assert.deepEqual(rectOf({ row: 2, col: 0 }, { row: 0, col: 3 }), { top: 0, left: 0, bottom: 2, right: 3 })
  const editable = (_row: number, col: number) => col === 1 || col === 2
  assert.deepEqual(tabTarget({ row: 0, col: 2 }, false, bounds, editable), { row: 1, col: 1 })
  assert.deepEqual(tabTarget({ row: 1, col: 1 }, true, bounds, editable), { row: 0, col: 2 })
  assert.equal(tabTarget({ row: 2, col: 2 }, false, bounds, editable), null, 'Tab leaves after the last cell')
})

test('KetGrid draws only the rows in view', () => {
  const box = { scrollTop: 0, height: 300, header: 40, footer: 40, rowHeight: 32 }
  assert.deepEqual(visibleRows(box, 1000, 0), { start: 0, end: 7 })
  assert.deepEqual(visibleRows({ ...box, scrollTop: 3200 }, 1000, 2), { start: 98, end: 109 })
  assert.deepEqual(visibleRows(box, 0), { start: 0, end: 0 })
  assert.equal(revealRow(box, 3), null)
  assert.equal(revealRow(box, 20), 21 * 32 - 220)
  assert.equal(revealRow({ ...box, scrollTop: 640 }, 2), 64)
  assert.equal(pageRows(box), 5)
})

type Line = KetGridRow & {
  id: string
  product: string | null
  quantity: number | null
  price: number | null
  note?: string
  locked?: boolean
}

const context = { locale: 'vi-VN', currency: 'VND', yes: 'Có', no: 'Không' }
const lineColumns: KetGridColumn<Line>[] = [
  {
    key: 'product',
    label: 'Sản phẩm',
    type: 'select',
    editable: true,
    required: true,
    options: [
      { value: 'p1', label: 'Bánh mì' },
      { value: 'p2', label: 'Cà phê' },
    ],
    set: (row, value) => ({ ...row, product: value as string | null, price: value === 'p2' ? 29000 : 18000 }),
  },
  { key: 'quantity', label: 'SL', type: 'number', editable: true, min: 0, required: true },
  { key: 'price', label: 'Đơn giá', type: 'money', editable: (row) => !row.locked },
  {
    key: 'total',
    label: 'Thành tiền',
    type: 'money',
    value: (row) => (row.quantity ?? 0) * (row.price ?? 0),
    footer: 'sum',
  },
]

const lines = (): Line[] => [
  { id: 'a', product: 'p1', quantity: 2, price: 18000 },
  { id: 'b', product: 'p2', quantity: 1, price: 29000, locked: true },
]

const model = (rows: Line[] = lines(), readOnly = false) =>
  createGridModel<Line>({
    columns: lineColumns.map((column) => resolveColumn(column, context)),
    rows,
    rowId: (row) => row.id,
    createRow: () => ({ id: '', product: null, quantity: 1, price: null }),
    rowEditable: () => true,
    rowRemovable: (row) => !row.locked,
    readOnly,
    messages: {
      required: 'Bắt buộc',
      belowMin: 'Tối thiểu {min}',
      aboveMax: 'Tối đa {max}',
      conflict: 'Vừa đổi thành {value}',
      removedElsewhere: 'Đã xoá ở nơi khác',
    },
  })

test('KetGrid model records edits as changes with the fields that differ', () => {
  const grid = model()
  assert.deepEqual(grid.changes(), { added: [], updated: [], removed: [], order: null })
  const { change, skipped } = grid.edit(
    [
      { id: 'a', key: 'product', value: 'p2' },
      { id: 'b', key: 'price', value: 1 },
      { id: 'a', key: 'total', value: 5 },
    ],
    'edit',
  )
  assert.equal(skipped, 2, 'a locked price and a computed total are not editable')
  assert.deepEqual(change?.cells, [{ id: 'a', key: 'product' }])
  const updated = grid.changes().updated
  assert.equal(updated.length, 1)
  assert.deepEqual(updated[0].fields.sort(), ['price', 'product'], 'the product set its price too')
  assert.equal(grid.totals().get('total'), 2 * 29000 + 29000)
  assert.equal(grid.summary().edited, 2)
  grid.edit([{ id: 'a', key: 'product', value: 'p1' }], 'edit')
  assert.deepEqual(grid.changes().updated, [], 'editing back to the server value is no change')
})

test('KetGrid model adds, removes, reorders and undoes as one history', () => {
  const grid = model()
  const id = grid.insert(1)
  assert.ok(id?.startsWith('new-'))
  assert.deepEqual(grid.changes().added, [], 'an untouched new row is not a change')
  grid.edit([{ id: id as string, key: 'product', value: 'p1' }], 'edit')
  assert.deepEqual(
    grid.changes().added.map((row) => [row.id, row.index]),
    [[id, 1]],
  )
  assert.deepEqual(grid.changes().order, ['a', id, 'b'], 'a row added before the end carries the order')
  assert.deepEqual(grid.remove(['a', 'b']), ['a'], 'a locked row stays')
  assert.deepEqual(grid.changes().removed, ['a'])
  assert.ok(grid.move([id as string], { by: 1 }))
  assert.deepEqual(
    grid.view().map((entry) => entry.id),
    ['b', id],
  )
  grid.undo()
  grid.undo()
  assert.deepEqual(
    grid.view().map((entry) => entry.id),
    ['a', id, 'b'],
  )
  grid.redo()
  assert.deepEqual(
    grid.view().map((entry) => entry.id),
    [id, 'b'],
    'redo takes one step: the removal',
  )
  grid.redo()
  assert.deepEqual(
    grid.view().map((entry) => entry.id),
    ['b', id],
  )
  const batch = grid.batch('paste', () => {
    const added = grid.insert(2)
    grid.edit([{ id: added as string, key: 'quantity', value: 7 }], 'paste')
    return added
  })
  assert.equal(batch.change?.reason, 'paste')
  grid.undo()
  assert.equal(grid.view().length, 2, 'one undo takes back the whole paste')
  grid.revert()
  assert.deepEqual(
    grid.view().map((entry) => entry.id),
    ['a', 'b'],
  )
  assert.equal(grid.canUndo(), false)
})

test('KetGrid model marks new and moved rows unsaved as a whole until they are saved', () => {
  const grid = model([...lines(), { id: 'c', product: 'p1', quantity: 3, price: 18000 }])
  const unsaved = () =>
    grid
      .entries()
      .filter((entry) => grid.rowUnsaved(entry))
      .map((entry) => entry.id)
  const quantity = grid.column('quantity')!
  grid.edit([{ id: 'a', key: 'quantity', value: 5 }], 'edit')
  assert.deepEqual(unsaved(), [], 'an edited value marks its cell, not the row')
  assert.equal(grid.cellDirty(grid.entry('a')!, quantity), true)
  grid.edit([{ id: 'a', key: 'quantity', value: 2 }], 'edit')
  assert.equal(grid.cellDirty(grid.entry('a')!, quantity), false, 'a value edited back matches what is saved')
  assert.ok(grid.move(['c'], { by: -1 }))
  assert.deepEqual(unsaved(), ['c'], 'the moved row, not the one it passed')
  grid.undo()
  assert.deepEqual(unsaved(), [], 'a row moved back to its place')
  const id = grid.insert(3) as string
  assert.deepEqual(unsaved(), [id], 'a new row is unsaved before it is filled in')
  assert.ok(grid.move(['b'], { by: 1 }))
  grid.edit([{ id: 'c', key: 'quantity', value: 4 }], 'edit')
  assert.deepEqual(unsaved(), ['b', id])
  grid.markSaved()
  assert.deepEqual(unsaved(), [], 'saving clears every mark')
  assert.equal(grid.cellDirty(grid.entry('c')!, quantity), false)
  assert.deepEqual(
    grid.entries().map((entry) => entry.id),
    ['a', 'c', 'b'],
    'the untouched new row is dropped and the order kept',
  )
})

test('KetGrid model checks edited cells, then every changed row once asked', () => {
  const grid = model()
  const id = grid.insert(2) as string
  assert.deepEqual(grid.issues(), [], 'nothing to fix in a row nobody touched')
  grid.edit([{ id, key: 'quantity', value: -1 }], 'edit')
  assert.deepEqual(
    grid.issues().map((issue) => [issue.key, issue.message]),
    [['quantity', 'Tối thiểu 0']],
  )
  assert.deepEqual(
    grid.revealIssues().map((issue) => [issue.key, issue.message]),
    [
      ['product', 'Bắt buộc'],
      ['quantity', 'Tối thiểu 0'],
    ],
  )
  grid.setErrors({ a: { quantity: 'Vượt tồn kho' } })
  assert.equal(grid.cellIssue(grid.entry('a')!, grid.column('quantity')!)?.message, 'Vượt tồn kho')
  grid.edit([{ id: 'a', key: 'quantity', value: 3 }], 'edit')
  assert.equal(
    grid.cellIssue(grid.entry('a')!, grid.column('quantity')!),
    null,
    'editing clears a server error',
  )
  assert.equal(grid.summary().errors, 2)
})

test('KetGrid model merges changes from elsewhere and keeps the reader’s draft', () => {
  const grid = model()
  grid.edit([{ id: 'a', key: 'quantity', value: 5 }], 'edit')
  const result = grid.apply({
    update: [
      { id: 'a', product: 'p1', quantity: 9, price: 19000 },
      { id: 'b', product: 'p2', quantity: 4, price: 29000, locked: true },
    ],
    add: [{ id: 'c', product: 'p2', quantity: 1, price: 29000 }],
  })
  const entryA = grid.entry('a')!
  assert.equal(entryA.row.quantity, 5, 'the reader’s value stays')
  assert.equal(entryA.row.price, 19000, 'an untouched field takes the new value')
  assert.equal(result.conflicts, 1)
  assert.match(grid.cellIssue(entryA, grid.column('quantity')!)?.message ?? '', /Vừa đổi thành 9/)
  assert.deepEqual(
    result.changed.filter((cell) => cell.id !== 'c').map((cell) => `${cell.id}.${cell.key}`),
    ['a.price', 'a.total', 'b.quantity', 'b.total'],
  )
  assert.deepEqual(result.added, ['c'])
  grid.resolve('a', 'quantity', 'theirs')
  assert.equal(grid.entry('a')!.row.quantity, 9)
  assert.deepEqual(grid.changes().updated, [], 'taking their value leaves nothing to save')
  grid.edit([{ id: 'c', key: 'quantity', value: 2 }], 'edit')
  const removal = grid.apply({ remove: ['b', 'c'] })
  assert.deepEqual(removal.removed, ['b'], 'a clean row goes; an edited one stays')
  assert.equal(grid.entry('c')?.removedElsewhere, true)
  assert.equal(grid.changes().added[0]?.id, 'c', 'saving would add it back')
})

test('KetGrid model sorts the view without changing the order it saves', () => {
  const grid = model([
    { id: 'a', product: 'p1', quantity: 2, price: 18000 },
    { id: 'b', product: 'p2', quantity: null, price: 29000 },
    { id: 'c', product: 'p1', quantity: 1, price: 18000 },
  ])
  grid.setSort({ key: 'quantity', direction: 'desc' })
  assert.deepEqual(
    grid.view().map((entry) => entry.id),
    ['a', 'c', 'b'],
    'blanks stay last',
  )
  assert.equal(grid.changes().order, null)
  grid.markSaved()
  assert.equal(grid.summary().edited, 0)
})

test('KetGrid model refuses duplicate row ids and edits when read-only', () => {
  assert.throws(() => model([lines()[0], lines()[0]]), /two rows have the id "a"/)
  const grid = model(lines(), true)
  assert.equal(grid.edit([{ id: 'a', key: 'quantity', value: 1 }], 'edit').skipped, 1)
  assert.equal(grid.insert(0), null)
  assert.deepEqual(grid.remove(['a']), [])
  assert.equal(grid.canInsert(), false)
})

test('KetGrid model edits and checks only the one cell of a full-width row', () => {
  const columns: KetGridColumn<KetGridRow>[] = [
    { key: 'description', label: 'Mô tả', editable: true },
    { key: 'quantity', label: 'SL', type: 'number', editable: true, required: true },
  ]
  const grid = createGridModel<KetGridRow>({
    columns: columns.map((column) => resolveColumn(column, context)),
    rows: [
      { id: 's', kind: 'section', description: 'Trà' },
      { id: 'a', description: 'Trà ô long', quantity: 2 },
    ],
    rowId: (row) => String(row.id),
    createRow: null,
    rowEditable: () => true,
    rowRemovable: () => true,
    fullWidthKey: (row) => (row.kind === 'section' ? 'description' : null),
    readOnly: false,
    messages: {
      required: 'Bắt buộc',
      belowMin: '≥ {min}',
      aboveMax: '≤ {max}',
      conflict: '{value}',
      removedElsewhere: '',
    },
  })
  const section = grid.entry('s')!
  assert.equal(grid.canEdit(section, grid.column('description')!), true)
  assert.equal(grid.canEdit(section, grid.column('quantity')!), false, 'a section has no quantity cell')
  grid.edit([{ id: 's', key: 'description', value: 'Ấm chén' }], 'edit')
  assert.deepEqual(grid.revealIssues(), [], 'its missing quantity is not a mistake')
  assert.equal(grid.edit([{ id: 's', key: 'quantity', value: 3 }], 'edit').skipped, 1)
})

test('KetGrid island config locks, bounds and fills cells per row and adds kinds of row', () => {
  const options = ketGridOptions({
    label: 'Dòng',
    locale: 'vi-VN',
    rows: [],
    newRows: [
      { label: 'Thêm dòng', row: { kind: 'line', quantity: 1 } },
      { label: 'Thêm mục', row: { kind: 'section', description: '' } },
    ],
    columns: [
      {
        key: 'product',
        label: 'Sản phẩm',
        type: 'combobox',
        editable: true,
        lockedBy: 'settled',
        sets: { p1: { description: 'Trà ô long', price: 185000 } },
      },
      { key: 'quantity', label: 'SL', type: 'number', editable: true, minField: 'settled' },
    ],
  })
  const [product, quantity] = options.columns
  const editable = product.editable as (row: KetGridRow) => boolean
  assert.equal(editable({ settled: 0 }), true)
  assert.equal(editable({ settled: 2 }), false, 'a delivered product stays')
  assert.deepEqual(product.set?.({ id: 'a', description: 'cũ' }, 'p1'), {
    id: 'a',
    product: 'p1',
    description: 'Trà ô long',
    price: 185000,
  })
  assert.deepEqual(
    product.set?.({ id: 'a' }, null),
    { id: 'a', product: null },
    'clearing writes nothing else',
  )
  assert.equal(quantity.validate?.(1, { settled: 2 }), 'At least 2')
  assert.equal(quantity.validate?.(2, { settled: 2 }), null)
  const [done] = ketGridOptions({
    label: 'Thực chuyển',
    locale: 'vi-VN',
    rows: [],
    columns: [{ key: 'qty', label: 'SL', type: 'number', editable: true, maxField: 'remaining' }],
  }).columns
  assert.equal(done.validate?.(5, { remaining: 4 }), 'At most 4', 'no more than is still due')
  assert.equal(done.validate?.(4, { remaining: 4 }), null)
  assert.equal(done.validate?.(9, {}), null, 'a row without the bound is not held to one')
  assert.deepEqual(
    options.newRows?.map((kind) => [kind.label, kind.create({ index: 0 }).kind]),
    [
      ['Thêm dòng', 'line'],
      ['Thêm mục', 'section'],
    ],
  )
})

test("KetGrid island config offers each row the options its product allows, as a product's units", () => {
  const [unit] = ketGridOptions({
    label: 'Dòng',
    locale: 'vi-VN',
    rows: [],
    columns: [
      {
        key: 'unit',
        label: 'ĐVT',
        type: 'select',
        editable: true,
        options: [
          { value: 'chai', label: 'chai' },
          { value: 'thùng 24 chai', label: 'thùng 24 chai' },
          { value: 'hộp', label: 'hộp' },
        ],
        optionsBy: { field: 'product', values: { p1: ['chai', 'thùng 24 chai'], p2: ['hộp'] } },
      },
    ],
  }).columns
  const values = (row: KetGridRow) => unit.optionsFor?.(row).map((option) => option.value)
  assert.deepEqual(values({ product: 'p1' }), ['chai', 'thùng 24 chai'])
  assert.deepEqual(values({ product: 'p2' }), ['hộp'])
  assert.deepEqual(values({ product: null }), ['chai', 'thùng 24 chai', 'hộp'], 'no product: every unit')
  // Typed or pasted, a unit the row's product is not sold in is refused; every unit still shows its name.
  const column = resolveColumn(unit, { locale: 'vi-VN', currency: 'VND', yes: 'Có', no: 'Không' })
  assert.deepEqual(column.parse('thùng 24 chai', { product: 'p1' }), { ok: true, value: 'thùng 24 chai' })
  assert.deepEqual(column.parse('hộp', { product: 'p1' }), { ok: false, reason: 'option' })
  assert.deepEqual(column.parse('', { product: 'p1' }), { ok: true, value: null })
  assert.deepEqual(
    column.choices({ product: 'p2' }).map((option) => option.value),
    ['hộp'],
  )
  assert.equal(column.format('hộp', { product: 'p1' }), 'hộp')
})

test('KetGrid island config steps a price by the unit a row is sold in', () => {
  const [product, quantity, unit] = ketGridOptions({
    label: 'Dòng',
    locale: 'vi-VN',
    rows: [],
    tiers: {
      key: 'product',
      by: 'quantity',
      with: 'unit',
      steps: {
        p1: [{ from: 0, row: { price: 289000 } }],
        'p1|thùng 24 chai': [
          { from: 0, row: { price: 6600000 } },
          { from: 5, row: { price: 6200000 } },
        ],
      },
    },
    columns: [
      { key: 'product', label: 'SP', type: 'combobox', editable: true, sets: { p1: { unit: 'chai' } } },
      { key: 'quantity', label: 'SL', type: 'number', editable: true },
      { key: 'unit', label: 'ĐVT', type: 'select', editable: true },
    ],
  }).columns
  // Choosing the product writes its own unit, whose price is the product's.
  const row = product.set?.({ id: 'a', quantity: 2 }, 'p1')
  assert.deepEqual(row, { id: 'a', quantity: 2, product: 'p1', unit: 'chai', price: 289000 })
  // A packaging has steps of its own; a unit without any takes the product's.
  const boxed = unit.set?.(row ?? {}, 'thùng 24 chai')
  assert.equal(boxed?.price, 6600000)
  assert.equal(quantity.set?.(boxed ?? {}, 5)?.price, 6200000)
  assert.equal(unit.set?.(boxed ?? {}, 'chai')?.price, 289000)
})

test("KetGrid island config steps a row's fields by another field, as a price by quantity", () => {
  const options = ketGridOptions({
    label: 'Dòng',
    locale: 'vi-VN',
    rows: [],
    tiers: {
      key: 'product',
      by: 'quantity',
      lockedBy: 'settled',
      steps: {
        p1: [
          { from: 0, row: { price: 289000, discount: 10 } },
          { from: 12, row: { price: 235000, discount: 0 } },
          { from: 6, row: { price: 289000, discount: 15 } },
        ],
      },
    },
    columns: [
      {
        key: 'product',
        label: 'Sản phẩm',
        type: 'combobox',
        editable: true,
        sets: { p1: { price: 1, unit: 'chai' } },
      },
      { key: 'quantity', label: 'SL', type: 'number', editable: true },
      { key: 'price', label: 'Đơn giá', type: 'money', editable: true },
    ],
  })
  const [product, quantity, price] = options.columns
  // Choosing the product takes its step for the quantity already on the row, after what `sets` writes.
  assert.deepEqual(product.set?.({ id: 'a', quantity: 1 }, 'p1'), {
    id: 'a',
    quantity: 1,
    product: 'p1',
    unit: 'chai',
    price: 289000,
    discount: 10,
  })
  // The step is the one with the largest start at most the quantity, in whatever order the steps come.
  const row = { id: 'a', product: 'p1', quantity: 1, price: 289000, discount: 10 }
  assert.deepEqual(quantity.set?.(row, 6), { ...row, quantity: 6, discount: 15 })
  assert.deepEqual(quantity.set?.(row, 11.5), { ...row, quantity: 11.5, discount: 15 })
  assert.deepEqual(quantity.set?.(row, 12), { ...row, quantity: 12, price: 235000, discount: 0 })
  // A price typed by hand stays until the product or the quantity changes.
  assert.equal(price.set, undefined)
  assert.deepEqual(quantity.set?.({ ...row, price: 250000 }, 3), { ...row, quantity: 3 })
  // A blank quantity, a product without steps and a delivered line keep their fields.
  assert.deepEqual(quantity.set?.(row, null), { ...row, quantity: null })
  assert.deepEqual(quantity.set?.({ ...row, product: 'p2' }, 12), { ...row, product: 'p2', quantity: 12 })
  assert.deepEqual(quantity.set?.({ ...row, settled: 2 }, 12), { ...row, settled: 2, quantity: 12 })
})

test('KetGrid model puts back carried edits as drafts and returns those for rows it does not hold', () => {
  const grid = model()
  const elsewhere = grid.restore([
    { id: 'a', values: { quantity: 5, price: 1 } },
    { id: 'b', values: { price: 1 } },
    { id: 'z', values: { quantity: 9 } },
  ])
  assert.deepEqual(elsewhere, [{ id: 'z', values: { quantity: 9 } }], 'a row on another page rides along')
  assert.deepEqual(
    grid.changes().updated.map((item) => [item.id, item.fields.sort()]),
    [['a', ['price', 'quantity']]],
    'a locked price is not put back',
  )
  assert.equal(grid.entry('a')?.row.quantity, 5)
  assert.equal(grid.cellDirty(grid.entry('a')!, grid.column('quantity')!), true, 'it shows as unsaved')
  assert.equal(grid.canUndo(), false, 'undo covers only what was done here')
  grid.edit([{ id: 'a', key: 'quantity', value: '' }], 'edit')
  assert.deepEqual(
    grid.issues().map((issue) => [issue.id, issue.key]),
    [['a', 'quantity']],
    'a carried row is checked like an edited one',
  )
})

test('KetGrid island carries a draft’s text and works out a difference only when both values exist', () => {
  const base = { label: 'Kiểm kê', locale: 'vi-VN', rows: [], columns: [] }
  const carry = (value: unknown) => ketGridOptions({ ...base, carry: value as string }).carry
  assert.deepEqual(
    carry(JSON.stringify({ updated: [{ id: 'l1', values: { counted: 3 } }, { id: 2 }], added: [{}] })),
    {
      added: [],
      updated: [{ id: 'l1', values: { counted: 3 } }],
      removed: [],
      order: null,
    },
  )
  for (const empty of ['', '{not json', '[]', null]) assert.equal(carry(empty), null)
  const [difference] = ketGridOptions({
    ...base,
    columns: [
      {
        key: 'difference',
        label: 'Chênh lệch',
        type: 'number',
        compute: { difference: ['counted', 'before'] },
      },
    ],
  }).columns
  assert.equal(difference.value?.({ counted: 7, before: 10 }), -3)
  assert.equal(difference.value?.({ counted: null, before: 10 }), null, 'an uncounted line has no difference')
  assert.equal(difference.value?.({ counted: 0, before: 0 }), 0)
})

test('KetGrid island works out a margin and its share, and a margin typed sets the price that earns it', () => {
  const base = { label: 'Dòng', locale: 'vi-VN', rows: [] }
  const line = { quantity: 2, unitPrice: 150000, discount: 10, cost: 100000 }
  const [margin, percent, subtotal] = ketGridOptions({
    ...base,
    columns: [
      {
        key: 'margin',
        label: 'Lợi nhuận',
        type: 'money',
        editable: true,
        lockedBy: 'marginFixed',
        compute: {
          multiply: ['quantity', 'unitPrice'],
          percentOff: 'discount',
          less: ['quantity', 'cost'],
          solve: { field: 'unitPrice', digits: 0 },
        },
      },
      {
        key: 'marginPercent',
        label: 'Lợi nhuận %',
        type: 'percent',
        editable: true,
        compute: {
          multiply: ['quantity', 'unitPrice'],
          percentOff: 'discount',
          less: ['quantity', 'cost'],
          as: 'percent',
          solve: { field: 'unitPrice', digits: 0 },
        },
      },
      {
        key: 'subtotal',
        label: 'Thành tiền',
        type: 'money',
        compute: { multiply: ['quantity', 'unitPrice'], percentOff: 'discount' },
      },
    ],
  }).columns
  // 2 × 150,000 less 10 % sells for 270,000 and costs 200,000.
  assert.equal(margin.value?.(line), 70000)
  assert.equal(percent.value?.(line), 25.925926)
  assert.equal(subtotal.value?.(line), 270000)
  assert.equal(percent.value?.({ ...line, unitPrice: 0 }), null, 'nothing sold has no share')
  // A margin of 100,000 needs 300,000 after the discount: 166,667 a unit, rounded to the dong.
  assert.equal(margin.set?.(line, 100000).unitPrice, 166667)
  // 50 % on a cost of 200,000 sells for 400,000: 222,222 a unit.
  assert.equal(percent.set?.(line, 50).unitPrice, 222222)
  assert.equal(percent.set?.(line, 0).unitPrice, 111111, 'no margin sells at cost')
  // A value no price gives leaves the line as it was.
  assert.equal(percent.set?.(line, 100), line, 'a margin of 100 % on a cost')
  assert.equal(margin.set?.(line, -300000), line, 'a margin below what it costs')
  assert.equal(margin.set?.({ ...line, quantity: 0 }, 1).unitPrice, 150000, 'a line selling none')
  assert.equal(margin.set?.({ ...line, discount: 100 }, 1).unitPrice, 150000, 'a line given away')
  assert.equal(margin.set?.(line, null), line, 'a cleared cell')
  const editable = margin.editable as (row: KetGridRow) => boolean
  assert.equal(editable({ ...line, marginFixed: 0 }), true)
  assert.equal(editable({ ...line, marginFixed: 1 }), false, 'a line with no cost keeps its margin read-only')
  assert.equal(editable({ ...line, quantity: 0 }), false, 'a line selling none has no price to solve')
  assert.equal(subtotal.set, undefined, 'a value not solved for stays read-only')
})

test('KetGrid island solves a subtotal typed for the price, to six places unless told otherwise', () => {
  const [subtotal] = ketGridOptions({
    label: 'Dòng',
    locale: 'vi-VN',
    rows: [],
    columns: [
      {
        key: 'subtotal',
        label: 'Thành tiền',
        type: 'money',
        editable: true,
        compute: {
          multiply: ['quantity', 'unitPrice'],
          percentOff: 'discount',
          solve: { field: 'unitPrice' },
        },
      },
    ],
  }).columns
  assert.equal(subtotal.set?.({ quantity: 3, unitPrice: 1, discount: 0 }, 100).unitPrice, 33.333333)
  assert.equal(subtotal.set?.({ quantity: 2, unitPrice: 1, discount: 50 }, 100).unitPrice, 100)
})

test('KetGrid model edits a solved column through the field it is solved for', () => {
  const grid = createGridModel<KetGridRow>({
    columns: [
      { key: 'price', label: 'Đơn giá', type: 'money', editable: true },
      {
        key: 'margin',
        label: 'Lợi nhuận',
        type: 'money',
        editable: true,
        value: (row: KetGridRow) => Number(row.price) - Number(row.cost),
        set: (row: KetGridRow, value: unknown) => ({ ...row, price: Number(value) + Number(row.cost) }),
      },
      { key: 'total', label: 'Tổng', type: 'money', value: (row: KetGridRow) => Number(row.price) },
    ].map((column) => resolveColumn(column as KetGridColumn, context)),
    rows: [{ id: 'a', price: 150, cost: 100 }],
    rowId: (row) => String(row.id),
    createRow: null,
    rowEditable: () => true,
    rowRemovable: () => true,
    readOnly: false,
    messages: {
      required: 'Bắt buộc',
      belowMin: 'Tối thiểu {min}',
      aboveMax: 'Tối đa {max}',
      conflict: 'Vừa đổi thành {value}',
      removedElsewhere: 'Đã xoá ở nơi khác',
    },
  })
  const { skipped } = grid.edit(
    [
      { id: 'a', key: 'margin', value: 80 },
      { id: 'a', key: 'total', value: 1 },
    ],
    'edit',
  )
  assert.equal(skipped, 1, 'a computed total with nothing to write stays read-only')
  assert.deepEqual(
    grid.changes().updated.map((row) => [row.id, row.fields]),
    [['a', ['price']]],
    'the price it was solved for is the change',
  )
  assert.equal(grid.changes().updated[0]?.row.price, 180)
})

test('KetGrid island tags a section its row marks, as an optional one', () => {
  const options = ketGridOptions({
    label: 'Dòng',
    locale: 'vi-VN',
    rows: [],
    columns: [{ key: 'description', label: 'Diễn giải', editable: true }],
    kindField: 'kind',
    fullWidthKey: 'description',
    fullWidthTag: { field: 'optional', label: 'Tùy chọn' },
  })
  assert.deepEqual(options.fullWidth?.({ kind: 'section', optional: true }), {
    key: 'description',
    tone: 'section',
    tag: 'Tùy chọn',
  })
  assert.equal(options.fullWidth?.({ kind: 'section', optional: false })?.tag, undefined)
  assert.equal(options.fullWidth?.({ kind: 'line', optional: true }), null, 'a line is not a full-width row')
})

test('KetGrid searches with the current row parents and refuses an unbound search', async (t) => {
  const calls: { input: Record<string, unknown>; signal: AbortSignal | null | undefined }[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls.push({ input: JSON.parse(String(init.body)), signal: init.signal })
    return new Response(JSON.stringify({ ok: true, value: [{ id: 'box', name: 'Box of 12' }] }))
  })
  const unit = ketGridOptions({
    label: 'Lines',
    rows: [],
    columns: [
      {
        key: 'unit',
        label: 'Unit',
        type: 'combobox',
        editable: true,
        search: {
          listFunction: 'sale.listLineUnits',
          listInput: { productId: 'stale' },
          listInputFields: { productId: 'product' },
          labelField: 'name',
        },
      },
    ],
  }).columns[0]!
  const signal = new AbortController().signal
  for (const value of [null, undefined, ''])
    assert.deepEqual(await unit.search!('', { row: { product: value }, signal }), [])
  assert.equal(calls.length, 0)
  for (const product of ['one', 'two']) {
    assert.deepEqual(await unit.search!('box', { row: { product }, signal }), [
      { value: 'box', label: 'Box of 12', description: null },
    ])
    assert.deepEqual(calls.at(-1)!.input, { productId: product, search: 'box', limit: 50 })
    assert.equal(calls.at(-1)!.signal, signal)
  }
})

test('KetGrid clears dependent cells only when the parent changes and then applies defaults', () => {
  const product = ketGridOptions({
    label: 'Lines',
    rows: [],
    columns: [
      {
        key: 'product',
        label: 'Product',
        type: 'combobox',
        editable: true,
        resets: ['unit', 'price'],
        sets: { two: { unit: 'each' } },
      },
    ],
  }).columns[0]!
  const row = { product: 'one', unit: 'box', price: 1200, quantity: 2 }
  assert.deepEqual(product.set!(row, 'one'), row)
  assert.deepEqual(product.set!(row, 'two'), { product: 'two', unit: 'each', price: null, quantity: 2 })
  assert.deepEqual(product.set!(row, 'three'), { product: 'three', unit: null, price: null, quantity: 2 })
})

test('KetGrid preserves locked dependent cells and searches only row-specific choices', async () => {
  const columns = ketGridOptions({
    label: 'Choices',
    rows: [],
    columns: [
      {
        key: 'product',
        label: 'Product',
        editable: true,
        type: 'combobox',
        resets: ['unit', 'price'],
        options: [
          { value: 'one', label: 'First' },
          { value: 'two', label: 'Second' },
        ],
        optionsBy: { field: 'choice', values: { a: ['one'] } },
        search: { listFunction: 'must.not.be.called' },
      },
      { key: 'unit', label: 'Unit', editable: true, lockedBy: 'child' },
      { key: 'price', label: 'Price', editable: true, lockedBy: 'child' },
    ],
  }).columns
  const row = { product: 'two', unit: 'each', price: '33', child: true, choice: 'a' }
  assert.deepEqual(columns[0]!.set!(row, 'one'), { ...row, product: 'one' })
  assert.deepEqual(columns[0]!.set!({ ...row, child: false }, 'one'), {
    ...row,
    child: false,
    product: 'one',
    unit: null,
    price: null,
  })
  assert.deepEqual(await columns[0]!.search!('', { row, signal: new AbortController().signal }), [
    { value: 'one', label: 'First' },
  ])
  assert.deepEqual(await columns[0]!.search!('Second', { row, signal: new AbortController().signal }), [])
})

test('KetGrid restores structural form drafts and respects read-only rows and capabilities', () => {
  const grid = model()
  const draft = {
    added: [{ id: 'new-kept', index: 0, values: { product: 'p1', quantity: 4, price: 100, total: 999 } }],
    updated: [{ id: 'b', values: { price: 1 } }],
    removed: ['a'],
    order: ['b', 'new-kept'],
  }
  grid.restoreDraft(draft, { add: true, remove: true, order: true })
  assert.deepEqual(
    grid.entries().map((row) => row.id),
    ['b', 'new-kept'],
  )
  assert.deepEqual(grid.changes().removed, ['a'])
  assert.equal(grid.changes().added[0]!.id, 'new-kept')
  assert.equal(grid.entry('new-kept')!.row.quantity, 4)
  assert.equal('total' in grid.entry('new-kept')!.row, false, 'computed fields are not restored')
  assert.equal(grid.entry('b')!.row.price, 29000, 'locked cells are not restored')
  assert.equal(grid.canUndo(), false)
  for (const readOnly of [false, true]) {
    const held = model(lines(), readOnly)
    held.restoreDraft(draft, { add: false, remove: false, order: false })
    assert.deepEqual(held.changes(), { added: [], updated: [], removed: [], order: null })
  }
  assert.deepEqual(
    ketGridOptions({ label: 'Draft', rows: [], columns: [], carry: JSON.stringify(draft) }).carry,
    draft,
  )
})

test('KetGrid freezes edits and undo while a host saves without discarding the draft', () => {
  const grid = model()
  grid.edit([{ id: 'a', key: 'quantity', value: '7' }], 'edit')
  const before = grid.changes()
  grid.setReadOnly(true)
  grid.edit([{ id: 'a', key: 'quantity', value: '9' }], 'edit')
  assert.equal(grid.insert(0), null)
  assert.deepEqual(grid.remove(['a']), [])
  assert.equal(grid.move(['a'], { to: 1 }), false)
  assert.equal(grid.undo(), null)
  assert.equal(grid.canUndo(), false)
  assert.deepEqual(grid.changes(), before)
  grid.setReadOnly(false)
  assert.equal(grid.canUndo(), true)
  grid.undo()
  assert.deepEqual(grid.changes(), { added: [], updated: [], removed: [], order: null })
})

test('KetGrid carries learned option labels as display-only text through a refused form', () => {
  const carry = ketGridOptions({
    label: 'Draft',
    rows: [],
    columns: [],
    carry: JSON.stringify({
      added: [],
      updated: [],
      removed: [],
      order: null,
      optionLabels: { unit: { box: 'Box of 12', bad: 4 }, bad: 'not a map' },
    }),
  }).carry
  assert.deepEqual(carry?.optionLabels, { unit: { box: 'Box of 12' } })
})

test('KetGrid restores dependent draft setters before checking later editable cells', () => {
  const options = ketGridOptions({
    label: 'Packagings',
    rows: [],
    columns: [
      {
        key: 'scope',
        label: 'Scope',
        type: 'text',
        editable: true,
        sets: { all: { locked: true, barcode: '' }, one: { locked: false } },
      },
      { key: 'barcode', label: 'Barcode', type: 'text', editable: true, lockedBy: 'locked' },
      { key: 'fixed', label: 'Fixed', type: 'text', editable: false },
    ],
  })
  const defaults = { scope: 'all', barcode: '', locked: true, fixed: 'server' }
  const grid = createGridModel({
    columns: options.columns.map((column) => resolveColumn(column, context)),
    rows: [
      { id: 'a', ...defaults },
      { id: 'b', ...defaults, scope: 'one', locked: false, barcode: 'saved' },
    ],
    rowId: (row) => String(row.id),
    createRow: () => ({ ...defaults }),
    rowEditable: () => true,
    rowRemovable: () => true,
    readOnly: false,
    messages: { required: '', belowMin: '', aboveMax: '', conflict: '', removedElsewhere: '' },
  })
  grid.restoreDraft(
    {
      added: [
        {
          id: 'new',
          index: 2,
          values: { scope: 'one', barcode: 'new-invalid', locked: true, fixed: 'forged' },
        },
      ],
      updated: [
        { id: 'a', values: { scope: 'one', barcode: 'invalid', locked: true, fixed: 'forged' } },
        { id: 'b', values: { scope: 'all', barcode: 'forged', locked: false } },
      ],
      removed: [],
      order: null,
    },
    { add: true, remove: true, order: true },
  )
  assert.equal(grid.entry('a')!.row.barcode, 'invalid', 'refused drafts retain the entered value')
  assert.equal(grid.entry('a')!.row.locked, false, 'the trusted setter recomputes hidden metadata')
  assert.equal(grid.entry('a')!.row.fixed, 'server')
  assert.equal(grid.entry('b')!.row.barcode, '', 'a locked dependent draft cannot override its parent')
  assert.equal(grid.entry('b')!.row.locked, true)
  assert.equal(grid.entry('new')!.row.barcode, 'new-invalid')
  assert.equal(grid.entry('new')!.row.locked, false)
  assert.equal(grid.entry('new')!.row.fixed, 'server')
  assert.equal(grid.canUndo(), false)
})

test('KetGrid remote quantity steps override static prices and preserve manual/history locks', () => {
  const options = ketGridOptions({
    label: 'Prices',
    rows: [],
    tiers: {
      key: 'product',
      by: 'quantity',
      stepsField: 'priceSteps',
      lockedBy: ['manual', 'history'],
      steps: { p: [{ from: 0, row: { price: 999 } }] },
    },
    draftFlags: ['manual', 'history', 'intent'],
    columns: [{ key: 'quantity', label: 'Qty', type: 'number', editable: true }],
  })
  const quantity = options.columns[0]!
  const row = {
    id: 'a',
    product: 'p',
    quantity: 1,
    price: 100,
    priceSteps: [
      { from: 0, row: { price: 100, discount: 10 } },
      { from: 3, row: { price: 80, discount: 0 } },
    ],
  }
  assert.equal(quantity.set!(row, 3).price, 80)
  assert.equal(quantity.set!({ ...row, manual: true }, 3).price, 100)
  assert.equal(quantity.set!({ ...row, history: true }, 3).price, 100)
  assert.equal(
    quantity.set!({ ...row, priceSteps: [] }, 3).price,
    100,
    'empty remote steps do not reuse stale static prices',
  )
  assert.deepEqual(options.draftFlags, ['intent'])
})

test('KetGrid keeps its empty message in the visible part of a grid wider than its viewport', () => {
  const css = readFileSync(
    new URL('../packages/design-system/src/interactions/ket-grid/styles.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\[data-ui="kg-viewport"\]\s*\{[^}]*container: kg-viewport \/ inline-size;/)
  assert.match(
    css,
    /\[data-ui="kg-empty"\] > \[role="gridcell"\]\s*\{[^}]*position: sticky;[^}]*inline-size: calc\(100cqi - 2 \* var\(--kv-space-3\)\);/,
  )
})

test('KetGrid sumEquals flags a quality cell until the row total balances', () => {
  const options = ketGridOptions({
    label: 'Quality',
    rows: [],
    columns: [
      {
        key: 'good',
        label: 'Good',
        type: 'number',
        editable: true,
        sumEquals: { fields: ['good', 'poor', 'lost'], total: 'counted', message: 'Quality total differs' },
      },
    ],
  })
  const column = options.columns[0]!
  assert.equal(column.validate?.(6, { counted: 8, good: 6, poor: 1, lost: 1 }), null)
  assert.equal(column.validate?.(7, { counted: 8, good: 7, poor: 1, lost: 1 }), 'Quality total differs')
  assert.equal(column.validate?.(NaN, { counted: 8, good: NaN, poor: 1, lost: 1 }), 'Quality total differs')
})
