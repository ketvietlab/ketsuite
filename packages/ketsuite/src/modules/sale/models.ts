import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  OrderCopy: {
    scope: 'company',
    fields: { id: 'ref:sale.Order', sourceId: 'ref:sale.Order', sourceRevision: 'int', copiedAt: 'datetime' },
    indexes: { source: { fields: ['companyId', 'sourceId'] } },
  },
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
      confirmedAt: 'datetime?',
      commitmentDate: 'datetime?',
      shippingPolicy: 'text?',
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
      // Who sold it and with which team (D16): attribution only, outside the order's revision.
      userId: 'ref:user.User?',
      teamId: 'ref:sale.Team?',
    },
    indexes: {
      company_name: { fields: ['companyId', 'name'], unique: true },
      // What the two list screens actually ask: this state (or these states),
      // newest first. Without it, a tenant with an imported history scans the
      // whole table for every page of quotations.
      state_date: { fields: ['companyId', 'state', 'dateOrder'] },
      partner: { fields: ['companyId', 'partnerId'] },
      invoice_status: { fields: ['companyId', 'invoiceStatus'] },
      team: { fields: ['companyId', 'teamId'] },
    },
  },
  // Kept out of OrderLine so ordinary order/report reads never disclose cost.
  OrderLineCost: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      lineId: 'ref:sale.OrderLine',
      productId: 'ref:product.Product',
      productUomId: 'ref:uom.Unit',
      baseUomId: 'ref:uom.Unit',
      factor: 'decimal',
      baseCost: 'decimal?',
      unitCost: 'decimal?',
      currency: 'text',
      capturedAt: 'datetime',
    },
    indexes: {
      line: { fields: ['companyId', 'lineId'], unique: true },
      order: { fields: ['companyId', 'orderId'] },
    },
  },
  // A customer's deposit on an order (D9): a receipt in Accounting, not an invoice, linked here.
  OrderDeposit: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      paymentId: 'ref:account.Payment',
      createdAt: 'datetime',
    },
    indexes: {
      order: { fields: ['companyId', 'orderId'] },
      payment: { fields: ['companyId', 'paymentId'], unique: true },
    },
  },
  PartnerWarning: {
    scope: 'company',
    fields: { id: 'id', partnerId: 'ref:partner.Partner', message: 'text', revision: 'int' },
    indexes: { partner: { fields: ['companyId', 'partnerId'], unique: true } },
  },
  /**
   * How this company sells to one customer (D11). The party is shared by every company;
   * its salesperson, pricelist and payment term are this company's. The credit limit stays
   * on `partner.CompanyTerms`, where accounting reads it too.
   */
  CustomerTerms: {
    scope: 'company',
    fields: {
      id: 'id',
      partnerId: 'ref:partner.Partner',
      userId: 'ref:user.User?',
      pricelistId: 'ref:pricing.Pricelist?',
      paymentTermId: 'ref:account.PaymentTerm?',
      revision: 'int',
    },
    indexes: { partner: { fields: ['companyId', 'partnerId'], unique: true } },
  },
  /** A sales tag (D15): a name, unique in the company without regard to case. */
  Tag: {
    scope: 'company',
    fields: { id: 'id', name: 'text', nameKey: 'text', active: 'bool', revisionId: 'text' },
    indexes: { name_key: { fields: ['companyId', 'nameKey'], unique: true } },
  },
  OrderTag: {
    scope: 'company',
    fields: { id: 'id', orderId: 'ref:sale.Order', tagId: 'ref:sale.Tag', sequence: 'int' },
    indexes: {
      order_tag: { fields: ['companyId', 'orderId', 'tagId'], unique: true },
      tag: { fields: ['companyId', 'tagId'] },
    },
  },
  /** A sales team (D16): a name unique in the company without regard to case, a leader and a monthly target. */
  Team: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      nameKey: 'text',
      leaderId: 'ref:user.User',
      monthlyTarget: 'decimal',
      active: 'bool',
      revisionId: 'text',
    },
    indexes: { name_key: { fields: ['companyId', 'nameKey'], unique: true } },
  },
  /**
   * A salesperson in a team. `heldBy` is the member while the team is in use and null once it is
   * archived, so the index lets a salesperson sell in one team in use at most.
   */
  TeamMember: {
    scope: 'company',
    fields: { id: 'id', teamId: 'ref:sale.Team', userId: 'ref:user.User', heldBy: 'text?' },
    indexes: {
      team: { fields: ['companyId', 'teamId'] },
      held_by: { fields: ['companyId', 'heldBy'], unique: true },
    },
  },
  /**
   * The company's sales settings (D20). Validity, signature and payment are what a new quotation starts
   * with; locking and the goods invoicing policy apply when a quotation is confirmed.
   */
  Configuration: {
    scope: 'company',
    fields: {
      id: 'id',
      requireProduct: 'bool',
      saleWarnings: 'bool?',
      quotationValidityDays: 'int?',
      onlineSignature: 'bool?',
      onlinePayment: 'bool?',
      prepaymentPercent: 'decimal?',
      lockConfirmed: 'bool?',
      goodsInvoicePolicy: 'text?',
      revision: 'int',
    },
  },
  OrderLine: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      productId: 'ref:product.Product?',
      displayType: 'text?',
      lineKind: 'text?',
      optionalSection: 'bool?',
      name: 'text',
      productUomQty: 'decimal',
      productUomId: 'ref:uom.Unit?',
      priceUnit: 'decimal',
      // Null legacy values preserve the saved price; only explicit true permits repricing.
      priceAutomatic: 'bool?',
      discount: 'decimal',
      taxId: 'ref:account.Tax?',
      taxIds: 'json?',
      taxEvidence: 'json?',
      quoteRevision: 'text?',
      // Parent price is retained for allocation; only item lines carry commercial amounts.
      comboBasePrice: 'decimal?',
      comboParentId: 'ref:sale.OrderLine?',
      comboChoiceId: 'ref:product.Combo?',
      qtyDelivered: 'decimal',
      qtyInvoiced: 'decimal',
      // Invoiced by ordered or delivered quantities, as decided when the line was sold (D20); null
      // on lines sold before, which follow their product's policy.
      invoicePolicy: 'text?',
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
  /** Who changed an order, how and when (D7): the order's history, appended by `order-history.ts`. */
  OrderEvent: {
    scope: 'company',
    append: true,
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      action: 'text',
      actorId: 'text?',
      relatedId: 'text?',
      reason: 'text?',
      details: 'json',
      occurredAt: 'datetime',
    },
    indexes: { order: { fields: ['companyId', 'orderId', 'occurredAt'] } },
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
