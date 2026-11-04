import type { ModelDef } from '@ketvietlab/ketjs'
export const models: Record<string, ModelDef> = {
  Namespace: { scope: 'company', fields: { id: 'id', revision: 'int' } },
  Template: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      nameKey: 'text',
      kind: 'text',
      ownerId: 'ref:user.User',
      ownerKey: 'text',
      active: 'bool',
      revision: 'int',
      validityDays: 'int?',
      notes: 'text?',
      requireSignature: 'bool?',
      requirePayment: 'bool?',
      prepaymentPercent: 'decimal?',
    },
    indexes: {
      name: { fields: ['companyId', 'kind', 'ownerKey', 'nameKey'], unique: true },
      listing: { fields: ['companyId', 'kind', 'active', 'name'] },
    },
  },
  Line: {
    scope: 'company',
    fields: {
      id: 'id',
      templateId: 'ref:sale_template.Template',
      sequence: 'int',
      displayType: 'text?',
      name: 'text?',
      productId: 'ref:product.Product?',
      productUomId: 'ref:uom.Unit?',
      productUomQty: 'decimal',
      optional: 'bool',
    },
    indexes: { template: { fields: ['companyId', 'templateId', 'sequence'] } },
  },
  Team: {
    scope: 'company',
    fields: { id: 'id', templateId: 'ref:sale_template.Template', teamId: 'ref:crm.Team' },
    indexes: { identity: { fields: ['companyId', 'templateId', 'teamId'], unique: true } },
  },
  OrderOption: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      sequence: 'int',
      productId: 'ref:product.Product',
      productUomId: 'ref:uom.Unit',
      productUomQty: 'decimal',
    },
    indexes: { order: { fields: ['companyId', 'orderId', 'sequence'] } },
  },
}
