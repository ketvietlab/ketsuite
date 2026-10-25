import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

const models: Record<string, string> = {
  saveBuilding: 'Building',
  saveFloor: 'Floor',
  saveRoom: 'Room',
  archiveRoom: 'Room',
  saveRoomType: 'RoomType',
  archiveRoomType: 'RoomType',
  saveRatePlan: 'RatePlan',
  savePropertyContact: 'PropertyContact',
  archivePropertyContact: 'PropertyContact',
  savePropertyCharge: 'PropertyCharge',
}

/** Catalogue changes serialize against opening/stopping and the property editor, in the same receipt transaction. */
export function guardCatalogueParents(functions: Record<string, FnSpec>): Record<string, FnSpec> {
  return Object.fromEntries(
    Object.entries(functions).map(([name, spec]) => {
      const model = models[name]
      if (!model) return [name, spec]
      return [
        name,
        {
          ...spec,
          input: {
            ...spec.input,
            expectedVersion: spec.input?.expectedVersion ?? 'int?',
            propertyId: spec.input?.propertyId ?? 'id?',
            expectedPropertyVersion: 'int?',
            requestKey: spec.input?.requestKey ?? 'text?',
          },
          effects: [
            ...new Set([
              ...(spec.effects ?? []),
              `read:hospitality_core.${model}`,
              `write:hospitality_core.${model}`,
              'read:hospitality_core.Property',
              'write:hospitality_core.Property',
              ...(model === 'Room' ? ['read:hospitality_core.RoomAssignment'] : []),
              'read:hospitality_core.CommandReceipt',
              'write:hospitality_core.CommandReceipt',
              'write:hospitality_core.OperationalChange',
            ]),
          ],
          handler: (ctx, args) =>
            runCommand(ctx, args, `${name}:property`, async (tx) => {
              const row = await readRecord(tx, `hospitality_core.${model}`, args.id)
              if (row && args.propertyId && row.propertyId !== args.propertyId)
                reject('propertyId', 'property_mismatch')
              const property = await propertyAccess(tx, row?.propertyId ?? args.propertyId)
              await claimVersion(tx, 'hospitality_core.Property', property, args.expectedPropertyVersion)
              if (name.startsWith('archive') && name !== 'archiveRoom' && row)
                await claimVersion(tx, `hospitality_core.${model}`, row, args.expectedVersion)
              const nested: Ctx = { ...tx, tx: async (run) => run(nested) }
              const value = (await spec.handler(nested, args)) as Record<string, unknown>
              if (value.ok !== false)
                await recordChange(tx, property.id, row?.id ?? value.id ?? args.id, name, {
                  model,
                  active: args.active ?? null,
                })
              return { ...value, ok: value.ok === undefined ? true : value.ok === true }
            }),
        } satisfies FnSpec,
      ]
    }),
  )
}
