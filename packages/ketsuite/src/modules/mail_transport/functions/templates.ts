import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { writeTemplate } from '../delivery-service.ts'
import type { TemplateInput } from '../delivery-service.ts'
import { actor, saveEffects } from './shared.ts'

export function saveTemplateHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    actor(tx)
    return writeTemplate(tx, args as TemplateInput)
  })
}

export const templatesFunctions: Record<string, FnSpec> = {
  saveTemplate: defineFn({
    input: {
      id: 'id',
      name: 'text',
      fromAddress: 'text',
      fromName: 'text?',
      replyTo: 'text?',
      publicOrigin: 'text?',
      subjectTemplate: 'text',
      textTemplate: 'text',
      htmlTemplate: 'text?',
      allowedKeys: 'json',
      active: 'bool',
    },
    output: { id: 'id', version: 'int' },
    effects: saveEffects,
    idempotent: true,
    agent: true,
    handler: saveTemplateHandler,
  }),
}
