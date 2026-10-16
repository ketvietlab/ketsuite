// Email from a sales record. The message stays on the record; the mail goes out through mail_transport, under a
// delivery named by the message, so the record reads its delivery and a retry finds it.
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addTimeline, canEditCase, invalid, issue } from '../../crm/index.ts'
import { functions as transport, queueTemplate, writeTemplate } from '../../mail_transport/index.ts'
import { quotationSendEffects, sendQuotationTo } from '../../sale/functions/quotation-send.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'

/** The delivery of a record's email. */
export const caseDeliveryId = (messageId: string) => `crm-email:${messageId}`

const recordEffects = [
  'read:crm.Case',
  'read:crm.Team',
  'read:crm.TeamMember',
  ...AUTHORIZATION_READ_EFFECTS,
  'read:user.User',
  'read:crm.Message',
] as const

export const sendEmailEffects = [
  ...recordEffects,
  'write:crm.Message',
  'read:company.Company',
  'read:partner.Partner',
  'read:mail_transport.Template',
  'write:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'read:mail.Message',
  'read:mail.Notification',
  'write:mail_transport.DeliveryNotification',
  'enqueue:mail_transport.deliver',
] as const

/** Sending a record's quotation: the sale's own rule and record, the email it goes with, the record's history. */
export const sendQuotationEffects = [
  ...new Set([
    ...sendEmailEffects,
    ...quotationSendEffects,
    'read:crm_sale.OpportunityQuotation',
    'read:crm.TimelineEntry',
    'write:crm.TimelineEntry',
  ]),
] as const

export const retryEmailEffects = [
  ...recordEffects,
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'enqueue:mail_transport.deliver',
] as const

/**
 * The company's template for a record's email: the subject and words the user wrote, from the company's own
 * address. It is written the first time, from the company's email; one an administrator turned off sends nothing.
 */
const senderTemplate = async (ctx: Ctx): Promise<string | null> => {
  const company = String(ctx.scope.company ?? '')
  const id = company ? `crm-case-email:${company}` : 'crm-case-email'
  const existing = (await ctx.db.select('mail_transport.Template', { id }))[0]
  if (existing) return existing.active === false ? null : id
  const owner = company ? (await ctx.db.select('company.Company', { id: company }))[0] : undefined
  const partner = owner?.partnerId
    ? (await ctx.db.select('partner.Partner', { id: owner.partnerId }))[0]
    : undefined
  const address = String(partner?.email ?? '').trim()
  if (!address.includes('@') || /[\r\n]/.test(address)) return null
  await writeTemplate(ctx, {
    id,
    name: 'CRM customer email',
    fromAddress: address,
    fromName: String(partner?.name ?? owner?.name ?? '').trim() || null,
    subjectTemplate: '{{subject}}',
    textTemplate: '{{body}}',
    allowedKeys: ['subject', 'body'],
    active: true,
  })
  return id
}

/** The record the user may change, or the refusal to return. */
const editable = async (ctx: Ctx, caseId: string): Promise<Row | null> => {
  const held = (await ctx.db.select('crm.Case', { id: caseId }))[0]
  return held && (await canEditCase(ctx, held)) ? held : null
}

