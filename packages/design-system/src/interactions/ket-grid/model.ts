// The grid's data, apart from the DOM: the rows as the server last sent them, the reader's drafts
// over them, what changed, what must be fixed, undo and redo, and changes arriving from elsewhere.

import type { KetGridRow, ResolvedColumn } from './columns.ts'
import { blankCell } from './columns.ts'
import type { KetGridValue } from './values.ts'
import { compareValues, isBlank, sameValue } from './values.ts'

export type KetGridMessages = {
  required: string
  /** `{min}` is replaced with the formatted minimum. */
  belowMin: string
  /** `{max}` is replaced with the formatted maximum. */
  aboveMax: string
  /** `{value}` is replaced with the value set elsewhere. */
  conflict: string
  removedElsewhere: string
}

export type KetGridIssue = { id: string; key: string; tone: 'danger' | 'warning'; message: string }

export type KetGridChanges<Row extends KetGridRow = KetGridRow> = {
  /** New rows the reader filled in, with their position. Rows added and left empty are not changes. */
  added: { id: string; index: number; row: Row }[]
  /** Existing rows with the fields that differ from the server's copy. */
  updated: { id: string; row: Row; fields: string[] }[]
  removed: string[]
  /** Every row id in order, when the reader reordered rows or added one before the end; else null. */
  order: string[] | null
}

export type KetGridTransaction<Row extends KetGridRow = KetGridRow> = {
  add?: readonly Row[]
  update?: readonly Row[]
  remove?: readonly string[]
}

export type KetGridSummary = {
  added: number
  edited: number
  removed: number
  errors: number
  conflicts: number
}

export type GridEntry<Row extends KetGridRow = KetGridRow> = {
  readonly id: string
  /** The server's copy; null for a row added here. */
  base: Row | null
  /** The row as it was created or loaded, for telling an untouched new row. */
  initial: Row
  row: Row
  /** Columns the reader edited: their checks show from the first edit. */
  touched: Set<string>
  /** Fields changed elsewhere while the reader had another value, by field: the other value. */
  conflicts: Map<string, unknown>
  removedElsewhere: boolean
}

export type CellEdit = { id: string; key: string; value: KetGridValue }

type Step = { undo: () => void; redo: () => void }
export type GridChange = { reason: string; cells: { id: string; key: string }[] }

export type GridModelConfig<Row extends KetGridRow> = {
  columns: readonly ResolvedColumn<Row>[]
  rows: readonly Row[]
  rowId: (row: Row) => string
  createRow: ((context: { index: number }) => Row) | null
  rowEditable: (row: Row) => boolean
  rowRemovable: (row: Row) => boolean
  /** The one column a full-width row (a section or a note) shows; its other cells do not exist. */
  fullWidthKey?: (row: Row) => string | null
  readOnly: boolean
  messages: KetGridMessages
  historyLimit?: number
  draftFlags?: readonly string[]
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (whole, key: string) => values[key] ?? whole)

const asValue = (value: unknown): KetGridValue =>
  value === null || value === undefined
    ? null
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : String(value)

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

export type GridModel<Row extends KetGridRow> = ReturnType<typeof createGridModel<Row>>

