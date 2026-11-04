import type { Row } from '@ketvietlab/ketjs'

/** Legacy unset sale/purchase flags keep their enabled default; lot tracking must be explicit. */
export function matchesProductUse(product: Row, use: unknown): boolean {
  if (use === 'sale') return product.saleOk !== false
  if (use === 'purchase') return product.purchaseOk !== false
  if (use === 'notSold') return product.saleOk === false
  if (use === 'tracked')
    return product.type !== 'service' && product.isStorable === true && product.tracking === 'lot'
  return true
}
