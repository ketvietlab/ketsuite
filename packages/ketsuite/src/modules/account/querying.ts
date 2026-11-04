import type { Row } from '@ketvietlab/ketjs'
import { MOVE_TYPES, PAYMENT_STATES } from './vocabulary.ts'
import { n } from './validation.ts'

/**
 * Paging is opt-in, never implicit. A screen asks for a page; an export or a
 * report asks for everything and gets it, rather than a silently truncated list
 * that reads as complete.
 */
export const paginate = <Q extends { limit(size: number): Q; offset(start: number): Q }>(
  q: Q,
  limit: unknown,
  offset: unknown,
): Q => {
  const size = Math.trunc(n(limit))
  const start = Math.trunc(n(offset))
  const limited = size > 0 ? q.limit(size) : q
  return start > 0 ? limited.offset(start) : limited
}

export const slice = <T>(rows: T[], limit: unknown, offset: unknown): T[] => {
  const size = Math.trunc(n(limit))
  const start = Math.max(0, Math.trunc(n(offset)))
  return size > 0 ? rows.slice(start, start + size) : rows.slice(start)
}

export const moveTypeList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter((type) => MOVE_TYPES.includes(type as never)) : []

export const paymentStateList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter((state) => PAYMENT_STATES.includes(state as never)) : []

/**
 * The slice of a list a picker actually needs.
 *
 * A relation picker sends `search` on every keystroke and `limit` to keep the
 * response small; `validateInput` rejects inputs a function does not declare, so
 * a list without them cannot back a picker at all. `product` and `uom` carry the
 * same helper for the same reason.
 */
export const narrow = (rows: Row[], args: { search?: unknown; limit?: unknown }, fields: string[]): Row[] => {
  const needle = String(args.search ?? '')
    .trim()
    .toLocaleLowerCase()
  const matched = needle
    ? rows.filter((row) =>
        fields.some((field) =>
          String(row[field] ?? '')
            .toLocaleLowerCase()
            .includes(needle),
        ),
      )
    : rows
  const limit = Number(args.limit)
  return Number.isInteger(limit) && limit > 0 ? matched.slice(0, limit) : matched
}
