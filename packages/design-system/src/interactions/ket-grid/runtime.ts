// KetGrid's browser runtime. The grid renders entirely on the client: it builds its own DOM inside
// a container, draws only the rows in view, and owns focus, editing, the clipboard and drag
// interactions. Data rules live in model.ts; this file turns them into a keyboard-first grid.

import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { Button, IconButton } from '../../primitives/actions/index.tsx'
import { Icon } from '../../primitives/icon/index.tsx'
import type { IconName } from '../../primitives/icon/index.tsx'
import { fromTsv, toTsv } from './clipboard.ts'
import type { KetGridColumn, KetGridRow, ResolvedColumn } from './columns.ts'
import { clearedValue, resolveColumn } from './columns.ts'
import type { GridCommand, GridPoint, GridRect } from './keys.ts'
import { edgePoint, gridCommand, inRect, movePoint, rectOf, tabTarget } from './keys.ts'
import type {
  GridChange,
  GridEntry,
  KetGridChanges,
  KetGridIssue,
  KetGridSummary,
  KetGridTransaction,
} from './model.ts'
import { createGridModel } from './model.ts'
import type { KetGridOption, KetGridValue } from './values.ts'
import { editText, isBlank, matchOption, sameValue, searchText } from './values.ts'
import type { ViewportBox } from './virtual.ts'
import { pageRows, revealRow, visibleRows } from './virtual.ts'

/** What the grid's named field holds before any edit; a record draft that seeds it starts here too. */
export const KET_GRID_NO_CHANGES = JSON.stringify({ added: [], updated: [], removed: [], order: null })

export type KetGridLabels = {
  loading: string
  empty: string
  addRow: string
  removeRows: string
  undo: string
  redo: string
  total: string
  dragHandle: string
  instructions: string
  required: string
  invalidNumber: string
  invalidDate: string
  invalidOption: string
  invalidValue: string
  /** `{min}` is the formatted minimum. */
  belowMin: string
  /** `{max}` is the formatted maximum. */
  aboveMax: string
  /** `{value}` is the value set elsewhere. */
  conflict: string
  keepMine: string
  takeTheirs: string
  removedElsewhere: string
  searching: string
  noOptions: string
  searchFailed: string
  /** `{count}` placeholders below. */
  addedRows: string
  editedCells: string
  removedRows: string
  /** Rows changed in an earlier view of this grid (another page) that the next save still posts. */
  otherPages: string
  errors: string
  conflicts: string
  copied: string
  pasted: string
  pasteSkipped: string
  rowAdded: string
  rowsRemoved: string
  /** Said when a form holding the grid is kept from submitting. */
  fixBeforeSaving: string
  rowMoved: string
  undone: string
  redone: string
  /** `{column}` is the column's label. */
  sortedAscending: string
  sortedDescending: string
  sortCleared: string
  readOnlyCell: string
  yes: string
  no: string
}

export const defaultKetGridLabels: KetGridLabels = {
  loading: 'Loading rows…',
  empty: 'No rows yet',
  addRow: 'Add row',
  removeRows: 'Remove rows',
  undo: 'Undo',
  redo: 'Redo',
  total: 'Total',
  dragHandle: 'Drag to reorder',
  instructions:
    'Arrow keys move between cells. Enter or F2 edits, Escape cancels, Tab moves to the next editable cell. Ctrl+Z undoes, Ctrl+D fills down, Alt+arrow moves a row.',
  required: 'Required',
  invalidNumber: 'Enter a number',
  invalidDate: 'Enter a valid date',
  invalidOption: 'Choose a value from the list',
  invalidValue: 'Enter a valid value',
  belowMin: 'At least {min}',
  aboveMax: 'At most {max}',
  conflict: 'Changed elsewhere to “{value}”.',
  keepMine: 'Keep mine',
  takeTheirs: 'Use new value',
  removedElsewhere: 'This row was removed elsewhere. Saving adds it back.',
  searching: 'Searching…',
  noOptions: 'No matches',
  searchFailed: 'Could not load choices',
  addedRows: '{count} new',
  editedCells: '{count} edited',
  removedRows: '{count} removed',
  otherPages: '{count} changed on other pages',
  errors: '{count} to fix',
  conflicts: '{count} changed elsewhere',
  copied: 'Cells copied: {count}',
  pasted: 'Cells pasted: {count}',
  pasteSkipped: 'Cells not pasted: {count}',
  rowAdded: 'Row added',
  rowsRemoved: 'Rows removed: {count}',
  fixBeforeSaving: 'Cells to fix before saving: {count}',
  rowMoved: 'Row moved',
  undone: 'Undone',
  redone: 'Redone',
  sortedAscending: 'Sorted by {column}, ascending',
  sortedDescending: 'Sorted by {column}, descending',
  sortCleared: 'Sort cleared',
  readOnlyCell: 'This cell cannot be edited',
  yes: 'Yes',
  no: 'No',
}

export type KetGridCell = { id: string; key: string }

export type KetGridChangeEvent<Row extends KetGridRow = KetGridRow> = {
  reason: string
  cells: KetGridCell[]
  changes: KetGridChanges<Row>
}

/** What a form posts for the grid: the changes, with only the changed fields of updated rows. */
export type KetGridPosted = {
  /** Display-only labels retained with a form draft. Never authoritative server input. */
  optionLabels?: Record<string, Record<string, string>>
  added: { id: string; index: number; values: KetGridRow }[]
  updated: { id: string; values: KetGridRow }[]
  removed: string[]
  order: string[] | null
}

/** A row shown as one cell: a section heading or a note, with a short tag after its text (Optional). */
export type KetGridFullWidth = { key: string; tone: 'section' | 'note'; tag?: string | null }

export type KetGridOptions<Row extends KetGridRow = KetGridRow> = {
  /** The grid's accessible name. */
  label: string
  columns: readonly KetGridColumn<Row>[]
  rows: readonly Row[]
  rowId: (row: Row) => string
  labels?: Partial<KetGridLabels>
  /** BCP 47; defaults to the document's language. */
  locale?: string
  /** ISO 4217 for money columns; defaults to VND. */
  currency?: string
  density?: 'compact' | 'default' | 'comfortable'
  /** Rows in view before the grid scrolls, without a fixed `height`. Defaults to 12. */
  visibleRows?: number
  /** A fixed CSS height for the scrolling area, such as `100%` inside a sized region. */
  height?: string
  readOnly?: boolean
  rowEditable?: (row: Row) => boolean
  /** Lets the reader add rows; returns a new row's starting values. */
  createRow?: (context: { index: number }) => Row
  /** Several kinds of new row (a line, a section, a note), each with its own button; the first is what
      Ctrl+Enter adds. Takes the place of `createRow`. */
  newRows?: readonly { label: string; create: (context: { index: number }) => Row }[]
  /** Lets the reader remove rows; a function decides per row. */
  removable?: boolean | ((row: Row) => boolean)
  /** Lets the reader reorder rows by dragging the handle and with Alt+↑/↓. */
  reorderable?: boolean
  /** A row shown as one full-width cell, such as a section heading or a note, editing one column. */
  fullWidth?: (row: Row) => KetGridFullWidth | null
  /** Posts the changes as JSON (`KetGridPosted`) in a hidden field with this name. The field counts as
      the reader's input (a form tracking unsaved edits sees it), and while a changed cell holds a wrong
      value the form does not submit, unless it or its submitter is `novalidate`. */
  name?: string
  /** The form that hidden field belongs to, when the grid sits outside it. */
  form?: string
  /** What an earlier `posted()` of this grid held, such as a record draft kept while the reader changed
      page. Updates to rows shown here are drafts again; updates to other rows ride along in what the
      grid posts, so one save keeps every page's edits. Structural edits and learned option labels are retained when allowed by the grid capabilities. */
  carry?: KetGridPosted | null
  /** Explicit user-owned boolean modes, validated again by the domain writer. */
  draftFlags?: readonly string[]
  onChange?: (event: KetGridChangeEvent<Row>) => void
  onActiveCellChange?: (cell: KetGridCell | null) => void
}

export type KetGridApi<Row extends KetGridRow = KetGridRow> = {
  readonly element: HTMLElement
  /** The current rows, drafts included, in their saved order. */
  rows(): Row[]
  changes(): KetGridChanges<Row>
  posted(): KetGridPosted
  summary(): KetGridSummary
  dirty(): boolean
  issues(): KetGridIssue[]
  /** Shows every check on changed rows (before a save) and returns what must be fixed. */
  validate(): KetGridIssue[]
  /** Replaces the rows and drops drafts and history. */
  setRows(rows: readonly Row[]): void
  /** Freeze edits while the host saves, preserving the draft. */
  setReadOnly(value: boolean): void
  /** Applies rows changed elsewhere, highlighting changed cells and keeping the reader's drafts. */
  applyTransaction(transaction: KetGridTransaction<Row>): void
  /** Takes the saved rows (or the current ones) as the new server copy. */
  markSaved(rows?: readonly Row[]): void
  revert(): void
  /** Errors from the server, by row id and column key; editing a cell clears its error. */
  setErrors(errors: Readonly<Record<string, Readonly<Record<string, string>>>>): void
  /** Writes fields of one row as an undoable draft, such as a price looked up after an edit. */
  patch(id: string, values: Partial<Row>): void
  addRow(row?: Row, index?: number): string | null
  removeRows(ids: readonly string[]): string[]
  focusCell(id: string, key: string): void
  setBusy(busy: boolean): void
  undo(): void
  redo(): void
  destroy(): void
}

type RowView = {
  el: HTMLElement
  cells: HTMLElement[]
  full: KetGridFullWidth | null
}

type Editing = {
  id: string
  key: string
  input: HTMLInputElement
  cell: HTMLElement
  mode: 'replace' | 'edit'
  original: string
  choices: ChoiceList | null
}

type ChoiceList = {
  pick(): KetGridOption | null
  handleKey(event: KeyboardEvent): boolean
  close(): void
  place(): void
  results(): readonly KetGridOption[]
}

