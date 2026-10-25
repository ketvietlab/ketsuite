import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    cancelProduction: ['approve', 'approve', 'manufacturing.domain-policy'],
    completeProduction: ['approve', 'approve', 'manufacturing.domain-policy'],
    confirmProduction: ['approve', 'approve', 'manufacturing.domain-policy'],
    finishWorkOrder: ['operate', 'operate'],
    getBom: ['read', 'view'],
    getProduction: ['read', 'view'],
    listBoms: ['read', 'view'],
    listProductions: ['read', 'view'],
    listWorkCenters: ['read', 'view'],
    pauseWorkOrder: ['operate', 'operate'],
    saveBom: ['configure', 'configure', 'manufacturing.configuration-audit'],
    saveProduction: ['operate', 'operate'],
    saveWorkCenter: ['configure', 'configure', 'manufacturing.configuration-audit'],
    startProduction: ['operate', 'operate'],
    startWorkOrder: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
