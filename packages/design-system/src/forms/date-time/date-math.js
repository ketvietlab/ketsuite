// @ts-check
// UTC is only a stable axis for civil-date arithmetic, never a timezone conversion.
/** @param {string} value */
export const parseDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || year > 9999) return null
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null
}
/** @param {Date} date */
export const dateText = (date) =>
  [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
/** @param {string} value @param {number} days */
export const addDays = (value, days) => {
  const date = parseDate(value)
  if (!date) return ''
  date.setUTCDate(date.getUTCDate() + days)
  const result = dateText(date)
  return parseDate(result) ? result : ''
}
/** @param {string} value @param {number} offset */
export const moveMonth = (value, offset) => {
  const date = parseDate(value)
  if (!date) return ''
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + offset)
  const last = new Date(date)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  date.setUTCDate(Math.min(day, last.getUTCDate()))
  const result = dateText(date)
  return parseDate(result) ? result : ''
}
/** @param {string} value */
export const monthStart = (value) => `${value.slice(0, 7)}-01`
/** @param {string} value */
export const monthEnd = (value) => {
  const date = parseDate(value)
  if (!date) return ''
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return dateText(date)
}
export const presetIds = ['today', 'yesterday', 'last7', 'thisMonth', 'lastMonth', 'last30', 'last90']
/** @param {string} id @param {string} today @returns {[string, string] | null} */
export const presetRange = (id, today) => {
  if (!parseDate(today)) return null
  if (id === 'today') return [today, today]
  if (id === 'yesterday') {
    const day = addDays(today, -1)
    return day ? [day, day] : null
  }
  if (id === 'thisMonth') return [monthStart(today), monthEnd(today)]
  if (id === 'lastMonth') {
    const day = moveMonth(today, -1)
    return day ? [monthStart(day), monthEnd(day)] : null
  }
  const days = { last7: 7, last30: 30, last90: 90 }[/** @type {'last7'|'last30'|'last90'} */ (id)]
  const start = days ? addDays(today, 1 - days) : ''
  return start ? [start, today] : null
}
/** @param {string} value @param {string} [min] @param {string} [max] */
export const withinBounds = (value, min = '', max = '') =>
  !!parseDate(value) && (!parseDate(min) || value >= min) && (!parseDate(max) || value <= max)
/** @param {string} start @param {string} end @returns {[string, string]} */
export const orderedRange = (start, end) => (start <= end ? [start, end] : [end, start])

/** The order a language writes a day in, the way the person reading chose it, not the browser's:
 * English month first, Japanese year first, Vietnamese day first.
 * @param {string} [locale] @returns {('day' | 'month' | 'year')[]} */
export const dayOrder = (locale) =>
  locale === 'en'
    ? ['month', 'day', 'year']
    : locale === 'ja'
      ? ['year', 'month', 'day']
      : ['day', 'month', 'year']
/** The pattern shown in an empty date field. @param {string} [locale] */
export const dayPattern = (locale) => {
  const pattern = dayOrder(locale)
    .map((part) => ({ day: 'dd', month: 'mm', year: 'yyyy' })[part])
    .join('/')
  return locale === 'vi' || !locale ? pattern : pattern.toUpperCase()
}
/** A civil date written in the reader's order; '' for anything that is not one.
 * @param {string} value @param {string} [locale] @param {boolean} [year] */
export const formatDay = (value, locale, year = true) => {
  if (!parseDate(value)) return ''
  const parts = { year: value.slice(0, 4), month: value.slice(5, 7), day: value.slice(8, 10) }
  return dayOrder(locale)
    .filter((part) => year || part !== 'year')
    .map((part) => parts[part])
    .join('/')
}
/** Reads a date typed in the reader's order (any of / . - or spaces between, one or two digits for the
 * day and month) or as an ISO date; '' when it is not a real calendar day.
 * @param {string} text @param {string} [locale] */
export const parseDay = (text, locale) => {
  const value = text.trim()
  if (parseDate(value)) return value
  const numbers = value.split(/[\s./-]+/u)
  if (numbers.length !== 3 || numbers.some((number) => !/^\d+$/u.test(number))) return ''
  /** @type {Record<string, string>} */
  const parts = {}
  dayOrder(locale).forEach((part, index) => {
    parts[part] = numbers[index]
  })
  if (parts.year.length !== 4 || parts.month.length > 2 || parts.day.length > 2) return ''
  const iso = `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`
  return parseDate(iso) ? iso : ''
}
/** Compact display keeps the shared year once, in the reader's order; submitted values remain ISO civil dates.
 * @param {string} start @param {string} end @param {string} [locale] */
export const formatRange = (start, end, locale = 'vi') => {
  if (!parseDate(start) || !parseDate(end)) return ''
  return `${formatDay(start, locale, start.slice(0, 4) !== end.slice(0, 4))} – ${formatDay(end, locale)}`
}