const HEADER = '\u0000header'
let gridCounter = 0

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/gu, (whole, key: string) =>
    values[key] === undefined ? whole : String(values[key]),
  )

const markup = (template: Parameters<typeof renderToStaticString>[0]): string =>
  renderToStaticString(template)
const iconMarkup = (name: IconName, size: 'small' | 'default' = 'small'): string =>
  markup(Icon({ name, size }))

const make = <Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Record<string, string | number | null | undefined> = {},
  text?: string,
): HTMLElementTagNameMap[Tag] => {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes))
    if (value !== null && value !== undefined) node.setAttribute(name, String(value))
  if (text !== undefined) node.textContent = text
  return node
}

const setAttr = (node: Element, name: string, value: string | null): void => {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name)
  } else if (node.getAttribute(name) !== value) node.setAttribute(name, value)
}

const documentLocale = (): string =>
  (typeof document !== 'undefined' && document.documentElement.lang) || 'en'

export function createKetGrid<Row extends KetGridRow = KetGridRow>(
  container: HTMLElement,
  options: KetGridOptions<Row>,
): KetGridApi<Row> {
  const labels: KetGridLabels = { ...defaultKetGridLabels, ...options.labels }
  const locale = options.locale ?? documentLocale()
  const currency = options.currency ?? 'VND'
  const prefix = `ket-grid-${(gridCounter += 1)}`
  const lifetime = new AbortController()
  const { signal } = lifetime
  const reorderable = options.reorderable === true && options.readOnly !== true
  const removable = options.removable
  const rowRemovable =
    typeof removable === 'function' ? removable : () => removable === true && options.readOnly !== true
  const kinds =
    options.newRows ?? (options.createRow ? [{ label: labels.addRow, create: options.createRow }] : [])

  const resolved = options.columns.map((column) =>
    resolveColumn(column, { locale, currency, yes: labels.yes, no: labels.no }),
  )
  for (const column of resolved)
    for (const [value, label] of Object.entries(options.carry?.optionLabels?.[column.key] ?? {}))
      if (typeof label === 'string') column.learned.set(value, label)
  // Pinned columns sit at their edge whatever their place in the declaration.
  const columns: ResolvedColumn<Row>[] = [
    ...resolved.filter((column) => column.pinned === 'start'),
    ...resolved.filter((column) => column.pinned === null),
    ...resolved.filter((column) => column.pinned === 'end'),
  ]
  const hasFooter = columns.some((column) => column.footer !== null)
  let editableGrid =
    options.readOnly !== true &&
    (columns.some((column) => !column.computed || column.computedWriter) ||
      kinds.length > 0 ||
      removable !== undefined)

  const model = createGridModel<Row>({
    columns,
    rows: options.rows,
    draftFlags: options.draftFlags,
    rowId: options.rowId,
    createRow: kinds[0]?.create ?? null,
    rowEditable: options.rowEditable ?? (() => true),
    rowRemovable,
    fullWidthKey: options.fullWidth ? (row) => options.fullWidth?.(row)?.key ?? null : undefined,
    readOnly: options.readOnly === true,
    messages: {
      required: labels.required,
      belowMin: labels.belowMin,
      aboveMax: labels.aboveMax,
      conflict: labels.conflict,
      removedElsewhere: labels.removedElsewhere,
    },
  })
  let elsewhere = options.carry
    ? model.restoreDraft(options.carry, {
        add: kinds.length > 0,
        remove: !!options.removable,
        order: options.reorderable === true,
      })
    : []

  // ---- DOM -------------------------------------------------------------------------------------

  const root = make('div', {
    'data-ui': 'ket-grid',
    'data-density': options.density ?? 'default',
    'data-editable': editableGrid ? 'true' : 'false',
  })
  const instructions = make(
    'div',
    { 'data-ui': 'visually-hidden', id: `${prefix}-help` },
    labels.instructions,
  )
  const viewport = make('div', {
    'data-ui': 'kg-viewport',
    role: 'grid',
    'aria-label': options.label,
    'aria-describedby': instructions.id,
    'aria-multiselectable': 'true',
    'aria-readonly': editableGrid ? null : 'true',
    tabindex: '0',
  })
  if (options.height) {
    viewport.style.height = options.height
    root.dataset.fixedHeight = 'true'
  }
  const header = make('div', { 'data-ui': 'kg-header', role: 'rowgroup' })
  const headerRow = make('div', {
    'data-ui': 'kg-row',
    role: 'row',
    'aria-rowindex': '1',
    'data-kind': 'header',
  })
  header.append(headerRow)
  const body = make('div', { 'data-ui': 'kg-body', role: 'rowgroup' })
  const topSpacer = make('div', { 'data-ui': 'kg-spacer', 'aria-hidden': 'true' })
  const bottomSpacer = make('div', { 'data-ui': 'kg-spacer', 'aria-hidden': 'true' })
  const emptyRow = make('div', { 'data-ui': 'kg-empty', role: 'row' })
  const emptyCell = make('div', { role: 'gridcell', 'aria-colspan': String(columns.length) }, labels.empty)
  emptyRow.append(emptyCell)
  const dropLine = make('div', { 'data-ui': 'kg-drop', 'aria-hidden': 'true', hidden: '' })
  body.append(topSpacer, bottomSpacer, dropLine)
  const footer = make('div', { 'data-ui': 'kg-footer', role: 'rowgroup' })
  const footerRow = make('div', { 'data-ui': 'kg-row', role: 'row', 'data-kind': 'footer' })
  footer.append(footerRow)
  viewport.append(header, body)
  if (hasFooter) viewport.append(footer)
  const message = make('div', { 'data-ui': 'kg-message', id: `${prefix}-message`, hidden: '' })
  const tools = make('div', { 'data-ui': 'kg-tools' })
  const status = make('div', { 'data-ui': 'kg-status' })
  const live = make('div', { 'data-ui': 'visually-hidden', role: 'status', 'aria-live': 'polite' })
  // A text field kept out of sight rather than a hidden input: forms that look for unsaved edits skip
  // hidden inputs, and the grid's changes are the reader's. Its default value is "no changes".
  const hidden = options.name
    ? make('input', {
        'data-ui': 'kg-value',
        type: 'text',
        hidden: '',
        tabindex: '-1',
        'aria-hidden': 'true',
        autocomplete: 'off',
        name: options.name,
        form: options.form ?? null,
      })
    : null
  root.append(instructions, viewport, message, tools, live)
  if (hidden) root.append(hidden)
  if (!editableGrid) tools.hidden = true

  const toolButton = (command: string, label: string, icon: IconName, iconOnly = false): string =>
    iconOnly
      ? markup(
          IconButton({
            label,
            icon: Icon({ name: icon }),
            variant: 'tertiary',
            name: 'kg-command',
            value: command,
          }),
        )
      : markup(Button({ label, icon, variant: 'tertiary', name: 'kg-command', value: command }))
  const mac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/u.test(navigator.platform || navigator.userAgent)
  tools.innerHTML = [
    ...kinds.map((kind, at) => toolButton(`add-${at}`, kind.label, 'plus')),
    removable !== undefined ? toolButton('remove', labels.removeRows, 'trash-2') : '',
    toolButton('undo', `${labels.undo} (${mac ? '⌘Z' : 'Ctrl+Z'})`, 'undo-2', true),
    toolButton('redo', `${labels.redo} (${mac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`, 'redo-2', true),
  ].join('')
  tools.append(status)
  const toolFor = (command: string): HTMLButtonElement | null =>
    tools.querySelector<HTMLButtonElement>(`button[name="kg-command"][value="${command}"]`)

  // ---- Column geometry -------------------------------------------------------------------------

  const handleWidth = 28
  const widths = new Map<string, number>()
  const widthOf = (column: ResolvedColumn<Row>): number => widths.get(column.key) ?? column.width
  const template = (): string =>
    [
      ...(reorderable ? [`${handleWidth}px`] : []),
      ...columns.map((column) =>
        column.grow > 0 && !widths.has(column.key)
          ? `minmax(${widthOf(column)}px, ${column.grow}fr)`
          : `${widthOf(column)}px`,
      ),
    ].join(' ')
  const minimumWidth = (): number =>
    (reorderable ? handleWidth : 0) + columns.reduce((sum, column) => sum + widthOf(column), 0)
  const pinOffsets = (): Map<string, { side: 'left' | 'right'; offset: number }> => {
    const offsets = new Map<string, { side: 'left' | 'right'; offset: number }>()
    let left = reorderable ? handleWidth : 0
    for (const column of columns)
      if (column.pinned === 'start') {
        offsets.set(column.key, { side: 'left', offset: left })
        left += widthOf(column)
      }
    let right = 0
    for (const column of [...columns].reverse())
      if (column.pinned === 'end') {
        offsets.set(column.key, { side: 'right', offset: right })
        right += widthOf(column)
      }
    return offsets
  }
  let offsets = pinOffsets()
  const pinnedStartWidth = (): number =>
    (reorderable ? handleWidth : 0) +
    columns.filter((column) => column.pinned === 'start').reduce((sum, column) => sum + widthOf(column), 0)
  const pinnedEndWidth = (): number =>
    columns.filter((column) => column.pinned === 'end').reduce((sum, column) => sum + widthOf(column), 0)
  const applyGeometry = (): void => {
    offsets = pinOffsets()
    root.style.setProperty('--kg-template', template())
    root.style.setProperty('--kg-min-width', `${minimumWidth()}px`)
    for (const cell of root.querySelectorAll<HTMLElement>('[data-kg-key]'))
      pinCell(cell, cell.dataset.kgKey ?? '')
  }
  const pinCell = (cell: HTMLElement, key: string): void => {
    const pin = offsets.get(key)
    cell.style.left = pin?.side === 'left' ? `${pin.offset}px` : ''
    cell.style.right = pin?.side === 'right' ? `${pin.offset}px` : ''
    setAttr(cell, 'data-pinned', pin ? (pin.side === 'left' ? 'start' : 'end') : null)
  }

  // ---- Header and footer -----------------------------------------------------------------------

  const headerCells: HTMLElement[] = []
  if (reorderable) headerRow.append(make('div', { 'data-ui': 'kg-handle', 'aria-hidden': 'true' }))
  columns.forEach((column, col) => {
    const cell = make('div', {
      'data-ui': 'kg-header-cell',
      role: 'columnheader',
      'aria-colindex': String(col + 1),
      'data-kg-key': column.key,
      'data-align': column.align,
      'data-sortable': column.sortable ? 'true' : null,
      tabindex: '-1',
      title: column.hint,
    })
    cell.append(make('span', { 'data-ui': 'kg-header-label' }, column.label))
    if (column.sortable) {
      const sort = make('span', { 'data-ui': 'kg-sort', 'aria-hidden': 'true' })
      cell.append(sort)
    }
    if (column.resizable) cell.append(make('span', { 'data-ui': 'kg-resize', 'aria-hidden': 'true' }))
    headerCells.push(cell)
    headerRow.append(cell)
  })
  const footerCells: HTMLElement[] = []
  if (reorderable) footerRow.append(make('div', { 'data-ui': 'kg-handle', 'aria-hidden': 'true' }))
  columns.forEach((column, col) => {
    const cell = make('div', {
      'data-ui': 'kg-cell',
      role: 'gridcell',
      'aria-colindex': String(col + 1),
      'data-kg-key': column.key,
      'data-align': column.align,
    })
    footerCells.push(cell)
    footerRow.append(cell)
  })

  // ---- Measurements ----------------------------------------------------------------------------

  let rowHeight = 32
  const measure = (): void => {
    root.style.setProperty('--kg-viewport-width', `${viewport.clientWidth}px`)
    root.style.setProperty('--kg-pin-start', `${reorderable ? handleWidth : 0}px`)
    const probe = make('div', { 'data-ui': 'kg-row', 'data-kind': 'probe', 'aria-hidden': 'true' })
    probe.append(make('div', { 'data-ui': 'kg-cell' }, 'M'))
    body.append(probe)
    rowHeight = probe.getBoundingClientRect().height || rowHeight
    probe.remove()
    if (!options.height) {
      const shown = Math.max(1, options.visibleRows ?? 12)
      const chrome =
        header.getBoundingClientRect().height + (hasFooter ? footer.getBoundingClientRect().height : 0)
      viewport.style.maxHeight = `${Math.ceil(chrome + shown * rowHeight + 2)}px`
    }
  }
  const box = (): ViewportBox => ({
    scrollTop: viewport.scrollTop,
    height: viewport.clientHeight,
    header: header.getBoundingClientRect().height,
    footer: hasFooter ? footer.getBoundingClientRect().height : 0,
    rowHeight,
  })

  // ---- State -----------------------------------------------------------------------------------

  let active: { id: string; key: string } = { id: HEADER, key: columns[0]?.key ?? '' }
  let anchor: { id: string; key: string } = active
  let editing: Editing | null = null
  let editorError: string | null = null
  let busy = false
  /** Focus rests on the scrolling area while the active cell is scrolled out of the drawn rows. */
  let parking = false
  let reported = ''
  const rendered = new Map<string, RowView>()
  const flashTimers = new Map<string, number>()
  let renderedRange = { start: 0, end: 0 }

  const viewRows = (): readonly GridEntry<Row>[] => model.view()
  let indexVersion = -1
  let rowIndex = new Map<string, number>()
  const indexOf = (id: string): number => {
    if (indexVersion !== model.version()) {
      rowIndex = new Map(viewRows().map((entry, at) => [entry.id, at]))
      indexVersion = model.version()
    }
    return id === HEADER ? -1 : (rowIndex.get(id) ?? -1)
  }
  const colOf = (key: string): number =>
    Math.max(
      0,
      columns.findIndex((column) => column.key === key),
    )
  const pointOf = (cell: { id: string; key: string }): GridPoint => ({
    row: indexOf(cell.id),
    col: colOf(cell.key),
  })
  const cellAt = (point: GridPoint): { id: string; key: string } => ({
    id: point.row < 0 ? HEADER : (viewRows()[point.row]?.id ?? HEADER),
    key: columns[point.col]?.key ?? columns[0]?.key ?? '',
  })
  const fullOf = (entry: GridEntry<Row>): KetGridFullWidth | null => {
    const full = options.fullWidth?.(entry.row) ?? null
    return full && model.column(full.key) ? full : null
  }
  /** The column a cell edits: a full-width row edits its one column wherever the reader is. */
  const effectiveColumn = (entry: GridEntry<Row>, key: string): ResolvedColumn<Row> | undefined => {
    const full = fullOf(entry)
    return model.column(full ? full.key : key)
  }
  const selection = (): GridRect | null => {
    if (active.id === HEADER) return null
    const a = pointOf(anchor)
    const b = pointOf(active)
    if (a.row < 0 || b.row < 0) return rectOf(b, b)
    return rectOf(a, b)
  }
  const bounds = () => ({ rows: viewRows().length, cols: columns.length, header: true })

  // ---- Painting --------------------------------------------------------------------------------

  const flagIcon = { danger: iconMarkup('circle-alert'), warning: iconMarkup('triangle-alert') }
  const handleIcon = iconMarkup('grip-vertical')

  const makeRow = (entry: GridEntry<Row>): RowView => {
    const el = make('div', { 'data-ui': 'kg-row', role: 'row' })
    if (reorderable) {
      const handle = make('div', { 'data-ui': 'kg-handle', 'aria-hidden': 'true', title: labels.dragHandle })
      handle.innerHTML = handleIcon
      el.append(handle)
    }
    const full = fullOf(entry)
    const cells: HTMLElement[] = []
    if (full) {
      const cell = make('div', {
        'data-ui': 'kg-cell',
        role: 'gridcell',
        'aria-colindex': '1',
        'aria-colspan': String(columns.length),
        'data-full-width': full.tone,
        'data-kg-key': full.key,
        tabindex: '-1',
      })
      cell.append(make('span', { 'data-ui': 'kg-cell-value' }))
      el.append(cell)
      for (let col = 0; col < columns.length; col += 1) cells.push(cell)
    } else
      columns.forEach((column, col) => {
        const cell = make('div', {
          'data-ui': 'kg-cell',
          role: 'gridcell',
          'aria-colindex': String(col + 1),
          'data-kg-key': column.key,
          'data-type': column.type,
          'data-align': column.align,
          tabindex: '-1',
        })
        if (column.type === 'checkbox')
          cell.append(make('input', { 'data-ui': 'kg-check', type: 'checkbox', tabindex: '-1' }))
        else cell.append(make('span', { 'data-ui': 'kg-cell-value' }))
        pinCell(cell, column.key)
        cells.push(cell)
        el.append(cell)
      })
    return { el, cells, full }
  }

  const paintCell = (
    cell: HTMLElement,
    entry: GridEntry<Row>,
    column: ResolvedColumn<Row>,
    row: number,
    col: number,
    rect: GridRect | null,
  ): void => {
    const isEditing = editing?.id === entry.id && editing.cell === cell
    const value = column.read(entry.row)
    const editable = model.canEdit(entry, column)
    const issue = model.cellIssue(entry, column)
    const isActive = active.id === entry.id && (fullOf(entry) ? true : active.key === column.key)
    const selected =
      rect !== null && inRect(rect, row, col) && (rect.top !== rect.bottom || rect.left !== rect.right)
    setAttr(cell, 'data-editable', editable ? 'true' : null)
    setAttr(cell, 'aria-readonly', editableGrid && !editable ? 'true' : null)
    setAttr(cell, 'data-dirty', model.cellDirty(entry, column) ? 'true' : null)
    setAttr(cell, 'data-active', isActive ? 'true' : null)
    setAttr(cell, 'aria-selected', selected ? 'true' : null)
    setAttr(cell, 'tabindex', isActive ? '0' : '-1')
    const invalid = (isEditing && editorError !== null) || issue?.tone === 'danger'
    setAttr(cell, 'data-invalid', invalid ? 'true' : null)
    setAttr(cell, 'aria-invalid', invalid ? 'true' : null)
    setAttr(cell, 'data-conflict', issue?.tone === 'warning' ? 'true' : null)
    setAttr(cell, 'aria-describedby', isActive && (issue || editorError) ? message.id : null)
    if (isEditing) return
    if (column.type === 'checkbox' && !fullOf(entry)) {
      const input = cell.querySelector<HTMLInputElement>('[data-ui="kg-check"]')
      if (input) {
        input.checked = value === true
        input.disabled = !editable
        input.setAttribute('aria-label', column.label)
      }
    } else {
      const holder = cell.querySelector<HTMLElement>('[data-ui="kg-cell-value"]')
      if (holder) {
        const text = column.format(value, entry.row)
        const placeholder = !text && editable && column.placeholder ? column.placeholder : null
        const tag = fullOf(entry)?.tag
        const shown = (placeholder ?? text) + (tag ? ` · ${tag}` : '')
        if (holder.textContent !== shown) holder.textContent = shown
        setAttr(holder, 'data-placeholder', placeholder ? 'true' : null)
      }
    }
    let flag = cell.querySelector<HTMLElement>('[data-ui="kg-flag"]')
    if (issue) {
      if (!flag) {
        flag = make('span', { 'data-ui': 'kg-flag', 'aria-hidden': 'true' })
        cell.append(flag)
      }
      if (flag.dataset.tone !== issue.tone) {
        flag.dataset.tone = issue.tone
        flag.innerHTML = flagIcon[issue.tone]
      }
    } else flag?.remove()
  }

  const paintRow = (view: RowView, entry: GridEntry<Row>, row: number, rect: GridRect | null): void => {
    setAttr(view.el, 'aria-rowindex', String(row + 2))
    setAttr(view.el, 'data-new', entry.base === null ? 'true' : null)
    setAttr(view.el, 'data-kind', view.full?.tone ?? null)
    setAttr(view.el, 'data-removed-elsewhere', entry.removedElsewhere ? 'true' : null)
    // Cells carry their own fills; the row is filled as a whole only when every cell is: all of
    // them editable, or all unsaved because the row is new or was moved.
    const full = view.full ? model.column(view.full.key) : undefined
    const editable = view.full
      ? !!full && model.canEdit(entry, full)
      : columns.every((column) => model.canEdit(entry, column))
    setAttr(view.el, 'data-editable', editable ? 'true' : null)
    setAttr(view.el, 'data-unsaved', model.rowUnsaved(entry) ? 'true' : null)
    if (view.full) {
      // The tag follows the text as generated content, so editing the text leaves it in place; assistive
      // technology reads it as the cell's description.
      const tag = fullOf(entry)?.tag || null
      setAttr(view.cells[0], 'aria-description', tag)
      const holder = view.cells[0].querySelector<HTMLElement>('[data-ui="kg-cell-value"]')
      if (holder) setAttr(holder, 'data-tag', tag)
      if (full) paintCell(view.cells[0], entry, full, row, 0, rect)
      return
    }
    for (const [col, cell] of view.cells.entries()) paintCell(cell, entry, columns[col], row, col, rect)
  }

  const paintHeader = (): void => {
    const sort = model.sort()
    headerCells.forEach((cell, col) => {
      const column = columns[col]
      const sorted = sort?.key === column.key ? sort.direction : null
      setAttr(
        cell,
        'aria-sort',
        column.sortable ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : null,
      )
      const icon = cell.querySelector<HTMLElement>('[data-ui="kg-sort"]')
      if (icon) {
        const wanted = sorted ?? 'none'
        if (icon.dataset.direction !== wanted) {
          icon.dataset.direction = wanted
          icon.innerHTML = sorted ? iconMarkup(sorted === 'asc' ? 'arrow-up' : 'arrow-down') : ''
        }
      }
      const isActive = active.id === HEADER && active.key === column.key
      setAttr(cell, 'data-active', isActive ? 'true' : null)
      setAttr(cell, 'tabindex', isActive ? '0' : '-1')
      pinCell(cell, column.key)
    })
  }

  const paintFooter = (): void => {
    if (!hasFooter) return
    const totals = model.totals()
    const rows = model.entries().map((entry) => entry.row)
    footerCells.forEach((cell, col) => {
      const column = columns[col]
      const value = totals.get(column.key)
      const text =
        value !== undefined ? column.format(value, rows[0] ?? ({} as Row)) : col === 0 ? labels.total : ''
      if (cell.textContent !== text) cell.textContent = text
      pinCell(cell, column.key)
    })
    setAttr(footerRow, 'aria-rowindex', String(viewRows().length + 2))
  }

  const paintStatus = (): void => {
    const summary = model.summary()
    const parts: { text: string; tone?: string }[] = []
    if (summary.added) parts.push({ text: fill(labels.addedRows, { count: summary.added }) })
    if (summary.edited) parts.push({ text: fill(labels.editedCells, { count: summary.edited }) })
    if (summary.removed) parts.push({ text: fill(labels.removedRows, { count: summary.removed }) })
    if (elsewhere.length) parts.push({ text: fill(labels.otherPages, { count: elsewhere.length }) })
    if (summary.errors) parts.push({ text: fill(labels.errors, { count: summary.errors }), tone: 'danger' })
    if (summary.conflicts)
      parts.push({ text: fill(labels.conflicts, { count: summary.conflicts }), tone: 'warning' })
    const signature = JSON.stringify(parts)
    if (status.dataset.signature !== signature) {
      status.dataset.signature = signature
      status.replaceChildren(
        ...parts.map((part) => make('span', { 'data-tone': part.tone ?? null }, part.text)),
      )
    }
    const undo = toolFor('undo')
    const redo = toolFor('redo')
    const adds = tools.querySelectorAll<HTMLButtonElement>('button[name="kg-command"][value^="add-"]')
    const remove = toolFor('remove')
    if (undo) undo.disabled = !model.canUndo() || busy
    if (redo) redo.disabled = !model.canRedo() || busy
    for (const add of adds) add.disabled = !model.canInsert() || busy
    if (remove) remove.disabled = busy || selectedRows().every((entry) => !model.canRemove(entry))
  }

  const paintMessage = (): void => {
    const entry = active.id === HEADER ? null : model.entry(active.id)
    const column = entry ? effectiveColumn(entry, active.key) : undefined
    const issue = entry && column ? model.cellIssue(entry, column) : null
    const text = editorError ?? issue?.message ?? (entry?.removedElsewhere ? labels.removedElsewhere : null)
    const tone = editorError ? 'danger' : (issue?.tone ?? (entry?.removedElsewhere ? 'warning' : null))
    const signature = `${tone}|${text}|${issue?.tone === 'warning' ? 'conflict' : ''}`
    if (message.dataset.signature === signature) return
    message.dataset.signature = signature
    if (!text) {
      message.hidden = true
      message.replaceChildren()
      return
    }
    message.hidden = false
    message.dataset.tone = tone ?? 'danger'
    const icon = make('span', { 'data-ui': 'kg-flag', 'data-tone': tone ?? 'danger', 'aria-hidden': 'true' })
    icon.innerHTML = flagIcon[tone === 'warning' ? 'warning' : 'danger']
    const words = make('span', {}, text)
    message.replaceChildren(icon, words)
    if (issue?.tone === 'warning' && !editorError) {
      const actions = make('span', { 'data-ui': 'kg-message-actions' })
      actions.innerHTML =
        markup(Button({ label: labels.keepMine, variant: 'tertiary', name: 'kg-resolve', value: 'mine' })) +
        markup(
          Button({ label: labels.takeTheirs, variant: 'secondary', name: 'kg-resolve', value: 'theirs' }),
        )
      message.append(actions)
    }
  }

  const syncEmpty = (): void => {
    const empty = viewRows().length === 0
    if (empty && !emptyRow.isConnected) body.insertBefore(emptyRow, bottomSpacer)
    if (!empty && emptyRow.isConnected) emptyRow.remove()
  }

  const renderBody = (): void => {
    const list = viewRows()
    const range = visibleRows(box(), list.length)
    const wanted = list.slice(range.start, range.end)
    const keep = new Set(wanted.map((entry) => entry.id))
    for (const [id, view] of rendered)
      if (!keep.has(id)) {
        if (view.el.contains(document.activeElement)) park()
        view.el.remove()
        rendered.delete(id)
      }
    const rect = selection()
    let cursor: Element = topSpacer
    wanted.forEach((entry, offset) => {
      let view = rendered.get(entry.id)
      const full = fullOf(entry)
      if (view && (view.full?.key ?? null) !== (full?.key ?? null)) {
        view.el.remove()
        view = undefined
      }
      if (!view) {
        view = makeRow(entry)
        rendered.set(entry.id, view)
      }
      if (cursor.nextElementSibling !== view.el) cursor.after(view.el)
      cursor = view.el
      paintRow(view, entry, range.start + offset, rect)
    })
    topSpacer.style.height = `${range.start * rowHeight}px`
    bottomSpacer.style.height = `${Math.max(0, list.length - range.end) * rowHeight}px`
    renderedRange = range
    syncEmpty()
  }

  const render = (): void => {
    const focused = root.contains(document.activeElement)
    const onViewport = document.activeElement === viewport
    setAttr(viewport, 'aria-rowcount', String(viewRows().length + 1 + (hasFooter ? 1 : 0)))
    setAttr(viewport, 'aria-colcount', String(columns.length))
    paintHeader()
    renderBody()
    paintFooter()
    paintStatus()
    paintMessage()
    const cell = activeElement()
    setAttr(viewport, 'tabindex', cell ? '-1' : '0')
    if (focused && !editing && (onViewport || !root.contains(document.activeElement)) && cell)
      cell.focus({ preventScroll: true })
  }

  const park = (): void => {
    parking = true
    viewport.focus({ preventScroll: true })
    parking = false
  }

  const activeElement = (): HTMLElement | null => {
    if (active.id === HEADER) return headerCells[colOf(active.key)] ?? null
    const view = rendered.get(active.id)
    return view ? (view.cells[colOf(active.key)] ?? null) : null
  }

  // ---- Changes ---------------------------------------------------------------------------------

  const posted = (): KetGridPosted => {
    const changes = model.changes()
    const dirty =
      changes.added.length ||
      changes.updated.length ||
      changes.removed.length ||
      changes.order ||
      elsewhere.length
    const optionLabels = Object.fromEntries(
      columns
        .filter((column) => column.learned.size)
        .map((column) => [column.key, Object.fromEntries(column.learned)]),
    )
    return {
      ...(dirty && Object.keys(optionLabels).length ? { optionLabels } : {}),
      added: changes.added.map((item) => ({ id: item.id, index: item.index, values: item.row })),
      updated: [
        ...changes.updated.map((item) => ({
          id: item.id,
          values: Object.fromEntries(item.fields.map((field) => [field, item.row[field]])),
        })),
        ...elsewhere,
      ],
      removed: changes.removed,
      order: changes.order,
    }
  }

  const announce = (text: string): void => {
    live.textContent = ''
    requestAnimationFrame(() => {
      live.textContent = text
    })
  }

  const changed = (change: GridChange | null, announcement?: string): void => {
    if (hidden) {
      const value = JSON.stringify(posted())
      if (hidden.value !== value) {
        hidden.value = value
        hidden.dispatchEvent(new Event('input', { bubbles: true }))
        hidden.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    render()
    if (announcement) announce(announcement)
    if (change) options.onChange?.({ reason: change.reason, cells: change.cells, changes: model.changes() })
  }

  const flash = (cells: readonly { id: string; key: string }[]): void => {
    for (const cell of cells) {
      const view = rendered.get(cell.id)
      const element = view?.full ? view.cells[0] : view?.cells[colOf(cell.key)]
      if (!element) continue
      const key = `${cell.id}\u0000${cell.key}`
      window.clearTimeout(flashTimers.get(key))
      element.dataset.flash = 'false'
      void element.offsetWidth
      element.dataset.flash = 'true'
      flashTimers.set(
        key,
        window.setTimeout(() => {
          delete element.dataset.flash
          flashTimers.delete(key)
        }, 1200),
      )
    }
  }

  // ---- Focus and movement ----------------------------------------------------------------------

  const reveal = (): void => {
    if (active.id !== HEADER) {
      const at = indexOf(active.id)
      const target = at >= 0 ? revealRow(box(), at) : null
      if (target !== null) viewport.scrollTop = target
    }
    render()
    const cell = activeElement()
    if (!cell) return
    const start = pinnedStartWidth()
    const end = pinnedEndWidth()
    if (cell.dataset.pinned) return
    const left = cell.offsetLeft
    const right = left + cell.offsetWidth
    if (left - start < viewport.scrollLeft) viewport.scrollLeft = Math.max(0, left - start)
    else if (right + end > viewport.scrollLeft + viewport.clientWidth)
      viewport.scrollLeft = right + end - viewport.clientWidth
  }

  const focusActive = (): void => {
    reveal()
    const cell = activeElement()
    if (cell) cell.focus({ preventScroll: true })
    else park()
    const now = active.id === HEADER ? '' : `${active.id}\u0000${active.key}`
    if (now !== reported) {
      reported = now
      options.onActiveCellChange?.(active.id === HEADER ? null : { ...active })
    }
  }

  const setActive = (point: GridPoint, extend = false): void => {
    const next = cellAt(point)
    active = next
    if (!extend || next.id === HEADER) anchor = next
    editorError = null
    focusActive()
  }

  const selectedRows = (): GridEntry<Row>[] => {
    const rect = selection()
    if (!rect) return []
    return viewRows().slice(rect.top, rect.bottom + 1)
  }

  const selectedCells = (): { entry: GridEntry<Row>; column: ResolvedColumn<Row>; col: number }[] => {
    const rect = selection()
    if (!rect) return []
    const cells: { entry: GridEntry<Row>; column: ResolvedColumn<Row>; col: number }[] = []
    for (const entry of viewRows().slice(rect.top, rect.bottom + 1)) {
      const full = fullOf(entry)
      if (full) {
        const column = model.column(full.key)
        if (column) cells.push({ entry, column, col: rect.left })
        continue
      }
      for (let col = rect.left; col <= rect.right; col += 1) cells.push({ entry, column: columns[col], col })
    }
    return cells
  }

  const editableAt = (row: number, col: number): boolean => {
    const entry = viewRows()[row]
    if (!entry) return false
    const full = fullOf(entry)
    if (full) {
      const column = model.column(full.key)
      return col === 0 && !!column && model.canEdit(entry, column)
    }
    return model.canEdit(entry, columns[col])
  }

  /** Tab: the next editable cell, a new row after the last one, or out of the grid. */
  const tab = (backwards: boolean): boolean => {
    const from = active.id === HEADER ? { row: backwards ? 0 : -1, col: columns.length - 1 } : pointOf(active)
    const start = from.row < 0 ? { row: 0, col: -1 } : from
    const target = tabTarget(start, backwards, bounds(), editableAt)
    if (target) {
      setActive(target)
      return true
    }
    if (!backwards && model.canInsert() && active.id !== HEADER) {
      addRowAt(viewRows().length)
      return true
    }
    return false
  }

  const firstEditableCol = (row: number): number => {
    for (let col = 0; col < columns.length; col += 1) if (editableAt(row, col)) return col
    return 0
  }

  const addRowAt = (at: number, kind = 0): void => {
    if (model.sort()) model.setSort(null)
    const made = kinds[kind]?.create({ index: at })
    if (!made) return
    const id = model.insert(at, made)
    if (!id) return
    changed({ reason: 'add', cells: [{ id, key: columns[0]?.key ?? '' }] }, labels.rowAdded)
    const row = indexOf(id)
    setActive({ row, col: firstEditableCol(row) })
  }

  const removeSelected = (): void => {
    const rows = selectedRows().filter((entry) => model.canRemove(entry))
    if (!rows.length) return
    const point = pointOf(active)
    const ids = model.remove(rows.map((entry) => entry.id))
    if (!ids.length) return
    changed(
      { reason: 'remove', cells: ids.map((id) => ({ id, key: active.key })) },
      fill(labels.rowsRemoved, { count: ids.length }),
    )
    const count = viewRows().length
    setActive(count ? { row: Math.min(point.row, count - 1), col: point.col } : { row: -1, col: point.col })
  }

  const moveRows = (direction: -1 | 1): void => {
    if (!reorderable || model.sort()) return
    const rows = selectedRows()
    if (!rows.length) return
    if (
      model.move(
        rows.map((entry) => entry.id),
        { by: direction },
      )
    ) {
      changed({ reason: 'move', cells: [{ id: rows[0].id, key: active.key }] }, labels.rowMoved)
      focusActive()
    }
  }

  const toggleSort = (key: string): void => {
    const column = model.column(key)
    if (!column?.sortable) return
    const sort = model.sort()
    const next =
      sort?.key !== key
        ? { key, direction: 'asc' as const }
        : sort.direction === 'asc'
          ? { key, direction: 'desc' as const }
          : null
    model.setSort(next)
    render()
    announce(
      next
        ? fill(next.direction === 'asc' ? labels.sortedAscending : labels.sortedDescending, {
            column: column.label,
          })
        : labels.sortCleared,
    )
  }

  const toggle = (): void => {
    const cells = selectedCells().filter(
      ({ entry, column }) => column.type === 'checkbox' && model.canEdit(entry, column),
    )
    if (!cells.length) return
    const allOn = cells.every(({ entry, column }) => column.read(entry.row) === true)
    const result = model.edit(
      cells.map(({ entry, column }) => ({ id: entry.id, key: column.key, value: !allOn })),
      'edit',
    )
    changed(result.change)
  }

  const clear = (): void => {
    const cells = selectedCells().filter(({ entry, column }) => model.canEdit(entry, column))
    if (!cells.length) return
    const result = model.edit(
      cells.map(({ entry, column }) => ({ id: entry.id, key: column.key, value: clearedValue(column) })),
      'clear',
    )
    changed(result.change)
  }

  const fillDown = (): void => {
    const rect = selection()
    if (!rect) return
    const list = viewRows()
    const sourceRow = rect.top === rect.bottom ? rect.top - 1 : rect.top
    const source = list[sourceRow]
    if (!source || fullOf(source)) return
    const edits: { id: string; key: string; value: KetGridValue }[] = []
    for (let row = sourceRow + 1; row <= rect.bottom; row += 1) {
      const entry = list[row]
      if (!entry || fullOf(entry)) continue
      for (let col = rect.left; col <= rect.right; col += 1) {
        const column = columns[col]
        if (!model.canEdit(entry, column)) continue
        edits.push({ id: entry.id, key: column.key, value: column.read(source.row) })
      }
    }
    if (edits.length) changed(model.edit(edits, 'fill').change)
  }

  const history = (direction: 'undo' | 'redo'): void => {
    if (editing) return
    const change = direction === 'undo' ? model.undo() : model.redo()
    if (!change) return
    changed(change, direction === 'undo' ? labels.undone : labels.redone)
    const first = change.cells.find((cell) => indexOf(cell.id) >= 0)
    if (first) {
      active = { id: first.id, key: first.key || active.key }
      anchor = active
    } else if (active.id !== HEADER && indexOf(active.id) < 0) {
      const count = viewRows().length
      active = cellAt({ row: count ? 0 : -1, col: colOf(active.key) })
      anchor = active
    }
    focusActive()
  }

  // ---- Editing ---------------------------------------------------------------------------------

  const reasonMessage = (reason: string): string =>
    reason === 'number'
      ? labels.invalidNumber
      : reason === 'date'
        ? labels.invalidDate
        : reason === 'option'
          ? labels.invalidOption
          : labels.invalidValue

  const closeEditor = (): void => {
    const current = editing
    if (!current) return
    editing = null
    editorError = null
    current.choices?.close()
    current.input.remove()
    delete current.cell.dataset.editing
    delete root.dataset.editing
  }

  const commitEdit = (move: {
    rows?: number
    tab?: boolean
    backwards?: boolean
    quiet?: boolean
  }): boolean => {
    const current = editing
    if (!current) return true
    const entry = model.entry(current.id)
    const column = model.column(current.key)
    if (!entry || !column) {
      closeEditor()
      return true
    }
    const text = current.input.value
    let value: KetGridValue
    let label: string | null = null
    if (current.choices) {
      const picked = current.choices.pick()
      if (picked) {
        value = picked.value
        label = picked.label
      } else if (text === current.original) value = column.read(entry.row)
      else if (!text.trim()) value = null
      else {
        const match = matchOption(text, [...column.choices(entry.row), ...current.choices.results()])
        if (!match) {
          editorError = labels.invalidOption
          current.input.setAttribute('aria-invalid', 'true')
          render()
          return false
        }
        value = match.value
        label = match.label
      }
    } else {
      const result = column.parse(text, entry.row)
      if (!result.ok) {
        editorError = reasonMessage(result.reason)
        current.input.setAttribute('aria-invalid', 'true')
        current.input.setAttribute('aria-describedby', message.id)
        render()
        return false
      }
      value = result.value
    }
    if (label && value !== null) column.learned.set(String(value), label)
    if (move.quiet) park()
    closeEditor()
    const before = column.read(entry.row)
    const change =
      sameValue(before, value) && text === current.original
        ? null
        : model.edit([{ id: entry.id, key: column.key, value }], 'edit').change
    changed(change)
    if (move.quiet) return true
    if (move.tab) {
      if (!tab(move.backwards === true)) focusActive()
    } else if (move.rows) setActive(movePoint(pointOf(active), move.rows, 0, bounds()))
    else focusActive()
    return true
  }

  const cancelEdit = (): void => {
    closeEditor()
    render()
    focusActive()
  }

  const startEdit = (mode: 'replace' | 'edit'): boolean => {
    if (editing || busy || active.id === HEADER) return false
    const entry = model.entry(active.id)
    const column = entry ? effectiveColumn(entry, active.key) : undefined
    if (!entry || !column) return false
    if (!model.canEdit(entry, column)) {
      announce(labels.readOnlyCell)
      return false
    }
    if (column.type === 'checkbox') {
      toggle()
      return false
    }
    reveal()
    const cell = activeElement()
    if (!cell) return false
    const value = column.read(entry.row)
    const original = editText(value, column.spec)
    const input = make('input', {
      'data-ui': 'kg-editor',
      type: column.type === 'date' ? 'date' : 'text',
      'aria-label': column.label,
      autocomplete: 'off',
      spellcheck: column.type === 'text' ? null : 'false',
      inputmode:
        column.type === 'number' || column.type === 'percent' || column.type === 'money' ? 'decimal' : null,
      'data-align': column.align,
    })
    input.value = mode === 'replace' ? '' : original
    cell.dataset.editing = 'true'
    root.dataset.editing = 'true'
    cell.append(input)
    editing = { id: entry.id, key: column.key, input, cell, mode, original, choices: null }
    if (column.type === 'select' || column.type === 'combobox')
      editing.choices = openChoices(input, cell, entry, column, mode === 'edit' ? original : '')
    input.focus({ preventScroll: true })
    if (mode === 'edit' && input.type === 'text')
      input.setSelectionRange(input.value.length, input.value.length)
    input.addEventListener('keydown', (event) => editorKey(event), { signal })
    input.addEventListener(
      'input',
      () => {
        if (editorError) {
          editorError = null
          input.removeAttribute('aria-invalid')
          render()
        }
      },
      { signal },
    )
    return true
  }

  const editorKey = (event: KeyboardEvent): void => {
    const current = editing
    if (!current || event.isComposing) return
    if (current.choices?.handleKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const textual = current.input.type === 'text' && !current.choices
    const take = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (event.key) {
      case 'Enter':
        take()
        commitEdit({ rows: event.shiftKey ? -1 : 1 })
        return
      case 'Tab':
        take()
        commitEdit({ tab: true, backwards: event.shiftKey })
        return
      case 'Escape':
        take()
        cancelEdit()
        return
      case 'ArrowUp':
      case 'ArrowDown':
        if (current.input.type !== 'text') return
        take()
        commitEdit({ rows: event.key === 'ArrowUp' ? -1 : 1 })
        return
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!textual || current.mode !== 'replace') {
          event.stopPropagation()
          return
        }
        take()
        if (commitEdit({}))
          setActive(movePoint(pointOf(active), 0, event.key === 'ArrowLeft' ? -1 : 1, bounds()))
        return
      }
      default:
        event.stopPropagation()
    }
  }

  const supportsPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype

  const openChoices = (
    input: HTMLInputElement,
    cell: HTMLElement,
    entry: GridEntry<Row>,
    column: ResolvedColumn<Row>,
    original: string,
  ): ChoiceList => {
    const listId = `${prefix}-options`
    const popup = make('div', { 'data-ui': 'kg-popup' })
    if (supportsPopover) popup.setAttribute('popover', 'manual')
    const note = make('div', { 'data-ui': 'kg-options-status', role: 'status', hidden: '' })
    const list = make('div', {
      'data-ui': 'kg-options',
      role: 'listbox',
      id: listId,
      'aria-label': column.label,
    })
    popup.append(note, list)
    root.append(popup)
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-controls', listId)
    input.setAttribute('aria-expanded', 'true')
    let results: readonly KetGridOption[] = []
    let highlighted = -1
    let chosen: KetGridOption | null = null
    let typed = false
    let timer = 0
    let request: AbortController | null = null
    const currentValue = column.read(entry.row)

    const paint = (): void => {
      list.replaceChildren(
        ...results.map((option, at) => {
          const item = make('div', {
            'data-ui': 'kg-option',
            role: 'option',
            id: `${listId}-${at}`,
            'aria-selected': at === highlighted ? 'true' : 'false',
            'data-current': !isBlank(currentValue) && option.value === String(currentValue) ? 'true' : null,
          })
          item.append(make('span', { 'data-ui': 'kg-option-label' }, option.label))
          if (option.description)
            item.append(make('span', { 'data-ui': 'kg-option-description' }, option.description))
          return item
        }),
      )
      setAttr(input, 'aria-activedescendant', highlighted >= 0 ? `${listId}-${highlighted}` : null)
      list.children[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
    const say = (text: string | null): void => {
      note.hidden = text === null
      note.textContent = text ?? ''
    }
    const show = (next: readonly KetGridOption[], query: string): void => {
      results = next
      const current = next.findIndex((option) => option.value === String(currentValue))
      highlighted = query ? (next.length ? 0 : -1) : current
      say(next.length ? null : labels.noOptions)
      paint()
      place()
    }
    const update = (): void => {
      const query = typed ? input.value.trim() : ''
      if (column.search) {
        window.clearTimeout(timer)
        request?.abort()
        say(labels.searching)
        timer = window.setTimeout(
          () => {
            const controller = new AbortController()
            request = controller
            column
              .search?.(query, { row: entry.row, signal: controller.signal })
              .then((found) => {
                if (controller.signal.aborted) return
                for (const option of found) column.learned.set(option.value, option.label)
                show(found, query)
              })
              .catch(() => {
                if (controller.signal.aborted) return
                results = []
                highlighted = -1
                paint()
                say(labels.searchFailed)
              })
          },
          query ? 200 : 0,
        )
        return
      }
      const wanted = searchText(query)
      const options = column.choices(entry.row)
      show(
        wanted
          ? options.filter(
              (option) =>
                searchText(option.label).includes(wanted) ||
                searchText(option.description ?? '').includes(wanted),
            )
          : options,
        query,
      )
    }
    const place = (): void => {
      if (!popup.isConnected) return
      const rect = cell.getBoundingClientRect()
      const width = Math.max(rect.width, 240)
      popup.style.width = `${width}px`
      popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
      const height = popup.getBoundingClientRect().height
      const below = window.innerHeight - rect.bottom - 8
      const above = rect.top - 8
      const top = below >= height || below >= above ? rect.bottom + 2 : rect.top - 2 - height
      popup.style.top = `${Math.max(8, top)}px`
    }
    if (supportsPopover) popup.showPopover()
    input.addEventListener(
      'input',
      () => {
        typed = input.value !== original
        chosen = null
        update()
      },
      { signal },
    )
    list.addEventListener(
      'pointerdown',
      (event) => {
        const item = (event.target as Element).closest<HTMLElement>('[data-ui="kg-option"]')
        if (!item) return
        event.preventDefault()
        const at = [...list.children].indexOf(item)
        chosen = results[at] ?? null
        if (chosen) commitEdit({})
      },
      { signal },
    )
    const onScroll = (): void => place()
    window.addEventListener('resize', onScroll, { signal })
    viewport.addEventListener('scroll', onScroll, { signal, passive: true })
    update()
    return {
      pick: () => chosen ?? (typed && highlighted >= 0 ? (results[highlighted] ?? null) : null),
      results: () => results,
      handleKey: (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!results.length) return true
          const step = event.key === 'ArrowDown' ? 1 : -1
          highlighted = (highlighted + step + results.length) % results.length
          typed = true
          chosen = null
          paint()
          return true
        }
        if (event.key === 'Enter' && highlighted >= 0 && !chosen) {
          chosen = results[highlighted] ?? null
          return false
        }
        return false
      },
      place,
      close: () => {
        window.clearTimeout(timer)
        request?.abort()
        window.removeEventListener('resize', onScroll)
        viewport.removeEventListener('scroll', onScroll)
        if (supportsPopover && popup.matches(':popover-open')) popup.hidePopover()
        popup.remove()
      },
    }
  }

  // ---- Clipboard -------------------------------------------------------------------------------

  const copyText = (): { text: string; count: number } | null => {
    const rect = selection()
    if (!rect) return null
    const rows: string[][] = []
    let count = 0
    for (const entry of viewRows().slice(rect.top, rect.bottom + 1)) {
      const full = fullOf(entry)
      const line: string[] = []
      for (let col = rect.left; col <= rect.right; col += 1) {
        const column = full ? model.column(full.key) : columns[col]
        line.push(
          column && (!full || col === rect.left) ? column.format(column.read(entry.row), entry.row) : '',
        )
        count += 1
      }
      rows.push(line)
    }
    return { text: toTsv(rows), count }
  }

  const paste = (text: string): void => {
    const matrix = fromTsv(text)
    const rect = selection()
    if (!rect || !matrix.length) return
    let pastedCount = 0
    let skipped = 0
    const single = matrix.length === 1 && matrix[0].length === 1
    const spreads = single && (rect.top !== rect.bottom || rect.left !== rect.right)
    const height = spreads ? rect.bottom - rect.top + 1 : matrix.length
    const width = spreads ? rect.right - rect.left + 1 : Math.max(...matrix.map((line) => line.length))
    const { change } = model.batch('paste', () => {
      const needed = rect.top + height - viewRows().length
      if (needed > 0 && model.canInsert() && !model.sort())
        for (let at = 0; at < needed; at += 1) model.insert(model.entries().length)
      const list = viewRows()
      const edits: { id: string; key: string; value: KetGridValue }[] = []
      for (let r = 0; r < height; r += 1) {
        const entry = list[rect.top + r]
        if (!entry) {
          skipped += width
          continue
        }
        const full = fullOf(entry)
        for (let c = 0; c < width; c += 1) {
          const source = spreads ? matrix[0][0] : (matrix[r]?.[c] ?? '')
          const column = full ? (c === 0 ? model.column(full.key) : undefined) : columns[rect.left + c]
          if (!column) {
            if (!full) skipped += 1
            continue
          }
          if (!model.canEdit(entry, column)) {
            skipped += 1
            continue
          }
          const result = column.parse(source, entry.row)
          if (!result.ok) {
            skipped += 1
            continue
          }
          edits.push({ id: entry.id, key: column.key, value: result.value })
        }
      }
      const outcome = model.edit(edits, 'paste')
      pastedCount = edits.length - outcome.skipped
      skipped += outcome.skipped
    })
    const words = [fill(labels.pasted, { count: pastedCount })]
    if (skipped) words.push(fill(labels.pasteSkipped, { count: skipped }))
    changed(change, words.join('. '))
    anchor = cellAt({ row: rect.top, col: rect.left })
    active = cellAt({
      row: Math.min(viewRows().length - 1, rect.top + height - 1),
      col: Math.min(columns.length - 1, rect.left + width - 1),
    })
    focusActive()
  }

  // ---- Events ----------------------------------------------------------------------------------

  const run = (command: GridCommand, event: KeyboardEvent): boolean => {
    const point = pointOf(active)
    const list = viewRows()
    switch (command.type) {
      case 'move':
        setActive(movePoint(point, command.rows, command.cols, bounds()), command.extend)
        return true
      case 'edge': {
        if (active.id === HEADER && command.rows === 0) {
          setActive(edgePoint(point, 0, command.cols, bounds()))
          return true
        }
        const target = edgePoint(
          point.row < 0 ? { ...point, row: 0 } : point,
          command.rows,
          command.cols,
          bounds(),
        )
        if (!list.length) target.row = -1
        setActive(target, command.extend)
        return true
      }
      case 'page': {
        const step = pageRows(box()) * command.direction
        setActive(movePoint(point.row < 0 ? { ...point, row: 0 } : point, step, 0, bounds()), command.extend)
        return true
      }
      case 'tab':
        return tab(command.backwards)
      case 'edit':
        if (active.id === HEADER) toggleSort(active.key)
        else startEdit('edit')
        return true
      case 'type': {
        if (active.id === HEADER) return false
        const entry = model.entry(active.id)
        const column = entry ? effectiveColumn(entry, active.key) : undefined
        if (!column || column.type === 'checkbox' || column.type === 'date') {
          if (column?.type === 'date') startEdit('edit')
          return true
        }
        // The key is not prevented: with focus already in the editor, the browser types it there,
        // which also lets an input method compose Vietnamese from the first keystroke.
        startEdit('replace')
        return false
      }
      case 'toggle': {
        const entry = active.id === HEADER ? undefined : model.entry(active.id)
        const column = entry ? effectiveColumn(entry, active.key) : undefined
        if (active.id === HEADER) {
          toggleSort(active.key)
          return true
        }
        if (column?.type === 'checkbox') {
          toggle()
          return true
        }
        if (column && model.canEdit(entry as GridEntry<Row>, column)) {
          startEdit('replace')
          return false
        }
        return true
      }
      case 'clear':
        clear()
        return true
      case 'selectAll':
        if (!list.length) return true
        anchor = cellAt({ row: 0, col: 0 })
        active = cellAt({ row: list.length - 1, col: columns.length - 1 })
        render()
        focusActive()
        return true
      case 'fillDown':
        fillDown()
        return true
      case 'undo':
        history('undo')
        return true
      case 'redo':
        history('redo')
        return true
      case 'moveRows':
        moveRows(command.direction)
        return true
      case 'insertRow':
        if (!model.canInsert()) return false
        addRowAt(active.id === HEADER ? 0 : point.row + 1)
        return true
      case 'removeRows':
        removeSelected()
        return true
      case 'collapse':
        if (anchor.id === active.id && anchor.key === active.key) return false
        anchor = active
        render()
        void event
        return true
    }
  }

  viewport.addEventListener(
    'keydown',
    (event) => {
      if (editing || event.defaultPrevented) return
      if ((event.target as Element).closest('[data-ui="kg-editor"]')) return
      const command = gridCommand(event)
      if (!command) return
      if (busy && command.type !== 'move' && command.type !== 'edge' && command.type !== 'page') return
      if (run(command, event)) event.preventDefault()
    },
    { signal },
  )

  viewport.addEventListener(
    'focus',
    () => {
      // Tab reached the grid while its active cell was scrolled away: bring it back.
      if (!editing && !parking) focusActive()
    },
    { signal },
  )

  root.addEventListener(
    'focusin',
    (event) => {
      const cell = (event.target as Element).closest<HTMLElement>(
        '[data-ui="kg-cell"], [data-ui="kg-header-cell"]',
      )
      if (!cell || !viewport.contains(cell) || editing) return
      const target = cellFromElement(cell)
      if (target && (target.id !== active.id || target.key !== active.key)) {
        active = target
        anchor = target
        render()
      }
    },
    { signal },
  )

  root.addEventListener(
    'focusout',
    (event) => {
      if (!editing) return
      const next = event.relatedTarget as Node | null
      if (next && root.contains(next)) return
      // Focus left the grid while editing: keep what was typed when it reads back.
      window.setTimeout(() => {
        if (editing && !root.contains(document.activeElement)) {
          if (!commitEdit({})) cancelEdit()
        }
      }, 0)
    },
    { signal },
  )

  // A press outside the grid (a save button, another field) takes what was typed before that control
  // acts. Focus moves later, and a form may read its fields as the press lands, before any submit check.
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (!editing || (event.target instanceof Node && root.contains(event.target))) return
      commitEdit({})
    },
    { capture: true, signal },
  )

  const cellFromElement = (cell: HTMLElement): { id: string; key: string } | null => {
    if (cell.dataset.ui === 'kg-header-cell') return { id: HEADER, key: cell.dataset.kgKey ?? '' }
    if (footer.contains(cell)) return null
    for (const [id, view] of rendered) {
      const col = view.cells.indexOf(cell)
      if (col >= 0)
        return { id, key: view.full ? (active.id === id ? active.key : columns[col].key) : columns[col].key }
    }
    return null
  }

  // Pointer: click selects, drag extends, a second click (or double click) edits.
  let dragging: { pointerId: number; moved: boolean; wasActive: boolean } | null = null
  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return
      const target = event.target as Element
      if (target.closest('[data-ui="kg-editor"]')) return
      if (target.closest('[data-ui="kg-resize"]')) return startResize(event)
      if (target.closest('[data-ui="kg-handle"]')) return startDrag(event)
      const cellElement = target.closest<HTMLElement>('[data-ui="kg-cell"], [data-ui="kg-header-cell"]')
      if (!cellElement || footer.contains(cellElement)) return
      const cell = cellFromElement(cellElement)
      if (!cell) return
      if (editing && !commitEdit({})) {
        event.preventDefault()
        return
      }
      const wasActive = cell.id === active.id && cell.key === active.key
      if (event.shiftKey && cell.id !== HEADER) active = cell
      else {
        active = cell
        anchor = cell
      }
      editorError = null
      if (event.pointerType === 'mouse') event.preventDefault()
      focusActive()
      dragging = { pointerId: event.pointerId, moved: false, wasActive }
    },
    { signal },
  )
  viewport.addEventListener(
    'pointermove',
    (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId || !(event.buttons & 1) || active.id === HEADER)
        return
      if (event.pointerType !== 'mouse') return
      const under = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-ui="kg-cell"]')
      if (!under || !body.contains(under)) return
      const cell = cellFromElement(under)
      if (!cell || (cell.id === active.id && cell.key === active.key)) return
      dragging.moved = true
      active = cell
      render()
    },
    { signal },
  )
  viewport.addEventListener(
    'pointerup',
    (event) => {
      const held = dragging
      dragging = null
      if (!held || held.pointerId !== event.pointerId || held.moved || !held.wasActive || event.shiftKey)
        return
      const target = event.target as Element
      if (target.closest('[data-ui="kg-check"]')) return
      if (active.id === HEADER) return
      startEdit('edit')
    },
    { signal },
  )
  viewport.addEventListener(
    'dblclick',
    (event) => {
      const target = event.target as Element
      if (target.closest('[data-ui="kg-editor"], [data-ui="kg-check"], [data-ui="kg-resize"]')) return
      if (active.id !== HEADER && !editing) startEdit('edit')
    },
    { signal },
  )
  viewport.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element
      // The browser has already flipped the box; the model takes the same value. Cancelling the
      // click would make the browser restore the old tick after this handler has painted the new one.
      // Repainting puts back a box the grid would not change.
      if (target.closest('[data-ui="kg-check"]')) {
        toggle()
        render()
        return
      }
      const headerCell = target.closest<HTMLElement>('[data-ui="kg-header-cell"]')
      if (headerCell && !target.closest('[data-ui="kg-resize"]') && !resizedJustNow)
        toggleSort(headerCell.dataset.kgKey ?? '')
    },
    { signal },
  )

  // Column resizing: drag a header's right edge; a double click restores its width.
  let resizedJustNow = false
  const startResize = (event: PointerEvent): void => {
    const headerCell = (event.target as Element).closest<HTMLElement>('[data-ui="kg-header-cell"]')
    const column = headerCell ? model.column(headerCell.dataset.kgKey ?? '') : undefined
    if (!headerCell || !column) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.target as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = headerCell.getBoundingClientRect().width
    root.dataset.resizing = 'true'
    const moveTo = (move: PointerEvent): void => {
      widths.set(column.key, Math.max(column.minWidth, Math.round(startWidth + move.clientX - startX)))
      applyGeometry()
    }
    const stop = (): void => {
      handle.removeEventListener('pointermove', moveTo)
      delete root.dataset.resizing
      resizedJustNow = true
      window.setTimeout(() => {
        resizedJustNow = false
      }, 0)
    }
    handle.addEventListener('pointermove', moveTo, { signal })
    handle.addEventListener('pointerup', stop, { once: true, signal })
    handle.addEventListener('pointercancel', stop, { once: true, signal })
  }
  header.addEventListener(
    'dblclick',
    (event) => {
      const headerCell = (event.target as Element).closest<HTMLElement>('[data-ui="kg-header-cell"]')
      if (!headerCell || !(event.target as Element).closest('[data-ui="kg-resize"]')) return
      widths.delete(headerCell.dataset.kgKey ?? '')
      applyGeometry()
    },
    { signal },
  )

  // Row dragging: the handle moves the selected rows (or its own row) to where it is dropped.
  const startDrag = (event: PointerEvent): void => {
    if (!reorderable || model.sort() || busy) return
    const handle = (event.target as Element).closest<HTMLElement>('[data-ui="kg-handle"]')
    const rowElement = handle?.closest<HTMLElement>('[data-ui="kg-row"]')
    const id = [...rendered].find(([, view]) => view.el === rowElement)?.[0]
    if (!handle || !id) return
    event.preventDefault()
    if (editing && !commitEdit({})) return
    const chosen = selectedRows().some((entry) => entry.id === id)
      ? selectedRows().map((entry) => entry.id)
      : [id]
    if (!chosen.includes(active.id)) {
      active = { id, key: active.key === '' ? (columns[0]?.key ?? '') : active.key }
      anchor = active
    }
    handle.setPointerCapture(event.pointerId)
    root.dataset.dragging = 'true'
    let target = indexOf(chosen[0])
    let frame = 0
    let lastY = event.clientY
    const track = (): void => {
      const rect = viewport.getBoundingClientRect()
      const edge = 32
      if (lastY < rect.top + edge) viewport.scrollTop -= 8
      else if (lastY > rect.bottom - edge) viewport.scrollTop += 8
      const bodyTop = body.getBoundingClientRect().top
      target = Math.max(0, Math.min(viewRows().length, Math.round((lastY - bodyTop) / rowHeight)))
      dropLine.hidden = false
      dropLine.style.top = `${target * rowHeight}px`
      frame = requestAnimationFrame(track)
    }
    frame = requestAnimationFrame(track)
    const moveTo = (move: PointerEvent): void => {
      lastY = move.clientY
    }
    const stop = (): void => {
      cancelAnimationFrame(frame)
      handle.removeEventListener('pointermove', moveTo)
      dropLine.hidden = true
      delete root.dataset.dragging
      const first = Math.min(...chosen.map((held) => model.entries().findIndex((entry) => entry.id === held)))
      const to = target > first ? target - chosen.length : target
      if (model.move(chosen, { to }))
        changed({ reason: 'move', cells: [{ id: chosen[0], key: active.key }] }, labels.rowMoved)
      focusActive()
    }
    handle.addEventListener('pointermove', moveTo, { signal })
    handle.addEventListener('pointerup', stop, { once: true, signal })
    handle.addEventListener('pointercancel', stop, { once: true, signal })
  }

  root.addEventListener(
    'copy',
    (event) => {
      if (editing || !viewport.contains(event.target as Node)) return
      const copied = copyText()
      if (!copied || !event.clipboardData) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', copied.text)
      announce(fill(labels.copied, { count: copied.count }))
    },
    { signal },
  )
  root.addEventListener(
    'cut',
    (event) => {
      if (editing || !viewport.contains(event.target as Node) || busy) return
      const copied = copyText()
      if (!copied || !event.clipboardData) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', copied.text)
      clear()
    },
    { signal },
  )
  root.addEventListener(
    'paste',
    (event) => {
      if (editing || !viewport.contains(event.target as Node) || busy || active.id === HEADER) return
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return
      event.preventDefault()
      paste(text)
    },
    { signal },
  )

  tools.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[name="kg-command"]')
      if (!button || button.disabled) return
      if (editing && !commitEdit({})) return
      if (button.value.startsWith('add-')) {
        addRowAt(viewRows().length, Number(button.value.slice(4)))
        startEdit('edit')
      } else if (button.value === 'remove') removeSelected()
      else if (button.value === 'undo') history('undo')
      else if (button.value === 'redo') history('redo')
    },
    { signal },
  )
  message.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[name="kg-resolve"]')
      if (!button || active.id === HEADER) return
      const entry = model.entry(active.id)
      const column = entry ? effectiveColumn(entry, active.key) : undefined
      if (!column) return
      changed(model.resolve(active.id, column.key, button.value === 'theirs' ? 'theirs' : 'mine'))
      focusActive()
    },
    { signal },
  )

  let scrollFrame = 0
  viewport.addEventListener(
    'scroll',
    () => {
      if (scrollFrame) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        const range = visibleRows(box(), viewRows().length)
        if (range.start === renderedRange.start && range.end === renderedRange.end) return
        // An editor does not scroll away with its row: what was typed is kept, or dropped when it
        // does not read back, and focus waits on the grid.
        const at = editing ? indexOf(editing.id) : -1
        if (editing && (at < range.start || at >= range.end) && !commitEdit({ quiet: true })) {
          park()
          closeEditor()
        }
        render()
      })
    },
    { signal, passive: true },
  )
  viewport.addEventListener(
    'pointerover',
    (event) => {
      const holder = (event.target as Element).closest<HTMLElement>('[data-ui="kg-cell-value"]')
      if (!holder) return
      const cell = holder.parentElement
      if (!cell) return
      setAttr(cell, 'title', holder.scrollWidth > holder.clientWidth ? holder.textContent : null)
    },
    { signal },
  )

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          measure()
          render()
        })
  resizeObserver?.observe(viewport)
  const narrow = typeof matchMedia === 'undefined' ? null : matchMedia('(max-width: 47.9375rem)')
  narrow?.addEventListener(
    'change',
    () => {
      measure()
      render()
    },
    { signal },
  )

  container.append(root)
  applyGeometry()
  measure()
  if (hidden) {
    // The default is the clean value, so a form comparing values sees carried edits as the reader's.
    hidden.defaultValue = KET_GRID_NO_CHANGES
    hidden.value = JSON.stringify(posted())
    // The form does not submit while a changed cell is wrong, as a native field with a constraint would
    // not: the checks show, the first wrong cell takes focus and the count is said.
    // On the window, ahead of any submit listener a page or record runtime keeps on the document.
    window.addEventListener(
      'submit',
      (event) => {
        const form = hidden.form
        if (!form || event.target !== form || form.noValidate) return
        const submitter = (event as SubmitEvent).submitter
        if (
          (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
          submitter.formNoValidate
        )
          return
        const open = editing !== null && !commitEdit({})
        const found = model.revealIssues()
        render()
        if (!open && !found.length) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!open && found[0]) api.focusCell(found[0].id, found[0].key)
        announce(fill(labels.fixBeforeSaving, { count: Math.max(found.length, 1) }))
      },
      { capture: true, signal },
    )
  }
  render()

  const api: KetGridApi<Row> = {
    element: root,
    rows: () => model.entries().map((entry) => entry.row),
    changes: () => model.changes(),
    posted,
    summary: () => model.summary(),
    dirty: () => {
      const summary = model.summary()
      return (
        summary.added + summary.edited + summary.removed + elsewhere.length > 0 ||
        model.changes().order !== null
      )
    },
    issues: () => model.issues(),
    validate: () => {
      const found = model.revealIssues()
      render()
      return found
    },
    setReadOnly: (value) => {
      if (value === (options.readOnly === true)) return
      closeEditor()
      options.readOnly = value
      model.setReadOnly(value)
      editableGrid =
        !value &&
        (columns.some((column) => !column.computed || column.computedWriter) ||
          kinds.length > 0 ||
          removable !== undefined)
      setAttr(root, 'data-editable', editableGrid ? 'true' : 'false')
      setAttr(viewport, 'aria-readonly', editableGrid ? null : 'true')
      render()
    },
    setRows: (rows) => {
      closeEditor()
      elsewhere = []
      model.reset(rows)
      if (active.id !== HEADER && indexOf(active.id) < 0) {
        active = { id: HEADER, key: active.key }
        anchor = active
      }
      changed(null)
    },
    applyTransaction: (transaction) => {
      const editingCell = editing ? { id: editing.id, key: editing.key } : null
      const result = model.apply(transaction)
      if (editingCell && !model.entry(editingCell.id)) closeEditor()
      if (active.id !== HEADER && indexOf(active.id) < 0) {
        active = { id: HEADER, key: active.key }
        anchor = active
      }
      changed(null)
      flash(
        result.changed.filter(
          (cell) => !(editingCell && cell.id === editingCell.id && cell.key === editingCell.key),
        ),
      )
    },
    markSaved: (rows) => {
      closeEditor()
      elsewhere = []
      model.markSaved(rows)
      if (active.id !== HEADER && indexOf(active.id) < 0) {
        active = { id: HEADER, key: active.key }
        anchor = active
      }
      changed(null)
    },
    revert: () => {
      closeEditor()
      elsewhere = []
      model.revert()
      if (active.id !== HEADER && indexOf(active.id) < 0) {
        active = { id: HEADER, key: active.key }
        anchor = active
      }
      changed(null)
    },
    setErrors: (errors) => {
      model.setErrors(errors)
      render()
    },
    patch: (id, values) => changed(model.patchRow(id, values as KetGridRow)),
    addRow: (row, at) => {
      const id = model.insert(at ?? model.entries().length, row)
      if (id) changed({ reason: 'add', cells: [{ id, key: columns[0]?.key ?? '' }] })
      return id
    },
    removeRows: (ids) => {
      const gone = model.remove(ids)
      if (gone.length) changed({ reason: 'remove', cells: gone.map((id) => ({ id, key: active.key })) })
      return gone
    },
    focusCell: (id, key) => {
      if (indexOf(id) < 0 || !model.column(key)) return
      active = { id, key }
      anchor = active
      focusActive()
    },
    setBusy: (next) => {
      busy = next
      if (busy) closeEditor()
      setAttr(root, 'aria-busy', busy ? 'true' : null)
      setAttr(root, 'data-busy', busy ? 'true' : null)
      render()
    },
    undo: () => history('undo'),
    redo: () => history('redo'),
    destroy: () => {
      closeEditor()
      lifetime.abort()
      resizeObserver?.disconnect()
      for (const timer of flashTimers.values()) window.clearTimeout(timer)
      cancelAnimationFrame(scrollFrame)
      root.remove()
    },
  }
  return api
}
