import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

/** The property claim serializes structure changes with room placement and catalogue edits. */
export const setStructureActive = (ctx: Ctx, args: Record<string, unknown>, kind: 'Building' | 'Floor') =>
  runCommand(ctx, args, `archive${kind}`, async (tx) => {
    if (!String(args.requestKey ?? '').trim()) reject('requestKey', 'request_key')
    if (!Number.isInteger(args.expectedVersion) || !Number.isInteger(args.expectedPropertyVersion))
      reject('expectedVersion', 'transition_conflict')
    const row = await readRecord(tx, `hospitality_core.${kind}`, args.id)
    if (!row) reject('id', kind === 'Building' ? 'building_missing' : 'floor_missing')
    if (row.propertyId !== args.propertyId) reject('propertyId', 'property_mismatch')
    const property = await propertyAccess(tx, row.propertyId)
    await claimVersion(tx, 'hospitality_core.Property', property, args.expectedPropertyVersion)
    const version = await claimVersion(tx, `hospitality_core.${kind}`, row, args.expectedVersion)
    if (args.active && property.active !== true) reject('propertyId', 'property_archived')
    if (kind === 'Floor') {
      const building = await readRecord(tx, 'hospitality_core.Building', row.buildingId)
      if (!building || building.propertyId !== property.id) reject('buildingId', 'building_missing')
      if (args.active && building.active !== true) reject('buildingId', 'location_archived')
    }
    if (!args.active) {
      if (kind === 'Building') {
        const F = tx.table('hospitality_core.Floor')
        if (
          await tx.db.count(
            from(F).where(
              eq(F.companyId!, ctx.scope.company),
              eq(F.propertyId, property.id),
              eq(F.buildingId, row.id),
              eq(F.active, true),
            ),
          )
        )
          reject('id', 'location_has_active_floors')
      }
      const R = tx.table('hospitality_core.Room')
      const location = kind === 'Building' ? R.buildingId! : R.floorId!
      if (
        await tx.db.count(
          from(R).where(
            eq(R.companyId!, ctx.scope.company),
            eq(R.propertyId, property.id),
            eq(location, row.id),
            eq(R.active, true),
          ),
        )
      )
        reject('id', 'location_has_active_rooms')
    }
    await tx.db.update(
      `hospitality_core.${kind}`,
      { id: row.id, companyId: ctx.scope.company },
      { active: args.active },
    )
    await recordChange(tx, property.id, row.id, `archive${kind}`, { active: args.active })
    return { ok: true, id: row.id, version }
  })
