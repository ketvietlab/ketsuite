import type { FnSpec } from '@ketvietlab/ketjs'
import { subtypesFunctions } from './subtypes.ts'
import { inboxFunctions } from './inbox.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [subtypesFunctions, inboxFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate mail function: ${key}`)
    functions[key] = spec
  }
}
