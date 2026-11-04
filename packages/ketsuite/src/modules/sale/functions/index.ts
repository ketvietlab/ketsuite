import { warningFunctions } from './warnings.ts'
import { customerFunctions } from './customers.ts'
import { tagFunctions } from './tags.ts'
import { teamFunctions } from './teams.ts'
import { filterFunctions } from './filters.ts'
import { analysisFunctions } from './analysis.ts'
import { depositsFunctions } from './deposits.ts'
import { copyFunctions } from './copy.ts'
import { discountFunctions } from './discounts.ts'
import { variantMatrixFunctions } from './variant-matrix.ts'
import { catalogueDraftFunctions } from './catalogue-draft.ts'
import { catalogueQuantityFunctions } from './catalogue-quantity.ts'
import { catalogueFunctions } from './catalogue.ts'
import { linePricingFunctions } from './line-pricing.ts'
import { sectionFunctions } from './sections.ts'
import { configurationFunctions } from './configuration.ts'
import { deliveryPromiseFunctions } from './delivery-promise.ts'
import { lineCostsFunctions } from './line-costs.ts'
import { lineGridFunctions } from './line-grid.ts'
import { lineUnitsFunctions } from './line-units.ts'
import type { FnSpec } from '@ketvietlab/ketjs'
import { policiesFunctions } from './policies.ts'
import { queriesFunctions } from './queries.ts'
import { ordersFunctions } from './orders.ts'
import { linesFunctions } from './lines.ts'
import { deliveriesFunctions } from './deliveries.ts'
import { invoicesFunctions } from './invoices.ts'
import { orderHistoryFunctions } from '../order-history.ts'

export { SALE_STATES, SALE_INVOICE_STATUSES, INVOICE_POLICIES } from './shared.ts'

export function assembleSaleFunctions(groups: readonly Record<string, FnSpec>[]): Record<string, FnSpec> {
  const functions: Record<string, FnSpec> = {}
  for (const group of groups)
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(functions, key)) throw new Error(`Duplicate sale function: ${key}`)
      functions[key] = spec
    }
  return functions
}

export const functions = assembleSaleFunctions([
  warningFunctions,
  customerFunctions,
  tagFunctions,
  teamFunctions,
  filterFunctions,
  analysisFunctions,
  depositsFunctions,
  copyFunctions,
  discountFunctions,
  variantMatrixFunctions,
  deliveryPromiseFunctions,
  lineCostsFunctions,
  lineUnitsFunctions,
  linePricingFunctions,
  catalogueFunctions,
  catalogueQuantityFunctions,
  catalogueDraftFunctions,
  lineGridFunctions,
  sectionFunctions,
  policiesFunctions,
  configurationFunctions,
  queriesFunctions,
  ordersFunctions,
  linesFunctions,
  deliveriesFunctions,
  invoicesFunctions,
  orderHistoryFunctions,
])