/** Writes an email to the record's contact, who agreed to be contacted, and queues it. Sent once per id. */
export async function sendCaseEmail(
  ctx: Ctx,
  input: { id: string; caseId: string; subject: string; body: string },
): Promise<Row> {
  if (!ctx.actor) return invalid(issue('actor', 'crm.error.actorRequired'))
  const subject = String(input.subject ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  const body = String(input.body ?? '').trim()
  if (!body) return invalid(issue('message', 'crm.error.required'))
  return ctx.tx(async (tx) => {
    const held = await editable(tx, input.caseId)
    if (!held) return invalid(issue('caseId', 'crm.error.notFound'))
    if ((await tx.db.select('crm.Message', { id: input.id }))[0]) return { ok: true, id: input.id }
    if (held.contactConsent !== true) return invalid(issue('consent', 'crm_backend.error.consentRequired'))
    const address = String(held.email ?? '').trim()
    if (!address.includes('@')) return invalid(issue('email', 'crm_backend.error.emailRequired'))
    const template = await senderTemplate(tx)
    if (!template) return invalid(issue('from', 'crm_backend.error.noSender'))
    await writeEmail(tx, held, { id: input.id, template, subject, body, address })
    return { ok: true, id: input.id }
  })
}

/** The email on the record and its delivery, queued from the company's template. */
const writeEmail = async (
  ctx: Ctx,
  held: Row,
  email: { id: string; template: string; subject: string; body: string; address: string },
) => {
  await ctx.db.insert('crm.Message', {
    id: email.id,
    caseId: held.id,
    actorUserId: ctx.actor,
    visibility: 'customer',
    channel: 'email',
    direction: 'outbound',
    subject: email.subject || null,
    body: email.body,
    createdAt: new Date().toISOString(),
  })
  await queueTemplate(ctx, {
    id: caseDeliveryId(email.id),
    templateId: email.template,
    context: { subject: email.subject, body: email.body },
    to: [
      {
        address: email.address,
        ...(held.contactName && String(held.email ?? '').trim() === email.address
          ? { name: String(held.contactName) }
          : {}),
      },
    ],
  })
}

/**
 * Sends a record's quotation under the sale's rule, in one transaction with what goes with it: by email, the
 * record's own email and its delivery; on any channel, the record's history line naming the sending. Without a
 * channel the quotation is marked as handed over. The record must be the user's to change; on a channel its
 * contact must have agreed to be contacted, as for any email from it.
 */
export async function sendCaseQuotation(
  ctx: Ctx,
  input: {
    caseId: string
    orderId: string
    channel?: string | null
    recipient?: string | null
    subject?: string | null
    message?: string | null
    messageId: string
    expectedRevision: number
    idempotencyKey: string
  },
): Promise<Row> {
  if (!ctx.actor) return invalid(issue('actor', 'crm.error.actorRequired'))
  const channel = String(input.channel ?? '').trim() || null
  const recipient = String(input.recipient ?? '').trim()
  const subject = String(input.subject ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  const message = String(input.message ?? '').trim()
  if (channel === 'email' && !message) return invalid(issue('message', 'crm.error.required'))
  return ctx.tx(async (tx) => {
    const held = await editable(tx, input.caseId)
    if (!held) return invalid(issue('caseId', 'crm.error.notFound'))
    const link = (
      await tx.db.select('crm_sale.OpportunityQuotation', {
        caseId: input.caseId,
        salesOrderId: input.orderId,
      })
    )[0]
    if (!link) return invalid(issue('quoteId', 'crm.error.notFound'))
    if (channel && held.contactConsent !== true)
      return invalid(issue('consent', 'crm_backend.error.consentRequired'))
    const template = channel === 'email' ? await senderTemplate(tx) : null
    if (channel === 'email' && !template) return invalid(issue('from', 'crm_backend.error.noSender'))
    const sent = await sendQuotationTo(tx, {
      id: input.orderId,
      channel,
      recipient,
      message,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      deliveryRef: channel === 'email' ? caseDeliveryId(input.messageId) : null,
    })
    if (sent.ok !== true) return sent
    if (template && !(await tx.db.select('crm.Message', { id: input.messageId }))[0])
      await writeEmail(tx, held, {
        id: input.messageId,
        template,
        subject,
        body: message,
        address: recipient,
      })
    const entry = `timeline:${input.caseId}:quotation_sent:${input.orderId}:${input.idempotencyKey}`
    if (!(await tx.db.select('crm.TimelineEntry', { id: entry }))[0]) {
      const order = (await tx.db.select('sale.Order', { id: input.orderId }))[0]
      await addTimeline(tx, {
        id: entry,
        caseId: input.caseId,
        eventType: 'quotation_sent',
        body: String(order?.name ?? input.orderId),
        metadata: { salesOrderId: input.orderId, sendId: sent.sendId, channel },
      })
    }
    return { ok: true, id: input.orderId, sendId: sent.sendId }
  })
}

/**
 * Sends a record's failed email again. The transport's retry keeps its own transaction and checks the delivery
 * again inside it, so a delivery sent meanwhile stays sent.
 */
export async function retryCaseEmail(ctx: Ctx, input: { caseId: string; messageId: string }): Promise<Row> {
  if (!ctx.actor) return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!(await editable(ctx, input.caseId))) return invalid(issue('caseId', 'crm.error.notFound'))
  const message = (await ctx.db.select('crm.Message', { id: input.messageId, caseId: input.caseId }))[0]
  if (message?.channel !== 'email') return invalid(issue('messageId', 'crm.error.notFound'))
  const delivery = (
    await ctx.db.select('mail_transport.Delivery', { id: caseDeliveryId(input.messageId) })
  )[0]
  if (delivery?.state !== 'failed') return invalid(issue('messageId', 'crm_backend.error.emailNotFailed'))
  await transport.retry!.handler(ctx, { id: delivery.id })
  return { ok: true, id: input.messageId }
}
