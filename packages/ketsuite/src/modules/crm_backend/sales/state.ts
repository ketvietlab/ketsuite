// The CRM sales screens read one state shape, the same in the product and in the demo: records, partners,
// activities and configuration (see `read.mjs`). This loads it from the database for the calling user. A
// record is in it only when the user may see it (`caseAudience`); each says whether the user may edit it.
// Times become the company's local wall time, which is what the screens compare and print.
import { asc, desc, eq, from, gte, inArray, isNull } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { audienceHolds, caseAudience, liveSuperuser, ownedKinds } from '../../crm/index.ts'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { messages } from '../../crm/messages.ts'
import { quotationPolicyOf } from '../../crm_sale/index.ts'
import { defaultLostReasons } from '../../crm/reporting.ts'
import { caseDeliveryId } from './mail.ts'
import { fold } from './read.mjs'

export type SalesRole = 'manager' | 'agent' | 'viewer' | 'none'
export type SalesActor = { id: string; role: SalesRole }
export type SalesPerson = { id: string; name: string }
export type SalesState = Record<string, unknown> & { records: Row[] }
export type LoadedSales = {
  clock: string
  zone: string
  actor: SalesActor
  people: SalesPerson[]
  state: SalesState
}

/** Everything `loadSalesState` reads. */
export const salesStateEffects = [
  ...AUTHORIZATION_READ_EFFECTS,
  'read:company.Company',
  'read:user.User',
  'read:partner.Partner',
  'read:crm.Case',
  'read:crm.SalesDetail',
  'read:crm.CaseTag',
  'read:crm.Tag',
  'read:crm.Stage',
  'read:crm.Team',
  'read:crm.TeamMember',
  'read:crm.LostReason',
  'read:crm.AssignmentRule',
  'read:crm.ScoreRule',
  'read:crm.TimelineEntry',
  'read:crm.Message',
  'read:crm.ActivityLink',
  'read:activity.Activity',
  'read:activity.Type',
  'read:activity.Plan',
  'read:activity.PlanStep',
  'read:crm_sale.OpportunityQuotation',
  'read:crm_sale.QuotationPolicy',
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:sale.QuotationSend',
  'read:sale.OrderLifecycleEvent',
  'read:mail_transport.Delivery',
  'read:crm_backend.SalesImportPreview',
  'read:product.Template',
  'read:product.Product',
] as const

/** The zone a company without an accounting timezone keeps its days in. */
export const DEFAULT_ZONE = 'Asia/Ho_Chi_Minh'
const ACTIVITY_TYPES = new Set(['call', 'email', 'meeting', 'task'])
const CHUNK = 500
const pad = (n: number) => String(n).padStart(2, '0')
const text = (value: unknown) => (value == null ? '' : String(value))
const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const strings = (value: unknown): string[] => {
  const list = typeof value === 'string' ? (JSON.parse(value || '[]') as unknown) : value
  return Array.isArray(list) ? list.map(String) : []
}
const json = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
const unique = (values: unknown[]) => [
  ...new Set(values.filter((value) => value != null && value !== '').map(String)),
]
const by = (rows: Row[], key = 'id') => new Map(rows.map((row) => [String(row[key]), row]))
/** The channels a lead comes from out of the box. A record's source written in another casing reads as one of these. */
export const SALES_SOURCES = ['Website', 'Facebook', 'Zalo OA', 'Giới thiệu']
/** The sources an integration delivers leads from, each with an event ID of its own: the website's forms. */
export const SALES_INTAKE_SOURCES = ['Website']
/** A seeded stage keeps its English seed name until someone renames it; until then it reads in the reader's language. */
const stageName = (stage: Row, lang: string) => {
  const key = `stage.${text(stage.code)}`
  const seeded = (messages.en as Record<string, string>)[key]
  return seeded && text(stage.name) === seeded
    ? (messages[lang === 'en' ? 'en' : 'vi'] as Record<string, string>)[key]
    : text(stage.name)
}
const sourceOf = (value: unknown) => {
  const raw = text(value).trim()
  return SALES_SOURCES.find((known) => fold(known) === fold(raw)) ?? raw
}
const stamp = (value: unknown) => (value instanceof Date ? value.getTime() : Date.parse(text(value)) || 0)

