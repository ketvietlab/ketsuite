import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    getQuotationBenefits: ['read', 'view'],
    searchProgramReferences: ['read', 'view'],
    listProgramCards: ['read', 'view'],
    generateCoupons: ['configure', 'configure', 'loyalty_sale.configuration-audit'],
    getProgram: ['read', 'view'],
    listPrograms: ['read', 'view'],
    saveProgram: ['configure', 'configure', 'loyalty_sale.configuration-audit'],
    setProgramActive: ['configure', 'configure', 'loyalty_sale.configuration-audit'],
    applyCode: ['operate', 'operate'],
    applyReward: ['operate', 'operate'],
    backfill: ['configure', 'configure', 'loyalty_sale.configuration-audit'],
    cancelOrder: ['approve', 'approve', 'loyalty_sale.domain-policy'],
    confirmOrder: ['approve', 'approve', 'loyalty_sale.domain-policy'],
    evaluateOrder: ['read', 'view'],
    refundOrder: ['approve', 'approve', 'loyalty_sale.domain-policy'],
    removeReward: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
