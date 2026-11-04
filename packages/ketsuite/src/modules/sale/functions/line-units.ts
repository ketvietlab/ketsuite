import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { sellableProduct } from '../../product/sellable.ts'
import { VARIANT_PRICE_EFFECTS } from '../../product/variant-price.ts'

const fold = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')

export async function listLineUnitsHandler(ctx: Ctx, args: Row) {
  const found = await sellableProduct(ctx, args.productId, undefined, { allowCombo: true })
  if (!found.ok) return []
  const search = fold(args.search)
  const units = found.value.uoms.filter((unit) => fold(unit.name).includes(search))
  units.sort(
    (a, b) =>
      Number(b.id === found.value.template.uomId) - Number(a.id === found.value.template.uomId) ||
      a.name.localeCompare(b.name),
  )
  return units
    .slice(0, Math.max(1, Math.min(200, Number(args.limit) || 50)))
    .map(({ id, name }) => ({ id, name }))
}

export const lineUnitsFunctions = {
  listLineUnits: defineFn({
    input: { productId: 'id', search: 'text?', limit: 'int?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:uom.Unit',
      ...VARIANT_PRICE_EFFECTS,
    ],
    agent: true,
    handler: listLineUnitsHandler,
  }),
}
