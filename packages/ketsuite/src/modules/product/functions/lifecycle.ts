import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { changeTemplateState, lifecycleEffects } from '../lifecycle.ts'

export async function archiveTemplateHandler(ctx: Ctx, args: Row) {
  return ctx.tx((tx) => changeTemplateState(tx, args))
}

export const lifecycleFunctions: Record<string, FnSpec> = {
  archiveTemplate: defineFn({
    input: {
      locale: 'text?',
      id: 'id?',
      ids: 'json?',
      active: 'bool',
      reason: 'text?',
      expectedRevisionId: 'text?',
      expectedRevisions: 'json?',
      confirmed: 'bool?',
    },
    output: { ok: 'bool?', id: 'id?', active: 'bool?', changed: 'int?', errors: 'json?' },
    effects: lifecycleEffects,
    idempotent: true,
    agent: true,
    handler: archiveTemplateHandler,
  }),
}
