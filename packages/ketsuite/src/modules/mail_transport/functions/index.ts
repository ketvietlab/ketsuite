import type { FnSpec } from '@ketvietlab/ketjs'
import { templatesFunctions } from './templates.ts'
import { outboxFunctions } from './outbox.ts'
import { eventsFunctions } from './events.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [templatesFunctions, outboxFunctions, eventsFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate mail_transport function: ${key}`)
    functions[key] = spec
  }
}
