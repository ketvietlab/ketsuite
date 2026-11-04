import { claimSaleProgramNamespace } from './programs.ts'
import { InventoryRefused } from '../stock/inventory-validation.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { confirm, SaleRefused } from '../sale/functions/shared.ts'
import { cancelOrder } from '../sale/cancel-order.ts'
import { ours } from '../sale/scope.ts'
import { finalizeOrderLoyalty, reverseOrderLoyalty } from '../loyalty/order-functions.ts'
import { invalid, issue, n, evaluate, snapshotOf, normalizeCode } from '../loyalty/engine.ts'
import { saleSnapshot, decimal } from './functions/shared.ts'

/** Every refusal aborts the outer transaction, including after stock writes. */
export async function loyaltyTransaction(ctx: Ctx, body: (tx: Ctx) => Promise<Row>): Promise<Row> {
  try {
    return await ctx.tx(async (tx) => {
      const result = await body(tx)
      if (result.ok !== true) throw new SaleRefused(result)
      return result
    })
  } catch (error) {
    if (error instanceof SaleRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}

export function confirmSaleWithLoyalty(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const confirmed = await confirm(tx, args.id, args.expectedRevision, { inTransaction: true })
    if (confirmed.ok !== true) return confirmed
    const held = (await ours(tx, 'sale.Order', { id: args.id }))[0]
    if (held?.loyaltyState === 'finalized') return confirmed
    const order = await saleSnapshot(tx, String(args.id))
    if (!order) return invalid(issue('id', 'loyalty.error.order'))
    const applicationsBefore = await tx.db.select('loyalty.Application', {
      orderType: 'sale',
      orderId: args.id,
    })
    // Serialize managed configuration/usage changes with the programs this quote uses.
    for (const programId of [
      ...new Set(applicationsBefore.filter((row) => row.rewardId).map((row) => String(row.programId))),
    ].sort()) {
      const program = (await tx.db.select('loyalty.Program', { id: programId }))[0]
      if (!program?.active) return invalid(issue('programId', 'loyalty.error.ineligible'))
      const locked = await tx.db.compareAndSet(
        'loyalty.Program',
        { id: programId },
        { active: program.active, configVersion: program.configVersion ?? null },
        { configVersion: program.configVersion ?? null },
      )
      if (!('dryRun' in locked) && !locked.matched)
        return invalid(issue('programId', 'loyalty.error.concurrent'))
    }
    const snapshot = snapshotOf({
      ...order,
      codes: applicationsBefore.map((row) => normalizeCode(row.code)).filter(Boolean),
    })
    if (!snapshot) return invalid(issue('id', 'loyalty.error.order'))
    const currentPrograms = await evaluate(tx, snapshot, {
      requestedPointsByProgram: Object.fromEntries(
        applicationsBefore.map((row) => [String(row.programId), n(row.pointsSpent)]),
      ),
    })
    const nativeAutomatic = (await ours(tx, 'loyalty.Program')).filter(
      (program) =>
        program.salePolicyVersion === 1 && ['promotion', 'buy_x_get_y'].includes(String(program.programType)),
    )
    for (const current of currentPrograms) {
      const application = applicationsBefore.find((row) => row.programId === current.programId)
      if (
        nativeAutomatic.some((program) => program.id === current.programId) &&
        !application?.rewardId &&
        application?.state !== 'dismissed' &&
        current.rewards.some((reward) => reward.rewardType === 'product' || Number(reward.discountAmount) > 0)
      )
        return invalid(issue('programId', 'loyalty.error.ineligible'))
    }
    for (const application of applicationsBefore.filter((row) => row.rewardId && row.state !== 'finalized')) {
      const current = currentPrograms
        .find((program) => program.programId === application.programId)
        ?.rewards.find((reward) => reward.rewardId === application.rewardId)
      const payload = application.rewardPayload as Row | null
      if (
        !current ||
        current.discountAmount !== application.discountAmount ||
        current.requiredPoints !== n(application.pointsSpent) ||
        (payload?.productQuantity != null && current.productQuantity !== n(payload.productQuantity))
      )
        return invalid(issue('programId', 'loyalty.error.ineligible'))
    }
    const loyalty = await finalizeOrderLoyalty(
      tx,
      { order },
      { inTransaction: true, postingKey: `${String(args.id)}:confirmation:${String(held?.revision)}` },
    )
    if (loyalty.ok !== true) return loyalty
    const applications = loyalty.applications as Row[]
    await tx.db.update(
      'sale.Order',
      { id: args.id },
      {
        loyaltyState: 'finalized',
        loyaltyPointsEarned: decimal(applications.reduce((sum, row) => sum + n(row.pointsEarned), 0)),
        loyaltyPointsSpent: decimal(applications.reduce((sum, row) => sum + n(row.pointsSpent), 0)),
      },
    )
    return { ...confirmed, loyalty }
  })
}

export function cancelSaleWithLoyalty(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const cancelled = await cancelOrder(tx, args, { inTransaction: true })
    if (cancelled.ok !== true) return cancelled
    const held = (await ours(tx, 'sale.Order', { id: args.id }))[0]
    if (held?.loyaltyState === 'reversed') return cancelled
    const loyalty = await reverseOrderLoyalty(
      tx,
      { orderType: 'sale', orderId: args.id },
      { inTransaction: true },
    )
    if (loyalty.ok !== true) return loyalty
    for (const reservation of await tx.db.select('loyalty.Reservation', {
      orderType: 'sale',
      orderId: args.id,
    }))
      if (reservation.state === 'finalized')
        await tx.db.update('loyalty.Reservation', { id: reservation.id }, { state: 'released' })
    await tx.db.update('sale.Order', { id: args.id }, { loyaltyState: 'reversed' })
    return { ...cancelled, loyalty }
  })
}
