// Sending a quotation to its customer. CRM and the sales screens both send through here, so one rule decides
// whether a quotation may go out: what it holds, until when it stands, to whom and whether they agreed to be
// contacted. The sending is recorded; delivering it (an email, a message the salesperson sends) is the caller's.
import { createHash } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { companyKey, ours } from '../scope.ts'

/** The channels a quotation goes out on. Without one, the quotation is only marked as sent (handed over). */
export const QUOTATION_CHANNELS = ['email', 'zalo'] as const
/** The civil day a quotation's validity is read in. */
export const QUOTATION_ZONE = 'Asia/Ho_Chi_Minh'
export const MESSAGE_LIMIT = 2000

export const quotationSendEffects = [
  'read:sale.Order',
  'write:sale.Order',
  'read:sale.OrderLine',
  'read:sale.QuotationSend',
  'write:sale.QuotationSend',
  'read:partner.Partner',
] as const

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[\d\s().-]{8,30}$/

/** A refusal the screens name in their own words: `sale.error.<code>` is a message of this module. */
const refused = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `sale.error.${code}`, message: `sale.error.${code}` }],
})
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const text = (value: unknown) => String(value ?? '').trim()

/** Whether an address fits the channel: an email address, or a phone number of 8 to 15 digits for Zalo. */
export const recipientFits = (channel: string, recipient: string): boolean => {
  if (channel === 'email') return EMAIL.test(recipient)
  const digits = recipient.replace(/\D/g, '').length
  return PHONE.test(recipient) && digits >= 8 && digits <= 15
}

export type QuotationSendInput = {
  id: string
  channel?: string | null
  recipient?: string | null
  message?: string | null
  expectedRevision?: number | null
  idempotencyKey?: string | null
  /** Where the caller delivers it, as it names the delivery. */
  deliveryRef?: string | null
}

/**
 * Sends a quotation, or marks it sent, and records the sending. Sending on a channel contacts the customer, so it
 * needs a quotation with lines that still stands, an address that fits the channel and the customer's agreement;
 * marking it sent (no channel) keeps the old behaviour. The same idempotency key returns the first sending.
 * The optional clock lets fixture hosts use their business day; application callers use the real clock.
 */
export async function sendQuotationTo(
  ctx: Ctx,
  input: QuotationSendInput,
  clock: () => Date = () => new Date(),
): Promise<Row> {
  const at = clock()
  const order = (await ours(ctx, 'sale.Order', { id: input.id }))[0]
  const key = text(input.idempotencyKey)
  // A sending is named by its key, or, without one, by the revision it produced.
  const named = key ? createHash('sha256').update(key).digest('hex').slice(0, 32) : null
  const idOf = (suffix: string) => companyKey(ctx, 'sale-quotation-send', String(order?.id), suffix)
  if (order && named) {
    const sent = (await ctx.db.select('sale.QuotationSend', { id: idOf(named) }))[0]
    if (sent) return { ok: true, id: order.id, sendId: sent.id, revision: Number(sent.orderRevision) }
  }
  if (!order || !['draft', 'sent'].includes(String(order.state)))
    return invalid('state', 'only a draft quotation can be sent')
  if (order.orderAuthority != null && order.orderAuthority !== 'local')
    return invalid('orderAuthority', 'this order is managed by an external system')
  const revision = Number(order.revision ?? 0)
  if (input.expectedRevision != null && revision !== Number(input.expectedRevision))
    return invalid('expectedRevision', 'sales order changed')
  const channel = text(input.channel) || null
  const recipient = text(input.recipient) || null
  const message = text(input.message) || null
  if (channel) {
    if (!(QUOTATION_CHANNELS as readonly string[]).includes(channel))
      return refused('channel', 'channelUnknown')
    if (!(await ours(ctx, 'sale.OrderLine', { orderId: order.id })).length)
      return refused('lines', 'quotationEmpty')
    const validity = String(order.validityDate ?? '').slice(0, 10)
    const today = at.toLocaleDateString('en-CA', { timeZone: QUOTATION_ZONE })
    if (validity && validity < today) return refused('validityDate', 'quotationExpired')
    if (!recipient || recipient.length > 120 || !recipientFits(channel, recipient))
      return refused('recipient', 'recipientInvalid')
    if (message && message.length > MESSAGE_LIMIT) return refused('message', 'messageTooLong')
    const customer = order.partnerId
      ? (await ctx.db.select('partner.Partner', { id: order.partnerId }))[0]
      : undefined
    if (customer?.contactConsent !== true) return refused('consent', 'consentRequired')
  }
  const claimed = await ctx.db.compareAndSet(
    'sale.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: revision + 1 },
  )
  if (!('dryRun' in claimed) && !claimed.matched) return invalid('expectedRevision', 'sales order changed')
  await ctx.db.update('sale.Order', { id: order.id }, { state: 'sent' })
  const sendId = idOf(named ?? `r${revision + 1}`)
  await ctx.db.insert('sale.QuotationSend', {
    id: sendId,
    orderId: order.id,
    channel,
    recipient: channel ? recipient : null,
    message: channel ? message : null,
    orderRevision: revision + 1,
    actorUserId: ctx.actor ?? null,
    deliveryRef: text(input.deliveryRef) || null,
    idempotencyKey: key || null,
    sentAt: at.toISOString(),
  })
  return { ok: true, id: order.id, sendId, revision: revision + 1 }
}
