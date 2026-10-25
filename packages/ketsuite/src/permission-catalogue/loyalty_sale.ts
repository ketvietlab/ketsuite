import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate'],
  functions: {
    applyCode: ['configure', 'configure', 'loyalty_sale.configuration-audit'],
    applyReward: ['configure', 'configure', 'loyalty_sale.configuration-audit'],
    backfill: ['operate', 'operate'],
    cancelOrder: ['approve', 'approve', 'loyalty_sale.domain-policy'],
    confirmOrder: ['approve', 'approve', 'loyalty_sale.domain-policy'],
    evaluateOrder: ['operate', 'operate'],
    refundOrder: ['approve', 'approve', 'loyalty_sale.domain-policy'],
    removeReward: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
