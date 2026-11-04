import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import type { SaleOrderModalData } from './order-modal-view.tsx'

/**
 * A quotation with deliveries or invoices. Its saved lines keep their product, unit and order, and an
 * action that rewrites every line (applying a quotation template, a manual discount on all lines) is
 * refused with `sale.error.gridHistory`, so the modal does not offer it.
 */
export const quotationWithHistory = (c: RecordModalContext<SaleOrderModalData>) =>
  c.data.record.state !== 'sale' && !!(c.data.record.moves?.length || c.data.record.invoices?.length)
