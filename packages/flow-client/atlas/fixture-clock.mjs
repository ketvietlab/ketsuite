// Atlas fixtures are written against one calendar day. A living mock moves that
// day close to the real date, so due dates, sprints and reports keep the meaning
// the fixture intends ("in progress", "due next week") instead of all becoming
// overdue as time passes. Used by Atlas only; product code never imports it.
import { addDays, parseDay } from '@ketvietlab/flow-client/timeline.mjs'

export const FIXTURE_ANCHOR = '2026-09-22'

const DAY = 86400000
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?=$|T| )/
const MONTH = /^\d{4}-\d{2}$/

/**
 * Whole weeks between the anchor and `today`, rounded down. Weekdays stay
 * aligned (sprints start on the same weekday) and `today` lands 0–6 days after
 * the shifted anchor, inside the fixture's active sprint.
 * @param {string} today YYYY-MM-DD
 */
export function fixtureShiftDays(today) {
  const from = parseDay(FIXTURE_ANCHOR),
    to = parseDay(today)
  if (!from || !to) return 0
  return Math.floor((+to - +from) / DAY / 7) * 7
}

/**
 * Days from the shifted anchor to `today` (0–6): how far into the fixture week the clock lands.
 * Generators use it to keep open work's due dates at the same distance from today on every weekday.
 * @param {string} today YYYY-MM-DD
 */
export function fixturePhase(today) {
  const from = parseDay(FIXTURE_ANCHOR),
    to = parseDay(today)
  if (!from || !to) return 0
  return Math.round((+to - +from) / DAY) - fixtureShiftDays(today)
}

const monthIndex = (value) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1
const monthOf = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`

/**
 * Shifts every calendar value in a seeded organization by whole weeks.
 * Dates (`2026-09-22`, `2026-09-22T08:00:00Z`, `2026-09-22 · 14:30`) move by the
 * day offset; periods (`2026-09`) move to the month of `today`, so the fixture's
 * current period is always the real one. Records the applied shift as
 * `data.fixtureClock` and returns the day offset.
 * @param {any} data
 * @param {string} today YYYY-MM-DD
 * @param {{skip?: string[]}} [options] top-level keys kept on their calendar (e.g. quarterly goals)
 */
export function rebaseFixtureDates(data, today, { skip = [] } = {}) {
  if (!parseDay(today)) return 0
  const days = fixtureShiftDays(today),
    months = monthIndex(today) - monthIndex(FIXTURE_ANCHOR)
  data.fixtureClock = { anchor: FIXTURE_ANCHOR, today, days, months }
  if (!days && !months) return 0
  const seen = new WeakSet()
  const shift = (value) => {
    if (MONTH.test(value)) return months ? monthOf(monthIndex(value) + months) : value
    const match = DATE_PREFIX.exec(value)
    return match && parseDay(match[1]) ? addDays(match[1], days) + value.slice(match[1].length) : value
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    for (const key of Object.keys(node)) {
      if (node === data && (skip.includes(key) || key === 'fixtureClock')) continue
      const value = node[key]
      if (typeof value === 'string') node[key] = shift(value)
      else walk(value)
    }
  }
  walk(data)
  // The compact board label mirrors dueDate; keep both readings identical.
  for (const task of data.tasks ?? [])
    if (task.dueDate) task.due = `${task.dueDate.slice(8, 10)}/${task.dueDate.slice(5, 7)}`
  return days
}
