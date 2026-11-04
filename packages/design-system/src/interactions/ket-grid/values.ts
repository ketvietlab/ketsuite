// Cell values as data: how each column type shows, edits, reads back and sorts a value in one
// locale. Pure functions, so the grid runtime, the clipboard and the tests share one answer.

export type KetGridValue = string | number | boolean | null

export type KetGridColumnType =
  | 'text'
  | 'number'
  | 'money'
  | 'percent'
  | 'date'
  | 'select'
  | 'combobox'
  | 'checkbox'

export type KetGridOption = { value: string; label: string; description?: string | null }

/** Everything a value needs to be shown, edited and read back. */
export type ValueSpec = {
  type: KetGridColumnType
  locale: string
  currency: string
  fractionDigits?: number
  options?: readonly KetGridOption[]
  /** A label the grid learned for a choice that is not among `options` (a search result). */
  learned?: (value: string) => string | null
  yes: string
  no: string
}

export type ParseResult =
  | { ok: true; value: KetGridValue }
  | { ok: false; reason: 'number' | 'date' | 'option' | 'boolean' | 'value' }

export const isBlank = (value: unknown): boolean => value === null || value === undefined || value === ''

/** Blank values are one value: a cell that was empty and is now '' has not changed. */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (isBlank(a) && isBlank(b)) return true
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b))
  if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object'))
    return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

/** Case- and accent-insensitive text for matching, so "hoa don" finds "Hóa đơn". */
export const searchText = (text: string): string =>
  text.replace(/[đĐ]/gu, 'd').normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().trim()

const numberFormats = new Map<string, Intl.NumberFormat>()
const numberFormat = (locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
  const key = `${locale}|${JSON.stringify(options)}`
  let held = numberFormats.get(key)
  if (!held) {
    held = new Intl.NumberFormat(locale, options)
    numberFormats.set(key, held)
  }
  return held
}

const separatorCache = new Map<string, { group: string; decimal: string }>()
export const separators = (locale: string): { group: string; decimal: string } => {
  let held = separatorCache.get(locale)
  if (!held) {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
    held = {
      group: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    }
    separatorCache.set(locale, held)
  }
  return held
}

/** The minor-unit digits of a currency: VND has none, USD two. */
export const currencyDigits = (currency: string, locale: string): number =>
  numberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

const groupedPattern = (pieces: readonly string[]): boolean =>
  pieces.length > 1 &&
  pieces[0].length >= 1 &&
  pieces[0].length <= 3 &&
  pieces.slice(1).every((piece) => piece.length === 3)

/**
 * Reads a number the way people type one. Either separator may be the decimal one: in Vietnamese
 * "1.234.567" is grouped and "1,5" is a half, but "1.5" (a keypad dot) is a half too, because a
 * group has three digits. `k` and `tr` scale by a thousand and a million when `shorthand` is on.
 * Returns null for blank text and undefined for text that is not a number.
 */
