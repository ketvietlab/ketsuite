import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { asc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { actorId, stateOf } from '../activity-service.ts'

export const typeShape = {
  id: 'id',
  name: 'text',
  category: 'text',
  icon: 'text?',
  defaultDelayDays: 'int',
  chainingPolicy: 'text',
  nextTypeId: 'id?',
  sequence: 'int',
  active: 'bool',
}

export const activityReadEffects = [
  'read:company.Company',
  ...AUTHORIZATION_READ_EFFECTS,
  'read:activity.Activity',
  'read:activity.Type',
  'read:mail.Thread',
  'read:user.User',
]

export const mutationEffects = [
  ...activityReadEffects,
  'write:activity.Activity',
  'read:activity.Attachment',
  'read:storage.Attachment',
  'read:mail.Message',
  'read:mail.Follower',
  'read:mail.FollowerSubtype',
  'write:mail.Message',
  'write:mail.MessageAttachment',
  'write:mail.Notification',
]

export const myActivities = async (ctx: Ctx, today: string, includeDone: boolean): Promise<Row[]> => {
  const A = ctx.table('activity.Activity')
  const T = ctx.table('activity.Type')
  const H = ctx.table('mail.Thread')
  const rows = await ctx.db.all(
    from(A)
      .where(eq(A.assigneeUserId, actorId(ctx)))
      .orderBy(asc(A.dueDate), asc(A.createdAt)),
  )
  const visible = includeDone ? rows : rows.filter((row) => row.active === true)
  const types = visible.length
    ? await ctx.db.all(from(T).where(inArray(T.id, [...new Set(visible.map((row) => row.typeId))])))
    : []
  const threads = visible.length
    ? await ctx.db.all(from(H).where(inArray(H.id, [...new Set(visible.map((row) => row.threadId))])))
    : []
  const typeById = new Map(types.map((row) => [String(row.id), row]))
  const threadById = new Map(threads.map((row) => [String(row.id), row]))
  return visible.map((row) => ({
    ...row,
    state: stateOf(row, today),
    typeName: typeById.get(String(row.typeId))?.name ?? row.typeId,
    category: typeById.get(String(row.typeId))?.category ?? 'todo',
    targetName: threadById.get(String(row.threadId))?.displayName ?? row.threadId,
    resModel: threadById.get(String(row.threadId))?.resModel ?? null,
    resId: threadById.get(String(row.threadId))?.resId ?? null,
  }))
}
