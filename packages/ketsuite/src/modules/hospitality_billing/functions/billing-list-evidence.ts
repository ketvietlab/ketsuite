import { eq, from, inArray, ne } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../../account/money.ts'
import { chargeRuleConfigured } from './accounting.ts'
import { folioBalances } from './folio-balances.ts'

/** Resolve one page together: never turn missing or reversed invoice evidence into a paid bill. */
export async function enrichBillingRows(ctx: Ctx, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows
  const B = ctx.table('hospitality_billing.FolioBill')
  const M = ctx.table('account.Move')
  const C = ctx.table('hospitality_core.Charge')
  const R = ctx.table('hospitality_billing.ChargeRule')
  const ids = rows.map((row) => row.id)
  const [bills, chargeGroups, balances] = await Promise.all([
    ctx.db.all(from(B).where(eq(B.companyId!, ctx.scope.company), inArray(B.folioId, ids)).limit(100)),
    ctx.db.group(
      from(C)
        .where(
          eq(C.companyId!, ctx.scope.company),
          inArray(C.folioId, ids),
          eq(C.state, 'active'),
          ne(C.amount, '0'),
        )
        .groupBy({ col: C.folioId }, { col: C.type }),
    ),
    folioBalances(ctx, rows),
  ])
  const types = [...new Set(chargeGroups.map((group) => String(group.key[1])))].sort()
  const [moves, rules] = await Promise.all([
    bills.length
      ? ctx.db.all(
          from(M)
            .where(
              eq(M.companyId!, ctx.scope.company),
              inArray(
                M.id,
                bills.map((bill) => bill.moveId),
              ),
            )
            .limit(100),
        )
      : [],
    types.length
      ? ctx.db.all(from(R).where(eq(R.companyId!, ctx.scope.company), inArray(R.chargeType, types)))
      : [],
  ])
  const configured = new Set(rules.filter(chargeRuleConfigured).map((rule) => String(rule.chargeType)))
  const missing = new Map<string, string[]>()
  const charged = new Set(chargeGroups.map((group) => String(group.key[0])))
  for (const group of chargeGroups) {
    const [folio, type] = group.key.map(String)
    if (!configured.has(type!)) missing.set(folio!, [...(missing.get(folio!) ?? []), type!].sort())
  }
  const byFolio = new Map(bills.map((bill) => [bill.folioId, bill]))
  const byMove = new Map(moves.map((move) => [move.id, move]))
  return rows.map((row) => {
    const bill = byFolio.get(row.id)
    const move = bill ? byMove.get(bill.moveId) : null
    const balance = balances.get(String(row.id))!
    // A posted invoice keeps its tax snapshot even if today's charge rule is removed.
    const missingRules = bill ? [] : (missing.get(String(row.id)) ?? [])
    const billingState = !balance.balanceKnown
      ? 'unverified'
      : missingRules.length
        ? 'missing-rule'
        : !bill
          ? 'uninvoiced'
          : compareDecimals(balance.due, '0') > 0
            ? 'owing'
            : 'paid'
    const nextAction =
      billingState === 'missing-rule'
        ? 'rule'
        : billingState === 'uninvoiced' && row.state === 'closed' && charged.has(String(row.id))
          ? 'invoice'
          : billingState === 'owing'
            ? 'payment'
            : 'view'
    const recordPath = `/admin/hospitality/folios/${encodeURIComponent(String(row.id))}`
    const nextHref =
      nextAction === 'rule'
        ? `/admin/hospitality/billing?record=${encodeURIComponent(`hospitality.billingRule:${missingRules[0]}`)}`
        : nextAction === 'invoice' || nextAction === 'payment'
          ? `${recordPath}?dialog=${nextAction}`
          : recordPath
    return {
      ...row,
      invoice: move
        ? { id: move.id, name: move.name, state: move.state, reversed: Boolean(move.reversedById) }
        : null,
      invoiceTotal: move?.amountTotal ?? null,
      amountDue: balance.balanceKnown ? balance.due : null,
      paid: balance.paid,
      balanceKnown: balance.balanceKnown,
      paymentState: balance.balanceKnown ? (move?.paymentState ?? null) : null,
      billingState,
      missingRules,
      nextAction,
      nextHref,
    }
  })
}