export const parseNumber = (
  input: string,
  locale: string,
  options: { shorthand?: boolean } = {},
): number | null | undefined => {
  const compact = input.replace(/[\s  ]/gu, '').replace(/[₫$€£¥%]|VND|USD|đ$/giu, '')
  if (!compact) return isBlank(input.trim()) ? null : undefined
  const match = /^([+\-−]?)((?:\d|[.,](?=\d))[\d.,]*)(k|tr)?$/iu.exec(compact)
  if (!match) return undefined
  const [, sign, body, suffix] = match
  if (suffix && !options.shorthand) return undefined
  const { group, decimal } = separators(locale)
  const hasDot = body.includes('.')
  const hasComma = body.includes(',')
  let integer = body
  let fraction = ''
  if (hasDot && hasComma) {
    const decimalChar = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ','
    const groupChar = decimalChar === '.' ? ',' : '.'
    const at = body.lastIndexOf(decimalChar)
    const head = body.slice(0, at)
    if (head.includes(decimalChar) || !groupedPattern(head.split(groupChar))) return undefined
    integer = head.split(groupChar).join('')
    fraction = body.slice(at + 1)
  } else if (hasDot || hasComma) {
    const char = hasDot ? '.' : ','
    const pieces = body.split(char)
    const grouped = groupedPattern(pieces)
    // A lone separator is a decimal point unless it is this locale's group separator and
    // the digits after it form a group ("1.234" in Vietnamese is a thousand two hundred…).
    if (pieces.length === 2 && !(char === group && grouped) && !(char !== decimal && grouped)) {
      integer = pieces[0]
      fraction = pieces[1]
    } else if (grouped) integer = pieces.join('')
    else return undefined
  }
  if (!/^\d*$/u.test(integer) || !/^\d*$/u.test(fraction)) return undefined
  const value = Number(`${sign === '-' || sign === '−' ? '-' : ''}${integer || '0'}.${fraction || '0'}`)
  if (!Number.isFinite(value)) return undefined
  const scale = suffix ? (suffix.toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1
  return Math.round(value * scale * 1e9) / 1e9
}

export const formatNumber = (
  value: number,
  locale: string,
  options: { minimum?: number; maximum?: number; grouping?: boolean } = {},
): string =>
  numberFormat(locale, {
    minimumFractionDigits: options.minimum ?? 0,
    maximumFractionDigits: Math.max(options.minimum ?? 0, options.maximum ?? 2),
    useGrouping: options.grouping ?? true,
  }).format(value)

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u

const realDate = (year: number, month: number, day: number): string | undefined => {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return undefined
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const dateOrders = new Map<string, readonly ('day' | 'month' | 'year')[]>()
export const dateOrder = (locale: string): readonly ('day' | 'month' | 'year')[] => {
  let held = dateOrders.get(locale)
  if (!held) {
    held = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(Date.UTC(2026, 10, 23)))
      .map((part) => part.type)
      .filter(
        (type): type is 'day' | 'month' | 'year' => type === 'day' || type === 'month' || type === 'year',
      )
    if (held.length !== 3) held = ['day', 'month', 'year']
    dateOrders.set(locale, held)
  }
  return held
}

/** Reads ISO dates and dates in the locale's own order ("07/10/2026" is 7 October in Vietnamese). */
export const parseDate = (input: string, locale: string): string | null | undefined => {
  const text = input.trim()
  if (!text) return null
  const iso = isoDatePattern.exec(text)
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const pieces = text.split(/[/.\-\s]+/u)
  if (pieces.length !== 3 || pieces.some((piece) => !/^\d{1,4}$/u.test(piece))) return undefined
  const parts: Record<string, number> = {}
  dateOrder(locale).forEach((type, index) => {
    parts[type] = Number(pieces[index])
  })
  const year = parts.year < 100 ? 2000 + parts.year : parts.year
  return realDate(year, parts.month, parts.day)
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()
export const formatDate = (iso: string, locale: string): string => {
  const match = isoDatePattern.exec(iso)
  if (!match) return iso
  let format = dateFormats.get(locale)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    })
    dateFormats.set(locale, format)
  }
  return format.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))))
}

const truths = new Set(['true', '1', 'yes', 'y', 'x', '✓', 'co', 'dung'])
const falsehoods = new Set(['false', '0', 'no', 'n', '', 'khong', 'sai'])
export const parseBoolean = (input: string, spec?: Pick<ValueSpec, 'yes' | 'no'>): boolean | undefined => {
  const text = searchText(input)
  if (truths.has(text) || (spec && text === searchText(spec.yes))) return true
  if (falsehoods.has(text) || (spec && text === searchText(spec.no))) return false
  return undefined
}

/** The option whose value or label (ignoring case and accents) is this text. */
export const matchOption = (input: string, options: readonly KetGridOption[]): KetGridOption | undefined => {
  const text = input.trim()
  const exact = options.find((option) => option.value === text)
  if (exact) return exact
  const wanted = searchText(text)
  return options.find((option) => searchText(option.label) === wanted)
}

