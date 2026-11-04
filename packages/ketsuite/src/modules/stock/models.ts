import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Warehouse: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      code: 'text',
      receptionSteps: 'text',
      deliverySteps: 'text',
      active: 'bool',
      // K62: days between two counts of everything the warehouse holds; none (0 or null) counts off the cycle.
      countFrequencyDays: 'int?',
      // K60: when delivery and internal transfers take their goods: at_confirm, manual (null) or by_date,
      // the scheduled date less N days (N' for a priority transfer).
      reservationMethod: 'text?',
      reservationDaysBefore: 'int?',
      reservationDaysBeforePriority: 'int?',
    },
    indexes: { code_company: { fields: ['companyId', 'code'], unique: true } },
  },
  Location: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      usage: 'text',
      parentId: 'ref:stock.Location?',
      parentPath: 'text',
      warehouseId: 'ref:stock.Warehouse?',
      active: 'bool',
    },
    indexes: {
      parent: { fields: ['companyId', 'parentId'] },
      warehouse: { fields: ['companyId', 'warehouseId'] },
    },
  },
  PickingType: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      code: 'text',
      warehouseId: 'ref:stock.Warehouse?',
      defaultLocationSrcId: 'ref:stock.Location?',
      defaultLocationDestId: 'ref:stock.Location?',
      createBackorder: 'text',
      active: 'bool',
    },
  },
  // K17: the next number of a warehouse's transfers of one kind (HCM/NK/0003), one row per warehouse
  // and kind.
  PickingSequence: {
    scope: 'company',
    fields: { id: 'id', nextNumber: 'int' },
  },
  Picking: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      pickingTypeId: 'ref:stock.PickingType',
      locationId: 'ref:stock.Location',
      locationDestId: 'ref:stock.Location',
      moveType: 'text',
      state: 'text',
      backorderId: 'ref:stock.Picking?',
      partnerId: 'ref:partner.Partner?',
      replenishmentGroup: 'text?',
      scheduledDate: 'datetime',
      dateDone: 'datetime?',
      // K60: a priority transfer takes goods first and, reserving by date, earlier.
      priority: 'bool?',
      // K60: a person gave its goods back; nothing reserves it again on its own until someone does by hand.
      reservationPaused: 'bool?',
      // K18: why a person cancelled it; transfers cancelled by their order or flow carry none.
      cancelReason: 'text?',
    },
    indexes: { state_type: { fields: ['companyId', 'state', 'pickingTypeId'] } },
  },
  Move: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      pickingId: 'ref:stock.Picking?',
      productId: 'ref:product.Product',
      productUomId: 'ref:uom.Unit',
      productUomQty: 'decimal',
      replenishmentQuantity: 'decimal?',
      replenishmentUomId: 'ref:uom.Unit?',
      quantity: 'decimal',
      locationId: 'ref:stock.Location',
      locationDestId: 'ref:stock.Location',
      state: 'text',
      picked: 'bool',
      procureMethod: 'text',
      ruleId: 'ref:stock.Rule?',
      origin: 'text?',
      /** Net price per product unit the source document agreed, in company currency. */
      priceUnit: 'decimal?',
      /** K19: the delivered move this one brings back. */
      originReturnedMoveId: 'ref:stock.Move?',
    },
    indexes: {
      product_locations: { fields: ['companyId', 'productId', 'locationId', 'locationDestId', 'state'] },
      returns: { fields: ['companyId', 'originReturnedMoveId'] },
    },
  },
  MoveLine: {
    scope: 'company',
    fields: {
      id: 'id',
      moveId: 'ref:stock.Move',
      pickingId: 'ref:stock.Picking?',
      productId: 'ref:product.Product',
      productUomId: 'ref:uom.Unit',
      quantity: 'decimal',
      quantityProductUom: 'decimal',
      locationId: 'ref:stock.Location',
      locationDestId: 'ref:stock.Location',
      lotId: 'ref:stock.Lot?',
      receiptLotName: 'text?',
      receiptExpirationDate: 'datetime?',
      picked: 'bool',
      // K24: the receipt price per unit; blank receipts take the running average.
      unitCost: 'decimal?',
      // The stock value this line moved once it completed, in company currency.
      value: 'decimal?',
    },
    indexes: {
      move: { fields: ['companyId', 'moveId'] },
      reservation: { fields: ['companyId', 'productId', 'locationId', 'picked'] },
    },
  },
  Quant: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      locationId: 'ref:stock.Location',
      lotId: 'ref:stock.Lot?',
      lotKey: 'text',
      quantity: 'decimal',
      reservedQuantity: 'decimal',
      inDate: 'datetime',
      version: 'int',
    },
    indexes: { identity: { fields: ['companyId', 'productId', 'locationId', 'lotKey'], unique: true } },
  },
  Lot: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      name: 'text',
      ref: 'text?',
      note: 'text?',
      expirationDate: 'datetime?',
      manufacturingDate: 'datetime?',
      bestBeforeDate: 'datetime?',
      removalDate: 'datetime?',
      alertDate: 'datetime?',
      automaticDates: 'json?',
      quarantined: 'bool?',
      revisionId: 'text?',
      active: 'bool',
    },
    indexes: { product_name: { fields: ['companyId', 'productId', 'name'], unique: true } },
  },
  LotHistory: {
    scope: 'company',
    fields: {
      id: 'id',
      lotId: 'ref:stock.Lot',
      at: 'datetime',
      actorId: 'text?',
      reason: 'text',
      before: 'json',
      after: 'json',
    },
  },
  Route: {
    scope: 'company',
    fields: { id: 'id', name: 'text', sequence: 'int', active: 'bool' },
  },
  Rule: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      routeId: 'ref:stock.Route',
      action: 'text',
      sequence: 'int',
      locationSrcId: 'ref:stock.Location?',
      locationDestId: 'ref:stock.Location',
      pickingTypeId: 'ref:stock.PickingType',
      procureMethod: 'text',
      active: 'bool',
    },
    indexes: { route_destination: { fields: ['companyId', 'routeId', 'locationDestId', 'sequence'] } },
  },
  ProductRoute: {
    scope: 'company',
    fields: { id: 'id', productId: 'ref:product.Product', routeId: 'ref:stock.Route' },
    indexes: { product_route: { fields: ['companyId', 'productId', 'routeId'], unique: true } },
  },
  CategoryRoute: {
    scope: 'company',
    fields: { id: 'id', categoryId: 'ref:product.Category', routeId: 'ref:stock.Route' },
    indexes: { category_route: { fields: ['companyId', 'categoryId', 'routeId'], unique: true } },
  },
  // K15 (#1428): who works at a warehouse. Someone assigned to exactly one warehouse has it chosen for them
  // on a new quotation, count or scrap; anyone else chooses, unless the company has one warehouse only.
  WarehouseUser: {
    scope: 'company',
    fields: { id: 'id', warehouseId: 'ref:stock.Warehouse', userId: 'ref:user.User' },
    indexes: { warehouse_user: { fields: ['companyId', 'warehouseId', 'userId'], unique: true } },
  },
  WarehouseRoute: {
    scope: 'company',
    fields: { id: 'id', warehouseId: 'ref:stock.Warehouse', routeId: 'ref:stock.Route' },
    indexes: { warehouse_route: { fields: ['companyId', 'warehouseId', 'routeId'], unique: true } },
  },
  MoveLink: {
    scope: 'company',
    fields: { id: 'id', originMoveId: 'ref:stock.Move', destinationMoveId: 'ref:stock.Move' },
    indexes: { move_link: { fields: ['companyId', 'originMoveId', 'destinationMoveId'], unique: true } },
  },
  // K59: a scrap order. Its goods leave on a done transfer to the warehouse's scrap location when it is
  // validated, and come back on another when it is undone.
  Scrap: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      warehouseId: 'ref:stock.Warehouse',
      locationId: 'ref:stock.Location',
      pickingId: 'ref:stock.Picking?',
      productId: 'ref:product.Product',
      lotId: 'ref:stock.Lot?',
      quantity: 'decimal',
      reason: 'text',
      replenish: 'bool',
      note: 'text?',
      state: 'text',
      date: 'datetime',
      dateDone: 'datetime?',
      createdBy: 'text?',
      validatedBy: 'text?',
      operationId: 'ref:stock.Picking?',
      replenishmentPickingId: 'ref:stock.Picking?',
      undoId: 'ref:stock.Picking?',
      undoneBy: 'text?',
      undoReason: 'text?',
    },
    indexes: {
      name_company: { fields: ['companyId', 'name'], unique: true },
      warehouse: { fields: ['companyId', 'warehouseId'] },
      operation: { fields: ['companyId', 'operationId'] },
    },
  },
  // K33–K36: a physical count of one warehouse, counted line by line and approved by someone else.
  CountSession: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      warehouseId: 'ref:stock.Warehouse',
      locationId: 'ref:stock.Location',
      blind: 'bool',
      committee: 'json?',
      resolution: 'text?',
      valueCurrency: 'text?',
      // K62: the products a partial count is kept to; null counts everything the location holds.
      productIds: 'json?',
      state: 'text',
      startedAt: 'datetime',
      startedBy: 'text?',
      submittedAt: 'datetime?',
      submittedBy: 'text?',
      approvedAt: 'datetime?',
      approvedBy: 'text?',
      returnReason: 'text?',
      returnedBy: 'text?',
      cancelReason: 'text?',
      cancelledBy: 'text?',
      shortagePickingId: 'ref:stock.Picking?',
      excessPickingId: 'ref:stock.Picking?',
    },
    indexes: {
      name_company: { fields: ['companyId', 'name'], unique: true },
      warehouse: { fields: ['companyId', 'warehouseId'] },
    },
  },
  CountSettlement: {
    scope: 'company',
    fields: {
      id: 'id',
      sessionId: 'ref:stock.CountSession',
      fingerprint: 'text',
      accountingDate: 'date',
      accountMoveId: 'text?',
      processedBy: 'text?',
      processedAt: 'datetime',
    },
    indexes: { session: { fields: ['companyId', 'sessionId'] } },
  },
  CountLine: {
    scope: 'company',
    fields: {
      id: 'id',
      sessionId: 'ref:stock.CountSession',
      productId: 'ref:product.Product',
      lotId: 'ref:stock.Lot?',
      lotKey: 'text',
      sequence: 'int',
      expected: 'decimal',
      counted: 'decimal?',
      countedBy: 'text?',
      countedAt: 'datetime?',
      reason: 'text?',
      reasonCode: 'text?',
      qualityGood: 'decimal?',
      qualityPoor: 'decimal?',
      qualityLost: 'decimal?',
      countBookValue: 'decimal?',
      countPhysicalValue: 'decimal?',
      settlementId: 'text?',
      settlementMethod: 'text?',
      settlementPartnerId: 'ref:partner.Partner?',
      found: 'bool',
    },
    indexes: {
      session: { fields: ['companyId', 'sessionId'] },
      session_goods: { fields: ['companyId', 'sessionId', 'productId', 'lotKey'], unique: true },
    },
  },
  Orderpoint: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      warehouseId: 'ref:stock.Warehouse',
      locationId: 'ref:stock.Location',
      trigger: 'text',
      minQuantity: 'decimal',
      maxQuantity: 'decimal',
      replenishmentUomId: 'ref:uom.Unit?',
      source: 'text?',
      vendorId: 'ref:partner.Partner?',
      leadDays: 'int?',
      routeId: 'ref:stock.Route?',
      active: 'bool',
    },
    indexes: { product_location: { fields: ['companyId', 'productId', 'locationId'], unique: true } },
  },
  // One weighted average per product across the company's warehouses (K4).
  ProductValuation: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      quantity: 'decimal',
      value: 'decimal',
      revision: 'int',
    },
    indexes: { product: { fields: ['companyId', 'productId'], unique: true } },
  },
  // Every valued in/out of the company's stock, signed, with the journal entry that booked it.
  ValuationLayer: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      pickingId: 'text?',
      moveId: 'text?',
      moveLineId: 'text?',
      kind: 'text',
      quantity: 'decimal',
      value: 'decimal',
      unitCost: 'decimal?',
      accountMoveId: 'text?',
      date: 'datetime',
    },
    indexes: {
      product_date: { fields: ['companyId', 'productId', 'date'] },
      picking: { fields: ['companyId', 'pickingId'] },
    },
  },
  // K63: an adjustment of what a completed receipt line is worth, why, and the account it went against.
  Revaluation: {
    scope: 'company',
    fields: {
      id: 'id',
      pickingId: 'ref:stock.Picking',
      moveId: 'ref:stock.Move',
      productId: 'ref:product.Product',
      amount: 'decimal',
      account: 'text',
      reason: 'text',
      date: 'datetime',
      createdBy: 'text?',
      accountMoveId: 'text?',
    },
    indexes: { picking: { fields: ['companyId', 'pickingId'] } },
  },
  // K64: what bringing goods in cost besides their price (freight, duty, insurance), spread over the lines of
  // completed receipts and posted against the vendor of the service.
  LandedCost: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      vendorId: 'ref:partner.Partner?',
      /** The day of the vendor's document, `YYYY-MM-DD`, not after today. */
      date: 'text',
      pickingIds: 'json',
      state: 'text',
      createdAt: 'datetime',
      createdBy: 'text?',
      postedAt: 'datetime?',
      postedBy: 'text?',
      accountMoveId: 'text?',
      cancelReason: 'text?',
      cancelledBy: 'text?',
    },
    indexes: { name_company: { fields: ['companyId', 'name'], unique: true } },
  },
  LandedCostLine: {
    scope: 'company',
    fields: {
      id: 'id',
      landedCostId: 'ref:stock.LandedCost',
      name: 'text',
      /** How the amount spreads over the receipts' lines: `quantity`, `value` or `equal`. */
      splitMethod: 'text',
      amount: 'decimal',
      sequence: 'int',
    },
    indexes: { cost: { fields: ['companyId', 'landedCostId'] } },
  },
  /** What posting gave each receipt line: into the goods still held, and into the cost of what has left. */
  LandedCostAllocation: {
    scope: 'company',
    fields: {
      id: 'id',
      landedCostId: 'ref:stock.LandedCost',
      lineId: 'ref:stock.LandedCostLine',
      pickingId: 'ref:stock.Picking',
      moveId: 'ref:stock.Move',
      productId: 'ref:product.Product',
      amount: 'decimal',
      stockAmount: 'decimal',
      cogsAmount: 'decimal',
    },
    indexes: {
      cost: { fields: ['companyId', 'landedCostId'] },
      picking: { fields: ['companyId', 'pickingId'] },
    },
  },
  // K45: a carrier the company ships with and its rates. It is a partner on the books: the customers' cash it
  // holds (1388) and what it charges (331) are its debts and claims.
  Carrier: {
    scope: 'company',
    fields: {
      id: 'id',
      /** Fixed once created: it starts its statements' numbers ("GHN/DS/0002"). */
      code: 'text',
      name: 'text',
      partnerId: 'ref:partner.Partner',
      /** What the first kilogram costs, and each kilogram begun after it. */
      baseFee: 'decimal',
      extraKgFee: 'decimal',
      /** What collecting cash on delivery costs, a percentage of the amount. */
      codFeeRate: 'decimal',
      isDefault: 'bool',
      active: 'bool',
      /**
       * Who deals with the carrier: `tenant`, the company itself, which books parcels and types the tracking
       * code. `platform` (the hosting provider books through its own account with the carrier) is reserved for a
       * later phase.
       */
      management: 'text',
      revision: 'int',
      createdAt: 'datetime',
      createdBy: 'text?',
    },
    indexes: {
      code_company: { fields: ['companyId', 'code'], unique: true },
      name_company: { fields: ['companyId', 'name'], unique: true },
    },
  },
  // K46: a parcel a carrier takes a customer delivery in, its fees and the cash it collects.
  Shipment: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      pickingId: 'ref:stock.Picking',
      /** The delivery while this parcel is not cancelled: a delivery has one such parcel at a time. */
      openPickingId: 'text?',
      warehouseId: 'ref:stock.Warehouse',
      partnerId: 'text?',
      saleOrderId: 'text?',
      carrierId: 'ref:stock.Carrier',
      /** Kilograms, to two decimals. */
      weight: 'decimal',
      cod: 'decimal',
      note: 'text?',
      state: 'text',
      trackingCode: 'text?',
      /** Fixed on booking from the carrier's rates then. */
      shippingFee: 'decimal?',
      codFee: 'decimal?',
      attempts: 'int',
      bookedDate: 'text?',
      handedDate: 'text?',
      deliveredDate: 'text?',
      failedDate: 'text?',
      failReason: 'text?',
      returnPickingId: 'text?',
      returnedDate: 'text?',
      cancelledDate: 'text?',
      cancelReason: 'text?',
      codEntryId: 'text?',
      revision: 'int',
      createdAt: 'datetime',
      createdBy: 'text?',
    },
    indexes: {
      name_company: { fields: ['companyId', 'name'], unique: true },
      open_picking: { fields: ['companyId', 'openPickingId'], unique: true },
      picking: { fields: ['companyId', 'pickingId'] },
      carrier_state: { fields: ['companyId', 'carrierId', 'state'] },
    },
  },
  // K47: what a carrier collected and charged up to a day, posted and then settled.
  DeliveryStatement: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      carrierId: 'ref:stock.Carrier',
      /** Up to which day, `YYYY-MM-DD`, its parcels were delivered or brought back. */
      date: 'text',
      note: 'text?',
      state: 'text',
      cod: 'decimal',
      fees: 'decimal',
      net: 'decimal',
      feeEntryId: 'text?',
      paidDate: 'text?',
      paymentJournalId: 'text?',
      paymentEntryId: 'text?',
      cancelledDate: 'text?',
      cancelReason: 'text?',
      revision: 'int',
      createdAt: 'datetime',
      createdBy: 'text?',
    },
    indexes: { name_company: { fields: ['companyId', 'name'], unique: true } },
  },
  DeliveryStatementLine: {
    scope: 'company',
    fields: {
      id: 'id',
      statementId: 'ref:stock.DeliveryStatement',
      shipmentId: 'ref:stock.Shipment',
      /** The parcel while its statement is not cancelled: a parcel is on one such statement. */
      openShipmentId: 'text?',
      cod: 'decimal',
      shippingFee: 'decimal',
      codFee: 'decimal',
      sequence: 'int',
    },
    indexes: {
      statement: { fields: ['companyId', 'statementId'] },
      open_shipment: { fields: ['companyId', 'openShipmentId'], unique: true },
    },
  },
  // Accounts are plain ids: stock runs without accounting and only posts when it is installed.
  AccountingSetting: {
    scope: 'company',
    fields: {
      id: 'id',
      journalId: 'text?',
      valuationAccountId: 'text?',
      supplierAccountId: 'text?',
      productionAccountId: 'text?',
      cogsAccountId: 'text?',
      gainAccountId: 'text?',
      lossAccountId: 'text?',
      // K7: shipping posts only once these are set; stock valuation does not need them.
      /** Carrying and collecting cost (641). */
      deliveryFeeAccountId: 'text?',
      /** Customers' cash a carrier holds until it pays it over (1388). */
      carrierCodAccountId: 'text?',
      /** What customers owe (131), which their cash on delivery pays. */
      receivableAccountId: 'text?',
      /** What the company owes carriers for carrying (331), cleared on settlement. */
      carrierPayableAccountId: 'text?',
    },
  },
}
