import { deleteFrom, eq, from, inArray, type Ctx, type Row } from '@ketvietlab/ketjs'
import { canonicalDecimalText, compareDecimals } from '../account/money.ts'

/**
 * Purchase approval by amount.
 *
 * The company sets up to two thresholds. An order whose total reaches the first
 * needs a purchasing manager (`manager`); one that reaches the second needs a
 * final approver (`owner`) as well. Confirming decides this on the server from
 * the saved total, so a caller can no longer skip approval by not asking for it.
 * Whoever drafted an order never approves it.
 */
export const APPROVAL_LEVELS = ['manager', 'owner'] as const
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number]

export const configurationEffects = ['read:purchase.Configuration', 'write:purchase.Configuration'] as const
export const approvalEffects = [
  'read:purchase.Configuration',
  'read:purchase.OrderApproval',
  'write:purchase.OrderApproval',
] as const

const company = (ctx: Ctx): string => {
  if (!ctx.scope.company) throw new Error('purchase requires an active company')
  return ctx.scope.company
}
const configurationId = (ctx: Ctx) => `${company(ctx)}:purchase`
const amount = (value: unknown): string | null => (value == null ? null : canonicalDecimalText(value))

export async function purchaseConfiguration(ctx: Ctx): Promise<Row> {
  const id = configurationId(ctx)
  const row = (await ctx.db.select('purchase.Configuration', { id, companyId: company(ctx) }))[0]
  return {
    id,
    approvalAmount: amount(row?.approvalAmount),
    finalApprovalAmount: amount(row?.finalApprovalAmount),
    priceTolerance: amount(row?.priceTolerance),
    revision: Number(row?.revision ?? 0),
  }
}

/** Serialize setting changes on the company's settings row. */
export async function lockPurchaseConfiguration(ctx: Ctx): Promise<Row | null> {
  const id = configurationId(ctx)
  await ctx.db.insertIfAbsent('purchase.Configuration', { id, revision: 0 })
  const config = await purchaseConfiguration(ctx)
  const held = await ctx.db.compareAndSet(
    'purchase.Configuration',
    { id },
    { revision: config.revision },
    { revision: config.revision },
  )
  return 'dryRun' in held || held.matched ? config : null
}

/** How many approval levels an order totalling `total` needs under `config`: 0, 1 or 2. */
export function levelsFor(config: Row, total: unknown): number {
  if (config.finalApprovalAmount != null && compareDecimals(total ?? '0', config.finalApprovalAmount) >= 0)
    return 2
  if (config.approvalAmount != null && compareDecimals(total ?? '0', config.approvalAmount) >= 0) return 1
  return 0
}

/**
 * The levels an order waiting for approval still lacks. An order submitted before
 * thresholds existed recorded no level count; it waits for one approval, as it did.
 */
export function pendingLevels(order: Row, approvals: Row[]): ApprovalLevel[] {
  const required = order.approvalLevels == null ? 1 : Number(order.approvalLevels)
  return APPROVAL_LEVELS.slice(0, required).filter((level) => !approvals.some((row) => row.level === level))
}

/** Whether the caller drafted this order. Orders drafted before the creator was kept have none. */
export const draftedByCaller = (ctx: Ctx, order: Row): boolean =>
  ctx.actor != null && order.createdBy != null && String(order.createdBy) === String(ctx.actor)

export const orderApprovals = (ctx: Ctx, orderId: unknown): Promise<Row[]> =>
  ctx.db.select('purchase.OrderApproval', { orderId })

/** Forget the approvals of a submission that went back to draft. */
export async function clearApprovals(ctx: Ctx, orderId: unknown): Promise<void> {
  const A = ctx.table('purchase.OrderApproval')
  await ctx.db.del(deleteFrom(A).where(eq(A.orderId, String(orderId))))
}

/**
 * What the order page shows about approval: the levels the order needs (or, before
 * it is submitted, would need at its current total), who gave each and what is left.
 */
export async function approvalSummary(ctx: Ctx, order: Row): Promise<Row> {
  const approvals = await orderApprovals(ctx, order.id)
  const approvers = [...new Set(approvals.flatMap((row) => (row.approvedBy ? [String(row.approvedBy)] : [])))]
  const U = ctx.table('user.User')
  const names = new Map(
    approvers.length
      ? (await ctx.db.all(from(U).select(U.id, U.name).where(inArray(U.id, approvers)))).map((row) => [
          String(row.id),
          String(row.name ?? ''),
        ])
      : [],
  )
  const waiting = order.state === 'to approve'
  const required = waiting
    ? order.approvalLevels == null
      ? 1
      : Number(order.approvalLevels)
    : ['draft', 'sent'].includes(String(order.state))
      ? levelsFor(await purchaseConfiguration(ctx), order.amountTotal)
      : Number(order.approvalLevels ?? 0)
  return {
    required,
    given: approvals.map((row) => ({
      level: row.level,
      approvedBy: row.approvedBy ?? null,
      approverName: row.approvedBy ? names.get(String(row.approvedBy)) || null : null,
      approvedAt: row.approvedAt,
    })),
    pending: waiting ? pendingLevels(order, approvals) : [],
    draftedByCaller: draftedByCaller(ctx, order),
  }
}
