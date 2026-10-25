import { randomBytes } from 'node:crypto'
import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { tokenDigest } from '../inbound-service.ts'
import { actor } from './shared.ts'

export function createReplyTokenHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    actor(tx)
    const T = tx.table('mail.Thread')
    if (!(await tx.db.one(from(T).where(eq(T.id, args.threadId), eq(T.active, true)))))
      throw new Error('reply token thread is missing')
    if (args.parentMessageId) {
      const M = tx.table('mail.Message')
      if (!(await tx.db.one(from(M).where(eq(M.id, args.parentMessageId), eq(M.threadId, args.threadId)))))
        throw new Error('reply token parent message is not on the thread')
    }
    if (String(args.expiresAt) <= new Date().toISOString())
      throw new Error('reply token expiry must be in the future')
    const token = randomBytes(32).toString('base64url')
    await tx.db.insert('mail_inbound.ReplyToken', {
      id: args.id,
      tokenDigest: tokenDigest(token),
      threadId: args.threadId,
      ...(args.parentMessageId ? { parentMessageId: args.parentMessageId } : {}),
      active: true,
      expiresAt: args.expiresAt,
      createdAt: new Date().toISOString(),
    })
    return { id: args.id, token, expiresAt: args.expiresAt }
  })
}

export const tokensFunctions: Record<string, FnSpec> = {
  createReplyToken: defineFn({
    input: { id: 'id', threadId: 'id', parentMessageId: 'id?', expiresAt: 'datetime' },
    output: { id: 'id', token: 'text', expiresAt: 'datetime' },
    effects: ['read:mail.Thread', 'read:mail.Message', 'write:mail_inbound.ReplyToken'],
    handler: createReplyTokenHandler,
  }),
}
