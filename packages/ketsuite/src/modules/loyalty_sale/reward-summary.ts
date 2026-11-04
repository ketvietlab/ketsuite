import type { Row, Translator } from '@ketvietlab/ketjs'
import { formatMoney } from '../../ui/format.ts'

// One sentence for what a program gives, shared by the program list and page and by the quotation's
// benefit dialogs, so a seller reads the same words a manager configured.

/** The fields rewardSummary and usageText read, from a program, its rule and its reward. */
export function rewardTerms(
  program: Row,
  rule: Row | undefined,
  reward: Row | undefined,
  productName: string | null,
): Row {
  return {
    programType: program.programType,
    currency: program.currency,
    buyQuantity: rule?.minimumQuantity ?? null,
    maxUsage: program.limitUsage ? program.maxUsage : null,
    reward: reward
      ? {
          rewardType: reward.rewardType,
          discount: reward.discount,
          discountMode: reward.discountMode,
          discountApplicability: reward.discountApplicability,
          discountMaximum: reward.discountMaximum ?? null,
          productName,
          productQuantity: reward.rewardProductQuantity,
          requiredPoints: reward.requiredPoints,
        }
      : null,
  }
}

const quantityText = (_: Translator, value: unknown) =>
  new Intl.NumberFormat(_.locale === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 3 }).format(
    Number(value ?? 0),
  )

/** One line of what a program gives, as the mock writes it: "Giảm 10% trên đơn (tối đa 200.000 ₫)". */
export function rewardSummary(_: Translator, row: Row): string {
  const reward = row.reward as Row | null
  if (!reward) return '—'
  const key = (name: string) => 'loyalty_sale.reward.' + name
  let text: string
  if (reward.rewardType === 'product') {
    const gift = {
      quantity: quantityText(_, reward.productQuantity),
      product: String(reward.productName ?? '—'),
    }
    text =
      row.programType === 'buy_x_get_y' && Number(row.buyQuantity) > 0
        ? _(key('everyGift'), { ...gift, buy: quantityText(_, row.buyQuantity) })
        : _(key('gift'), gift)
  } else {
    const scope = _(
      key(
        reward.discountApplicability === 'cheapest'
          ? 'scopeCheapest'
          : reward.discountApplicability === 'specific'
            ? 'scopeSpecific'
            : 'scopeOrder',
      ),
    )
    text =
      reward.discountMode === 'percent'
        ? _(key('percent'), { value: quantityText(_, reward.discount), scope })
        : _(key('amount'), { value: formatMoney(_, reward.discount, row.currency), scope })
    if (reward.discountMaximum != null && Number(reward.discountMaximum) > 0)
      text = _(key('maximum'), {
        reward: text,
        value: formatMoney(_, reward.discountMaximum, row.currency),
      })
  }
  return row.programType === 'loyalty' && Number(reward.requiredPoints) > 0
    ? _(key('points'), { points: quantityText(_, reward.requiredPoints), reward: text })
    : text
}

/** Used against its limit; coupons against the cards issued. */
export function usageText(row: Row): string {
  const uses = Number(row.uses ?? 0)
  if (row.maxUsage != null) return `${uses}/${Number(row.maxUsage)}`
  return ['coupons', 'next_order_coupons'].includes(String(row.programType))
    ? `${uses}/${Number(row.cards ?? 0)}`
    : String(uses)
}
