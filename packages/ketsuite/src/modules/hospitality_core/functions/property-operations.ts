import { defineFn, eq, from, inArray, isNotNull } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { claimVersion, propertyAccess, recordChange, reject, runCommand } from './command.ts'

export async function propertyReadiness(ctx: Ctx, propertyId: unknown) {
  const count = (model: string, states?: string[]) => {
    const T = ctx.table(`hospitality_core.${model}`)
    let query = from(T).where(eq(T.propertyId, propertyId))
    query = states ? query.where(inArray(T.state, states)) : query.where(eq(T.active, true))
    return ctx.db.count(query)
  }
  const [types, rooms, rates, staying, upcoming] = await Promise.all([
    count('RoomType'),
    count('Room'),
    count('RatePlan'),
    count('Stay', ['checked_in']),
    count('Reservation', ['draft', 'confirmed']),
  ])
  return { types, rooms, rates, staying, upcoming }
}
export const setPropertyLifecycleHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'setPropertyLifecycle', async (tx) => {
    const property = await propertyAccess(tx, args.propertyId)
    if (!['active', 'stopped', 'setup'].includes(String(args.lifecycle)))
      reject('lifecycle', 'property_lifecycle')
    if (args.lifecycle === 'setup' && property.lifecycle !== 'stopped')
      reject('lifecycle', 'property_lifecycle')
    const readiness = await propertyReadiness(tx, property.id)
    if (args.lifecycle === 'active' && (!readiness.types || !readiness.rooms || !readiness.rates))
      reject('lifecycle', 'property_open_blocked')
    if (args.lifecycle === 'stopped' && (readiness.staying || readiness.upcoming))
      reject('lifecycle', 'property_stop_blocked')
    await claimVersion(tx, 'hospitality_core.Property', property, args.expectedVersion)
    await tx.db.update(
      'hospitality_core.Property',
      { id: property.id },
      { lifecycle: args.lifecycle, active: args.lifecycle !== 'stopped' },
    )
    await recordChange(tx, property.id, property.id, 'property-lifecycle', { lifecycle: args.lifecycle })
    return { ok: true, id: property.id, readiness, errors: [] }
  })
export const setInspectionRequirementHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'setInspectionRequirement', async (tx) => {
    const property = await propertyAccess(tx, args.propertyId)
    await claimVersion(tx, 'hospitality_core.Property', property, args.expectedVersion)
    await tx.db.update(
      'hospitality_core.Property',
      { id: property.id },
      { inspectionRequired: args.required },
    )
    if (args.required === false || args.required === true) {
      const R = tx.table('hospitality_core.Room')
      let query = from(R).where(
        eq(R.propertyId, property.id),
        eq(R.status, args.required ? 'available' : 'inspection'),
      )
      if (args.required) query = query.where(isNotNull(R.lastCleanedAt!))
      const waiting = await tx.db.all(query)
      for (const target of waiting) {
        await claimVersion(tx, 'hospitality_core.Room', target, target.version ?? 0)
        await tx.db.update(
          'hospitality_core.Room',
          { id: target.id },
          { status: args.required ? 'inspection' : 'available' },
        )
      }
    }
    await recordChange(tx, property.id, property.id, 'inspection-setting', { required: args.required })
    return { ok: true, id: property.id, errors: [] }
  })
const reads = [
  'read:hospitality_core.Property',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.Room',
  'read:hospitality_core.RatePlan',
  'read:hospitality_core.Reservation',
  'read:hospitality_core.Stay',
]
const writes = [
  'write:hospitality_core.Property',
  'write:hospitality_core.Room',
  'write:hospitality_core.OperationalChange',
  'read:hospitality_core.CommandReceipt',
  'write:hospitality_core.CommandReceipt',
]
export const propertyOperationFunctions: Record<string, FnSpec> = {
  propertyReadiness: defineFn({
    input: { propertyId: 'id' },
    output: { types: 'int', rooms: 'int', rates: 'int', staying: 'int', upcoming: 'int' },
    effects: reads,
    handler: async (ctx, args) => {
      await propertyAccess(ctx, args.propertyId)
      return propertyReadiness(ctx, args.propertyId)
    },
  }),
  setPropertyLifecycle: defineFn({
    input: { propertyId: 'id', lifecycle: 'text', expectedVersion: 'int', requestKey: 'text' },
    output: { ok: 'bool', id: 'id?', readiness: 'json?', errors: 'json?' },
    effects: [...reads, ...writes],
    idempotent: true,
    handler: setPropertyLifecycleHandler,
  }),
  setInspectionRequirement: defineFn({
    input: { propertyId: 'id', required: 'bool', expectedVersion: 'int', requestKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...reads, ...writes],
    idempotent: true,
    handler: setInspectionRequirementHandler,
  }),
}
