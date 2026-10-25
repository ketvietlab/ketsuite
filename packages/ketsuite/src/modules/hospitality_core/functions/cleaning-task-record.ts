import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { auditActorNames } from './audit-actors.ts'
import { hasPropertyScope, readRecord } from './command.ts'

export const getCleaningTaskRecordHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return { record: null }
  const task = await readRecord(ctx, 'hospitality_core.CleaningTask', args.id)
  const property = task ? await readRecord(ctx, 'hospitality_core.Property', task.propertyId) : null
  if (!task || !property || !hasPropertyScope(ctx, property)) return { record: null }
  const room = await readRecord(ctx, 'hospitality_core.Room', task.roomId)
  if (!room || room.propertyId !== property.id) return { record: null }
  const names = await auditActorNames(ctx, [
    { actorId: task.assigneeId },
    { actorId: task.completedBy },
    { actorId: task.declinedBy },
  ])
  const fields = [
    'id',
    'version',
    'code',
    'propertyId',
    'roomId',
    'taskType',
    'priority',
    'state',
    'assigneeId',
    'dueAt',
    'notes',
    'requestedAt',
    'startedAt',
    'doneAt',
    'checklist',
    'completionNotes',
    'declinedAt',
    'declineReason',
  ]
  return {
    record: {
      ...Object.fromEntries(fields.map((key) => [key, task[key] ?? null])),
      property: { id: property.id, name: property.name, timezone: property.timezone },
      room: { id: room.id, name: room.name, code: room.code, status: room.status },
      assigneeName: names.get(task.assigneeId) ?? null,
      declinedByName: names.get(task.declinedBy) ?? null,
      completedByName: names.get(task.completedBy) ?? null,
    },
  }
}
export const cleaningTaskRecordFunctions = {
  getCleaningTaskRecord: defineFn({
    input: { id: 'id' },
    output: { record: 'json?' },
    effects: [
      'read:hospitality_core.CleaningTask',
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:user.User',
    ],
    handler: getCleaningTaskRecordHandler,
  }),
}
