import type { Ctx, Row } from '@ketvietlab/ketjs'
import { evaluate, invalid, issue, normalizeCode, snapshotOf } from '../loyalty/engine.ts'
import { ours } from '../sale/scope.ts'

const refused = (code: string, params: Row = {}) =>
  invalid(issue('code', 'loyalty_sale.error.' + code, params))

/** Explain native Sales eligibility before changing any application or reservation. */
export async function validateSaleCode(ctx: Ctx, order: Row, raw: unknown) {
  const code = normalizeCode(raw)
  if (!code) return refused('codeRequired')
  const rules = await ours(ctx, 'loyalty.Rule', { normalizedCode: code })
  const wallets = await ours(ctx, 'loyalty.Wallet', { normalizedCode: code })
  const rule = rules.find((row) => row.active) ?? rules[0]
  const wallet = wallets.find((row) => row.active) ?? wallets[0]
  const programId = rule?.programId ?? wallet?.programId
  if (!programId) return refused('codeNotFound')
  const program = (await ours(ctx, 'loyalty.Program', { id: programId }))[0]
  if (!program) return refused('codeNotFound')
  if (program.salePolicyVersion !== 1) return { ok: true, programId }
  if (!program.active || (rule && !rule.active)) return refused('codeInactive')
  if (wallet?.partnerId && wallet.partnerId !== order.partnerId) return refused('codeCustomer')
  if (wallet && !wallet.active) return refused(Number(wallet.balance) === 0 ? 'codeUsed' : 'codeInactive')
  const prior = (
    await ours(ctx, 'loyalty.Application', { orderType: 'sale', orderId: order.orderId, programId })
  )[0]
  if (prior?.rewardId && normalizeCode(prior.code) === code) return refused('codeApplied')
  const snapshot = snapshotOf({ ...order, codes: [code] })
  if (!snapshot) return invalid(issue('orderId', 'loyalty.error.order'))
  const trace: Row[] = []
  const eligible = (await evaluate(ctx, snapshot, { onlyProgramId: String(programId), trace }))[0]
  if (eligible?.rewards.length) return { ok: true, programId }
  for (const [reason, message] of [
    ['schedule', 'codeDate'],
    ['expired', 'codeExpired'],
    ['pricelist', 'codePricelist'],
    ['usage', 'codeUsage'],
    ['currency', 'codeCurrency'],
    ['channel', 'codeChannel'],
  ])
    if (trace.some((row) => row.code === reason)) return refused(message!)
  const failed = trace.find((row) => row.code === 'ruleFailed')
  if (failed && Number(failed.quantity) < Number(failed.minimumQuantity))
    return refused('codeQuantity', { quantity: String(failed.minimumQuantity) })
  if (failed && Number(failed.minimumAmount) > 0)
    return refused('codeAmount', { amount: String(failed.minimumAmount), currency: String(order.currency) })
  if (failed) return refused('codeProducts')
  const points = trace.find((row) => row.code === 'points')
  const reward = trace.find((row) => row.code === 'rewardUnavailable')
  if (points && reward && Number(points.available) < Number(reward.requiredPoints))
    return refused('codePoints', { points: String(reward.requiredPoints) })
  return refused('codeNothing')
}
