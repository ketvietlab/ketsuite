import { asc, eq, from, gt } from '@ketvietlab/ketjs'
import type { JobSpec, Row } from '@ketvietlab/ketjs'
import { queueTemplate } from '../../mail_transport/delivery-service.ts'
import { hash, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { invitationAuthorized } from './access.ts'
import { owned, policyEffects, string } from './policy.ts'

export type FlowInvitationMail = { origin: string; templateId: string }
const deliveryId = (company: unknown, id: unknown) => 'flow-invitation-' + hash(JSON.stringify([company, id]))
const effects = [
  ...policyEffects,
  'read:flow.Invitation',
  'read:flow.Outbox',
  'write:flow.Outbox',
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'write:mail_transport.DeliveryNotification',
  'enqueue:flow.deliverMail',
  'enqueue:flow.dispatchInvitation',
]

/** The deployment supplies a trusted public origin; never derive email links from Host. */
export function invitationDelivery(config: FlowInvitationMail): {
  extension: NativeServerExtension
  jobs: Record<string, JobSpec>
} {
  const origin = new URL(config.origin)
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))
    ) ||
    !config.templateId
  )
    throw new Error('Flow invitation delivery requires a trusted HTTPS origin and template')
  return {
    extension: {
      name: 'flow-invitation-delivery',
      effects,
      readEffects: [],
      projection: async () => ({ invitationDelivery: 'queued-email' }),
      afterMutation: async (ctx, mutation, value) => {
        if (
          !['flow.member.invite', 'flow.invitation.resend', 'flow.invitation.revoke'].includes(mutation.name)
        )
          return
        const id = (value as Row).id,
          I = await owned(ctx, 'flow.Invitation', id),
          O = ctx.table('flow.Outbox')
        let after = ''
        while (true) {
          const rows = await ctx.db.all(
            from(O)
              .where(
                eq(O.companyId, ctx.scope.company),
                eq(O.targetId, id),
                eq(O.kind, 'invitation'),
                ...(after ? [gt(O.id, after)] : []),
              )
              .orderBy(asc(O.id))
              .limit(100),
          )
          for (const row of rows) {
            const payload = row.payload as Row
            if (
              !I.revokedAt &&
              !I.consumedAt &&
              hash(string(payload.token)) === I.digest &&
              row.state === 'pending'
            ) {
              await ctx.jobs.enqueue(
                'flow.dispatchInvitation',
                { outboxId: row.id },
                { uniqueKey: 'flow-invitation:' + row.id },
              )
              continue
            }
            if (['cancelled', 'sent'].includes(string(row.state))) continue
            const D = ctx.table('mail_transport.Delivery'),
              held = await ctx.db.one(
                from(D).where(
                  eq(D.companyId, ctx.scope.company),
                  eq(D.id, deliveryId(ctx.scope.company, row.id)),
                ),
              )
            // A message already accepted by the provider cannot be recalled. Its token is now invalid.
            if (held && !['sent', 'sending'].includes(string(held.state)))
              await ctx.db.compareAndSet(
                'mail_transport.Delivery',
                { id: held.id },
                { version: held.version, state: held.state },
                { state: 'cancelled', updatedAt: now() },
              )
            await ctx.db.update('flow.Outbox', { id: row.id }, { state: 'cancelled', payload: {} })
          }
          if (rows.length < 100) break
          after = string(rows.at(-1)!.id)
        }
      },
    },
    jobs: {
      dispatchInvitation: {
        queue: 'mail',
        input: { outboxId: 'id' },
        effects: effects.filter((effect) => effect !== 'enqueue:flow.dispatchInvitation'),
        idempotent: true,
        maxAttempts: 5,
        timeoutMs: 30_000,
        handler: async (ctx, args) =>
          ctx.tx(async (tx) => {
            const O = tx.table('flow.Outbox'),
              I = tx.table('flow.Invitation')
            const outbox = await tx.db.one(
              from(O).where(
                eq(O.companyId, tx.scope.company),
                eq(O.id, args.outboxId),
                eq(O.kind, 'invitation'),
              ),
            )
            if (outbox?.state !== 'pending') return
            const invite = await tx.db.one(
              from(I).where(eq(I.companyId, tx.scope.company), eq(I.id, outbox.targetId)),
            )
            const payload = outbox.payload as Row
            if (
              !invite ||
              invite.revokedAt ||
              invite.consumedAt ||
              string(invite.expiresAt) <= now() ||
              hash(string(payload.token)) !== invite.digest ||
              !(await invitationAuthorized(tx, invite))
            ) {
              await tx.db.update('flow.Outbox', { id: outbox.id }, { state: 'cancelled', payload: {} })
              return
            }
            const link = new URL('/flow/invitation-accept', origin)
            link.searchParams.set('id', string(payload.token))
            const delivery = await queueTemplate(tx, {
              id: deliveryId(tx.scope.company, outbox.id),
              templateId: config.templateId,
              deliveryJob: 'flow.deliverMail',
              context: {
                invitationUrl: link.href,
                email: invite.email,
                expiresAt: invite.expiresAt,
                role: invite.role,
              },
              to: [{ address: invite.email }],
            })
            await tx.db.update(
              'flow.Outbox',
              { id: outbox.id },
              {
                state: 'queued',
                deliveryId: delivery.id,
                payload: { deliveryId: delivery.id },
                attempts: Number(outbox.attempts) + 1,
              },
            )
          }),
      },
    },
  }
}
