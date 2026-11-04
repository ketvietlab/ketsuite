import { searchFunctions } from './search.ts'
import { filterFunctions } from './filters.ts'
import { bulkFunctions } from './bulk.ts'
import { importFunctions } from './imports.ts'
import type { FnSpec } from '@ketvietlab/ketjs'
import { unitFunctions } from './units.ts'
import { attributeFunctions } from './attributes.ts'
import { collectionFunctions } from './collections.ts'
import { comboFunctions } from './combos.ts'
import { tagFunctions } from './tags.ts'
import { categoryFunctions } from './categories.ts'
export function assembleProductBackendFunctions(groups: readonly Record<string, FnSpec>[]) {
  const functions: Record<string, FnSpec> = {}
  for (const group of groups)
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(functions, key)) throw new Error(`Duplicate product backend function: ${key}`)
      functions[key] = spec
    }
  return functions
}
export const functions = assembleProductBackendFunctions([
  bulkFunctions,
  filterFunctions,
  searchFunctions,
  unitFunctions,
  attributeFunctions,
  collectionFunctions,
  categoryFunctions,
  tagFunctions,
  comboFunctions,
  importFunctions,
])
