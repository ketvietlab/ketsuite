import { asc, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { catalogueRecords } from '../records/config.ts'
import { hasPropertyScope, readRecord } from './command.ts'
export const catalogueRecordFunctions: Record<string, FnSpec> = Object.fromEntries(
  catalogueRecords
    .filter((definition) => !['service', 'notice', 'cleaningTask'].includes(definition.kind))
    .map((definition) => [
      definition.read,
      defineFn({
        input: { id: 'id' },
        output: { record: 'json?' },
        effects: [
          `read:hospitality_core.${definition.model}`,
          'read:hospitality_core.Property',
          ...(definition.kind === 'roomType'
            ? [
                'read:hospitality_core.Bed',
                'read:hospitality_core.RoomTypeAmenity',
                'read:hospitality_core.Amenity',
              ]
            : []),
        ],
        handler: async (ctx, args) => {
          const record = await readRecord(ctx, `hospitality_core.${definition.model}`, args.id)
          if (record?.propertyId) {
            const property = await readRecord(ctx, 'hospitality_core.Property', record.propertyId)
            if (!property || !hasPropertyScope(ctx, property)) return { record: null }
          }
          if (record && definition.kind === 'roomType') {
            const B = ctx.table('hospitality_core.Bed'),
              L = ctx.table('hospitality_core.RoomTypeAmenity'),
              A = ctx.table('hospitality_core.Amenity')
            const beds = await ctx.db.all(
              from(B).where(eq(B.roomTypeId, record.id)).orderBy(asc(B.id)).limit(2),
            )
            const links = await ctx.db.all(
              from(L).select(L.amenityId).where(eq(L.roomTypeId, record.id)).limit(101),
            )
            if (links.length > 100) throw new Error('Room type exceeds the supported 100 amenity assignments')
            record.bedType = beds.length === 1 ? beds[0]!.type : 'keep'
            record.bedQuantity = beds.length === 1 ? beds[0]!.quantity : null
            record.amenityIds = links.map((link) => String(link.amenityId))
            record.amenityOptions = links.length
              ? await ctx.db.all(
                  from(A)
                    .select(A.id, A.name, A.active)
                    .where(inArray(A.id, record.amenityIds as string[])),
                )
              : []
          }
          return {
            record: record
              ? Object.fromEntries(
                  [
                    ...new Set([
                      'id',
                      'version',
                      'active',
                      'state',
                      'status',
                      'propertyId',
                      'code',
                      'name',
                      ...(definition.kind === 'roomType' ? ['amenityOptions'] : []),
                      ...definition.fields.map((field) => field.name),
                    ]),
                  ].map((key) => [key, record[key] ?? null]),
                )
              : null,
          }
        },
      }),
    ]),
)
