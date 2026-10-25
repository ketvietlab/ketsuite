import { defineFn } from '@ketvietlab/ketjs'
import { result } from './catalogue-shared.ts'
import { catalogueCommand } from './catalogue-shared.ts'
import { asc, eq, from, gt } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { claimVersion } from './command.ts'
import {
  catalogueTransaction,
  type Issue,
  issue,
  failure,
  cleanCode,
  cleanText,
  normalized,
  record,
  lockActiveFlag,
  duplicate,
  save,
  writable,
} from './catalogue-shared.ts'

export const saveFloorHandler: FnSpec['handler'] = (ctx: Ctx, raw) =>
  catalogueTransaction(ctx, async (tx) => {
    const current = await record(tx, 'hospitality_core.Floor', raw.id)
    const args = normalized(raw, {
      code: cleanCode(raw.code),
      name: cleanText(raw.name),
      sequence: Number(raw.sequence ?? current?.sequence ?? 10),
      level:
        raw.level === undefined ? (current?.level ?? null) : raw.level === null ? null : Number(raw.level),
    })
    const building = await record(tx, 'hospitality_core.Building', args.buildingId)
    const errors: Issue[] = []
    if (current && raw.active !== undefined && raw.active !== current.active)
      errors.push(issue('active', 'location_lifecycle_command'))
    if (!building) errors.push(issue('buildingId', 'building_missing'))
    else if (building.propertyId !== args.propertyId) errors.push(issue('buildingId', 'property_mismatch'))
    else if ((!current || current.buildingId !== building.id) && building.active !== true)
      errors.push(issue('buildingId', 'location_archived'))
    if (current && current.propertyId !== args.propertyId)
      errors.push(issue('propertyId', 'property_mismatch'))
    if (!args.code) errors.push(issue('code', 'required'))
    if (!args.name) errors.push(issue('name', 'required'))
    if (!Number.isInteger(args.sequence) || args.sequence < 1 || args.sequence > 999)
      errors.push(issue('sequence', 'structure_sequence'))
    if (
      args.level !== null &&
      (!Number.isInteger(args.level) || Number(args.level) < -5 || Number(args.level) > 200)
    )
      errors.push(issue('level', 'floor_level'))
    if (
      await duplicate(tx, 'hospitality_core.Floor', 'code', args.code, args.id, [
        'buildingId',
        args.buildingId,
      ])
    )
      errors.push(issue('code', 'unique'))
    if (errors.length) return failure(...errors)
    if (!(await lockActiveFlag(tx, 'hospitality_core.Building', building!)))
      return failure(issue('buildingId', 'transition_conflict'))
    const result = await save(tx, 'hospitality_core.Floor', args, writable('Floor'), { active: true })
    if (result.ok && current && current.buildingId !== args.buildingId) {
      const R = tx.table('hospitality_core.Room')
      let after: string | null = null
      while (true) {
        let query = from(R)
          .select(R.id, R.version!)
          .where(
            eq(R.companyId!, tx.scope.company),
            eq(R.propertyId, args.propertyId),
            eq(R.floorId!, current.id),
          )
        if (after) query = query.where(gt(R.id, after))
        const rooms = await tx.db.all(query.orderBy(asc(R.id)).limit(100))
        for (const room of rooms) {
          await claimVersion(tx, 'hospitality_core.Room', room, room.version ?? 0)
          await tx.db.update(
            'hospitality_core.Room',
            { id: room.id, companyId: tx.scope.company },
            { buildingId: args.buildingId },
          )
        }
        if (rooms.length < 100) break
        after = String(rooms.at(-1)!.id)
      }
    }
    return result
  })

export const saveFloorFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    propertyId: 'id',
    buildingId: 'id',
    code: 'text',
    name: 'text',
    sequence: 'int?',
    level: 'int?',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Room',
    'write:hospitality_core.Room',
    'read:hospitality_core.Building',
    'read:hospitality_core.Floor',
    'write:hospitality_core.Building',
    'write:hospitality_core.Floor',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveFloor', saveFloorHandler),
})
