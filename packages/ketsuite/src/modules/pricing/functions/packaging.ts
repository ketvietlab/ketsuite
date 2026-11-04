import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { PACKAGING_EFFECTS, pricingPackaging } from '../packaging.ts'

export async function listRuleUnitsHandler(ctx: Ctx, args: Row) {
  const { units } = await pricingPackaging(ctx, {
    ...args,
    ...(args.targetId
      ? args.appliedOn === '0_product_variant'
        ? { productId: args.targetId }
        : { templateId: args.targetId }
      : {}),
  })
  const search = String(args.search ?? '').toLocaleLowerCase()
  return units
    .filter((unit) => String(unit.name).toLocaleLowerCase().includes(search))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, Math.min(100, Math.max(1, Number(args.limit ?? 50))))
    .map((unit) => ({ id: unit.id, name: unit.name }))
}

export const packagingFunctions = {
  listRuleUnits: defineFn({
    input: {
      targetId: 'id?',
      appliedOn: 'text',
      productId: 'id?',
      templateId: 'id?',
      search: 'text?',
      limit: 'int?',
    },
    effects: ['read:product.Product', 'read:product.Template', ...PACKAGING_EFFECTS],
    agent: true,
    handler: listRuleUnitsHandler,
  }),
}
