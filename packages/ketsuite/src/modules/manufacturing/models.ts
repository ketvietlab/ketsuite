import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * The public manufacturing kernel deliberately stops at an executable BOM and
 * stock-backed production order. Approval revisions, operator evidence and
 * workforce scoring are extension concerns rather than hidden flags here.
 */
export const models: Record<string, ModelDef> = {
  Bom: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      code: 'text?',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      type: 'text',
      active: 'bool',
      /**
       * A version is its own row: `draft` → `review` → `active` → `archived`, the first
       * version's id in `familyId`. Null on a BOM saved before versions, which reads as active.
       */
      version: 'int?',
      state: 'text?',
      familyId: 'ref:manufacturing.Bom?',
      /** What happens when more is used than the BOM asks: `flexible`, `warning` or `strict`. */
      consumption: 'text?',
      /** What one unit of product weighs (kg); with it, each batch of output is weighed. */
      unitWeight: 'decimal?',
      /** How far a weighed batch may stray from its expected weight, in percent. */
      weightTolerance: 'decimal?',
      /** Confirming a sale of the product drafts an order for each of its lines (make to order). */
      toOrder: 'bool?',
      /** The pH a batch must read to pass its quality check; with it, each lot waits in quarantine. */
      phMin: 'decimal?',
      phMax: 'decimal?',
      requestedBy: 'ref:user.User?',
      requestedAt: 'datetime?',
      approvedBy: 'ref:user.User?',
      approvedAt: 'datetime?',
      /** Why the version changed, given on submit; why it was sent back, given on rejection. */
      reason: 'text?',
    },
    indexes: {
      product_active: { fields: ['companyId', 'productId', 'active'] },
      family: { fields: ['companyId', 'familyId'] },
      code: { fields: ['companyId', 'code'], unique: true },
    },
  },
  BomLine: {
    scope: 'company',
    fields: {
      id: 'id',
      bomId: 'ref:manufacturing.Bom',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      operationId: 'ref:manufacturing.Operation?',
      /** Expected loss on top of the quantity, 0–50 per cent. */
      lossPercent: 'decimal?',
      sequence: 'int',
    },
    indexes: { bom_sequence: { fields: ['companyId', 'bomId', 'sequence'] } },
  },
  Byproduct: {
    scope: 'company',
    fields: {
      id: 'id',
      bomId: 'ref:manufacturing.Bom',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      sequence: 'int',
    },
    indexes: { bom_sequence: { fields: ['companyId', 'bomId', 'sequence'] } },
  },
  WorkCenter: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      /** The skill its work needs, as a free key a deployment names (`weigh`, `cook`, …). */
      skill: 'text?',
      capacity: 'decimal',
      timeEfficiency: 'decimal',
      costPerHour: 'decimal',
      active: 'bool',
    },
    indexes: { code: { fields: ['companyId', 'code'], unique: true } },
  },
  Operation: {
    scope: 'company',
    fields: {
      id: 'id',
      bomId: 'ref:manufacturing.Bom',
      workCenterId: 'ref:manufacturing.WorkCenter',
      name: 'text',
      sequence: 'int',
      durationExpected: 'int',
      /**
       * `quantity` scales the minutes by the order against the BOM quantity; `fixed` (and
       * null, as before) keeps them per order, like curing a batch.
       */
      timeMode: 'text?',
      instructions: 'text?',
    },
    indexes: { bom_sequence: { fields: ['companyId', 'bomId', 'sequence'] } },
  },
  Production: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      name: 'text',
      bomId: 'ref:manufacturing.Bom',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      quantityProduced: 'decimal',
      sourceLocationId: 'ref:stock.Location',
      productionLocationId: 'ref:stock.Location',
      destinationLocationId: 'ref:stock.Location',
      rawPickingId: 'ref:stock.Picking?',
      outputPickingId: 'ref:stock.Picking?',
      state: 'text',
      scheduledStart: 'datetime',
      scheduledFinish: 'datetime?',
      startedAt: 'datetime?',
      finishedAt: 'datetime?',
      origin: 'text?',
      /** Higher runs first among orders in the same state; null is 0. */
      priority: 'int?',
      cancelReason: 'text?',
      /** The order this one makes the rest of, when it was closed short. */
      backorderOfId: 'ref:manufacturing.Production?',
      /** Closed with less made than planned, and no order for the rest. */
      closedShort: 'bool?',
      /** Where a drafted order came from: `sale` or `rule`; null when someone made it by hand. */
      orderSource: 'text?',
      saleOrderId: 'text?',
      saleLineId: 'text?',
      /** The sale changed after this order was confirmed: `cancelled` or `changed` (#1949). */
      saleNotice: 'text?',
      orderpointId: 'text?',
      /** When the goods are promised: the sale's commitment date. */
      deadline: 'datetime?',
      /** What closing settled: labour charged, and the cost difference split between stock and sales. */
      labourCost: 'decimal?',
      varianceHeld: 'decimal?',
      varianceSold: 'decimal?',
      version: 'int',
    },
    indexes: {
      // The name is what an operator reads off the shop floor paperwork and
      // what `origin` stamps onto every stock move this order makes. Two orders
      // called MO-001 make a move impossible to trace back to the one that
      // caused it.
      company_name: { fields: ['companyId', 'name'], unique: true },
      state_schedule: { fields: ['companyId', 'state', 'scheduledStart'] },
      product: { fields: ['companyId', 'productId'] },
    },
  },
  ProductionMove: {
    scope: 'company',
    fields: {
      id: 'id',
      productionId: 'ref:manufacturing.Production',
      moveId: 'ref:stock.Move',
      /**
       * `component`, `finished`, `byproduct`, or one record: `consumed`, `returned`, `scrapped`,
       * `output`, `byproduct_output`.
       */
      kind: 'text',
      sequence: 'int',
      /** A component's demand when the order was confirmed, kept as recorded use shrinks the move. */
      demand: 'decimal?',
      /** Why goods were scrapped. */
      reason: 'text?',
      /** Who confirmed using more than a `warning` BOM asks. */
      confirmedBy: 'text?',
      /** What a batch of output weighed (kg), when its BOM weighs output. */
      weight: 'decimal?',
    },
    indexes: {
      move: { fields: ['companyId', 'moveId'], unique: true },
      production_kind: { fields: ['companyId', 'productionId', 'kind', 'sequence'] },
    },
  },
  WorkOrder: {
    scope: 'company',
    fields: {
      id: 'id',
      productionId: 'ref:manufacturing.Production',
      operationId: 'ref:manufacturing.Operation',
      workCenterId: 'ref:manufacturing.WorkCenter',
      name: 'text',
      sequence: 'int',
      state: 'text',
      durationExpected: 'int',
      durationActual: 'int',
      /** Who does it: assigned on confirmation or by the floor lead, or whoever starts it. */
      operatorId: 'text?',
      note: 'text?',
      /** What the step lost (in the order's unit), given when it is finished. */
      loss: 'decimal?',
      startedAt: 'datetime?',
      finishedAt: 'datetime?',
      version: 'int',
    },
    indexes: {
      production_sequence: { fields: ['companyId', 'productionId', 'sequence'] },
      center_state: { fields: ['companyId', 'workCenterId', 'state'] },
      operator_state: { fields: ['companyId', 'operatorId', 'state'] },
    },
  },
  /** The company's labour account (622): closing an order charges work in progress against it. */
  CostSetting: {
    scope: 'company',
    fields: { id: 'id', labourAccountId: 'text?' },
  },
  /** The quality check of one batch's lot, from quarantine to passed or failed. */
  QualityCheck: {
    scope: 'company',
    fields: {
      id: 'id',
      productionId: 'ref:manufacturing.Production',
      lotId: 'ref:stock.Lot',
      moveId: 'ref:stock.Move?',
      /** `pending`, `passed` or `failed`. */
      state: 'text',
      ph: 'decimal?',
      /** `pass` or `fail`. */
      sensory: 'text?',
      note: 'text?',
      checkedBy: 'text?',
      checkedAt: 'datetime?',
      /** The template the lot is checked against; null is the default, pH and sensory (#1947). */
      templateId: 'text?',
    },
    indexes: { lot: { fields: ['companyId', 'lotId'] } },
  },
  /**
   * What a finished product's lots are checked for (#1947): a set of criteria, each a range or a
   * pass/fail. One active template per product; a product without one keeps the default check.
   */
  QualityTemplate: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      name: 'text',
      productId: 'ref:product.Product?',
      active: 'bool?',
      version: 'int',
    },
    indexes: { product: { fields: ['companyId', 'productId'] } },
  },
  QualityCriterion: {
    scope: 'company',
    fields: {
      id: 'id',
      templateId: 'ref:manufacturing.QualityTemplate',
      sequence: 'int',
      name: 'text',
      /** `range` (a reading within min–max) or `passFail`. */
      kind: 'text',
      min: 'decimal?',
      max: 'decimal?',
      unit: 'text?',
      /** A lot passes only when every required criterion passes. */
      required: 'bool?',
    },
    indexes: { template: { fields: ['companyId', 'templateId'] } },
  },
  /** One criterion of one check as it was checked: the criterion is copied, so later edits leave it. */
  QualityResult: {
    scope: 'company',
    fields: {
      id: 'id',
      checkId: 'ref:manufacturing.QualityCheck',
      sequence: 'int',
      criterionId: 'text?',
      name: 'text',
      kind: 'text',
      min: 'decimal?',
      max: 'decimal?',
      unit: 'text?',
      required: 'bool?',
      value: 'text?',
      passed: 'bool?',
    },
    indexes: { check: { fields: ['companyId', 'checkId'] } },
  },
  /** One run of an operation by one person: opened on start, closed with its minutes. */
  WorkTimeLog: {
    scope: 'company',
    fields: {
      id: 'id',
      workOrderId: 'ref:manufacturing.WorkOrder',
      operatorId: 'text?',
      startedAt: 'datetime',
      stoppedAt: 'datetime?',
      minutes: 'int?',
    },
    indexes: { work_order: { fields: ['companyId', 'workOrderId', 'startedAt'] } },
  },
  /**
   * How well one person does one work-center skill (1–5); 2 is enough to be given the work. The
   * name is kept here so the floor reads who does what without reading the user directory.
   */
  OperatorSkill: {
    scope: 'company',
    fields: {
      id: 'id',
      userId: 'text',
      name: 'text',
      skill: 'text',
      level: 'int',
      /** A floor lead, given work only when no worker of the same level is freer. */
      lead: 'bool?',
    },
    indexes: { user_skill: { fields: ['companyId', 'userId', 'skill'], unique: true } },
  },
}
