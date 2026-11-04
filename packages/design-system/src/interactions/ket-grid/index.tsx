import { computedGridValue, canSolveGridValue, solveGridValue, type GridCompute } from './calculations.ts'
// KetGrid: an editable data grid that runs entirely in the browser, for live tabular work such as
// order lines, stock counts and price lists. `createKetGrid` builds it inside a container from
// client code; `ketGrid` is the same grid as a ketjs-view island whose server view is only a
// loading placeholder. Reading a collection is KetTable's job; KetGrid is for editing rows in place.

import type { IslandController, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'
import { Skeleton } from '../skeleton/index.tsx'
import type { KetGridColumn, KetGridRow } from './columns.ts'
import type { KetGridApi, KetGridLabels, KetGridOptions, KetGridPosted } from './runtime.ts'
import { createKetGrid, defaultKetGridLabels } from './runtime.ts'
import type { KetGridColumnType, KetGridOption, KetGridValue } from './values.ts'
import { searchText } from './values.ts'

export { createKetGrid, KET_GRID_NO_CHANGES } from './runtime.ts'
export type {
  KetGridApi,
  KetGridCell,
  KetGridChangeEvent,
  KetGridFullWidth,
  KetGridLabels,
  KetGridOptions,
  KetGridPosted,
} from './runtime.ts'
export type { KetGridColumn, KetGridRow, KetGridSearch } from './columns.ts'
export type { KetGridChanges, KetGridIssue, KetGridSummary, KetGridTransaction } from './model.ts'
export type { KetGridColumnType, KetGridOption, KetGridValue } from './values.ts'

export const HOOKS = [
  'ket-grid',
  'ket-grid-island',
  'kg-placeholder',
  'kg-viewport',
  'kg-header',
  'kg-header-cell',
  'kg-header-label',
  'kg-sort',
  'kg-resize',
  'kg-body',
  'kg-spacer',
  'kg-row',
  'kg-cell',
  'kg-cell-value',
  'kg-check',
  'kg-flag',
  'kg-handle',
  'kg-drop',
  'kg-empty',
  'kg-footer',
  'kg-editor',
  'kg-popup',
  'kg-options',
  'kg-options-status',
  'kg-option',
  'kg-option-label',
  'kg-option-description',
  'kg-message',
  'kg-message-actions',
  'kg-tools',
  'kg-status',
  'kg-value',
] as const

/** A value worked out from the row. `multiply` is what the row sells for: the product of those fields less the
    percentage in `percentOff` (a line's subtotal). With `less`, the product of those fields comes off it, as
    an amount or, with `as: 'percent'`, as a share of what it sells for (a line's margin and margin %). With
    `solve`, the column is editable where `editable` allows: a value typed sets that field, one of `multiply`,
    to what gives it, rounded to `digits` places (a margin typed sets the unit price that earns it). */
export type KetGridCompute = GridCompute

/** A column as island props: data only, so it crosses from the server as JSON. */
export type KetGridIslandColumn = Omit<
  KetGridColumn,
  'editable' | 'search' | 'value' | 'set' | 'format' | 'parse' | 'validate' | 'footer'
> & {
  type?: KetGridColumnType
  editable?: boolean
  /** A value worked out from the row (KetGridCompute): a line's subtotal, margin or margin %, or one
      field less another (a count's difference), empty while either is. */
  compute?: KetGridCompute
  footer?: 'sum'
  /** A row field that, when set (true, a non-zero number, text), makes this column read-only on that
      row, such as a product already delivered. */
  lockedBy?: string
  /** A row field that must be set before this column opens on that row: a unit waits for its product. */
  requires?: string
  /** A row field holding the smallest value this column takes on that row, such as what was delivered. */
  minField?: string
  /** A row field holding the largest value this column takes on that row, such as what is still due. */
  maxField?: string
  /** Cross-field quantity validation, shown at the edited cell while retaining its draft. */
  sumEquals?: { fields: readonly string[]; total: string; message: string }
  /** Select columns: a row field whose value picks the options that row may take, such as a product's units
      by product. A value `values` does not name leaves every option. */
  optionsBy?: { field: string; values: Readonly<Record<string, readonly string[]>> }
  /** Fields a choice also writes into its row, by option value: a product's description, unit and price. */
  sets?: Readonly<Record<string, KetGridRow>>
  /** Constant dependent fields written after a successful edit, including a computed inverse. */
  writeSets?: KetGridRow
  /** Clear dependent fields when this cell changes (a SKU clears its unit and automatic price). */
  resets?: readonly string[]
  /** Combobox columns read options from a KetJS function (`POST /_ket/fn/<name>`) as the reader types. */
  search?: {
    listFunction: string
    listInput?: Record<string, unknown>
    /** Required function inputs read from this row; no request until every parent is set. */
    listInputFields?: Readonly<Record<string, string>>
    searchParam?: string
    limitParam?: string
    limit?: number
    idField?: string
    labelField?: string
    /** Fallback for records without the compact identifier used as their cell label. */
    labelFallbackField?: string
    descriptionField?: string
    /** Trusted remote option fields copied into row fields on selection, scoped by listInputFields. */
    setsFrom?: Readonly<Record<string, string>>
  }
}

export type KetGridIslandConfig = {
  label: string
  columns: readonly KetGridIslandColumn[]
  rows: readonly KetGridRow[]
  /** The row field holding its id. Defaults to `id`. */
  idField?: string
  labels?: Partial<KetGridLabels>
  locale?: string
  currency?: string
  density?: 'compact' | 'default' | 'comfortable'
  visibleRows?: number
  height?: string
  readOnly?: boolean
  /** A new row's starting values; lets the reader add rows. */
  newRow?: KetGridRow
  /** Several kinds of new row, each with its own add button (a line, a section, a note); replaces `newRow`. */
  newRows?: readonly { label: string; row: KetGridRow }[]
  removable?: boolean
  reorderable?: boolean
  /** A row field whose value `section` or `note` shows the row as one full-width cell of `fullWidthKey`. */
  kindField?: string
  fullWidthKey?: string
  /** A row field that, when set on a section or note, shows `label` after its text, as an optional section. */
  fullWidthTag?: { field: string; label: string }
  /** A row field that, when true, makes the row read-only and keeps it from being removed. */
  lockedField?: string
  /** Fields a row takes in steps of another field, as a product's price by quantity: the row's `key`
      field picks a list of steps, and the step with the largest `from` at most the row's `by` field
      writes its fields. Applied after `sets` whenever either field is edited; a row whose `lockedBy`
      field is set (a line already delivered) keeps its fields. With `with` (a product's unit), the steps
      of `<key>|<with>` come first, then those of the key alone; editing `with` steps the row too. */
  tiers?: {
    key: string
    by: string
    with?: string
    lockedBy?: string | readonly string[]
    steps?: Readonly<Record<string, readonly { from: number; row: KetGridRow }[]>>
    /** A row-owned array of steps supplied by a remote picker, preferred over static steps. */
    stepsField?: string
  }
  name?: string
  form?: string
  /** An earlier posted value of this grid, as the JSON text a record draft keeps; see `carry`. */
  carry?: string | KetGridPosted | null
  /** User-owned boolean intent carried with drafts; never authorization or lock metadata. */
  draftFlags?: readonly string[]
}

type KetGridIslandProps = IslandProps & { id: string; config: KetGridIslandConfig }

type FunctionPayload = { ok?: boolean; value?: unknown; message?: unknown; errors?: { message?: unknown }[] }

const searchFunction =
  (
    search: NonNullable<KetGridIslandColumn['search']>,
    remember?: (rows: KetGridRow[], row: KetGridRow) => void,
  ) =>
  async (query: string, context: { row: KetGridRow; signal: AbortSignal }): Promise<KetGridOption[]> => {
    const input: Record<string, unknown> = { ...(search.listInput ?? {}) }
    for (const [name, field] of Object.entries(search.listInputFields ?? {})) {
      const value = context.row[field]
      if (value === undefined || value === null || value === '') return []
      input[name] = value
    }
    input[search.searchParam ?? 'search'] = query
    input[search.limitParam ?? 'limit'] = search.limit ?? 50
    const response = await fetch(`/_ket/fn/${encodeURIComponent(search.listFunction)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: context.signal,
    })
    const payload = (await response.json()) as FunctionPayload
    if (!response.ok || payload.ok === false)
      throw new Error(String(payload.errors?.[0]?.message ?? payload.message ?? `HTTP ${response.status}`))
    const rows = Array.isArray(payload.value) ? (payload.value as KetGridRow[]) : []
    remember?.(rows, context.row)
    return rows.map((row) => ({
      value: String(row[search.idField ?? 'id'] ?? ''),
      label: String(
        row[search.labelField ?? 'name'] ||
          (search.labelFallbackField ? row[search.labelFallbackField] : '') ||
          '',
      ),
      description: search.descriptionField ? String(row[search.descriptionField] ?? '') || null : null,
    }))
  }

/** A carried value as the grid's own shape; text that is not one (an empty draft) carries nothing. */
const carried = (value: KetGridIslandConfig['carry']): KetGridPosted | null => {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = value ? JSON.parse(value) : null
    } catch {
      return null
    }
  }
  const updated = (parsed as { updated?: unknown } | null)?.updated
  if (!Array.isArray(updated)) return null
  const rawLabels = (parsed as KetGridPosted).optionLabels
  const optionLabels =
    rawLabels && typeof rawLabels === 'object' && !Array.isArray(rawLabels)
      ? Object.fromEntries(
          Object.entries(rawLabels)
            .filter(([, labels]) => labels && typeof labels === 'object' && !Array.isArray(labels))
            .map(([key, labels]) => [
              key,
              Object.fromEntries(Object.entries(labels).filter(([, label]) => typeof label === 'string')),
            ]),
        )
      : undefined
  return {
    ...(optionLabels ? { optionLabels } : {}),
    added: Array.isArray((parsed as KetGridPosted).added)
      ? (parsed as KetGridPosted).added.filter(
          (item) =>
            typeof item?.id === 'string' &&
            Number.isInteger(item.index) &&
            item.index >= 0 &&
            !!item.values &&
            typeof item.values === 'object' &&
            !Array.isArray(item.values),
        )
      : [],
    updated: updated.filter(
      (item): item is { id: string; values: KetGridRow } =>
        typeof item?.id === 'string' &&
        !!item.values &&
        typeof item.values === 'object' &&
        !Array.isArray(item.values),
    ),
    removed: Array.isArray((parsed as KetGridPosted).removed)
      ? (parsed as KetGridPosted).removed.filter((id) => typeof id === 'string')
      : [],
    order: Array.isArray((parsed as KetGridPosted).order)
      ? (parsed as KetGridPosted).order!.filter((id) => typeof id === 'string')
      : null,
  }
}

const held = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== false && value !== 0 && value !== ''

/** The island's JSON config as `createKetGrid` options. */
export const ketGridOptions = (config: KetGridIslandConfig): KetGridOptions => {
  const idField = config.idField ?? 'id'
  const locked = (row: KetGridRow): boolean => (config.lockedField ? row[config.lockedField] === true : false)
  const belowMin = config.labels?.belowMin ?? defaultKetGridLabels.belowMin
  const aboveMax = config.labels?.aboveMax ?? defaultKetGridLabels.aboveMax
  const number = new Intl.NumberFormat(config.locale)
  const tiers = config.tiers
  const tierLocks: readonly string[] =
    typeof tiers?.lockedBy === 'string' ? [tiers.lockedBy] : (tiers?.lockedBy ?? [])
  const stepped = (row: KetGridRow): KetGridRow => {
    if (!tiers || tierLocks.some((field) => held(row[field]))) return row
    const amount = row[tiers.by]
    if (typeof amount !== 'number') return row
    let step: { from: number; row: KetGridRow } | undefined
    const key = String(row[tiers.key] ?? '')
    const paired = tiers.with ? tiers.steps?.[`${key}|${String(row[tiers.with] ?? '')}`] : undefined
    const dynamic = tiers.stepsField ? row[tiers.stepsField] : undefined
    const candidates = Array.isArray(dynamic)
      ? dynamic.filter(
          (item): item is { from: number; row: KetGridRow } =>
            !!item &&
            typeof item.from === 'number' &&
            Number.isFinite(item.from) &&
            item.row &&
            typeof item.row === 'object' &&
            !Array.isArray(item.row),
        )
      : (paired ?? tiers.steps?.[key] ?? [])
    for (const candidate of candidates)
      if (candidate.from <= amount && (!step || candidate.from >= step.from)) step = candidate
    return step ? { ...row, ...step.row } : row
  }
  return {
    label: config.label,
    rows: config.rows,
    rowId: (row) => String(row[idField] ?? ''),
    labels: config.labels,
    locale: config.locale,
    currency: config.currency,
    density: config.density,
    visibleRows: config.visibleRows,
    height: config.height,
    readOnly: config.readOnly,
    rowEditable: (row) => !locked(row),
    createRow: config.newRow ? () => ({ ...config.newRow }) : undefined,
    newRows: config.newRows?.map((kind) => ({ label: kind.label, create: () => ({ ...kind.row }) })),
    removable: config.removable ? (row) => !locked(row) : undefined,
    reorderable: config.reorderable,
    fullWidth:
      config.kindField && config.fullWidthKey
        ? (row) => {
            const kind = row[config.kindField ?? '']
            return kind === 'section' || kind === 'note'
              ? {
                  key: config.fullWidthKey ?? '',
                  tone: kind,
                  tag:
                    config.fullWidthTag && held(row[config.fullWidthTag.field])
                      ? config.fullWidthTag.label
                      : undefined,
                }
              : null
          }
        : undefined,
    name: config.name,
    form: config.form,
    carry: carried(config.carry),
    draftFlags: config.draftFlags?.filter(
      (field) =>
        field !== config.lockedField &&
        !tierLocks.includes(field) &&
        !config.columns.some((column) => column.lockedBy === field),
    ),
    columns: config.columns.map(
      ({
        compute,
        search,
        lockedBy,
        requires,
        minField,
        maxField,
        sumEquals,
        sets,
        resets,
        writeSets,
        optionsBy,
        ...column
      }): KetGridColumn => {
        const field = column.field ?? column.key
        const remoteSets = new Map<string, KetGridRow>()
        const remoteKey = (row: KetGridRow, value: unknown) =>
          JSON.stringify([
            ...Object.values(search?.listInputFields ?? {}).map((key) => row[key] ?? null),
            value,
          ])
        const remember = (rows: KetGridRow[], row: KetGridRow) => {
          if (!search?.setsFrom) return
          for (const result of rows) {
            remoteSets.set(
              remoteKey(row, String(result[search.idField ?? 'id'] ?? '')),
              Object.fromEntries(
                Object.entries(search.setsFrom).map(([key, source]) => [key, result[source] ?? null]),
              ),
            )
            if (remoteSets.size > 1000) remoteSets.delete(remoteSets.keys().next().value!)
          }
        }
        const solve = compute && 'multiply' in compute ? compute.solve : undefined
        const targetText =
          solve &&
          config.columns.some((item) => (item.field ?? item.key) === solve.field && item.type === 'text')
        const write =
          sets || writeSets || resets?.length || search?.setsFrom
            ? (row: KetGridRow, value: KetGridValue) => ({
                ...row,
                ...(row[field] !== value
                  ? Object.fromEntries(
                      (resets ?? [])
                        .filter((key) => {
                          const target = config.columns.find(
                            (candidate) => (candidate.field ?? candidate.key) === key,
                          )
                          return !target?.lockedBy || !held(row[target.lockedBy])
                        })
                        .map((key) => [key, null]),
                    )
                  : {}),
                [field]: value,
                ...(sets?.[String(value)] ?? {}),
                ...(remoteSets.get(remoteKey(row, value)) ?? {}),
                ...writeSets,
              })
            : undefined
        return {
          ...column,
          value: compute ? (row) => computedGridValue(compute, row) : undefined,
          search: search
            ? async (query, context) => {
                const allowed = optionsBy?.values[String(context.row[optionsBy.field] ?? '')]
                if (!allowed) return searchFunction(search, remember)(query, context)
                const needle = searchText(query)
                return (column.options ?? []).filter(
                  (option) =>
                    allowed.includes(option.value) &&
                    searchText(`${option.label} ${option.description ?? ''}`).includes(needle),
                )
              }
            : undefined,
          optionsFor: optionsBy
            ? (row) => {
                const allowed = optionsBy.values[String(row[optionsBy.field] ?? '')]
                const options = column.options ?? []
                return allowed ? options.filter((option) => allowed.includes(option.value)) : options
              }
            : undefined,
          editable:
            column.editable && (lockedBy || requires || solve)
              ? (row) =>
                  (!lockedBy || !held(row[lockedBy])) &&
                  (!requires || held(row[requires])) &&
                  (!solve || canSolveGridValue(compute!, row))
              : column.editable,
          set: solve
            ? (row, value) => {
                const solved = solveGridValue(compute!, row, value, !!targetText)
                return solved === row ? row : { ...solved, ...writeSets }
              }
            : tiers && (field === tiers.key || field === tiers.by || field === tiers.with)
              ? (row, value) => stepped(write ? write(row, value) : { ...row, [field]: value })
              : write,
          validate:
            minField || maxField || sumEquals
              ? (value, row) => {
                  if (sumEquals) {
                    const total = Number(row[sumEquals.total])
                    const sum = sumEquals.fields.reduce((sum, field) => sum + Number(row[field] ?? 0), 0)
                    if (!Number.isFinite(total) || !Number.isFinite(sum) || Math.abs(sum - total) > 0.000001)
                      return sumEquals.message
                  }
                  if (typeof value !== 'number') return null
                  const least = minField ? Number(row[minField] ?? 0) : Number.NaN
                  if (Number.isFinite(least) && value < least)
                    return belowMin.replace('{min}', number.format(least))
                  const most = maxField ? Number(row[maxField] ?? Number.NaN) : Number.NaN
                  return Number.isFinite(most) && value > most
                    ? aboveMax.replace('{max}', number.format(most))
                    : null
                }
              : undefined,
        }
      },
    ),
  }
}

/** The server's stand-in until the grid draws itself: a frame of loading lines. */
export const KetGridPlaceholder = (props: { label?: string; rows?: number }): TemplateResult => (
  <div data-ui="kg-placeholder" aria-busy="true">
    <Skeleton
      label={props.label ?? defaultKetGridLabels.loading}
      lines={Math.max(2, Math.min(12, Math.trunc(props.rows ?? 4)))}
    />
  </div>
)

/** The grid as a ketjs-view island: the server renders the placeholder, the browser the grid. */
export const ketGrid = (props: IslandProps): IslandController => {
  const { id, config } = props as KetGridIslandProps
  let grid: KetGridApi | null = null
  let rows = JSON.stringify(config.rows)
  return {
    view: () => (
      <div data-ui="ket-grid-island" id={id}>
        <KetGridPlaceholder label={config.labels?.loading} rows={Math.min(config.rows.length || 4, 8)} />
      </div>
    ),
    mount: ({ root }) => {
      const host = (root as unknown as HTMLElement).querySelector<HTMLElement>('[data-ui="ket-grid-island"]')
      if (!host) return
      const placeholder = host.querySelector<HTMLElement>('[data-ui="kg-placeholder"]')
      if (placeholder) placeholder.hidden = true
      grid = createKetGrid(host, ketGridOptions(config))
      // Page code that feeds the grid (a live channel, a save) takes its API from this event.
      host.dispatchEvent(new CustomEvent('ket:grid-ready', { bubbles: true, detail: { grid } }))
    },
    update: (next) => {
      const nextConfig = (next as KetGridIslandProps).config
      grid?.setReadOnly(nextConfig.readOnly === true)
      const nextRows = JSON.stringify(nextConfig.rows)
      if (grid && nextRows !== rows) grid.setRows(nextConfig.rows)
      rows = nextRows
    },
    dispose: () => {
      grid?.destroy()
      grid = null
    },
  }
}
