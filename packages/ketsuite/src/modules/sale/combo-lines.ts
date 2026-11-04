import type { Ctx, Row } from '@ketvietlab/ketjs'
import { exactDecimal, minorText, moneyMinor, scaleOf } from '../account/money.ts'
import { comboItems, lockCombos } from '../product/combo-policy.ts'
import { templateComboIds } from '../product/template-combos.ts'
import { sellableProduct } from '../product/sellable.ts'
import { company } from './scope.ts'
import { invalid, SaleRefused } from './functions/shared.ts'

export const COMBO_LINE_EFFECTS = [
  'read:product.Combo',
  'write:product.Combo',
  'read:product.ComboItem',
  'read:product.TemplateCombo',
]

/** Allocate in currency minor units; the last choice receives the exact remainder. */
export function comboShares(price: string, bases: string[], extras: string[], currency: unknown): string[] {
  if (!bases.length || bases.length !== extras.length) throw new RangeError('combo choices are required')
  const scale = scaleOf(currency)
  const weights = bases.map(exactDecimal)
  const weightScale = Math.max(...weights.map((value) => value.scale))
  const integers = weights.map((value) => value.coefficient * 10n ** BigInt(weightScale - value.scale))
  if (integers.some((value) => value < 0n)) throw new RangeError('combo item prices cannot be negative')
  const total = integers.reduce((sum, value) => sum + value, 0n)
  const amount = moneyMinor(price, scale)
  if (amount < 0n) throw new RangeError('combo price cannot be negative')
  let left = amount
  return integers.map((weight, index) => {
    const share =
      index === integers.length - 1
        ? left
        : total
          ? (amount * weight) / total
          : amount / BigInt(integers.length)
    left -= share
    return minorText(share + moneyMinor(extras[index], scale), scale)
  })
}

/** Choices are resolved server-side; clients can only select an offered SKU for a known child. */
export async function planComboItems(
  ctx: Ctx,
  template: Row,
  parent: Row,
  price: string,
  currency: unknown,
  selections: Row[] = [],
): Promise<Row[]> {
  const ids = await templateComboIds(ctx, template.id)
  const choices = await lockCombos(ctx, ids)
  if (
    ids.length < 1 ||
    ids.length > 10 ||
    ids.some((id) => !choices.some((choice) => choice.id === id && choice.active !== false))
  )
    throw new SaleRefused(invalid('productId', 'sale.error.comboUnavailable'))
  const planned: Row[] = []
  const bases: string[] = [],
    extras: string[] = []
  for (const choiceId of ids) {
    const items = await comboItems(ctx, choiceId)
    const selected = selections.find((row) => row.comboChoiceId === choiceId)
    const item = selected ? items.find((row) => row.productId === selected.productId) : items[0]
    if (!item) throw new SaleRefused(invalid('productId', 'sale.error.comboItemUnavailable'))
    const sellable = await sellableProduct(ctx, item.productId)
    if (!sellable.ok) throw new SaleRefused(invalid('productId', 'sale.error.comboItemUnavailable'))
    bases.push(sellable.value.listPrice)
    extras.push(String(item.extraPrice ?? '0'))
    planned.push({
      id: JSON.stringify([company(ctx), 'sale-combo-item', String(parent.id), choiceId]),
      orderId: parent.orderId,
      productId: item.productId,
      productUomId: sellable.value.template.uomId,
      productUomQty: parent.productUomQty,
      discount: parent.discount ?? '0',
      taxIds: parent.taxIds ?? (parent.taxId ? [parent.taxId] : []),
      sequence: Number(parent.sequence ?? 10) + planned.length + 1,
      comboParentId: parent.id,
      comboChoiceId: choiceId,
    })
  }
  const shares = comboShares(price, bases, extras, currency)
  return planned.map((line, index) => ({ ...line, priceUnit: shares[index] }))
}
