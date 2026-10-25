import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { companyCivilDate } from '../../company/civil-date.ts'
import { reassignActivity } from '../activity-service.ts'
import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { actorId, cancelActivity, completeActivity, rescheduleActivity } from '../activity-service.ts'
import { activityReadEffects, myActivities, mutationEffects } from './shared.ts'

export async function listMyHandler(ctx: Ctx, args: Record<string, unknown>) {
  return {
    activities: await myActivities(
      ctx,
      String(args.today ?? (await companyCivilDate(ctx))),
      args.includeDone === true,
    ),
  }
}

export async function countDueHandler(ctx: Ctx, args: Record<string, unknown>) {
  const A = ctx.table('activity.Activity')
  const rows = await ctx.db.all(from(A).where(eq(A.assigneeUserId, actorId(ctx)), eq(A.active, true)))
  const currentDate = String(args.today ?? (await companyCivilDate(ctx)))
  const overdue = rows.filter((row) => String(row.dueDate) < currentDate).length
  const today = rows.filter((row) => row.dueDate === currentDate).length
  return { count: overdue + today, overdue, today }
}

export async function rescheduleHandler(ctx: Ctx, args: Record<string, unknown>) {
  return {
    activity: await ctx.tx((tx) =>
      rescheduleActivity(
        tx,
        String(args.id),
        String(args.dueDate),
        args.note ? String(args.note) : undefined,
      ),
    ),
  }
}

export async function cancelHandler(ctx: Ctx, args: Record<string, unknown>) {
  return {
    activity: await ctx.tx((tx) =>
      cancelActivity(tx, String(args.id), args.feedback ? String(args.feedback) : undefined),
    ),
  }
}

export async function completeHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) =>
    completeActivity(
      tx,
      String(args.id),
      String(args.feedback),
      String(args.completedDate ?? (await companyCivilDate(tx))),
    ),
  )
}

export const workFunctions: Record<string, FnSpec> = {
  searchMine: defineFn({
    input: { includeDone: 'bool?', page: 'int?', pageSize: 'int?' },
    output: {
      query: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      rows: 'json',
      counts: 'json',
      isEmpty: 'bool',
    },
    effects: activityReadEffects,
    handler: async function searchMineHandler(ctx: Ctx, args) {
      const date = await companyCivilDate(ctx)
      const all = await myActivities(ctx, date, true)
      const includeDone = args.includeDone === true
      const visible = includeDone ? all : all.filter((row) => row.active === true)
      const pageSize = Math.max(1, Math.min(100, Number(args.pageSize ?? 25)))
      const pages = Math.max(1, Math.ceil(visible.length / pageSize))
      const page = Math.max(1, Math.min(pages, Number(args.page ?? 1)))
      return {
        query: { includeDone, pageSize, page },
        total: visible.length,
        page,
        pages,
        rows: visible.slice((page - 1) * pageSize, page * pageSize),
        counts: { today: date },
        isEmpty: all.length === 0,
      }
    },
  }),
  'scope.company': defineFn({
    input: {},
    output: { ok: 'bool' },
    effects: [],
    handler: function companyActivityAuthority() {
      return { ok: true }
    },
  }),
  reassign: defineFn({
    input: { id: 'id', assigneeUserId: 'id' },
    output: { activity: 'json' },
    effects: [...AUTHORIZATION_READ_EFFECTS, 'read:activity.Activity', 'write:activity.Activity'],
    idempotent: true,
    handler: async function reassignHandler(ctx: Ctx, args) {
      return {
        activity: await ctx.tx((tx) => reassignActivity(tx, String(args.id), String(args.assigneeUserId))),
      }
    },
  }),
  listMy: defineFn({
    input: { today: 'date?', includeDone: 'bool?' },
    output: { activities: 'json' },
    effects: activityReadEffects,
    handler: listMyHandler,
  }),
  countDue: defineFn({
    input: { today: 'date?' },
    output: { count: 'int', overdue: 'int', today: 'int' },
    effects: ['read:activity.Activity', 'read:company.Company'],
    handler: countDueHandler,
  }),
  reschedule: defineFn({
    input: { id: 'id', dueDate: 'date', note: 'text?' },
    output: { activity: 'json' },
    effects: [...AUTHORIZATION_READ_EFFECTS, 'read:activity.Activity', 'write:activity.Activity'],
    idempotent: true,
    handler: rescheduleHandler,
  }),
  cancel: defineFn({
    input: { id: 'id', feedback: 'text?' },
    output: { activity: 'json' },
    effects: [...AUTHORIZATION_READ_EFFECTS, 'read:activity.Activity', 'write:activity.Activity'],
    idempotent: true,
    handler: cancelHandler,
  }),
  complete: defineFn({
    input: { id: 'id', feedback: 'text', completedDate: 'date?' },
    output: { activity: 'json', messageId: 'id', nextActivity: 'json?' },
    effects: mutationEffects,
    idempotent: true,
    handler: completeHandler,
  }),
}
