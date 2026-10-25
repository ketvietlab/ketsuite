import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    applyCode: ['configure', 'configure', 'loyalty_pos.configuration-audit'],
    applyReward: ['configure', 'configure', 'loyalty_pos.configuration-audit'],
    backfill: ['operate', 'operate'],
    cancelOrder: ['approve', 'approve', 'loyalty_pos.domain-policy'],
    createExchange: ['operate', 'operate'],
    evaluateOrder: ['operate', 'operate'],
    getOrderState: ['read', 'view'],
    reconcileOrderAsync: ['approve', 'approve', 'loyalty_pos.domain-policy'],
    refundOrder: ['approve', 'approve', 'loyalty_pos.domain-policy'],
    removeReward: ['operate', 'operate'],
    validateOrder: ['approve', 'approve', 'loyalty_pos.domain-policy'],
  },
  exemptions: {},
} satisfies CatalogueSource
