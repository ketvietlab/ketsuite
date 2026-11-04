// A column as the consumer declares it, and the same column with every default filled in, which is
// what the model and the runtime read.

import type { KetGridColumnType, KetGridOption, KetGridValue, ParseResult, ValueSpec } from './values.ts'
import { formatValue, isBlank, parseValue } from './values.ts'

export type KetGridRow = Record<string, unknown>

export type KetGridSearch<Row> = (
  query: string,
  context: { row: Row; signal: AbortSignal },
) => Promise<readonly KetGridOption[]>

export type KetGridColumn<Row extends KetGridRow = KetGridRow> = {
  /** The column's identity, and the row field it reads unless `field` names another. */
  key: string
  label: string
  type?: KetGridColumnType
  field?: string
  /** Width in CSS pixels; each type has a default. */
  width?: number
  /** A share of the spare width, as a CSS fraction. A pinned column ignores it. */
  grow?: number
  minWidth?: number
  pinned?: 'start' | 'end'
  align?: 'start' | 'center' | 'end'
  /** Columns are read-only unless they say otherwise; a function decides per row. */
  editable?: boolean | ((row: Row) => boolean)
  required?: boolean
  min?: number
  max?: number
  fractionDigits?: number
  /** Money columns: ISO 4217, defaulting to the grid's currency. */
  currency?: string
  options?: readonly KetGridOption[]
  /** Select columns: the options this row may take, among `options` (a product's units). `options` still
      names every value the column shows. */
  optionsFor?: (row: Row) => readonly KetGridOption[]
  /** Combobox columns: options for what the reader typed, read while they type. */
  search?: KetGridSearch<Row>
  /** Muted text in an empty editable cell, such as "Choose a product". */
  placeholder?: string
  /** A longer description of the column, shown as the header's tooltip. */
  hint?: string
  sortable?: boolean
  resizable?: boolean
  /** A computed value. The column is read-only, unless `set` writes what was typed back into the fields it
      is computed from (a margin typed sets the price that earns it). */
  value?: (row: Row) => KetGridValue
  /** Writes an edited value. Return a new row; it may change other fields too (a product sets its price). */
  set?: (row: Row, value: KetGridValue) => Row
  format?: (value: KetGridValue, row: Row) => string
  /** Reads typed or pasted text. Return undefined for text that is not a value of this column. */
  parse?: (text: string, row: Row) => KetGridValue | undefined
  /** A message for a value the reader must fix, or null. */
  validate?: (value: KetGridValue, row: Row) => string | null
  /** The footer total: the sum of the column, or a value computed from the rows. */
  footer?: 'sum' | ((rows: readonly Row[]) => KetGridValue)
}

export type ResolvedColumn<Row extends KetGridRow = KetGridRow> = {
  key: string
  field: string
  label: string
  type: KetGridColumnType
  width: number
  grow: number
  minWidth: number
  pinned: 'start' | 'end' | null
  align: 'start' | 'center' | 'end'
  computed: boolean
  computedWriter: boolean
  editable: (row: Row) => boolean
  required: boolean
  min: number | null
  max: number | null
  options: readonly KetGridOption[]
  /** The options a row may take: `optionsFor`, or every option. */
  choices: (row: Row) => readonly KetGridOption[]
  search: KetGridSearch<Row> | null
  placeholder: string | null
  hint: string | null
  sortable: boolean
  resizable: boolean
  spec: ValueSpec
  read: (row: Row) => KetGridValue
  write: (row: Row, value: KetGridValue) => Row
  format: (value: KetGridValue, row: Row) => string
  parse: (text: string, row: Row) => ParseResult
  validate: ((value: KetGridValue, row: Row) => string | null) | null
  footer: ((rows: readonly Row[]) => KetGridValue) | null
  /** Labels learned from search results, by value, so a chosen option keeps its name. */
  learned: Map<string, string>
}

const defaultWidths: Record<KetGridColumnType, number> = {
  text: 200,
  number: 112,
  money: 136,
  percent: 96,
  date: 136,
  select: 176,
  combobox: 224,
  checkbox: 72,
}

const numeric = new Set<KetGridColumnType>(['number', 'money', 'percent'])

const asValue = (value: unknown): KetGridValue =>
  value === null || value === undefined
    ? null
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : String(value)

export const resolveColumn = <Row extends KetGridRow>(
  column: KetGridColumn<Row>,
  context: { locale: string; currency: string; yes: string; no: string },
): ResolvedColumn<Row> => {
  const type = column.type ?? 'text'
  const field = column.field ?? column.key
  const learned = new Map<string, string>()
  const spec: ValueSpec = {
    type,
    locale: context.locale,
    currency: column.currency ?? context.currency,
    fractionDigits: column.fractionDigits,
    options: column.options ?? [],
    learned: (value) => learned.get(value) ?? null,
    yes: context.yes,
    no: context.no,
  }
  const computed = typeof column.value === 'function'
  const read = computed ? (row: Row) => asValue(column.value?.(row)) : (row: Row) => asValue(row[field])
  const editable =
    computed && !column.set
      ? () => false
      : typeof column.editable === 'function'
        ? column.editable
        : () => column.editable === true
  const sum = (rows: readonly Row[]): KetGridValue => {
    let total = 0
    let any = false
    for (const row of rows) {
      const value = read(row)
      if (typeof value === 'number' && Number.isFinite(value)) {
        total += value
        any = true
      }
    }
    return any ? Math.round(total * 1e9) / 1e9 : null
  }
  return {
    key: column.key,
    field,
    label: column.label,
    type,
    width: Math.max(column.minWidth ?? 48, column.width ?? defaultWidths[type]),
    grow: column.pinned ? 0 : Math.max(0, column.grow ?? 0),
    minWidth: column.minWidth ?? 48,
    pinned: column.pinned ?? null,
    align: column.align ?? (numeric.has(type) ? 'end' : type === 'checkbox' ? 'center' : 'start'),
    computed,
    computedWriter: computed && !!column.set && !!column.editable,
    editable,
    required: column.required === true,
    min: typeof column.min === 'number' ? column.min : null,
    max: typeof column.max === 'number' ? column.max : null,
    options: column.options ?? [],
    choices: column.optionsFor ?? (() => column.options ?? []),
    search: column.search ?? null,
    placeholder: column.placeholder ?? null,
    hint: column.hint ?? null,
    sortable: column.sortable === true,
    resizable: column.resizable !== false,
    spec,
    read,
    write: column.set ?? ((row: Row, value: KetGridValue) => ({ ...row, [field]: value }) as Row),
    format: column.format ?? ((value) => formatValue(value, spec)),
    parse: column.parse
      ? (text, row) => {
          const value = column.parse?.(text, row)
          return value === undefined ? { ok: false, reason: 'value' } : { ok: true, value }
        }
      : (text, row) => {
          const result = parseValue(text, spec)
          // Typed or pasted, a value this row may not take is not one of its options.
          return result.ok &&
            column.optionsFor &&
            !isBlank(result.value) &&
            !column.optionsFor(row).some((option) => option.value === String(result.value))
            ? { ok: false, reason: 'option' }
            : result
        },
    validate: column.validate ?? null,
    footer: column.footer === 'sum' ? sum : (column.footer ?? null),
    learned,
  }
}

/** The value a cleared cell takes. */
export const clearedValue = (column: { type: KetGridColumnType }): KetGridValue =>
  column.type === 'checkbox' ? false : column.type === 'text' ? '' : null

export const blankCell = (column: { type: KetGridColumnType }, value: KetGridValue): boolean =>
  column.type === 'checkbox' ? false : isBlank(value)
