import { receiptLotFunctions } from './receipt-lots.ts'
import { orderpointFunctions } from './orderpoints.ts'
import type { FnSpec } from '@ketvietlab/ketjs'
import { productsFunctions } from './products.ts'
import { warehousesFunctions } from './warehouses.ts'
import { locationsFunctions } from './locations.ts'
import { pickingTypesFunctions } from './picking-types.ts'
import { lotsFunctions } from './lots.ts'
import { pickingsFunctions } from './pickings.ts'
import { movesFunctions } from './moves.ts'
import { inventoryFunctions } from './inventory.ts'
import { availabilityFunctions } from './availability.ts'
import { valuationFunctions } from './valuation.ts'
import { analysisFunctions } from './analysis.ts'
import { revaluationFunctions } from './revaluation.ts'
import { landedCostFunctions } from './landed-costs.ts'
import { deliveryFunctions } from './delivery.ts'
import { returnFunctions } from './returns.ts'
import { scrapFunctions } from './scraps.ts'
import { countSettlementFunctions } from './count-settlement.ts'
import { countReportFunctions } from './count-report.ts'
import { countFunctions } from './counts.ts'
import { pickingLineFunctions } from './picking-lines.ts'
import { pickingMoveFunctions } from './picking-moves.ts'
export function assembleStockFunctions(groups: readonly Record<string, FnSpec>[]): Record<string, FnSpec> {
  const functions: Record<string, FnSpec> = {}
  for (const group of groups)
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(functions, key)) throw new Error('Duplicate stock function: ' + key)
      functions[key] = spec
    }
  return functions
}
export const functions = assembleStockFunctions([
  productsFunctions,
  warehousesFunctions,
  locationsFunctions,
  pickingTypesFunctions,
  lotsFunctions,
  pickingsFunctions,
  movesFunctions,
  inventoryFunctions,
  availabilityFunctions,
  orderpointFunctions,
  receiptLotFunctions,
  valuationFunctions,
  analysisFunctions,
  revaluationFunctions,
  landedCostFunctions,
  deliveryFunctions,
  returnFunctions,
  scrapFunctions,
  countFunctions,
  countReportFunctions,
  countSettlementFunctions,
  pickingLineFunctions,
  pickingMoveFunctions,
])
export * from '../types.ts'
