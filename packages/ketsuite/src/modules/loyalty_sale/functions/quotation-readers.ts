import { defineFn, type Ctx, type Row } from '@ketvietlab/ketjs'
import { evaluate, normalizeCode, snapshotOf } from '../../loyalty/engine.ts'
import { orderFunctions } from '../../loyalty/order-functions.ts'
import { civilDateAt, DEFAULT_ACCOUNTING_TIMEZONE } from '../../account/date.ts'
import { ours } from '../../sale/scope.ts'
import { saleSnapshot, snapshotEffects, effectsOf } from './shared.ts'
import { rewardTerms } from '../reward-summary.ts'

/** Read-only quotation projection: never issue a card merely by opening a record. */
export async function getQuotationBenefits(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
  if (!order) return null
  const programs = (await ours(ctx, 'loyalty.Program')).filter((row) => row.salePolicyVersion === 1)
  const byProgram = new Map(programs.map((row) => [String(row.id), row]))
  const applications = (
    await ours(ctx, 'loyalty.Application', { orderType: 'sale', orderId: args.orderId })
  ).filter((row) => byProgram.has(String(row.programId)))
  const codes = applications.map((row) => normalizeCode(row.code)).filter(Boolean)
  const snapshot = snapshotOf({ ...(await saleSnapshot(ctx, String(args.orderId))), codes })
  if (!snapshot) return null
  const available = (await evaluate(ctx, snapshot)).filter((row) => byProgram.has(row.programId))
  const rewards = new Map((await ours(ctx, 'loyalty.Reward')).map((row) => [String(row.id), row]))
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const timezone = company?.accountingTimezone ?? DEFAULT_ACCOUNTING_TIMEZONE
  const day = civilDateAt(snapshot.date, timezone)
  const wallets = order.partnerId ? await ours(ctx, 'loyalty.Wallet', { partnerId: order.partnerId }) : []
  for (const app of applications)
    if (app.walletId && !wallets.some((row) => row.id === app.walletId)) {
      const wallet = (await ours(ctx, 'loyalty.Wallet', { id: app.walletId }))[0]
      if (wallet && (!wallet.partnerId || wallet.partnerId === order.partnerId)) wallets.push(wallet)
    }
  const relatedWallets = new Set(
    [...applications.map((row) => row.walletId), ...available.map((row) => row.walletId)].filter(Boolean),
  )
  const relatedCards = wallets.filter(
    (wallet) =>
      byProgram.has(String(wallet.programId)) &&
      (byProgram.get(String(wallet.programId))!.programType === 'loyalty' ||
        relatedWallets.has(wallet.id) ||
        String(wallet.id).startsWith(`coupon:sale:${String(order.id)}:`)),
  )
  const ledger = (
    await Promise.all(
      relatedCards
        .filter(
          (wallet) => !wallet.active && byProgram.get(String(wallet.programId))!.programType !== 'loyalty',
        )
        .map((wallet) => ours(ctx, 'loyalty.LedgerEntry', { walletId: wallet.id })),
    )
  ).flat()
  const entries = new Map(ledger.map((row) => [String(row.id), row]))
  const cancelled = new Set(
    ledger
      .filter(
        (row) =>
          row.operation === 'reverse' && entries.get(String(row.reversedEntryId))?.operation === 'earn',
      )
      .map((row) => row.walletId),
  )
  const cards = relatedCards.map((wallet) => {
    const expiresOn =
      wallet.saleExpiresOn ?? (wallet.expiresAt ? civilDateAt(wallet.expiresAt, timezone) : null)
    return {
      id: wallet.id,
      programId: wallet.programId,
      name: byProgram.get(String(wallet.programId))!.name,
      type: byProgram.get(String(wallet.programId))!.programType,
      code: wallet.code,
      balance: wallet.balance,
      reserved: wallet.reserved,
      available: Math.max(0, Number(wallet.balance) - Number(wallet.reserved)),
      expiresOn,
      state: !wallet.active
        ? cancelled.has(wallet.id)
          ? 'cancelled'
          : byProgram.get(String(wallet.programId))!.programType !== 'loyalty' && Number(wallet.balance) === 0
            ? 'used'
            : 'inactive'
        : expiresOn && String(expiresOn) < day
          ? 'expired'
          : 'active',
    }
  })
  const rewardIds = new Set([
    ...available.flatMap((program) => program.rewards.map((reward) => String(reward.rewardId))),
    ...applications.filter((row) => row.rewardId).map((row) => String(row.rewardId)),
  ])
  // What each offered or taken reward gives, for the dialogs to say it as the program list does.
  const terms: Record<string, Row> = {}
  for (const id of rewardIds) {
    const reward = rewards.get(id)
    const program = reward && byProgram.get(String(reward.programId))
    if (!reward || !program) continue
    const rule = (await ours(ctx, 'loyalty.Rule', { programId: program.id }))[0]
    const product = reward.rewardProductId
      ? (await ctx.db.select('product.Product', { id: reward.rewardProductId }))[0]
      : undefined
    const template = product
      ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
      : undefined
    terms[id] = rewardTerms(program, rule, reward, template ? String(template.name) : null)
  }
  return {
    orderId: order.id,
    revision: order.revision,
    currency: order.currency,
    pointsEarned: ['draft', 'sent'].includes(String(order.state))
      ? available.filter((row) => row.programType === 'loyalty').reduce((sum, row) => sum + row.points, 0)
      : applications
          .filter((row) => byProgram.get(String(row.programId))?.programType === 'loyalty')
          .reduce((sum, row) => sum + Number(row.pointsEarned ?? 0), 0),
    pointsSpent: applications
      .filter((row) => byProgram.get(String(row.programId))?.programType === 'loyalty')
      .reduce((sum, row) => sum + Number(row.pointsSpent ?? 0), 0),
    available: available.map((program) => ({
      ...program,
      appliedRewardId: applications.find((row) => row.programId === program.programId)?.rewardId ?? null,
    })),
    applied: applications
      .filter((row) => row.rewardId)
      .map((app) => ({
        id: app.id,
        programId: app.programId,
        name: byProgram.get(String(app.programId))!.name,
        type: byProgram.get(String(app.programId))!.programType,
        rewardId: app.rewardId,
        description:
          (app.rewardPayload as Row | null)?.description ?? rewards.get(String(app.rewardId))?.description,
        code: app.code,
        state: app.state,
        pointsEarned: app.pointsEarned,
        pointsSpent: app.pointsSpent,
        discountAmount: app.discountAmount,
        walletCode: cards.find((row) => row.id === app.walletId)?.code ?? null,
      })),
    cards,
    rewardTerms: terms,
  }
}

export const quotationReaderFunctions = {
  getQuotationBenefits: defineFn({
    input: { orderId: 'id' },
    effects: [
      ...snapshotEffects,
      ...effectsOf(orderFunctions.evaluateOrder),
      'read:loyalty.LedgerEntry',
      // A reward's terms read its rule and the gift's product name.
      'read:loyalty.Rule',
      'read:product.Product',
      'read:product.Template',
    ],
    agent: true,
    handler: getQuotationBenefits,
  }),
}
