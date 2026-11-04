import { bulkEditFunctions } from './bulk-edit.ts'
// Assemble the product capabilities without allowing a later group to hide an earlier key.
import type { FnSpec } from '@ketvietlab/ketjs'
import { importExportFunctions } from './import-export.ts'
import { importFunctions } from './imports.ts'
import { comboFunctions } from './combos.ts'
import { tagFunctions } from './tags.ts'
import { templatesFunctions } from './templates.ts'
import { variantsFunctions } from './variants.ts'
import { attributesFunctions } from './attributes.ts'
import { packagingFunctions } from './packaging.ts'
import { packagingGridFunctions } from './packaging-grid.ts'
import { classificationFunctions } from './classification.ts'
import { costsFunctions } from './costs.ts'
import { recordFunctions } from './record.ts'
import { lifecycleFunctions } from './lifecycle.ts'
import { categoryRecordFunctions } from './category-record.ts'
import { productModalContextFunctions } from '../product-modal-context.ts'
import { attributeModalContextFunctions } from '../attribute-modal-context.ts'
import { variantSetupFunctions } from '../variant-setup.ts'
import { attributeDraftFunctions } from '../attribute-draft.ts'
import { configureAttributesFunctions } from '../configure-attributes.ts'
import { duplicateTemplateFunctions } from '../duplicate-template.ts'

export function assembleProductFunctions(groups: readonly Record<string, FnSpec>[]): Record<string, FnSpec> {
  const functions: Record<string, FnSpec> = {}
  for (const group of groups)
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(functions, key)) throw new Error(`Duplicate product function: ${key}`)
      functions[key] = spec
    }
  return functions
}

export const functions = assembleProductFunctions([
  bulkEditFunctions,
  importFunctions,
  importExportFunctions,
  templatesFunctions,
  tagFunctions,
  comboFunctions,
  variantsFunctions,
  attributesFunctions,
  packagingFunctions,
  packagingGridFunctions,
  classificationFunctions,
  categoryRecordFunctions,
  costsFunctions,
  recordFunctions,
  lifecycleFunctions,
  productModalContextFunctions,
  attributeModalContextFunctions,
  variantSetupFunctions,
  attributeDraftFunctions,
  configureAttributesFunctions,
  duplicateTemplateFunctions,
])

export { saveTemplateFunction } from './templates.ts'
export { describeVariants } from './variants.ts'
export { attributeLinesOf } from './attributes.ts'
