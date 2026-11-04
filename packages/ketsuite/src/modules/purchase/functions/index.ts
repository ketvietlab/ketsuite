import type { FnSpec } from '@ketvietlab/ketjs'
import { suppliersFunctions } from './suppliers.ts'
import { queriesFunctions } from './queries.ts'
import { ordersFunctions } from './orders.ts'
import { lineGridFunctions } from './line-grid.ts'
import { linesFunctions } from './lines.ts'
import { lifecycleFunctions } from './lifecycle.ts'
import { receiptsFunctions } from './receipts.ts'
import { billsFunctions } from './bills.ts'
import { productSuppliersFunctions } from './product-suppliers.ts'

export function assemblePurchaseFunctions(groups: Record<string, FnSpec>[]): Record<string, FnSpec> {
  const functions: Record<string, FnSpec> = {}
  for (const group of groups) {
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(functions, key)) throw new Error(`Duplicate purchase function: ${key}`)
      functions[key] = spec
    }
  }
  return functions
}
export const functions = assemblePurchaseFunctions([
  suppliersFunctions,
  queriesFunctions,
  ordersFunctions,
  linesFunctions,
  lineGridFunctions,
  lifecycleFunctions,
  receiptsFunctions,
  billsFunctions,
  productSuppliersFunctions,
])
