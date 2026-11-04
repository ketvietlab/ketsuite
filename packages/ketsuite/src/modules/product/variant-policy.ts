import type { Row } from '@ketvietlab/ketjs'

export const VARIANT_LIMIT = 50
export const variantLimitRefusal = (count: number, field = 'variants') => ({
  ok: false as const,
  errors: [{ field, code: 'product.error.configure.tooMany', params: { count } }],
})

export class VariantPolicyRefused extends Error {
  readonly result: Row
  constructor(result: Row) {
    super('Variant policy refused the change')
    this.result = result
  }
}
