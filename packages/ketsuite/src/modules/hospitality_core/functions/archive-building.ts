import { defineFn } from '@ketvietlab/ketjs'
import { result } from './catalogue-shared.ts'
import type { FnSpec } from '@ketvietlab/ketjs'
import { setStructureActive } from './structure-lifecycle.ts'

export const archiveBuildingHandler: FnSpec['handler'] = (ctx, args) =>
  setStructureActive(ctx, args, 'Building')

export const archiveBuildingFunction = defineFn({
  input: {
    requestKey: 'text',
    expectedVersion: 'int',
    expectedPropertyVersion: 'int',
    propertyId: 'id',
    id: 'id',
    active: 'bool',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Property',
    'write:hospitality_core.Property',
    'write:hospitality_core.OperationalChange',
    'read:hospitality_core.Building',
    'read:hospitality_core.Floor',
    'read:hospitality_core.Room',
    'write:hospitality_core.Building',
  ],
  idempotent: true,
  agent: true,
  handler: archiveBuildingHandler,
})
