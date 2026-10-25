import type { FnSpec } from '@ketvietlab/ketjs'
import { ingressFunctions } from './ingress.ts'
import { tokensFunctions } from './tokens.ts'
import { aliasesFunctions } from './aliases.ts'
import { eventsFunctions } from './events.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [ingressFunctions, tokensFunctions, aliasesFunctions, eventsFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate mail_inbound function: ${key}`)
    functions[key] = spec
  }
}

export { inboundInput, inboundMutationEffects, inboundOutput } from './shared.ts'
