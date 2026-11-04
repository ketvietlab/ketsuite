import { compareDecimals } from '../account/money.ts'
import type { Row } from '@ketvietlab/ketjs'

export const isStructuralLine = (line: Row): boolean =>
  line.displayType === 'section' || line.displayType === 'note'

/** A free line has no catalogue or stock identity. Its description is its identity on documents. */
export const validFreeLine = (line: Row): boolean =>
  !line.displayType &&
  !line.productId &&
  !line.productUomId &&
  typeof line.name === 'string' &&
  line.name.trim().length > 0 &&
  line.name.trim().length <= 500

export const validSaleLine = (line: Row): boolean => {
  try {
    if (line.priceAutomatic != null && typeof line.priceAutomatic !== 'boolean') return false
    if (isStructuralLine(line))
      return (
        !line.productId &&
        !line.productUomId &&
        typeof line.name === 'string' &&
        !!line.name.trim() &&
        line.name.trim().length <= 500 &&
        ['productUomQty', 'priceUnit', 'discount'].every(
          (key) =>
            line[key] == null ||
            compareDecimals(typeof line[key] === 'number' ? String(line[key]) : line[key], '0') === 0,
        ) &&
        !line.taxId &&
        (!line.taxIds || (Array.isArray(line.taxIds) && !line.taxIds.length))
      )
    if (line.displayType) return false
    const quantity =
      typeof line.productUomQty === 'number' && Number.isFinite(line.productUomQty)
        ? line.productUomQty.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
        : line.productUomQty
    if (compareDecimals(quantity, '0') < 0) return false
    // A product line left without a unit sells in the product's own (writeQuotationLine), as a new grid line does.
    return line.productId
      ? typeof line.productId === 'string' &&
          (line.productUomId == null || typeof line.productUomId === 'string')
      : validFreeLine(line)
  } catch {
    return false
  }
}
