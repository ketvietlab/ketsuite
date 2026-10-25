import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
type ContentSignal = {
  propertyId: unknown
  resourceType: string
  resourceId: unknown
  kind?: string
  createdAt?: string
}

/** Record a provider-neutral content mutation inside the caller's transaction. */
export const appendContentChange = async (ctx: Ctx, signal: ContentSignal): Promise<Row> => {
  const row = {
    id: randomUUID(),
    propertyId: String(signal.propertyId),
    resourceType: signal.resourceType,
    resourceId: String(signal.resourceId),
    kind: signal.kind ?? 'upsert',
    createdAt: signal.createdAt ?? new Date().toISOString(),
  }
  await ctx.db.insert('hospitality_core.ContentChange', row)
  return row
}
