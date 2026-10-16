import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  OpportunityQuotation: {
    scope: 'company',
    fields: {
      id: 'id',
      caseId: 'ref:crm.Case',
      salesOrderId: 'ref:sale.Order',
      createdAt: 'datetime',
    },
    indexes: {
      order: { fields: ['companyId', 'salesOrderId'], unique: true },
      opportunity: { fields: ['companyId', 'caseId', 'createdAt'] },
    },
  },
  /**
   * How the company ties quotations written in Sales to its opportunities. `off`: an opportunity holds only the
   * quotations written from it. `attach`: a salesperson may also attach a quotation of the same customer written
   * in Sales. One row per company; none reads as `off`.
   */
  QuotationPolicy: {
    scope: 'company',
    fields: {
      id: 'id',
      saleQuotations: 'text',
      version: 'int',
      updatedAt: 'datetime',
    },
    indexes: { company: { fields: ['companyId'], unique: true } },
  },
}
