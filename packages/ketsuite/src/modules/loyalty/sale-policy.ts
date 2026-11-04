import type { Row } from '@ketvietlab/ketjs'
import { exactDecimal, moneyMinor, roundedQuotient, scaleOf } from '../account/money.ts'
import type { OrderSnapshot } from './types.ts'

/** Sales rewards share these untaxed bases between eligibility and tax-group materialization. */
export function saleRewardBases(snapshot: OrderSnapshot, reward: Row, products: ReadonlySet<string>) {
  const scale = scaleOf(snapshot.currency)
  const candidates = snapshot.lines
    .filter((line) => line.lineKind === 'product' && !line.comboParent && line.quantity > 0)
    .map((line) => ({ line, base: moneyMinor(line.untaxed, scale) }))
    .filter((row) => row.base > 0n)
    .sort((a, b) => a.line.id.localeCompare(b.line.id))
  const order = snapshot.saleProgramOrder ?? []
  const rank = order.indexOf(String(reward.programId))
  const reductions = new Map<string, bigint>()
  for (const line of snapshot.lines) {
    if (line.lineKind !== 'discount' || line.loyaltyProgramId === reward.programId) continue
    if (line.loyaltyProgramId && order.indexOf(line.loyaltyProgramId) >= rank && rank >= 0) continue
    const amount = moneyMinor(line.untaxed, scale)
    if (amount < 0n) reductions.set(line.taxKey ?? '[]', (reductions.get(line.taxKey ?? '[]') ?? 0n) - amount)
  }
  const net = new Map<string, bigint>()
  for (const key of new Set(candidates.map((row) => row.line.taxKey ?? '[]'))) {
    const group = candidates.filter((row) => (row.line.taxKey ?? '[]') === key)
    const total = group.reduce((sum, row) => sum + row.base, 0n)
    const deduction = reductions.get(key) ?? 0n
    const remaining = deduction >= total ? 0n : total - deduction
    let cumulative = 0n,
      allocated = 0n
    for (const row of group) {
      cumulative += row.base
      const target = (cumulative * remaining) / total
      net.set(row.line.id, target - allocated)
      allocated = target
    }
  }
  let rows = snapshot.lines
    .filter((line) => line.lineKind === 'product' && !line.comboParent && line.quantity > 0)
    .filter(
      (line) =>
        reward.discountApplicability !== 'specific' ||
        (line.productId != null && products.has(line.productId)),
    )
    .map((line) => {
      let base = net.get(line.id) ?? 0n
      if (reward.discountApplicability === 'cheapest') {
        const quantity = exactDecimal(String(line.quantity))
        base = roundedQuotient(base * 10n ** BigInt(quantity.scale), quantity.coefficient)
      }
      return { id: line.id, base }
    })
    .filter((row) => row.base > 0n)
  if (reward.discountApplicability === 'cheapest')
    rows = rows
      .sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : a.id.localeCompare(b.id)))
      .slice(0, 1)
  return rows
}
