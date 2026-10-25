import { KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

export const actor = (ctx: Ctx): string => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_MAIL_ACTOR_REQUIRED',
      module: 'mail',
      message: 'an inbox operation requires a signed-in user',
    })
  return ctx.actor
}

export const subtypeOutput = {
  id: 'id',
  code: 'text',
  name: 'text',
  defaultFollower: 'bool',
  internalOnly: 'bool',
  active: 'bool',
}
