import type { FnSpec } from '@ketvietlab/ketjs'
import { productAccountsFunctions } from './product-accounts.ts'
import { taxesFunctions } from './taxes.ts'
import { setupFunctions } from './setup.ts'
import { chartFunctions } from './chart.ts'
import { accountMappingFunctions } from './account-mapping.ts'
import { paymentTermsFunctions } from './payment-terms.ts'
import { movesFunctions } from './moves.ts'
import { invoicesFunctions } from './invoices.ts'
import { postingFunctions } from './posting.ts'
import { paymentsFunctions } from './payments.ts'
import { reportsFunctions } from './reports.ts'
export function assembleAccountFunctions(groups: readonly Record<string, FnSpec>[]): Record<string, FnSpec> {
  const functions: Record<string, FnSpec> = {}
  for (const group of groups)
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(functions, key)) throw new Error('Duplicate account function: ' + key)
      functions[key] = spec
    }
  return functions
}

export const functions = assembleAccountFunctions([
  productAccountsFunctions,
  taxesFunctions,
  setupFunctions,
  chartFunctions,
  accountMappingFunctions,
  paymentTermsFunctions,
  movesFunctions,
  invoicesFunctions,
  postingFunctions,
  paymentsFunctions,
  reportsFunctions,
])
export { reconcileFunction, registerPaymentFunction } from './payments.ts'