export const optionLabel = (value: KetGridValue, spec: ValueSpec): string => {
  if (isBlank(value)) return ''
  const key = String(value)
  return spec.options?.find((option) => option.value === key)?.label ?? spec.learned?.(key) ?? key
}

const moneyFraction = (spec: ValueSpec): number =>
  spec.fractionDigits ?? currencyDigits(spec.currency, spec.locale)

/** What a cell shows. */
export const formatValue = (value: KetGridValue, spec: ValueSpec): string => {
  if (spec.type === 'checkbox') return value === true ? spec.yes : spec.no
  if (isBlank(value)) return ''
  switch (spec.type) {
    case 'number': {
      if (typeof value !== 'number') return String(value)
      const digits = spec.fractionDigits
      return formatNumber(value, spec.locale, { minimum: digits ?? 0, maximum: digits ?? 2 })
    }
    case 'money': {
      if (typeof value !== 'number') return String(value)
      const digits = moneyFraction(spec)
      return formatNumber(value, spec.locale, { minimum: digits, maximum: digits })
    }
    case 'percent':
      return typeof value === 'number'
        ? numberFormat(spec.locale, {
            style: 'percent',
            minimumFractionDigits: spec.fractionDigits ?? 0,
            maximumFractionDigits: spec.fractionDigits ?? 2,
          }).format(value / 100)
        : String(value)
    case 'date':
      return formatDate(String(value), spec.locale)
    case 'select':
    case 'combobox':
      return optionLabel(value, spec)
    default:
      return String(value)
  }
}

/** The text an editor starts from: numbers without grouping, so they read back unchanged. */
export const editText = (value: KetGridValue, spec: ValueSpec): string => {
  if (isBlank(value)) return ''
  if (
    (spec.type === 'number' || spec.type === 'money' || spec.type === 'percent') &&
    typeof value === 'number'
  )
    return formatNumber(value, spec.locale, { maximum: 10, grouping: false })
  if (spec.type === 'date') return String(value)
  return formatValue(value, spec)
}

/** Reads typed or pasted text back into a value of this type. */
export const parseValue = (text: string, spec: ValueSpec): ParseResult => {
  switch (spec.type) {
    case 'number':
    case 'percent': {
      const value = parseNumber(text, spec.locale)
      if (value === undefined) return { ok: false, reason: 'number' }
      return { ok: true, value }
    }
    case 'money': {
      const value = parseNumber(text, spec.locale, { shorthand: true })
      if (value === undefined) return { ok: false, reason: 'number' }
      if (value === null) return { ok: true, value }
      const scale = 10 ** moneyFraction(spec)
      return { ok: true, value: Math.round(value * scale) / scale }
    }
    case 'date': {
      const value = parseDate(text, spec.locale)
      return value === undefined ? { ok: false, reason: 'date' } : { ok: true, value }
    }
    case 'checkbox': {
      const value = parseBoolean(text, spec)
      return value === undefined ? { ok: false, reason: 'boolean' } : { ok: true, value }
    }
    case 'select':
    case 'combobox': {
      if (!text.trim()) return { ok: true, value: null }
      const known = matchOption(text, spec.options ?? [])
      if (known) return { ok: true, value: known.value }
      const learned = spec.learned?.(text.trim())
      return learned !== null && learned !== undefined
        ? { ok: true, value: text.trim() }
        : { ok: false, reason: 'option' }
    }
    default:
      return { ok: true, value: text.replace(/\r?\n$/u, '') }
  }
}

const collators = new Map<string, Intl.Collator>()
const collator = (locale: string): Intl.Collator => {
  let held = collators.get(locale)
  if (!held) {
    held = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
    collators.set(locale, held)
  }
  return held
}

/** Sort order for one column: blanks last, numbers by size, text by the locale's collation. */
export const compareValues = (a: KetGridValue, b: KetGridValue, spec: ValueSpec): number => {
  const blankA = isBlank(a)
  const blankB = isBlank(b)
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (spec.type === 'date') return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  return collator(spec.locale).compare(formatValue(a, spec), formatValue(b, spec))
}
