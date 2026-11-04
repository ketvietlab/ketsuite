import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../../account/money.ts'
import { configurationEffects, lockPurchaseConfiguration, purchaseConfiguration } from '../approval.ts'

const issue = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `purchase.error.configuration.${code}` }],
})

/** A threshold: empty, or an amount above zero with at most two decimals. */
const threshold = (value: unknown): string | null | undefined => {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) return undefined
  return String(raw.replace(/^0+(?=\d)/, ''))
}

/** A price tolerance: empty, or a percentage from 0 to 100 with at most two decimals. */
const tolerance = (value: unknown): string | null | undefined => {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw) || Number(raw) > 100) return undefined
  return String(raw.replace(/^0+(?=\d)/, ''))
}

/**
 * Saves the company's approval thresholds and vendor bill price tolerance. A setting
 * the caller leaves out keeps its value. The final threshold needs the first and must
 * exceed it. Orders already waiting for approval keep the levels they were submitted
 * with; a tolerance applies to bills posted from then on.
 */
export async function saveConfigurationHandler(ctx: Ctx, args: Row) {
  return ctx.tx(async (tx) => {
    const config = await lockPurchaseConfiguration(tx)
    if (!config || Number(config.revision) !== Number(args.expectedRevision))
      return {
        ok: false,
        errors: [{ field: 'expectedRevision', code: 'purchase.error.configurationChanged' }],
      }
    const approvalAmount =
      args.approvalAmount === undefined ? config.approvalAmount : threshold(args.approvalAmount)
    if (approvalAmount === undefined) return issue('approvalAmount', 'amount')
    const finalApprovalAmount =
      args.finalApprovalAmount === undefined
        ? config.finalApprovalAmount
        : threshold(args.finalApprovalAmount)
    if (finalApprovalAmount === undefined) return issue('finalApprovalAmount', 'amount')
    if (
      finalApprovalAmount != null &&
      (approvalAmount == null || compareDecimals(finalApprovalAmount, approvalAmount) <= 0)
    )
      return issue('finalApprovalAmount', 'finalAmount')
    const priceTolerance =
      args.priceTolerance === undefined ? config.priceTolerance : tolerance(args.priceTolerance)
    if (priceTolerance === undefined) return issue('priceTolerance', 'tolerance')
    const same = (left: unknown, right: unknown) =>
      left == null || right == null ? (left == null) === (right == null) : compareDecimals(left, right) === 0
    if (
      same(approvalAmount, config.approvalAmount) &&
      same(finalApprovalAmount, config.finalApprovalAmount) &&
      same(priceTolerance, config.priceTolerance)
    )
      return { ok: true, ...config }
    const revision = Number(config.revision) + 1
    await tx.db.update(
      'purchase.Configuration',
      { id: config.id },
      { approvalAmount, finalApprovalAmount, priceTolerance, revision },
    )
    return { ok: true, id: config.id, approvalAmount, finalApprovalAmount, priceTolerance, revision }
  })
}

export const getConfigurationHandler = (ctx: Ctx) => purchaseConfiguration(ctx)

export const configurationFunctions: Record<string, FnSpec> = {
  getConfiguration: defineFn({
    input: {},
    effects: ['read:purchase.Configuration'],
    agent: true,
    handler: getConfigurationHandler,
  }),
  saveConfiguration: defineFn({
    input: {
      approvalAmount: 'text?',
      finalApprovalAmount: 'text?',
      priceTolerance: 'text?',
      expectedRevision: 'int',
    },
    effects: [...configurationEffects],
    agent: true,
    idempotent: true,
    handler: saveConfigurationHandler,
  }),
}