export const createGridModel = <Row extends KetGridRow>(config: GridModelConfig<Row>) => {
  const columns = config.columns
  const byKey = new Map(columns.map((column) => [column.key, column]))
  const limit = config.historyLimit ?? 200
  let entries: GridEntry<Row>[] = []
  const index = new Map<string, GridEntry<Row>>()
  let removed = new Map<string, { entry: GridEntry<Row>; index: number }>()
  /** Rows the reader moved since the last load or save. */
  let moved = new Set<string>()
  let baseOrder: string[] = []
  let serverErrors = new Map<string, Map<string, string>>()
  let reveal = false
  let sort: { key: string; direction: 'asc' | 'desc' } | null = null
  let history: (GridChange & { steps: Step[] })[] = []
  let future: (GridChange & { steps: Step[] })[] = []
  let pending: (GridChange & { steps: Step[] }) | null = null
  let depth = 0
  let version = 0
  let temp = 0
  const memo = new Map<string, { version: number; value: unknown }>()
  const remember = <Value>(name: string, compute: () => Value): Value => {
    const held = memo.get(name)
    if (held && held.version === version) return held.value as Value
    const value = compute()
    memo.set(name, { version, value })
    return value
  }

  const touch = (): void => {
    version += 1
  }

  const loaded = (row: Row, id: string): GridEntry<Row> => ({
    id,
    base: row,
    initial: row,
    row,
    touched: new Set(),
    conflicts: new Map(),
    removedElsewhere: false,
  })

  const load = (rows: readonly Row[]): void => {
    entries = []
    index.clear()
    removed = new Map()
    moved = new Set()
    baseOrder = []
    serverErrors = new Map()
    reveal = false
    history = []
    future = []
    for (const row of rows) {
      const id = String(config.rowId(row))
      if (index.has(id)) throw new Error(`KetGrid: two rows have the id "${id}".`)
      const entry = loaded(row, id)
      entries.push(entry)
      index.set(id, entry)
      baseOrder.push(id)
    }
    touch()
  }
  load(config.rows)

  const begin = (reason: string): void => {
    if (depth === 0) pending = { reason, steps: [], cells: [] }
    depth += 1
  }
  const end = (): GridChange | null => {
    depth -= 1
    if (depth > 0) return null
    const done = pending
    pending = null
    touch()
    if (!done?.steps.length) return null
    history.push(done)
    if (history.length > limit) history.shift()
    future = []
    return { reason: done.reason, cells: done.cells }
  }
  const record = (step: Step, cell?: { id: string; key: string }): void => {
    pending?.steps.push(step)
    if (cell) pending?.cells.push(cell)
  }

  const fieldsOf = (a: KetGridRow, b: KetGridRow): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((field) => !sameValue(a[field], b[field]))
  const pick = (row: KetGridRow, fields: readonly string[]): KetGridRow =>
    Object.fromEntries(fields.map((field) => [field, row[field]]))
  const patch = (entry: GridEntry<Row>, values: KetGridRow): void => {
    entry.row = { ...entry.row, ...values } as Row
  }

  const pristine = (entry: GridEntry<Row>): boolean =>
    entry.base === null && !entry.removedElsewhere && fieldsOf(entry.initial, entry.row).length === 0
  const shown = (entry: GridEntry<Row>, column: ResolvedColumn<Row>): boolean => {
    const key = config.fullWidthKey?.(entry.row) ?? null
    return key === null || key === column.key
  }
  const canEdit = (entry: GridEntry<Row>, column: ResolvedColumn<Row>): boolean =>
    !config.readOnly && shown(entry, column) && config.rowEditable(entry.row) && column.editable(entry.row)
  const canRemove = (entry: GridEntry<Row>): boolean => !config.readOnly && config.rowRemovable(entry.row)
  const cellDirty = (entry: GridEntry<Row>, column: ResolvedColumn<Row>): boolean =>
    !column.computed && !sameValue(column.read(entry.row), column.read(entry.base ?? entry.initial))
  /** Moved rows that no longer sit where the server has them, among the rows both still hold. */
  const displaced = (): ReadonlySet<string> =>
    remember('displaced', () => {
      const before = baseOrder.filter((id) => index.get(id)?.base)
      const seat = new Map(before.map((id, at) => [id, at]))
      const now = entries.filter((entry) => entry.base).map((entry) => entry.id)
      return new Set(now.filter((id, at) => moved.has(id) && seat.get(id) !== at))
    })
  /** Whether the whole row is unsaved: it is new, or it was moved. An edited value is the cell's. */
  const rowUnsaved = (entry: GridEntry<Row>): boolean => entry.base === null || displaced().has(entry.id)

  const cellIssue = (
    entry: GridEntry<Row>,
    column: ResolvedColumn<Row>,
  ): { tone: 'danger' | 'warning'; message: string; theirs?: KetGridValue } | null => {
    const server = serverErrors.get(entry.id)?.get(column.key)
    if (server) return { tone: 'danger', message: server }
    if (!column.computed && entry.conflicts.has(column.field)) {
      const theirs = asValue(entry.conflicts.get(column.field))
      const shown = column.format(theirs, { ...entry.row, [column.field]: theirs })
      return { tone: 'warning', message: fill(config.messages.conflict, { value: shown }), theirs }
    }
    if (!canEdit(entry, column) || pristine(entry)) return null
    if (!reveal && !entry.touched.has(column.key)) return null
    if (entry.base && !cellDirty(entry, column) && !entry.touched.has(column.key)) return null
    const value = column.read(entry.row)
    if (column.required && blankCell(column, value))
      return { tone: 'danger', message: config.messages.required }
    if (typeof value === 'number') {
      if (column.min !== null && value < column.min)
        return {
          tone: 'danger',
          message: fill(config.messages.belowMin, { min: column.format(column.min, entry.row) }),
        }
      if (column.max !== null && value > column.max)
        return {
          tone: 'danger',
          message: fill(config.messages.aboveMax, { max: column.format(column.max, entry.row) }),
        }
    }
    const custom = column.validate?.(value, entry.row)
    return custom ? { tone: 'danger', message: custom } : null
  }

  const worthChecking = (entry: GridEntry<Row>): boolean =>
    serverErrors.has(entry.id) ||
    entry.conflicts.size > 0 ||
    entry.removedElsewhere ||
    (entry.base === null
      ? !pristine(entry)
      : entry.touched.size > 0 || fieldsOf(entry.base, entry.row).length > 0)

  const issues = (): KetGridIssue[] =>
    remember('issues', () => {
      const list: KetGridIssue[] = []
      for (const entry of entries) {
        if (!worthChecking(entry)) continue
        if (entry.removedElsewhere)
          list.push({
            id: entry.id,
            key: columns[0]?.key ?? '',
            tone: 'warning',
            message: config.messages.removedElsewhere,
          })
        for (const column of columns) {
          const issue = cellIssue(entry, column)
          if (issue) list.push({ id: entry.id, key: column.key, tone: issue.tone, message: issue.message })
        }
      }
      return list
    })

  const changes = (): KetGridChanges<Row> =>
    remember('changes', () => {
      const added: KetGridChanges<Row>['added'] = []
      const updated: KetGridChanges<Row>['updated'] = []
      const kept: GridEntry<Row>[] = []
      for (const entry of entries) {
        if (entry.base === null) {
          if (pristine(entry)) continue
          added.push({ id: entry.id, index: kept.length, row: entry.row })
          kept.push(entry)
          continue
        }
        kept.push(entry)
        const fields = fieldsOf(entry.base, entry.row)
        if (fields.length) updated.push({ id: entry.id, row: entry.row, fields })
      }
      const before = baseOrder.filter((id) => index.get(id)?.base)
      const now = kept.filter((entry) => entry.base).map((entry) => entry.id)
      const firstAdded = kept.findIndex((entry) => entry.base === null)
      const appended = firstAdded < 0 || kept.slice(firstAdded).every((entry) => entry.base === null)
      const reordered = before.length !== now.length || before.some((id, at) => id !== now[at])
      return {
        added,
        updated,
        removed: [...removed.keys()],
        order: !reordered && appended ? null : kept.map((entry) => entry.id),
      }
    })

  const summary = (): KetGridSummary =>
    remember('summary', () => {
      let edited = 0
      for (const entry of entries)
        if (entry.base) for (const column of columns) if (cellDirty(entry, column)) edited += 1
      const found = issues()
      return {
        added: changes().added.length,
        edited,
        removed: removed.size,
        errors: found.filter((issue) => issue.tone === 'danger').length,
        conflicts: found.filter((issue) => issue.tone === 'warning').length,
      }
    })

  const view = (): GridEntry<Row>[] =>
    remember('view', () => {
      const column = sort ? byKey.get(sort.key) : null
      if (!sort || !column) return entries.slice()
      const factor = sort.direction === 'asc' ? 1 : -1
      return entries
        .map((entry, at) => ({ entry, at, value: column.read(entry.row) }))
        .sort((a, b) => {
          const blankA = isBlank(a.value)
          const blankB = isBlank(b.value)
          if (blankA !== blankB) return blankA ? 1 : -1
          return compareValues(a.value, b.value, column.spec) * factor || a.at - b.at
        })
        .map((item) => item.entry)
    })

  const edit = (
    cells: readonly CellEdit[],
    reason: string,
  ): { change: GridChange | null; skipped: number } => {
    begin(reason)
    let skipped = 0
    for (const cell of cells) {
      const entry = index.get(cell.id)
      const column = byKey.get(cell.key)
      if (!entry || !column || !canEdit(entry, column)) {
        skipped += 1
        continue
      }
      entry.touched.add(column.key)
      const before = entry.row
      const after = column.write(before, cell.value)
      const fields = fieldsOf(before, after)
      if (!fields.length) continue
      const was = pick(before, fields)
      const now = pick(after, fields)
      entry.row = after
      record(
        { undo: () => patch(entry, was), redo: () => patch(entry, now) },
        { id: entry.id, key: column.key },
      )
      for (const field of fields) entry.conflicts.delete(field)
      const errors = serverErrors.get(entry.id)
      if (errors)
        for (const other of columns)
          if (other.key === column.key || fields.includes(other.field)) errors.delete(other.key)
    }
    return { change: end(), skipped }
  }

  /** Writes fields directly, as a consumer's own reaction to an edit (a looked-up price). */
  const patchRow = (id: string, values: KetGridRow): GridChange | null => {
    const entry = index.get(id)
    if (!entry) return null
    begin('patch')
    const fields = fieldsOf(entry.row, { ...entry.row, ...values })
    if (fields.length) {
      const was = pick(entry.row, fields)
      const now = pick(values, fields)
      patch(entry, now)
      record({ undo: () => patch(entry, was), redo: () => patch(entry, now) })
    }
    return end()
  }

  // Replay trusted column writers in declaration order. Parents precede their dependent cells;
  // Hidden setter metadata comes from writers. Explicit user-owned boolean modes may survive
  // navigation; authorization/lock fields must never be declared as draft flags.
  const restoreValues = (entry: GridEntry<Row>, values: KetGridRow): void => {
    for (const column of columns) {
      if (!(column.field in values) || !canEdit(entry, column)) continue
      const before = entry.row
      entry.row = column.write(before, asValue(values[column.field]))
      if (fieldsOf(before, entry.row).length) entry.touched.add(column.key)
    }
    if (!config.readOnly && config.rowEditable(entry.row) && !config.fullWidthKey?.(entry.row))
      for (const field of config.draftFlags ?? [])
        if (typeof values[field] === 'boolean') entry.row = { ...entry.row, [field]: values[field] }
  }

  /**
   * Puts back edits the reader made in an earlier view of these rows (a draft kept while they changed
   * page). They are drafts again, not steps to undo: undo covers what was done here. Only cells the
   * reader may still edit take them. Returns the updates for rows this grid does not hold.
   */
  const restore = (
    updates: readonly { id: string; values: KetGridRow }[],
  ): { id: string; values: KetGridRow }[] => {
    const elsewhere: { id: string; values: KetGridRow }[] = []
    for (const update of updates) {
      const entry = index.get(update.id)
      if (!entry) {
        if (!removed.has(update.id)) elsewhere.push(update)
        continue
      }
      if (entry.base === null) continue
      restoreValues(entry, update.values)
    }
    touch()
    return elsewhere
  }

  const insert = (at: number, row?: Row, id?: string): string | null => {
    if (config.readOnly) return null
    const made = row ?? config.createRow?.({ index: at })
    if (!made) return null
    let key = id && !index.has(id) && !removed.has(id) ? id : ''
    while (!key || index.has(key) || removed.has(key)) {
      temp += 1
      key = `new-${temp}`
    }
    const entry: GridEntry<Row> = {
      id: key,
      base: null,
      initial: made,
      row: made,
      touched: new Set(),
      conflicts: new Map(),
      removedElsewhere: false,
    }
    const position = clamp(at, 0, entries.length)
    const put = (): void => {
      entries.splice(Math.min(position, entries.length), 0, entry)
      index.set(entry.id, entry)
    }
    const take = (): void => {
      const found = entries.indexOf(entry)
      if (found >= 0) entries.splice(found, 1)
      index.delete(entry.id)
    }
    begin('add')
    put()
    record({ undo: take, redo: put }, { id: entry.id, key: columns[0]?.key ?? '' })
    end()
    return entry.id
  }

  const remove = (ids: readonly string[]): string[] => {
    const targets = [...new Set(ids)]
      .map((id) => index.get(id))
      .filter((entry): entry is GridEntry<Row> => !!entry && canRemove(entry))
      .sort((a, b) => entries.indexOf(a) - entries.indexOf(b))
    if (!targets.length) return []
    const positions = targets.map((entry) => entries.indexOf(entry))
    const takeAll = (): void => {
      for (let at = targets.length - 1; at >= 0; at -= 1) {
        const entry = targets[at]
        const found = entries.indexOf(entry)
        if (found >= 0) entries.splice(found, 1)
        index.delete(entry.id)
        if (entry.base) removed.set(entry.id, { entry, index: positions[at] })
      }
    }
    const putAll = (): void => {
      targets.forEach((entry, at) => {
        entries.splice(Math.min(positions[at], entries.length), 0, entry)
        index.set(entry.id, entry)
        removed.delete(entry.id)
      })
    }
    begin('remove')
    takeAll()
    record({ undo: putAll, redo: takeAll })
    end()
    return targets.map((entry) => entry.id)
  }

  const place = (block: readonly GridEntry<Row>[], at: number): void => {
    const rest = entries.filter((entry) => !block.includes(entry))
    const position = clamp(at, 0, rest.length)
    entries = [...rest.slice(0, position), ...block, ...rest.slice(position)]
  }

  /** Moves rows as one block: by a number of places, or so the block starts at `to`. */
  const move = (ids: readonly string[], target: { by: number } | { to: number }): boolean => {
    if (config.readOnly) return false
    const block = entries.filter((entry) => ids.includes(entry.id))
    if (!block.length) return false
    const from = entries.indexOf(block[0])
    const contiguous = block.every((entry, at) => entries[from + at] === entry)
    const to = clamp('by' in target ? from + target.by : target.to, 0, entries.length - block.length)
    if (to === from && contiguous) return false
    // Undo takes back the mark with the move, so a row it returns is not left marked as moved.
    const fresh = block.filter((entry) => !moved.has(entry.id)).map((entry) => entry.id)
    const mark = (on: boolean): void => {
      for (const id of fresh) {
        if (on) moved.add(id)
        else moved.delete(id)
      }
    }
    begin('move')
    place(block, to)
    mark(true)
    record(
      {
        undo: () => {
          place(block, from)
          mark(false)
        },
        redo: () => {
          place(block, to)
          mark(true)
        },
      },
      {
        id: block[0].id,
        key: columns[0]?.key ?? '',
      },
    )
    end()
    return true
  }

  const step = (direction: 'undo' | 'redo'): GridChange | null => {
    const source = direction === 'undo' ? history : future
    const target = direction === 'undo' ? future : history
    const change = source.pop()
    if (!change) return null
    if (direction === 'undo') for (let at = change.steps.length - 1; at >= 0; at -= 1) change.steps[at].undo()
    else for (const item of change.steps) item.redo()
    target.push(change)
    touch()
    return { reason: change.reason, cells: change.cells }
  }

  /** Applies rows changed elsewhere. Returns the cells whose shown value changed, to highlight. */
  const apply = (
    transaction: KetGridTransaction<Row>,
  ): { changed: { id: string; key: string }[]; added: string[]; removed: string[]; conflicts: number } => {
    const changed: { id: string; key: string }[] = []
    const added: string[] = []
    const gone: string[] = []
    let conflicts = 0
    const arrive = (row: Row): void => {
      const id = String(config.rowId(row))
      const entry = index.get(id) ?? removed.get(id)?.entry
      if (!entry) {
        const made = loaded(row, id)
        entries.push(made)
        index.set(id, made)
        baseOrder.push(id)
        added.push(id)
        for (const column of columns) changed.push({ id, key: column.key })
        return
      }
      const previous = entry.base ?? entry.initial
      const shown = entry.row
      const merged: KetGridRow = { ...entry.row }
      for (const field of new Set([...Object.keys(previous), ...Object.keys(row)])) {
        const theirs = row[field]
        if (sameValue(previous[field], theirs)) continue
        if (sameValue(entry.row[field], previous[field])) merged[field] = theirs
        else if (sameValue(entry.row[field], theirs)) entry.conflicts.delete(field)
        else {
          entry.conflicts.set(field, theirs)
          conflicts += 1
        }
      }
      if (entry.base === null && !baseOrder.includes(id)) baseOrder.push(id)
      entry.base = row
      entry.removedElsewhere = false
      entry.row = merged as Row
      if (index.has(id))
        for (const column of columns)
          if (!sameValue(column.read(shown), column.read(entry.row))) changed.push({ id, key: column.key })
    }
    for (const row of transaction.update ?? []) arrive(row)
    for (const row of transaction.add ?? []) arrive(row)
    for (const id of transaction.remove ?? []) {
      baseOrder = baseOrder.filter((held) => held !== id)
      if (removed.delete(id)) continue
      const entry = index.get(id)
      if (!entry) continue
      const clean = entry.base !== null && !fieldsOf(entry.base, entry.row).length && !entry.conflicts.size
      if (clean) {
        entries = entries.filter((held) => held !== entry)
        index.delete(id)
        serverErrors.delete(id)
        gone.push(id)
      } else {
        entry.base = null
        entry.removedElsewhere = true
      }
    }
    touch()
    return { changed, added, removed: gone, conflicts }
  }

  const resolve = (id: string, key: string, choice: 'mine' | 'theirs'): GridChange | null => {
    const entry = index.get(id)
    const column = byKey.get(key)
    if (!entry || !column || !entry.conflicts.has(column.field)) return null
    const theirs = asValue(entry.conflicts.get(column.field))
    entry.conflicts.delete(column.field)
    if (choice === 'mine') {
      touch()
      return { reason: 'resolve', cells: [{ id, key }] }
    }
    return patchRow(id, { [column.field]: theirs }) ?? { reason: 'resolve', cells: [{ id, key }] }
  }

  const markSaved = (rows?: readonly Row[]): void => {
    if (rows) {
      const keepSort = sort
      load(rows)
      sort = keepSort
      return
    }
    entries = entries.filter((entry) => !pristine(entry))
    for (const entry of entries) {
      entry.base = entry.row
      entry.initial = entry.row
      entry.touched.clear()
      entry.conflicts.clear()
      entry.removedElsewhere = false
    }
    index.clear()
    for (const entry of entries) index.set(entry.id, entry)
    removed = new Map()
    moved = new Set()
    baseOrder = entries.map((entry) => entry.id)
    serverErrors = new Map()
    reveal = false
    history = []
    future = []
    touch()
  }

  const revert = (): void => {
    const rows = baseOrder
      .map((id) => index.get(id) ?? removed.get(id)?.entry)
      .filter((entry): entry is GridEntry<Row> => !!entry?.base)
      .map((entry) => entry.base as Row)
    const keepSort = sort
    load(rows)
    sort = keepSort
  }

  /** Restore a whole form draft, including unsaved additions/removals/order, without an undo step. */
  const restoreDraft = (
    draft: {
      added: { id: string; index: number; values: KetGridRow }[]
      updated: { id: string; values: KetGridRow }[]
      removed: string[]
      order: string[] | null
    },
    policy: { add: boolean; remove: boolean; order: boolean },
  ) => {
    if (config.readOnly) return []
    if (policy.remove) remove(draft.removed)
    if (policy.add)
      for (const entry of draft.added) {
        if (index.has(entry.id) || removed.has(entry.id)) continue
        const defaults = config.createRow?.({ index: entry.index }) ?? ({} as Row)
        const id = insert(entry.index, defaults, entry.id)
        const restored = id ? index.get(id) : null
        if (restored) restoreValues(restored, entry.values)
      }
    const elsewhere = restore(draft.updated)
    if (policy.order && draft.order)
      draft.order.forEach((id, at) => {
        if (index.has(id)) move([id], { to: at })
      })
    history = []
    future = []
    return elsewhere
  }

  return {
    columns,
    column: (key: string): ResolvedColumn<Row> | undefined => byKey.get(key),
    entry: (id: string): GridEntry<Row> | undefined => index.get(id),
    entries: (): readonly GridEntry<Row>[] => entries,
    view,
    version: (): number => version,
    canEdit,
    canRemove,
    canInsert: (): boolean => !config.readOnly && config.createRow !== null,
    cellDirty,
    rowUnsaved,
    cellIssue,
    pristine,
    issues,
    changes,
    summary,
    edit,
    patchRow,
    restore,
    restoreDraft,
    setReadOnly: (value: boolean): void => {
      config.readOnly = value
      touch()
    },
    insert,
    remove,
    move,
    undo: (): GridChange | null => (config.readOnly ? null : step('undo')),
    redo: (): GridChange | null => (config.readOnly ? null : step('redo')),
    canUndo: (): boolean => !config.readOnly && history.length > 0,
    canRedo: (): boolean => !config.readOnly && future.length > 0,
    /** One undo step for several operations: calls inside `work` join this batch. */
    batch: <Value>(reason: string, work: () => Value): { value: Value; change: GridChange | null } => {
      begin(reason)
      try {
        const value = work()
        return { value, change: end() }
      } catch (error) {
        end()
        throw error
      }
    },
    sort: (): { key: string; direction: 'asc' | 'desc' } | null => sort,
    setSort: (next: { key: string; direction: 'asc' | 'desc' } | null): void => {
      sort = next
      touch()
    },
    apply,
    resolve,
    setErrors: (errors: Readonly<Record<string, Readonly<Record<string, string>>>>): void => {
      serverErrors = new Map(
        Object.entries(errors).map(([id, fields]) => [id, new Map(Object.entries(fields))] as const),
      )
      touch()
    },
    revealIssues: (): KetGridIssue[] => {
      reveal = true
      touch()
      return issues()
    },
    totals: (): Map<string, KetGridValue> =>
      remember('totals', () => {
        const rows = entries.map((entry) => entry.row)
        const totals = new Map<string, KetGridValue>()
        for (const column of columns) if (column.footer) totals.set(column.key, column.footer(rows))
        return totals
      }),
    reset: (rows: readonly Row[]): void => {
      const keepSort = sort
      load(rows)
      sort = keepSort
    },
    markSaved,
    revert,
  }
}
