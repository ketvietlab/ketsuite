import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { userNames } from './customers.ts'
import { companyKey, ours } from './scope.ts'

/**
 * Who did what to an order (D7): one `sale.OrderEvent` per command that changed it, with the
 * person who ran it, as the mock's "Lịch sử thay đổi". Commands that create an invoice, take a
 * deposit, confirm or cancel record their event in their own transaction; every other order
 * command is wrapped by `withOrderHistory`, which records one after the command returns if the
 * order, its lines, tags or deposits changed. A replay that changes nothing, or a call answered
 * from its idempotency key, leaves no second event. A command that runs another (loyalty's
 * confirm runs Sale's) records once, as the outer one.
 */
export type OrderEventInput = {
  action: string
  relatedId?: unknown
  reason?: unknown
  details?: Row
  /** A fact that may be recorded twice (a retried receipt) names itself so the second is dropped. */
  key?: string
}

type Running = { recorded: Set<string> }
const running = new AsyncLocalStorage<Running>()
const WRAPPED = Symbol.for('ketsuite.sale.orderHistory')

export const ORDER_EVENT_EFFECTS = ['write:sale.OrderEvent'] as const
const FINGERPRINT_EFFECTS = [
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:sale.OrderTag',
  'read:sale.OrderDeposit',
] as const

export async function recordOrderEvent(ctx: Ctx, orderId: unknown, event: OrderEventInput) {
  if (!orderId) return
  const row = {
    id: companyKey(ctx, 'sale-order-event', event.key ?? randomUUID()),
    orderId: String(orderId),
    action: event.action,
    actorId: ctx.actor ?? null,
    relatedId: event.relatedId == null || event.relatedId === '' ? null : String(event.relatedId),
    reason: event.reason == null ? null : String(event.reason).trim().slice(0, 500) || null,
    details: event.details ?? {},
    occurredAt: new Date().toISOString(),
  }
  await (event.key ? ctx.db.insertIfAbsent('sale.OrderEvent', row) : ctx.db.insert('sale.OrderEvent', row))
  running.getStore()?.recorded.add(String(orderId))
}

type Rule = {
  action: string | ((args: Row) => string)
  /** The order is `args.id` unless named here: `orderId`, the line's order, or the order a create returns. */
  order?: 'orderId' | 'line' | 'created'
  related?: (args: Row, result: Row) => unknown
  details?: (ctx: Ctx, args: Row) => Promise<Row | undefined>
  /** Its write is outside the order (a deposit set off against an invoice); a success is the change. */
  byResult?: (args: Row) => string
}

const sourceName = async (ctx: Ctx, args: Row) => {
  const source = (await ours(ctx, 'sale.Order', { id: args.sourceId }))[0]
  return source ? { name: String(source.name ?? '') } : undefined
}
const templateName = async (ctx: Ctx, args: Row) => {
  const template = (await ours(ctx, 'sale_template.Template', { id: args.templateId }))[0]
  return template ? { name: String(template.name ?? '') } : undefined
}

/** The order commands of Sale, Loyalty for sales and Quotation templates, by function name. */
export const ORDER_COMMANDS: Record<string, Rule> = {
  createOrder: { action: 'create', order: 'created' },
  createQuotation: {
    action: 'createFromTemplate',
    order: 'created',
    related: (args) => args.templateId,
    details: templateName,
  },
  copyOrder: { action: 'copy', order: 'created', related: (args) => args.sourceId, details: sourceName },
  saveDraft: { action: 'save' },
  resetOrder: { action: 'reset' },
  sendQuotation: { action: 'send' },
  confirmOrder: { action: 'confirm' },
  cancelOrder: { action: 'cancel' },
  lockOrder: { action: (args) => (args.locked ? 'lock' : 'unlock') },
  addLine: { action: 'addLine', order: 'orderId' },
  updateLine: { action: 'updateLine', order: 'line' },
  removeLine: { action: 'removeLine', order: 'line' },
  applyLineGrid: { action: 'editLines' },
  setVariantMatrix: { action: 'variantMatrix' },
  setCatalogueQuantity: { action: 'catalogue' },
  saveCatalogueDraft: { action: 'catalogue' },
  updatePrices: { action: 'updatePrices' },
  applyDiscount: { action: 'discount' },
  setOptionalSections: { action: 'optionalSections' },
  saveDeliveryPromise: { action: 'deliveryPromise' },
  setOrderSalesperson: { action: 'salesperson' },
  setOrderTags: { action: 'tags' },
  syncDeliveries: { action: 'syncDeliveries' },
  createInvoice: { action: 'invoice', order: 'orderId', related: (args) => args.id },
  collectDeposit: { action: 'deposit', order: 'orderId', related: (args) => args.id },
  applyDeposit: {
    action: 'applyDeposit',
    order: 'orderId',
    related: (args) => args.paymentId,
    byResult: (args) => `apply:${String(args.paymentId)}:${String(args.invoiceId)}`,
  },
  applyCode: { action: 'applyCode', order: 'orderId' },
  applyReward: { action: 'applyReward', order: 'orderId' },
  removeReward: { action: 'removeReward', order: 'orderId' },
  addSection: { action: 'addSection', related: (args) => args.templateId, details: templateName },
  applyQuotation: { action: 'applyTemplate', related: (args) => args.templateId, details: templateName },
}

