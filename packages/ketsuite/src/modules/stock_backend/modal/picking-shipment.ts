import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { SHIPMENT_TONES, shipmentHref } from '../delivery/shared.ts'

const OPEN = ['waiting', 'confirmed', 'assigned']

/**
 * K48: a delivery's page leads to its shipment, for a reader of shipments, or offers to make one while the
 * delivery to a customer still waits, for who may.
 */
export async function pickingShipment(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  picking: Row,
  code: unknown,
  /** Whether it takes goods to a customer and returns none: what `stock.createShipment` accepts. */
  toCustomer: boolean,
) {
  if (code !== 'outgoing') return null
  const _ = ctx.translate(ctx.localeOf(url, req) === 'en' ? 'en' : 'vi')
  const parcels =
    (await optionalRead<Row[]>(ctx, 'stock.listShipments', { pickingId: picking.id }, url, req, [])) ?? []
  // The live parcel first, else the latest one cancelled.
  const parcel = parcels.find((row) => row.state !== 'cancel') ?? parcels.at(-1)
  const create =
    (!parcel || parcel.state === 'cancel') &&
    toCustomer &&
    OPEN.includes(String(picking.state)) &&
    (await ctx.allows('stock.createShipment', url, req))
  if (!parcel && !create) return null
  return {
    create,
    parcel: parcel
      ? {
          name: String(parcel.name),
          href: shipmentHref(url, parcel.id),
          statusText: _(`stock_backend.shipment.state.${String(parcel.state)}`),
          tone: SHIPMENT_TONES[String(parcel.state)] ?? 'neutral',
        }
      : null,
  }
}
