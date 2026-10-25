import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { receiveInbound } from '../inbound-service.ts'
import { inboundMutationEffects, inboundInput, inboundOutput } from './shared.ts'

export function receiveReplyHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx((tx) =>
    receiveInbound(tx, {
      provider: String(args.provider),
      providerEventId: String(args.providerEventId),
      kind: String(args.kind),
      fromAddress: args.fromAddress ? String(args.fromAddress) : undefined,
      recipients: args.recipients,
      subject: args.subject ? String(args.subject) : undefined,
      text: args.text ? String(args.text) : undefined,
      html: args.html ? String(args.html) : undefined,
      references: args.references,
      replyToken: args.replyToken ? String(args.replyToken) : undefined,
      alias: args.alias ? String(args.alias) : undefined,
      attachments: args.attachments,
      receivedAt: String(args.receivedAt),
    }),
  )
}

export const ingressFunctions: Record<string, FnSpec> = {
  receiveReply: defineFn({
    input: inboundInput,
    output: inboundOutput,
    effects: inboundMutationEffects,
    idempotent: true,
    handler: receiveReplyHandler,
  }),
}