/** Everything a command may change on an order, as one digest; `null` when there is no such order. */
async function fingerprint(ctx: Ctx, orderId: unknown): Promise<string | null> {
  if (!orderId) return null
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return null
  const rows = async (model: string) =>
    (await ours(ctx, model, { orderId })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const held = [
    order,
    await rows('sale.OrderLine'),
    await rows('sale.OrderTag'),
    await rows('sale.OrderDeposit'),
  ]
  return createHash('sha256')
    .update(JSON.stringify(held, (_key, value) => (typeof value === 'bigint' ? String(value) : value)))
    .digest('hex')
}

async function orderOf(ctx: Ctx, rule: Rule, args: Row): Promise<unknown> {
  if (rule.order === 'orderId') return args.orderId
  if (rule.order === 'line') return (await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]?.orderId
  return args.id
}

const merged = (...lists: readonly (readonly string[] | undefined)[]) => [
  ...new Set(lists.flatMap((list) => list ?? [])),
]

function logged(name: string, spec: FnSpec, rule: Rule): FnSpec {
  const handler = spec.handler
  const wrapped: FnSpec = {
    ...spec,
    effects: merged(spec.effects, FINGERPRINT_EFFECTS, ORDER_EVENT_EFFECTS),
    handler: async (ctx: Ctx, args: Record<string, unknown>) => {
      if (running.getStore() || ctx.dryRun) return handler(ctx, args)
      const state: Running = { recorded: new Set() }
      return running.run(state, async () => {
        const before = await orderOf(ctx, rule, args)
        const print = rule.byResult ? null : await fingerprint(ctx, before)
        const result = (await handler(ctx, args)) as Row
        const orderId = rule.order === 'created' ? (result?.id ?? before) : before
        if (!orderId || state.recorded.has(String(orderId))) return result
        if (rule.byResult) {
          if (result?.ok !== true) return result
        } else {
          const after = await fingerprint(ctx, orderId)
          if (after === null || after === print) return result
        }
        const action = typeof rule.action === 'function' ? rule.action(args) : rule.action
        await recordOrderEvent(ctx, orderId, {
          action,
          relatedId: rule.related?.(args, result ?? {}),
          details: await rule.details?.(ctx, args),
          ...(rule.byResult ? { key: `${String(orderId)}:${rule.byResult(args)}` } : {}),
        })
        return result
      })
    },
  }
  Object.defineProperty(wrapped, WRAPPED, { value: name })
  return wrapped
}

/** Wrap a module's order commands; a function already wrapped is kept as it is. */
export function withOrderHistory<T extends Record<string, FnSpec>>(functions: T): T {
  const out: Record<string, FnSpec> = {}
  for (const [name, spec] of Object.entries(functions)) {
    const rule = ORDER_COMMANDS[name]
    out[name] = rule && !(WRAPPED in spec) ? logged(name, spec, rule) : spec
  }
  return out as T
}

export const ORDER_HISTORY_LIMIT = 30

/** The newest events of an order first, with who ran each; at most `ORDER_HISTORY_LIMIT`. */
export async function listOrderEvents(ctx: Ctx, args: Row) {
  if (!(await ours(ctx, 'sale.Order', { id: args.id }))[0]) return []
  const events = (await ours(ctx, 'sale.OrderEvent', { orderId: args.id }))
    .sort(
      (a, b) =>
        String(b.occurredAt).localeCompare(String(a.occurredAt)) || String(b.id).localeCompare(String(a.id)),
    )
    .slice(0, ORDER_HISTORY_LIMIT)
  const names = await userNames(
    ctx,
    events.map((event) => event.actorId),
  )
  return events.map((event) => ({
    id: event.id,
    action: event.action,
    actorId: event.actorId ?? null,
    actorName: event.actorId ? (names.get(String(event.actorId)) ?? '') : '',
    relatedId: event.relatedId ?? null,
    reason: event.reason ?? null,
    details: event.details ?? {},
    occurredAt: event.occurredAt,
  }))
}

export const listOrderEventsHandler = (ctx: Ctx, args: Row) => listOrderEvents(ctx, args)

export const orderHistoryFunctions: Record<string, FnSpec> = {
  listOrderEvents: defineFn({
    input: { id: 'id' },
    effects: ['read:sale.Order', 'read:sale.OrderEvent', 'read:user.User'],
    agent: true,
    handler: listOrderEventsHandler,
  }),
}
