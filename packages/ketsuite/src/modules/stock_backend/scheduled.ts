/**
 * A transfer's scheduled day says what is planned on it: a receipt brings goods in, a delivery takes them
 * out and an internal transfer moves them. A page of one transfer names the day after its kind; a list
 * of several kinds puts the kind before the day, as "Xuất · 10/11/26".
 */
const KINDS = new Set(['incoming', 'outgoing', 'internal'])

/** The label of a transfer's scheduled day, or the plain "Scheduled date" while its kind is unknown. */
export const scheduledLabelKey = (kind: unknown): string =>
  KINDS.has(String(kind)) ? `transfer.scheduled.${String(kind)}` : 'transfer.list.col.scheduledDate'

/** A scheduled day in a list of several kinds, led by what is planned on it. */
export const scheduledCell = (_: (key: string) => string, kind: unknown, day: string): string =>
  !day
    ? '—'
    : KINDS.has(String(kind))
      ? `${_(`stock_backend.transfer.scheduledKind.${String(kind)}`)} · ${day}`
      : day
