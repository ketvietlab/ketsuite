import type { FnSpec } from '@ketvietlab/ketjs'
import { readRecord, reject } from './command.ts'

/** The operational wrapper owns scope, assignment authority, version and receipt. */
export const declineCleaningTaskHandler: FnSpec['handler'] = async (ctx, args) => {
  const task = await readRecord(ctx, 'hospitality_core.CleaningTask', args.id)
  if (!task) reject('id', 'cleaning_task_missing')
  if (!['todo', 'in_progress'].includes(String(task.state))) reject('state', 'cleaning_cannot_decline')
  const room = await readRecord(ctx, 'hospitality_core.Room', task.roomId)
  if (!room || room.propertyId !== task.propertyId) reject('roomId', 'room_missing')
  if (task.taskType !== 'daily_clean' || room.status !== 'occupied')
    reject('state', 'cleaning_cannot_decline')
  const reason = String(args.reason ?? '').trim()
  if (!reason || reason.length > 500) reject('reason', 'cleaning_decline_reason')
  const changed = await ctx.db.compareAndSet(
    'hospitality_core.CleaningTask',
    { id: task.id },
    { state: task.state },
    {
      state: 'declined',
      declinedAt: new Date().toISOString(),
      declinedBy: ctx.actor ?? null,
      declineReason: reason,
    },
  )
  if (!('matched' in changed) || !changed.matched) reject('state', 'transition_conflict')
  // Refusal records the guest's decision; it never marks a room clean or available.
  return { ok: true, id: task.id, state: 'declined' }
}
