import { defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import { housekeeping } from '../housekeeping.ts'
import { propertyAccess, readRecord, reject } from './command.ts'
import { validateCleaningAssignee } from './operational-commands.ts'
import { zonedDateTime } from '../calendar.ts'
import { CLEANING_TASK_PRIORITIES, CLEANING_TASK_TYPES } from '../types.ts'
export const cleaningTaskFunctions = {
  saveCleaningTask: defineFn({
    input: {
      id: 'id',
      propertyId: 'id',
      roomId: 'id',
      code: 'text?',
      taskType: 'text',
      priority: 'text?',
      assigneeId: 'id?',
      dueAt: 'datetime?',
      dueLocal: 'text?',
      notes: 'text?',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.CleaningTask',
      'write:hospitality_core.CleaningTask',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomBlock',
      'write:hospitality_core.Room',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const property = await propertyAccess(ctx, args.propertyId)
      if (!CLEANING_TASK_TYPES.includes(args.taskType as (typeof CLEANING_TASK_TYPES)[number]))
        reject('taskType', 'cleaning_type')
      if (
        args.priority &&
        !CLEANING_TASK_PRIORITIES.includes(args.priority as (typeof CLEANING_TASK_PRIORITIES)[number])
      )
        reject('priority', 'cleaning_priority')
      if (args.dueLocal) {
        const local = String(args.dueLocal)
        if (
          !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(local) ||
          !Number.isFinite(Date.parse(`${local.slice(0, 10)}T00:00:00Z`)) ||
          new Date(`${local.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== local.slice(0, 10)
        )
          reject('dueAt', 'date')
        args = {
          ...args,
          dueAt: zonedDateTime(
            local.slice(0, 10),
            Number(local.slice(11, 13)),
            Number(local.slice(14, 16)),
            String(property.timezone),
          ).toISOString(),
        }
      }
      if (!args.dueAt) reject('dueAt', 'required')
      await validateCleaningAssignee(ctx, args.assigneeId, property)
      if (new Date(String(args.dueAt)).getTime() <= Date.now()) reject('dueAt', 'cleaning_due_future')
      const room = await readRecord(ctx, 'hospitality_core.Room', args.roomId)
      if (!room || room.active !== true || room.propertyId !== property.id) reject('roomId', 'room_missing')
      if (String(args.notes ?? '').length > 2000) reject('notes', 'cleaning_note_length')
      const B = ctx.table('hospitality_core.RoomBlock')
      const out =
        ['maintenance', 'out_of_order'].includes(String(room.status)) ||
        (await ctx.db.count(from(B).where(eq(B.roomId, room.id), eq(B.state, 'active')))) > 0
      const allowed = out
        ? ['maintenance']
        : room.status === 'occupied'
          ? ['daily_clean', 'inspection']
          : ['checkout_clean', 'inspection']
      if (!allowed.includes(String(args.taskType))) reject('taskType', 'cleaning_room_status')
      const existing = await readRecord(ctx, 'hospitality_core.CleaningTask', args.id)
      if (existing) {
        if (!['todo', 'in_progress'].includes(String(existing.state)))
          reject('state', 'cleaning_cannot_start')
        if (existing.propertyId !== property.id || existing.roomId !== room.id)
          reject('roomId', 'property_mismatch')
        if (args.code && args.code !== existing.code) reject('code', 'immutable_code')
        if (existing.state === 'in_progress' && args.taskType !== existing.taskType)
          reject('taskType', 'cleaning_type')
        if (args.taskType !== existing.taskType) {
          const T = ctx.table('hospitality_core.CleaningTask')
          const matching = await ctx.db.all(
            from(T)
              .select(T.id)
              .where(
                eq(T.roomId, room.id),
                eq(T.taskType, args.taskType),
                inArray(T.state, ['todo', 'in_progress']),
              )
              .limit(2),
          )
          if (matching.some((task) => task.id !== existing.id)) reject('taskType', 'cleaning_task_duplicate')
        }
        await ctx.db.update(
          'hospitality_core.CleaningTask',
          { id: existing.id },
          {
            assigneeId: args.assigneeId ?? null,
            taskType: args.taskType,
            dueAt: args.dueAt,
            priority: args.priority ?? existing.priority,
            notes: args.notes ?? existing.notes,
          },
        )
        return { ok: true, id: existing.id, state: existing.state, errors: [] }
      }
      const T = ctx.table('hospitality_core.CleaningTask')
      if (
        await ctx.db.count(
          from(T).where(
            eq(T.roomId, room.id),
            eq(T.taskType, args.taskType),
            inArray(T.state, ['todo', 'in_progress']),
          ),
        )
      )
        reject('roomId', 'cleaning_task_duplicate')
      return housekeeping.createCleaningTask!.handler(ctx, {
        ...args,
        code: args.code || `HK-${String(args.id).toUpperCase()}`,
      })
    },
  }),
}
