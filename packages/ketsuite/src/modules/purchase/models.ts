import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Sequence: {
    scope: 'company',
    fields: { id: 'id', nextNumber: 'int' },
  },
  Order: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      partnerId: 'ref:partner.Partner',
      partnerRef: 'text',
      state: 'text',
      locked: 'bool',
      dateOrder: 'datetime',
      dateApprove: 'datetime?',
      datePlanned: 'datetime',
      pickingTypeId: 'ref:stock.PickingType',
      currency: 'text',
      invoiceStatus: 'text',
      amountUntaxed: 'decimal',
      amountTax: 'decimal',
      amountTotal: 'decimal',
      notes: 'text?',
      revision: 'int?',
      // Who drafted the order: an approver may not approve their own order.
      createdBy: 'text?',
      // The approval levels the order needed when it was submitted, so a later
      // change of thresholds neither strands nor waves through a pending order.
      approvalLevels: 'int?',
      /**
       * A request a reorder rule drafted (#1737): the rule's company, warehouse, location, receipt
       * type and vendor, so later rules for the same vendor and location join the same draft.
       */
      replenishmentGroup: 'text?',
      /** Where the receipt delivers; empty means the receipt type's default destination. */
      locationDestId: 'ref:stock.Location?',
    },
    indexes: {
      company_name: { fields: ['companyId', 'name'], unique: true },
      replenishment: { fields: ['companyId', 'replenishmentGroup'] },
    },
  },
  /** One approval given to an order waiting for approval: `manager` (level 1) or `owner` (level 2). */
  OrderApproval: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:purchase.Order',
      level: 'text',
      approvedBy: 'text?',
      approvedAt: 'datetime',
    },
    indexes: { order_level: { fields: ['companyId', 'orderId', 'level'], unique: true } },
  },
  /**
   * The company's purchasing settings: from `approvalAmount` an order needs a purchasing manager's
   * approval, from `finalApprovalAmount` also a final approver's. Empty means no threshold.
   * `priceTolerance` is the percentage a vendor bill's net unit price may differ from its order's
   * before the bill cannot be posted; empty means bill prices are not compared.
   */
  Configuration: {
    scope: 'company',
    fields: {
      id: 'id',
      approvalAmount: 'decimal?',
      finalApprovalAmount: 'decimal?',
      priceTolerance: 'decimal?',
      revision: 'int',
    },
  },
  /** A draft vendor bill put on hold while the vendor corrects it, and why. Posting the bill lifts it. */
  BillHold: {
    scope: 'company',
    fields: {
      id: 'id',
      moveId: 'ref:account.Move',
      reason: 'text',
      heldBy: 'text?',
      heldAt: 'datetime',
    },
    indexes: { move: { fields: ['companyId', 'moveId'], unique: true } },
  },
  OrderLine: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:purchase.Order',
      productId: 'ref:product.Product',
      name: 'text',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      priceUnit: 'decimal',
      discount: 'decimal',
      taxId: 'ref:account.Tax?',
      datePlanned: 'datetime',
      qtyReceived: 'decimal',
      qtyInvoiced: 'decimal',
      priceSubtotal: 'decimal',
      sequence: 'int',
      /** The reorder rule that asked for this line, when one did. */
      orderpointId: 'ref:stock.Orderpoint?',
    },
    indexes: { order_sequence: { fields: ['companyId', 'orderId', 'sequence'] } },
  },
  SupplierInfo: {
    scope: 'company',
    fields: {
      id: 'id',
      partnerId: 'ref:partner.Partner',
      productTemplateId: 'ref:product.Template',
      productId: 'ref:product.Product?',
      productUomId: 'ref:uom.Unit',
      productName: 'text?',
      productCode: 'text?',
      minQty: 'decimal',
      price: 'decimal',
      discount: 'decimal',
      delay: 'int',
      sequence: 'int',
      dateStart: 'datetime?',
      dateEnd: 'datetime?',
    },
  },
}
