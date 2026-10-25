import type { FnSpec } from '@ketvietlab/ketjs'
import { typesFunctions } from './types.ts'
import { workFunctions } from './work.ts'
import { plansFunctions } from './plans.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [typesFunctions, workFunctions, plansFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate activity function: ${key}`)
    functions[key] = spec
  }
}
