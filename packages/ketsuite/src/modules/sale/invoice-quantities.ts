import type { Row } from '@ketvietlab/ketjs'
import { compareDecimals, subtractDecimals } from '../account/money.ts'
const positive = (value: string) => (compareDecimals(value, '0') > 0 ? value : '0')
export function invoiceQuantities(line: Row, policy: string) {
  if (line.displayType || line.comboBasePrice != null)
    return { qtyToInvoice: '0', qtyOverDelivered: '0', qtyOverToInvoice: '0' }
  const qtyToInvoice = positive(
    subtractDecimals(
      policy === 'delivery' ? (line.qtyDelivered ?? '0') : (line.productUomQty ?? '0'),
      line.qtyInvoiced ?? '0',
    ),
  )
  const qtyOverDelivered = positive(subtractDecimals(line.qtyDelivered ?? '0', line.productUomQty ?? '0'))
  const qtyOverToInvoice =
    policy !== 'delivery'
      ? '0'
      : compareDecimals(qtyToInvoice, qtyOverDelivered) < 0
        ? qtyToInvoice
        : qtyOverDelivered
  return { qtyToInvoice, qtyOverDelivered, qtyOverToInvoice }
}
