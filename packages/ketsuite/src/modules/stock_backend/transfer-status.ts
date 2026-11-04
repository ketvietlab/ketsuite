/** K18: the five statuses a transfer reads as: Nháp, Chờ hàng, Sẵn sàng, Hoàn tất, Đã hủy. */
export const TRANSFER_STATUSES = ['draft', 'waiting', 'assigned', 'done', 'cancel'] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

/**
 * K18: what a transfer's status reads, from its stored state. A transfer that takes goods from stock is
 * ready once they are held (`assigned`) and waits for them before. One that holds nothing, a receipt,
 * waits for nothing once confirmed, so it is ready to receive.
 */
export const transferStatus = (state: unknown, reserves: boolean): TransferStatus => {
  const value = String(state)
  if (value === 'draft' || value === 'done' || value === 'cancel') return value
  return value === 'assigned' || !reserves ? 'assigned' : 'waiting'
}
