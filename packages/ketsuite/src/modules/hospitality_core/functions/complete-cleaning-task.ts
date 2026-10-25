import { eq, from } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { readRecord, reject } from './command.ts'

import { CLEANING_CHECKS } from '../cleaning-checklist.ts'

/** Called inside the operational command receipt transaction. */
export const completeCleaningTaskHandler: FnSpec['handler'] = async (ctx, args) => {
  const task = await readRecord(ctx, 'hospitality_core.CleaningTask', args.id)
  if (!task) reject('id', 'cleaning_task_missing')
  if (task.state === 'done') return { ok: true, id: task.id, state: task.state }
  if (task.state !== 'in_progress') reject('state', 'cleaning_cannot_complete')
  if (
    !Array.isArray(args.checklist) ||
    args.checklist.length !== CLEANING_CHECKS.length ||
    !CLEANING_CHECKS.every((key) => (args.checklist as unknown[]).includes(key))
  )
    reject('checklist', 'cleaning_checklist_required')
  const notes = String(args.completionNotes ?? '').trim()
  if (notes.length > 2000) reject('completionNotes', 'cleaning_note_length')
  const room = await readRecord(ctx, 'hospitality_core.Room', task.roomId)
  if (!room || room.propertyId !== task.propertyId) reject('roomId', 'room_missing')
  const at = args.at ?? new Date().toISOString()
  const claim = await ctx.db.compareAndSet(
    'hospitality_core.CleaningTask',
    { id: task.id },
    { state: 'in_progress' },
    {
      state: 'done',
      doneAt: at,
      checklist: [...CLEANING_CHECKS],
      completionNotes: notes || null,
      completedBy: ctx.actor ?? null,
    },
  )
  if (!('matched' in claim) || !claim.matched) reject('state', 'transition_conflict')
  if (room.status === 'cleaning') {
    const T = ctx.table('hospitality_core.CleaningTask')
    const active = await ctx.db.count(
      from(T).where(
        eq(T.companyId!, ctx.scope.company),
        eq(T.propertyId, task.propertyId),
        eq(T.roomId, room.id),
        eq(T.state, 'in_progress'),
      ),
    )
    if (!active) {
      const property = await readRecord(ctx, 'hospitality_core.Property', room.propertyId)
      const B = ctx.table('hospitality_core.RoomBlock')
      const blocked = await ctx.db.count(
        from(B).where(
          eq(B.companyId!, ctx.scope.company),
          eq(B.propertyId, task.propertyId),
          eq(B.roomId, room.id),
          eq(B.state, 'active'),
        ),
      )
      const update = await ctx.db.compareAndSet(
        'hospitality_core.Room',
        { id: room.id },
        { status: room.status, version: room.version ?? null },
        {
          status: blocked ? 'dirty' : property?.inspectionRequired === true ? 'inspection' : 'available',
          lastCleanedAt: at,
          version: Number(room.version ?? 0) + 1,
        },
      )
      if (!('matched' in update) || !update.matched) reject('roomId', 'transition_conflict')
    }
  }
  return { ok: true, id: task.id, state: 'done' }
}
