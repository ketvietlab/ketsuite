/** KetSuite shipping vocabulary v1. Provider adapters retain their original code separately. */
export const SHIPPING_STATUSES = [
  'WAITING',
  'REQUEST_RECEIVED',
  'PROCESSING_PICKED_UP',
  'PICKING_UP',
  'DELAY_PICKUP',
  'PICKED_UP',
  'WAITING_ON_THE_WAY',
  'ON_THE_WAY',
  'CONTACT_DELIVERY_COMPANY',
  'OUT_FOR_DELIVERY',
  'DELAY_DELIVERY',
  'INFORM_RECIPIENT',
  'UNDELIVERABLE',
  'WAITING_FOR_RETURN',
  'DELIVERED',
  'DELIVERED_COD',
  'RETURNING',
  'RETURNED',
  'RETURNED_COD',
  'CANCELED',
] as const

export type ShippingStatus = (typeof SHIPPING_STATUSES)[number]
const statuses = new Set<string>(SHIPPING_STATUSES)
/** Strict canonical validation: an unknown provider code is never silently a valid status. */
export function isShippingStatus(value: unknown): value is ShippingStatus {
  return typeof value === 'string' && statuses.has(value)
}

export type ShippingStatusEvidence = {
  status: ShippingStatus | null
  statusRaw: string | null
}
