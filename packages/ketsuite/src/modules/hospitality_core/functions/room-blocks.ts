import { eq, from, inArray, lte } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { dateKeyIn } from '../calendar.ts'

/** The day a room's status speaks for: the property's open business day, or its calendar day if it has none. */
export const roomStatusDay = (property: Row): string =>
  String(property.businessDate ?? dateKeyIn(new Date(), String(property.timezone || 'UTC')))

/** A block replaces the room's own status while it holds the room. */
export const effectiveRoomStatus = (status: unknown, kind: unknown): string =>
  kind === 'ooo' ? 'out_of_order' : kind === 'oos' ? 'maintenance' : String(status)

/**
 * The block holding each room on `day`, by room: an active block that has begun. A block whose planned end
 * has passed still holds the room until somebody reopens it; one that starts later does not hold it yet.
 * The room board and the room plan both answer "is this room out today" with this one rule.
 */
export async function currentRoomBlocks(
  ctx: Ctx,
  property: Row,
  roomIds: unknown[],
  day: string,
): Promise<Map<unknown, Row>> {
  if (!roomIds.length) return new Map()
  const B = ctx.table('hospitality_core.RoomBlock')
  const rows = await ctx.db.all(
    from(B)
      .where(
        eq(B.companyId!, ctx.scope.company),
        eq(B.propertyId, property.id),
        eq(B.state, 'active'),
        lte(B.dateFrom, day),
        inArray(B.roomId, roomIds),
      )
      .limit(roomIds.length),
  )
  return new Map(rows.map((row) => [row.roomId, row]))
}
