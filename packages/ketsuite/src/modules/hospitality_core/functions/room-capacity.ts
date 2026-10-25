import type { Row } from '@ketvietlab/ketjs'

/** Children use physical places; only a purchased extra bed expands adult capacity. */
export function roomAdultCapacity(room: Row, type: Row, children: number) {
  if (!Number.isInteger(children) || children < 0 || children > Number(type.maxChildren ?? 0)) return -1
  return Math.min(Number(type.maxAdults), Number(room.capacity ?? type.defaultCapacity) - children)
}

export function supportedExtraBeds(type: Row) {
  return Math.min(1, Math.max(0, Number(type.maxExtraBeds ?? 0)))
}

export function purchasedExtraBeds(stay: Row) {
  return Math.min(1, Math.max(0, Number(stay.extraBeds ?? 0)))
}

export function roomFitsStay(room: Row, type: Row, stay: Row) {
  const base = roomAdultCapacity(room, type, Number(stay.children ?? 0))
  return (
    base >= 0 && Number(stay.adults) <= base + Math.min(purchasedExtraBeds(stay), supportedExtraBeds(type))
  )
}