/** A timestamp as wall time in `zone`, with its offset: `2026-09-14T09:40:00+07:00`. */
export const wallTime = (zone: string) => {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return (value: unknown): string | null => {
    if (value == null || value === '') return null
    const date = value instanceof Date ? value : new Date(String(value))
    const at = date.getTime()
    if (Number.isNaN(at)) return null
    const part = Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]))
    const wall = `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}`
    const offset = Math.round((Date.parse(`${wall}Z`) - Math.floor(at / 1000) * 1000) / 60_000)
    const size = Math.abs(offset)
    return `${wall}${offset < 0 ? '-' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
  }
}
/** A calendar date (`YYYY-MM-DD`) as stored. */
const day = (value: unknown): string =>
  value == null || value === ''
    ? ''
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10)

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format()
    return true
  } catch {
    return false
  }
}

/** A timeline event as the screens name it; null when another entry already shows it. */
const EVENT_TITLES: Record<string, string | null> = {
  created: 'create',
  stage: 'move',
  assigned: 'assign',
  reassigned: 'assign',
  won: 'close',
  lost: 'close',
  converted: 'convert',
  merged: 'merge',
  activity_scheduled: 'activity',
  activity_rescheduled: 'reschedule',
  plan_applied: 'plan',
  quotation_created: 'quote-create',
  quotation_revised: 'quote-edit',
  quotation_sent: 'quote-send',
  quotation_accepted: 'quote-accept',
  quotation_attached: 'quote-attach',
  // A note is its message, a finished activity its own entry, an interaction a message of its own.
  message: null,
  activity_completed: null,
  activity_cancelled: null,
  interaction: null,
}
/** Bodies that are message keys rather than words a person wrote. */
const generated = (body: unknown) => /^crm\.timeline\./.test(text(body))
const QUOTE_STATES: Record<string, string> = {
  draft: 'draft',
  sent: 'sent',
  sale: 'accepted',
  done: 'accepted',
  cancel: 'cancelled',
}

/** The history of the record on screen: timeline, notes, interactions, quotes, orders and what may be quoted. */
const recordHistory = async (ctx: Ctx, caseId: string, local: (value: unknown) => string | null) => {
  const [entries, notes, links, stages] = await Promise.all([
    ctx.db.select('crm.TimelineEntry', { caseId }),
    ctx.db.select('crm.Message', { caseId }),
    ctx.db.select('crm_sale.OpportunityQuotation', { caseId }),
    ctx.db.select('crm.Stage'),
  ])
  const closedStages = new Set(
    stages.filter((stage) => text(stage.terminalState) !== 'open').map((stage) => String(stage.id)),
  )
  const orderIds = unique(links.map((link) => link.salesOrderId))
  // What the sale itself records of these orders, whichever screen did it: each sending, each fulfilment step.
  const [orders, sends, phases] = await Promise.all([
    allIn(ctx, 'sale.Order', 'id', orderIds),
    allIn(ctx, 'sale.QuotationSend', 'orderId', orderIds),
    allIn(ctx, 'sale.OrderLifecycleEvent', 'orderId', orderIds),
  ])
  const nameOf = (orderId: unknown) =>
    text(orders.find((order) => String(order.id) === String(orderId))?.name) || String(orderId)
  const sendsOf = (orderId: unknown) =>
    sends
      .filter((send) => String(send.orderId) === String(orderId))
      .sort((a, b) => text(a.sentAt).localeCompare(text(b.sentAt)))
  const sendIds = new Set(sends.map((send) => String(send.id)))
  // An order this record accepted already says it was confirmed.
  const acceptedHere = new Set(
    entries
      .filter((entry) => entry.eventType === 'quotation_accepted')
      .map((entry) => text((json(entry.metadata) as Row | null)?.salesOrderId)),
  )
  // An email reads as its delivery stands: waiting, sent, or failed and to be sent again.
  const emails = notes.filter((note) => note.channel === 'email')
  const deliveries = by(
    await allIn(
      ctx,
      'mail_transport.Delivery',
      'id',
      emails.map((note) => caseDeliveryId(String(note.id))),
    ),
  )
  const delivered = (note: Row) => {
    const state = text(deliveries.get(caseDeliveryId(String(note.id)))?.state)
    return state === 'sent' || state === 'failed' || state === 'cancelled' ? state : 'queued'
  }
  const lines = await allIn(ctx, 'sale.OrderLine', 'orderId', unique(orders.map((order) => order.id)))
  const T = ctx.table('product.Template')
  const templates = await ctx.db.all(
    from(T).where(eq(T.active, true), eq(T.saleOk, true)).orderBy(asc(T.name)).limit(200),
  )
  const templateBy = by(templates)
  const P = ctx.table('product.Product')
  const variants = templates.length
    ? await ctx.db.all(
        from(P)
          .where(eq(P.active, true), inArray(P.templateId, [...templateBy.keys()]))
          .orderBy(asc(P.templateId), asc(P.combinationKey), asc(P.id)),
      )
    : []
  const timeline: {
    id: string
    caseId: string
    at: string | null
    actor: string
    title: string
    body: string
    meta: Row | null
    outcome: string | null
  }[] = entries.flatMap((entry) => {
    const type = text(entry.eventType)
    const meta = (json(entry.metadata) ?? {}) as Row
    // Back from a closed stage to an open one is a reopen.
    const reopen =
      type === 'stage' && closedStages.has(text(meta.from)) && text(meta.terminalState) === 'open'
    const title = reopen ? 'reopen' : Object.hasOwn(EVENT_TITLES, type) ? EVENT_TITLES[type] : type
    if (title === null) return []
    // A sending the sale recorded shows from that record, with its channel; the record's own line would repeat it.
    if (type === 'quotation_sent' && sendIds.has(text(meta.sendId))) return []
    return [
      {
        id: String(entry.id),
        caseId,
        at: local(entry.occurredAt),
        actor: text(entry.actorUserId),
        title,
        body: generated(entry.body)
          ? type === 'won' || type === 'lost'
            ? text(meta.reason)
            : ''
          : text(entry.body),
        meta:
          type === 'stage' && !reopen
            ? { from: text(meta.from), to: text(meta.to) }
            : type === 'assigned'
              ? { to: text(meta.assigneeUserId) }
              : type === 'reassigned'
                ? { from: text(meta.fromAssigneeUserId), to: text(meta.toAssigneeUserId) }
                : null,
        outcome: type === 'won' || type === 'lost' ? type : null,
      },
    ]
  })
  timeline.push(
    ...sends.map((send) => ({
      id: `send:${send.id}`,
      caseId,
      at: local(send.sentAt),
      actor: text(send.actorUserId),
      title: 'quote-send',
      body: nameOf(send.orderId),
      meta: { channel: text(send.channel) || 'hand', recipient: text(send.recipient) },
      outcome: null,
    })),
    ...phases
      .filter((phase) => !(phase.phase === 'confirmed' && acceptedHere.has(String(phase.orderId))))
      .map((phase) => ({
        id: `order:${phase.id}`,
        caseId,
        at: local(phase.occurredAt),
        actor: 'system',
        title: `order-${text(phase.phase)}`,
        body: nameOf(phase.orderId),
        meta: null,
        outcome: null,
      })),
  )
  const interactions = entries
    .filter((entry) => entry.eventType === 'interaction')
    .map((entry) => {
      const meta = (json(entry.metadata) ?? {}) as Row
      return {
        id: String(entry.id),
        caseId,
        kind: 'interaction',
        at: local(entry.occurredAt),
        actor: text(entry.actorUserId),
        body: generated(entry.body) ? '' : text(entry.body),
        channel: text(meta.channel),
        direction: 'outbound',
        state: 'internal',
      }
    })
  const linesOf = (orderId: unknown) => lines.filter((line) => String(line.orderId) === String(orderId))
  // What happened to each quotation, from the record's history: how often it was written again, when it last went out.
  const stepsOf = (orderId: unknown, event: string) =>
    entries.filter(
      (entry) =>
        entry.eventType === event &&
        text((json(entry.metadata) as Row | null)?.salesOrderId) === String(orderId),
    )
  const quotes = orders
    .filter((order) => Object.hasOwn(QUOTE_STATES, text(order.state)))
    .sort((a, b) => text(a.dateOrder).localeCompare(text(b.dateOrder)))
    .map((order) => ({
      id: text(order.name) || String(order.id),
      orderRef: String(order.id),
      caseId,
      state: QUOTE_STATES[text(order.state)],
      // The revision a person counts, from one; the order's own revision is what a command sends back.
      version: stepsOf(order.id, 'quotation_revised').length + 1,
      revision: num(order.revision),
      expires: day(order.validityDate),
      sentAt:
        local(
          [
            ...sendsOf(order.id).map((send) => text(send.sentAt)),
            ...stepsOf(order.id, 'quotation_sent').map((entry) => text(entry.occurredAt)),
          ]
            .sort()
            .at(-1),
        ) ?? null,
      lastSend: ((send) =>
        send
          ? {
              channel: text(send.channel) || 'hand',
              recipient: text(send.recipient),
              at: local(send.sentAt),
              actor: text(send.actorUserId),
            }
          : null)(sendsOf(order.id).at(-1)),
      orderId: QUOTE_STATES[text(order.state)] === 'accepted' ? text(order.name) || String(order.id) : '',
      lines: linesOf(order.id).map((line) => {
        const net = num(line.priceSubtotal)
        return {
          product: text(line.productId),
          name: text(line.name),
          quantity: num(line.productUomQty),
          price: num(line.priceUnit),
          discount: num(line.discount),
          tax:
            net && line.priceSubtotalIncl != null
              ? Math.round(((num(line.priceSubtotalIncl) - net) / net) * 100)
              : 0,
        }
      }),
      total: num(order.amountTotal),
    }))
  return {
    timeline,
    messages: [
      ...notes.map((note) =>
        note.channel === 'email'
          ? {
              id: String(note.id),
              caseId,
              kind: 'email',
              at: local(note.createdAt),
              actor: text(note.actorUserId),
              subject: text(note.subject),
              body: text(note.body),
              direction: text(note.direction) || 'outbound',
              state: delivered(note),
            }
          : {
              id: String(note.id),
              caseId,
              kind: 'note',
              at: local(note.createdAt),
              actor: text(note.actorUserId),
              body: text(note.body),
              direction: 'outbound',
              state: 'internal',
            },
      ),
      ...interactions,
    ],
    quotes,
    // An accepted quotation is the order itself; it bills as its invoices say.
    orders: orders
      .filter((order) => QUOTE_STATES[text(order.state)] === 'accepted')
      .map((order) => ({
        id: text(order.name) || String(order.id),
        caseId,
        quoteId: null,
        total: num(order.amountTotal),
        // How far it went, from the sale's own fulfilment steps.
        state:
          ['delivered', 'shipped'].find((step) =>
            phases.some((phase) => String(phase.orderId) === String(order.id) && phase.phase === step),
          ) ?? 'confirmed',
        payment: text(order.invoiceStatus) === 'invoiced' ? 'invoiced' : 'unpaid',
      })),
    products: variants.map((variant) => {
      const template = templateBy.get(String(variant.templateId))
      const suffix = text(variant.combinationKey).trim()
      return {
        id: String(variant.id),
        name: [text(template?.name) || String(variant.id), suffix].filter(Boolean).join(' · '),
        price: num(template?.listPrice),
      }
    }),
  }
}

const allIn = async (ctx: Ctx, model: string, column: string, ids: string[], ...where: unknown[]) => {
  const table = ctx.table(model)
  const rows: Row[] = []
  for (let i = 0; i < ids.length; i += CHUNK)
    rows.push(
      ...(await ctx.db.all(
        from(table).where(inArray(table[column], ids.slice(i, i + CHUNK)), ...(where as never[])),
      )),
    )
  return rows
}

/**
 * The quotations of a customer written in Sales that no opportunity holds yet, newest first: what an opportunity
 * of theirs may attach when the company allows it.
 */
const attachableQuotes = async (ctx: Ctx, partnerId: string, local: (value: unknown) => string | null) => {
  const O = ctx.table('sale.Order')
  const orders = await ctx.db.all(
    from(O)
      .where(
        eq(O.companyId, String(ctx.scope.company ?? '')),
        eq(O.partnerId, partnerId),
        inArray(O.state, ['draft', 'sent', 'sale']),
      )
      .orderBy(desc(O.dateOrder), asc(O.id))
      .limit(20),
  )
  const taken = new Set(
    (
      await allIn(
        ctx,
        'crm_sale.OpportunityQuotation',
        'salesOrderId',
        orders.map((order) => String(order.id)),
      )
    ).map((link) => String(link.salesOrderId)),
  )
  return orders
    .filter((order) => !taken.has(String(order.id)))
    .map((order) => ({
      id: text(order.name) || String(order.id),
      orderRef: String(order.id),
      caseId: null,
      partnerId,
      state: QUOTE_STATES[text(order.state)] ?? 'draft',
      total: num(order.amountTotal),
      expires: day(order.validityDate),
      date: local(order.dateOrder),
    }))
}

const importPreviewsOf = async (ctx: Ctx, id: string | null): Promise<Record<string, Row>> => {
  if (!id || !ctx.actor) return {}
  const row = (await ctx.db.select('crm_backend.SalesImportPreview', { id, actorUserId: ctx.actor }))[0]
  // A confirmed import is done with: its preview no longer offers to import.
  return row && row.result == null
    ? {
        [id]: {
          headers: json(row.headers) ?? [],
          diagnostics: json(row.diagnostics) ?? [],
          valid: row.valid === true,
          input: json(row.input) ?? {},
        },
      }
    : {}
}

/**
 * What the user may do on the sales screens, from the functions their roles allow. Whoever shapes the stages or
 * the teams manages the pipeline; one who may only read the configuration, or only open a record, reads that.
 * Each route still asks for its own screen's function, so neither opens a list of records.
 */
const salesRole = async (ctx: Ctx): Promise<SalesRole> => {
  if (!ctx.actor) return 'none'
  if (await liveSuperuser(ctx)) return 'manager'
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  if (allowed === null) return 'manager'
  const has = (key: string) => allowed.includes(key)
  if (has('crm.stage.save') || has('crm.team.save')) return 'manager'
  if (has('crm.case.list')) return has('crm.case.save') ? 'agent' : 'viewer'
  return has('crm.configuration.get') || has('crm.case.get') ? 'viewer' : 'none'
}

/**
 * The state of the sales screens for the calling user. `detail` names the record whose history (timeline,
 * messages and finished activities) the screen shows; other records carry only what lists and boards need.
 */
/**
 * The customer a "Create a lead" link names, read by the caller under their own partner permission. It joins the
 * state's customers so the lead form starts from it, also when none of its records is visible to the caller.
 */
export const withLinkedPartner = (state: SalesState, partner: unknown): SalesState => {
  if (!partner || typeof partner !== 'object' || !(partner as Row).id) return state
  const row = partner as Row
  const id = String(row.id)
  const partners = (state.partners ?? []) as Row[]
  const known = partners.find((p) => p.id === id)
  const linked = known
    ? { ...known, linked: true }
    : {
        id,
        name: text(row.name),
        kind: row.kind === 'company' ? 'company' : 'person',
        contactName: '',
        phone: text(row.phone),
        email: text(row.email),
        consent: row.contactConsent === true,
        linked: true,
      }
  return { ...state, partners: [...partners.filter((p) => p.id !== id), linked] }
}

export async function loadSalesState(
  ctx: Ctx,
  {
    detail = null,
    lang = 'vi',
    preview = null,
  }: { detail?: string | null; lang?: string; preview?: string | null } = {},
): Promise<LoadedSales> {
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: String(ctx.scope.company) }))[0]
    : null
  const configured = text(company?.accountingTimezone)
  const zone = configured && validZone(configured) ? configured : DEFAULT_ZONE
  const local = wallTime(zone)
  const clock = local(new Date()) as string
  const role = await salesRole(ctx)
  const actor: SalesActor = { id: text(ctx.actor), role }

  const [teams, members, stages, tags, lostReasons, assignmentRules, scoreRules, plans, planSteps] =
    await Promise.all([
      ctx.db.select('crm.Team', {}),
      ctx.db.select('crm.TeamMember', {}),
      ctx.db.select('crm.Stage', {}),
      ctx.db.select('crm.Tag', {}),
      ctx.db.select('crm.LostReason', {}),
      ctx.db.select('crm.AssignmentRule', {}),
      ctx.db.select('crm.ScoreRule', {}),
      ctx.db.select('activity.Plan', { active: true }),
      ctx.db.select('activity.PlanStep', {}),
    ])
  // A company that has saved no loss reason of its own reads the standard ones.
  const reasons = lostReasons.length ? lostReasons : defaultLostReasons(lang)
  const reasonBy = by(reasons)
  const reasonByCode = new Map(reasons.filter((r) => r.code).map((r) => [String(r.code), r]))

  // Records: the CRM's own kinds, not archived or merged away, that this user may see.
  const C = ctx.table('crm.Case')
  const active =
    role === 'none' ? [] : await ctx.db.all(from(C).where(inArray(C.kind, ownedKinds()), eq(C.active, true)))
  const [view, edit] = await Promise.all([caseAudience(ctx, 'view'), caseAudience(ctx, 'edit')])
  const cases = active.filter((row) => !row.mergedIntoId && audienceHolds(view, row))
  const caseIds = unique(cases.map((row) => row.id))
  // The history of a record the user may not see is not loaded at all.
  const shown = detail && caseIds.includes(detail) ? detail : null
  const [details, caseTags, links] = await Promise.all([
    allIn(ctx, 'crm.SalesDetail', 'caseId', caseIds),
    allIn(ctx, 'crm.CaseTag', 'caseId', caseIds),
    allIn(ctx, 'crm.ActivityLink', 'caseId', caseIds),
  ])
  const partners = await allIn(ctx, 'partner.Partner', 'id', unique(cases.map((row) => row.partnerId)))
  const detailBy = by(details, 'caseId')
  const partnerBy = by(partners)
  const tagsOf = new Map<string, string[]>()
  for (const link of caseTags)
    tagsOf.set(String(link.caseId), [...(tagsOf.get(String(link.caseId)) ?? []), String(link.tagId)])

  // Activities: every open one (next steps and attention flags), those finished today (the planner's tally)
  // and the whole history of the record on screen.
  const caseOf = new Map(links.map((link) => [String(link.activityId), String(link.caseId)]))
  const activityIds = [...caseOf.keys()]
  const A = ctx.table('activity.Activity')
  const midnight = new Date(Date.parse(`${clock.slice(0, 10)}T00:00:00${clock.slice(19)}`)).toISOString()
  const [planned, doneToday, caseActivities] = await Promise.all([
    allIn(
      ctx,
      'activity.Activity',
      'id',
      activityIds,
      isNull(A.doneAt),
      isNull(A.canceledAt),
      eq(A.active, true),
    ),
    allIn(ctx, 'activity.Activity', 'id', activityIds, gte(A.doneAt, midnight)),
    shown
      ? allIn(
          ctx,
          'activity.Activity',
          'id',
          links.filter((link) => String(link.caseId) === shown).map((link) => String(link.activityId)),
        )
      : Promise.resolve([] as Row[]),
  ])
  const activityRows = [...by([...planned, ...doneToday, ...caseActivities]).values()]
  const types = by(await allIn(ctx, 'activity.Type', 'id', unique(activityRows.map((row) => row.typeId))))

  const history = shown
    ? await recordHistory(ctx, shown, local)
    : { timeline: [], messages: [], quotes: [], orders: [], products: [] }
  const policy = await quotationPolicyOf(ctx)
  const shownCase = shown ? cases.find((row) => String(row.id) === shown) : undefined
  const saleQuotes =
    policy.saleQuotations === 'attach' && shownCase?.kind === 'opportunity' && shownCase.partnerId
      ? await attachableQuotes(ctx, String(shownCase.partnerId), local)
      : []

  // People who own work: members of a team, owners of a record or an activity, and the user.
  const userIds = unique([
    actor.id,
    ...members.map((m) => m.userId),
    ...teams.map((t) => t.leaderUserId),
    ...cases.map((row) => row.assigneeUserId),
    ...activityRows.map((row) => row.assigneeUserId),
    ...assignmentRules.map((rule) => rule.assigneeUserId),
  ])
  const users = await allIn(ctx, 'user.User', 'id', userIds)
  const people = users
    .map((user) => ({ id: String(user.id), name: text(user.name) || text(user.login) || String(user.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))

  const records = cases.map((row) => {
    const sale = detailBy.get(String(row.id))
    const partner = row.partnerId ? partnerBy.get(String(row.partnerId)) : undefined
    const reason: Row | undefined =
      (sale?.lostReasonId ? reasonBy.get(String(sale.lostReasonId)) : undefined) ??
      (sale?.lostReasonCode ? reasonByCode.get(String(sale.lostReasonCode)) : undefined)
    const createdAt = local(row.createdAt) as string
    return {
      id: String(row.id),
      kind: text(row.kind),
      name: text(row.name),
      partner: text(partner?.name) || text(row.contactName),
      partnerId: text(row.partnerId),
      contact: text(row.contactName),
      phone: text(row.phone),
      email: text(row.email),
      source: sourceOf(row.utmSource),
      stageId: text(row.stageId),
      assignee: text(row.assigneeUserId),
      teamId: text(row.teamId),
      revenue: num(sale?.expectedRevenue),
      probability: num(sale?.probability),
      priority: num(row.priority),
      terminal: text(row.terminalState) || 'open',
      score: num(row.score),
      tags: tagsOf.get(String(row.id)) ?? [],
      description: text(row.description),
      closing: day(sale?.expectedClosing),
      lostReason: reason ? text(reason.name) : text(sale?.lostReason),
      createdAt,
      stageAt: local(row.stageEnteredAt) ?? createdAt,
      closedAt: local(row.closedAt),
      closedFrom: row.closedFromStageId ? String(row.closedFromStageId) : null,
      updatedAt: local(row.updatedAt) ?? createdAt,
      version: num(row.version),
      consent: row.contactConsent === true,
      utmMedium: text(row.utmMedium),
      utmCampaign: text(row.utmCampaign),
      archived: false,
      writable: role === 'manager' || role === 'agent' ? audienceHolds(edit, row) : false,
    }
  })

  // A company is reached through a person: the latest record that names one says who.
  const contactOf = new Map<string, string>()
  for (const row of [...cases].sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt)))
    if (row.partnerId && text(row.contactName) && !contactOf.has(String(row.partnerId)))
      contactOf.set(String(row.partnerId), text(row.contactName))
  const state: SalesState = {
    revision: Math.max(0, ...cases.map((row) => Date.parse(String(row.updatedAt)) || 0)),
    records,
    partners: partners.map((partner) => ({
      id: String(partner.id),
      name: text(partner.name),
      kind: partner.kind === 'company' ? 'company' : 'person',
      contactName: partner.kind === 'company' ? (contactOf.get(String(partner.id)) ?? '') : '',
      phone: text(partner.phone),
      email: text(partner.email),
      consent: partner.contactConsent === true,
    })),
    activities: activityRows
      .filter((row) => caseOf.has(String(row.id)))
      .map((row) => {
        const category = text(types.get(String(row.typeId))?.category)
        const finished = row.doneAt ?? row.canceledAt
        return {
          id: String(row.id),
          caseId: caseOf.get(String(row.id)) as string,
          title: text(row.summary),
          type: ACTIVITY_TYPES.has(category) ? category : 'task',
          owner: text(row.assigneeUserId),
          dueAt: day(row.dueDate),
          state: row.doneAt ? 'done' : row.canceledAt ? 'cancelled' : 'open',
          // Activities keep no version; their last change stands in for one.
          version: Date.parse(String(row.updatedAt)) || 0,
          outcome: text(row.feedback),
          completedAt: finished ? local(finished) : null,
        }
      }),
    plans: plans.map((plan) => ({
      id: String(plan.id),
      name: text(plan.name),
      tasks: planSteps.filter((step) => String(step.planId) === String(plan.id)),
    })),
    config: {
      teams: teams.map((team) => ({
        id: String(team.id),
        code: text(team.code),
        name: text(team.name),
        leaderUserId: text(team.leaderUserId),
        assignmentMode: text(team.assignmentMode) || 'manual',
        active: team.active === true,
        // The row's own version, 0 before its first save: a command sends it back as the version it read.
        version: num(team.version),
        members: members
          .filter((member) => String(member.teamId) === String(team.id))
          .map((member) => ({
            id: String(member.id),
            userId: String(member.userId),
            capacity: num(member.capacity),
            sequence: num(member.sequence),
            active: member.active === true,
            version: 1,
          })),
      })),
      // Other modules keep their own pipelines in the same table (care tickets, resale); the sales screens
      // show, filter and edit only the stages a lead or an opportunity can sit in.
      stages: stages
        .filter((stage) => strings(stage.allowedKinds).some((kind) => ownedKinds().includes(kind)))
        .map((stage) => ({
          id: String(stage.id),
          code: text(stage.code),
          name: stageName(stage, lang),
          sequence: num(stage.sequence),
          allowedKinds: strings(stage.allowedKinds),
          teamId: text(stage.teamId),
          terminalState: text(stage.terminalState) || 'open',
          fold: stage.fold === true,
          active: stage.active === true,
          version: num(stage.version),
          probability: stage.probability == null ? null : num(stage.probability),
          staleDays: num(stage.staleDays),
        })),
      tags: tags.map((tag) => ({
        id: String(tag.id),
        name: text(tag.name),
        color: tag.color == null ? null : String(tag.color),
        active: tag.active === true,
        version: 1,
      })),
      lostReasons: reasons.map((reason) => ({
        id: String(reason.id),
        name: text(reason.name),
        code: reason.code == null ? null : String(reason.code),
        requiresNote: reason.requiresNote === true,
        sequence: num(reason.sequence),
        active: reason.active === true,
        version: num(reason.version),
      })),
      assignmentRules: assignmentRules.map((rule) => ({
        id: String(rule.id),
        name: text(rule.name),
        priority: num(rule.priority),
        allowedKinds: strings(rule.allowedKinds),
        teamId: text(rule.teamId),
        assigneeUserId: text(rule.assigneeUserId),
        utmSource: text(rule.utmSource),
        minimumScore: rule.minimumScore == null ? null : num(rule.minimumScore),
        active: rule.active === true,
        version: num(rule.version),
      })),
      scoreRules: scoreRules.map((rule) => ({
        id: String(rule.id),
        name: text(rule.name),
        field: text(rule.field),
        operator: text(rule.operator),
        value: text(rule.value),
        points: num(rule.points),
        active: rule.active === true,
        sequence: num(rule.sequence),
        version: num(rule.version),
      })),
      quotationPolicy: policy,
    },
    saleQuotes,
    // A round-robin team hands the next record to the member after its cursor.
    assignmentCounts: Object.fromEntries(teams.map((team) => [String(team.id), num(team.assignmentCursor)])),
    // How many open records each person holds across the company, seen or not, for the assignment preview.
    load: active.reduce<Record<string, number>>((load, row) => {
      if (row.assigneeUserId && !row.mergedIntoId && (text(row.terminalState) || 'open') === 'open')
        load[String(row.assigneeUserId)] = (load[String(row.assigneeUserId)] ?? 0) + 1
      return load
    }, {}),
    ...history,
    // The import the caller previewed, by the id its address names; nobody else's.
    importPreviews: await importPreviewsOf(ctx, preview),
  }
  return { clock, zone, actor, people, state }
}
