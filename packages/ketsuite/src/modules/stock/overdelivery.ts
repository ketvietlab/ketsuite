/** Customer deliveries only. Receipts, internal transfers and supplier/customer returns keep demand caps. */
export const allowsOverdelivery = (code: unknown, source: unknown, destination: unknown): boolean =>
  code === 'outgoing' && ['internal', 'transit'].includes(String(source)) && destination === 'customer'

export const stockQuantityError = (messageKey: string) => ({
  ok: false,
  errors: [{ field: 'quantity', messageKey }],
})
