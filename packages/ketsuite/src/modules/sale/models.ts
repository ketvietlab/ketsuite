import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Sequence: { scope: 'company', fields: { id: 'id', nextNumber: 'int' } },
  Order: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      partnerId: 'ref:partner.Partner',
      clientOrderRef: 'text?',
      state: 'text',
      locked: 'bool',
      dateOrder: 'datetime',
      validityDate: 'datetime?',
      warehouseId: 'ref:stock.Warehouse',
      pricelistId: 'ref:pricing.Pricelist?',
      paymentTermId: 'ref:account.PaymentTerm?',
      currency: 'text',
      invoiceStatus: 'text',
      amountUntaxed: 'decimal',
      amountTax: 'decimal',
      amountTotal: 'decimal',
      notes: 'text?',
      // Pinned by trusted integrations, never accepted by ordinary order-edit inputs.
      // Null preserves native behavior for existing orders. A later company setting
      // must not turn an externally fulfilled commercial order into stock/accounting work.
      orderAuthority: 'text?',
      stockAuthority: 'text?',
      invoiceAuthority: 'text?',
      executionPolicyVersion: 'text?',
      // Provider-level shipping/discount/rounding difference; informational only,
      // never a stock line or a tax/accounting classification.
      externalAmountAdjustment: 'decimal?',
      revision: 'int?',
    },
    indexes: {
      company_name: { fields: ['companyId', 'name'], unique: true },
      // What the two list screens actually ask: this state (or these states),
      // newest first. Without it, a tenant with an imported history scans the
      // whole table for every page of quotations.
      state_date: { fields: ['companyId', 'state', 'dateOrder'] },
      partner: { fields: ['companyId', 'partnerId'] },
      invoice_status: { fields: ['companyId', 'invoiceStatus'] },
    },
  },
  OrderLine: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      productId: 'ref:product.Product',
      name: 'text',
      productUomQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      priceUnit: 'decimal',
      discount: 'decimal',
      taxId: 'ref:account.Tax?',
      taxIds: 'json?',
      taxEvidence: 'json?',
      quoteRevision: 'text?',
      qtyDelivered: 'decimal',
      qtyInvoiced: 'decimal',
      priceSubtotal: 'decimal',
      // Optional only for rows created before Wave 1B; every new line stores it.
      priceSubtotalIncl: 'decimal?',
      sequence: 'int',
    },
    indexes: { order_sequence: { fields: ['companyId', 'orderId', 'sequence'] } },
  },
  /**
   * Durable facts emitted by Sale when an order crosses a fulfillment phase.
   *
   * Consumers keep their own receipts instead of writing back here. The
   * company/order/phase key makes command retries harmless and leaves the
   * record useful to any bridge without coupling Sale to that bridge.
   */
  OrderLifecycleEvent: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      phase: 'text',
      orderRevision: 'int?',
      occurredAt: 'datetime',
      createdAt: 'datetime',
    },
    indexes: {
      order_phase: { fields: ['companyId', 'orderId', 'phase'], unique: true },
      timeline: { fields: ['companyId', 'occurredAt', 'id'] },
    },
  },
  /**
   * One sending of a quotation: the channel, the address and the words it went with, or no channel when it was
   * only marked as sent. Every screen that sends a quotation goes through `sale.sendQuotation`, so whoever reads
   * the order (CRM among them) reads its sendings here. Delivering it belongs to the caller.
   */
  QuotationSend: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      channel: 'text?',
      recipient: 'text?',
      message: 'text?',
      /** The order's revision this sending produced. */
      orderRevision: 'int',
      actorUserId: 'text?',
      /** The delivery the caller made of it, as the caller names it; null when nothing was delivered. */
      deliveryRef: 'text?',
      idempotencyKey: 'text?',
      sentAt: 'datetime',
    },
    indexes: {
      order: { fields: ['companyId', 'orderId', 'sentAt'] },
    },
  },
}
