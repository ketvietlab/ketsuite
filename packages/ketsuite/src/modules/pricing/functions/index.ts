import { packagingFunctions } from './packaging.ts'
import { linePriceFunctions } from './line-price.ts'
import type { FnSpec } from '@ketvietlab/ketjs'
import { listPricelistsFunctions } from './lists.ts'
import { listPricelistItemsFunctions } from './items.ts'
import { savePricelistFunctions } from './save-list.ts'
import { savePricelistItemFunctions } from './save-item.ts'
import { priceForFunctions } from './base-price.ts'
export { APPLIED_ON, COMPUTE_PRICE, PRICE_BASES } from '../validation.ts'

export function assemblePricingFunctions(groups: readonly Record<string, FnSpec>[]): Record<string, FnSpec> {
  const functions: Record<string, FnSpec> = {}
  for (const group of groups)
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(functions, key)) throw new Error(`Duplicate pricing function: ${key}`)
      functions[key] = spec
    }
  return functions
}
export const functions = assemblePricingFunctions([
  linePriceFunctions,
  packagingFunctions,
  listPricelistsFunctions,
  listPricelistItemsFunctions,
  savePricelistFunctions,
  savePricelistItemFunctions,
  priceForFunctions,
])
