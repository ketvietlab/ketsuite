import { asc, defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { validatePlanStep } from '../activity-service.ts'

export async function listPlansHandler(ctx: Ctx) {
  const P = ctx.table('activity.Plan')
  const S = ctx.table('activity.PlanStep')
  const plans = await ctx.db.all(from(P).where(eq(P.active, true)).orderBy(asc(P.name)))
  const steps = plans.length
    ? await ctx.db.all(
        from(S)
          .where(
            inArray(
              S.planId,
              plans.map((row) => row.id),
            ),
          )
          .orderBy(asc(S.sequence), asc(S.id)),
      )
    : []
  return {
    plans: plans.map((plan) => ({
      ...plan,
      steps: steps.filter((step) => step.planId === plan.id),
    })),
  }
}

export function savePlanHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    const name = String(args.name).trim()
    if (!name) throw new Error('activity plan name cannot be empty')
    if (!Array.isArray(args.steps)) throw new Error('activity plan steps must be an array')
    const steps = args.steps.map((value, index) => {
      if (!value || typeof value !== 'object') throw new Error(`plan step ${index + 1} must be an object`)
      const step = value as Record<string, unknown>
      const row = {
        id: String(step.id ?? `${String(args.id)}:step:${index + 1}`),
        planId: String(args.id),
        typeId: String(step.typeId ?? ''),
        offsetDays: Number(step.offsetDays ?? 0),
        assigneeStrategy: String(step.assigneeStrategy ?? 'actor'),
        assigneeUserId: step.assigneeUserId ? String(step.assigneeUserId) : null,
        summary: step.summary ? String(step.summary) : null,
        note: step.note ? String(step.note) : null,
        sequence: Number(step.sequence ?? index + 1),
      }
      validatePlanStep(row)
      return row
    })
    if (new Set(steps.map((step) => step.id)).size !== steps.length)
      throw new Error('activity plan step ids must be unique')
    const typeIds = [...new Set(steps.map((step) => step.typeId))]
    const T = tx.table('activity.Type')
    const foundTypes = typeIds.length
      ? await tx.db.all(from(T).where(inArray(T.id, typeIds), eq(T.active, true)))
      : []
    if (foundTypes.length !== typeIds.length) throw new Error('one or more plan activity types are missing')
    const userIds = [...new Set(steps.flatMap((step) => (step.assigneeUserId ? [step.assigneeUserId] : [])))]
    const U = tx.table('user.User')
    const foundUsers = userIds.length
      ? await tx.db.all(from(U).where(inArray(U.id, userIds), eq(U.active, true)))
      : []
    if (foundUsers.length !== userIds.length) throw new Error('one or more plan assignees are missing')
    const P = tx.table('activity.Plan')
    const existing = await tx.db.one(from(P).where(eq(P.id, args.id)))
    const plan = {
      id: args.id,
      name,
      ...(args.description ? { description: String(args.description) } : {}),
      active: args.active,
    }
    if (existing) await tx.db.update('activity.Plan', { id: args.id }, plan)
    else await tx.db.insert('activity.Plan', plan)
    const S = tx.table('activity.PlanStep')
    await tx.db.del(deleteFrom(S).where(eq(S.planId, args.id)))
    for (const step of steps)
      await tx.db.insert('activity.PlanStep', {
        ...step,
        ...(step.assigneeUserId ? { assigneeUserId: step.assigneeUserId } : {}),
        ...(step.summary ? { summary: step.summary } : {}),
        ...(step.note ? { note: step.note } : {}),
      })
    return { ok: true, id: args.id }
  })
}

export const plansFunctions: Record<string, FnSpec> = {
  listPlans: defineFn({
    output: { plans: 'json' },
    effects: ['read:activity.Plan', 'read:activity.PlanStep'],
    handler: listPlansHandler,
  }),
  savePlan: defineFn({
    input: { id: 'id', name: 'text', description: 'text?', active: 'bool', steps: 'json' },
    output: { ok: 'bool', id: 'id' },
    effects: [
      'read:activity.Plan',
      'write:activity.Plan',
      'read:activity.PlanStep',
      'write:activity.PlanStep',
      'read:activity.Type',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: savePlanHandler,
  }),
}
