import { asc, defineFn, eq, from, ilike, likeLiteral, or, inArray } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { hasPropertyScope, readRecord } from './command.ts'
const definitions = [
  ['lookupPolicies', 'CancellationPolicy'],
  ['lookupRoomAmenities', 'Amenity'],
  ['lookupProperties', 'Property'],
  ['lookupRoomTypes', 'RoomType'],
  ['lookupBuildings', 'Building'],
  ['lookupFloors', 'Floor'],
  ['lookupRooms', 'Room'],
  ['lookupAmenityCategories', 'AmenityCategory'],
] as const
export const catalogueLookupFunctions: Record<string, FnSpec> = Object.fromEntries(
  definitions.map(([name, model]) => [
    name,
    defineFn({
      input: { search: 'text?', limit: 'int?', propertyId: 'id?', buildingId: 'id?', id: 'id?' },
      effects: [`read:hospitality_core.${model}`, 'read:hospitality_core.Property'],
      handler: async (ctx, args) => {
        const T = ctx.table(`hospitality_core.${model}`)
        let query = from(T)
        if (T.$columns.includes('companyId') && ctx.scope.company)
          query = query.where(eq(T.companyId!, ctx.scope.company))
        if (model !== 'AmenityCategory') query = query.where(eq(T.active!, true))
        if (model === 'Property' && ctx.scope.branches)
          query = query.where(inArray(T.branchId!, ctx.scope.branches))
        if (
          model !== 'Property' &&
          model !== 'AmenityCategory' &&
          model !== 'CancellationPolicy' &&
          model !== 'Amenity'
        ) {
          if (!args.propertyId) return []
          const property = await readRecord(ctx, 'hospitality_core.Property', args.propertyId)
          if (!property || !hasPropertyScope(ctx, property)) return []
          query = query.where(eq(T.propertyId!, args.propertyId))
        }
        if (model === 'Amenity') query = query.where(eq(T.scope!, 'room'))
        if (model === 'Floor' && args.buildingId) query = query.where(eq(T.buildingId!, args.buildingId))
        if (args.id) query = query.where(eq(T.id, args.id))
        if (args.search) {
          const pattern = `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`
          query = query.where(
            or(
              ...['code', 'name']
                .filter((field) => T.$columns.includes(field))
                .map((field) => ilike(T[field]!, pattern, true)),
            ),
          )
        }
        const limit = Math.min(100, Math.max(1, Math.trunc(Number(args.limit) || 20)))
        return (await ctx.db.all(query.orderBy(asc(T.name!), asc(T.id)).limit(limit))).map((row) =>
          Object.fromEntries(
            ['id', 'name', 'code', 'propertyId', 'buildingId', 'timezone']
              .filter((key) => key in row)
              .map((key) => [key, row[key]]),
          ),
        )
      },
    }),
  ]),
)

catalogueLookupFunctions.lookupCleaningStaff = defineFn({
  input: { search: 'text?', limit: 'int?', propertyId: 'id?', id: 'id?' },
  effects: [
    'read:hospitality_core.Property',
    'read:user.User',
    'read:user.Membership',
    'read:user.BranchMembership',
  ],
  handler: async (ctx, args) => {
    if (!args.propertyId || !ctx.manifest.models['user.User']) return []
    const property = await readRecord(ctx, 'hospitality_core.Property', args.propertyId)
    if (!property || !hasPropertyScope(ctx, property)) return []
    const M = ctx.table('user.Membership'),
      B = ctx.table('user.BranchMembership'),
      U = ctx.table('user.User')
    const members = await ctx.db.all(from(M).select(M.userId).where(eq(M.companyId, ctx.scope.company)))
    const branch = property.branchId
      ? await ctx.db.all(from(B).select(B.userId).where(eq(B.branchId, property.branchId)))
      : null
    const ids = members
      .map((row) => row.userId)
      .filter((id) => !branch || branch.some((row) => row.userId === id))
    let query = from(U)
      .select(U.id, U.name)
      .where(inArray(U.id, ids), eq(U.active, true), eq(U.accessKind, 'internal'))
    if (args.id) query = query.where(eq(U.id, args.id))
    if (args.search)
      query = query.where(ilike(U.name, `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`, true))
    return ctx.db.all(
      query.orderBy(asc(U.name), asc(U.id)).limit(Math.min(100, Math.max(1, Number(args.limit) || 20))),
    )
  },
})
