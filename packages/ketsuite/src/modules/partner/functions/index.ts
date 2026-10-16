import type { FnSpec } from '@ketvietlab/ketjs'
import { partnersFunctions } from './partners.ts'
import { addressesFunctions } from './addresses.ts'
import { rolesFunctions } from './roles.ts'
import { termsFunctions } from './terms.ts'

export { defaultAddressFor, snapshotPartnerAddress } from './helpers.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [partnersFunctions, addressesFunctions, rolesFunctions, termsFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate partner function: ${key}`)
    functions[key] = spec
  }
}
